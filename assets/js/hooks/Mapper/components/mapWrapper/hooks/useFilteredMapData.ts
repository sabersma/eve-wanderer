import { useMemo } from 'react';
import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import type { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { bfsReachable, buildAdjacencyList } from '@/hooks/Mapper/helpers/graph.ts';

/**
 * Pure helper that computes the set of visible system ids for the current view.
 *
 * Shared by `useFilteredMapData` (layout/filtering) and the TopSearch search
 * list so both stay consistent:
 * - 'all' mode → every system.
 * - subscription view with no subscription → empty (nothing rendered).
 * - otherwise → BFS from subscribed systems + my characters' current systems.
 *
 * `hideUnsubscribed` narrows the subscription view to clusters reachable from a
 * subscribed system. It deliberately drops both of the other seed sources:
 * a character standing in a cluster the user has not subscribed to is exactly
 * what the mode is meant to hide, so their own character's systems go too.
 */
export function computeVisibleSystemIds(
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  viewMode: ViewMode,
  subscribedSystemIds: string[],
  myCharSystemIds: string[],
  manuallyAddedSystemIds: string[],
  hideUnsubscribed = false,
): Set<string> {
  if (viewMode === 'all') {
    return new Set(systems.map(s => s.id));
  }

  // Before the first subscription, render nothing.
  if (subscribedSystemIds.length === 0) {
    return new Set();
  }

  const seedIds = hideUnsubscribed
    ? subscribedSystemIds
    : [...new Set([...subscribedSystemIds, ...myCharSystemIds])];

  const seeds = [...new Set(seedIds)].filter(id => systems.some(s => s.id === id));

  if (seeds.length === 0) {
    return new Set();
  }

  const adjacency = buildAdjacencyList(connections);
  const visibleSystemIds = bfsReachable(seeds, adjacency);

  if (hideUnsubscribed) {
    // Nothing outside the subscribed clusters is added back, not even systems
    // this user manually added: the whole point of the mode is that only
    // subscribed territory is on screen. The add path refuses to create new
    // ones, so a manually added system that is disconnected can only be a
    // leftover from before the mode was switched on.
    return visibleSystemIds;
  }

  // Keep isolated systems (no connections) visible only if the current user
  // manually added them, so a freshly right-click-added system can be wired up
  // while other users' orphaned systems stay hidden.
  const manuallyAddedSet = new Set(manuallyAddedSystemIds);
  const connectedIds = new Set<string>();
  for (const c of connections) {
    connectedIds.add(c.source);
    connectedIds.add(c.target);
  }
  for (const s of systems) {
    if (!connectedIds.has(s.id) && manuallyAddedSet.has(s.id)) {
      visibleSystemIds.add(s.id);
    }
  }

  return visibleSystemIds;
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
  manuallyAddedSystemIds: string[],
  hideUnsubscribed = false,
): FilteredMapData {
  return useMemo(() => {
    const visibleSystemIds = computeVisibleSystemIds(
      systems,
      connections,
      viewMode,
      subscribedSystemIds,
      myCharSystemIds,
      manuallyAddedSystemIds,
      hideUnsubscribed,
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
  }, [
    systems,
    connections,
    viewMode,
    subscribedSystemIds,
    myCharSystemIds,
    manuallyAddedSystemIds,
    hideUnsubscribed,
  ]);
}
