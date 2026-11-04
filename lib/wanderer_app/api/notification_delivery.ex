defmodule WandererApp.Api.NotificationDelivery do
  @moduledoc """
  Delivery log for system notifications.

  A row is written before the email is handed to the mailer and updated after
  it succeeds or fails, so the page can show what was sent and why a send
  failed. Character names are snapshotted because the character may be removed
  from the map (or deleted) later.
  """

  use Ash.Resource,
    domain: WandererApp.Api,
    data_layer: AshPostgres.DataLayer

  postgres do
    repo(WandererApp.Repo)
    table("notification_deliveries_v1")
  end

  code_interface do
    define(:create, action: :create)
    define(:mark_sent, action: :mark_sent)
    define(:mark_failed, action: :mark_failed)
    define(:recent_for_subscriptions, action: :recent_for_subscriptions)
  end

  actions do
    default_accept [
      :subscription_id,
      :character_id,
      :system_id,
      :system_name,
      :character_name,
      :corporation_name,
      :alliance_name,
      :recipient_emails,
      :status,
      :error
    ]

    defaults [:read, :destroy]

    create :create do
      primary? true
    end

    update :mark_sent do
      require_atomic? false
      accept []
      change set_attribute(:status, "sent")
    end

    update :mark_failed do
      require_atomic? false
      accept [:error]
      change set_attribute(:status, "failed")
    end

    read :recent_for_subscriptions do
      argument(:subscription_ids, {:array, :uuid}, allow_nil?: false)

      prepare build(sort: [inserted_at: :desc])

      filter(expr(subscription_id in ^arg(:subscription_ids)))
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :system_id, :integer do
      allow_nil? false
      public? true
    end

    attribute :system_name, :string do
      allow_nil? true
      public? true
    end

    attribute :character_name, :string do
      allow_nil? true
      public? true
    end

    attribute :corporation_name, :string do
      allow_nil? true
      public? true
    end

    attribute :alliance_name, :string do
      allow_nil? true
      public? true
    end

    attribute :recipient_emails, {:array, :string} do
      allow_nil? false
      default []
      public? true
    end

    attribute :status, :string do
      allow_nil? false
      default "pending"
      public? true
    end

    attribute :error, :string do
      allow_nil? true
      public? true
    end

    timestamps()
  end

  relationships do
    belongs_to :subscription, WandererApp.Api.NotificationSubscription do
      allow_nil? false
      public? true
    end

    belongs_to :character, WandererApp.Api.Character do
      allow_nil? true
      public? true
    end
  end
end
