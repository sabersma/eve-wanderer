import { NODE_H, NODE_W, SPACING_X, SPACING_Y } from './geometry';
import {
  blockExtent,
  claim,
  collidesWith,
  createOccupancy,
  findFreeSlot,
  findFreeXOffset,
  isFree,
  occupancyOfNodes,
  occupancyOfPositions,
  release,
} from './occupancy';

const at = (x: number, y: number) => ({ x, y });

describe('Occupancy', () => {
  describe('claim / release', () => {
    it('reports a claimed slot as taken and a fresh one as free', () => {
      const occ = createOccupancy();
      claim(occ, 'a', at(0, 0));

      expect(isFree(occ, 0, 0)).toBe(false);
      expect(isFree(occ, SPACING_X, 0)).toBe(true);
    });

    it('treats a neighbour one grid step away in either axis as free', () => {
      const occ = createOccupancy();
      claim(occ, 'a', at(0, 0));

      expect(isFree(occ, SPACING_X, 0)).toBe(true);
      expect(isFree(occ, 0, SPACING_Y)).toBe(true);
      expect(isFree(occ, SPACING_X, SPACING_Y)).toBe(true);
    });

    it('lets an id be re-claimed at a new position', () => {
      const occ = createOccupancy();
      claim(occ, 'a', at(0, 0));
      claim(occ, 'a', at(SPACING_X, SPACING_Y));

      expect(isFree(occ, 0, 0)).toBe(true);
      expect(isFree(occ, SPACING_X, SPACING_Y)).toBe(false);
      expect(collidesWith(occ, SPACING_X, SPACING_Y)).toEqual(['a']);
    });

    it('frees the cell on release and tolerates releasing an unknown id', () => {
      const occ = createOccupancy();
      claim(occ, 'a', at(0, 0));
      release(occ, 'a');
      release(occ, 'never-claimed');

      expect(isFree(occ, 0, 0)).toBe(true);
    });

    it('finds a claim whose cell lies before the origin', () => {
      const occ = createOccupancy();
      claim(occ, 'negative', at(-SPACING_X * 3, -SPACING_Y * 3));

      expect(isFree(occ, -SPACING_X * 3, -SPACING_Y * 3)).toBe(false);
      expect(isFree(occ, -SPACING_X * 2, -SPACING_Y * 3)).toBe(true);
    });
  });

  describe('3x3 neighbourhood completeness', () => {
    // The lookup only visits the cells around the query's own cell, so these
    // pin down the boundary: an occupant in the NEXT cell that still reaches
    // back into the query must be found, and one a cell further out cannot
    // intersect at all.

    it('finds an occupant in the next cell right that reaches back', () => {
      const occ = createOccupancy();
      // Query sits at the end of its cell (x=51 in cell 0) so it reaches into
      // cell 1, where the occupant starts exactly on the cell boundary.
      claim(occ, 'next-cell', at(SPACING_X, 0));

      expect(collidesWith(occ, SPACING_X - NODE_W + 1, 0)).toEqual(['next-cell']);
    });

    it('finds an occupant in the previous cell left that reaches forward', () => {
      const occ = createOccupancy();
      claim(occ, 'prev-cell', at(-NODE_W + 1, 0));

      expect(collidesWith(occ, 0, 0)).toEqual(['prev-cell']);
    });

    it('finds an occupant in the neighbouring row below', () => {
      const occ = createOccupancy();
      // Query at y=74 is still in row 0; the occupant starts on row 1 at y=75
      // and overlaps the query's 34px footprint.
      claim(occ, 'below', at(0, SPACING_Y));

      expect(collidesWith(occ, 0, SPACING_Y - 1)).toEqual(['below']);
    });

    it('does not report an occupant whose cell is out of reach', () => {
      const occ = createOccupancy();
      claim(occ, 'right', at(SPACING_X + NODE_W, 0));

      expect(collidesWith(occ, 0, 0)).toEqual([]);
    });

    it('throws when a cell is smaller than a node', () => {
      const occ = createOccupancy(NODE_W - 1, NODE_H - 1);
      claim(occ, 'a', at(0, 0));

      expect(() => isFree(occ, 0, 0)).toThrow();
    });
  });

  describe('collidesWith options', () => {
    it('skips ignored ids', () => {
      const occ = createOccupancy();
      claim(occ, 'self', at(0, 0));

      expect(collidesWith(occ, 0, 0, { ignoreIds: new Set(['self']) })).toEqual([]);
      expect(isFree(occ, 0, 0, { ignoreIds: new Set(['self']) })).toBe(true);
    });

    it('reports every colliding id', () => {
      const occ = createOccupancy();
      claim(occ, 'a', at(0, 0));
      claim(occ, 'b', at(0, 0));

      expect(collidesWith(occ, 0, 0).sort()).toEqual(['a', 'b']);
    });
  });

  describe('occupancyOfPositions / occupancyOfNodes', () => {
    it('indexes every position', () => {
      const occ = occupancyOfPositions({ a: at(0, 0), b: at(SPACING_X, 0) });

      expect(isFree(occ, 0, 0)).toBe(false);
      expect(isFree(occ, SPACING_X, 0)).toBe(false);
      expect(isFree(occ, SPACING_X * 2, 0)).toBe(true);
    });

    it('omits ignored ids', () => {
      const occ = occupancyOfPositions({ a: at(0, 0), b: at(SPACING_X, 0) }, new Set(['a']));

      expect(isFree(occ, 0, 0)).toBe(true);
      expect(isFree(occ, SPACING_X, 0)).toBe(false);
    });

    it('omits hidden nodes but keeps visible ones', () => {
      const occ = occupancyOfNodes([
        { id: 'hidden', position: at(0, 0), hidden: true },
        { id: 'shown', position: at(SPACING_X, 0) },
      ]);

      expect(isFree(occ, 0, 0)).toBe(true);
      expect(isFree(occ, SPACING_X, 0)).toBe(false);
    });
  });

  describe('findFreeSlot', () => {
    it('returns the desired slot untouched when it is free', () => {
      const occ = createOccupancy();
      const result = findFreeSlot(occ, at(SPACING_X * 2, SPACING_Y * 3));

      expect(result.ok).toBe(true);
      expect(result.position).toEqual(at(SPACING_X * 2, SPACING_Y * 3));
    });

    it('nudges the same column before moving sideways', () => {
      const occ = createOccupancy();
      claim(occ, 'taken', at(0, 0));

      const result = findFreeSlot(occ, at(0, 0));

      expect(result.ok).toBe(true);
      // (0,-1) precedes (0,1) in the deterministic order.
      expect(result.position).toEqual(at(0, -SPACING_Y));
    });

    it('prefers the requested side once the column is blocked too', () => {
      const occ = createOccupancy();
      claim(occ, 'centre', at(0, 0));
      claim(occ, 'up', at(0, -SPACING_Y));
      claim(occ, 'down', at(0, SPACING_Y));

      expect(findFreeSlot(occ, at(0, 0), { prefer: -1 }).position).toEqual(at(-SPACING_X, 0));
      expect(findFreeSlot(occ, at(0, 0), { prefer: 1 }).position).toEqual(at(SPACING_X, 0));
    });

    it('falls back to the other side when the preferred one is taken', () => {
      const occ = createOccupancy();
      claim(occ, 'centre', at(0, 0));
      claim(occ, 'up', at(0, -SPACING_Y));
      claim(occ, 'down', at(0, SPACING_Y));
      claim(occ, 'right', at(SPACING_X, 0));

      const result = findFreeSlot(occ, at(0, 0), { prefer: 1 });

      expect(result.ok).toBe(true);
      expect(result.position).toEqual(at(-SPACING_X, 0));
    });

    it('is deterministic across calls with the same occupancy', () => {
      const occ = createOccupancy();
      claim(occ, 'a', at(0, 0));
      claim(occ, 'b', at(SPACING_X, 0));

      const first = findFreeSlot(occ, at(0, 0));
      const second = findFreeSlot(occ, at(0, 0));

      expect(first.position).toEqual(second.position);
    });

    it('is idempotent: claiming the result makes the next search pick elsewhere', () => {
      const occ = createOccupancy();
      claim(occ, 'a', at(0, 0));

      const first = findFreeSlot(occ, at(0, 0));
      claim(occ, 'b', first.position);
      const second = findFreeSlot(occ, at(0, 0));

      expect(second.position).not.toEqual(first.position);
      expect(isFree(occ, second.position.x, second.position.y)).toBe(true);
    });

    it('search radius stays within about one screen', () => {
      const occ = createOccupancy();
      const result = findFreeSlot(occ, at(0, 0), { maxRadius: 8 });

      expect(result.position.x).toBeGreaterThanOrEqual(-8 * SPACING_X);
      expect(result.position.x).toBeLessThanOrEqual(8 * SPACING_X);
      expect(result.position.y).toBeGreaterThanOrEqual(-8 * SPACING_Y);
      expect(result.position.y).toBeLessThanOrEqual(8 * SPACING_Y);
    });

    it('keeps an off-grid desired slot as-is rather than snapping it', () => {
      const occ = createOccupancy();
      // A subscription layout is anchored at a data coordinate, so snapping to
      // absolute grid multiples would misalign the node from its neighbours.
      const desired = at(SPACING_X * 2 + 7, SPACING_Y * 3 - 4);

      expect(findFreeSlot(occ, desired).position).toEqual(desired);
    });

    it('keeps off-grid neighbours evenly spaced when it has to move', () => {
      const occ = createOccupancy();
      const desired = at(SPACING_X * 2 + 7, SPACING_Y * 3 - 4);
      claim(occ, 'taken', desired);

      const result = findFreeSlot(occ, desired);

      expect(result.ok).toBe(true);
      expect(result.position).toEqual(at(SPACING_X * 2 + 7, SPACING_Y * 2 - 4));
    });

    it('honours ignored ids', () => {
      const occ = createOccupancy();
      claim(occ, 'self', at(0, 0));

      const result = findFreeSlot(occ, at(0, 0), { ignoreIds: new Set(['self']) });

      expect(result.position).toEqual(at(0, 0));
    });

    it('reports failure with a deterministic overflow slot when the area is full', () => {
      const occ = createOccupancy();
      claim(occ, 'taken', at(0, 0));

      const result = findFreeSlot(occ, at(0, 0), { maxRadius: 0, prefer: 1 });

      expect(result.ok).toBe(false);
      expect(result.position).toEqual(at(SPACING_X, 0));
    });
  });

  describe('findFreeXOffset', () => {
    // `baseShiftX` is the translation that would place the block where wanted;
    // the result is that shift, or a larger one that clears the occupancy.
    it('keeps the requested shift when nothing is in the way', () => {
      const occ = createOccupancy();
      const block = { a: at(0, 0), b: at(SPACING_X, 0) };

      const result = findFreeXOffset(occ, block, SPACING_X * 4);

      expect(result.ok).toBe(true);
      expect(result.offsetX).toBe(SPACING_X * 4);
    });

    it('translates the whole block past an occupant, preserving its shape', () => {
      const occ = createOccupancy();
      claim(occ, 'blocker', at(SPACING_X * 4, 0));

      const block = { a: at(0, 0), b: at(SPACING_X, 0) };
      const result = findFreeXOffset(occ, block, SPACING_X * 4);

      expect(result.ok).toBe(true);
      expect(result.offsetX).toBe(SPACING_X * 5);
      // Shape preserved: b stays exactly one column right of a.
      expect(block.a.x + result.offsetX).toBe(SPACING_X * 5);
      expect(block.b.x + result.offsetX).toBe(SPACING_X * 6);
    });

    it('reports failure one step past the search range', () => {
      const occ = createOccupancy();
      for (let i = 0; i <= 3; i++) claim(occ, `filler-${i}`, at(SPACING_X * (4 + i), 0));

      const block = { a: at(0, 0) };
      const result = findFreeXOffset(occ, block, SPACING_X * 4, { maxSteps: 3 });

      expect(result.ok).toBe(false);
      expect(result.offsetX).toBe(SPACING_X * 8);
    });

    it('ignores the ids the caller excludes', () => {
      const occ = createOccupancy();
      claim(occ, 'blocker', at(SPACING_X * 4, 0));

      const block = { a: at(0, 0) };
      const result = findFreeXOffset(occ, block, SPACING_X * 4, { ignoreIds: new Set(['blocker']) });

      expect(result.ok).toBe(true);
      expect(result.offsetX).toBe(SPACING_X * 4);
    });

    it('accepts an empty block at the requested shift', () => {
      const occ = createOccupancy();
      const result = findFreeXOffset(occ, {}, SPACING_X * 2);

      expect(result.ok).toBe(true);
      expect(result.offsetX).toBe(SPACING_X * 2);
    });
  });

  describe('blockExtent', () => {
    it('returns the horizontal span of a block', () => {
      expect(blockExtent({ a: at(0, 0), b: at(SPACING_X * 3, 0) })).toEqual({ minX: 0, maxX: SPACING_X * 3 });
    });

    it('returns a zero span for an empty block', () => {
      expect(blockExtent({})).toEqual({ minX: 0, maxX: 0 });
    });
  });
});
