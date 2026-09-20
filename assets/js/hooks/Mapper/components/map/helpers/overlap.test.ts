import { Node } from 'reactflow';
import { NODE_H, NODE_W, SPACING_X, SPACING_Y } from './geometry';
import { detectOverlaps, EMPTY_OVERLAPS, sameOverlaps } from './overlap';

const node = (id: string, x: number, y: number, extra: Partial<Node> = {}) =>
  ({ id, position: { x, y }, width: NODE_W, height: NODE_H, ...extra }) as Node;

describe('detectOverlaps', () => {
  it('returns the shared empty map for fewer than two nodes', () => {
    expect(detectOverlaps([])).toBe(EMPTY_OVERLAPS);
    expect(detectOverlaps([node('1', 0, 0)])).toBe(EMPTY_OVERLAPS);
  });

  it('reports nothing for nodes on adjacent grid slots', () => {
    const nodes = [node('1', 0, 0), node('2', SPACING_X, 0), node('3', 0, SPACING_Y)];
    expect(detectOverlaps(nodes)).toBe(EMPTY_OVERLAPS);
  });

  it('does not count shared edges as an overlap', () => {
    // b starts exactly where a ends, both horizontally and vertically.
    expect(detectOverlaps([node('a', 0, 0), node('b', NODE_W, 0)])).toBe(EMPTY_OVERLAPS);
    expect(detectOverlaps([node('a', 0, 0), node('b', 0, NODE_H)])).toBe(EMPTY_OVERLAPS);
  });

  it('detects two nodes stacked on the same position, in both directions', () => {
    const overlaps = detectOverlaps([node('a', 100, 100), node('b', 100, 100)]);

    expect(overlaps.get('a')).toEqual(['b']);
    expect(overlaps.get('b')).toEqual(['a']);
  });

  it('detects a partial overlap', () => {
    const overlaps = detectOverlaps([node('a', 0, 0), node('b', NODE_W - 1, NODE_H - 1)]);
    expect(overlaps.get('a')).toEqual(['b']);
  });

  it('does not report vertical overlap when the boxes are horizontally apart', () => {
    const overlaps = detectOverlaps([node('a', 0, 0), node('b', SPACING_X, NODE_H - 1)]);
    expect(overlaps).toBe(EMPTY_OVERLAPS);
  });

  it('lists every partner of a node that overlaps several others, sorted', () => {
    const overlaps = detectOverlaps([node('c', 0, 0), node('a', 0, 0), node('b', 0, 0)]);

    expect(overlaps.get('a')).toEqual(['b', 'c']);
    expect(overlaps.get('b')).toEqual(['a', 'c']);
    expect(overlaps.get('c')).toEqual(['a', 'b']);
  });

  it('skips hidden nodes in both roles', () => {
    const hiddenFirst = detectOverlaps([node('a', 0, 0, { hidden: true }), node('b', 0, 0)]);
    expect(hiddenFirst).toBe(EMPTY_OVERLAPS);

    const hiddenSecond = detectOverlaps([node('a', 0, 0), node('b', 0, 0, { hidden: true })]);
    expect(hiddenSecond).toBe(EMPTY_OVERLAPS);
  });

  it('finds a pair separated in x by non-overlapping nodes in between', () => {
    // 'far' sits far right but shares no x-range with anything in the middle;
    // the sweep must not stop early because of the correctly-spaced nodes.
    const nodes = [
      node('left', 0, 0),
      node('middle', SPACING_X, 0),
      node('right', SPACING_X * 2, 0),
      node('far', SPACING_X * 2 + NODE_W - 1, 0),
    ];
    const overlaps = detectOverlaps(nodes);

    expect(overlaps.get('right')).toEqual(['far']);
    expect(overlaps.get('left')).toBeUndefined();
    expect(overlaps.get('middle')).toBeUndefined();
  });

  it('is deterministic regardless of input order', () => {
    const a = node('a', 0, 0);
    const b = node('b', 10, 0);
    const c = node('c', SPACING_X, 0);

    expect(detectOverlaps([a, b, c])).toEqual(detectOverlaps([c, b, a]));
  });

  it('falls back to the layout geometry when a node has no explicit size', () => {
    const a = { id: 'a', position: { x: 0, y: 0 } } as Node;
    const b = { id: 'b', position: { x: NODE_W - 1, y: 0 } } as Node;

    expect(detectOverlaps([a, b]).get('a')).toEqual(['b']);
  });
});

describe('sameOverlaps', () => {
  it('treats the same reference as equal', () => {
    expect(sameOverlaps(EMPTY_OVERLAPS, EMPTY_OVERLAPS)).toBe(true);
  });

  it('treats structurally equal maps as equal', () => {
    const a = new Map([['a', ['b']], ['b', ['a']]]);
    const b = new Map([['b', ['a']], ['a', ['b']]]);

    expect(sameOverlaps(a, b)).toBe(true);
  });

  it('detects a different size', () => {
    expect(sameOverlaps(new Map([['a', ['b']]]), EMPTY_OVERLAPS)).toBe(false);
  });

  it('detects a different partner list', () => {
    const a = new Map([['a', ['b', 'c']]]);
    const b = new Map([['a', ['b']]]);

    expect(sameOverlaps(a, b)).toBe(false);
  });

  it('detects the same partner under a different id', () => {
    expect(sameOverlaps(new Map([['a', ['b']]]), new Map([['b', ['b']]]))).toBe(false);
  });

  it('detects a reordered partner list', () => {
    expect(sameOverlaps(new Map([['a', ['b', 'c']]]), new Map([['a', ['c', 'b']]]))).toBe(false);
  });
});
