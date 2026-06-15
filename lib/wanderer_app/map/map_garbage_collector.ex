defmodule WandererApp.Map.GarbageCollector do
  @moduledoc """
  Manager map subscription plans
  """

  require Logger
  require Ash.Query

  @logger Application.compile_env(:wanderer_app, :logger)
  @one_week_seconds 7 * 24 * 60 * 60
  @two_days_seconds 2 * 24 * 60 * 60
  @one_day_seconds 1 * 24 * 60 * 60

  def cleanup_chain_passages() do
    Logger.info("Start cleanup old map chain passages...")

    WandererApp.Api.MapChainPassages
    |> Ash.Query.filter(updated_at: [less_than: get_cutoff_time(@one_week_seconds)])
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    @logger.info(fn -> "All map chain passages processed" end)

    :ok
  end

  def cleanup_system_signatures() do
    Logger.info("Start cleanup old map system signatures...")

    # Wormhole signals: delete if not updated for more than 1 day
    WandererApp.Api.MapSystemSignature
    |> Ash.Query.filter(group: "Wormhole", updated_at: [less_than: get_cutoff_time(@one_day_seconds)])
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    # Non-wormhole signals: delete if not updated for more than 2 days
    WandererApp.Api.MapSystemSignature
    |> Ash.Query.filter(group: [not_eq: "Wormhole"], updated_at: [less_than: get_cutoff_time(@two_days_seconds)])
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    @logger.info(fn -> "All map system signatures processed" end)

    :ok
  end

  defp get_cutoff_time(seconds), do: DateTime.utc_now() |> DateTime.add(-seconds, :second)
end
