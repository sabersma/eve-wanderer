defmodule WandererApp.Manual.Renderer do
  @moduledoc """
  Turns a manual's Markdown into the HTML served at `/help`.

  Kept apart from `WandererApp.Manual` because that module renders the manuals
  in its own body, at compile time, and a module body cannot call the functions
  it defines.
  """

  @heading_tags ~w(h1 h2 h3 h4 h5 h6)

  @doc """
  Renders one manual.

  Beyond plain Markdown conversion this does two things Earmark cannot:

    * drops the screenshot recipes (see `strip_author_notes/1`)
    * puts ids on the headings, so the 目录 at the top of each manual navigates
  """
  def render(markdown) do
    markdown = strip_author_notes(markdown)
    markdown |> Earmark.as_html!() |> add_heading_ids(heading_slugs(markdown))
  end

  # The 🖼️ blocks carry screenshot recipes addressed to whoever maintains the
  # manual ("需要截图：…"), which is not something a reader should be shown. Keep
  # the caption so the page still says a screenshot is coming and drop the rest
  # of the blockquote — some of these run to four lines. Once a real screenshot
  # replaces a block there is no 🖼️ line left, so this stops applying on its own.
  defp strip_author_notes(markdown) do
    markdown
    |> String.split("\n")
    |> Enum.reduce({[], false}, fn
      # Checked before the drop clause below so a caption is never swallowed.
      "> 🖼️" <> _ = caption, {acc, _} -> {[caption <> "（待补图）" | acc], true}
      ">" <> _, {acc, true} -> {acc, true}
      line, {acc, _} -> {[line | acc], false}
    end)
    |> elem(0)
    |> Enum.reverse()
    |> Enum.join("\n")
  end

  # Earmark does not put ids on headings, but both manuals open with a 目录 whose
  # links are GitHub-style anchors (`#1-五分钟上手`), so without this every entry
  # in the table of contents is a dead link.
  #
  # The slugs come from the parse tree rather than from the rendered HTML: a
  # heading holding a code span, e.g. `### 8.6 …`/tracking/<slug>``, comes back
  # out of the HTML as `/tracking/&lt;slug&gt;`, and the entity letters would
  # survive slugging, yielding `trackingltsluggt`. The AST keeps the source text,
  # which is what the hand-written anchors were written against.
  defp heading_slugs(markdown) do
    {:ok, ast, _messages} = Earmark.Parser.as_ast(markdown)

    ast
    |> heading_texts()
    |> Enum.map(&slugify/1)
    |> uniquify()
  end

  defp heading_texts(nodes) when is_list(nodes), do: Enum.flat_map(nodes, &heading_texts/1)

  # `hr` also matches a naive "h" <> _ prefix, and a stray one would desync the
  # slugs from the headings, so the level is matched exactly.
  defp heading_texts({tag, _attrs, content, _meta}) when tag in @heading_tags,
    do: [text_of(content)]

  defp heading_texts({_tag, _attrs, content, _meta}), do: heading_texts(content)
  defp heading_texts(_leaf), do: []

  defp text_of(content) when is_binary(content), do: content
  defp text_of(content) when is_list(content), do: Enum.map_join(content, "", &text_of/1)
  defp text_of({_tag, _attrs, content, _meta}), do: text_of(content)
  defp text_of(_leaf), do: ""

  # Mirrors GitHub's slug rules, except that runs of whitespace collapse to a
  # single dash where GitHub would emit one dash per space. No anchor in either
  # manual depends on that difference.
  defp slugify(text) do
    text
    |> String.downcase()
    |> then(&Regex.replace(~r/[^\p{L}\p{N}\s-]/u, &1, ""))
    |> String.trim()
    |> then(&Regex.replace(~r/\s+/, &1, "-"))
  end

  # Unreachable for the current manuals, but a renamed section is all it takes
  # for two headings to collide, and a duplicate id silently breaks the second
  # one's anchor. Suffix the way GitHub does.
  defp uniquify(slugs) do
    {result, _} =
      Enum.map_reduce(slugs, %{}, fn slug, seen ->
        count = Map.get(seen, slug, 0)
        {if(count == 0, do: slug, else: "#{slug}-#{count}"), Map.put(seen, slug, count + 1)}
      end)

    result
  end

  # Headings are in document order in both the AST and the HTML, so the two
  # lists have to line up one-for-one. Anything else means the parser and the
  # renderer disagreed, and carrying on would put ids on the wrong headings.
  defp add_heading_ids(html, slugs) do
    levels = Regex.scan(~r/<h([1-6])>/, html) |> Enum.map(&Enum.at(&1, 1))
    parts = Regex.split(~r/<h[1-6]>/, html)

    true = length(levels) == length(slugs)
    true = length(parts) == length(levels) + 1

    # `parts` holds one more element than there are headings (the text after the
    # last one), so the zip stops before it and it is appended at the end.
    tagged =
      [parts, levels, slugs]
      |> Enum.zip()
      |> Enum.map(fn {part, level, slug} -> part <> ~s(<h#{level} id="#{slug}">) end)

    IO.iodata_to_binary([tagged, List.last(parts)])
  end
end
