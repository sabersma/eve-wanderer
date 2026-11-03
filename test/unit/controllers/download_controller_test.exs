defmodule WandererAppWeb.DownloadControllerTest do
  # The download dir and version are process-independent application config, so
  # these tests must run one at a time.
  use WandererAppWeb.ConnCase, async: false

  alias WandererAppWeb.Factory

  @version "9.9.9"
  @default_file "Wanderer_#{@version}_x64.zip"

  setup do
    dir =
      Path.join(
        System.tmp_dir!(),
        "wanderer-download-test-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(dir)

    previous_dir = Application.get_env(:wanderer_app, :desktop_download_dir)
    previous_file = Application.get_env(:wanderer_app, :desktop_download_file)
    previous_version = Application.get_env(:wanderer_app, :desktop_latest_version)

    Application.put_env(:wanderer_app, :desktop_download_dir, dir)
    Application.delete_env(:wanderer_app, :desktop_download_file)
    Application.put_env(:wanderer_app, :desktop_latest_version, @version)

    on_exit(fn ->
      restore_env(:desktop_download_dir, previous_dir)
      restore_env(:desktop_download_file, previous_file)
      restore_env(:desktop_latest_version, previous_version)
      File.rm_rf(dir)
    end)

    %{dir: dir}
  end

  defp restore_env(key, nil), do: Application.delete_env(:wanderer_app, key)
  defp restore_env(key, value), do: Application.put_env(:wanderer_app, key, value)

  defp logged_in_conn do
    user = Factory.insert(:user)

    build_conn()
    |> Plug.Test.init_test_session(%{"user_id" => user.id})
  end

  defp write_archive(dir, filename, contents \\ "PK\x03\x04fake zip") do
    path = Path.join(dir, filename)
    File.write!(path, contents)
    path
  end

  describe "GET /download/desktop" do
    test "sends anonymous visitors through the login flow", %{conn: conn} do
      conn = get(conn, "/download/desktop")

      assert redirected_to(conn) == "/characters"
      assert get_session(conn, :user_return_to) == "/download/desktop"
    end

    test "shows version, file name, size and checksum", %{dir: dir} do
      write_archive(dir, @default_file, :binary.copy(<<0>>, 1_572_864))

      File.write!(
        Path.join(dir, @default_file <> ".sha256"),
        "abc123deadbeef  #{@default_file}\n"
      )

      conn = get(logged_in_conn(), "/download/desktop")
      html = html_response(conn, 200)

      assert html =~ @version
      assert html =~ @default_file
      assert html =~ "1.5 MB"
      assert html =~ "abc123deadbeef"
      assert html =~ "/download/desktop/#{@default_file}"
    end

    test "warns instead of linking when the archive is missing" do
      conn = get(logged_in_conn(), "/download/desktop")
      html = html_response(conn, 200)

      assert html =~ "服务端还没有上传 #{@version} 的安装包"
      refute html =~ "/download/desktop/#{@default_file}"
    end

    test "uses WANDERER_DESKTOP_DOWNLOAD_FILE when set", %{dir: dir} do
      Application.put_env(:wanderer_app, :desktop_download_file, "custom.zip")
      write_archive(dir, "custom.zip")

      conn = get(logged_in_conn(), "/download/desktop")
      html = html_response(conn, 200)

      assert html =~ "custom.zip"
      assert html =~ "/download/desktop/custom.zip"
    end
  end

  describe "GET /download/desktop/:file" do
    test "serves the archive with range support", %{dir: dir} do
      contents = "PK\x03\x04wanderer archive"
      write_archive(dir, @default_file, contents)

      conn = get(logged_in_conn(), "/download/desktop/#{@default_file}")

      assert response(conn, 200) == contents
      assert get_resp_header(conn, "accept-ranges") == ["bytes"]
      assert get_resp_header(conn, "content-type") == ["application/zip"]

      ranged =
        logged_in_conn()
        |> put_req_header("range", "bytes=0-3")
        |> get("/download/desktop/#{@default_file}")

      assert response(ranged, 206) == "PK\x03\x04"
      assert [content_range] = get_resp_header(ranged, "content-range")
      assert content_range =~ "bytes 0-3/"
    end

    test "requires login", %{dir: dir, conn: conn} do
      write_archive(dir, @default_file)

      conn = get(conn, "/download/desktop/#{@default_file}")

      assert redirected_to(conn) == "/characters"
      assert get_session(conn, :user_return_to) == "/download/desktop/#{@default_file}"
    end

    test "404s for a name that is not the advertised archive", %{dir: dir} do
      write_archive(dir, "other.zip")

      conn = get(logged_in_conn(), "/download/desktop/other.zip")

      assert response(conn, 404) == "安装包不存在"
    end

    test "404s when the archive disappeared from disk", %{dir: dir} do
      path = write_archive(dir, @default_file)
      File.rm!(path)

      conn = get(logged_in_conn(), "/download/desktop/#{@default_file}")

      assert response(conn, 404) == "安装包不存在"
    end
  end

  describe "GET /desktop/update.json" do
    test "advertises the page and archive", %{dir: dir, conn: conn} do
      write_archive(dir, @default_file)

      payload =
        conn
        |> get("/desktop/update.json")
        |> json_response(200)

      assert payload["latest"] == @version
      assert payload["page"] == "/download/desktop"
      assert payload["download"] == "/download/desktop/#{@default_file}"
    end

    test "advertises only the page while the archive is missing", %{conn: conn} do
      payload =
        conn
        |> get("/desktop/update.json")
        |> json_response(200)

      assert payload["page"] == "/download/desktop"
      assert payload["download"] == nil
    end
  end

  describe "archive name safety" do
    test "ignores a directory component in the configured name", %{dir: dir} do
      Application.put_env(:wanderer_app, :desktop_download_file, "../../#{@default_file}")
      write_archive(dir, @default_file)

      html = logged_in_conn() |> get("/download/desktop") |> html_response(200)

      assert html =~ "/download/desktop/#{@default_file}"
      refute html =~ "/download/desktop/.."
    end

    test "rejects a configured name that is not a zip file" do
      Application.put_env(:wanderer_app, :desktop_download_file, "notes.txt")

      html = logged_in_conn() |> get("/download/desktop") |> html_response(200)

      assert html =~ "服务端还没有上传 #{@version} 的安装包"
    end
  end
end
