defmodule WandererApp.Map.Layout.Occupancy do
  @moduledoc """
  Spatial index answering "is this slot free?" for every backend path that
  places or moves a system: auto-add on a character jump, manual add, and
  re-arrange.

  Mirrors `assets/js/hooks/Mapper/components/map/helpers/occupancy.ts`, so the
  two layers place nodes by the same rules and can be tested with the same
  fixtures.

  Positions are bucketed into `spacing_x` x `spacing_y` cells. Because a cell is
  at least as large as a node, any node that can overlap the query box must sit
  in the 3x3 block of cells around the query's own cell, which makes a lookup
  nine cell visits instead of a scan over every system. Nodes are matched by
  real rectangle intersection (see `WandererApp.Map.Layout.Geometry.overlaps?/2`),
  never by exact coordinate equality — a node dragged onto a 15px grid snap is
  still overlapping.
  """

  alias WandererApp.Map.Layout.Geometry

  @cell_w Geometry.spacing_x()
  @cell_h Geometry.spacing_y()

  @default_radius 8
  @default_max_steps 32

  # Grid steps the slot search walks, in the order it walks them. Precomputed at
  # compile time (a comprehension and an anonymous sort are both allowed in a
  # module attribute; a local function call is not).
  #
  # The order is fully deterministic — no randomness, no reliance on map
  # iteration order — so the same occupancy always produces the same layout:
  #   1. closest first (Manhattan distance),
  #   2. straight up/down before sideways, which keeps a nudged node in its own
  #      column and the tree still readable,
  #   3. a stable dx/dy tiebreak.
  #
  # There is no "preferred side" tiebreak on this side of the wire: callers
  # choose the side by where they put the desired slot, and rule 2 already makes
  # that column the first one tried.
  @offsets_raw for dx <- -@default_radius..@default_radius,
                 dy <- -@default_radius..@default_radius,
                 abs(dx) + abs(dy) <= @default_radius,
                 do: {dx, dy}

  @offsets Enum.sort_by(@offsets_raw, fn {dx, dy} ->
             {abs(dx) + abs(dy), if(dx == 0, do: 0, else: 1), dx, dy}
           end)

  @type position :: {integer(), integer()}
  @type id :: integer() | String.t()

  @type t :: %__MODULE__{
          cell_w: pos_integer(),
          cell_h: pos_integer(),
          cells: %{{integer(), integer()} => %{id() => position()}},
          item_cell: %{id() => {integer(), integer()}}
        }

  defstruct cell_w: @cell_w, cell_h: @cell_h, cells: %{}, item_cell: %{}

  @doc "An empty index. Cell size is only overridden in tests."
  def new(cell_w \\ @cell_w, cell_h \\ @cell_h) do
    if cell_w < Geometry.node_w() or cell_h < Geometry.node_h() do
      raise ArgumentError,
            "occupancy cell (#{cell_w}x#{cell_h}) is smaller than the node box " <>
              "(#{Geometry.node_w()}x#{Geometry.node_h()}); the 3x3 neighbourhood lookup assumes cell >= node"
    end

    %__MODULE__{cell_w: cell_w, cell_h: cell_h}
  end

  # ---------------------------------------------------------------------------
  # Index maintenance
  # ---------------------------------------------------------------------------

  @doc "Add an item, or move one that is already indexed."
  def claim(%__MODULE__{} = occ, id, {x, y}) do
    occ = release(occ, id)
    key = {cell_of(x, occ.cell_w), cell_of(y, occ.cell_h)}

    cells = Map.update(occ.cells, key, %{id => {x, y}}, fn cell -> Map.put(cell, id, {x, y}) end)

    %{occ | cells: cells, item_cell: Map.put(occ.item_cell, id, key)}
  end

  def release(%__MODULE__{} = occ, id) do
    case Map.pop(occ.item_cell, id) do
      {nil, _item_cell} ->
        occ

      {key, item_cell} ->
        cells =
          case Map.get(occ.cells, key) do
            nil ->
              occ.cells

            cell ->
              case Map.delete(cell, id) do
                empty when map_size(empty) == 0 -> Map.delete(occ.cells, key)
                remaining -> Map.put(occ.cells, key, remaining)
              end
          end

        %{occ | cells: cells, item_cell: item_cell}
    end
  end

  @doc """
  Index a list of positions (`%{solar_system_id => {x, y}}`), optionally leaving
  out ids that must not block the search.
  """
  def from_positions(positions, ignore_ids \\ MapSet.new()) do
    Enum.reduce(positions, new(), fn {id, {x, y}}, occ ->
      if MapSet.member?(ignore_ids, id), do: occ, else: claim(occ, id, {x, y})
    end)
  end

  @doc """
  Index systems (structs or maps carrying `:solar_system_id`, `:position_x` and
  `:position_y`). Systems without coordinates are skipped rather than defaulted
  to the origin, which would block a slot nobody occupies.

  Hidden systems are indexed too: they still hold their slot and the R-tree
  keeps blocking it until the cleanup task removes them, so leaving them out
  here would let a new node land on one and overlap the moment it is un-hidden.
  """
  def from_systems(systems, ignore_ids \\ MapSet.new()) do
    Enum.reduce(systems, new(), fn system, occ ->
      id = Map.get(system, :solar_system_id)
      x = Map.get(system, :position_x)
      y = Map.get(system, :position_y)

      cond do
        is_nil(id) or is_nil(x) or is_nil(y) -> occ
        MapSet.member?(ignore_ids, id) -> occ
        true -> claim(occ, id, {x, y})
      end
    end)
  end

  # ---------------------------------------------------------------------------
  # Queries
  # ---------------------------------------------------------------------------

  @doc """
  Ids of every indexed item whose box overlaps a node placed at `{x, y}`.

  Options: `:ignore_ids` (a `MapSet`).
  """
  def collides_with(%__MODULE__{} = occ, {x, y}, opts \\ []) do
    ignore = Keyword.get(opts, :ignore_ids, MapSet.new())
    cx = cell_of(x, occ.cell_w)
    cy = cell_of(y, occ.cell_h)

    for dx <- -1..1,
        dy <- -1..1,
        {id, pos} <- Map.get(occ.cells, {cx + dx, cy + dy}, %{}),
        not MapSet.member?(ignore, id),
        Geometry.overlaps?({x, y}, pos),
        do: id
  end

  def free?(%__MODULE__{} = occ, {x, y}, opts \\ []),
    do: collides_with(occ, {x, y}, opts) == []

  # ---------------------------------------------------------------------------
  # Slot search
  # ---------------------------------------------------------------------------

  @doc """
  Nearest free slot to `desired`.

  Candidates are offset from `desired` in whole grid steps and are never snapped
  to an absolute grid: a layout is anchored wherever the map's nodes happen to
  be, so snapping to global multiples of the spacing would visibly misalign a
  new node from its neighbours. Only the *relative* spacing matters.

  Returns `{position, :ok}`, or `{position, :exhausted}` with a deterministic
  slot one step past the searched area when the whole radius is taken — callers
  must still get a position (every system needs coordinates) but should treat
  `:exhausted` as something worth logging.

  Options: `:max_radius`, `:ignore_ids`.
  """
  def find_free_slot(%__MODULE__{} = occ, {x, y}, opts \\ []) do
    radius = Keyword.get(opts, :max_radius, @default_radius)

    found =
      Enum.find_value(offsets(radius), fn {dx, dy} ->
        candidate = {x + dx * Geometry.spacing_x(), y + dy * Geometry.spacing_y()}
        if free?(occ, candidate, opts), do: candidate
      end)

    case found do
      nil -> {{x + (radius + 1) * Geometry.spacing_x(), y}, :exhausted}
      position -> {position, :ok}
    end
  end

  @doc """
  First horizontal translation that lets the whole `block` sit clear of the
  occupancy.

  `base_shift_x` is the translation that would put the block where you want it;
  the result is that translation, or a larger one that clears the index.
  Translating the block as a unit is what keeps a subtree's shape intact while
  it dodges occupied territory.

  Returns `{offset_x, :ok}` or `{offset_x, :exhausted}` with the offset one step
  past the searched range.
  """
  def find_free_x_offset(%__MODULE__{} = occ, block, base_shift_x, opts \\ []) do
    step_x = Keyword.get(opts, :step_x, Geometry.spacing_x())
    max_steps = Keyword.get(opts, :max_steps, @default_max_steps)
    ignore_ids = Keyword.get(opts, :ignore_ids, MapSet.new())
    query_opts = [ignore_ids: ignore_ids]

    if map_size(block) == 0 do
      {base_shift_x, :ok}
    else
      found =
        Enum.find(0..max_steps, fn step ->
          shift = base_shift_x + step * step_x

          Enum.all?(block, fn {_id, {x, y}} -> free?(occ, {x + shift, y}, query_opts) end)
        end)

      case found do
        nil -> {base_shift_x + (max_steps + 1) * step_x, :exhausted}
        step -> {base_shift_x + step * step_x, :ok}
      end
    end
  end

  @doc "The horizontal span of a block, used to advance the packing cursor."
  def block_extent(block) do
    case Enum.reduce(block, {nil, nil}, fn {_id, {x, _y}}, {min_x, max_x} ->
           {if(is_nil(min_x), do: x, else: min(min_x, x)),
            if(is_nil(max_x), do: x, else: max(max_x, x))}
         end) do
      {nil, nil} -> {0, 0}
      extent -> extent
    end
  end

  # ---------------------------------------------------------------------------
  # Internals
  # ---------------------------------------------------------------------------

  defp cell_of(value, cell), do: Integer.floor_div(value, cell)

  # Only a non-default radius pays for rebuilding the order; no production
  # caller uses one.
  defp offsets(radius) when radius == @default_radius, do: @offsets

  defp offsets(radius) do
    Enum.sort_by(
      for(dx <- -radius..radius,
          dy <- -radius..radius,
          abs(dx) + abs(dy) <= radius,
          do: {dx, dy}),
      fn {dx, dy} -> {abs(dx) + abs(dy), if(dx == 0, do: 0, else: 1), dx, dy} end
    )
  end
end
