defmodule WandererApp.Repo.Migrations.AddCharacterNeedsReauth do
  @moduledoc """
  Adds a `needs_reauth` flag to characters so that characters whose ESI
  tracking fails with 403 (missing scope) or 404 (character gone) can be
  surfaced to the user instead of silently backing off.
  """

  use Ecto.Migration

  def up do
    alter table(:character_v1) do
      add :needs_reauth, :boolean, default: false, null: false
    end
  end

  def down do
    alter table(:character_v1) do
      remove :needs_reauth
    end
  end
end
