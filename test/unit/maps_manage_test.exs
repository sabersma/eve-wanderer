defmodule WandererApp.MapsManageTest do
  @moduledoc """
  Who is allowed to configure map-scoped system notifications.

  The page lists maps with `Maps.can_manage?/2`; owners, admins and managers
  qualify, regular members do not.
  """

  use ExUnit.Case, async: true

  alias WandererApp.Maps

  defp user(eve_id) do
    %{characters: [%{id: "char-#{eve_id}", eve_id: eve_id}]}
  end

  defp map(owner_id, members) do
    %{owner_id: owner_id, acls: [%{owner_id: owner_id, members: members}]}
  end

  defp member(role, eve_id), do: %{role: role, eve_character_id: eve_id}

  test "the owner can manage" do
    assert Maps.can_manage?(map("char-e1", []), user("e1"))
  end

  test "admins and managers can manage" do
    assert Maps.can_manage?(map("other", [member(:admin, "e1")]), user("e1"))
    assert Maps.can_manage?(map("other", [member(:manager, "e1")]), user("e1"))
  end

  test "regular members and unrelated users cannot manage" do
    refute Maps.can_manage?(map("other", [member(:member, "e1")]), user("e1"))
    refute Maps.can_manage?(map("other", []), user("e1"))
  end
end
