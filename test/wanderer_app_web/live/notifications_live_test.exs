defmodule WandererAppWeb.NotificationsLiveTest do
  @moduledoc """
  Smoke test for `/notifications`.

  What can break without any test noticing: the route drifting below the
  single-segment `/:slug` map routes, the auth hook being dropped, and the page
  rendering when notifications are disabled (the default in tests).

  `async: false` is required — the LiveView runs in its own process, so it needs
  the shared sandbox mode that ConnCase sets up when the test is not async.
  """

  use WandererAppWeb.ConnCase, async: false

  import Phoenix.LiveViewTest

  alias WandererAppWeb.Factory

  defp signed_in_conn do
    user = Factory.insert(:user)

    build_conn()
    |> Plug.Test.init_test_session(%{"user_id" => user.id})
  end

  defp signed_in_conn_with_map do
    user = Factory.insert(:user)
    character = Factory.insert(:character, %{user_id: user.id})
    map = Factory.insert(:map, %{owner_id: character.id})

    conn =
      build_conn()
      |> Plug.Test.init_test_session(%{"user_id" => user.id})

    {conn, map}
  end

  test "anonymous visitors are sent to the login page", %{conn: conn} do
    assert {:error, {:redirect, %{to: "/welcome"}}} = live(conn, ~p"/notifications")
  end

  test "signed-in visitors see the subscription page", %{conn: _conn} do
    {:ok, _view, html} = live(signed_in_conn(), ~p"/notifications")

    assert html =~ "星系通知订阅"
    assert html =~ "通知功能当前未启用"
  end

  test "creating a subscription without a map is refused", %{conn: _conn} do
    {:ok, view, _html} = live(signed_in_conn(), ~p"/notifications")

    html = render_submit(view, "save", %{"subscription" => %{"map_id" => ""}})

    assert html =~ "请选择地图"
  end

  test "the mode switch swaps the system list for the fuzzy filters", %{conn: _conn} do
    {:ok, view, html} = live(signed_in_conn(), ~p"/notifications")

    assert html =~ "星系（每行一个"

    html = render_change(view, "validate", %{"subscription" => %{"mode" => "filters"}})

    refute html =~ "星系（每行一个"
    assert html =~ "至少设置虫洞等级、活跃天数或时区中的一个"
  end

  test "systems mode requires at least one system", %{conn: _conn} do
    {conn, map} = signed_in_conn_with_map()
    {:ok, view, _html} = live(conn, ~p"/notifications")

    html =
      render_submit(view, "save", %{
        "subscription" => %{
          "map_id" => map.id,
          "name" => "指定星系订阅",
          "mode" => "systems",
          "systems" => "",
          "recipient_emails" => "member@example.com",
          "cooldown_hours" => "24"
        }
      })

    assert html =~ "请至少填写一个星系"
  end

  test "filters mode requires at least one criterion", %{conn: _conn} do
    {conn, map} = signed_in_conn_with_map()
    {:ok, view, _html} = live(conn, ~p"/notifications")

    html =
      render_submit(view, "save", %{
        "subscription" => %{
          "map_id" => map.id,
          "name" => "条件筛选订阅",
          "mode" => "filters",
          "recipient_emails" => "member@example.com",
          "cooldown_hours" => "24"
        }
      })

    assert html =~ "按条件筛选时，请至少设置虫洞等级、活跃天数或时区中的一个"
  end
end
