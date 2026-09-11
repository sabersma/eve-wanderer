defmodule WandererApp.Api.CharacterActivityRollup do
  @moduledoc """
  Pre-aggregated character activity buckets.

  Raw activity rows are short-lived (`map_chain_passages_v1` is pruned after 7 days,
  `user_activity_v1` after 84), so any reporting range wider than that used to return
  the same numbers. `WandererApp.Character.ActivityRollup` keeps a coarse copy of the
  counters before the raw rows expire.

  The tiers are *nested*: every tier covers its whole retention window down to now, so a
  query range can always be served by exactly one tier and never has to be stitched
  together from a finer and a coarser granularity.

    * `:day`   — 90 days, `bucket_start` is the day itself
    * `:month` — 12 months, `bucket_start` is the 1st of the month
    * `:year`  — 10 years, `bucket_start` is Jan 1st
  """

  use Ash.Resource,
    domain: WandererApp.Api,
    data_layer: AshPostgres.DataLayer,
    primary_read_warning?: false

  postgres do
    repo(WandererApp.Repo)
    table("character_activity_rollup_v1")

    custom_indexes do
      index [:granularity, :bucket_start]
    end
  end

  code_interface do
    define(:new, action: :new)
    define(:read, action: :read)
    define(:by_map, action: :by_map)
  end

  actions do
    defaults [:read]

    create :new do
      accept [
        :map_id,
        :character_id,
        :granularity,
        :bucket_start,
        :passages,
        :connections,
        :signatures
      ]

      primary?(true)
    end

    destroy :destroy

    read :by_map do
      argument(:map_id, :string, allow_nil?: false)

      filter(expr(map_id == ^arg(:map_id)))
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :granularity, :atom do
      allow_nil? false

      constraints(one_of: [:day, :month, :year])
    end

    attribute :bucket_start, :date do
      allow_nil? false
    end

    # Defaults matter: a bucket is written for every metric of the day, and `SUM` over a
    # column that is NULL for some rows silently drops them.
    attribute :passages, :integer do
      allow_nil? false
      default 0
    end

    attribute :connections, :integer do
      allow_nil? false
      default 0
    end

    attribute :signatures, :integer do
      allow_nil? false
      default 0
    end

    create_timestamp(:inserted_at)
    update_timestamp(:updated_at)
  end

  identities do
    # Ash upserts need a declared identity to know the conflict target; `custom_indexes`
    # alone is not enough.
    identity :unique_bucket, [:map_id, :character_id, :granularity, :bucket_start]
  end

  relationships do
    belongs_to :map, WandererApp.Api.Map do
      allow_nil? false
      attribute_writable? true
    end

    belongs_to :character, WandererApp.Api.Character do
      allow_nil? false
      attribute_writable? true
    end
  end

  postgres do
    references do
      reference :map, on_delete: :delete
      reference :character, on_delete: :delete
    end
  end
end
