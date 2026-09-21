defmodule WandererApp.Manual.RendererTest do
  @moduledoc """
  Guards the parts of `/help` that break silently.

  Two failure modes motivate this file, neither of which shows up as a compile
  error or an exception:

    * Each manual opens with a hand-written 目录 whose links are GitHub-style
      anchors (`#1-五分钟上手`). Edit a heading and its anchor stops resolving —
      the page still renders, the link just does nothing.
    * Screenshots are referenced by a literal path. A typo renders a broken
      image icon next to otherwise-fine prose.

  The HTML comes from `WandererApp.Manual`, not from calling the renderer, so
  this covers the exact bytes the page serves.
  """

  use ExUnit.Case, async: true

  alias WandererApp.Manual.Renderer

  @manuals [
    {"user", "priv/manual/user-guide.md"},
    {"creator", "priv/manual/creator-guide.md"}
  ]

  # vite.config.js sets `publicDir: './static'`, so assets/static/ is copied to
  # priv/static/ verbatim at build time. This is that mapping.
  @image_dir "assets/static/images/manual"
  @image_url "/images/manual/"

  test "every 目录 anchor points at a heading that exists" do
    for {tab, path} <- @manuals do
      anchors = Regex.scan(~r/\]\(#([^)]+)\)/, File.read!(path)) |> Enum.map(&Enum.at(&1, 1))
      html = WandererApp.Manual.html(tab)

      assert anchors != [], "#{tab}: found no 目录 anchors — did the 目录 change shape?"

      for anchor <- anchors do
        assert html =~ ~s(id="#{anchor}"),
               "#{tab}: 目录 links to ##{anchor}, but no heading carries that id"
      end
    end
  end

  test "heading ids are unique within a manual" do
    for {tab, _path} <- @manuals do
      ids =
        Regex.scan(~r/<h[1-6] id="([^"]*)"/, WandererApp.Manual.html(tab))
        |> Enum.map(&Enum.at(&1, 1))

      duplicates = ids |> Enum.frequencies() |> Enum.filter(fn {_, count} -> count > 1 end)

      assert duplicates == [], "#{tab}: duplicate heading ids #{inspect(duplicates)}"
    end
  end

  test "every screenshot reference points at a file that exists" do
    for {tab, path} <- @manuals, src <- image_sources(File.read!(path)) do
      assert String.starts_with?(src, @image_url),
             "#{tab}: #{src} is outside #{@image_url}, which is the only path served"

      file = Path.join(@image_dir, Path.basename(src))

      assert File.exists?(file), "#{tab}: references #{src}, but #{file} does not exist"

      assert File.stat!(file).size > 0, "#{tab}: #{file} is empty"
    end
  end

  test "the manual images directory is actually served" do
    # Plug.Static only serves the prefixes in static_paths/0. Dropping "images"
    # there would 404 every screenshot while the HTML still looked right.
    assert "images" in WandererAppWeb.static_paths()
  end

  test "author notes never reach the page" do
    for {tab, _path} <- @manuals do
      html = WandererApp.Manual.html(tab)

      refute html =~ "需要截图", "#{tab}: an authoring note is visible to readers"
      refute html =~ "🖼️", "#{tab}: an unfilled screenshot placeholder is visible to readers"
    end
  end

  test "a screenshot placeholder renders as a caption, without its recipe" do
    # Both manuals currently have every screenshot filled in, so this exercises
    # the renderer directly rather than relying on the source still having one.
    markdown = """
    ## 目录

    - [二](#二)

    ## 二

    > 🖼️ **【图 1】某个页面**
    > 需要截图：角色页面整页，要能看清右上角开关。

    正文。
    """

    html = Renderer.render(markdown)

    refute html =~ "需要截图"
    assert html =~ "待补图"
    assert html =~ "某个页面"
    assert html =~ ~s(id="二")
  end

  defp image_sources(markdown) do
    Regex.scan(~r/!\[[^\]]*\]\(([^)]+)\)/, markdown) |> Enum.map(&Enum.at(&1, 1))
  end
end
