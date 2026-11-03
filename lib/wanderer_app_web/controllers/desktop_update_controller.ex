defmodule WandererAppWeb.DesktopUpdateController do
  @moduledoc """
  Public version manifest for the desktop client shell.

  The shell checks this at startup and tells the user where to get a new build.
  It is intentionally unauthenticated: the check runs before (or without) a
  logged-in map, and it exposes nothing but release metadata.

  Configure with `WANDERER_DESKTOP_LATEST_VERSION` and `WANDERER_DESKTOP_UPDATE_NOTES`;
  with neither set, the latest version is the desktop version compiled into this
  release (read from `desktop/src-tauri/tauri.conf.json` at build time).

  `page` and `download` point at the login-protected download page. They are
  only advertised here: `/download/desktop` is what asks anonymous visitors to
  log in, which the shell handles by opening the system browser.
  """

  use WandererAppWeb, :controller

  def show(conn, _params) do
    json(conn, %{
      latest: WandererApp.Env.desktop_latest_version(),
      notes: WandererApp.Env.desktop_update_notes(),
      page: ~p"/download/desktop",
      download: download_path()
    })
  end

  # nil when the archive was not uploaded yet. The shell still opens `page`
  # (which explains the missing upload), but a direct client that prefers the
  # file must not be sent to a 404.
  defp download_path do
    case WandererApp.Env.desktop_download_info() do
      %{filename: filename} -> ~p"/download/desktop/#{filename}"
      _ -> nil
    end
  end
end
