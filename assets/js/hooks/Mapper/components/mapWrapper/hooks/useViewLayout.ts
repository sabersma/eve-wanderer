import { useCallback, useEffect, useMemo, useRef } from 'react';
import useLocalStorageState from 'use-local-storage-state';
import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import {
  computeMultiBfsLayout,
  computeNewNodePosition,
  LayoutPositions,
} from '@/hooks/Mapper/components/map/helpers/layout';

const LS_KEY = 'wanderer_view_layouts_v1';

type ViewLayouts = Record<string, LayoutPositions>;

/**
 * Manages per-view local layouts.
 *
 * - 'all' view: uses shared global data coordinates.
 * - subscription view: uses a cached per-subscription layout. The cache is
 *   written once on first entry (multi-root BFS), then updated incrementally:
 *     * newly-added systems get a position on top of the existing layout
 *     * deleted systems are removed from the cache
 *   Existing systems are never re-laid-out (so remote data-coordinate changes
 *   from other users do not cause flicker).
 *
 * Layout roots are the subscribed systems only. Systems where the user's own
 * character is currently located are NOT roots — they are laid out as children
 * of whatever they connect to (so a new connection places them next to their
 * neighbor), or keep their data position if they form a separate cluster.
 */
export function useViewLayout(
  viewMode: ViewMode,
  subscribedSystemIds: string[],
  filteredSystems: SolarSystemRawType[],
  filteredConnections: SolarSystemConnection[],
) {
  const [viewLayouts, setViewLayouts] = useLocalStorageState<ViewLayouts>(LS_KEY, {
    defaultValue: {},
    storageSync: false,
  });

  const layoutKey = useMemo(
    () =>
      viewMode === 'home' && subscribedSystemIds.length > 0
        ? `subscribed:${[...subscribedSystemIds].sort().join(',')}`
        : null,
    [viewMode, subscribedSystemIds],
  );

  // Render layout: cache-first, fall back to a fresh multi-root BFS when not cached yet.
  const layoutPositions = useMemo<LayoutPositions | null>(() => {
    if (viewMode === 'all') {
      return filteredSystems.reduce<LayoutPositions>((acc, s) => {
        acc[s.id] = { x: s.position.x, y: s.position.y };
        return acc;
      }, {});
    }

    if (!layoutKey) return null;

    const stored = viewLayouts[layoutKey];
    if (stored && Object.keys(stored).length > 0) return stored;

    return computeMultiBfsLayout(subscribedSystemIds, filteredSystems, filteredConnections);
  }, [viewMode, layoutKey, subscribedSystemIds, filteredSystems, filteredConnections, viewLayouts]);

  // Tracks the previous connections to detect newly-added connections (used to
  // re-anchor systems that were isolated before gaining a connection).
  const prevConnectionsRef = useRef<SolarSystemConnection[] | null>(null);

  // Persist/incrementally maintain the cache.
  useEffect(() => {
    if (viewMode !== 'home' || !layoutKey) return;

    const visibleIds = new Set(filteredSystems.map(s => s.id));
    const stored = viewLayouts[layoutKey];

    // First entry: persist a full multi-root BFS layout.
    if (!stored || Object.keys(stored).length === 0) {
      const layout = computeMultiBfsLayout(subscribedSystemIds, filteredSystems, filteredConnections);
      setViewLayouts(prev => ({ ...prev, [layoutKey]: layout }));
      return;
    }

    // Incremental: remove deleted systems, add positions for new systems, and
    // re-layout systems that just gained a connection (was isolated before).
    const missingIds = filteredSystems.filter(s => !stored[s.id]).map(s => s.id);
    const deletedIds = Object.keys(stored).filter(id => !visibleIds.has(id));

    const prevConnections = prevConnectionsRef.current;
    prevConnectionsRef.current = filteredConnections;

    const seedSet = new Set(subscribedSystemIds);
    const prevConnectedIds = new Set<string>();
    prevConnections?.forEach(c => {
      prevConnectedIds.add(c.source);
      prevConnectedIds.add(c.target);
    });

    const relayoutSet = new Set<string>();
    if (prevConnections !== null) {
      const newConnections = filteredConnections.filter(c => !prevConnections.some(p => p.id === c.id));
      for (const c of newConnections) {
        for (const endpoint of [c.source, c.target]) {
          if (!seedSet.has(endpoint) && !prevConnectedIds.has(endpoint) && stored[endpoint] !== undefined) {
            relayoutSet.add(endpoint);
          }
        }
      }
    }
    const relayoutIds = [...relayoutSet];

    if (missingIds.length === 0 && deletedIds.length === 0 && relayoutIds.length === 0) return;

    const merged = { ...stored };
    deletedIds.forEach(id => {
      delete merged[id];
    });

    missingIds.forEach(id => {
      merged[id] = computeNewNodePosition(id, merged, filteredSystems, filteredConnections);
    });

    relayoutIds.forEach(id => {
      delete merged[id];
    });
    relayoutIds.forEach(id => {
      merged[id] = computeNewNodePosition(id, merged, filteredSystems, filteredConnections);
    });

    setViewLayouts(prev => ({ ...prev, [layoutKey]: merged }));
  }, [viewMode, layoutKey, subscribedSystemIds, filteredSystems, filteredConnections, viewLayouts, setViewLayouts]);

  const savePosition = useCallback(
    (systemId: string, pos: { x: number; y: number }) => {
      if (!layoutKey) return;

      setViewLayouts(prev => ({
        ...prev,
        [layoutKey]: {
          ...(prev[layoutKey] ?? layoutPositions ?? {}),
          [systemId]: pos,
        },
      }));
    },
    [layoutKey, layoutPositions, setViewLayouts],
  );

  // Recompute a full multi-root BFS layout for the current subscription and
  // persist it locally. "Re-arrange layout" is a local-only action in a
  // subscription view.
  const rearrangeLayout = useCallback(() => {
    if (!layoutKey) return;

    const layout = computeMultiBfsLayout(
      subscribedSystemIds,
      filteredSystems,
      filteredConnections,
      layoutPositions ?? undefined,
    );
    setViewLayouts(prev => ({ ...prev, [layoutKey]: layout }));
  }, [layoutKey, subscribedSystemIds, filteredSystems, filteredConnections, layoutPositions, setViewLayouts]);

  return { layoutPositions, savePosition, rearrangeLayout };
}
