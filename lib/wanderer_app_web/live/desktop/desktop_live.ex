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
end
