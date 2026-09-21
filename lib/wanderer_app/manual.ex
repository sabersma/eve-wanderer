defmodule WandererApp.Manual do
  @moduledoc """
  The in-app usage manuals served at `/help`.

  The Markdown lives under `priv/manual/`. It has to: `/help` is behind a login,
  and `priv/` is the only directory the Dockerfile copies that can hold it —
  the manuals used to sit in `docs/`, which never reaches the release image.

  Conversion happens at compile time (see `WandererApp.Manual.Renderer`), so
  serving a page costs nothing, and `@external_resource` brings the files back
  into `mix compile` when they change.

  Only one manual is ever in the DOM — the two share a few heading ids (`目录`,
  `21-登录`, …), so rendering both tabs at once would duplicate them.
  """

  alias WandererApp.Manual.Renderer

  @user_guide_path Path.expand("../../priv/manual/user-guide.md", __DIR__)
  @creator_guide_path Path.expand("../../priv/manual/creator-guide.md", __DIR__)

  @external_resource @user_guide_path
  @external_resource @creator_guide_path

  @tabs [
    %{id: "user", label: "普通用户", html: @user_guide_path |> File.read!() |> Renderer.render()},
    %{
      id: "creator",
      label: "地图创建者",
      html: @creator_guide_path |> File.read!() |> Renderer.render()
    }
  ]

  @default_tab "user"

  # Deliberately without the HTML: this is what goes into assigns, and both
  # manuals together are a few hundred kilobytes that would then sit in every
  # help page's socket for no reason. The body is fetched per render instead.
  @doc "标签页的 id 与显示名，顺序即页面上的顺序。"
  def tabs, do: Enum.map(@tabs, &Map.take(&1, [:id, :label]))

  @doc "默认标签页，也是 `?tab=` 给了无法识别的值时的兜底。"
  def default_tab, do: @default_tab

  @doc "把 `?tab=` 参数归一化成一个存在的标签 id。"
  def normalize_tab(tab) do
    if Enum.any?(@tabs, &(&1.id == tab)), do: tab, else: @default_tab
  end

  @doc "某个标签页的 HTML。"
  def html(tab), do: @tabs |> Enum.find(&(&1.id == tab)) |> Map.fetch!(:html)
end
