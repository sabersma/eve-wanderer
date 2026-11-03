defmodule WandererAppWeb.UserAuthTest do
  use WandererAppWeb.ConnCase, async: false

  alias WandererAppWeb.UserAuth

  describe "require_authenticated_user/2" do
    test "remembers the requested page before redirecting to login" do
      conn =
        Plug.Test.conn(:get, "/download/desktop?from=notice")
        |> Plug.Test.init_test_session(%{})
        |> assign(:current_user, nil)
        |> UserAuth.require_authenticated_user([])

      assert conn.halted
      assert redirected_to(conn) == "/characters"
      assert get_session(conn, :user_return_to) == "/download/desktop?from=notice"
    end

    test "does not store non-GET requests" do
      conn =
        Plug.Test.conn(:post, "/download/desktop")
        |> Plug.Test.init_test_session(%{})
        |> assign(:current_user, nil)
        |> UserAuth.require_authenticated_user([])

      assert redirected_to(conn) == "/characters"
      refute get_session(conn, :user_return_to)
    end

    test "lets authenticated users through" do
      conn =
        Plug.Test.conn(:get, "/download/desktop")
        |> Plug.Test.init_test_session(%{})
        |> assign(:current_user, %{id: "user-id"})
        |> UserAuth.require_authenticated_user([])

      refute conn.halted
      assert conn.status == nil
    end
  end

  describe "redirect_after_login/1" do
    test "returns to the remembered page and clears it", %{conn: conn} do
      conn =
        conn
        |> Plug.Test.init_test_session(%{"user_return_to" => "/download/desktop"})
        |> UserAuth.redirect_after_login()

      assert redirected_to(conn) == "/download/desktop"
      refute get_session(conn, :user_return_to)
    end

    test "falls back to /characters without a remembered page", %{conn: conn} do
      conn =
        conn
        |> Plug.Test.init_test_session(%{})
        |> UserAuth.redirect_after_login()

      assert redirected_to(conn) == "/characters"
    end

    test "drops external and malformed return paths", %{conn: conn} do
      for path <- [
            "https://evil.example",
            "//evil.example",
            "/\\evil.example",
            "/a\nb",
            "relative"
          ] do
        conn =
          conn
          |> Plug.Test.init_test_session(%{"user_return_to" => path})
          |> UserAuth.redirect_after_login()

        assert redirected_to(conn) == "/characters", "expected #{inspect(path)} to be rejected"
        refute get_session(conn, :user_return_to)
      end
    end
  end

  describe "local_return_path/1" do
    test "accepts same-site absolute paths" do
      assert UserAuth.local_return_path("/download/desktop") == "/download/desktop"
      assert UserAuth.local_return_path("/download/desktop?x=1") == "/download/desktop?x=1"
    end

    test "rejects anything else" do
      for path <- [
            nil,
            "",
            "download",
            "//evil.example",
            "https://evil.example",
            "/back\\slash",
            "/control\x00char"
          ] do
        assert UserAuth.local_return_path(path) == nil
      end
    end
  end
end
