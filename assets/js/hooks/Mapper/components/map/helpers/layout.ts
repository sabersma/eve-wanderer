import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { MARGIN_Y, SPACING_X, SPACING_Y } from './geometry';
import type { LayoutPosition, LayoutPositions } from './geometry';
import {
  Occupancy,
  blockExtent,
  claim,
  findFreeSlot,
  findFreeXOffset,
  isFree,
  occupancyOfPositions,
} from './occupancy';

export { MARGIN_X, MARGIN_Y, NODE_H, NODE_W, SPACING_X, SPACING_Y } from './geometry';
export type { LayoutPosition, LayoutPositions } from './geometry';

/** Grid steps searched when looking for a free slot (8 -> about one screen). */
const MAX_SLOT_RADIUS = 8;

/**
 * How far a system's data coordinate may sit from the nearest laid-out node
 * before we treat it as "placed by the backend at some unrelated spot" instead
 * of "where the user put it". 1200 flow px is roughly one screen, i.e. about
 * seven columns.
 */
const MAX_ANCHOR_DIST = 1200;

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
 * Lay out multiple subscribed "roots" in one view.
 *
 * Each root's connected subtree is laid out with {@link computeBfsLayout}
 * (single-root), then packed left to right. Packing is collision-aware in three
 * passes, so a subtree never lands on top of anything else on screen:
 *
 *   1. the systems reachable from no subscribed root (the user's own character's
 *      separate cluster, isolated additions) are pinned where they already are
 *      and claimed into an occupancy index;
 *   2. each subtree is translated as a whole until it clears that index;
 *   3. any individual node still colliding is nudged to the nearest free slot —
 *      this also covers collisions *inside* a subtree, which `layoutSide` can
 *      produce when its band-height estimate is too small.
 */
export function computeMultiBfsLayout(
  homeIds: string[],
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  currentLayout?: LayoutPositions,
): LayoutPositions {
  const sysMap = new Map(systems.map(s => [s.id, s]));
  // Sorted so the packing order (and therefore the result) never depends on the
  // order the subscription ids happened to arrive in.
  const roots = homeIds.filter(id => sysMap.has(id)).sort();
  if (roots.length === 0) return {};

  // Build undirected adjacency list + multi-source BFS to assign each system
  // to the root that reaches it first. Neighbours are sorted so an ambiguous
  // system (reachable at equal depth from two roots) is claimed deterministically.
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const c of connections) {
    addEdge(c.source, c.target);
    addEdge(c.target, c.source);
  }
  for (const list of adj.values()) list.sort();

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

  // Pass 1: pin everything no subscribed root can reach.
  const positions: LayoutPositions = {};
  for (const s of systems) {
    if (rootOf.has(s.id)) continue;
    positions[s.id] = currentLayout?.[s.id] ?? { x: s.position.x, y: s.position.y };
  }

  const occ = occupancyOfPositions(positions);

  // Pass 2 + 3: pack each root's subtree clear, then place it node by node.
  let xCursor = 0;

  for (const rootId of roots) {
    const subtreeIds = new Set(systems.filter(s => rootOf.get(s.id) === rootId).map(s => s.id));
    const subtreeSystems = systems.filter(s => subtreeIds.has(s.id));
    const subtreeConns = connections.filter(c => subtreeIds.has(c.source) && subtreeIds.has(c.target));

    const tree = computeBfsLayout(rootId, subtreeSystems, subtreeConns, [], currentLayout);
    const treeIds = Object.keys(tree);
    if (treeIds.length === 0) continue;

    let extent = blockExtent(tree);
    let shift = xCursor - extent.minX;
    let placed = findFreeXOffset(occ, tree, shift);

    if (!placed.ok) {
      // The horizontal band is full. Drop the subtree below everything placed
      // so far and try once more; the space underneath is empty by construction.
      const dropY = maxY(positions) + SPACING_Y - minY(tree);
      for (const id of treeIds) tree[id] = { x: tree[id].x, y: tree[id].y + dropY };

      extent = blockExtent(tree);
      shift = xCursor - extent.minX;
      placed = findFreeXOffset(occ, tree, shift);
    }

    // Column by column, top to bottom: deterministic, and it keeps each column
    // coherent by letting an upper node pick its slot before a lower one.
    const ordered = [...treeIds].sort((a, b) => {
      const pa = tree[a];
      const pb = tree[b];
      return pa.x - pb.x || pa.y - pb.y || (a < b ? -1 : 1);
    });

    let maxPlacedX = -Infinity;

    for (const id of ordered) {
      const desired = { x: tree[id].x + placed.offsetX, y: tree[id].y };
      const slot = isFree(occ, desired.x, desired.y)
        ? { position: desired, ok: true }
        : findFreeSlot(occ, desired, { maxRadius: MAX_SLOT_RADIUS });

      positions[id] = slot.position;
      claim(occ, id, slot.position);
      maxPlacedX = Math.max(maxPlacedX, slot.position.x);
    }

    xCursor = maxPlacedX === -Infinity ? xCursor : maxPlacedX + SPACING_X;
  }

  return positions;
}

function maxY(positions: LayoutPositions): number {
  let result = -Infinity;
  for (const id of Object.keys(positions)) result = Math.max(result, positions[id].y);
  return Number.isFinite(result) ? result : 0;
}

function minY(positions: LayoutPositions): number {
  let result = Infinity;
  for (const id of Object.keys(positions)) result = Math.min(result, positions[id].y);
  return Number.isFinite(result) ? result : 0;
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

/**
 * Where an unanchored system should go: near `sys`'s data coordinate when that
 * coordinate is believable, otherwise beside the laid-out cluster.
 *
 * The data coordinate is believable when the nearest laid-out node is within
 * {@link MAX_ANCHOR_DIST} — that covers a system the user dropped near the
 * cluster. Beyond that distance it is the backend's own placement (its grid is
 * unrelated to this user's local layout), and honouring it is exactly what put
 * nodes screens away from everything else. In that case the cluster centroid is
 * used, so the node lands at the edge of the cluster instead.
 */
function unanchoredTarget(sys: SolarSystemRawType | undefined, stored: LayoutPositions): LayoutPosition {
  const ids = Object.keys(stored);

  if (ids.length === 0) {
    return sys ? { x: sys.position.x, y: sys.position.y } : { x: 0, y: 0 };
  }

  if (sys) {
    let nearest: LayoutPosition | null = null;
    let nearestDist = Infinity;

    for (const id of ids) {
      const pos = stored[id];
      const dist = Math.max(Math.abs(pos.x - sys.position.x), Math.abs(pos.y - sys.position.y));
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = pos;
      }
    }

    if (nearest && nearestDist <= MAX_ANCHOR_DIST) return { x: sys.position.x, y: sys.position.y };
  }

  // Centroid of the laid-out cluster. Summed in a sorted id order so the result
  // does not depend on key iteration order.
  let sumX = 0;
  let sumY = 0;
  for (const id of [...ids].sort()) {
    sumX += stored[id].x;
    sumY += stored[id].y;
  }
  return { x: Math.round(sumX / ids.length), y: Math.round(sumY / ids.length) };
}

/**
 * Compute a position for a newly-added system on top of an existing cached
 * layout, WITHOUT recomputing the whole tree.
 *
 * - a system with an already-laid-out neighbour goes in the column on the side
 *   it sits on globally, one grid step out;
 * - one without is placed near {@link unanchoredTarget} instead of blindly at
 *   its data coordinate;
 * - either way the nearest free slot is used, so a new node never lands on top
 *   of an existing one.
 *
 * `occ` can be passed in when the caller is placing several systems in one
 * batch, so the index is built once instead of per system.
 */
export function computeNewNodePosition(
  newId: string,
  stored: LayoutPositions,
  systems: SolarSystemRawType[],
  connections: SolarSystemConnection[],
  occ?: Occupancy,
): LayoutPosition {
  const sysMap = new Map(systems.map(s => [s.id, s]));
  const sys = sysMap.get(newId);

  const occupancy = occ ?? occupancyOfPositions(stored, new Set([newId]));

  const neighborIds = connections
    .filter(c => c.source === newId || c.target === newId)
    .map(c => (c.source === newId ? c.target : c.source))
    .sort();

  const anchorId = neighborIds.find(id => stored[id]);

  if (anchorId) {
    const anchor = stored[anchorId];
    const anchorSys = sysMap.get(anchorId);
    const direction = anchorSys && sys && sys.position.x >= anchorSys.position.x ? 1 : -1;

    return findFreeSlot(
      occupancy,
      { x: anchor.x + direction * SPACING_X, y: anchor.y },
      { prefer: direction, maxRadius: MAX_SLOT_RADIUS },
    ).position;
  }

  return findFreeSlot(occupancy, unanchoredTarget(sys, stored), { maxRadius: MAX_SLOT_RADIUS }).position;
}
