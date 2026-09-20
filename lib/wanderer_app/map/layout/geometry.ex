defmodule WandererApp.Map.Layout.Geometry do
  @moduledoc """
  Node geometry shared by every path that places or moves a system on a map.

  Mirrors `assets/js/hooks/Mapper/components/map/helpers/geometry.ts`. The
  frontend and the backend have to agree on the node footprint: a position the
  backend calls free must not render on top of another node.
  """

  # Node size
  @node_w 130
  @node_h 34
  # Gap kept between two nodes
  @margin_x 50
  @margin_y 41

  @spacing_x @node_w + @margin_x
  @spacing_y @node_h + @margin_y

  def node_w, do: @node_w
  def node_h, do: @node_h
  def margin_x, do: @margin_x
  def margin_y, do: @margin_y

  @doc "Horizontal distance between two adjacent columns."
  def spacing_x, do: @spacing_x

  @doc "Vertical distance between two adjacent rows."
  def spacing_y, do: @spacing_y

  @doc """
  Bounding box of a node whose top-left corner sits at `{x, y}`.

  Shaped for the R-tree (`[{x_min, x_max}, {y_min, y_max}]`), so this is what
  `WandererApp.Map.PositionCalculator.get_system_bounding_rect/1` returns.
  """
  def bounding_rect(x, y), do: [{x, x + @node_w}, {y, y + @node_h}]

  @doc """
  True when the two node boxes overlap.

  Touching edges do not count: two nodes placed exactly one spacing apart are
  adjacent, not stacked.
  """
  def overlaps?({ax, ay}, {bx, by}),
    do: ax < bx + @node_w and bx < ax + @node_w and ay < by + @node_h and by < ay + @node_h
end
