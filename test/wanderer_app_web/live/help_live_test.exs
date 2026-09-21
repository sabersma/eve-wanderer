defmodule WandererAppWeb.HelpLiveTest do
  @moduledoc """
  Smoke test for `/help`.

  What can break here without any test noticing: the route drifting below the
  single-segment `/:slug` map route (so `/help` becomes a map named "help"), the
  auth hook being dropped, and the tab falling back to the wrong manual.

  `async: false` is required — the LiveView runs in its own process, so it needs
  the shared sandbox mode that ConnCase sets up when the test is not async.
  """

  use WandererAppWeb.ConnCase, async: false

  import Phoenix.LiveViewTest

  alias WandererAppWeb.Factory

  @user_heading "Wanderer 使用手册 · 普通用户篇"
  @creator_heading "Wanderer 使用手册 · 地图创建者篇"

  defp signed_in_conn do
    user = Factory.insert(:user)

    build_conn()
    |> Plug.Test.init_test_session(%{"user_id" => user.id})
  end

  test "anonymous visitors are sent to the login page", %{conn: conn} do
    assert {:error, {:redirect, %{to: "/welcome"}}} = live(conn, ~p"/help")
  end

  test "signed-in visitors land on the user manual", %{conn: _conn} do
    {:ok, view, html} = live(signed_in_conn(), ~p"/help")

    assert html =~ @user_heading
    refute html =~ @creator_heading
    assert has_element?(view, "button[phx-value-tab='user']")
    assert has_element?(view, "button[phx-value-tab='creator']")
  end

  test "the tab bar switches manuals and updates the URL", %{conn: _conn} do
    {:ok, view, _html} = live(signed_in_conn(), ~p"/help")

    html = view |> element("button[phx-value-tab='creator']") |> render_click()

    assert html =~ @creator_heading
    refute html =~ @user_heading
    assert_patch(view, ~p"/help?tab=creator")
  end

  test "?tab=creator opens straight onto the creator manual", %{conn: _conn} do
    {:ok, _view, html} = live(signed_in_conn(), ~p"/help?tab=creator")

    assert html =~ @creator_heading
    refute html =~ @user_heading
  end

  test "an unknown tab falls back to the user manual", %{conn: _conn} do
    # Guards against a hand-typed /help?tab=oops rendering an empty <article>.
    {:ok, _view, html} = live(signed_in_conn(), ~p"/help?tab=oops")

    assert html =~ @user_heading
  end

  test "the manual is rendered with working in-page anchors", %{conn: _conn} do
    {:ok, _view, html} = live(signed_in_conn(), ~p"/help")

    # Spot-check one 目录 link end to end: the link target and the heading id
    # have to agree. The full correspondence is covered in
    # test/unit/manual_renderer_test.exs.
    [_, anchor] = Regex.run(~r/\]\(#([^)]+)\)/, File.read!("priv/manual/user-guide.md"))

    assert html =~ ~s(href="##{anchor}")
    assert html =~ ~s(id="#{anchor}")
  end
end
