defmodule WandererApp.Notifications.SystemResolver do
  @moduledoc """
  Resolves the system names typed on the subscriptions page into system ids.

  Names may be English or Chinese. The local static table covers English names;
  Chinese names come from the J-Space Helper integration search. A bare integer
  is accepted as an id so power users can paste ids directly.
  """

  require Logger

  alias WandererApp.Jspace.Client

  @type resolved :: %{id: integer(), name: String.t()}

  @doc """
  Resolves a comma/newline/semicolon separated list of names.

  Returns `{:ok, systems}` (deduplicated by id) or
  `{:error, {:unresolved, tokens}}` naming every token that did not resolve.
  """
  @spec resolve_many(String.t()) :: {:ok, [resolved()]} | {:error, term()}
  def resolve_many(raw) when is_binary(raw) do
    tokens =
      raw
      |> String.split(~r/[\n,，;；]+/u)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    cond do
      tokens == [] ->
        {:error, :empty}

      true ->
        results = Enum.map(tokens, &{&1, resolve_token(&1)})
        unresolved = for {token, :error} <- results, do: token

        resolved =
          results
          |> Enum.flat_map(fn
            {_token, {:ok, system}} -> [system]
            _ -> []
          end)
          |> Enum.uniq_by(& &1.id)

        if unresolved == [] do
          {:ok, resolved}
        else
          {:error, {:unresolved, unresolved}}
        end
    end
  end

  def resolve_many(_raw), do: {:error, :empty}

  @doc """
  Resolves one token. Tries a numeric id, then an exact local English name,
  then an exact helper match (English or Chinese).
  """
  def resolve_token(token) when is_binary(token) do
    token = String.trim(token)

    case Integer.parse(token) do
      {id, ""} when id > 0 ->
        case local_by_id(id) do
          nil -> {:ok, %{id: id, name: token}}
          system -> {:ok, system}
        end

      _ ->
        case local_by_name(token) do
          nil ->
            case helper_by_name(token) do
              {:ok, system} -> {:ok, system}
              _ -> :error
            end

          system ->
            {:ok, system}
        end
    end
  end

  def resolve_token(_token), do: :error

  @doc "Returns local static info for a system id, or nil when not loaded."
  def local_by_id(system_id) when is_integer(system_id) do
    case WandererApp.Repo.query(
           """
           SELECT solar_system_id, solar_system_name, system_class
           FROM map_solar_system_v2
           WHERE solar_system_id = $1
           LIMIT 1
           """,
           [system_id]
         ) do
      {:ok, %{rows: [[id, name, class]]}} ->
        %{id: id, name: name, class: class}

      _ ->
        nil
    end
  end

  def local_by_id(_system_id), do: nil

  defp local_by_name(name) do
    case WandererApp.Repo.query(
           """
           SELECT solar_system_id, solar_system_name, system_class
           FROM map_solar_system_v2
           WHERE lower(solar_system_name) = lower($1)
           LIMIT 1
           """,
           [name]
         ) do
      {:ok, %{rows: [[id, system_name, class]]}} ->
        %{id: id, name: system_name, class: class}

      _ ->
        nil
    end
  end

  defp helper_by_name(token) do
    case Client.search_systems(token, limit: 20) do
      {:ok, systems} ->
        case Enum.find(systems, &exact_name?(&1, token)) do
          nil ->
            :error

          system ->
            id = system["id"]

            if is_integer(id) and id > 0 do
              {:ok, %{id: id, name: system["name"] || token}}
            else
              :error
            end
        end

      {:error, :not_configured} ->
        :error

      {:error, reason} ->
        Logger.debug("J-Space system search failed while resolving a subscription name",
          reason: inspect(reason)
        )

        :error
    end
  end

  defp exact_name?(system, token) do
    token_lc = String.downcase(token)

    String.downcase(to_string(system["name"] || "")) == token_lc or
      to_string(system["name_zh"] || "") == token
  end
end
