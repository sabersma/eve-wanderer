defmodule WandererApp.Map.Layout.PlacementTest do
  use ExUnit.Case, async: true

  alias WandererApp.Map.Layout.Geometry
  alias WandererApp.Map.Layout.Placement

  @spacing_x Geometry.spacing_x()
  @spacing_y Geometry.spacing_y()

  # One screen, the bound placement is specified in. A new node must never be
  # further than this from the system the character travelled from.
  @one_screen 900

  defp sys(id, x, y, visible \\ true),
    do: %{solar_system_id: id, position_x: x, position_y: y, visible: visible}

  defp conn(a, b), do: %{solar_system_source: a, solar_system_target: b}

  defp distance({ax, ay}, {bx, by}), do: max(abs(ax - bx), abs(ay - by))

  defp overlaps_anything?(systems, {x, y}, ignore_id) do
    systems
    |> Enum.reject(&(&1.solar_system_id == ignore_id))
    |> Enum.any?(fn s -> Geometry.overlaps?({x, y}, {s.position_x, s.position_y}) end)
  end

  describe "new_position/3 with an anchor" do
    test "lands one grid step from the anchor, on the far side from the map centre" do
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0)]

      # Anchor 1 sits left of the centre, so the new node goes further left.
      assert Placement.new_position(systems, 1, 99) == %{x: -@spacing_x, y: 0}
      # Anchor 2 sits right of the centre, so it goes further right.
      assert Placement.new_position(systems, 2, 99) == %{x: 2 * @spacing_x, y: 0}
    end

    test "stays within one screen of the anchor even when the desired column is taken" do
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0), sys(3, -@spacing_x, 0)]

      position = Placement.new_position(systems, 1, 99)

      assert distance({position.x, position.y}, {0, 0}) <= @one_screen
      refute overlaps_anything?(systems, {position.x, position.y}, 99)
    end

    test "stays in the desired column when the slot there is taken" do
      # The column the anchor points at is occupied, so the node shifts a row
      # within that column rather than crossing to the anchor's other side: the
      # tree stays readable and the node stays adjacent to its anchor.
      right = Enum.map(-4..4, &sys(100 + &1, @spacing_x, &1 * @spacing_y))
      systems = [sys(1, 0, 0), sys(2, -@spacing_x, 0) | right]

      position = Placement.new_position(systems, 1, 99)

      assert position.x == -@spacing_x
      assert position.y != 0
      assert distance({position.x, position.y}, {0, 0}) <= @one_screen
      refute overlaps_anything?(systems, {position.x, position.y}, 99)
    end

    test "reports exhaustion rather than stacking silently when the radius is packed" do
      # The documented boundary of the slot search: it looks at 289 slots (a
      # diamond of radius 8), so it can only fail on a map packed solid that far
      # out. The approved contract is that this is never silent — the caller gets
      # a deterministic slot but logs a warning, and the overlap badge catches it
      # visually. Exhaustion must not be mistaken for a normal placement.
      packed =
        for dx <- -9..9, dy <- -9..9, abs(dx) + abs(dy) <= 9 do
          sys({dx, dy}, dx * @spacing_x, dy * @spacing_y)
        end

      systems = [sys(1, 0, 0) | packed]

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          position = Placement.new_position(systems, 1, 99)
          send(self(), {:position, position})
        end)

      assert_received {:position, position}
      # Deterministic: one step past the searched radius, on the anchor's side.
      assert position == %{x: 10 * @spacing_x, y: 0}
      assert log =~ "No free slot within 8 grid steps"
    end

    test "three consecutive jumps each land within one screen of their own anchor" do
      # The path the character actually walked: each jump is anchored at the
      # system it arrived from, not at the map's home system.
      systems = [sys(1, 0, 0)]

      {systems, distances} =
        Enum.reduce([2, 3, 4], {systems, []}, fn id, {acc, dists} ->
          anchor = List.last(acc)
          position = Placement.new_position(acc, anchor.solar_system_id, id)
          placed = sys(id, position.x, position.y)

          {acc ++ [placed],
           [distance({position.x, position.y}, {anchor.position_x, anchor.position_y}) | dists]}
        end)

      assert Enum.all?(distances, &(&1 <= @one_screen))
      # And the chain really did walk away from home, so this is not a test that
      # passes by standing still.
      assert List.last(systems).position_x == 3 * @spacing_x
    end

    test "anchors on the anchor, not on the map's home system" do
      # Regression for the bug this replaced: the column used to be measured
      # from the map's home system, so a node added next to a system five columns
      # away from home landed next to home instead — screens from the anchor the
      # user was looking at.
      chain = Enum.map(0..5, fn i -> sys(i + 1, i * @spacing_x, 0) end)
      anchor = List.last(chain)

      position = Placement.new_position(chain, anchor.solar_system_id, 99)

      assert distance({position.x, position.y}, {anchor.position_x, anchor.position_y}) <=
               @one_screen

      # Deliberately far from home: proof the placement is anchor-relative.
      assert position.x > @one_screen
    end

    test "ignores a hidden anchor" do
      # A hidden system is not somewhere the user can see the character arrive,
      # so it falls through to the cluster rule rather than anchoring to it.
      systems = [sys(1, 0, 0, false), sys(2, 10 * @spacing_x, 0)]

      position = Placement.new_position(systems, 1, 99)

      assert distance({position.x, position.y}, {10 * @spacing_x, 0}) <= @one_screen
    end
  end

  describe "new_position/3 without an anchor" do
    test "an empty map places the first system at the origin" do
      assert Placement.new_position([], nil, 99) == %{x: 0, y: 0}
    end

    test "lands next to the cluster instead of starting a fresh row far below it" do
      # The reported symptom: isolated systems all took x = 0 on a new row below
      # the lowest system, so five of them ended up in one column with three
      # screens of empty space between.
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0)]

      %{x: x, y: y} = Placement.new_position(systems, nil, 99)

      assert distance({x, y}, {0, 0}) <= @one_screen
      refute overlaps_anything?(systems, {x, y}, 99)
    end

    test "repeated isolated adds stay clustered rather than marching away" do
      systems = Enum.map(1..3, fn i -> sys(i, i * @spacing_x, 0) end)

      {_systems, ys} =
        Enum.reduce(4..8, {systems, []}, fn id, {acc, ys} ->
          %{x: x, y: y} = Placement.new_position(acc, nil, id)

          assert distance({x, y}, {0, 0}) <= @one_screen
          refute overlaps_anything?(acc, {x, y}, id)

          {acc ++ [sys(id, x, y)], [y | ys]}
        end)

      # The whole batch has to fit inside one screen vertically, and must not
      # creep downwards one row per add.
      assert Enum.max(ys) - Enum.min(ys) <= @one_screen
      assert Enum.max(ys) <= @one_screen
    end

    test "never stacks, however crowded the map gets" do
      systems = Enum.map(1..3, fn i -> sys(i, i * @spacing_x, 0) end)

      systems =
        Enum.reduce(4..40, systems, fn id, acc ->
          %{x: x, y: y} = Placement.new_position(acc, nil, id)

          refute overlaps_anything?(acc, {x, y}, id),
                 "system #{id} at {#{x}, #{y}} overlaps an existing node"

          acc ++ [sys(id, x, y)]
        end)

      assert length(systems) == 40
    end

    test "is deterministic: the same map always yields the same slot" do
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0), sys(3, 0, @spacing_y)]

      assert Placement.new_position(systems, nil, 99) == Placement.new_position(systems, nil, 99)
    end
  end

  describe "keep_position?/4" do
    test "keeps a system sitting next to the neighbour it connects to" do
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0)]
      connections = [conn(1, 2)]

      assert Placement.keep_position?(systems, connections, sys(2, @spacing_x, 0), 1)
    end

    test "pulls in a system stranded more than one screen from every neighbour" do
      systems = [sys(1, 0, 0), sys(2, 10 * @spacing_x, 0)]
      connections = [conn(1, 2)]

      refute Placement.keep_position?(systems, connections, sys(2, 10 * @spacing_x, 0), 1)
    end

    test "counts the system the character came from, connection or not" do
      # The connection may not be on the map yet, so the anchor counts on its own.
      systems = [sys(1, 0, 0), sys(2, 10 * @spacing_x, 0)]

      refute Placement.keep_position?(systems, [], sys(2, 10 * @spacing_x, 0), 1)
    end

    test "an unconstrained system is kept, not moved for no reason" do
      # No connections on the map and no anchor: there is nothing for it to be
      # far from, and no anchor to move it towards.
      systems = [sys(1, 0, 0), sys(2, 10 * @spacing_x, 0)]

      assert Placement.keep_position?(systems, [], sys(2, 10 * @spacing_x, 0), nil)
    end

    test "a node is kept when a far neighbour is the only one that is placed" do
      # One near neighbour is enough: the node is not stranded just because some
      # other neighbour happens to be far away.
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0), sys(3, 10 * @spacing_x, 0)]
      connections = [conn(1, 2), conn(1, 3)]

      assert Placement.keep_position?(systems, connections, sys(1, 0, 0), 1)
    end

    test "a hidden system is never kept where it is" do
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0, false)]

      refute Placement.keep_position?(systems, [conn(1, 2)], sys(2, @spacing_x, 0, false), 1)
    end

    test "a system with no placed neighbours at all is kept" do
      # Nothing to be stranded from: re-stamping it would move a node for no
      # reason, which is the behaviour that made nodes jump under the character.
      systems = [sys(1, 0, 0)]

      assert Placement.keep_position?(systems, [], sys(1, 0, 0), 1)
    end
  end

  describe "snap_to_free_slot/3" do
    test "leaves a free position untouched" do
      systems = [sys(1, 0, 0)]

      assert Placement.snap_to_free_slot(systems, 99, {5 * @spacing_x, 5 * @spacing_y}) ==
               {5 * @spacing_x, 5 * @spacing_y}
    end

    test "nudges a taken position and does not land on anything" do
      systems = [sys(1, 0, 0), sys(2, @spacing_x, 0)]

      position = Placement.snap_to_free_slot(systems, 99, {0, 0})

      assert position != {0, 0}
      refute overlaps_anything?(systems, position, 99)
    end

    test "a system does not block its own position" do
      systems = [sys(1, 0, 0)]

      assert Placement.snap_to_free_slot(systems, 1, {0, 0}) == {0, 0}
    end

    test "keeps an off-grid position rather than snapping it to the grid" do
      requested = {3 * @spacing_x + 7, 2 * @spacing_y - 4}

      assert Placement.snap_to_free_slot([sys(1, 0, 0)], 99, requested) == requested
    end
  end
end
