defmodule WandererApp.Map do
  @moduledoc """
  Represents the map structure and exposes actions that can be taken to update
  it
  """
  import Ecto.Query

  require Logger

  @map_state_cache :map_state_cache
  # Default plan indicates no active subscription (free tier)
  @default_subscription_plan :alpha

  defstruct map_id: nil,
            name: nil,
            scope: :none,
            scopes: nil,
            owner_id: nil,
            characters: [],
            systems: Map.new(),
            hubs: [],
            connections: Map.new(),
            acls: [],
            options: Map.new(),
            characters_limit: nil,
            hubs_limit: nil,
            sse_enabled: false,
            webhooks_enabled: false,
            subscription_plan: @default_subscription_plan

  def new(
        %{id: map_id, name: name, scope: scope, owner_id: owner_id, acls: acls, hubs: hubs} =
          input
      ) do
    # Extract the new scopes array field if present (nil if not set)
    scopes = Map.get(input, :scopes)
    # Extract SSE/webhooks settings (default to false if not present)
    sse_enabled = Map.get(input, :sse_enabled, false)
    webhooks_enabled = Map.get(input, :webhooks_enabled, false)

    map =
      struct!(__MODULE__,
        map_id: map_id,
        scope: scope,
        scopes: scopes,
        owner_id: owner_id,
        name: name,
        acls: acls,
        hubs: hubs,
        sse_enabled: sse_enabled,
        webhooks_enabled: webhooks_enabled
      )

    update_map(map_id, map)

    map
  end

  def get_map(map_id) do
    case Cachex.get(:map_cache, map_id) do
      {:ok, nil} ->
        {:error, :not_found}

      {:ok, map} ->
        {:ok, map}
    end
  end

  def get_map!(map_id) do
    case get_map(map_id) do
      {:ok, map} ->
        map

      error ->
        Logger.error("Failed to get map #{map_id}: #{inspect(error)}")
        %{}
    end
  end

  def update_map(map_id, map_update) do
    Cachex.get_and_update(:map_cache, map_id, fn map ->
      case map do
        nil ->
          {:commit, map_update}

        _ ->
          {:commit, Map.merge(map, map_update)}
      end
    end)
  end

  def get_map_state(map_id, init_if_empty? \\ true) do
    case Cachex.get(@map_state_cache, map_id) do
      {:ok, nil} ->
        case init_if_empty? do
          true ->
            map_state = WandererApp.Map.Server.Impl.do_init_state(map_id: map_id)
            Cachex.put(@map_state_cache, map_id, map_state)
            {:ok, map_state}

          _ ->
            {:ok, nil}
        end

      {:ok, map_state} ->
        {:ok, map_state}
    end
  end

  def get_map_state!(map_id) do
    case get_map_state(map_id) do
      {:ok, map_state} ->
        map_state

      _ ->
        Logger.error("Failed to get map_state #{map_id}")
        throw("Failed to get map_state #{map_id}")
    end
  end

  def update_map_state(map_id, state_update),
    do:
      Cachex.get_and_update(@map_state_cache, map_id, fn map_state ->
        case map_state do
          nil ->
            new_state = WandererApp.Map.Server.Impl.do_init_state(map_id: map_id)
            {:commit, Map.merge(new_state, state_update)}

          _ ->
            {:commit, Map.merge(map_state, state_update)}
        end
      end)

  def delete_map_state(map_id), do: Cachex.del(@map_state_cache, map_id)

  def get_characters_limit(map_id),
    do: {:ok, map_id |> get_map!() |> Map.get(:characters_limit, 50)}

  def get_hubs_limit(map_id),
    do: {:ok, map_id |> get_map!() |> Map.get(:hubs_limit, 20)}

  def is_subscription_active?(map_id),
    do: is_subscription_active?(map_id, WandererApp.Env.map_subscriptions_enabled?())

  def is_subscription_active?(_map_id, false), do: {:ok, true}

  def is_subscription_active?(map_id, _map_subscriptions_enabled) do
    {:ok, %{plan: plan}} = WandererApp.Map.SubscriptionManager.get_active_map_subscription(map_id)
    {:ok, plan != @default_subscription_plan}
  end

  def get_options(map_id),
    do: {:ok, map_id |> get_map!() |> Map.get(:options, Map.new())}

  def get_tracked_character_ids(map_id) do
    all_characters =
      map_id
      |> get_map!()
      |> Map.get(:characters, [])

    tracked =
      all_characters
      |> Enum.filter(fn character_id ->
        {:ok, tracking_start_time} =
          WandererApp.Cache.lookup(
            "character:#{character_id}:map:#{map_id}:tracking_start_time",
            nil
          )

        not is_nil(tracking_start_time)
      end)

    :telemetry.execute(
      [:wanderer_app, :map, :tracked_characters, :count],
      %{
        tracked_count: length(tracked),
        total_count: length(all_characters),
        system_time: System.system_time()
      },
      %{map_id: map_id}
    )

    {:ok, tracked}
  end

  @doc """
  Returns a full list of characters in the map
  """
  def list_characters(map_id),
    do:
      map_id
      |> get_map!()
      |> Map.get(:characters, [])
      |> Enum.map(fn character_id ->
        WandererApp.Character.get_map_character!(map_id, character_id)
      end)

  def list_systems(map_id),
    do: {:ok, map_id |> get_map!() |> Map.get(:systems, Map.new()) |> Map.values()}

  def list_systems!(map_id) do
    {:ok, systems} = list_systems(map_id)
    systems
  end

  def list_hubs(map_id) do
    {:ok, map} = map_id |> get_map()

    {:ok, map |> Map.get(:hubs, [])}
  end

  def list_hubs(map_id, hubs) do
    {:ok, _map} = map_id |> get_map()

    {:ok, hubs}
  end

  def list_connections(map_id),
    do: {:ok, map_id |> get_map!() |> Map.get(:connections, Map.new()) |> Map.values()}

  def list_connections!(map_id) do
    {:ok, connections} = list_connections(map_id)
    connections
  end

  def get_connection(map_id, solar_system_source, solar_system_target),
    do:
      map_id
      |> get_map!()
      |> Map.get(:connections, Map.new())
      |> Map.get("#{solar_system_source}_#{solar_system_target}")

  def add_characters!(map, []), do: map

  def add_characters!(%{map_id: map_id} = map, characters) when is_list(characters) do
    # Get current characters list once
    current_characters = Map.get(map, :characters, [])

    characters_ids =
      characters
      |> Enum.map(fn %{character_id: char_id} -> char_id end)

    # Filter out characters that already exist
    new_character_ids =
      characters_ids
      |> Enum.reject(fn char_id -> char_id in current_characters end)

    # If all characters already exist, return early
    if new_character_ids == [] do
      map
    else
      case update_map(map_id, %{characters: new_character_ids ++ current_characters}) do
        {:commit, map} ->
          map

        _ ->
          map
      end
    end
  end

  def add_character(
        map_id,
        %{
          id: character_id
        } = _character
      ) do
    characters = map_id |> get_map!() |> Map.get(:characters, [])

    case not (characters |> Enum.member?(character_id)) do
      true ->
        map_id
        |> update_map(%{characters: [character_id | characters]})

        :ok

      _ ->
        :ok
    end
  end

  def get_system_characters(map_id, solar_system_id),
    do:
      map_id
      |> list_characters()
      |> filter(%{solar_system_id: solar_system_id}, match: :any)

  @doc """
  Removes a character with a given id
  """
  def remove_character(map_id, character_id) do
    characters = map_id |> get_map!() |> Map.get(:characters, [])

    case characters |> Enum.member?(character_id) do
      true ->
        map_id
        |> update_map(%{characters: characters |> Enum.reject(fn id -> id == character_id end)})

        :ok

      _ ->
        :ok
    end
  end

  def check_location(map_id, location) do
    case find_system_by_location(map_id, location) do
      nil ->
        {:ok, location}

      %{} ->
        {:error, :already_exists}
    end
  end

  def find_system_by_location(_map_id, nil), do: nil

  def find_system_by_location(map_id, %{solar_system_id: solar_system_id} = _location) do
    case map_id |> get_map!() |> Map.get(:systems, Map.new()) |> Map.get(solar_system_id) do
      nil ->
        nil

      %{visible: true} = system ->
        system

      _system ->
        nil
    end
  end

  @doc """
  Like find_system_by_location but does NOT filter by visible: true.
  Used for auto-hide/unhide logic that needs to inspect hidden systems.
  """
  def find_system_by_location_any(_map_id, nil), do: nil

  def find_system_by_location_any(map_id, %{solar_system_id: solar_system_id} = _location) do
    case map_id |> get_map!() |> Map.get(:systems, Map.new()) |> Map.get(solar_system_id) do
      nil -> nil
      system -> system
    end
  end

  @doc """
  Updates the visible field on a system in the map cache.
  """
  def update_system_visibility(map_id, solar_system_id, visible) when is_boolean(visible) do
    systems = map_id |> get_map!() |> Map.get(:systems, Map.new())

    case systems |> Map.get(solar_system_id) do
      nil ->
        :ok

      system ->
        updated_system = Map.put(system, :visible, visible)
        map_id |> update_map(%{systems: Map.put(systems, solar_system_id, updated_system)})
        :ok
    end
  end

  @doc """
  Updates the position of a system in the map cache.
  """
  def update_system_cache_position(map_id, solar_system_id, position_x, position_y) do
    systems = map_id |> get_map!() |> Map.get(:systems, Map.new())

    case systems |> Map.get(solar_system_id) do
      nil ->
        :ok

      system ->
        updated_system =
          system
          |> Map.put(:position_x, position_x)
          |> Map.put(:position_y, position_y)

        map_id |> update_map(%{systems: Map.put(systems, solar_system_id, updated_system)})
        :ok
    end
  end

  def check_connection(
        map_id,
        %{solar_system_id: solar_system_id} = _location,
        %{solar_system_id: old_solar_system_id} = _old_location
      ) do
    case map_id
         |> get_map!()
         |> Map.get(:connections, Map.new())
         |> is_connection_exist?(%{
           solar_system_source: solar_system_id,
           solar_system_target: old_solar_system_id
         }) do
      true ->
        {:error, :already_exists}

      _ ->
        :ok
    end
  end

  def update_subscription_settings!(%{map_id: map_id} = _map, subscription_settings) do
    characters_limit = Map.get(subscription_settings, :characters_limit)
    hubs_limit = Map.get(subscription_settings, :hubs_limit)
    plan = Map.get(subscription_settings, :plan, @default_subscription_plan)

    map_id
    |> update_map(%{
      characters_limit: characters_limit,
      hubs_limit: hubs_limit,
      subscription_plan: plan
    })

    map_id
    |> get_map!()
  end

  def update_options!(%{map_id: map_id} = _map, options) do
    map_id
    |> update_map(%{options: options})

    map_id
    |> get_map!()
  end

  @doc """
  Updates SSE enabled setting in the map cache.
  Called when the map's sse_enabled setting changes.
  """
  def update_sse_enabled(map_id, sse_enabled)
      when is_binary(map_id) and is_boolean(sse_enabled) do
    update_map(map_id, %{sse_enabled: sse_enabled})
    :ok
  end

  @doc """
  Updates webhooks enabled setting in the map cache.
  Called when the map's webhooks_enabled setting changes.
  """
  def update_webhooks_enabled(map_id, webhooks_enabled)
      when is_binary(map_id) and is_boolean(webhooks_enabled) do
    update_map(map_id, %{webhooks_enabled: webhooks_enabled})
    :ok
  end

  @doc """
  Checks if SSE is enabled for a map using the cache.
  Falls back to DB query if map is not in cache.
  Returns a boolean (defaults to false if map not found).
  """
  def sse_enabled?(map_id) do
    case get_map(map_id) do
      {:ok, map} ->
        Map.get(map, :sse_enabled, false)

      {:error, :not_found} ->
        # Cache miss - fall back to DB
        case WandererApp.Api.Map.by_id(map_id) do
          {:ok, db_map} -> db_map.sse_enabled
          _ -> false
        end
    end
  end

  @doc """
  Checks if SSE is enabled for a map with explicit not_found handling.
  Returns {:ok, boolean} or {:error, :not_found}.
  """
  def sse_enabled_with_status(map_id) do
    case get_map(map_id) do
      {:ok, map} ->
        {:ok, Map.get(map, :sse_enabled, false)}

      {:error, :not_found} ->
        # Cache miss - fall back to DB
        case WandererApp.Api.Map.by_id(map_id) do
          {:ok, db_map} -> {:ok, db_map.sse_enabled}
          _ -> {:error, :not_found}
        end
    end
  end

  @doc """
  Checks if webhooks are enabled for a map using the cache.
  Falls back to DB query if map is not in cache.
  """
  def webhooks_enabled?(map_id) do
    case get_map(map_id) do
      {:ok, map} ->
        Map.get(map, :webhooks_enabled, false)

      {:error, :not_found} ->
        # Cache miss - fall back to DB
        case WandererApp.Api.Map.by_id(map_id) do
          {:ok, db_map} -> db_map.webhooks_enabled
          _ -> false
        end
    end
  end

  @doc """
  Checks if subscription is active for a map using the cache.
  Returns {:ok, true} if active, {:ok, false} if not, or {:error, :not_cached} if not in cache.

  Note: In CE mode (subscriptions disabled), use is_subscription_active?/1 which
  handles this case without cache lookup.
  """
  def subscription_active_cached?(map_id) do
    case get_map(map_id) do
      {:ok, map} ->
        plan = Map.get(map, :subscription_plan, @default_subscription_plan)
        {:ok, plan != @default_subscription_plan}

      _ ->
        {:error, :not_cached}
    end
  end

  def add_systems!(map, []), do: map

  def add_systems!(%{map_id: map_id} = map, [system | rest]) do
    :ok = add_system(map_id, system)
    add_systems!(map, rest)
  end

  def add_system(map_id, %{solar_system_id: solar_system_id} = system) do
    systems = map_id |> get_map!() |> Map.get(:systems, Map.new())

    case not Map.has_key?(systems, solar_system_id) do
      true ->
        map_id
        |> update_map(%{systems: Map.put(systems, solar_system_id, system)})

        :ok

      _ ->
        :ok
    end
  end

  def update_system_by_solar_system_id(
        map_id,
        update
      ) do
    updated_systems =
      map_id |> get_map!() |> Map.get(:systems, Map.new()) |> update_by_solar_system_id(update)

    map_id
    |> update_map(%{systems: updated_systems})

    :ok
  end

  def remove_system(map_id, solar_system_id) do
    systems = map_id |> get_map!() |> Map.get(:systems, Map.new())

    case systems |> Map.get(solar_system_id) do
      nil ->
        :ok

      _system ->
        map_id
        |> update_map(%{systems: Map.drop(systems, [solar_system_id])})

        :ok
    end
  end

  def remove_systems(_map_id, []), do: :ok

  def remove_systems(map_id, [solar_system_id | rest]) do
    :ok = remove_system(map_id, solar_system_id)
    remove_systems(map_id, rest)
  end

  def add_hub(map_id, %{solar_system_id: solar_system_id} = _hub_info) do
    hubs = map_id |> get_map!() |> Map.get(:hubs, [])

    case hubs |> Enum.member?("#{solar_system_id}") do
      false ->
        map_id
        |> update_map(%{hubs: ["#{solar_system_id}" | hubs]})

        :ok

      _ ->
        :ok
    end
  end

  def remove_hub(map_id, %{solar_system_id: solar_system_id} = _hub_info) do
    hubs = map_id |> get_map!() |> Map.get(:hubs, [])

    case hubs |> Enum.member?("#{solar_system_id}") do
      true ->
        map_id
        |> update_map(%{hubs: Enum.reject(hubs, fn hub -> hub == "#{solar_system_id}" end)})

        :ok

      _ ->
        :ok
    end
  end

  def add_connections!(map, []), do: map

  def add_connections!(%{map_id: map_id} = map, [connection | rest]) do
    case add_connection(map_id, connection) do
      :ok ->
        add_connections!(map, rest)

      {:error, :already_exists} ->
        connection
        |> WandererApp.MapConnectionRepo.destroy!()

        add_connections!(map, rest)
    end
  end

  def add_connection(
        map_id,
        %{solar_system_source: solar_system_source, solar_system_target: solar_system_target} =
          connection
      ) do
    connections = map_id |> get_map!() |> Map.get(:connections, Map.new())

    case not (connections |> is_connection_exist?(connection)) do
      true ->
        map_id
        |> update_map(%{
          connections:
            Map.put_new(connections, "#{solar_system_source}_#{solar_system_target}", connection)
        })

        :ok

      _ ->
        :ok
    end
  end

  def is_connection_exist?(
        connections,
        %{solar_system_source: solar_system_source, solar_system_target: solar_system_target} =
          _connection
      ) do
    connections |> Map.has_key?("#{solar_system_source}_#{solar_system_target}") or
      connections |> Map.has_key?("#{solar_system_target}_#{solar_system_source}")
  end

  def update_connection(
        map_id,
        %{solar_system_source: solar_system_source, solar_system_target: solar_system_target} =
          connection
      ) do
    connections = map_id |> get_map!() |> Map.get(:connections, Map.new())

    map_id
    |> update_map(%{
      connections:
        Map.put(connections, "#{solar_system_source}_#{solar_system_target}", connection)
    })

    :ok
  end

  def remove_connection(
        map_id,
        %{solar_system_source: solar_system_source, solar_system_target: solar_system_target} =
          _connection
      ) do
    connections = map_id |> get_map!() |> Map.get(:connections, Map.new())

    map_id
    |> update_map(%{
      connections: Map.drop(connections, ["#{solar_system_source}_#{solar_system_target}"])
    })

    :ok
  end

  def remove_connections(_map_id, []), do: :ok

  def remove_connections(map_id, [connection | rest]) do
    :ok = remove_connection(map_id, connection)
    remove_connections(map_id, rest)
  end

  def find_connections(map_id, solar_system_id),
    do:
      map_id
      |> list_connections!()
      |> filter(
        %{solar_system_source: solar_system_id, solar_system_target: solar_system_id},
        match: :any
      )

  def find_connection(
        map_id,
        solar_system_source,
        solar_system_target
      ) do
    connections =
      map_id
      |> get_map!()
      |> Map.get(:connections, Map.new())

    case connections
         |> Map.get("#{solar_system_source}_#{solar_system_target}") do
      nil ->
        {:ok,
         connections
         |> Map.get("#{solar_system_target}_#{solar_system_source}")}

      connection ->
        {:ok, connection}
    end
  end

  def get_by_id(list, id) do
    case find(list, %{id: id}, match: :any) do
      %{} = item -> {:ok, item}
      nil -> {:error, :item_not_found}
    end
  end

  def find(list, %{} = attrs, match: :any) do
    list
    |> Enum.find(fn item ->
      Enum.any?(attrs, &has_equal_attribute?(item, &1))
    end)
  end

  def find(list, %{} = attrs, match: :all) do
    list
    |> Enum.find(fn item ->
      Enum.all?(attrs, &has_equal_attribute?(item, &1))
    end)
  end

  def filter(list, %{} = attrs, match: :any) do
    list
    |> Enum.filter(fn item ->
      Enum.any?(attrs, &has_equal_attribute?(item, &1))
    end)
  end

  defp has_equal_attribute?(%{} = map, {key, {:case_insensitive, value}}) when is_binary(value) do
    String.downcase(Map.get(map, key, "")) == String.downcase(value)
  end

  defp has_equal_attribute?(%{} = map, {key, value}) do
    Map.get(map, key) == value
  end

  defp update_by_solar_system_id(systems, %{solar_system_id: solar_system_id} = item) do
    case systems |> Map.get(solar_system_id) do
      nil ->
        systems

      system ->
        systems |> Map.put(solar_system_id, system |> Map.merge(item))
    end
  end

  @doc """
  Returns the raw activity data that can be processed by WandererApp.Character.Activity.
  Only includes characters that are on the map's ACL.

  `days` picks the reporting tier rather than a plain lookback — see
  `WandererApp.Character.ActivityRollup.query_window/1`. Raw rows cover the last 7 days;
  wider ranges are served from the day/month/year buckets the rollup keeps. Exactly one
  tier is read per call, so counts are never stitched together across granularities.
  """
  def get_character_activity(map_id, days \\ nil) do
    with {:ok, map} <- WandererApp.Api.Map.by_id(map_id) do
      _map_with_acls = Ash.load!(map, :acls)

      case WandererApp.Character.ActivityRollup.query_window(days) do
        {:raw, cutoff} -> raw_character_activity(map_id, cutoff)
        {granularity, cutoff} -> rollup_character_activity(map_id, granularity, cutoff)
      end
    end
  end

  defp raw_character_activity(map_id, cutoff) do
    passages_activity = get_passages_activity(map_id, cutoff)
    connections_activity = get_connections_activity(map_id, cutoff)
    signatures_activity = get_signatures_activity(map_id, cutoff)

    # The row set is driven by passages: a character with connections or signatures but no
    # passage on this map does not appear in the report.
    {:ok,
     Enum.map(passages_activity, fn passage ->
       character = passage.character

       %{
         character: character,
         passages: passage.count,
         connections: Map.get(connections_activity, character.id, 0),
         signatures: Map.get(signatures_activity, character.id, 0),
         timestamp: DateTime.utc_now(),
         character_id: character.id,
         user_id: character.user_id
       }
     end)}
  end

  defp rollup_character_activity(map_id, granularity, cutoff) do
    rows =
      WandererApp.Api.CharacterActivityRollup
      |> where([r], r.map_id == ^map_id and r.granularity == ^granularity)
      |> rollup_since(cutoff)
      |> group_by([r], r.character_id)
      # Postgres `sum()` over a bigint is a numeric, which Ecto hands back as a `Decimal` —
      # that would serialise to `"3"` in the API response instead of `3`.
      |> select([r], {
        r.character_id,
        type(sum(r.passages), :integer),
        type(sum(r.connections), :integer),
        type(sum(r.signatures), :integer)
      })
      |> order_by([r], desc: sum(r.passages))
      |> WandererApp.Repo.all()
      # Same row set as the raw tier — passages only.
      |> Enum.filter(fn {_id, passages, _connections, _signatures} -> passages > 0 end)

    characters = load_activity_characters(Enum.map(rows, &elem(&1, 0)))

    {:ok,
     Enum.flat_map(rows, fn {character_id, passages, connections, signatures} ->
       case Map.get(characters, character_id) do
         nil ->
           # Character deleted but the FK cascade has not caught up yet.
           []

         character ->
           [
             %{
               character: character,
               passages: passages,
               connections: connections,
               signatures: signatures,
               timestamp: DateTime.utc_now(),
               character_id: character_id,
               user_id: character.user_id
             }
           ]
       end
     end)}
  end

  defp rollup_since(query, nil), do: query

  defp rollup_since(query, cutoff), do: where(query, [r], r.bucket_start >= ^cutoff)

  # Buckets only store ids, but both WandererApp.Character.Activity and the API controller
  # dereference `character`, so it has to be loaded for bucket-only characters too.
  defp load_activity_characters([]), do: %{}

  defp load_activity_characters(character_ids) do
    WandererApp.Api.Character
    |> where([c], c.id in ^character_ids)
    |> WandererApp.Repo.all()
    |> Map.new(&{&1.id, &1})
  end

  defp get_passages_activity(map_id, cutoff) do
    from(p in WandererApp.Api.MapChainPassages,
      join: c in assoc(p, :character),
      where:
        p.map_id == ^map_id and
          p.inserted_at > ^cutoff,
      group_by: [c.id],
      select: {c, count(p.id)}
    )
    |> WandererApp.Repo.all()
    |> Enum.map(fn {character, count} -> %{character: character, count: count} end)
  end

  defp get_connections_activity(map_id, cutoff) do
    from(ua in WandererApp.Api.UserActivity,
      join: c in assoc(ua, :character),
      where:
        ua.entity_id == ^map_id and
          ua.entity_type == :map and
          ua.event_type == :map_connection_added and
          ua.inserted_at > ^cutoff,
      group_by: [c.id],
      select: {c.id, count(ua.id)}
    )
    |> WandererApp.Repo.all()
    |> Map.new()
  end

  defp get_signatures_activity(map_id, cutoff) do
    from(ua in WandererApp.Api.UserActivity,
      join: c in assoc(ua, :character),
      where:
        ua.entity_id == ^map_id and
          ua.entity_type == :map and
          ua.event_type == :signatures_added and
          ua.inserted_at > ^cutoff,
      select: {ua.character_id, ua.event_data}
    )
    |> WandererApp.Repo.all()
    |> process_signatures_data()
  end

  defp process_signatures_data(signatures_data) do
    signatures_data
    |> Enum.group_by(fn {character_id, _} -> character_id end)
    |> Enum.map(&process_character_signatures/1)
    |> Map.new()
  end

  defp process_character_signatures({character_id, activities}) do
    signature_count =
      activities
      |> Enum.map(fn {_, event_data} -> count_signatures(event_data) end)
      |> Enum.sum()

    {character_id, signature_count}
  end

  # `event_data` is nullable, and a batch of signatures is counted by its length rather
  # than as a single row.
  defp count_signatures(event_data) when is_binary(event_data) do
    with {:ok, %{"signatures" => signatures}} when is_list(signatures) <- Jason.decode(event_data) do
      length(signatures)
    else
      _ -> 0
    end
  end

  defp count_signatures(_), do: 0
end
