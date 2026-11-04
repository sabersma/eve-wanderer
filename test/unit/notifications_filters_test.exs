defmodule WandererApp.Notifications.FiltersTest do
  use ExUnit.Case, async: true

  alias WandererApp.Notifications.Filters

  defp subscription(overrides \\ %{}) do
    Map.merge(
      %{
        system_ids: [31_000_001, 31_000_002],
        wormhole_classes: [],
        min_active_days: nil,
        max_active_days: nil,
        timezone_min: nil,
        timezone_max: nil,
        allow_missing_timezone: false
      },
      Map.new(overrides)
    )
  end

  defp top(overrides) do
    Map.merge(
      %{
        "corporation_id" => 1,
        "active_days" => 30,
        "timezone_offset" => 8
      },
      Map.new(overrides)
    )
  end

  describe "system_matches?/2" do
    test "only matches systems listed on the subscription" do
      assert Filters.system_matches?(subscription(), 31_000_001)
      refute Filters.system_matches?(subscription(), 31_000_003)
    end

    test "an empty list means no system restriction (fuzzy mode)" do
      assert Filters.system_matches?(subscription(system_ids: []), 31_000_001)
    end
  end

  describe "fuzzy mode" do
    test "applies class and top-corporation filters without a system list" do
      sub =
        subscription(
          system_ids: [],
          wormhole_classes: [4],
          min_active_days: 10,
          timezone_min: 8,
          timezone_max: 10
        )

      matching = top(%{"active_days" => 10, "timezone_offset" => 8})

      assert Filters.match?(sub, 31_000_001, 4, matching)
      refute Filters.match?(sub, 31_000_001, 5, matching)

      refute Filters.match?(
               sub,
               31_000_001,
               4,
               top(%{"active_days" => 9, "timezone_offset" => 8})
             )
    end
  end

  describe "class filter" do
    test "empty selection matches every class" do
      assert Filters.match?(subscription(), 31_000_001, 9, nil)
    end

    test "matches only the selected wormhole classes" do
      sub = subscription(wormhole_classes: [4, 5])

      assert Filters.match?(sub, 31_000_001, 4, nil)
      refute Filters.match?(sub, 31_000_001, 3, nil)
      refute Filters.match?(sub, 31_000_001, nil, nil)
      refute Filters.match?(sub, 31_000_001, 9, nil)
    end
  end

  describe "top corporation active days" do
    test "is not consulted when no top-1 filter is configured" do
      refute Filters.needs_top_corporation?(subscription())
      assert Filters.top_corporation_matches?(subscription(), nil)
    end

    test "applies min and max bounds" do
      sub = subscription(min_active_days: 10, max_active_days: 40)

      assert Filters.match?(sub, 31_000_001, 4, top(%{"active_days" => 10}))
      assert Filters.match?(sub, 31_000_001, 4, top(%{"active_days" => 40}))
      refute Filters.match?(sub, 31_000_001, 4, top(%{"active_days" => 9}))
      refute Filters.match?(sub, 31_000_001, 4, top(%{"active_days" => 41}))
    end

    test "a subscription that needs a corporation does not match without one" do
      sub = subscription(min_active_days: 1)
      refute Filters.match?(sub, 31_000_001, 4, nil)
    end
  end

  describe "top corporation timezone" do
    test "applies the offset range" do
      sub = subscription(timezone_min: 8, timezone_max: 10)

      assert Filters.match?(sub, 31_000_001, 4, top(%{"timezone_offset" => 8}))
      assert Filters.match?(sub, 31_000_001, 4, top(%{"timezone_offset" => 10}))
      refute Filters.match?(sub, 31_000_001, 4, top(%{"timezone_offset" => 7}))
      refute Filters.match?(sub, 31_000_001, 4, top(%{"timezone_offset" => 11}))
    end

    test "missing timezone only matches when the switch is on" do
      refusal = subscription(timezone_min: 8, timezone_max: 10)
      allowed = subscription(timezone_min: 8, timezone_max: 10, allow_missing_timezone: true)

      refute Filters.match?(refusal, 31_000_001, 4, top(%{"timezone_offset" => nil}))
      assert Filters.match?(allowed, 31_000_001, 4, top(%{"timezone_offset" => nil}))
    end

    test "allow_missing_timezone does not bypass active-days filters" do
      sub =
        subscription(
          min_active_days: 20,
          timezone_min: 8,
          timezone_max: 10,
          allow_missing_timezone: true
        )

      refute Filters.match?(
               sub,
               31_000_001,
               4,
               top(%{"active_days" => 5, "timezone_offset" => nil})
             )
    end
  end

  describe "parse_class/1" do
    test "reads the helper's class labels" do
      assert Filters.parse_class("c4") == 4
      assert Filters.parse_class("C13") == 13
      assert Filters.parse_class("c0") == 0
      assert Filters.parse_class("HS") == nil
      assert Filters.parse_class(nil) == nil
    end
  end
end
