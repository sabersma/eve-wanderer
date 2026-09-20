import { LayoutPosition, LayoutPositions, NODE_H, NODE_W, SPACING_X, SPACING_Y } from './geometry';

/**
 * Spatial index for "is this slot free?" questions, used by every path that
 * places or moves a node (auto-add, re-arrange, manual move).
 *
 * Positions are bucketed into SPACING_X x SPACING_Y cells. Because a cell is at
 * least as large as a node, any node that can intersect the query box must sit
 * in the 3x3 block of cells around the query's own cell — so a lookup is a
 * constant nine cell visits instead of a scan over every node. See
 * {@link assertCellCoversNode} for the invariant that makes this safe.
 */
export interface Occupancy {
  cellW: number;
  cellH: number;
  /** cell key -> (system id -> position) */
  cells: Map<string, Map<string, LayoutPosition>>;
  /** system id -> the cell it is filed under */
  itemCell: Map<string, string>;
}

export interface BoxSize {
  w: number;
  h: number;
}

interface QueryOptions {
  /** Ids to leave out of the test — e.g. the node being re-placed itself. */
  ignoreIds?: ReadonlySet<string>;
  /** Footprint to test. Defaults to a system node. */
  size?: BoxSize;
}

const DEFAULT_SIZE: BoxSize = { w: NODE_W, h: NODE_H };

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;

const cellOf = (v: number, cell: number) => Math.floor(v / cell);

/**
 * The 3x3 lookup is only sound while a cell is at least as large as both the
 * stored and the queried box. Guards against a future tweak to the geometry
 * constants silently turning this into a wrong answer.
 */
const assertCellCoversNode = (cellW: number, cellH: number, size: BoxSize) => {
  if (cellW < size.w || cellH < size.h) {
    throw new Error(
      `Occupancy cell (${cellW}x${cellH}) is smaller than the node box (${size.w}x${size.h}); ` +
        `the 3x3 neighbourhood lookup assumes cell >= node.`,
    );
  }
};

export function createOccupancy(cellW: number = SPACING_X, cellH: number = SPACING_Y): Occupancy {
  return { cellW, cellH, cells: new Map(), itemCell: new Map() };
}

/** Add (or move) an item. Claiming an id that is already present relocates it. */
export function claim(occ: Occupancy, id: string, pos: LayoutPosition): void {
  release(occ, id);

  const key = cellKey(cellOf(pos.x, occ.cellW), cellOf(pos.y, occ.cellH));
  let cell = occ.cells.get(key);
  if (!cell) {
    cell = new Map();
    occ.cells.set(key, cell);
  }

  cell.set(id, pos);
  occ.itemCell.set(id, key);
}

export function release(occ: Occupancy, id: string): void {
  const key = occ.itemCell.get(id);
  if (key === undefined) return;

  const cell = occ.cells.get(key);
  if (cell) {
    cell.delete(id);
    if (cell.size === 0) occ.cells.delete(key);
  }
  occ.itemCell.delete(id);
}

const overlaps = (a: LayoutPosition, aSize: BoxSize, b: LayoutPosition, bSize: BoxSize) =>
  a.x < b.x + bSize.w && b.x < a.x + aSize.w && a.y < b.y + bSize.h && b.y < a.y + aSize.h;

/**
 * Ids of the items whose box intersects the given box. Same footprint rules as
 * {@link detectOverlaps}: real rectangle intersection, touching edges allowed.
 */
export function collidesWith(occ: Occupancy, x: number, y: number, opts: QueryOptions = {}): string[] {
  const size = opts.size ?? DEFAULT_SIZE;
  assertCellCoversNode(occ.cellW, occ.cellH, size);

  const candidate: LayoutPosition = { x, y };
  const cx = cellOf(x, occ.cellW);
  const cy = cellOf(y, occ.cellH);
  const found: string[] = [];

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cell = occ.cells.get(cellKey(cx + dx, cy + dy));
      if (!cell) continue;

      for (const [id, pos] of cell) {
        if (opts.ignoreIds?.has(id)) continue;
        if (overlaps(candidate, size, pos, DEFAULT_SIZE)) found.push(id);
      }
    }
  }

  return found;
}

export function isFree(occ: Occupancy, x: number, y: number, opts: QueryOptions = {}): boolean {
  return collidesWith(occ, x, y, opts).length === 0;
}

/** Index the given positions, optionally skipping ids that must not block. */
export function occupancyOfPositions(
  positions: LayoutPositions,
  ignoreIds?: ReadonlySet<string>,
  cellW: number = SPACING_X,
  cellH: number = SPACING_Y,
): Occupancy {
  const occ = createOccupancy(cellW, cellH);

  for (const id of Object.keys(positions)) {
    if (ignoreIds?.has(id)) continue;
    claim(occ, id, positions[id]);
  }

  return occ;
}

/**
 * Index currently rendered nodes. Hidden nodes are skipped: they are not on
 * screen, so placing a new node next to one would look like the layout avoided
 * nothing at all.
 */
export function occupancyOfNodes(
  nodes: { id: string; position: LayoutPosition; hidden?: boolean }[],
  ignoreIds?: ReadonlySet<string>,
  cellW: number = SPACING_X,
  cellH: number = SPACING_Y,
): Occupancy {
  const occ = createOccupancy(cellW, cellH);

  for (const n of nodes) {
    if (n.hidden || ignoreIds?.has(n.id)) continue;
    claim(occ, n.id, n.position);
  }

  return occ;
}

// ---------------------------------------------------------------------------
// Slot search
// ---------------------------------------------------------------------------

interface Offset {
  dx: number;
  dy: number;
}

const offsetCache = new Map<string, Offset[]>();

/**
 * Search order around a desired slot, in grid steps.
 *
 * Ordering is fully deterministic (no randomness, no reliance on map iteration
 * order) so the same layout always produces the same result:
 *   1. closest first (Manhattan distance),
 *   2. straight up/down before sideways — a vertical nudge keeps the node in its
 *      column, which is what makes a rearranged tree still readable,
 *   3. the caller's preferred side,
 *   4. a stable dx/dy tiebreak.
 */
function offsetsFor(maxRadius: number, prefer: number): Offset[] {
  const key = `${maxRadius}:${prefer}`;
  const cached = offsetCache.get(key);
  if (cached) return cached;

  const list: Offset[] = [];
  for (let dx = -maxRadius; dx <= maxRadius; dx++) {
    for (let dy = -maxRadius; dy <= maxRadius; dy++) {
      if (Math.abs(dx) + Math.abs(dy) <= maxRadius) list.push({ dx, dy });
    }
  }

  list.sort((a, b) => {
    const distA = Math.abs(a.dx) + Math.abs(a.dy);
    const distB = Math.abs(b.dx) + Math.abs(b.dy);
    if (distA !== distB) return distA - distB;

    const colA = a.dx === 0 ? 0 : 1;
    const colB = b.dx === 0 ? 0 : 1;
    if (colA !== colB) return colA - colB;

    if (prefer !== 0) {
      const sideA = Math.sign(a.dx) === prefer ? 0 : 1;
      const sideB = Math.sign(b.dx) === prefer ? 0 : 1;
      if (sideA !== sideB) return sideA - sideB;
    }

    return a.dx - b.dx || a.dy - b.dy;
  });

  offsetCache.set(key, list);
  return list;
}

export interface FindFreeSlotOptions extends QueryOptions {
  /**
   * Horizontal side to try first. Only breaks ties between slots at the same
   * distance that are both off-column, so it never overrides the closer-first
   * and same-column-first rules above.
   */
  prefer?: number;
  /** Grid steps to search in each direction. 8 -> about one screen. */
  maxRadius?: number;
}

export interface FreeSlotResult {
  position: LayoutPosition;
  /** False when the search ran out of radius and fell back to the overflow slot. */
  ok: boolean;
}

/**
 * Nearest free slot to `desired`.
 *
 * Candidates are offset from `desired` in whole grid steps and never snapped to
 * an absolute grid: a subscription layout is anchored at a data coordinate, so
 * snapping to global multiples of SPACING would visibly misalign the new node
 * from its neighbours. Only the *relative* spacing matters.
 *
 * Returns `ok: false` together with a deterministic overflow slot when the whole
 * search radius is occupied — callers should surface that rather than silently
 * stacking nodes, but they still need a position so the invariant that every
 * system has coordinates holds.
 */
export function findFreeSlot(
  occ: Occupancy,
  desired: LayoutPosition,
  opts: FindFreeSlotOptions = {},
): FreeSlotResult {
  const { prefer = 0, maxRadius = 8, ...query } = opts;
  const offsets = offsetsFor(maxRadius, prefer);

  for (const { dx, dy } of offsets) {
    const x = desired.x + dx * SPACING_X;
    const y = desired.y + dy * SPACING_Y;
    if (isFree(occ, x, y, query)) return { position: { x, y }, ok: true };
  }

  // Deterministic overflow: one step past the searched area on the preferred
  // side, so repeated calls stay stable.
  const step = prefer === 0 ? 1 : Math.sign(prefer);
  return {
    position: { x: desired.x + step * (maxRadius + 1) * SPACING_X, y: desired.y },
    ok: false,
  };
}

export interface FindFreeXOffsetOptions {
  stepX?: number;
  maxSteps?: number;
  ignoreIds?: ReadonlySet<string>;
}

export interface FreeXOffsetResult {
  /** Translation to add to every x in the block. */
  offsetX: number;
  /** False when the whole search range collided; `offsetX` is then one step past it. */
  ok: boolean;
}

/**
 * Find the first horizontal translation that lets the whole `block` (a root's
 * freshly computed subtree) sit clear of everything already placed.
 *
 * `baseShiftX` is the translation that would put the block where you want it
 * (usually `cursorX - leftmost block x`); the result is that translation, or a
 * larger one that clears the occupancy. Translating as a unit is what keeps a
 * subtree's internal shape intact while it dodges occupied territory.
 */
export function findFreeXOffset(
  occ: Occupancy,
  block: LayoutPositions,
  baseShiftX: number,
  opts: FindFreeXOffsetOptions = {},
): FreeXOffsetResult {
  const { stepX = SPACING_X, maxSteps = 32, ignoreIds } = opts;
  const ids = Object.keys(block);

  if (ids.length === 0) return { offsetX: baseShiftX, ok: true };

  const fits = (shift: number) =>
    ids.every(id => isFree(occ, block[id].x + shift, block[id].y, { ignoreIds }));

  for (let step = 0; step <= maxSteps; step++) {
    const shift = baseShiftX + step * stepX;
    if (fits(shift)) return { offsetX: shift, ok: true };
  }

  // Deterministic overflow, one step past everything searched, so the caller
  // gets a well-defined position and a clear signal that it did not fit.
  return { offsetX: baseShiftX + (maxSteps + 1) * stepX, ok: false };
}

/** The box a whole block occupies, used to advance the packing cursor. */
export function blockExtent(positions: LayoutPositions): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;

  for (const id of Object.keys(positions)) {
    minX = Math.min(minX, positions[id].x);
    maxX = Math.max(maxX, positions[id].x);
  }

  return { minX: Number.isFinite(minX) ? minX : 0, maxX: Number.isFinite(maxX) ? maxX : 0 };
}
