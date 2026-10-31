defmodule WandererAppWeb.DesktopLive do
  use WandererAppWeb, :live_view

  @impl true
  def mount(_params, _session, %{assigns: %{current_user: current_user}} = socket)
      when not is_nil(current_user) and is_connected?(socket) do
    {:ok, maps} = WandererApp.Maps.get_available_maps(current_user)

    {:ok,
     socket
     |> assign(
       maps: Enum.sort_by(maps, & &1.name, :asc),
       page_title: "Wanderer Desktop"
     )}
  end

  def mount(_params, _session, socket) do
    {:ok, assign(socket, maps: [], page_title: "Wanderer Desktop")}
  end

  # Sent by the desktop shell hook (assets/js/hooks/desktopShell.ts) once per
  # window mount. Widget windows are upserted by install id, so they add no
  # extra installs.
  @impl true
  def handle_event("desktop_heartbeat", payload, socket) do
    if user = socket.assigns[:current_user] do
      WandererApp.DesktopUsage.record_heartbeat(user.id, payload)
    end

    {:noreply, socket}
  end
end
