import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';

const NODE_W = 130;
const NODE_H = 34;
const MARGIN_X = 50;
const MARGIN_Y = 41;

const SPACING_X = NODE_W + MARGIN_X;
const SPACING_Y = NODE_H + MARGIN_Y;

export interface LayoutPosition {
  x: number;
  y: number;
}

export type LayoutPositions = Record<string, LayoutPosition>;

/**
 * Find the closest available Y near idealY, avoiding conflicts with
 * previously assigned positions. Mirrors the backend's find_closest_y.
 */
function findClosestY(idealY: number, usedY: Set<number>, minGap: number): number {
  if (!usedY.has(idealY)) return idealY;

  let offset = 1;
  for (;;) {
    const up = idealY - offset * minGap;
    const down = idealY + offset * minGap;
    if (!usedY.has(up)) return up;
    if (!usedY.has(down)) return down;
    offset++;
  }
}

/**
 * Compute a BFS tree layout rooted at the given home system.
 *
 * - depth becomes the column (x = home.x + direction * depth * spacing)
 * - children align to their parent's Y, resolving conflicts downward
 * - `effectiveLockedIds` (locked AND not home) are boundaries: they keep
 *   their original position and are not expanded (subtree is left as-is)
 * - systems that are home (even if locked) are treated as normal nodes
 */
export function computeBfsLayout(
  homeId: string,
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  effectiveLockedIds: string[],
  currentLayout?: LayoutPositions,
): LayoutPositions {
  const sysMap = new Map(systems.map(s => [s.id, s]));
  const home = sysMap.get(homeId);
  if (!home) return {};

  // Build undirected adjacency list
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const c of connections) {
    addEdge(c.source, c.target);
    addEdge(c.target, c.source);
  }

  const lockedSet = new Set(effectiveLockedIds);

  // Direction is judged from the current view layout when available, so a
  // re-arrange keeps the relative left/right the user already sees (home view
  // drags only touch the local layout, not the global data coordinates).
  const homeX = currentLayout?.[homeId]?.x ?? home.position.x;

  // BFS metadata
  const depth = new Map<string, number>([[homeId, 0]]);
  const parent = new Map<string, string>();
  const direction = new Map<string, number>();
  const byDepth = new Map<number, string[]>();
  byDepth.set(0, [homeId]);

  const visited = new Set<string>([homeId]);
  const queue: string[] = [homeId];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curDepth = depth.get(cur)!;
    const neighbors = adj.get(cur) ?? [];

    for (const nb of neighbors) {
      if (visited.has(nb)) continue;
      visited.add(nb);

      // Effective-locked systems are boundaries: mark visited (so we don't
      // re-add from another path) but do not expand their subtree.
      if (lockedSet.has(nb)) continue;

      const nbDepth = curDepth + 1;
      depth.set(nb, nbDepth);
      parent.set(nb, cur);

      const nbX = currentLayout?.[nb]?.x ?? sysMap.get(nb)!.position.x;
      const dir =
        curDepth === 0
          ? nbX >= homeX
            ? 1
            : -1
          : direction.get(cur) ?? 1;
      direction.set(nb, dir);

      if (!byDepth.has(nbDepth)) byDepth.set(nbDepth, []);
      byDepth.get(nbDepth)!.push(nb);

      queue.push(nb);
    }
  }

  // Assign positions depth-by-depth
  const positions: LayoutPositions = {
    [homeId]: { x: home.position.x, y: home.position.y },
  };

  const maxDepth = Math.max(...byDepth.keys());
  for (let d = 1; d <= maxDepth; d++) {
    const ids = byDepth.get(d) ?? [];

    // Sort by parent's already-computed Y for horizontal alignment
    ids.sort((a, b) => {
      const ya = positions[parent.get(a)!]?.y ?? home.position.y;
      const yb = positions[parent.get(b)!]?.y ?? home.position.y;
      return ya - yb;
    });

    const usedY = new Set<number>();
    for (const sid of ids) {
      const parentPos = positions[parent.get(sid)!] ?? { x: home.position.x, y: home.position.y };
      const dir = direction.get(sid) ?? 1;
      const x = home.position.x + dir * d * SPACING_X;
      const y = findClosestY(parentPos.y, usedY, SPACING_Y);
      positions[sid] = { x, y };
      usedY.add(y);
    }
  }

  // Effective-locked systems keep their original (global) position
  for (const sid of effectiveLockedIds) {
    const s = sysMap.get(sid);
    if (s) positions[sid] = { x: s.position.x, y: s.position.y };
  }

  return positions;
}

function isOccupied(candidate: LayoutPosition, stored: LayoutPositions): boolean {
  return Object.values(stored).some(p => p.x === candidate.x && p.y === candidate.y);
}

function defaultAnchor(stored: LayoutPositions): LayoutPosition {
  const positions = Object.values(stored);
  if (positions.length === 0) return { x: 0, y: 0 };

  const maxX = Math.max(...positions.map(p => p.x));
  const maxY = Math.max(...positions.map(p => p.y));
  return { x: maxX, y: maxY };
}

/**
 * Compute a position for a newly-added system on top of an existing cached
 * layout, WITHOUT recomputing the whole tree.
 *
 * - effective-locked system: keep its global data coordinate
 * - otherwise: anchor to its first already-laid-out neighbor, using the new
 *   system's global x relative to that anchor to pick left/right, then spiral
 *   outward to find the first free grid slot
 */
export function computeNewNodePosition(
  newId: string,
  stored: LayoutPositions,
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  effectiveLockedIds: string[],
): LayoutPosition {
  const sysMap = new Map(systems.map(s => [s.id, s]));
  const sys = sysMap.get(newId);

  if (sys && effectiveLockedIds.includes(newId)) {
    return { x: sys.position.x, y: sys.position.y };
  }

  const neighborIds = connections
    .filter(c => c.source === newId || c.target === newId)
    .map(c => (c.source === newId ? c.target : c.source));

  const anchored = neighborIds.filter(id => stored[id]);

  let anchor: LayoutPosition;
  let direction: 1 | -1;

  if (anchored.length > 0) {
    const anchorId = anchored[0];
    const anchorSys = sysMap.get(anchorId);
    anchor = stored[anchorId];
    direction = anchorSys && sys && sys.position.x >= anchorSys.position.x ? 1 : -1;
  } else if (sys) {
    // Isolated system (no laid-out neighbor): keep its data coordinate, which
    // is where the user right-clicked when manually adding it.
    return { x: sys.position.x, y: sys.position.y };
  } else {
    anchor = defaultAnchor(stored);
    direction = 1;
  }

  // Spiral outward from the anchor, preferring the chosen direction first.
  const offsets: LayoutPosition[] = [
    { x: direction * SPACING_X, y: 0 },
    { x: 0, y: SPACING_Y },
    { x: 0, y: -SPACING_Y },
    { x: direction * 2 * SPACING_X, y: 0 },
    { x: direction * SPACING_X, y: SPACING_Y },
    { x: direction * SPACING_X, y: -SPACING_Y },
    { x: direction * 2 * SPACING_X, y: SPACING_Y },
    { x: direction * 2 * SPACING_X, y: -SPACING_Y },
  ];

  for (const off of offsets) {
    const candidate = { x: anchor.x + off.x, y: anchor.y + off.y };
    if (!isOccupied(candidate, stored)) return candidate;
  }

  return { x: anchor.x + direction * SPACING_X, y: anchor.y + SPACING_Y };
}
