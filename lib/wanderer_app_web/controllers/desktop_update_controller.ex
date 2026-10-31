defmodule WandererAppWeb.DesktopUpdateController do
  @moduledoc """
  Public version manifest for the desktop client shell.

  The shell checks this at startup and tells the user where to get a new build.
  It is intentionally unauthenticated: the check runs before (or without) a
  logged-in map, and it exposes nothing but release metadata.

  Configure with `WANDERER_DESKTOP_LATEST_VERSION` and `WANDERER_DESKTOP_UPDATE_NOTES`;
  with neither set, the latest version is the desktop version compiled into this
  release (read from `desktop/src-tauri/tauri.conf.json` at build time).
  """

  use WandererAppWeb, :controller

  def show(conn, _params) do
    json(conn, %{
      latest: WandererApp.Env.desktop_latest_version(),
      notes: WandererApp.Env.desktop_update_notes()
    })
  end
end
