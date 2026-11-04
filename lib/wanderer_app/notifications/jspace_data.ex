defmodule WandererApp.Notifications.JspaceData do
  @moduledoc """
  Cached top-1 corporation lookup for notification filters.

  Notifications only need the single most active corporation, so this is a much
  lighter request than the map widget's top-5. Successful answers live for the
  configured J-Space cache TTL and failures for a minute, so a down helper is
  not retried for every location change.
  """

  require Logger

  alias WandererApp.Jspace.Client

  @error_cache_ttl_ms 60_000

  @type result :: {:ok, %{system: map(), top: map() | nil}} | {:error, term()}

  @doc """
  Returns the helper's system header and its top corporation by active days.

  `top` is nil when the helper knows the system but has no activity, which is
  different from an error: filters that require a corporation cannot match, but
  a subscription without such filters can still notify.
  """
  @spec top_corporation(integer()) :: result()
  def top_corporation(system_id) when is_integer(system_id) and system_id > 0 do
    key = cache_key(system_id)

    case WandererApp.Cache.get(key) do
      nil -> fetch_and_cache(key, system_id)
      cached -> cached
    end
  end

  def top_corporation(_system_id), do: {:error, :invalid_system}

  defp fetch_and_cache(key, system_id) do
    result =
      case Client.fetch_system_corporations(system_id, limit: 1) do
        {:ok, body} ->
          {:ok,
           %{
             system: body["system"] || %{},
             top: body |> Map.get("corporations", []) |> List.first()
           }}

        {:error, reason} ->
          Logger.debug("J-Space top corporation lookup failed",
            system_id: system_id,
            reason: inspect(reason)
          )

          {:error, reason}
      end

    ttl =
      case result do
        {:ok, _} -> Client.cache_ttl_ms()
        {:error, _} -> @error_cache_ttl_ms
      end

    WandererApp.Cache.insert(key, result, ttl: ttl)
    result
  end

  defp cache_key(system_id), do: "notifications:jspace:top:#{system_id}"
end
