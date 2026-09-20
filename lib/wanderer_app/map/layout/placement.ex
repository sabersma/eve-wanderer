defmodule WandererApp.Map.Layout.Placement do
  @moduledoc """
  Decides where a system goes when it arrives on a map, and whether a system
  that is already there should move at all.

  Pure — it reasons about the systems and connections it is handed, so the rules
  can be tested without a map server, a database or an R-tree. Mirrors
  `computeNewNodePosition` in
  `assets/js/hooks/Mapper/components/map/helpers/layout.ts`.

  The governing rule is that an auto-added system lands within about one screen
  of the system the character travelled from, on a slot no other system occupies.
  Before this, the backend measured a BFS depth column from the map's home system
  — which can be screens away from the anchor the user is looking at — and fell
  back to a "one row below the lowest system" row for systems with no anchor, so
  isolated additions marched further down the map every time.
  """

  alias WandererApp.Map.Layout.Geometry
  alias WandererApp.Map.Layout.Occupancy

  @spacing_x Geometry.spacing_x()

  # How far the slot search may wander from where the node wanted to be, in grid
  # steps. 8 steps is about one screen, which is the bound the placement is
  # specified in.
  @max_slot_radius 8

  # A system already on the map keeps its position unless it is further than this
  # from every system it connects to. About one screen, matching the bound above.
  @keep_position_radius @spacing_x * 8

  @doc """
  Position for a system arriving on the map.

  `anchor_id` is the system the character travelled from, or nil when there is
  none (a manual add with no coordinates, or a jump whose previous system is not
  on this map). `system_id` is the system being placed — it is left out of the
  occupancy so a system already on the map cannot block its own new position.
  """
  def new_position(systems, anchor_id, system_id) do
    occ = Occupancy.from_systems(systems, MapSet.new([system_id]))

    {x, y} =
      case find_system(systems, anchor_id) do
        nil -> cluster_position(systems, occ)
        anchor -> anchor_position(anchor, systems, occ)
      end

    %{x: x, y: y}
  end

  @doc """
  True when a system that is already on the map should keep the position it has.

  False only when it is stranded: further than one screen from every system it
  connects to. Re-stamping a well-placed node's position on every jump is what
  made nodes move under the character — the anchor says where the character came
  from, not where the arriving system's other neighbours are. A node nothing
  sensible is anchored to is the one worth pulling in next to the anchor.

  A system with no neighbours on the map is unconstrained, not stranded, and is
  kept: there is nothing for it to be far from.
  """
  def keep_position?(systems, connections, system, anchor_id) do
    Map.get(system, :visible, true) and not stranded?(systems, connections, system, anchor_id)
  end

  @doc """
  An explicitly requested position: kept when it is free, otherwise nudged to the
  nearest free slot.

  Without this the explicit-coordinate path wrote whatever it was given, so a
  right-click add or a paste could land exactly on an existing node. `system_id`
  is ignored so an existing system does not block its own new position.
  """
  def snap_to_free_slot(systems, system_id, position) do
    occ = Occupancy.from_systems(systems, MapSet.new([system_id]))
    find_slot(occ, position, "the requested coordinates")
  end

  # ---------------------------------------------------------------------------
  # Placement
  # ---------------------------------------------------------------------------

  # One grid step out from the anchor, on the side away from the middle of the
  # map, then the nearest free slot to there. The search walks the desired column
  # before it tries the other side, so a taken slot moves the node within its own
  # column first.
  defp anchor_position(anchor, systems, occ) do
    {centre_x, _centre_y} = centre(systems)
    direction = if anchor.position_x >= centre_x, do: 1, else: -1

    desired = {anchor.position_x + direction * @spacing_x, anchor.position_y}

    find_slot(occ, desired, "next to system #{anchor.solar_system_id}")
  end

  # No anchor to cluster around: use the middle of what is already on the map.
  defp cluster_position(systems, occ) do
    case positioned_systems(systems) do
      [] -> {0, 0}
      _positioned -> find_slot(occ, centre(systems), "the middle of the map")
    end
  end

  defp find_slot(occ, desired, what) do
    case Occupancy.find_free_slot(occ, desired, max_radius: @max_slot_radius) do
      {position, :ok} ->
        position

      {position, :exhausted} ->
        require Logger

        Logger.warning(
          "[system-placement] No free slot within #{@max_slot_radius} grid steps of " <>
            "#{inspect(desired)} (#{what}); using #{inspect(position)}"
        )

        position
    end
  end

  defp stranded?(systems, connections, system, anchor_id) do
    ids = Map.new(systems, &{&1.solar_system_id, &1})

    neighbours =
      connections
      |> Enum.flat_map(fn conn ->
        cond do
          conn.solar_system_source == system.solar_system_id -> [conn.solar_system_target]
          conn.solar_system_target == system.solar_system_id -> [conn.solar_system_source]
          true -> []
        end
      end)
      # The connection the character just travelled may not be on the map yet;
      # the system they came from counts either way.
      |> then(fn neighbour_ids ->
        case anchor_id do
          nil -> neighbour_ids
          id -> [id | neighbour_ids]
        end
      end)

    # A system with nothing to anchor to is not stranded — it is unconstrained.
    # `Enum.all?/2` is vacuously true on an empty list, so without the guard an
    # island with no connections on the map would read as stranded and be moved
    # on every jump, which is the arbitrary node movement this whole rule exists
    # to stop.
    neighbours != [] and
      Enum.all?(neighbours, fn id ->
        case Map.get(ids, id) do
          nil ->
            true

          neighbour ->
            max(
              abs(neighbour.position_x - system.position_x),
              abs(neighbour.position_y - system.position_y)
            ) > @keep_position_radius
        end
      end)
  end

  defp find_system(_systems, nil), do: nil

  defp find_system(systems, id) do
    Enum.find(systems, fn sys -> sys.solar_system_id == id and Map.get(sys, :visible, true) end)
  end

  # Systems that carry coordinates, in a stable order, so the centre below does
  # not depend on cache iteration order.
  defp positioned_systems(systems) do
    systems
    |> Enum.filter(&(is_number(&1.position_x) and is_number(&1.position_y)))
    |> Enum.sort_by(& &1.solar_system_id)
  end

  defp centre(systems) do
    case positioned_systems(systems) do
      [] ->
        {0, 0}

      positioned ->
        count = length(positioned)

        {round(Enum.sum(Enum.map(positioned, & &1.position_x)) / count),
         round(Enum.sum(Enum.map(positioned, & &1.position_y)) / count)}
    end
  end
end
