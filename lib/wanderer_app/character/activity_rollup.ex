defmodule WandererApp.Character.ActivityRollup do
  @moduledoc """
  Copies character activity into `character_activity_rollup_v1` before the raw rows expire.

  Raw activity is short-lived — chain passages are pruned after 7 days, `user_activity_v1`
  after 84 — so the Character Activity report used to return identical numbers for its
  30 day, 1 year and all time options. This job keeps day/month/year buckets so wider
  ranges have real data.

  ## The tiers are nested, not complementary

  Each tier covers its whole retention window *down to now*, so a query range is always
  served by exactly one tier and never has to be stitched together from a fine and a
  coarse granularity (which is what makes seam windows over/under-count):

    * day   — 90 days
    * month — 12 months
    * year  — 10 years

  ## Why deltas

  Because the tiers are nested, a coarse bucket holds recent data too and therefore cannot
  be built by consuming the finer one. Instead every change to a day bucket has its
  `new - old` difference added to the containing month *and* year bucket.

  Deltas are what make this both exact and idempotent: re-running with no new raw rows
  produces a delta of zero, so nothing moves. Recomputing a whole month would instead
  repeatedly overwrite it with data for a day that is still in progress, and a monotonic
  `GREATEST` guard could not express a real decrease.

  ## Pruning

  The job owns the 7-day chain-passage prune. It runs only after the buckets are committed,
  so a failed rollup never loses the raw rows it has not aggregated yet, and there is a
  single writer for the retention window.

  Deletion is driven by `inserted_at` (not `updated_at`) and aligned to the day, so a
  passage whose mass was edited afterwards can no longer resurrect a day that has already
  been frozen — which would have written a large negative delta over the month and year
  buckets.
  """

  require Logger

  import Ecto.Query

  alias WandererApp.Api.CharacterActivityRollup, as: Rollup
  alias WandererApp.Api.MapChainPassages
  alias WandererApp.Api.UserActivity
  alias WandererApp.Repo

  @raw_retention_days 7
  @day_retention_days 90
  @month_retention_months 12
  @year_retention_years 10

  @doc """
  Rolls raw activity up into buckets, prunes expired ones, then prunes raw chain passages.

  Always returns `:ok` — Quantum should not restart the job on a bad data day.
  """
  def run do
    today = Date.utc_today()

    case Repo.transaction(fn -> propagate(today) |> Map.merge(prune(today)) end) do
      {:ok, stats} ->
        Logger.info("#{__MODULE__} finished",
          day_buckets: stats.day,
          month_buckets: stats.month,
          year_buckets: stats.year,
          pruned: stats.pruned
        )

        # Only safe because `propagate/1` aggregated everything still in the table above.
        WandererApp.Map.GarbageCollector.cleanup_chain_passages()

        :ok

      {:error, reason} ->
        Logger.error(
          "#{__MODULE__} aborted, raw chain passages were NOT pruned and will be retried next run",
          reason: inspect(reason)
        )

        :ok
    end
  end

  # -- aggregation -----------------------------------------------------------

  defp propagate(_today) do
    passages = raw_passages()
    connections = raw_connections()
    signatures = raw_signatures()

    existing = existing_day_buckets()

    keys =
      Enum.reduce([passages, connections, signatures], MapSet.new(), fn counts, acc ->
        counts |> Map.keys() |> MapSet.new() |> MapSet.union(acc)
      end)

    {day_rows, month_rows, year_rows} =
      Enum.reduce(keys, {[], [], []}, fn {_map_id, _character_id, _date} = key, acc ->
        build_rows(key, passages, connections, signatures, existing, acc)
      end)

    %{
      day: upsert(day_rows, :replace),
      # Every day in a month proposes the same month bucket, so the deltas have to be
      # summed first — Postgres rejects a single statement that touches one conflict
      # target twice.
      month: upsert(sum_deltas(month_rows), :add),
      year: upsert(sum_deltas(year_rows), :add)
    }
  end

  defp sum_deltas(rows) do
    rows
    |> Enum.reduce(%{}, fn [map_id, character_id, granularity, date, p, c, s], acc ->
      Map.update(acc, {map_id, character_id, granularity, date}, [p, c, s], fn [p0, c0, s0] ->
        [p0 + p, c0 + c, s0 + s]
      end)
    end)
    |> Enum.map(fn {{map_id, character_id, granularity, date}, [p, c, s]} ->
      [map_id, character_id, granularity, date, p, c, s]
    end)
  end

  defp build_rows(
         {map_id, character_id, date} = key,
         passages,
         connections,
         signatures,
         existing,
         {days, months, years}
       ) do
    new = %{
      passages: Map.get(passages, key, 0),
      connections: Map.get(connections, key, 0),
      signatures: Map.get(signatures, key, 0)
    }

    old = Map.get(existing, key, %{passages: 0, connections: 0, signatures: 0})

    if new == old do
      {days, months, years}
    else
      delta = %{
        passages: new.passages - old.passages,
        connections: new.connections - old.connections,
        signatures: new.signatures - old.signatures
      }

      day_row = row(map_id, character_id, "day", date, new)
      month_row = row(map_id, character_id, "month", Date.beginning_of_month(date), delta)
      year_row = row(map_id, character_id, "year", Date.new!(date.year, 1, 1), delta)

      {[day_row | days], [month_row | months], [year_row | years]}
    end
  end

  defp row(map_id, character_id, granularity, bucket_start, values) do
    [
      map_id,
      character_id,
      granularity,
      bucket_start,
      values.passages,
      values.connections,
      values.signatures
    ]
  end

  # There is deliberately no lower bound here: if the job has been down for a while, raw
  # rows older than the retention window are still in the table, and aggregating them
  # before the prune is what keeps them from being deleted unaggregated.
  defp raw_passages do
    MapChainPassages
    |> group_by([p], [
      p.map_id,
      p.character_id,
      fragment("date_trunc('day', ?)::date", p.inserted_at)
    ])
    |> select([p], {
      p.map_id,
      p.character_id,
      fragment("date_trunc('day', ?)::date", p.inserted_at),
      count(p.id)
    })
    |> Repo.all()
    |> Map.new(fn {map_id, character_id, date, count} -> {{map_id, character_id, date}, count} end)
  end

  defp raw_connections do
    UserActivity
    |> where(
      [ua],
      ua.entity_type == :map and ua.event_type == :map_connection_added and
        not is_nil(ua.character_id)
    )
    |> group_by([ua], [
      ua.entity_id,
      ua.character_id,
      fragment("date_trunc('day', ?)::date", ua.inserted_at)
    ])
    |> select([ua], {
      ua.entity_id,
      ua.character_id,
      fragment("date_trunc('day', ?)::date", ua.inserted_at),
      count(ua.id)
    })
    |> Repo.all()
    |> Enum.reduce(%{}, fn {entity_id, character_id, date, count}, acc ->
      # `user_activity.entity_id` is free-form text holding the map uuid.
      case Ecto.UUID.cast(entity_id) do
        {:ok, map_id} -> Map.put(acc, {map_id, character_id, date}, count)
        :error -> acc
      end
    end)
  end

  # Signature counts are `SUM(length(signatures))`, not a row count — one `signatures_added`
  # row carries a whole batch. JSON has to be decoded in Elixir, hence the row-wise read.
  defp raw_signatures do
    UserActivity
    |> where(
      [ua],
      ua.entity_type == :map and ua.event_type == :signatures_added and
        not is_nil(ua.character_id)
    )
    |> select([ua], {
      ua.entity_id,
      ua.character_id,
      fragment("date_trunc('day', ?)::date", ua.inserted_at),
      ua.event_data
    })
    |> Repo.all()
    |> Enum.reduce(%{}, fn {entity_id, character_id, date, event_data}, acc ->
      case Ecto.UUID.cast(entity_id) do
        {:ok, map_id} ->
          key = {map_id, character_id, date}
          Map.update(acc, key, signature_count(event_data), &(&1 + signature_count(event_data)))

        :error ->
          acc
      end
    end)
  end

  # `event_data` is nullable, and one malformed row must not abort the whole run.
  defp signature_count(event_data) when is_binary(event_data) do
    with {:ok, %{"signatures" => signatures}} when is_list(signatures) <- Jason.decode(event_data) do
      length(signatures)
    else
      _ -> 0
    end
  end

  defp signature_count(_), do: 0

  defp existing_day_buckets do
    Rollup
    |> where([r], r.granularity == :day)
    |> select([r], {
      r.map_id,
      r.character_id,
      r.bucket_start,
      r.passages,
      r.connections,
      r.signatures
    })
    |> Repo.all()
    |> Map.new(fn {map_id, character_id, date, passages, connections, signatures} ->
      {{map_id, character_id, date},
       %{passages: passages, connections: connections, signatures: signatures}}
    end)
  end

  # -- writes ----------------------------------------------------------------

  defp upsert([], _mode), do: 0

  defp upsert(rows, mode) do
    columns =
      Enum.reduce(rows, {[], [], [], [], [], [], []}, fn
        [map_id, character_id, granularity, date, passages, connections, signatures],
        {map_ids, character_ids, granularities, dates, p, c, s} ->
          {[map_id | map_ids], [character_id | character_ids], [granularity | granularities],
           [date | dates], [passages | p], [connections | c], [signatures | s]}
      end)
      |> Tuple.to_list()
      |> Enum.map(&Enum.reverse/1)

    # Postgrex encodes a `uuid[]` as raw 16-byte binaries, not the string form that Ecto
    # hands back for a uuid column.
    [map_ids, character_ids | rest] = columns

    params = [
      Enum.map(map_ids, &Ecto.UUID.dump!/1),
      Enum.map(character_ids, &Ecto.UUID.dump!/1)
      | rest
    ]

    %{num_rows: num_rows} = Repo.query!(upsert_sql(mode), params)

    num_rows
  end

  # Ash upserts replace, which cannot express `x = x + excluded.x`, so the conflict clause
  # is written out by hand.
  defp upsert_sql(:replace) do
    """
    INSERT INTO character_activity_rollup_v1 AS t
      (map_id, character_id, granularity, bucket_start, passages, connections, signatures)
    SELECT * FROM unnest(
      $1::uuid[], $2::uuid[], $3::text[], $4::date[], $5::bigint[], $6::bigint[], $7::bigint[]
    )
    ON CONFLICT (map_id, character_id, granularity, bucket_start)
    DO UPDATE SET
      passages = EXCLUDED.passages,
      connections = EXCLUDED.connections,
      signatures = EXCLUDED.signatures,
      updated_at = (now() AT TIME ZONE 'utc')
    """
  end

  defp upsert_sql(:add) do
    """
    INSERT INTO character_activity_rollup_v1 AS t
      (map_id, character_id, granularity, bucket_start, passages, connections, signatures)
    SELECT * FROM unnest(
      $1::uuid[], $2::uuid[], $3::text[], $4::date[], $5::bigint[], $6::bigint[], $7::bigint[]
    )
    ON CONFLICT (map_id, character_id, granularity, bucket_start)
    DO UPDATE SET
      passages = t.passages + EXCLUDED.passages,
      connections = t.connections + EXCLUDED.connections,
      signatures = t.signatures + EXCLUDED.signatures,
      updated_at = (now() AT TIME ZONE 'utc')
    """
  end

  # -- retention -------------------------------------------------------------

  defp prune(today) do
    %{num_rows: pruned} =
      Repo.query!(
        "DELETE FROM character_activity_rollup_v1 WHERE granularity = 'day' AND bucket_start < $1",
        [day_boundary(today)]
      )

    %{num_rows: pruned_month} =
      Repo.query!(
        "DELETE FROM character_activity_rollup_v1 WHERE granularity = 'month' AND bucket_start < $1",
        [month_boundary(today)]
      )

    %{num_rows: pruned_year} =
      Repo.query!(
        "DELETE FROM character_activity_rollup_v1 WHERE granularity = 'year' AND bucket_start < $1",
        [year_boundary(today)]
      )

    %{pruned: pruned + pruned_month + pruned_year}
  end

  defp day_boundary(today), do: Date.add(today, -@day_retention_days)

  defp month_boundary(today) do
    today |> Date.beginning_of_month() |> shift_months(-(@month_retention_months - 1))
  end

  defp year_boundary(today), do: Date.new!(today.year - (@year_retention_years - 1), 1, 1)

  defp shift_months(%Date{year: year, month: month, day: day}, delta) do
    total = year * 12 + (month - 1) + delta
    shifted = Date.new!(div(total, 12), rem(total, 12) + 1, 1)

    Date.new!(shifted.year, shifted.month, min(day, Date.days_in_month(shifted)))
  end

  @doc """
  The inclusive lower bound of the raw tier, aligned to a day.

  Chain passages are pruned below this, which is what freezes a day bucket: once a day has
  no raw rows left it is never recomputed.
  """
  def raw_boundary(today \\ Date.utc_today()), do: Date.add(today, -@raw_retention_days)

  @doc """
  Picks the tier that can serve a `days`-wide range, and where it has to start.

  Returns `{tier, cutoff}` where cutoff is a `DateTime` for `:raw`, a `Date` for `:day` and
  `:month`, and `nil` (everything) for `:year`.

  Ranges are floored to the tier's own granularity rather than cut mid-bucket, which turns
  a silent undercount into a bounded overcount. Both cutoffs are also clamped to the tier's
  retention floor, so the day tier never asks for days it has already pruned.

  The report's four options are one per tier, so every selection lands on a single source:

    * `7` → raw rows, the exact window the GC retains
    * `90` → day tier, at most one extra day (~1%)
    * `365` → month tier, i.e. the last 12 calendar months, so the window lines up with the
      retention boundary exactly and there is no rounding at all
    * `nil` → year tier, everything
  """
  def query_window(nil), do: {:year, nil}

  def query_window(days) when days <= @raw_retention_days do
    {:raw, DateTime.utc_now() |> DateTime.add(-round(days * 24 * 3600), :second)}
  end

  def query_window(days) when days <= @day_retention_days do
    today = Date.utc_today()
    {:day, latest(Date.add(today, -days), day_boundary(today))}
  end

  def query_window(days) when days <= 365 do
    today = Date.utc_today()
    {:month, latest(today |> Date.add(-days) |> Date.beginning_of_month(), month_boundary(today))}
  end

  def query_window(_days), do: {:year, nil}

  # `Date` structs are maps, so `Enum.max/1` would sort by the `calendar` field first.
  defp latest(a, b), do: if(Date.compare(a, b) == :lt, do: b, else: a)
end
