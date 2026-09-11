defmodule WandererApp.Character.ActivityRollupTest do
  @moduledoc """
  Tests for the character activity rollup.

  The report used to return identical numbers for 30 days / 1 year / all time because the
  raw tables are pruned long before those ranges. These tests pin down the bucket
  arithmetic that replaced it:

  1. signatures are `SUM(length(signatures))`, not a row count
  2. deltas propagate to the month and year buckets, and re-running is a no-op
  3. a day is frozen once its raw rows are pruned, so an edited passage can no longer
     push a negative delta over already-correct buckets
  4. expired buckets are pruned per tier
  5. malformed activity rows do not abort the run
  6. the three report ranges return different numbers
  """

  use WandererApp.DataCase, async: false

  alias WandererApp.Api.CharacterActivityRollup, as: Rollup
  alias WandererApp.Api.MapChainPassages
  alias WandererApp.Api.UserActivity
  alias WandererApp.Character.ActivityRollup
  alias WandererApp.Repo

  setup do
    user = insert(:user)
    character = insert(:character, %{user_id: user.id})
    # `maps_v1.owner_id` references a character, not a user.
    map = insert(:map, %{owner_id: character.id})

    %{user: user, character: character, map: map}
  end

  # Noon UTC, plus a minute offset so backdated rows never collide with each other on
  # `user_activity_v1`'s (entity_id, event_type, inserted_at) unique index.
  defp ts(days_ago, seq) do
    Date.utc_today()
    |> Date.add(-days_ago)
    |> NaiveDateTime.new!(~T[12:00:00])
    |> NaiveDateTime.add(seq, :minute)
  end

  # Both timestamps move, mirroring a row that was written and left alone. `updated_at` is
  # what the old prune keyed on, so the tests need it backdated to be meaningful.
  defp backdate(schema, id, timestamp) do
    schema
    |> where([r], r.id == ^id)
    |> Repo.update_all(set: [inserted_at: timestamp, updated_at: timestamp])
  end

  defp create_passage(map, character, days_ago, seq \\ 0) do
    {:ok, passage} =
      MapChainPassages.new(%{
        map_id: map.id,
        character_id: character.id,
        ship_type_id: 1,
        ship_name: "Test Ship",
        mass: 100,
        solar_system_source_id: 1,
        solar_system_target_id: 2
      })

    backdate(MapChainPassages, passage.id, ts(days_ago, seq))
    passage
  end

  defp create_activity(map, character, user, event_type, days_ago, event_data, seq) do
    activity =
      insert(:map_audit_event, %{
        entity_id: map.id,
        entity_type: :map,
        event_type: event_type,
        event_data: event_data,
        user_id: user.id,
        character_id: character.id
      })

    backdate(UserActivity, activity.id, ts(days_ago, seq))
    activity
  end

  defp buckets(map, character, granularity) do
    Rollup
    |> where(
      [r],
      r.map_id == ^map.id and r.character_id == ^character.id and r.granularity == ^granularity
    )
    |> select([r], {r.bucket_start, r.passages, r.connections, r.signatures})
    |> Repo.all()
    |> Enum.sort()
  end

  defp total(map, character, granularity) do
    buckets(map, character, granularity)
    |> Enum.map(fn {_date, passages, _connections, _signatures} -> passages end)
    |> Enum.sum()
  end

  test "signatures count the batch length, not the number of activity rows", %{
    map: map,
    character: character,
    user: user
  } do
    create_activity(map, character, user, :signatures_added, 2, %{"signatures" => [1, 2, 3]}, 0)
    create_activity(map, character, user, :signatures_added, 2, %{"signatures" => [4, 5]}, 1)

    assert :ok = ActivityRollup.run()

    assert [{_date, 0, 0, 5}] = buckets(map, character, :day)
  end

  test "deltas propagate upward and re-running changes nothing", %{
    map: map,
    character: character
  } do
    create_passage(map, character, 2)

    assert :ok = ActivityRollup.run()
    assert total(map, character, :day) == 1
    assert total(map, character, :month) == 1
    assert total(map, character, :year) == 1

    # Nothing new in the raw table: every delta is zero, so no bucket moves.
    assert :ok = ActivityRollup.run()
    assert total(map, character, :day) == 1
    assert total(map, character, :month) == 1
    assert total(map, character, :year) == 1

    # A second passage on the same day accumulates rather than replacing.
    create_passage(map, character, 2, 1)

    assert :ok = ActivityRollup.run()
    assert total(map, character, :day) == 2
    assert total(map, character, :month) == 2
    assert total(map, character, :year) == 2
  end

  test "a day is frozen once its raw rows are pruned, even if a passage was edited", %{
    map: map,
    character: character
  } do
    passages =
      for seq <- 0..2 do
        create_passage(map, character, 20, seq)
      end

    # `update_mass` is reachable from the UI for any passage, with no age limit, so
    # `updated_at` is not a usable age signal — an edited survivor looks brand new.
    edited = List.last(passages)

    MapChainPassages
    |> where([p], p.id == ^edited.id)
    |> Repo.update_all(set: [updated_at: NaiveDateTime.utc_now()])

    assert :ok = ActivityRollup.run()
    assert total(map, character, :day) == 3
    assert total(map, character, :month) == 3
    assert total(map, character, :year) == 3

    remaining =
      MapChainPassages
      |> where([p], p.id in ^Enum.map(passages, & &1.id))
      |> Repo.aggregate(:count)

    assert remaining == 0

    # The day is frozen, so the survivor cannot recompute it down to 1 and push a -2 delta
    # over the month and year buckets.
    assert :ok = ActivityRollup.run()
    assert total(map, character, :day) == 3
    assert total(map, character, :month) == 3
    assert total(map, character, :year) == 3
  end

  test "each tier prunes on its own retention window", %{map: map, character: character} do
    today = Date.utc_today()

    fresh = Date.add(today, -10)
    expired_day = Date.add(today, -120)
    expired_month = today |> Date.beginning_of_month() |> Date.add(-400)
    expired_year = Date.new!(today.year - 12, 1, 1)

    for {granularity, bucket_start} <- [
          {:day, fresh},
          {:day, expired_day},
          {:month, expired_month},
          {:year, expired_year}
        ] do
      {:ok, _} =
        Rollup.new(%{
          map_id: map.id,
          character_id: character.id,
          granularity: granularity,
          bucket_start: bucket_start,
          passages: 7
        })
    end

    assert :ok = ActivityRollup.run()

    assert Enum.map(buckets(map, character, :day), &elem(&1, 0)) == [fresh]
    assert buckets(map, character, :month) == []
    assert buckets(map, character, :year) == []
  end

  test "an activity row with null or malformed event_data does not abort the run", %{
    map: map,
    character: character,
    user: user
  } do
    create_activity(map, character, user, :signatures_added, 2, %{"signatures" => [1, 2]}, 0)
    broken = create_activity(map, character, user, :signatures_added, 2, %{"signatures" => [3]}, 1)

    UserActivity
    |> where([a], a.id == ^broken.id)
    |> Repo.update_all(set: [event_data: "not json"])

    create_passage(map, character, 2)

    assert :ok = ActivityRollup.run()
    assert [{_date, 1, 0, 2}] = buckets(map, character, :day)
  end

  test "each report range reads a different tier", %{
    map: map,
    character: character
  } do
    create_passage(map, character, 2, 0)
    create_passage(map, character, 30, 1)
    create_passage(map, character, 120, 2)
    create_passage(map, character, 400, 3)

    assert :ok = ActivityRollup.run()

    # One option per tier: 7 reads the raw rows, 90 the day tier, 365 the month tier and
    # all time the year tier. Before the rollup every range was capped by the 7-day raw
    # retention and returned the same numbers.
    assert passages_for(map.id, 7) == 1
    assert passages_for(map.id, 90) == 2
    assert passages_for(map.id, 365) == 3
    assert passages_for(map.id, nil) == 4
  end

  defp passages_for(map_id, days) do
    {:ok, activity} = WandererApp.Map.get_character_activity(map_id, days)

    activity
    |> Enum.map(& &1.passages)
    |> Enum.sum()
  end
end
