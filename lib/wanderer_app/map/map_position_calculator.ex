defmodule WandererApp.Map.PositionCalculator do
  @moduledoc """
  The R-tree bounding box of a map system.

  This module used to also own "where does a newly-added system go", by walking a
  ring of candidates outward from a start point until the R-tree reported a slot
  as free. That approach could not keep a node near the system it connects to:
  the anchor branch measured depth from the map's home system (screens away from
  the anchor the user was looking at), and the no-anchor branch started from
  `x = 0` on a fresh row below everything, so each isolated system landed one row
  further down than the last.

  Placement now lives in `WandererApp.Map.Server.SystemsImpl` and uses
  `WandererApp.Map.Layout.Occupancy` against the live system list, so this module
  is down to the geometry the R-tree is fed with.
  """

  alias WandererApp.Map.Layout.Geometry

  def get_system_bounding_rect(%{position_x: x, position_y: y} = _system) do
    Geometry.bounding_rect(x, y)
  end

  def get_system_bounding_rect(_system), do: [{0, 0}, {0, 0}]
end
