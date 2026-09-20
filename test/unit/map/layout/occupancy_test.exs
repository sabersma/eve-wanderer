defmodule WandererApp.Map.Layout.OccupancyTest do
  use ExUnit.Case, async: true

  alias WandererApp.Map.Layout.Geometry
  alias WandererApp.Map.Layout.Occupancy

  @spacing_x Geometry.spacing_x()
  @spacing_y Geometry.spacing_y()

  describe "claim/3 and release/2" do
    test "a claimed slot is taken and a fresh one is free" do
      occ = Occupancy.claim(Occupancy.new(), "a", {0, 0})

      refute Occupancy.free?(occ, {0, 0})
      assert Occupancy.free?(occ, {@spacing_x, 0})
    end

    test "a neighbour one grid step away in either axis is free" do
      occ = Occupancy.claim(Occupancy.new(), "a", {0, 0})

      assert Occupancy.free?(occ, {@spacing_x, 0})
      assert Occupancy.free?(occ, {0, @spacing_y})
      assert Occupancy.free?(occ, {@spacing_x, @spacing_y})
    end

    test "an id can be re-claimed at a new position" do
      occ =
        Occupancy.new()
        |> Occupancy.claim("a", {0, 0})
        |> Occupancy.claim("a", {@spacing_x, @spacing_y})

      assert Occupancy.free?(occ, {0, 0})
      refute Occupancy.free?(occ, {@spacing_x, @spacing_y})
      assert Occupancy.collides_with(occ, {@spacing_x, @spacing_y}) == ["a"]
    end

    test "release frees the slot and tolerates an unknown id" do
      occ =
        Occupancy.new()
        |> Occupancy.claim("a", {0, 0})
        |> Occupancy.release("a")
        |> Occupancy.release("never-claimed")

      assert Occupancy.free?(occ, {0, 0})
    end

    test "an id claimed before the origin is found" do
      occ = Occupancy.claim(Occupancy.new(), "negative", {-3 * @spacing_x, -3 * @spacing_y})

      refute Occupancy.free?(occ, {-3 * @spacing_x, -3 * @spacing_y})
      assert Occupancy.free?(occ, {-2 * @spacing_x, -3 * @spacing_y})
    end
  end

  describe "3x3 neighbourhood completeness" do
    # The lookup only visits the cells around the query's own cell, so these pin
    # down the boundary: an occupant in the NEXT cell that still reaches back
    # into the query must be found, and one a cell further out cannot overlap at
    # all.

    test "finds an occupant in the next cell right that reaches back" do
      occ = Occupancy.claim(Occupancy.new(), "next-cell", {@spacing_x, 0})

      # Query sits at the end of its cell so it reaches into the next one, where
      # the occupant starts exactly on the cell boundary.
      assert Occupancy.collides_with(occ, {@spacing_x - Geometry.node_w() + 1, 0}) == ["next-cell"]
    end

    test "finds an occupant in the previous cell left that reaches forward" do
      occ = Occupancy.claim(Occupancy.new(), "prev-cell", {-Geometry.node_w() + 1, 0})

      assert Occupancy.collides_with(occ, {0, 0}) == ["prev-cell"]
    end

    test "finds an occupant in the neighbouring row below" do
      # Query at y = spacing - 1 is still in row 0; the occupant starts on row 1
      # and overlaps the query's footprint.
      occ = Occupancy.claim(Occupancy.new(), "below", {0, @spacing_y})

      assert Occupancy.collides_with(occ, {0, @spacing_y - 1}) == ["below"]
    end

    test "does not report an occupant whose cell is out of reach" do
      occ = Occupancy.claim(Occupancy.new(), "right", {@spacing_x + Geometry.node_w(), 0})

      assert Occupancy.collides_with(occ, {0, 0}) == []
    end

    test "refuses a cell smaller than a node" do
      assert_raise ArgumentError, ~r/smaller than the node box/, fn ->
        Occupancy.new(Geometry.node_w() - 1, Geometry.node_h() - 1)
      end
    end
  end

  describe "collides_with/3 options" do
    test "skips ignored ids" do
      occ = Occupancy.claim(Occupancy.new(), "self", {0, 0})
      ignore = MapSet.new(["self"])

      assert Occupancy.collides_with(occ, {0, 0}, ignore_ids: ignore) == []
      assert Occupancy.free?(occ, {0, 0}, ignore_ids: ignore)
    end

    test "reports every colliding id" do
      occ =
        Occupancy.new()
        |> Occupancy.claim("a", {0, 0})
        |> Occupancy.claim("b", {0, 0})

      assert Enum.sort(Occupancy.collides_with(occ, {0, 0})) == ["a", "b"]
    end
  end

  describe "from_positions/2 and from_systems/2" do
    test "indexes every position" do
      occ = Occupancy.from_positions(%{"a" => {0, 0}, "b" => {@spacing_x, 0}})

      refute Occupancy.free?(occ, {0, 0})
      refute Occupancy.free?(occ, {@spacing_x, 0})
      assert Occupancy.free?(occ, {2 * @spacing_x, 0})
    end

    test "omits ignored ids" do
      occ = Occupancy.from_positions(%{"a" => {0, 0}, "b" => {@spacing_x, 0}}, MapSet.new(["a"]))

      assert Occupancy.free?(occ, {0, 0})
      refute Occupancy.free?(occ, {@spacing_x, 0})
    end

    test "indexes systems and skips ones without coordinates" do
      systems = [
        %{solar_system_id: 1, position_x: 0, position_y: 0},
        %{solar_system_id: 2, position_x: nil, position_y: nil},
        %{solar_system_id: 3, position_x: @spacing_x, position_y: 0}
      ]

      occ = Occupancy.from_systems(systems)

      refute Occupancy.free?(occ, {0, 0})
      refute Occupancy.free?(occ, {@spacing_x, 0})
      assert Occupancy.free?(occ, {2 * @spacing_x, 0})
    end

    test "keeps hidden systems indexed so an unhidden node cannot stack" do
      # The R-tree still blocks a hidden system's slot until cleanup runs, so
      # leaving it out here would let a new node land on top of it.
      systems = [%{solar_system_id: 1, position_x: 0, position_y: 0, visible: false}]

      refute Occupancy.free?(Occupancy.from_systems(systems), {0, 0})
    end
  end

  describe "find_free_slot/3" do
    test "returns the desired slot untouched when it is free" do
      {position, status} = Occupancy.find_free_slot(Occupancy.new(), {2 * @spacing_x, 3 * @spacing_y})

      assert status == :ok
      assert position == {2 * @spacing_x, 3 * @spacing_y}
    end

    test "nudges the same column before moving sideways" do
      occ = Occupancy.claim(Occupancy.new(), "taken", {0, 0})

      assert {position, :ok} = Occupancy.find_free_slot(occ, {0, 0})
      # (0,-1) precedes (0,1) in the deterministic order.
      assert position == {0, -@spacing_y}
    end

    test "prefers the desired column, then the other side, then further out" do
      occ =
        Occupancy.new()
        |> Occupancy.claim("centre", {0, 0})
        |> Occupancy.claim("up", {0, -@spacing_y})
        |> Occupancy.claim("down", {0, @spacing_y})

      assert {position, :ok} = Occupancy.find_free_slot(occ, {0, 0})
      # Both vertical neighbours are taken, so it steps to one side rather than
      # jumping two rows up.
      assert position == {-@spacing_x, 0}
    end

    test "is deterministic across calls with the same occupancy" do
      occ =
        Occupancy.new()
        |> Occupancy.claim("a", {0, 0})
        |> Occupancy.claim("b", {@spacing_x, 0})

      assert Occupancy.find_free_slot(occ, {0, 0}) == Occupancy.find_free_slot(occ, {0, 0})
    end

    test "is idempotent: claiming the result makes the next search pick elsewhere" do
      occ = Occupancy.claim(Occupancy.new(), "a", {0, 0})

      {first, :ok} = Occupancy.find_free_slot(occ, {0, 0})
      second_occ = Occupancy.claim(occ, "b", first)
      {second, :ok} = Occupancy.find_free_slot(second_occ, {0, 0})

      assert second != first
      assert Occupancy.free?(second_occ, second)
    end

    test "keeps an off-grid desired slot as-is rather than snapping it" do
      # A layout is anchored wherever the map's nodes are, so snapping to
      # absolute grid multiples would misalign the new node from its neighbours.
      desired = {2 * @spacing_x + 7, 3 * @spacing_y - 4}

      assert {^desired, :ok} = Occupancy.find_free_slot(Occupancy.new(), desired)
    end

    test "keeps off-grid neighbours evenly spaced when it has to move" do
      desired = {2 * @spacing_x + 7, 3 * @spacing_y - 4}
      occ = Occupancy.claim(Occupancy.new(), "taken", desired)

      assert {position, :ok} = Occupancy.find_free_slot(occ, desired)
      assert position == {2 * @spacing_x + 7, 2 * @spacing_y - 4}
    end

    test "honours ignored ids" do
      occ = Occupancy.claim(Occupancy.new(), "self", {0, 0})

      assert {{0, 0}, :ok} =
               Occupancy.find_free_slot(occ, {0, 0}, ignore_ids: MapSet.new(["self"]))
    end

    test "stays within about one screen of the desired slot" do
      {position, :ok} = Occupancy.find_free_slot(Occupancy.new(), {0, 0})

      assert position == {0, 0}
      # An occupied neighbourhood is what makes the radius matter.
      occ = Enum.reduce(0..20, Occupancy.new(), fn i, acc -> Occupancy.claim(acc, i, {i * 5, 0}) end)
      {position, _status} = Occupancy.find_free_slot(occ, {0, 0})
      assert position != {0, 0}
    end

    test "reports failure with a deterministic overflow slot when the area is full" do
      occ = Occupancy.claim(Occupancy.new(), "taken", {0, 0})

      assert {position, :exhausted} = Occupancy.find_free_slot(occ, {0, 0}, max_radius: 0)
      assert position == {@spacing_x, 0}
    end
  end

  describe "find_free_x_offset/4" do
    # `base_shift_x` is the translation that would place the block where wanted;
    # the result is that shift, or a larger one that clears the occupancy.

    test "keeps the requested shift when nothing is in the way" do
      block = %{"a" => {0, 0}, "b" => {@spacing_x, 0}}

      assert {offset, :ok} = Occupancy.find_free_x_offset(Occupancy.new(), block, 4 * @spacing_x)
      assert offset == 4 * @spacing_x
    end

    test "translates the whole block past an occupant, preserving its shape" do
      occ = Occupancy.claim(Occupancy.new(), "blocker", {4 * @spacing_x, 0})
      block = %{"a" => {0, 0}, "b" => {@spacing_x, 0}}

      assert {offset, :ok} = Occupancy.find_free_x_offset(occ, block, 4 * @spacing_x)
      assert offset == 5 * @spacing_x
      # Shape preserved: b stays exactly one column right of a.
      assert block["a"] |> elem(0) |> Kernel.+(offset) == 5 * @spacing_x
      assert block["b"] |> elem(0) |> Kernel.+(offset) == 6 * @spacing_x
    end

    test "reports failure one step past the search range" do
      occ =
        Enum.reduce(0..3, Occupancy.new(), fn i, acc ->
          Occupancy.claim(acc, "filler-#{i}", {(4 + i) * @spacing_x, 0})
        end)

      assert {offset, :exhausted} =
               Occupancy.find_free_x_offset(occ, %{"a" => {0, 0}}, 4 * @spacing_x, max_steps: 3)

      assert offset == 8 * @spacing_x
    end

    test "ignores the ids the caller excludes" do
      occ = Occupancy.claim(Occupancy.new(), "blocker", {4 * @spacing_x, 0})

      assert {offset, :ok} =
               Occupancy.find_free_x_offset(occ, %{"a" => {0, 0}}, 4 * @spacing_x,
                 ignore_ids: MapSet.new(["blocker"])
               )

      assert offset == 4 * @spacing_x
    end

    test "accepts an empty block at the requested shift" do
      assert {offset, :ok} = Occupancy.find_free_x_offset(Occupancy.new(), %{}, 2 * @spacing_x)
      assert offset == 2 * @spacing_x
    end
  end

  describe "block_extent/1" do
    test "returns the horizontal span of a block" do
      assert Occupancy.block_extent(%{"a" => {0, 0}, "b" => {3 * @spacing_x, 0}}) ==
               {0, 3 * @spacing_x}
    end

    test "returns a zero span for an empty block" do
      assert Occupancy.block_extent(%{}) == {0, 0}
    end
  end

  describe "Geometry.overlaps?/2" do
    test "touching edges are adjacent, not stacked" do
      refute Geometry.overlaps?({0, 0}, {@spacing_x, 0})
      refute Geometry.overlaps?({0, 0}, {0, @spacing_y})
    end

    test "any real intersection counts" do
      assert Geometry.overlaps?({0, 0}, {Geometry.node_w() - 1, 0})
      assert Geometry.overlaps?({0, 0}, {0, Geometry.node_h() - 1})
      assert Geometry.overlaps?({0, 0}, {0, 0})
    end
  end
end
