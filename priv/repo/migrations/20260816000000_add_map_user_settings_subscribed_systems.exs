defmodule WandererApp.Repo.Migrations.AddMapUserSettingsSubscribedSystems do
  @moduledoc """
  Adds per-user subscribed system ids to map_user_settings.
  """

  use Ecto.Migration

  def up do
    alter table(:map_user_settings_v1) do
      add :subscribed_system_ids, {:array, :text}, default: []
    end
  end

  def down do
    alter table(:map_user_settings_v1) do
      remove :subscribed_system_ids
    end
  end
end
