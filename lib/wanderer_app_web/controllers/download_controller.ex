defmodule WandererAppWeb.DownloadController do
  @moduledoc """
  Download page for the Windows desktop client.

  Logged-in users only. `:require_auth` stores the requested path and sends
  anonymous visitors through SSO (`UserAuth.redirect_after_login/1` brings them
  back here). The archive is served from `WANDERER_DESKTOP_DOWNLOAD_DIR` by
  `Plug.Static`, so it keeps ETag and Range (resumable download) support while
  staying behind the same auth pipeline — mounting it in the endpoint would
  make it public.
  """

  use WandererAppWeb, :controller

  alias WandererApp.Env

  @download_mount "/download/desktop"

  def desktop(conn, _params) do
    download = Env.desktop_download_info()

    render(conn, "desktop.html",
      version: Env.desktop_latest_version(),
      notes: present_string(Env.desktop_update_notes()),
      download: download,
      size_mb: download && Float.round(download.size / 1_048_576, 1),
      server_url: server_url()
    )
  end

  # `web_app_url` is what members type into the client: it is the only setting
  # that carries a subpath deployment (`https://example.com/wanderer`).
  defp server_url do
    case Env.base_url() do
      url when is_binary(url) ->
        if String.starts_with?(url, ["http://", "https://"]) do
          url
        else
          WandererAppWeb.Endpoint.url()
        end

      _ ->
        WandererAppWeb.Endpoint.url()
    end
  end

  def desktop_file(conn, %{"file" => file}) do
    case Env.desktop_download_info() do
      %{filename: ^file, path: path} -> serve_archive(conn, path)
      _ -> not_found(conn)
    end
  end

  defp serve_archive(conn, path) do
    conn =
      Plug.Static.call(
        conn,
        Plug.Static.init(
          at: @download_mount,
          from: Path.dirname(path),
          gzip: false,
          only: [Path.basename(path)],
          # The route needs a login, so shared caches must not keep a copy.
          cache_control_for_etags: "private, max-age=31536000, immutable"
        )
      )

    # Plug.Static leaves the connection untouched on a miss (e.g. the file was
    # removed between the stat above and the response); reply 404 ourselves.
    if conn.state == :unset, do: not_found(conn), else: conn
  end

  defp not_found(conn) do
    send_resp(conn, 404, "安装包不存在")
  end

  defp present_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp present_string(_value), do: nil
end
