defmodule WandererApp.Jspace.Client do
  @moduledoc """
  Client for the J-Space Helper integration API.

  J-Space Helper is a separate (Go) service that ranks the corporations with the
  most active days in a wormhole system. It exposes a read-only integration API
  guarded by a shared token and has no user sessions of its own, so the browser
  cannot talk to it directly: this module is called from the Wanderer server,
  and the widget talks to Wanderer only.

  Configuration (`config :wanderer_app, :jspace`):

    * `:base_url`     - base URL of the J-Space Helper service, no trailing slash
    * `:api_token`    - shared token, sent as `X-Integration-Token`
    * `:timeout_ms`   - receive timeout, defaults to 3000
    * `:cache_ttl_ms` - server-side cache lifetime, defaults to 5 minutes
  """

  require Logger

  @default_timeout_ms 3_000
  @default_cache_ttl_ms 300_000

  @type system_corporations :: %{
          required(:system) => map(),
          optional(:reason) => String.t(),
          optional(:lookback_days) => non_neg_integer(),
          optional(:corporations) => [map()]
        }

  @doc "Returns `true` when base url and token are both configured."
  def configured? do
    config = config()
    config[:base_url] not in [nil, ""] and config[:api_token] not in [nil, ""]
  end

  @doc "Cache TTL in milliseconds for successful lookups."
  def cache_ttl_ms, do: config()[:cache_ttl_ms] || @default_cache_ttl_ms

  @doc """
  Fetches the top corporations by active days for a solar system.

  Returns `{:ok, body}` with the decoded J-Space Helper response, or
  `{:error, reason}` where reason is one of:

    * `:not_configured` - base url/token missing on this deployment
    * `:not_found`      - J-Space Helper does not know that system
    * `:unauthorized`   - the shared token was rejected (wanderer misconfiguration)
    * `:timeout`        - no answer within `:timeout_ms`
    * `{:http_status, status}` - any other non-200 answer
    * `{:request_failed, reason}` - transport error
  """
  @spec fetch_system_corporations(integer(), keyword()) ::
          {:ok, system_corporations()} | {:error, term()}
  def fetch_system_corporations(system_id, opts \\ []) when is_integer(system_id) do
    config = config()

    cond do
      config[:base_url] in [nil, ""] -> {:error, :not_configured}
      config[:api_token] in [nil, ""] -> {:error, :not_configured}
      true -> do_fetch(config, system_id, opts)
    end
  end

  defp do_fetch(config, system_id, opts) do
    url =
      "#{String.trim_trailing(config[:base_url], "/")}/api/integration/v1/systems/#{system_id}/corporations"

    params =
      %{}
      |> put_if_present(:days, opts[:days])
      |> put_if_present(:limit, opts[:limit])

    request_opts = [
      headers: [{"x-integration-token", config[:api_token]}],
      params: params,
      retry: false,
      connect_options: [timeout: config[:timeout_ms] || @default_timeout_ms],
      receive_timeout: config[:timeout_ms] || @default_timeout_ms
    ]

    case Req.get(url, request_opts) do
      {:ok, %{status: 200, body: body}} when is_map(body) ->
        {:ok, body}

      {:ok, %{status: 200, body: body}} ->
        Logger.warning("J-Space integration returned a non-JSON body",
          body: body |> inspect() |> String.slice(0, 200)
        )

        {:error, :invalid_response}

      {:ok, %{status: 404}} ->
        {:error, :not_found}

      {:ok, %{status: 401}} ->
        Logger.warning("J-Space integration token rejected by #{url}")
        {:error, :unauthorized}

      {:ok, %{status: status} = response} ->
        Logger.warning("J-Space integration request failed",
          url: url,
          status: status,
          body: inspect(Map.get(response, :body))
        )

        {:error, {:http_status, status}}

      {:error, %{reason: :timeout}} ->
        {:error, :timeout}

      {:error, reason} ->
        Logger.warning("J-Space integration request error",
          url: url,
          reason: inspect(reason)
        )

        {:error, {:request_failed, reason}}
    end
  end

  defp put_if_present(map, _key, nil), do: map
  defp put_if_present(map, key, value), do: Map.put(map, key, value)

  defp config, do: Application.get_env(:wanderer_app, :jspace, [])
end
