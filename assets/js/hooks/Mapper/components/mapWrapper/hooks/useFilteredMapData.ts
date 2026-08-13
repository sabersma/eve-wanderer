import { useMemo } from 'react';
import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { STATUSES } from '@/hooks/Mapper/components/map/constants';

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

export interface FilteredMapData {
  systems: SolarSystemRawType[];
  connections: SolarSystemConnection[];
  visibleSystemIds: Set<string>;
  effectiveLockedIds: string[];
}

/**
 * Hook that filters systems and connections based on the current view mode.
 *
 * Locked semantics (per requirement):
 * - "effective locked" = locked AND status !== home. These systems keep the
 *   lock privileges: always visible + treated as BFS bridges so their own
 *   cluster also renders.
 * - A system that is both home AND locked is treated as a normal node in
 *   other home views (no "always visible" privilege, participates in layout).
 *
 * - 'all' mode: returns all systems and connections unchanged.
 * - 'home' mode: performs BFS from the selected home system and all
 *   effective-locked systems, returning reachable systems plus effective-locked
 *   systems. Connections are filtered to only include visible endpoints.
 */
export function useFilteredMapData(
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  viewMode: ViewMode,
  selectedHomeSystemId: string | null,
): FilteredMapData {
  return useMemo(() => {
    // Effective-locked = locked AND not home (home has higher priority)
    const effectiveLockedIds = systems
      .filter(s => s.locked && s.status !== STATUSES.home)
      .map(s => s.id);

    if (viewMode === 'all') {
      return {
        systems,
        connections,
        visibleSystemIds: new Set(systems.map(s => s.id)),
        effectiveLockedIds,
      };
    }

    // viewMode === 'home'
    if (!selectedHomeSystemId) {
      return {
        systems,
        connections,
        visibleSystemIds: new Set(systems.map(s => s.id)),
        effectiveLockedIds,
      };
    }

    // Check if the selected home system exists in the current data
    const homeExists = systems.some(s => s.id === selectedHomeSystemId);
    if (!homeExists) {
      return {
        systems,
        connections,
        visibleSystemIds: new Set(systems.map(s => s.id)),
        effectiveLockedIds,
      };
    }

    // Build adjacency list from all connections
    const adjacency = buildAdjacencyList(connections);

    // BFS from home + effective-locked systems (they bridge their own cluster)
    const seeds = [...new Set([selectedHomeSystemId, ...effectiveLockedIds])];
    const reachableIds = bfsReachable(seeds, adjacency);

    // Visible = reachable ∪ effective-locked (locked always visible)
    const visibleSystemIds = new Set(reachableIds);
    for (const id of effectiveLockedIds) {
      visibleSystemIds.add(id);
    }

    // Also keep isolated systems (no connections) visible, so a manually-added
    // system can be seen and wired into the home tree right away.
    const connectedIds = new Set<string>();
    for (const c of connections) {
      connectedIds.add(c.source);
      connectedIds.add(c.target);
    }
    for (const s of systems) {
      if (!connectedIds.has(s.id)) {
        visibleSystemIds.add(s.id);
      }
    }

    const filteredSystems = systems.filter(s => visibleSystemIds.has(s.id));
    const filteredConnections = connections.filter(
      c => visibleSystemIds.has(c.source) && visibleSystemIds.has(c.target),
    );

    return {
      systems: filteredSystems,
      connections: filteredConnections,
      visibleSystemIds,
      effectiveLockedIds,
    };
  }, [systems, connections, viewMode, selectedHomeSystemId]);
}
