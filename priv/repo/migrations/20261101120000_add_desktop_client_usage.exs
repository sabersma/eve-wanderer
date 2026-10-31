defmodule WandererApp.Repo.Migrations.AddDesktopClientUsage do
  @moduledoc """
  Desktop client installs that reported a heartbeat.

  Kept as a plain table (not an Ash resource): this is append/update-only
  telemetry for the admin dashboard, with no domain rules or relationships.
  """

  use Ecto.Migration

  def up do
    create table(:desktop_client_v1, primary_key: false) do
      add :id, :uuid, null: false, default: fragment("gen_random_uuid()"), primary_key: true
      add :install_id, :text, null: false
      add :version, :text
      add :platform, :text

      add :first_seen_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :last_seen_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :inserted_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :updated_at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() AT TIME ZONE 'utc')")

      add :user_id,
          references(:user_v1,
            column: :id,
            name: "desktop_client_v1_user_id_fkey",
            type: :uuid,
            on_delete: :nilify_all
          )
    end

    create unique_index(:desktop_client_v1, [:install_id])
    create index(:desktop_client_v1, [:last_seen_at])
  end

  def down do
    drop table(:desktop_client_v1)
  end
end
