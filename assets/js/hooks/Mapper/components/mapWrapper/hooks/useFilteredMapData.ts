import { useMemo } from 'react';
import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import type { ViewMode } from '@/hooks/Mapper/mapRootProvider';

/**
 * Build an adjacency list from connections for BFS traversal.
 * Each system ID maps to a Set of connected system IDs.
 */
function buildAdjacencyList(connections: SolarSystemConnection[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const conn of connections) {
    if (!adj.has(conn.source)) adj.set(conn.source, new Set());
    if (!adj.has(conn.target)) adj.set(conn.target, new Set());
    adj.get(conn.source)!.add(conn.target);
    adj.get(conn.target)!.add(conn.source);
  }
  return adj;
}

/**
 * BFS from all seed nodes, traversing through the adjacency list.
 * Returns the set of all reachable system IDs.
 */
function bfsReachable(seeds: string[], adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [...seeds];

  for (const seed of seeds) {
    visited.add(seed);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * Pure helper that computes the set of visible system ids for the current view.
 *
 * Shared by `useFilteredMapData` (layout/filtering) and the TopSearch search
 * list so both stay consistent:
 * - 'all' mode → every system.
 * - subscription view with no subscription → empty (nothing rendered).
 * - otherwise → BFS from subscribed systems + my characters' current systems.
 */
export function computeVisibleSystemIds(
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  viewMode: ViewMode,
  subscribedSystemIds: string[],
  myCharSystemIds: string[],
): Set<string> {
  if (viewMode === 'all') {
    return new Set(systems.map(s => s.id));
  }

  // Before the first subscription, render nothing.
  if (subscribedSystemIds.length === 0) {
    return new Set();
  }

  const seeds = [...new Set([...subscribedSystemIds, ...myCharSystemIds])].filter(id =>
    systems.some(s => s.id === id),
  );

  if (seeds.length === 0) {
    return new Set();
  }

  const adjacency = buildAdjacencyList(connections);
  return bfsReachable(seeds, adjacency);
}

export interface FilteredMapData {
  systems: SolarSystemRawType[];
  connections: SolarSystemConnection[];
  visibleSystemIds: Set<string>;
}

/**
 * Hook that filters systems and connections based on the current view mode.
 */
export function useFilteredMapData(
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  viewMode: ViewMode,
  subscribedSystemIds: string[],
  myCharSystemIds: string[],
): FilteredMapData {
  return useMemo(() => {
    const visibleSystemIds = computeVisibleSystemIds(
      systems,
      connections,
      viewMode,
      subscribedSystemIds,
      myCharSystemIds,
    );

    const filteredSystems = systems.filter(s => visibleSystemIds.has(s.id));
    const filteredConnections = connections.filter(
      c => visibleSystemIds.has(c.source) && visibleSystemIds.has(c.target),
    );

    return {
      systems: filteredSystems,
      connections: filteredConnections,
      visibleSystemIds,
    };
  }, [systems, connections, viewMode, subscribedSystemIds, myCharSystemIds]);
}
