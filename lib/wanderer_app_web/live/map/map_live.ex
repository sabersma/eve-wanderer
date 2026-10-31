defmodule WandererAppWeb.MapLive do
  use WandererAppWeb, :live_view
  use LiveViewEvents

  require Logger

  @desktop_widgets ~w(signatures jspace bookmarks kills characters)

  @impl true
  def mount(%{"slug" => map_slug} = params, _session, socket) when is_connected?(socket) do
    Process.send_after(self(), %{event: :load_map}, Enum.random(10..800))

    {:ok,
     socket
     |> assign(
       map_slug: map_slug,
       map_loaded?: false,
       show_topup: false,
       active_subscription_tab: "balance",
       server_online: false,
       map_subscriptions_enabled: WandererApp.Env.map_subscriptions_enabled?(),
       active_subscription: nil,
       user_permissions: nil,
       desktop_mode?: desktop_mode?(socket),
       desktop_widget: desktop_widget(socket, params)
     )
     |> push_event("js-exec", %{
       to: "#map-loader",
       attr: "data-loading",
       timeout: 2000
     })}
  end

  @impl true
  def mount(params, _session, socket) do
    {:ok,
     socket
     |> assign(
       map_slug: nil,
       map_loaded?: false,
       show_topup: false,
       server_online: false,
       active_subscription: nil,
       map_subscriptions_enabled: WandererApp.Env.map_subscriptions_enabled?(),
       user_permissions: nil,
       desktop_mode?: desktop_mode?(socket),
       desktop_widget: desktop_widget(socket, params)
     )}
  end

  @impl true
  def handle_params(params, _url, socket),
    do: {:noreply, apply_action(socket, socket.assigns.live_action, params)}

  @impl true
  def handle_info(
        {"change_map", map_slug},
        %{assigns: %{map_id: map_id}} = socket
      ) do
    Phoenix.PubSub.unsubscribe(WandererApp.PubSub, map_id)

    target =
      if socket.assigns[:desktop_mode?],
        do: ~p"/desktop/#{map_slug}",
        else: ~p"/#{map_slug}"

    {:noreply, socket |> push_navigate(to: target)}
  end

  def handle_info(:no_main_character_set, socket),
    do:
      {:noreply,
       socket
       |> put_flash(
         :warning,
         "You don't have main character set, please update it in tracking settings (top right icon)."
       )}

  def handle_info(:map_deleted, socket),
    do:
      {:noreply,
       socket
       |> put_flash(:info, "This map has been deleted.")
       |> push_navigate(to: maps_path(socket))}

  def handle_info(:no_access, socket),
    do:
      {:noreply,
       socket
       |> put_flash(:error, "You don't have an access to this map.")
       |> push_navigate(to: maps_path(socket))}

  def handle_info(:no_permissions, socket),
    do:
      {:noreply,
       socket
       |> put_flash(:error, "You don't have permissions to use this map.")
       |> push_navigate(to: maps_path(socket))}

  def handle_info(:not_all_characters_tracked, %{assigns: %{map_slug: map_slug}} = socket),
    do:
      {:noreply,
       socket
       |> put_flash(
         :error,
         "You should enable tracking for all characters that have access to this map first!"
       )
       |> push_navigate(to: ~p"/tracking/#{map_slug}")}

  @impl true
  def handle_info(info, socket) do
    {:noreply,
     socket
     |> WandererAppWeb.MapEventHandler.handle_event(info)}
  end

  @impl true
  def handle_event("change_subscription_tab", %{"tab" => tab}, socket),
    do: {:noreply, socket |> assign(active_subscription_tab: tab)}

  @impl true
  def handle_event(event, body, socket) do
    WandererAppWeb.MapEventHandler.handle_ui_event(event, body, socket)
  end

  defp apply_action(socket, :index, _params) do
    socket
    |> assign(:active_page, :map)
    |> assign(:desktop_mode?, false)
    |> assign(:desktop_widget, nil)
  end

  defp apply_action(socket, :desktop, _params) do
    socket
    |> assign(:active_page, :map)
    |> assign(:desktop_mode?, true)
    |> assign(:desktop_widget, nil)
  end

  defp apply_action(socket, :widget, %{"widget" => widget}) when widget in @desktop_widgets do
    socket
    |> assign(:active_page, :map)
    |> assign(:desktop_mode?, true)
    |> assign(:desktop_widget, widget)
  end

  defp apply_action(socket, :widget, _params) do
    push_navigate(socket, to: ~p"/desktop/#{socket.assigns.map_slug}")
  end

  defp desktop_mode?(socket), do: socket.assigns.live_action in [:desktop, :widget]

  defp desktop_widget(%{assigns: %{live_action: :widget}}, params),
    do: Map.get(params, "widget")

  defp desktop_widget(_socket, _params), do: nil

  defp maps_path(%{assigns: %{desktop_mode?: true}}), do: ~p"/desktop"
  defp maps_path(_socket), do: ~p"/maps"
end
