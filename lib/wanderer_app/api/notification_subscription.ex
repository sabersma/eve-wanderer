defmodule WandererApp.Api.NotificationSubscription do
  @moduledoc """
  A map-scoped subscription that triggers when tracked characters enter one of
  its systems.

  The map is part of the subscription on purpose: the notifier only evaluates
  characters that are tracked on that map and still have permission there.
  """

  use Ash.Resource,
    domain: WandererApp.Api,
    data_layer: AshPostgres.DataLayer

  postgres do
    repo(WandererApp.Repo)
    table("notification_subscriptions_v1")
  end

  code_interface do
    define(:create, action: :create)
    define(:update, action: :update)
    define(:destroy, action: :destroy)

    define(:by_id,
      get_by: [:id],
      action: :read
    )

    define(:by_user, action: :by_user)
    define(:all_enabled, action: :all_enabled)
  end

  actions do
    default_accept [
      :map_id,
      :user_id,
      :name,
      :enabled,
      :system_ids,
      :system_names,
      :wormhole_classes,
      :min_active_days,
      :max_active_days,
      :timezone_min,
      :timezone_max,
      :allow_missing_timezone,
      :recipient_emails,
      :cooldown_hours
    ]

    defaults [:read, :destroy]

    create :create do
      primary? true
    end

    update :update do
      primary? true
      require_atomic? false
    end

    read :by_user do
      argument(:user_id, :uuid, allow_nil?: false)

      prepare build(sort: [updated_at: :desc], load: [:map])

      filter(expr(user_id == ^arg(:user_id)))
    end

    read :all_enabled do
      filter(expr(enabled == true))
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :name, :string do
      allow_nil? false
      public? true
    end

    attribute :enabled, :boolean do
      allow_nil? false
      default true
      public? true
    end

    attribute :system_ids, {:array, :integer} do
      allow_nil? false
      default []
      public? true
    end

    attribute :system_names, {:array, :string} do
      allow_nil? false
      default []
      public? true
    end

    attribute :wormhole_classes, {:array, :integer} do
      allow_nil? false
      default []
      public? true
    end

    attribute :min_active_days, :integer do
      allow_nil? true
      public? true
    end

    attribute :max_active_days, :integer do
      allow_nil? true
      public? true
    end

    attribute :timezone_min, :integer do
      allow_nil? true
      public? true
    end

    attribute :timezone_max, :integer do
      allow_nil? true
      public? true
    end

    attribute :allow_missing_timezone, :boolean do
      allow_nil? false
      default false
      public? true
    end

    attribute :recipient_emails, {:array, :string} do
      allow_nil? false
      default []
      public? true
    end

    attribute :cooldown_hours, :integer do
      allow_nil? false
      default 24
      public? true
    end

    timestamps()
  end

  relationships do
    belongs_to :map, WandererApp.Api.Map do
      allow_nil? false
      public? true
    end

    belongs_to :user, WandererApp.Api.User do
      allow_nil? false
      public? true
    end
  end
end
