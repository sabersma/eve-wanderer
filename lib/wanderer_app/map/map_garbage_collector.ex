defmodule WandererApp.Map.GarbageCollector do
  @moduledoc """
  Manager map subscription plans
  """

  require Logger
  require Ash.Query

  @logger Application.compile_env(:wanderer_app, :logger)
  @two_days_seconds 2 * 24 * 60 * 60
  @one_day_seconds 1 * 24 * 60 * 60

  @doc """
  Prunes chain passages older than the raw activity window (7 days).

  Deliberately filters on `inserted_at`, not `updated_at`: the activity rollup aggregates
  by `inserted_at`, and a passage whose mass was edited long after it was recorded would
  escape an `updated_at` prune. It would then look like that day still had raw rows, so the
  next rollup would recompute the day from that single survivor and push a large negative
  delta over the already-correct month and year buckets.

  The boundary is aligned to a day so that "days with raw rows" and "pruned days" stay
  exactly complementary — a day bucket freezes the moment its raw rows are gone.

  Invoked by `WandererApp.Character.ActivityRollup.run/0` after the buckets are committed,
  so there is a single writer and a failed rollup never loses unaggregated rows.
  """
  def cleanup_chain_passages() do
    boundary = WandererApp.Character.ActivityRollup.raw_boundary()

    Logger.info("Start cleanup old map chain passages...", boundary: Date.to_iso8601(boundary))

    WandererApp.Api.MapChainPassages
    |> Ash.Query.filter(inserted_at < ^day_start(boundary))
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    @logger.info(fn -> "All map chain passages processed" end)

    :ok
  end

  def cleanup_system_signatures() do
    Logger.info("Start cleanup old map system signatures...")

    # Wormhole signals: delete if not updated for more than 1 day
    WandererApp.Api.MapSystemSignature
    |> Ash.Query.filter(
      group: "Wormhole",
      updated_at: [less_than: get_cutoff_time(@one_day_seconds)]
    )
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    # Non-wormhole signals: delete if not updated for more than 2 days
    WandererApp.Api.MapSystemSignature
    |> Ash.Query.filter(
      group: [not_eq: "Wormhole"],
      updated_at: [less_than: get_cutoff_time(@two_days_seconds)]
    )
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    @logger.info(fn -> "All map system signatures processed" end)

    :ok
  end

  @doc """
  Clean up orphaned connections — connections whose source or target system
  no longer exists in the database (e.g., the system was deleted after being hidden).
  """
  def cleanup_orphaned_connections() do
    Logger.info("Start cleanup orphaned connections...")

    # Collect all existing solar_system_ids from the map_system table
    existing_system_ids =
      WandererApp.Api.MapSystem
      |> Ash.read!()
      |> Enum.map(& &1.solar_system_id)
      |> MapSet.new()

    if MapSet.size(existing_system_ids) > 0 do
      WandererApp.Api.MapConnection
      |> Ash.read!()
      |> Enum.filter(fn conn ->
        not MapSet.member?(existing_system_ids, conn.solar_system_source) or
          not MapSet.member?(existing_system_ids, conn.solar_system_target)
      end)
      |> Enum.each(fn conn ->
        WandererApp.MapConnectionRepo.destroy!(conn)
      end)
    end

    Logger.info(fn -> "All orphaned connections processed" end)
    :ok
  end

  defp get_cutoff_time(seconds), do: DateTime.utc_now() |> DateTime.add(-seconds, :second)

  defp day_start(date), do: DateTime.new!(date, ~T[00:00:00], "Etc/UTC")
end
