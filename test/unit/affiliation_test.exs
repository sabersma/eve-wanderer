defmodule WandererAppWeb.Helpers.AffiliationTest do
  use ExUnit.Case, async: true

  alias WandererAppWeb.Helpers.Affiliation

  describe "npc_corporation_id?/1" do
    test "accepts the npc corporation id range" do
      assert Affiliation.npc_corporation_id?(1_000_001)
      assert Affiliation.npc_corporation_id?(1_000_167)
      assert Affiliation.npc_corporation_id?(1_999_999)
    end

    test "rejects player corporations and empty values" do
      refute Affiliation.npc_corporation_id?(98_000_001)
      refute Affiliation.npc_corporation_id?(999_999)
      refute Affiliation.npc_corporation_id?(2_000_000)
      refute Affiliation.npc_corporation_id?(0)
      refute Affiliation.npc_corporation_id?(nil)
      refute Affiliation.npc_corporation_id?("1000167")
    end
  end

  describe "affiliation_label/1" do
    test "renders [corp][alliance]" do
      character = %{
        corporation_id: 98_000_001,
        corporation_ticker: "CORP",
        alliance_id: 99_000_001,
        alliance_ticker: "ALLY"
      }

      assert Affiliation.affiliation_label(character) == "[CORP][ALLY]"
    end

    test "falls back to 无联盟 when there is no alliance" do
      character = %{corporation_id: 98_000_001, corporation_ticker: "CORP", alliance_id: nil}

      assert Affiliation.affiliation_label(character) == "[CORP][无联盟]"
    end

    test "treats an empty alliance ticker as no alliance" do
      character = %{corporation_id: 98_000_001, corporation_ticker: "CORP", alliance_ticker: ""}

      assert Affiliation.affiliation_label(character) == "[CORP][无联盟]"
    end

    test "replaces the ticker of npc corporations with NPC军团" do
      character = %{
        corporation_id: 1_000_167,
        corporation_ticker: "STARTER",
        alliance_id: nil,
        alliance_ticker: nil
      }

      assert Affiliation.affiliation_label(character) == "[NPC军团][无联盟]"
    end

    test "reads string keys as well as atom keys" do
      character = %{"corporation_ticker" => "CORP", "alliance_ticker" => "ALLY"}

      assert Affiliation.affiliation_label(character) == "[CORP][ALLY]"
    end
  end
end
