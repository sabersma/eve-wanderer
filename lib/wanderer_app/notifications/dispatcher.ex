defmodule WandererApp.Notifications.Dispatcher do
  @moduledoc """
  Turns one character location change into zero or more notification emails.

  A character only counts for a subscription when it is tracked on that
  subscription's map *and* still has permission there. That keeps the feature
  limited to maps the subscription owner can actually see, as requested: a
  subscription is created for one map, not for every map the character is on.
  """

  require Logger

  alias WandererApp.Api.NotificationDelivery
  alias WandererApp.Api.NotificationSubscription
  alias WandererApp.Character.TrackingUtils
  alias WandererApp.MapCharacterSettingsRepo
  alias WandererApp.Notifications.{Email, Filters, JspaceData, SystemResolver, Window}

  @doc """
  Processes a location change. `from_system_id` may be nil (first position
  report); only changes into a subscribed system are considered.
  """
  def process(character_id, from_system_id, to_system_id) do
    if WandererApp.Env.notifications_enabled?() and
         is_binary(character_id) and is_integer(to_system_id) and
         to_system_id > 0 and from_system_id != to_system_id do
      do_process(character_id, to_system_id)
    else
      :skip
    end
  end

  defp do_process(character_id, system_id) do
    with {:ok, character} <- WandererApp.Character.get_character(character_id),
         true <- character != nil,
         {:ok, subscriptions} <- NotificationSubscription.all_enabled() do
      subscriptions
      |> Enum.filter(&Filters.system_matches?(&1, system_id))
      |> Enum.each(&maybe_notify(&1, character, system_id))
    else
      false ->
        :ok

      {:error, reason} ->
        Logger.debug("Notification dispatcher could not load character/subscriptions",
          character_id: character_id,
          reason: inspect(reason)
        )
    end
  end

  defp maybe_notify(subscription, character, system_id) do
    if eligible?(subscription, character) do
      {system_class, top_corporation} = resolve_filter_context(subscription, system_id)

      if Filters.match?(subscription, system_id, system_class, top_corporation) do
        notify(subscription, character, system_id, top_corporation)
      end
    end
  end

  # Both checks are required by the product rule: the character must have
  # location tracking enabled for this map, and it must still be allowed to be
  # tracked there (ACLs can change after the tracking flag was set).
  defp eligible?(subscription, character) do
    tracked_on_map? =
      case MapCharacterSettingsRepo.get_tracked_by_map_filtered(subscription.map_id, [
             character.id
           ]) do
        {:ok, settings} when is_list(settings) -> settings != []
        _ -> false
      end

    tracked_on_map? and permitted_on_map?(subscription.map_id, character)
  end

  defp permitted_on_map?(map_id, character) do
    match?({:ok, :allowed}, TrackingUtils.check_character_tracking_permission(character, map_id))
  rescue
    _ -> false
  end

  defp resolve_filter_context(subscription, system_id) do
    local_class = local_class(system_id)

    if Filters.needs_top_corporation?(subscription) do
      case JspaceData.top_corporation(system_id) do
        {:ok, %{system: helper_system, top: top}} ->
          {local_class || Filters.parse_class(helper_system["class"]), top}

        {:error, reason} ->
          Logger.debug("Top corporation unavailable for notification filters",
            system_id: system_id,
            reason: inspect(reason)
          )

          {local_class, nil}
      end
    else
      {local_class, nil}
    end
  end

  defp local_class(system_id) do
    case SystemResolver.local_by_id(system_id) do
      %{class: class} -> class
      _ -> nil
    end
  end

  defp notify(subscription, character, system_id, top_corporation) do
    case Window.claim(subscription.id, system_id, subscription.cooldown_hours) do
      :claimed ->
        deliver(subscription, character, system_id, top_corporation)

      :cooldown ->
        :ok

      {:error, reason} ->
        Logger.error("Failed to claim notification window",
          subscription_id: subscription.id,
          system_id: system_id,
          reason: inspect(reason)
        )
    end
  end

  defp deliver(subscription, character, system_id, top_corporation) do
    system_name = system_name(subscription, system_id)
    map_name = map_name(subscription.map_id)

    attrs = %{
      subscription_id: subscription.id,
      character_id: character.id,
      system_id: system_id,
      system_name: system_name,
      character_name: character.name,
      corporation_name: character.corporation_name,
      alliance_name: character.alliance_name,
      recipient_emails: subscription.recipient_emails,
      status: "pending"
    }

    case NotificationDelivery.create(attrs) do
      {:ok, delivery} ->
        send_and_update(
          delivery,
          subscription,
          character,
          system_id,
          system_name,
          map_name,
          top_corporation
        )

      {:error, error} ->
        Logger.error("Failed to record notification delivery",
          subscription_id: subscription.id,
          error: inspect(error)
        )
    end
  end

  defp send_and_update(
         delivery,
         subscription,
         character,
         system_id,
         system_name,
         map_name,
         top_corporation
       ) do
    case Email.deliver(
           subscription,
           character,
           system_id,
           system_name,
           map_name,
           top_corporation
         ) do
      {:ok, _metadata} ->
        NotificationDelivery.mark_sent(delivery)

        Logger.info("System notification sent",
          subscription_id: subscription.id,
          system_id: system_id,
          character_id: character.id
        )

      {:error, reason} ->
        # The email did not go out, so do not keep the first connector silent
        # for the rest of the cooldown.
        case Window.release(subscription.id, system_id) do
          :ok ->
            :ok

          {:error, release_reason} ->
            Logger.error("Failed to release notification window",
              subscription_id: subscription.id,
              system_id: system_id,
              reason: inspect(release_reason)
            )
        end

        NotificationDelivery.mark_failed(delivery, %{error: format_error(reason)})

        Logger.error("System notification email failed",
          subscription_id: subscription.id,
          system_id: system_id,
          character_id: character.id,
          reason: inspect(reason)
        )
    end
  end

  defp system_name(subscription, system_id) do
    index = Enum.find_index(List.wrap(subscription.system_ids), &(&1 == system_id))

    name =
      if is_integer(index) do
        Enum.at(List.wrap(subscription.system_names), index)
      end

    name || local_name(system_id) || Integer.to_string(system_id)
  end

  defp local_name(system_id) do
    case SystemResolver.local_by_id(system_id) do
      %{name: name} -> name
      _ -> nil
    end
  end

  defp map_name(map_id) do
    case WandererApp.MapRepo.get(map_id) do
      {:ok, map} -> map.name
      _ -> nil
    end
  end

  defp format_error(reason) do
    reason
    |> inspect()
    |> String.slice(0, 1_000)
  end
end
