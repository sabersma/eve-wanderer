import { useCallback, useEffect, useMemo, useRef } from 'react';
import useLocalStorageState from 'use-local-storage-state';
import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { computeBfsLayout, computeNewNodePosition, LayoutPositions } from '@/hooks/Mapper/components/map/helpers/layout';

const LS_KEY = 'wanderer_view_layouts_v1';

type ViewLayouts = Record<string, LayoutPositions>;

/**
 * Manages per-view local layouts (方案1 + 方案3), with incremental updates.
 *
 * - 'all' view: uses shared global data coordinates.
 * - 'home:{id}' view: uses a cached per-view layout. The cache is written once
 *   on first entry (full BFS), then only updated incrementally:
 *     * newly-added systems get a position on top of the existing layout
 *     * deleted systems are removed from the cache
 *   Existing systems are never re-laid-out (so remote data-coordinate changes
 *   from other users do not cause flicker).
 *
 * Cross-tab sync is disabled so each browser tab keeps its own layout.
 */
export function useViewLayout(
  viewMode: ViewMode,
  selectedHomeSystemId: string | null,
  filteredSystems: SolarSystemRawType[],
  filteredConnections: SolarSystemConnection[],
  effectiveLockedIds: string[],
) {
  const [viewLayouts, setViewLayouts] = useLocalStorageState<ViewLayouts>(LS_KEY, {
    defaultValue: {},
    storageSync: false,
  });

  const layoutKey = viewMode === 'home' && selectedHomeSystemId ? `home:${selectedHomeSystemId}` : null;

  // Render layout: cache-first, fall back to a fresh BFS when not cached yet.
  const layoutPositions = useMemo<LayoutPositions | null>(() => {
    if (viewMode === 'all') {
      return filteredSystems.reduce<LayoutPositions>((acc, s) => {
        acc[s.id] = { x: s.position.x, y: s.position.y };
        return acc;
      }, {});
    }

    if (!layoutKey || !selectedHomeSystemId) return null;

    const stored = viewLayouts[layoutKey];
    if (stored && Object.keys(stored).length > 0) return stored;

    return computeBfsLayout(selectedHomeSystemId, filteredSystems, filteredConnections, effectiveLockedIds);
  }, [viewMode, layoutKey, selectedHomeSystemId, filteredSystems, filteredConnections, effectiveLockedIds, viewLayouts]);

  // Tracks the previous connections to detect newly-added connections (used to
  // re-anchor systems that were isolated before gaining a connection).
  const prevConnectionsRef = useRef<SolarSystemConnection[] | null>(null);

  // Persist/incrementally maintain the cache.
  useEffect(() => {
    if (viewMode !== 'home' || !selectedHomeSystemId || !layoutKey) return;

    const visibleIds = new Set(filteredSystems.map(s => s.id));
    const stored = viewLayouts[layoutKey];

    // First entry: persist a full BFS layout.
    if (!stored || Object.keys(stored).length === 0) {
      const layout = computeBfsLayout(selectedHomeSystemId, filteredSystems, filteredConnections, effectiveLockedIds);
      setViewLayouts(prev => ({ ...prev, [layoutKey]: layout }));
      return;
    }

    // Incremental: remove deleted systems, add positions for new systems, and
    // re-layout systems that just gained a connection (was isolated before).
    const missingIds = filteredSystems.filter(s => !stored[s.id]).map(s => s.id);
    const deletedIds = Object.keys(stored).filter(id => !visibleIds.has(id));

    // Detect systems that just gained a connection by comparing against the
    // previous connections. This avoids re-laying systems whose global data
    // coordinate happens to equal a BFS layout coordinate (e.g. after a global
    // rearrange), which would otherwise cause layout churn on any data update.
    const prevConnections = prevConnectionsRef.current;
    prevConnectionsRef.current = filteredConnections;

    const relayoutSet = new Set<string>();
    if (prevConnections !== null) {
      const newConnections = filteredConnections.filter(c => !prevConnections.some(p => p.id === c.id));
      for (const c of newConnections) {
        for (const endpoint of [c.source, c.target]) {
          if (endpoint !== selectedHomeSystemId && stored[endpoint] !== undefined) {
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
    relayoutIds.forEach(id => {
      delete merged[id];
    });
    missingIds.forEach(id => {
      merged[id] = computeNewNodePosition(id, merged, filteredSystems, filteredConnections, effectiveLockedIds);
    });
    relayoutIds.forEach(id => {
      merged[id] = computeNewNodePosition(id, merged, filteredSystems, filteredConnections, effectiveLockedIds);
    });

    setViewLayouts(prev => ({ ...prev, [layoutKey]: merged }));
  }, [viewMode, selectedHomeSystemId, layoutKey, filteredSystems, filteredConnections, effectiveLockedIds, viewLayouts, setViewLayouts]);

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

  // Recompute a full BFS layout for the current home and persist it locally.
  // Used to make "re-arrange layout" a local-only action in a home view.
  const rearrangeLayout = useCallback(() => {
    if (!layoutKey || !selectedHomeSystemId) return;

    const layout = computeBfsLayout(
      selectedHomeSystemId,
      filteredSystems,
      filteredConnections,
      effectiveLockedIds,
      layoutPositions ?? undefined,
    );
    setViewLayouts(prev => ({ ...prev, [layoutKey]: layout }));
  }, [layoutKey, selectedHomeSystemId, filteredSystems, filteredConnections, effectiveLockedIds, layoutPositions, setViewLayouts]);

  return { layoutPositions, savePosition, rearrangeLayout };
}
