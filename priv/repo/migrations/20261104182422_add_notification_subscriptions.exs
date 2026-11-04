defmodule WandererApp.Repo.Migrations.AddNotificationSubscriptions do
  @moduledoc """
  Adds map-scoped system notification subscriptions, their cooldown windows and
  the delivery log.

  A subscription belongs to one map on purpose: only characters that are
  tracked on that map (and still have permission there) are evaluated. The
  cooldown row is claimed atomically with an upsert, so two tracker processes
  that see the same character at the same time cannot both send an email.
  """

  use Ecto.Migration

  def up do
    create table(:notification_subscriptions_v1, primary_key: false) do
      add :id, :uuid, null: false, default: fragment("gen_random_uuid()"), primary_key: true
      add :name, :text, null: false
      add :enabled, :boolean, null: false, default: true

      # Systems are stored as ids so matching never depends on spelling; the
      # names are kept for display only (English and Chinese both allowed).
      add :system_ids, {:array, :bigint}, null: false, default: []
      add :system_names, {:array, :text}, null: false, default: []

      add :wormhole_classes, {:array, :integer}, null: false, default: []
      add :min_active_days, :integer
      add :max_active_days, :integer
      add :timezone_min, :integer
      add :timezone_max, :integer
      add :allow_missing_timezone, :boolean, null: false, default: false

      add :recipient_emails, {:array, :text}, null: false, default: []
      add :cooldown_hours, :integer, null: false, default: 24

      add :inserted_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :updated_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :user_id,
          references(:user_v1,
            column: :id,
            name: "notification_subscriptions_v1_user_id_fkey",
            type: :uuid,
            on_delete: :delete_all
          ),
          null: false

      add :map_id,
          references(:maps_v1,
            column: :id,
            name: "notification_subscriptions_v1_map_id_fkey",
            type: :uuid,
            on_delete: :delete_all
          ),
          null: false
    end

    create index(:notification_subscriptions_v1, [:user_id])
    create index(:notification_subscriptions_v1, [:map_id])
    create index(:notification_subscriptions_v1, [:enabled])

    create table(:notification_windows_v1, primary_key: false) do
      add :id, :uuid, null: false, default: fragment("gen_random_uuid()"), primary_key: true

      add :system_id, :bigint, null: false
      add :claimed_at, :utc_datetime_usec, null: false
      add :expires_at, :utc_datetime_usec, null: false

      add :inserted_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :updated_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :subscription_id,
          references(:notification_subscriptions_v1,
            column: :id,
            name: "notification_windows_v1_subscription_id_fkey",
            type: :uuid,
            on_delete: :delete_all
          ),
          null: false
    end

    create unique_index(:notification_windows_v1, [:subscription_id, :system_id],
             name: "notification_windows_v1_unique_subscription_system_index"
           )

    create index(:notification_windows_v1, [:expires_at])

    create table(:notification_deliveries_v1, primary_key: false) do
      add :id, :uuid, null: false, default: fragment("gen_random_uuid()"), primary_key: true

      add :system_id, :bigint, null: false
      add :system_name, :text
      add :character_name, :text
      add :corporation_name, :text
      add :alliance_name, :text
      add :recipient_emails, {:array, :text}, null: false, default: []
      add :status, :text, null: false, default: "pending"
      add :error, :text

      add :inserted_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :updated_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :subscription_id,
          references(:notification_subscriptions_v1,
            column: :id,
            name: "notification_deliveries_v1_subscription_id_fkey",
            type: :uuid,
            on_delete: :delete_all
          ),
          null: false

      add :character_id,
          references(:character_v1,
            column: :id,
            name: "notification_deliveries_v1_character_id_fkey",
            type: :uuid,
            on_delete: :nilify_all
          ),
          null: true
    end

    create index(:notification_deliveries_v1, [:subscription_id, :inserted_at])
    create index(:notification_deliveries_v1, [:system_id])
  end

  def down do
    drop table(:notification_deliveries_v1)
    drop table(:notification_windows_v1)
    drop table(:notification_subscriptions_v1)
  end
end
