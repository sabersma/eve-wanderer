defmodule WandererApp.Env do
  @moduledoc false
  use Nebulex.Caching

  @app :wanderer_app

  # The desktop release version is committed in the Tauri config. Baking it in at
  # compile time means a server image built from this commit knows which client
  # version to advertise without any deployment configuration. The Dockerfile
  # copies this one file into the build stage for exactly this reason.
  @desktop_version_file Path.expand("../../desktop/src-tauri/tauri.conf.json", __DIR__)
  @external_resource @desktop_version_file
  @desktop_build_version (case File.read(@desktop_version_file) do
                            {:ok, contents} ->
                              case Regex.run(~r/"version"\s*:\s*"([^"]+)"/, contents) do
                                [_, version] -> version
                                _ -> "0.0.0"
                              end

                            {:error, _} ->
                              # Not available in this build (e.g. lib copied without desktop/): do not
                              # advertise a version, so no client is told to update.
                              "0.0.0"
                          end)

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "vsn_version"
            )
  def vsn(), do: Application.spec(@app)[:vsn]

  def git_sha(), do: get_key(:git_sha, "<GIT_SHA>")
  def base_url(), do: get_key(:web_app_url, "<BASE_URL>")
  def base_metrics_only(), do: get_key(:base_metrics_only, false)
  def custom_route_base_url(), do: get_key(:custom_route_base_url, "<CUSTOM_ROUTE_BASE_URL>")
  def invites(), do: get_key(:invites, false)

  def map_subscriptions_enabled?(), do: get_key(:map_subscriptions_enabled, false)
  def public_api_disabled?(), do: get_key(:public_api_disabled, false)

  @doc """
  Whether system notification subscriptions are enabled. Requires both
  `WANDERER_NOTIFICATIONS_ENABLED` and a configured SMTP relay; see
  `config/runtime.exs`.
  """
  def notifications_enabled?() do
    :notifications |> get_key([]) |> Keyword.get(:enabled, false)
  end

  @doc "Sender name and address used for notification emails."
  def notifications_config() do
    :notifications |> get_key([]) |> Keyword.put_new(:from_name, "Wanderer")
  end

  @doc """
  How many systems a user with the `add_system` permission (a member) may
  subscribe to on a map. Configured with `WANDERER_SUBSCRIPTION_LIMIT_MEMBER`.
  """
  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "subscription_limit_member"
            )
  def subscription_limit_member(), do: get_key(:subscription_limit_member, 10)

  @doc """
  How many systems a read-only user (a viewer) may subscribe to on a map.
  Configured with `WANDERER_SUBSCRIPTION_LIMIT_VIEWER`.
  """
  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "subscription_limit_viewer"
            )
  def subscription_limit_viewer(), do: get_key(:subscription_limit_viewer, 1)

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "active_tracking_pool"
            )
  def active_tracking_pool(), do: get_key(:active_tracking_pool, "default")

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "tracking_pool_max_size"
            )
  def tracking_pool_max_size(), do: get_key(:tracking_pool_max_size, 300)
  def character_tracking_pause_disabled?(), do: get_key(:character_tracking_pause_disabled, true)
  def character_api_disabled?(), do: get_key(:character_api_disabled, false)
  def wanderer_kills_service_enabled?(), do: get_key(:wanderer_kills_service_enabled, false)
  def wallet_tracking_enabled?(), do: get_key(:wallet_tracking_enabled, false)
  def admins(), do: get_key(:admins, [])
  def admin_username(), do: get_key(:admin_username)
  def admin_password(), do: get_key(:admin_password)
  def corp_wallet(), do: get_key(:corp_wallet, "")
  def corp_wallet_eve_id(), do: get_key(:corp_wallet_eve_id, "-1")
  def corp_eve_id(), do: get_key(:corp_id, -1)
  def subscription_settings(), do: get_key(:subscription_settings)

  @doc """
  Returns the promo code configuration map.
  Keys are uppercase code strings, values are discount percentages.
  """
  def promo_codes() do
    case subscription_settings() do
      %{promo_codes: codes} when is_map(codes) -> codes
      _ -> %{}
    end
  end

  @doc """
  Validates a promo code and returns the discount percentage.
  Returns {:ok, discount_percent} if valid, {:error, :invalid_code} otherwise.
  Codes are case-insensitive.
  """
  def validate_promo_code(nil), do: {:error, :invalid_code}
  def validate_promo_code(""), do: {:error, :invalid_code}

  def validate_promo_code(code) when is_binary(code) do
    normalized = String.upcase(String.trim(code))

    case Map.get(promo_codes(), normalized) do
      nil -> {:error, :invalid_code}
      discount when is_integer(discount) and discount > 0 and discount <= 100 -> {:ok, discount}
      _ -> {:error, :invalid_code}
    end
  end

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "restrict_maps_creation"
            )
  def restrict_maps_creation?(), do: get_key(:restrict_maps_creation, false)

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "restrict_acls_creation"
            )
  def restrict_acls_creation?(), do: get_key(:restrict_acls_creation, false)

  @doc """
  Latest desktop client version. The shell compares its own version against it
  and points the user at `/download/desktop` when it is older.

  `WANDERER_DESKTOP_LATEST_VERSION` overrides it; otherwise this is the desktop
  version present in `desktop/src-tauri/tauri.conf.json` when the server was
  compiled.
  """
  def desktop_latest_version do
    case get_key(:desktop_latest_version) do
      version when is_binary(version) and version != "" -> version
      _ -> @desktop_build_version
    end
  end

  @doc "Release notes shown in the desktop update prompt."
  def desktop_update_notes(), do: get_key(:desktop_update_notes, "")

  @doc """
  Directory holding the Windows release archives served by `/download/desktop`.

  Docker deployments mount the host directory at `/app/downloads`; set
  `WANDERER_DESKTOP_DOWNLOAD_DIR` to use another path.
  """
  def desktop_download_dir do
    case get_key(:desktop_download_dir) do
      dir when is_binary(dir) and dir != "" -> dir
      _ -> nil
    end
  end

  @doc """
  File name of the current release archive.

  Defaults to the name `desktop/scripts/build.ps1` produces for the version in
  `tauri.conf.json`; `WANDERER_DESKTOP_DOWNLOAD_FILE` overrides it.
  """
  def desktop_download_filename do
    case get_key(:desktop_download_file) do
      file when is_binary(file) and file != "" -> Path.basename(file)
      _ -> "Wanderer_#{desktop_latest_version()}_x64.zip"
    end
  end

  @doc """
  Metadata for the archive currently offered for download, or `nil` when it is
  not on disk (for example the server was deployed before the archive was
  uploaded). The check lives here so the download page and the update manifest
  never advertise a file that would 404.
  """
  def desktop_download_info do
    with dir when is_binary(dir) <- desktop_download_dir(),
         filename when is_binary(filename) <- safe_archive_name(desktop_download_filename()),
         path = Path.join(dir, filename),
         {:ok, %File.Stat{type: :regular, size: size}} <- File.stat(path) do
      %{filename: filename, path: path, size: size, sha256: read_sha256(path)}
    else
      _ -> nil
    end
  end

  defp safe_archive_name(name) do
    if Regex.match?(~r/\A[A-Za-z0-9._-]+\.zip\z/, name), do: name
  end

  # build.ps1 writes "<hash>  <file>" to <zip>.sha256; the first token is the
  # digest. A missing checksum file only means the page omits the hash.
  defp read_sha256(path) do
    case File.read(path <> ".sha256") do
      {:ok, contents} -> contents |> String.trim() |> String.split() |> List.first()
      _ -> nil
    end
  end

  def sse_enabled?() do
    Application.get_env(@app, :sse, [])
    |> Keyword.get(:enabled, false)
  end

  def webhooks_enabled?() do
    Application.get_env(@app, :external_events, [])
    |> Keyword.get(:webhooks_enabled, false)
  end

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "map-connection-auto-expire-hours"
            )
  def map_connection_auto_expire_hours(), do: get_key(:map_connection_auto_expire_hours)

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "map-connection-auto-eol-hours"
            )
  def map_connection_auto_eol_hours(), do: get_key(:map_connection_auto_eol_hours)

  @decorate cacheable(
              cache: WandererApp.Cache,
              key: "map-connection-eol-expire-timeout-mins"
            )
  def map_connection_eol_expire_timeout_mins(),
    do: get_key(:map_connection_eol_expire_timeout_mins)

  def get_key(key, default \\ nil), do: Application.get_env(@app, key, default)

  @doc """
  A single map containing environment variables
  made available to react
  """
  def to_client_env() do
    %{detailedKillsDisabled: not wanderer_kills_service_enabled?()}
  end
end
