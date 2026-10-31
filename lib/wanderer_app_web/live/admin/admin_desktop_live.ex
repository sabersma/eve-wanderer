defmodule WandererAppWeb.AdminDesktopLive do
  @moduledoc """
  Admin dashboard for desktop client usage.

  Shows active installs/users (today, 7 days, 30 days), the version breakdown
  and the most recently seen installs. Data comes from heartbeats sent by the
  desktop shell (`WandererApp.DesktopUsage`).
  """

  use WandererAppWeb, :live_view

  alias WandererApp.DesktopUsage

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(:active_page, :admin)
     |> assign(:page_title, "Admin - Desktop Clients")
     |> load_usage()}
  end

  @impl true
  def handle_event("refresh", _params, socket) do
    {:noreply, load_usage(socket)}
  end

  defp load_usage(socket) do
    socket
    |> assign(:summary, DesktopUsage.summary())
    |> assign(:versions, DesktopUsage.version_breakdown(30))
    |> assign(:recent, DesktopUsage.recent(100))
    |> assign(:generated_at, DateTime.utc_now())
  end

  def format_time(nil), do: "—"
  def format_time(%DateTime{} = value), do: Calendar.strftime(value, "%Y-%m-%d %H:%M")
  def short_install_id(nil), do: "—"
  def short_install_id(value) when byte_size(value) <= 12, do: value
  def short_install_id(value), do: String.slice(value, 0, 8) <> "…"
end
