import { Node } from 'reactflow';
import { NODE_H, NODE_W } from './geometry';

/** system id -> ids of the systems its node visually collides with. */
export type OverlapMap = Map<string, string[]>;

export const EMPTY_OVERLAPS: OverlapMap = new Map();

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Two nodes overlap when their real NODE_W x NODE_H rectangles intersect.
 *
 * Deliberately not a distance threshold: nodes sitting on adjacent grid slots
 * are legitimately close, so a threshold would flag most of a dense map and the
 * badge would become noise. Touching edges do not count (strict inequalities).
 */
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Find every pair of overlapping nodes. Both directions are recorded (each node
 * learns about the other) and each list is sorted, so two runs over the same
 * geometry produce structurally equal maps — which is what lets callers detect
 * "nothing changed" cheaply with {@link sameOverlaps} and skip a re-render.
 *
 * Hidden nodes are skipped: they are not on screen, so a badge would be
 * invisible anyway (and in the subscription view hidden means "filtered out").
 */
export function detectOverlaps(nodes: Node[]): OverlapMap {
  const boxes: Box[] = [];

  for (const n of nodes) {
    if (n.hidden) continue;
    boxes.push({ id: n.id, x: n.position.x, y: n.position.y, w: n.width ?? NODE_W, h: n.height ?? NODE_H });
  }

  if (boxes.length < 2) return EMPTY_OVERLAPS;

  boxes.sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1));

  const result: OverlapMap = new Map();

  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      // Sorted by x, so once b starts at or past a's right edge no later box
      // can reach back into a either — the sweep can stop here.
      if (b.x >= a.x + a.w) break;
      if (!intersects(a, b)) continue;

      addTo(result, a.id, b.id);
      addTo(result, b.id, a.id);
    }
  }

  for (const ids of result.values()) ids.sort();

  return result.size === 0 ? EMPTY_OVERLAPS : result;
}

function addTo(map: OverlapMap, id: string, other: string) {
  const list = map.get(id);
  if (list) {
    list.push(other);
  } else {
    map.set(id, [other]);
  }
}

/**
 * Structural equality of two overlap maps. Used as a reference-stability guard:
 * callers keep the previous map when this returns true, so a drag that does not
 * change the overlap set causes zero React re-renders.
 */
export function sameOverlaps(a: OverlapMap, b: OverlapMap): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;

  for (const [id, list] of a) {
    const other = b.get(id);
    if (!other || other.length !== list.length) return false;
    for (let i = 0; i < list.length; i++) {
      if (list[i] !== other[i]) return false;
    }
  }

  return true;
}
