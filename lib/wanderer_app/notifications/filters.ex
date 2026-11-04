defmodule WandererApp.Notifications.Filters do
  @moduledoc """
  Pure filter evaluation for system notification subscriptions.

  Kept free of database and network calls so each rule can be tested on its
  own. The dispatcher resolves the system class and the top corporation first,
  then asks this module whether the subscription matches.
  """

  @doc """
  Returns true when `system_id` is one of the subscription's systems and every
  configured filter passes.

  `system_class` is the local EVE class id (1-6 for wormhole systems, 7+ for
  known space) or nil when unknown. `top_corporation` is the helper's top-1
  entry (a map with string keys) or nil.
  """
  def match?(subscription, system_id, system_class, top_corporation) do
    system_matches?(subscription, system_id) and
      class_matches?(subscription, system_class) and
      top_corporation_matches?(subscription, top_corporation)
  end

  @doc """
  True when the system belongs to the subscription's explicit list.

  An empty list is the fuzzy-filter mode and places no restriction on the
  system; the class / top-corporation filters decide instead.
  """
  def system_matches?(subscription, system_id) do
    system_ids = List.wrap(subscription.system_ids)

    is_integer(system_id) and (system_ids == [] or system_id in system_ids)
  end

  def class_matches?(subscription, system_class) do
    classes = List.wrap(subscription.wormhole_classes)

    classes == [] or
      (is_integer(system_class) and system_class in classes)
  end

  @doc "True when at least one filter depends on the top-1 corporation."
  def needs_top_corporation?(subscription) do
    not is_nil(subscription.min_active_days) or
      not is_nil(subscription.max_active_days) or
      not is_nil(subscription.timezone_min) or
      not is_nil(subscription.timezone_max)
  end

  @doc """
  Returns true when the subscription's top-corporation filters pass.

  When no such filter is configured the top corporation is irrelevant, so the
  helper is not consulted and a missing answer never blocks a notification.
  """
  def top_corporation_matches?(subscription, top_corporation) do
    if needs_top_corporation?(subscription) do
      top_corporation_matches_required?(subscription, top_corporation)
    else
      true
    end
  end

  defp top_corporation_matches_required?(_subscription, nil), do: false

  defp top_corporation_matches_required?(subscription, top_corporation) do
    active_days = top_corporation["active_days"]
    timezone = top_corporation["timezone_offset"]

    active_days_match?(
      subscription.min_active_days,
      subscription.max_active_days,
      active_days
    ) and
      timezone_match?(
        subscription.timezone_min,
        subscription.timezone_max,
        subscription.allow_missing_timezone,
        timezone
      )
  end

  defp active_days_match?(nil, nil, _active_days), do: true

  defp active_days_match?(_min, _max, active_days) when not is_integer(active_days), do: false

  defp active_days_match?(min, max, active_days) do
    (is_nil(min) or active_days >= min) and (is_nil(max) or active_days <= max)
  end

  defp timezone_match?(nil, nil, _allow_missing, _timezone), do: true

  defp timezone_match?(_min, _max, true, nil), do: true
  defp timezone_match?(_min, _max, false, nil), do: false

  defp timezone_match?(min, max, _allow_missing, timezone) when is_integer(timezone) do
    (is_nil(min) or timezone >= min) and (is_nil(max) or timezone <= max)
  end

  defp timezone_match?(_min, _max, _allow_missing, _timezone), do: false

  @doc """
  Parses the helper's class string ("c4", "C4", "c13") into its integer id.
  Known-space labels and empty values return nil.
  """
  def parse_class(value) when is_binary(value) do
    case Regex.run(~r/\A[cC](\d{1,2})\z/, String.trim(value)) do
      [_, digits] -> String.to_integer(digits)
      _ -> nil
    end
  end

  def parse_class(_value), do: nil
end
