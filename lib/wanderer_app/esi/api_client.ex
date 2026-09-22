defmodule WandererApp.Esi.ApiClient do
  use Nebulex.Caching
  @moduledoc false

  require Logger
  alias WandererApp.Cache

  @ttl :timer.hours(1)

  @wanderrer_user_agent "(wanderer-industries@proton.me; +https://github.com/wanderer-industries/wanderer)"

  @cache_opts [cache: true]
  @retry_opts [retry: false, retry_log_level: :warning]
  @timeout_opts [pool_timeout: 15_000, receive_timeout: :timer.minutes(1)]
  @api_retry_count 1

  @logger Application.compile_env(:wanderer_app, :logger)

  # Pool selection for different operation types
  # Character tracking operations use dedicated high-capacity pool
  @character_tracking_pool WandererApp.Finch.ESI.CharacterTracking
  # General ESI operations use standard pool
  @general_pool WandererApp.Finch.ESI.General

  # Helper function to get Req options with appropriate Finch pool
  defp req_options_for_pool(pool) do
    [base_url: "https://esi.evetech.net", finch: pool]
  end

  # Global circuit breaker for ESI's legacy "error rate limit" (max 100 non-2xx/3xx
  # responses/min app-wide, returns 420 on ALL ESI routes until the window resets).
  # Short-circuits every ESI GET/POST during the blackout so pools don't keep hitting
  # ESI (and extending the blackout) while it's active.
  @esi_blackout_cache_key "esi:global_blackout_until"

  defp esi_globally_rate_limited?, do: Cache.has_key?(@esi_blackout_cache_key)

  defp mark_global_rate_limited(headers) do
    reset_seconds =
      headers
      |> Map.get("x-esi-error-limit-reset", ["1"])
      |> List.first()
      |> to_string()
      |> Integer.parse()
      |> case do
        {seconds, _} -> seconds
        :error -> 1
      end

    Cache.put(@esi_blackout_cache_key, true, ttl: :timer.seconds(reset_seconds + 1))
  end

  # --- EVE SSO refresh resilience ---
  # SSO is a different host from ESI (login.eveonline.com, behind Cloudflare) and fails
  # independently. When it wobbles, every tracked character fails at once, which used to
  # look like N unrelated character faults. These keys aggregate those failures into a
  # single recognised outage.
  @sso_degraded_cache_key "sso:refresh:degraded"
  @sso_window_failures_key "sso:refresh:window_failures"
  @sso_window_marker_prefix "sso:refresh:window:"
  # Distinct characters that must fail within the window before it counts as an outage.
  @sso_degraded_character_threshold 5
  # Rolling window in which those distinct characters must fail.
  @sso_window_ttl :timer.minutes(3)
  # How long refreshes are deferred once the outage is detected. It doubles as the
  # half-open probe interval: when it lapses a single attempt goes through.
  @sso_degraded_ttl :timer.minutes(3)
  # The failure count deliberately outlives the flag above, so the one probe that gets
  # through after each window is enough to re-arm the breaker. Without the longer TTL
  # every probe would need a fresh burst of failures to trip it again. The cost is that
  # the breaker stays trigger-happy for a few minutes after an outage ends, which delays
  # refreshes (by one probe window) rather than risking another wave.
  @sso_window_failures_ttl :timer.minutes(10)

  # `invalid_grant` strikes must be spread over time before a token is called dead. The
  # previous "3 consecutive failures" rule counted a strike per *refresh call*, and
  # several tracking endpoints refresh the same character within one tick, so a single
  # bad second could reach the quota and destroy a perfectly healthy token.
  @invalid_grant_strikes 3
  @invalid_grant_min_span_minutes 30
  @invalid_grant_strikes_ttl :timer.hours(2)

  # Once a character is confirmed to need re-authorization, probe at most this often.
  # Bounds the traffic a genuinely dead refresh token can generate while still letting
  # the character heal itself if SSO recovers (or the invalid_grant was a false alarm).
  @reauth_probe_ttl :timer.hours(1)

  defp emit_esi_error(path, error_type) do
    :telemetry.execute(
      [:wanderer_app, :esi, :error],
      %{count: 1},
      %{endpoint: path, error_type: error_type}
    )
  end

  def get_server_status, do: do_get("/status", [], @cache_opts)

  def set_autopilot_waypoint(add_to_beginning, clear_other_waypoints, destination_id, opts \\ []),
    do:
      do_post_esi(
        "/ui/autopilot/waypoint",
        get_auth_opts(opts)
        |> Keyword.merge(
          params: %{
            add_to_beginning: add_to_beginning,
            clear_other_waypoints: clear_other_waypoints,
            destination_id: destination_id
          }
        )
      )

  def post_characters_affiliation(character_eve_ids, _opts)
      when is_list(character_eve_ids),
      do:
        do_post_esi(
          "/characters/affiliation/",
          [
            json: character_eve_ids,
            params: %{
              datasource: "tranquility"
            }
          ],
          @character_tracking_pool
        )

  def get_routes_custom(hubs, origin, params),
    do:
      do_post(
        "#{get_custom_route_base_url()}/route/multiple",
        [
          json: %{
            origin: origin,
            destinations: hubs,
            flag: params.flag,
            connections: params.connections,
            avoid: params.avoid
          }
        ]
        |> Keyword.merge(@timeout_opts)
      )

  def get_routes_eve(hubs, origin, _params, _opts),
    do:
      {:ok,
       hubs
       |> Task.async_stream(
         fn destination ->
           %{
             "origin" => origin,
             "destination" => destination,
             "systems" => [],
             "success" => false
           }

           # do_get_routes_eve(origin, destination, params, opts)
         end,
         max_concurrency: System.schedulers_online() * 4,
         timeout: :timer.seconds(30),
         on_timeout: :kill_task
       )
       |> Enum.map(fn result ->
         case result do
           {:ok, val} -> val
           {:error, error} -> {:error, error}
           _ -> {:error, :failed}
         end
       end)}

  @decorate cacheable(
              cache: Cache,
              key: "group-info-#{group_id}",
              opts: [ttl: @ttl]
            )
  def get_group_info(group_id, opts),
    do:
      do_get(
        "/universe/groups/#{group_id}/",
        opts,
        @cache_opts
      )

  @decorate cacheable(
              cache: Cache,
              key: "type-info-#{type_id}",
              opts: [ttl: @ttl]
            )
  def get_type_info(type_id, opts),
    do:
      do_get(
        "/universe/types/#{type_id}/",
        opts,
        @cache_opts
      )

  @decorate cacheable(
              cache: Cache,
              key: "alliance-info-#{eve_id}",
              opts: [ttl: @ttl]
            )
  def get_alliance_info(eve_id, opts \\ []) do
    case get_alliance_info(eve_id, "", opts) do
      {:ok, result} when is_map(result) -> {:ok, result |> Map.put("eve_id", eve_id)}
      {:error, error} -> {:error, error}
      error -> error
    end
  end

  @decorate cacheable(
              cache: Cache,
              key: "killmail-#{killmail_id}-#{killmail_hash}",
              opts: [ttl: @ttl]
            )
  def get_killmail(killmail_id, killmail_hash, opts \\ []),
    do: do_get("/killmails/#{killmail_id}/#{killmail_hash}/", opts, @cache_opts)

  @decorate cacheable(
              cache: Cache,
              key: "corporation-info-#{eve_id}",
              opts: [ttl: @ttl]
            )
  def get_corporation_info(eve_id, opts \\ []) do
    case get_corporation_info(eve_id, "", opts) do
      {:ok, result} when is_map(result) -> {:ok, result |> Map.put("eve_id", eve_id)}
      {:error, error} -> {:error, error}
      error -> error
    end
  end

  @decorate cacheable(
              cache: Cache,
              key: "character-info-#{eve_id}",
              opts: [ttl: @ttl]
            )
  def get_character_info(eve_id, opts \\ []) do
    case do_get(
           "/characters/#{eve_id}/",
           opts,
           @cache_opts
         ) do
      {:ok, result} when is_map(result) -> {:ok, result |> Map.put("eve_id", eve_id)}
      {:error, error} -> {:error, error}
      error -> error
    end
  end

  @decorate cacheable(
              cache: Cache,
              key: "get_custom_route_base_url"
            )
  def get_custom_route_base_url, do: WandererApp.Env.custom_route_base_url()

  def get_character_wallet(character_eve_id, opts \\ []),
    do: get_character_auth_data(character_eve_id, "wallet", opts ++ @cache_opts)

  def get_corporation_wallets(corporation_id, opts \\ []),
    do: get_corporation_auth_data(corporation_id, "wallets", opts)

  def get_corporation_wallet_journal(corporation_id, division, opts \\ []),
    do:
      get_corporation_auth_data(
        corporation_id,
        "wallets/#{division}/journal",
        opts
      )

  def get_corporation_wallet_transactions(corporation_id, division, opts \\ []),
    do:
      get_corporation_auth_data(
        corporation_id,
        "wallets/#{division}/transactions",
        opts
      )

  def get_character_location(character_eve_id, opts \\ []),
    do: get_character_auth_data(character_eve_id, "location", opts ++ @cache_opts)

  def get_character_online(character_eve_id, opts \\ []),
    do: get_character_auth_data(character_eve_id, "online", opts ++ @cache_opts)

  def get_character_ship(character_eve_id, opts \\ []),
    do: get_character_auth_data(character_eve_id, "ship", opts ++ @cache_opts)

  def search(character_eve_id, opts \\ []) do
    params = Keyword.get(opts, :params, %{}) |> Map.new()

    search_val =
      to_string(Map.get(params, :search) || Map.get(params, "search") || "")

    categories_val =
      to_string(
        Map.get(params, :categories) ||
          Map.get(params, "categories") ||
          "character,alliance,corporation"
      )

    query_params = [
      {"search", search_val},
      {"categories", categories_val},
      {"language", "en-us"},
      {"strict", "false"},
      {"datasource", "tranquility"}
    ]

    merged_opts = Keyword.put(opts, :params, query_params)
    get_search(character_eve_id, search_val, categories_val, merged_opts)
  end

  @decorate cacheable(
              cache: Cache,
              key: "search-#{character_eve_id}-#{categories_val}-#{Base.encode64(search_val)}",
              opts: [ttl: @ttl]
            )
  defp get_search(character_eve_id, search_val, categories_val, merged_opts) do
    # Note: search_val and categories_val are used by the @decorate cacheable annotation above
    _unused = {search_val, categories_val}
    get_character_auth_data(character_eve_id, "search", merged_opts)
  end

  defp get_auth_opts(opts), do: [auth: {:bearer, opts[:access_token]}]

  defp get_alliance_info(alliance_eve_id, info_path, opts),
    do:
      do_get(
        "/alliances/#{alliance_eve_id}/#{info_path}",
        opts,
        @cache_opts
      )

  defp get_corporation_info(corporation_eve_id, info_path, opts),
    do:
      do_get(
        "/corporations/#{corporation_eve_id}/#{info_path}",
        opts,
        @cache_opts
      )

  defp get_character_auth_data(character_eve_id, info_path, opts) do
    path = "/characters/#{character_eve_id}/#{info_path}"

    auth_opts =
      [params: opts[:params] || []] ++
        (opts |> get_auth_opts())

    character_id = opts |> Keyword.get(:character_id, nil)

    # Use character tracking pool for character operations
    pool = @character_tracking_pool

    if not is_access_token_expired?(character_id) do
      do_get(
        path,
        auth_opts,
        opts |> with_refresh_token(),
        pool
      )
    else
      do_get_retry(path, auth_opts, opts |> with_refresh_token(), :forbidden, pool)
    end
  end

  defp is_access_token_expired?(character_id) do
    {:ok, %{expires_at: expires_at} = _character} =
      WandererApp.Character.get_character(character_id)

    now = DateTime.utc_now() |> DateTime.to_unix()

    expires_at - now <= 0
  end

  defp get_corporation_auth_data(corporation_eve_id, info_path, opts),
    do:
      do_get(
        "/corporations/#{corporation_eve_id}/#{info_path}",
        [params: opts[:params] || []] ++
          (opts |> get_auth_opts()),
        (opts |> with_refresh_token()) ++ @cache_opts
      )

  defp with_user_agent_opts(opts),
    do:
      opts
      |> Keyword.merge(
        headers: [{:user_agent, "Wanderer/#{WandererApp.Env.vsn()} #{@wanderrer_user_agent}"}]
      )

  defp with_refresh_token(opts), do: opts |> Keyword.merge(refresh_token?: true)

  defp with_cache_opts(opts),
    do: opts |> Keyword.merge(@cache_opts) |> Keyword.merge(cache_dir: System.tmp_dir!())

  defp do_get(path, api_opts, opts, pool \\ @general_pool) do
    case Cachex.get(:api_cache, path) do
      {:ok, cached_data} when not is_nil(cached_data) ->
        {:ok, cached_data}

      _ ->
        do_get_request(path, api_opts, opts, pool)
    end
  end

  defp do_get_request(path, api_opts, opts, pool) do
    if esi_globally_rate_limited?() do
      {:error, :error_limited, %{}}
    else
      do_get_request_uncached(path, api_opts, opts, pool)
    end
  end

  defp do_get_request_uncached(path, api_opts, opts, pool) do
    try do
      req_options_for_pool(pool)
      |> Req.new()
      |> Req.get(
        api_opts
        |> Keyword.merge(url: path)
        |> with_user_agent_opts()
        |> with_cache_opts()
        |> Keyword.merge(@retry_opts)
        |> Keyword.merge(@timeout_opts)
      )
      |> case do
        {:ok, %{status: 200, body: body, headers: headers}} ->
          maybe_cache_response(path, body, headers, opts)

          {:ok, body}

        {:ok, %{status: 504}} ->
          emit_esi_error(path, :timeout)
          {:error, :timeout}

        {:ok, %{status: 404}} ->
          emit_esi_error(path, :not_found)
          {:error, :not_found}

        {:ok, %{status: 420, headers: headers} = _error} ->
          # Extract rate limit information from headers
          reset_seconds = Map.get(headers, "x-esi-error-limit-reset", ["0"]) |> List.first()
          remaining = Map.get(headers, "x-esi-error-limit-remain", ["0"]) |> List.first()

          # Emit telemetry for rate limiting
          :telemetry.execute(
            [:wanderer_app, :esi, :rate_limited],
            %{
              count: 1,
              reset_duration:
                case Integer.parse(reset_seconds || "0") do
                  {seconds, _} -> seconds * 1000
                  _ -> 0
                end
            },
            %{
              method: "GET",
              path: path,
              reset_seconds: reset_seconds,
              remaining_requests: remaining
            }
          )

          Logger.warning("ESI_RATE_LIMITED: GET request rate limited",
            method: "GET",
            path: path,
            reset_seconds: reset_seconds,
            remaining_requests: remaining
          )

          mark_global_rate_limited(headers)

          {:error, :error_limited, headers}

        {:ok, %{status: 429, headers: headers} = _error} ->
          # Extract rate limit information from headers
          reset_seconds = Map.get(headers, "retry-after", ["0"]) |> List.first()

          # Emit telemetry for rate limiting
          :telemetry.execute(
            [:wanderer_app, :esi, :rate_limited],
            %{
              count: 1,
              reset_duration:
                case Integer.parse(reset_seconds || "0") do
                  {seconds, _} -> seconds * 1000
                  _ -> 0
                end
            },
            %{
              method: "GET",
              path: path,
              reset_seconds: reset_seconds
            }
          )

          Logger.warning("ESI_RATE_LIMITED: GET request rate limited",
            method: "GET",
            path: path,
            reset_seconds: reset_seconds
          )

          {:error, :error_limited, headers}

        {:ok, %{status: status} = _error} when status in [401, 403] ->
          emit_esi_error(path, status)
          do_get_retry(path, api_opts, opts)

        {:ok, %{status: status}} ->
          emit_esi_error(path, status)
          {:error, "Unexpected status: #{status}"}

        {:error, %Mint.TransportError{reason: :timeout}} ->
          # Emit telemetry for pool timeout
          :telemetry.execute(
            [:wanderer_app, :finch, :pool_timeout],
            %{count: 1},
            %{method: "GET", path: path, pool: pool}
          )

          emit_esi_error(path, :pool_timeout)

          {:error, :pool_timeout}

        {:error, reason} ->
          # Check if this is a Finch pool error
          if is_exception(reason) and
               Exception.message(reason) =~ "unable to provide a connection" do
            :telemetry.execute(
              [:wanderer_app, :finch, :pool_exhausted],
              %{count: 1},
              %{method: "GET", path: path, pool: pool}
            )
          end

          emit_esi_error(path, :request_failed)

          Logger.error("ESI_REQUEST_FAILED: GET #{path}",
            method: "GET",
            path: path,
            pool: inspect(pool),
            reason: inspect(reason)
          )

          {:error, "Request failed"}
      end
    rescue
      e ->
        error_msg = Exception.message(e)

        # Emit telemetry for pool exhaustion errors
        if error_msg =~ "unable to provide a connection" do
          :telemetry.execute(
            [:wanderer_app, :finch, :pool_exhausted],
            %{count: 1},
            %{method: "GET", path: path, pool: pool}
          )

          Logger.error("FINCH_POOL_EXHAUSTED: #{error_msg}",
            method: "GET",
            path: path,
            pool: inspect(pool)
          )
        else
          Logger.error("ESI_REQUEST_FAILED: GET #{path} raised #{inspect(e)}",
            method: "GET",
            path: path,
            pool: inspect(pool),
            exception: inspect(e),
            stacktrace: Exception.format_stacktrace(__STACKTRACE__)
          )
        end

        {:error, "Request failed"}
    end
  end

  defp maybe_cache_response(path, body, %{"expires" => [expires]} = _headers, opts)
       when is_binary(path) and not is_nil(expires) do
    try do
      if opts |> Keyword.get(:cache, false) do
        cached_ttl =
          DateTime.diff(Timex.parse!(expires, "{RFC1123}"), DateTime.utc_now(), :millisecond)

        Cachex.put(
          :api_cache,
          path,
          body,
          ttl: cached_ttl
        )
      end
    rescue
      e ->
        @logger.error(Exception.message(e))

        :ok
    end
  end

  defp maybe_cache_response(_path, _body, _headers, _opts), do: :ok

  defp do_post(url, opts) do
    try do
      case Req.post("#{url}", opts |> with_user_agent_opts()) do
        {:ok, %{status: status, body: body}} when status in [200, 201] ->
          {:ok, body}

        {:ok, %{status: 504}} ->
          {:error, :timeout}

        {:ok, %{status: 403}} ->
          {:error, :forbidden}

        {:ok, %{status: 420, headers: headers} = _error} ->
          # Extract rate limit information from headers
          reset_seconds = Map.get(headers, "x-esi-error-limit-reset", ["0"]) |> List.first()
          remaining = Map.get(headers, "x-esi-error-limit-remain", ["0"]) |> List.first()

          # Emit telemetry for rate limiting
          :telemetry.execute(
            [:wanderer_app, :esi, :rate_limited],
            %{
              count: 1,
              reset_duration:
                case Integer.parse(reset_seconds || "0") do
                  {seconds, _} -> seconds * 1000
                  _ -> 0
                end
            },
            %{
              method: "POST",
              path: url,
              reset_seconds: reset_seconds,
              remaining_requests: remaining
            }
          )

          Logger.warning("ESI_RATE_LIMITED: POST request rate limited",
            method: "POST",
            path: url,
            reset_seconds: reset_seconds,
            remaining_requests: remaining
          )

          {:error, :error_limited, headers}

        {:ok, %{status: status}} ->
          {:error, "Unexpected status: #{status}"}

        {:error, reason} ->
          Logger.error("ESI_REQUEST_FAILED: POST #{url}",
            method: "POST",
            path: url,
            reason: inspect(reason)
          )

          {:error, reason}
      end
    rescue
      e ->
        Logger.error("ESI_REQUEST_FAILED: POST #{url} raised #{inspect(e)}",
          method: "POST",
          path: url,
          exception: inspect(e),
          stacktrace: Exception.format_stacktrace(__STACKTRACE__)
        )

        {:error, "Request failed"}
    end
  end

  defp do_post_esi(url, opts, pool \\ @general_pool) do
    if esi_globally_rate_limited?() do
      {:error, :error_limited, %{}}
    else
      do_post_esi_uncached(url, opts, pool)
    end
  end

  defp do_post_esi_uncached(url, opts, pool) do
    try do
      req_opts =
        (opts |> with_user_agent_opts() |> Keyword.merge(@retry_opts)) ++
          [params: opts[:params] || []]

      Req.new(req_options_for_pool(pool) ++ req_opts)
      |> Req.post(url: url)
      |> case do
        {:ok, %{status: status, body: body}} when status in [200, 201] ->
          {:ok, body}

        {:ok, %{status: 504}} ->
          emit_esi_error(url, :timeout)
          {:error, :timeout}

        {:ok, %{status: 403}} ->
          emit_esi_error(url, :forbidden)
          {:error, :forbidden}

        {:ok, %{status: 420, headers: headers} = _error} ->
          # Extract rate limit information from headers
          reset_seconds = Map.get(headers, "x-esi-error-limit-reset", ["0"]) |> List.first()
          remaining = Map.get(headers, "x-esi-error-limit-remain", ["0"]) |> List.first()

          # Emit telemetry for rate limiting
          :telemetry.execute(
            [:wanderer_app, :esi, :rate_limited],
            %{
              count: 1,
              reset_duration:
                case Integer.parse(reset_seconds || "0") do
                  {seconds, _} -> seconds * 1000
                  _ -> 0
                end
            },
            %{
              method: "POST_ESI",
              path: url,
              reset_seconds: reset_seconds,
              remaining_requests: remaining
            }
          )

          Logger.warning("ESI_RATE_LIMITED: POST ESI request rate limited",
            method: "POST_ESI",
            path: url,
            reset_seconds: reset_seconds,
            remaining_requests: remaining
          )

          mark_global_rate_limited(headers)

          {:error, :error_limited, headers}

        {:ok, %{status: 429, headers: headers} = _error} ->
          # Extract rate limit information from headers
          reset_seconds = Map.get(headers, "retry-after", ["0"]) |> List.first()

          # Emit telemetry for rate limiting
          :telemetry.execute(
            [:wanderer_app, :esi, :rate_limited],
            %{
              count: 1,
              reset_duration:
                case Integer.parse(reset_seconds || "0") do
                  {seconds, _} -> seconds * 1000
                  _ -> 0
                end
            },
            %{
              method: "POST_ESI",
              path: url,
              reset_seconds: reset_seconds
            }
          )

          Logger.warning("ESI_RATE_LIMITED: POST request rate limited",
            method: "POST_ESI",
            path: url,
            reset_seconds: reset_seconds
          )

          {:error, :error_limited, headers}

        {:ok, %{status: status}} ->
          emit_esi_error(url, status)
          {:error, "Unexpected status: #{status}"}

        {:error, %Mint.TransportError{reason: :timeout}} ->
          # Emit telemetry for pool timeout
          :telemetry.execute(
            [:wanderer_app, :finch, :pool_timeout],
            %{count: 1},
            %{method: "POST_ESI", path: url, pool: pool}
          )

          emit_esi_error(url, :pool_timeout)

          {:error, :pool_timeout}

        {:error, reason} ->
          # Check if this is a Finch pool error
          if is_exception(reason) and
               Exception.message(reason) =~ "unable to provide a connection" do
            :telemetry.execute(
              [:wanderer_app, :finch, :pool_exhausted],
              %{count: 1},
              %{method: "POST_ESI", path: url, pool: pool}
            )
          end

          emit_esi_error(url, :request_failed)

          Logger.error("ESI_REQUEST_FAILED: POST_ESI #{url}",
            method: "POST_ESI",
            path: url,
            pool: inspect(pool),
            reason: inspect(reason)
          )

          {:error, reason}
      end
    rescue
      e ->
        error_msg = Exception.message(e)

        # Emit telemetry for pool exhaustion errors
        if error_msg =~ "unable to provide a connection" do
          :telemetry.execute(
            [:wanderer_app, :finch, :pool_exhausted],
            %{count: 1},
            %{method: "POST_ESI", path: url, pool: pool}
          )

          Logger.error("FINCH_POOL_EXHAUSTED: #{error_msg}",
            method: "POST_ESI",
            path: url,
            pool: inspect(pool)
          )
        else
          Logger.error("ESI_REQUEST_FAILED: POST_ESI #{url} raised #{inspect(e)}",
            method: "POST_ESI",
            path: url,
            pool: inspect(pool),
            exception: inspect(e),
            stacktrace: Exception.format_stacktrace(__STACKTRACE__)
          )
        end

        {:error, "Request failed"}
    end
  end

  defp do_get_retry(path, api_opts, opts, status \\ :forbidden, pool \\ @general_pool) do
    refresh_token? = opts |> Keyword.get(:refresh_token?, false)
    retry_count = opts |> Keyword.get(:retry_count, 0)
    character_id = opts |> Keyword.get(:character_id, nil)

    if not refresh_token? or is_nil(character_id) or retry_count >= @api_retry_count do
      {:error, status}
    else
      case refresh_token(character_id) do
        {:ok, token} ->
          auth_opts = [access_token: token.access_token] |> get_auth_opts()

          do_get(
            path,
            api_opts |> Keyword.merge(auth_opts),
            opts |> Keyword.merge(retry_count: retry_count + 1),
            pool
          )

        {:error, error} ->
          # Report a refresh failure as its own error type. Returning the ESI `status`
          # here (usually `:forbidden`) made the tracker read an SSO outage as a
          # permission problem and flag healthy characters as needing re-authorization.
          Logger.warning("TOKEN_REFRESH_FAILED: request aborted, no usable access token",
            character_id: character_id,
            path: path,
            error_type: "token_refresh_failed",
            error: inspect(error)
          )

          {:error, :token_refresh_failed}
      end
    end
  end

  defp refresh_token(character_id) do
    cond do
      sso_degraded?() ->
        # A wide SSO outage is in progress. Calling the token endpoint now would only add
        # load to a struggling host and collect more strikes against healthy characters.
        Logger.warning("TOKEN_REFRESH_DEFERRED: SSO degraded window active",
          character_id: character_id,
          error_type: "sso_degraded",
          window_failures: Cache.lookup!(@sso_window_failures_key, 0)
        )

        {:error, :token_refresh_failed}

      reauth_probe_deferred?(character_id) ->
        Logger.debug(
          fn ->
            "TOKEN_REFRESH_DEFERRED: character awaits re-authorization, probe deferred"
          end,
          character_id: character_id,
          error_type: "needs_reauth"
        )

        {:error, :token_refresh_failed}

      true ->
        single_flight_refresh(character_id)
    end
  end

  # Serializes refresh attempts per character (per node). One character can have several
  # tracking endpoints scheduled around the same tick; they used to issue one token
  # request each. Now the first refreshes and the rest reuse the resulting token.
  defp single_flight_refresh(character_id) do
    lock = {{:token_refresh, character_id}, self()}

    case :global.trans(lock, fn -> locked_refresh(character_id) end, [node()], 3) do
      :aborted ->
        Logger.warning("TOKEN_REFRESH_DEFERRED: refresh already in flight",
          character_id: character_id,
          error_type: "refresh_in_flight"
        )

        {:error, :token_refresh_failed}

      result ->
        result
    end
  end

  defp locked_refresh(character_id) do
    case current_token(character_id) do
      {:ok, token} ->
        # Someone refreshed while we waited for the lock - reuse their token instead of
        # spending another SSO request (and another strike) on it.
        Logger.debug(
          fn -> "TOKEN_REFRESH_SKIPPED: reusing access token refreshed concurrently" end,
          character_id: character_id,
          error_type: "token_reused"
        )

        {:ok, token}

      :expired ->
        do_refresh_token(character_id)
    end
  end

  # Re-reads the character inside the lock so a concurrent refresh is not repeated.
  defp current_token(character_id) do
    case WandererApp.Character.get_character(character_id) do
      {:ok,
       %{
         access_token: access_token,
         refresh_token: refresh_token,
         expires_at: expires_at
       }}
      when not is_nil(access_token) and is_integer(expires_at) ->
        if expires_at - DateTime.to_unix(DateTime.utc_now()) > 0 do
          {:ok,
           %OAuth2.AccessToken{
             access_token: access_token,
             refresh_token: refresh_token,
             expires_at: expires_at
           }}
        else
          :expired
        end

      _ ->
        :expired
    end
  end

  defp do_refresh_token(character_id) do
    {:ok,
     %{
       expires_at: expires_at,
       refresh_token: refresh_token,
       scopes: scopes,
       tracking_pool: tracking_pool
     } = character} =
      WandererApp.Character.get_character(character_id)

    refresh_token_result =
      WandererApp.Ueberauth.Strategy.Eve.OAuth.get_refresh_token([],
        with_wallet: WandererApp.Character.can_track_wallet?(character),
        is_admin?: WandererApp.Character.can_track_corp_wallet?(character),
        tracking_pool: tracking_pool,
        token: %OAuth2.AccessToken{refresh_token: refresh_token}
      )

    result =
      handle_refresh_token_result(
        refresh_token_result,
        character,
        character_id,
        expires_at,
        scopes
      )

    record_sso_failure(character_id, result)

    result
  end

  # Aggregates refresh failures across characters so a wide SSO outage is recognised as
  # one event rather than many independent character faults.
  @doc false
  def record_sso_failure(character_id, {:error, error_type}) do
    marker = "#{@sso_window_marker_prefix}#{character_id}"

    if Cache.has_key?(marker) do
      # Already counted for this character in the current window.
      :ok
    else
      Cache.put(marker, true, ttl: @sso_window_ttl)

      failures = Cache.lookup!(@sso_window_failures_key, 0) + 1
      Cache.put(@sso_window_failures_key, failures, ttl: @sso_window_failures_ttl)

      Logger.info("SSO_REFRESH_FAILURE: token refresh failed",
        character_id: character_id,
        error_type: to_string(error_type),
        window_failures: failures
      )

      if failures >= @sso_degraded_character_threshold do
        mark_sso_degraded(failures)
      end
    end

    :ok
  end

  def record_sso_failure(_character_id, _result), do: :ok

  defp mark_sso_degraded(failures) do
    if sso_degraded?() do
      :ok
    else
      Logger.warning("SSO_DEGRADED: deferring token refreshes until SSO recovers",
        error_type: "sso_degraded",
        window_failures: failures,
        degraded_for_seconds: div(@sso_degraded_ttl, 1000)
      )

      :telemetry.execute([:wanderer_app, :token, :sso_degraded], %{count: 1}, %{
        window_failures: failures
      })

      Cache.put(@sso_degraded_cache_key, true, ttl: @sso_degraded_ttl)
    end

    :ok
  end

  @doc false
  def sso_degraded?, do: Cache.has_key?(@sso_degraded_cache_key)

  defp reauth_probe_deferred?(character_id), do: Cache.has_key?(reauth_probe_key(character_id))

  defp reauth_probe_key(character_id), do: "character:#{character_id}:needs_reauth_probe"

  @doc false
  # A token is only treated as dead once enough strikes have accumulated *and* they span
  # long enough that a single outage window cannot account for all of them.
  def invalid_grant_confirmed?(count, span_minutes) do
    count >= @invalid_grant_strikes and span_minutes >= @invalid_grant_min_span_minutes
  end

  # Returns {count, first_strike_at} for the current strike window.
  @doc false
  def record_invalid_grant_strike(character_id) do
    key = invalid_grant_strikes_key(character_id)
    now = DateTime.utc_now()

    case Cache.lookup!(key) do
      %{count: count, first_at: first_at} ->
        Cache.put(key, %{count: count + 1, first_at: first_at}, ttl: @invalid_grant_strikes_ttl)
        {count + 1, first_at}

      _ ->
        Cache.put(key, %{count: 1, first_at: now}, ttl: @invalid_grant_strikes_ttl)
        {1, now}
    end
  end

  defp invalid_grant_strikes_key(character_id),
    do: "character:#{character_id}:invalid_grant_strikes"

  @doc false
  def clear_invalid_grant_strikes(character_id),
    do: Cache.delete(invalid_grant_strikes_key(character_id))

  defp handle_refresh_token_result(
         {:ok, %OAuth2.AccessToken{} = token},
         character,
         character_id,
         expires_at,
         scopes
       ) do
    # Log token refresh success with timing info
    expires_at_datetime = DateTime.from_unix!(expires_at)
    time_since_expiry = DateTime.diff(DateTime.utc_now(), expires_at_datetime, :second)

    Logger.debug(
      fn ->
        "TOKEN_REFRESH_SUCCESS: Character token refreshed successfully"
      end,
      character_id: character_id,
      time_since_expiry_seconds: time_since_expiry,
      new_expires_at: token.expires_at
    )

    # Clear any previous invalid_grant strikes on successful refresh
    clear_invalid_grant_strikes(character_id)

    {:ok, _character} =
      character
      |> WandererApp.Api.Character.update(%{
        access_token: token.access_token,
        expires_at: token.expires_at,
        scopes: scopes
      })

    WandererApp.Character.update_character(character_id, %{
      access_token: token.access_token,
      expires_at: token.expires_at
    })

    # A working refresh proves the credentials are healthy, so retract any earlier
    # "needs re-authorization" verdict - it can only have come from a transient SSO
    # fault, and leaving it set would keep prompting the user to re-auth for nothing.
    if Map.get(character, :needs_reauth, false) do
      Logger.info("TOKEN_REFRESH_RECOVERED: clearing stale needs_reauth flag",
        character_id: character_id,
        error_type: "needs_reauth_cleared"
      )

      Cache.delete(reauth_probe_key(character_id))
      WandererApp.Character.set_needs_reauth(character_id, false)
    end

    Phoenix.PubSub.broadcast(
      WandererApp.PubSub,
      "character:#{character_id}",
      :token_updated
    )

    {:ok, token}
  end

  defp handle_refresh_token_result(
         {:error, {"invalid_grant", error_message}},
         character,
         character_id,
         expires_at,
         _scopes
       ) do
    expires_at_datetime = DateTime.from_unix!(expires_at)
    time_since_expiry = DateTime.diff(DateTime.utc_now(), expires_at_datetime, :second)

    # EVE SSO also returns invalid_grant for transient server issues, so strikes must be
    # spread over time before the credentials are declared dead. Counting raw failures is
    # not enough: several tracking endpoints refresh the same character within one tick,
    # so a single bad response could otherwise fill the quota on its own.
    {count, first_at} = record_invalid_grant_strike(character_id)
    span_minutes = DateTime.diff(DateTime.utc_now(), first_at, :minute)

    # Emit telemetry for token refresh failures
    :telemetry.execute([:wanderer_app, :token, :refresh_failed], %{count: 1}, %{
      character_id: character_id,
      error_type: "invalid_grant",
      time_since_expiry: time_since_expiry
    })

    if invalid_grant_confirmed?(count, span_minutes) do
      Logger.warning(
        "TOKEN_REFRESH_FAILED: Invalid grant confirmed, flagging for re-authorization",
        character_id: character_id,
        error_message: error_message,
        strike_count: count,
        strike_span_minutes: span_minutes,
        time_since_expiry_seconds: time_since_expiry,
        original_expires_at: expires_at
      )

      clear_invalid_grant_strikes(character_id)
      flag_character_for_reauth(character, character_id)
      {:error, :invalid_grant}
    else
      Logger.warning(
        "TOKEN_REFRESH_FAILED: Invalid grant deferred, strikes not yet spread over time",
        character_id: character_id,
        error_message: error_message,
        strike_count: count,
        strike_span_minutes: span_minutes,
        time_since_expiry_seconds: time_since_expiry,
        original_expires_at: expires_at
      )

      {:error, :token_refresh_failed}
    end
  end

  defp handle_refresh_token_result(
         {:error, %OAuth2.Error{reason: :econnrefused} = error},
         _character,
         character_id,
         expires_at,
         _scopes
       ) do
    expires_at_datetime = DateTime.from_unix!(expires_at)
    time_since_expiry = DateTime.diff(DateTime.utc_now(), expires_at_datetime, :second)

    Logger.warning("TOKEN_REFRESH_FAILED: Connection refused during token refresh",
      character_id: character_id,
      error: inspect(error),
      time_since_expiry_seconds: time_since_expiry,
      original_expires_at: expires_at
    )

    # Emit telemetry for connection failures
    :telemetry.execute([:wanderer_app, :token, :refresh_failed], %{count: 1}, %{
      character_id: character_id,
      error_type: "connection_refused",
      time_since_expiry: time_since_expiry
    })

    {:error, :econnrefused}
  end

  defp handle_refresh_token_result(
         {:error, %OAuth2.Error{} = error},
         _character,
         character_id,
         expires_at,
         _scopes
       ) do
    time_since_expiry =
      DateTime.diff(DateTime.utc_now(), DateTime.from_unix!(expires_at), :second)

    Logger.warning("TOKEN_REFRESH_FAILED: Transient OAuth2 error during token refresh",
      character_id: character_id,
      error: inspect(error),
      time_since_expiry_seconds: time_since_expiry
    )

    :telemetry.execute([:wanderer_app, :token, :refresh_failed], %{count: 1}, %{
      character_id: character_id,
      error_type: "oauth2_error",
      time_since_expiry: time_since_expiry
    })

    {:error, :token_refresh_failed}
  end

  # EVE SSO answered with an HTTP error that carries no OAuth error document, e.g.
  # Cloudflare's plain-text `error code: 526`. This is an upstream condition and is
  # transient, so tokens are kept and the character retries on its next cycle.
  defp handle_refresh_token_result(
         {:error, {:http_error, status, body}},
         _character,
         character_id,
         expires_at,
         _scopes
       ) do
    time_since_expiry =
      DateTime.diff(DateTime.utc_now(), DateTime.from_unix!(expires_at), :second)

    Logger.warning("TOKEN_REFRESH_FAILED: EVE SSO returned HTTP #{status} during token refresh",
      character_id: character_id,
      http_status: status,
      error_message: body,
      time_since_expiry_seconds: time_since_expiry
    )

    :telemetry.execute([:wanderer_app, :token, :refresh_failed], %{count: 1}, %{
      character_id: character_id,
      error_type: "http_error",
      http_status: status,
      time_since_expiry: time_since_expiry
    })

    {:error, :token_refresh_failed}
  end

  defp handle_refresh_token_result(error, _character, character_id, expires_at, _scopes) do
    time_since_expiry =
      DateTime.diff(DateTime.utc_now(), DateTime.from_unix!(expires_at), :second)

    Logger.warning("TOKEN_REFRESH_FAILED: Unexpected error during token refresh",
      character_id: character_id,
      error: inspect(error),
      time_since_expiry_seconds: time_since_expiry
    )

    :telemetry.execute([:wanderer_app, :token, :refresh_failed], %{count: 1}, %{
      character_id: character_id,
      error_type: "unexpected_error",
      time_since_expiry: time_since_expiry
    })

    {:error, :token_refresh_failed}
  end

  # Confirmed `invalid_grant`: the credentials are treated as dead, but the tokens are
  # deliberately *kept*. Wiping them turned a transient SSO fault into a state the user
  # had to fix by hand; keeping them lets the character heal on its own once SSO recovers
  # (the success path retracts the flag), while the flag still raises the re-authorize
  # prompt. Probes are throttled so a genuinely dead token cannot hammer SSO.
  defp flag_character_for_reauth(character, character_id) do
    # Skip if the character was recently re-authorized via SSO - fresh tokens must not be
    # condemned by in-flight or immediately-subsequent invalid_grant errors.
    if Cache.lookup!("character:#{character_id}:reauth_grace", false) do
      Logger.info(
        "[ApiClient] Skipping re-auth flag for #{character_id} - within re-auth grace period",
        character_id: character_id,
        error_type: "reauth_grace"
      )
    else
      # Re-load from DB to avoid race with concurrent re-auth
      case WandererApp.Api.Character.by_id(character_id) do
        {:ok, current_character} ->
          # Only flag if tokens haven't been refreshed since we started
          if current_character.access_token == character.access_token do
            Cache.put(reauth_probe_key(character_id), true, ttl: @reauth_probe_ttl)

            WandererApp.Character.set_needs_reauth(character_id, true)

            Phoenix.PubSub.broadcast(
              WandererApp.PubSub,
              "character:#{character_id}",
              :character_token_invalid
            )

            Logger.warning("TOKEN_INVALIDATED: character flagged for re-authorization",
              character_id: character_id,
              error_type: "invalid_grant"
            )
          else
            Logger.info(
              "[ApiClient] Skipping re-auth flag for #{character_id} - tokens were refreshed concurrently",
              character_id: character_id,
              error_type: "concurrent_refresh"
            )
          end

        {:error, _} ->
          Logger.error("Failed to load character #{character_id} for re-auth flag",
            character_id: character_id,
            error_type: "character_load_failed"
          )
      end
    end

    :ok
  end
end
