import React, { createContext, useContext, useRef } from 'react';
import { Node } from 'reactflow';
import { detectOverlaps, EMPTY_OVERLAPS, OverlapMap, sameOverlaps } from './helpers/overlap';

/**
 * Overlap state lives in its own provider rather than in MapProvider's store.
 *
 * MapProvider re-renders through a rAF-throttled store on every drag frame; if
 * the overlap map were part of it, each frame would push a new value to every
 * consumer and re-render all nodes. Here the context value only changes when
 * the set of overlapping pairs actually changes.
 */
const MapOverlapContext = createContext<OverlapMap>(EMPTY_OVERLAPS);

interface MapOverlapProviderProps {
  nodes: Node[];
  children: React.ReactNode;
}

export const MapOverlapProvider = ({ nodes, children }: MapOverlapProviderProps) => {
  const ref = useRef<OverlapMap>(EMPTY_OVERLAPS);
  const next = detectOverlaps(nodes);

  // Keep the previous map (and therefore the context identity) when the overlap
  // set is unchanged, so a normal drag causes zero re-renders through here.
  if (!sameOverlaps(ref.current, next)) {
    ref.current = next;
  }

  return <MapOverlapContext.Provider value={ref.current}>{children}</MapOverlapContext.Provider>;
};

/** Ids of the systems whose node visually collides with this one. */
export const useNodeOverlap = (id: string): string[] | undefined => useContext(MapOverlapContext).get(id);
