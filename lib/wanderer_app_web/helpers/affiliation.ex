defmodule WandererAppWeb.Helpers.Affiliation do
  @moduledoc """
  军团 / 联盟缩写的统一展示规则：角色名[军团缩写][联盟缩写]

  NPC 军团的判定：EVE 把 NPC 军团固定分配在 1,000,000–1,999,999 这个 ID 区间
  （玩家军团从 98,000,000 起），所以用 ID 区间判断即可，不需要额外字段。

  前端同名规则见 `assets/js/hooks/Mapper/helpers/affiliationTickers.ts`，两边需保持一致。
  """

  @npc_corporation_label "NPC军团"
  @no_alliance_label "无联盟"

  @npc_corporation_id_min 1_000_000
  @npc_corporation_id_max 1_999_999

  @spec npc_corporation_id?(integer() | nil | term()) :: boolean()
  def npc_corporation_id?(corporation_id) when is_integer(corporation_id),
    do: corporation_id >= @npc_corporation_id_min and corporation_id <= @npc_corporation_id_max

  def npc_corporation_id?(_), do: false

  @doc "军团缩写：NPC 军团不展示自己的 ticker，统一显示为 NPC军团。"
  @spec corporation_ticker_text(integer() | nil | term(), String.t() | nil | term()) :: String.t()
  def corporation_ticker_text(corporation_id, corporation_ticker) do
    cond do
      npc_corporation_id?(corporation_id) -> @npc_corporation_label
      is_binary(corporation_ticker) -> corporation_ticker
      true -> ""
    end
  end

  @doc """
  联盟缩写：没有联盟时显示为无联盟。

  部分 payload 只带 ticker 不带 id，所以 ticker 优先判定（注意 Elixir 里 "" 是真值）。
  """
  @spec alliance_ticker_text(integer() | nil | term(), String.t() | nil | term()) :: String.t()
  def alliance_ticker_text(alliance_id, alliance_ticker) do
    cond do
      is_binary(alliance_ticker) and alliance_ticker != "" -> alliance_ticker
      is_nil(alliance_id) -> @no_alliance_label
      true -> ""
    end
  end

  @doc """
  拼接 `[军团缩写][联盟缩写]`，直接跟在角色名后面使用。

  接受 atom 或 string key 的 map / struct。
  """
  @spec affiliation_label(map()) :: String.t()
  def affiliation_label(character) when is_map(character) do
    corporation =
      corporation_ticker_text(
        fetch(character, :corporation_id),
        fetch(character, :corporation_ticker)
      )

    alliance =
      alliance_ticker_text(
        fetch(character, :alliance_id),
        fetch(character, :alliance_ticker)
      )

    "[#{corporation}][#{alliance}]"
  end

  defp fetch(map, key) when is_atom(key) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, Atom.to_string(key))
    end
  end
end
