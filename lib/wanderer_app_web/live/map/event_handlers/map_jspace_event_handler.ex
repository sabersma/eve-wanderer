defmodule WandererAppWeb.MapJspaceEventHandler do
  @moduledoc """
  Serves the J-Space widget.

  The widget asks for the corporations with the most active days in the system
  the map (or the followed EVE client) currently shows. J-Space Helper exposes
  that ranking through a shared-token API without CORS headers, so the lookup
  runs here instead of in the browser, and the answer is cached server-side for
  the configured TTL.

  J-Space Helper only ingests wormhole space; other systems answer
  `reason: "not_jspace"` and the widget renders a hint instead of a list.
  """

  use WandererAppWeb, :live_component

  require Logger

  alias WandererApp.Jspace.Client
  alias WandererAppWeb.MapCoreEventHandler

  @default_limit 5
  @max_limit 20

  # A failed lookup is cached briefly so a down J-Space Helper is not retried
  # by every map user on every widget render.
  @error_cache_ttl_ms 60_000

  def handle_ui_event("get_jspace_corporations", payload, socket) do
    case parse_system_id(payload["system_id"]) do
      {:ok, system_id} ->
        limit = parse_limit(payload["limit"])
        {:reply, lookup(system_id, limit), socket}

      :error ->
        Logger.debug(fn -> "invalid jspace system id: #{inspect(payload)}" end)
        {:reply, %{"error" => "invalid_input"}, socket}
    end
  end

  def handle_ui_event(event, payload, socket),
    do: MapCoreEventHandler.handle_ui_event(event, payload, socket)

  defp lookup(system_id, limit) do
    key = "jspace:system:#{system_id}:#{limit}"

    case WandererApp.Cache.get(key) do
      nil -> fetch_and_cache(key, system_id, limit)
      cached -> cached
    end
  end

  defp fetch_and_cache(key, system_id, limit) do
    result =
      case Client.fetch_system_corporations(system_id, limit: limit) do
        {:ok, body} -> body
        {:error, reason} -> %{"error" => error_code(reason)}
      end

    ttl =
      case result do
        %{"error" => _} -> @error_cache_ttl_ms
        _ -> Client.cache_ttl_ms()
      end

    WandererApp.Cache.insert(key, result, ttl: ttl)

    result
  end

  defp error_code(:not_configured), do: "jspace_not_configured"
  defp error_code(:not_found), do: "unknown_system"
  defp error_code(:timeout), do: "jspace_timeout"

  defp error_code(reason) do
    Logger.warning("J-Space lookup failed", reason: inspect(reason))
    "jspace_unavailable"
  end

  defp parse_system_id(system_id) when is_integer(system_id) and system_id > 0,
    do: {:ok, system_id}

  defp parse_system_id(system_id) when is_binary(system_id) do
    case Integer.parse(system_id) do
      {value, ""} when value > 0 -> {:ok, value}
      _ -> :error
    end
  end

  defp parse_system_id(_system_id), do: :error

  defp parse_limit(limit) when is_integer(limit), do: limit |> max(1) |> min(@max_limit)

  defp parse_limit(limit) when is_binary(limit) do
    case Integer.parse(limit) do
      {value, ""} -> value |> max(1) |> min(@max_limit)
      _ -> @default_limit
    end
  end

  defp parse_limit(_limit), do: @default_limit
end
