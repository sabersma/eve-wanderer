/**
 * Shared node geometry for map layout and collision checks.
 *
 * A system node renders as a NODE_W x NODE_H box; the layout spacing adds a
 * margin so two neighbouring nodes stay visually separated. `SPACING_*` is the
 * layout grid pitch, `NODE_*` is the real footprint used for collision tests.
 *
 * NOTE: these values are mirrored on the backend in
 * `lib/wanderer_app/map/map_position_calculator.ex` — keep both in sync.
 */
export const NODE_W = 130;
export const NODE_H = 34;
export const MARGIN_X = 50;
export const MARGIN_Y = 41;

export const SPACING_X = NODE_W + MARGIN_X;
export const SPACING_Y = NODE_H + MARGIN_Y;

export interface LayoutPosition {
  x: number;
  y: number;
}

export type LayoutPositions = Record<string, LayoutPosition>;
