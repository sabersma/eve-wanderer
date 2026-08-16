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
  const branchRoot = new Map<string, string>();

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

      // Branch root: a direct child of home is its own branch; descendants inherit.
      branchRoot.set(nb, curDepth === 0 ? nb : branchRoot.get(cur) ?? nb);

      queue.push(nb);
    }
  }

  const positions: LayoutPositions = {
    [homeId]: { x: home.position.x, y: home.position.y },
  };

  // Group non-home, non-locked systems into branches by {direction, branchRoot}
  const grouped = new Map<string, string[]>();
  const rightBranches: string[][] = [];
  const leftBranches: string[][] = [];

  for (const sid of depth.keys()) {
    if (sid === homeId || lockedSet.has(sid)) continue;
    const dir = direction.get(sid) ?? 1;
    const branch = branchRoot.get(sid) ?? sid;
    const key = `${dir}:${branch}`;

    if (!grouped.has(key)) {
      const list: string[] = [];
      grouped.set(key, list);
      (dir === 1 ? rightBranches : leftBranches).push(list);
    }
    grouped.get(key)!.push(sid);
  }

  const sortBranch = (sids: string[]) => sids[0];
  rightBranches.sort((a, b) => (sortBranch(a) < sortBranch(b) ? -1 : 1));
  leftBranches.sort((a, b) => (sortBranch(a) < sortBranch(b) ? -1 : 1));

  layoutSide(positions, { x: home.position.x, y: home.position.y }, 1, rightBranches, depth, parent);
  layoutSide(positions, { x: home.position.x, y: home.position.y }, -1, leftBranches, depth, parent);

  // Effective-locked systems keep their original (global) position
  for (const sid of effectiveLockedIds) {
    const s = sysMap.get(sid);
    if (s) positions[sid] = { x: s.position.x, y: s.position.y };
  }

  // Isolated systems (no connections) keep their current position (the
  // user-dragged location) instead of being forced back to their data
  // coordinate, which may be a global rearrange layout.
  const connectedIds = new Set<string>();
  for (const c of connections) {
    connectedIds.add(c.source);
    connectedIds.add(c.target);
  }
  for (const s of systems) {
    if (positions[s.id]) continue;
    if (connectedIds.has(s.id)) continue;
    positions[s.id] = currentLayout?.[s.id] ?? { x: s.position.x, y: s.position.y };
  }

  return positions;
}

/**
 * Lay out multiple subscribed "roots" in one view. Each root's connected
 * subtree is laid out with {@link computeBfsLayout} (single-root) and the
 * subtrees are placed side-by-side horizontally so they never overlap.
 */
export function computeMultiBfsLayout(
  homeIds: string[],
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  currentLayout?: LayoutPositions,
): LayoutPositions {
  const sysMap = new Map(systems.map(s => [s.id, s]));
  const roots = homeIds.filter(id => sysMap.has(id));
  if (roots.length === 0) return {};

  // Build undirected adjacency list + multi-source BFS to assign each system
  // to the root that reaches it first.
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const c of connections) {
    addEdge(c.source, c.target);
    addEdge(c.target, c.source);
  }

  const rootOf = new Map<string, string>();
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const r of roots) {
    rootOf.set(r, r);
    visited.add(r);
    queue.push(r);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      rootOf.set(nb, rootOf.get(cur)!);
      queue.push(nb);
    }
  }

  const positions: LayoutPositions = {};
  let xCursor = 0;

  roots.forEach(rootId => {
    const subtreeIds = new Set(systems.filter(s => rootOf.get(s.id) === rootId).map(s => s.id));
    const subtreeSystems = systems.filter(s => subtreeIds.has(s.id));
    const subtreeConns = connections.filter(c => subtreeIds.has(c.source) && subtreeIds.has(c.target));

    const tree = computeBfsLayout(rootId, subtreeSystems, subtreeConns, [], currentLayout);

    let minX = Infinity;
    let maxX = -Infinity;
    for (const sid of Object.keys(tree)) {
      minX = Math.min(minX, tree[sid].x);
      maxX = Math.max(maxX, tree[sid].x);
    }
    const width = maxX === -Infinity ? 0 : maxX - minX;

    for (const sid of Object.keys(tree)) {
      positions[sid] = { x: tree[sid].x - minX + xCursor, y: tree[sid].y };
    }
    xCursor += width + MARGIN_X * 4;
  });

  // Systems not reached by any subscribed root (the user's own character's
  // separate cluster, or isolated systems) keep their current/data position.
  for (const s of systems) {
    if (positions[s.id]) continue;
    positions[s.id] = currentLayout?.[s.id] ?? { x: s.position.x, y: s.position.y };
  }

  return positions;
}

/**
 * Lay out the branches on one side (left or right) of home. Each branch gets
 * its own vertical region (branch isolation), so multiple branches do not
 * overlap. Mirrors the backend rearrange_systems branch-isolation logic.
 */
function layoutSide(
  positions: LayoutPositions,
  homePos: LayoutPosition,
  dir: number,
  branches: string[][],
  depth: Map<string, number>,
  parent: Map<string, string>,
) {
  if (branches.length === 0) return;

  // Branch height = max nodes at any single depth * spacing_y + margin
  const branchHeights = branches.map(sids => {
    const byDepth = new Map<number, number>();
    for (const sid of sids) {
      const d = depth.get(sid)!;
      byDepth.set(d, (byDepth.get(d) ?? 0) + 1);
    }
    const maxPerDepth = Math.max(...byDepth.values(), 1);
    return maxPerDepth * SPACING_Y + MARGIN_Y;
  });

  const totalHeight = branchHeights.reduce((a, b) => a + b, 0);
  let baseY = homePos.y - totalHeight / 2;

  branches.forEach((sids, idx) => {
    const branchHeight = branchHeights[idx];
    const branchCenterY = baseY + branchHeight / 2;

    // Group this branch's systems by depth (columns)
    const byDepth = new Map<number, string[]>();
    for (const sid of sids) {
      const d = depth.get(sid)!;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(sid);
    }
    const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b);

    for (const d of sortedDepths) {
      const sidsAtDepth = byDepth.get(d)!;

      // Depth-1 nodes are children of home (which is not inside this branch),
      // so they anchor to the branch's own vertical center instead of home.y.
      const parentYOf = (sid: string) =>
        d === 1 ? branchCenterY : positions[parent.get(sid)!]?.y ?? branchCenterY;

      sidsAtDepth.sort((a, b) => parentYOf(a) - parentYOf(b));

      const usedY = new Set<number>();
      for (const sid of sidsAtDepth) {
        const y = findClosestY(parentYOf(sid), usedY, SPACING_Y);
        const x = homePos.x + dir * d * SPACING_X;
        positions[sid] = { x, y };
        usedY.add(y);
      }
    }

    baseY += branchHeight;
  });
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
): LayoutPosition {
  const sysMap = new Map(systems.map(s => [s.id, s]));
  const sys = sysMap.get(newId);

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
