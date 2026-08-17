defmodule WandererApp.Repo.Migrations.AddMapUserSettingsManuallyAddedSystems do
  @moduledoc """
  Adds per-user manually-added system ids to map_user_settings.
  """

  use Ecto.Migration

  def up do
    alter table(:map_user_settings_v1) do
      add :manually_added_system_ids, {:array, :text}, default: []
    end
  end

  def down do
    alter table(:map_user_settings_v1) do
      remove :manually_added_system_ids
    end
  end
end
