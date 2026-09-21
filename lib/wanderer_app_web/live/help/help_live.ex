defmodule WandererAppWeb.HelpLive do
  @moduledoc """
  The Chinese usage manuals, one tab per audience.

  The tab lives in `?tab=` rather than in socket state so a link can point at a
  specific manual and the back button behaves.
  """

  use WandererAppWeb, :live_view

  alias WandererApp.Manual

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, page_title: "Help", tabs: Manual.tabs(), tab: Manual.default_tab())}
  end

  @impl true
  def handle_params(params, _uri, socket) do
    {:noreply, assign(socket, tab: Manual.normalize_tab(params["tab"]))}
  end

  @impl true
  def handle_event("switch_tab", %{"tab" => tab}, socket) do
    {:noreply, push_patch(socket, to: "/help?tab=#{Manual.normalize_tab(tab)}")}
  end
end
