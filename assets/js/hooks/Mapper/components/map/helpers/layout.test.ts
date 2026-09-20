import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { NODE_H, NODE_W, SPACING_X, SPACING_Y } from './geometry';
import { computeMultiBfsLayout, computeNewNodePosition } from './layout';
import { LayoutPositions } from './geometry';

const sys = (id: string, x = 0, y = 0) => ({ id, position: { x, y } }) as SolarSystemRawType;
const link = (source: string, target: string) => ({ id: `${source}-${target}`, source, target }) as SolarSystemConnection;

/** Every pair of positions that visually collide. */
function collisions(positions: LayoutPositions): string[] {
  const ids = Object.keys(positions).sort();
  const found: string[] = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]];
      const b = positions[ids[j]];
      if (a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H) {
        found.push(`${ids[i]}~${ids[j]}`);
      }
    }
  }

  return found;
}

describe('computeMultiBfsLayout', () => {
  it('returns nothing when no subscribed root is in the map', () => {
    expect(computeMultiBfsLayout(['missing'], [sys('a'), sys('b')], [])).toEqual({});
  });

  it('lays out a single root with its children in one column each', () => {
    const systems = [sys('root'), sys('a'), sys('b')];
    const connections = [link('root', 'a'), link('root', 'b')];

    const positions = computeMultiBfsLayout(['root'], systems, connections);

    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'root']);
    expect(collisions(positions)).toEqual([]);
  });

  it('places two unconnected roots side by side without overlap', () => {
    const systems = [sys('r1'), sys('a'), sys('r2'), sys('b')];
    const connections = [link('r1', 'a'), link('r2', 'b')];

    const positions = computeMultiBfsLayout(['r1', 'r2'], systems, connections);

    expect(collisions(positions)).toEqual([]);
    // Packed left to right, so neither root column shares an x.
    expect(positions.r1.x).not.toBe(positions.r2.x);
  });

  it('does not push a subtree onto a pinned cluster that occupies its slot', () => {
    // 'stray' is visible but reachable from no subscribed root: it is pinned
    // where it is, and the root's subtree has to go around it.
    const systems = [sys('root', 0, 0), sys('a', SPACING_X, 0), sys('stray', 0, 0)];
    const connections = [link('root', 'a')];
    const currentLayout = { stray: { x: 0, y: 0 } };

    const positions = computeMultiBfsLayout(['root'], systems, connections, currentLayout);

    expect(positions.stray).toEqual({ x: 0, y: 0 });
    expect(collisions(positions)).toEqual([]);
  });

  it('shifts the subtree when a pinned cluster sits on its child column', () => {
    // The pinned system occupies exactly where the root's child would go, which
    // is the case the old packing walked straight into.
    const currentLayout = { stray: { x: SPACING_X, y: 0 } };
    const systems = [sys('root', 0, 0), sys('a', SPACING_X, 0), sys('stray', 0, 0)];

    const positions = computeMultiBfsLayout(['root'], systems, [link('root', 'a')], currentLayout);

    expect(positions.stray).toEqual({ x: SPACING_X, y: 0 });
    expect(collisions(positions)).toEqual([]);
  });

  it('keeps every node clear when several pinned clusters crowd the area', () => {
    const systems = [sys('root', 0, 0), sys('a', SPACING_X, 0)];
    const connections = [link('root', 'a')];
    const currentLayout: LayoutPositions = {};
    for (let i = 0; i < 6; i++) {
      currentLayout[`stray-${i}`] = { x: i * SPACING_X, y: 0 };
    }
    systems.push(...Object.keys(currentLayout).map(id => sys(id)));

    const positions = computeMultiBfsLayout(['root'], systems, connections, currentLayout);

    expect(collisions(positions)).toEqual([]);
    for (const id of Object.keys(currentLayout)) {
      expect(positions[id]).toEqual(currentLayout[id]);
    }
  });

  it('pins unreached systems at their current layout position, not their data position', () => {
    const systems = [sys('root'), sys('stray', 9999, 9999)];
    const positions = computeMultiBfsLayout(['root'], systems, [], { stray: { x: 10, y: 20 } });

    expect(positions.stray).toEqual({ x: 10, y: 20 });
  });

  it('is deterministic no matter what order the roots arrive in', () => {
    const systems = [sys('r1'), sys('a'), sys('r2'), sys('b')];
    const connections = [link('r1', 'a'), link('r2', 'b')];

    expect(computeMultiBfsLayout(['r2', 'r1'], systems, connections)).toEqual(
      computeMultiBfsLayout(['r1', 'r2'], systems, connections),
    );
  });
});

describe('computeNewNodePosition', () => {
  it('places a connected system one column from its laid-out neighbour', () => {
    const stored = { anchor: { x: 100, y: 200 } };
    const systems = [sys('anchor', 0, 0), sys('fresh', 500, 0)];

    const pos = computeNewNodePosition('fresh', stored, systems, [link('anchor', 'fresh')]);

    expect(pos).toEqual({ x: 100 + SPACING_X, y: 200 });
  });

  it('puts the new system on the left when it sits left of its anchor globally', () => {
    const stored = { anchor: { x: 100, y: 200 } };
    const systems = [sys('anchor', 500, 0), sys('fresh', 0, 0)];

    const pos = computeNewNodePosition('fresh', stored, systems, [link('anchor', 'fresh')]);

    expect(pos).toEqual({ x: 100 - SPACING_X, y: 200 });
  });

  it('nudges instead of stacking when the neighbour column is taken', () => {
    const stored = { anchor: { x: 0, y: 0 }, taken: { x: SPACING_X, y: 0 } };
    const systems = [sys('anchor'), sys('taken'), sys('fresh', 500, 0)];

    const pos = computeNewNodePosition('fresh', stored, systems, [link('anchor', 'fresh')]);

    expect(pos).not.toEqual({ x: SPACING_X, y: 0 });
    expect(pos).toEqual({ x: SPACING_X, y: -SPACING_Y });
  });

  it('keeps a manually placed isolated system where it was dropped', () => {
    const stored = { anchor: { x: 0, y: 0 } };
    const systems = [sys('anchor'), sys('fresh', 300, 400)];

    const pos = computeNewNodePosition('fresh', stored, systems, []);

    expect(pos).toEqual({ x: 300, y: 400 });
  });

  it('pulls an isolated system back to the cluster when its data coordinate is far away', () => {
    // This is the far-away placement bug: the backend put the system on its own
    // grid, screens from this user's local layout.
    const stored = { a: { x: 0, y: 0 }, b: { x: SPACING_X, y: 0 } };
    const systems = [sys('a'), sys('b'), sys('fresh', 20000, 20000)];

    const pos = computeNewNodePosition('fresh', stored, systems, []);

    const clusterCentre = { x: Math.round(SPACING_X / 2), y: 0 };
    expect(Math.max(Math.abs(pos.x - clusterCentre.x), Math.abs(pos.y - clusterCentre.y))).toBeLessThanOrEqual(
      2 * SPACING_X,
    );
  });

  it('never returns a slot that overlaps an existing node', () => {
    const stored: LayoutPositions = {};
    for (let i = 0; i < 5; i++) stored[`n${i}`] = { x: i * SPACING_X, y: 0 };

    const systems = Object.keys(stored).map(id => sys(id));
    systems.push(sys('fresh', 2 * SPACING_X, 0));

    const pos = computeNewNodePosition('fresh', stored, systems, []);

    for (const id of Object.keys(stored)) {
      const other = stored[id];
      const overlaps =
        pos.x < other.x + NODE_W && other.x < pos.x + NODE_W && pos.y < other.y + NODE_H && other.y < pos.y + NODE_H;
      expect(overlaps).toBe(false);
    }
  });

  it('honours the occupancy index it is given', () => {
    const stored = { anchor: { x: 0, y: 0 } };
    const systems = [sys('anchor'), sys('fresh', 500, 0)];
    const connections = [link('anchor', 'fresh')];

    const withoutBlocker = computeNewNodePosition('fresh', stored, systems, connections);

    // Pass an occupancy that already has the ideal slot taken.
    const occ = {
      cellW: SPACING_X,
      cellH: SPACING_Y,
      cells: new Map([[`1,0`, new Map([['blocker', withoutBlocker]])]]),
      itemCell: new Map([['blocker', `1,0`]]),
    };

    const pos = computeNewNodePosition('fresh', stored, systems, connections, occ);

    expect(pos).not.toEqual(withoutBlocker);
  });
});
