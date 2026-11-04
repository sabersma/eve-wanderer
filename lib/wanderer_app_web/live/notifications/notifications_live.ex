defmodule WandererAppWeb.NotificationsLive do
  use WandererAppWeb, :live_view

  require Logger

  alias WandererApp.Api.{NotificationDelivery, NotificationSubscription}
  alias WandererApp.Notifications.{Email, SystemResolver}
  alias WandererApp.{Env, MapCharacterSettingsRepo, Maps}

  @email_regex ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/
  @timezone_options Enum.to_list(-12..14)
  @classes Enum.to_list(1..6)
  @mode_systems "systems"
  @mode_filters "filters"

  @impl true
  def mount(_params, _session, socket) do
    %{current_user: user} = socket.assigns

    {:ok, maps} =
      user
      |> Maps.get_available_maps()
      |> case do
        {:ok, maps} -> {:ok, maps}
        _ -> {:ok, []}
      end

    editable_maps =
      maps
      |> Enum.filter(&Maps.can_edit?(&1, user))
      |> Enum.sort_by(& &1.name)

    tracked_counts = Map.new(editable_maps, &{&1.id, tracked_count(&1.id)})
    {subscriptions, deliveries} = load_data(user)

    {:ok,
     socket
     |> assign(
       page_title: "星系通知订阅",
       active_page: :notifications,
       maps: editable_maps,
       tracked_counts: tracked_counts,
       subscriptions: subscriptions,
       subscription_names: Map.new(subscriptions, &{&1.id, &1.name}),
       deliveries: deliveries,
       notifications_enabled?: Env.notifications_enabled?(),
       smtp_configured?: smtp_configured?(),
       classes: @classes,
       timezone_options: @timezone_options,
       editing_id: nil,
       errors: [],
       form: to_form(default_form(), as: :subscription)
     )}
  end

  @impl true
  def handle_event("validate", %{"subscription" => params}, socket) do
    {:noreply,
     socket
     |> assign(form: to_form(params, as: :subscription), errors: [])}
  end

  def handle_event("save", %{"subscription" => params}, socket) do
    %{current_user: user} = socket.assigns

    case build_attrs(params, socket, user) do
      {:ok, attrs} ->
        result =
          case socket.assigns.editing_id do
            nil ->
              NotificationSubscription.create(Map.put(attrs, :user_id, user.id))

            id ->
              with {:ok, subscription} <- owned_subscription(id, user),
                   {:ok, updated} <- NotificationSubscription.update(subscription, attrs) do
                {:ok, updated}
              end
          end

        case result do
          {:ok, _subscription} ->
            {subscriptions, deliveries} = load_data(user)

            {:noreply,
             socket
             |> assign(
               subscriptions: subscriptions,
               subscription_names: Map.new(subscriptions, &{&1.id, &1.name}),
               deliveries: deliveries,
               editing_id: nil,
               errors: [],
               form: to_form(default_form(), as: :subscription)
             )
             |> put_flash(:info, "订阅已保存")}

          {:error, error} ->
            Logger.error("Failed to save notification subscription", error: inspect(error))

            {:noreply,
             socket
             |> assign(errors: ["保存失败，请检查填写内容后重试"])
             |> assign(form: to_form(params, as: :subscription))}
        end

      {:error, message} ->
        {:noreply,
         socket
         |> assign(errors: List.wrap(message))
         |> assign(form: to_form(params, as: :subscription))}
    end
  end

  def handle_event("edit", %{"id" => id}, socket) do
    %{current_user: user} = socket.assigns

    case owned_subscription(id, user) do
      {:ok, subscription} ->
        {:noreply,
         socket
         |> assign(
           editing_id: subscription.id,
           errors: [],
           form: to_form(form_values(subscription), as: :subscription)
         )}

      _ ->
        {:noreply, put_flash(socket, :error, "订阅不存在")}
    end
  end

  def handle_event("cancel", _params, socket) do
    {:noreply,
     socket
     |> assign(editing_id: nil, errors: [], form: to_form(default_form(), as: :subscription))}
  end

  def handle_event("delete", %{"id" => id}, socket) do
    %{current_user: user} = socket.assigns

    with {:ok, subscription} <- owned_subscription(id, user),
         :ok <- NotificationSubscription.destroy(subscription) do
      {subscriptions, deliveries} = load_data(user)

      {:noreply,
       socket
       |> assign(
         subscriptions: subscriptions,
         subscription_names: Map.new(subscriptions, &{&1.id, &1.name}),
         deliveries: deliveries,
         editing_id: nil
       )
       |> put_flash(:info, "订阅已删除")}
    else
      _ -> {:noreply, put_flash(socket, :error, "删除失败")}
    end
  end

  def handle_event("toggle", %{"id" => id}, socket) do
    %{current_user: user} = socket.assigns

    with {:ok, subscription} <- owned_subscription(id, user),
         {:ok, _} <-
           NotificationSubscription.update(subscription, %{enabled: !subscription.enabled}) do
      {subscriptions, deliveries} = load_data(user)

      {:noreply,
       socket
       |> assign(
         subscriptions: subscriptions,
         subscription_names: Map.new(subscriptions, &{&1.id, &1.name}),
         deliveries: deliveries
       )}
    else
      _ -> {:noreply, put_flash(socket, :error, "操作失败")}
    end
  end

  def handle_event("test", %{"id" => id}, socket) do
    %{current_user: user} = socket.assigns

    with {:ok, subscription} <- owned_subscription(id, user) do
      map_name = map_name(socket.assigns.maps, subscription.map_id)

      result =
        case Task.yield(
               Task.async(fn -> Email.send_test(subscription, map_name) end),
               15_000
             ) do
          {:ok, result} -> result
          nil -> {:error, :timeout}
        end

      socket =
        case result do
          {:ok, _} ->
            put_flash(socket, :info, "测试邮件已发送，请检查收件箱")

          {:error, :sender_not_configured} ->
            put_flash(socket, :error, "SMTP 未配置，无法发送")

          {:error, reason} ->
            Logger.warning("Notification test email failed", reason: inspect(reason))
            put_flash(socket, :error, "测试邮件发送失败：#{inspect(reason)}")
        end

      {:noreply, socket}
    else
      _ -> {:noreply, put_flash(socket, :error, "订阅不存在")}
    end
  end

  defp load_data(user) do
    subscriptions =
      case NotificationSubscription.by_user(%{user_id: user.id}) do
        {:ok, subscriptions} -> subscriptions
        _ -> []
      end

    ids = Enum.map(subscriptions, & &1.id)

    deliveries =
      case ids do
        [] ->
          []

        _ ->
          case NotificationDelivery.recent_for_subscriptions(%{subscription_ids: ids}) do
            {:ok, deliveries} -> Enum.take(deliveries, 40)
            _ -> []
          end
      end

    {subscriptions, deliveries}
  end

  defp owned_subscription(id, user) do
    case NotificationSubscription.by_id(id) do
      {:ok, %{user_id: user_id} = subscription} when user_id == user.id ->
        {:ok, subscription}

      _ ->
        {:error, :not_found}
    end
  end

  defp tracked_count(map_id) do
    case MapCharacterSettingsRepo.get_tracked_by_map_all(map_id) do
      {:ok, settings} -> length(settings)
      _ -> 0
    end
  end

  defp smtp_configured? do
    config = Env.notifications_config()
    is_binary(config[:smtp_host]) and config[:smtp_host] != ""
  end

  defp default_form do
    %{
      "map_id" => "",
      "name" => "",
      "mode" => @mode_systems,
      "systems" => "",
      "wormhole_classes" => [],
      "min_active_days" => "",
      "max_active_days" => "",
      "timezone_min" => "",
      "timezone_max" => "",
      "allow_missing_timezone" => "false",
      "recipient_emails" => "",
      "cooldown_hours" => "24",
      "enabled" => "true"
    }
  end

  defp form_values(subscription) do
    %{
      "map_id" => subscription.map_id,
      "name" => subscription.name,
      "mode" => subscription_mode(subscription),
      "systems" => Enum.join(subscription.system_names, "\n"),
      "wormhole_classes" => Enum.map(subscription.wormhole_classes, &Integer.to_string/1),
      "min_active_days" => optional_string(subscription.min_active_days),
      "max_active_days" => optional_string(subscription.max_active_days),
      "timezone_min" => optional_string(subscription.timezone_min),
      "timezone_max" => optional_string(subscription.timezone_max),
      "allow_missing_timezone" => to_string(subscription.allow_missing_timezone),
      "recipient_emails" => Enum.join(subscription.recipient_emails, "\n"),
      "cooldown_hours" => to_string(subscription.cooldown_hours),
      "enabled" => to_string(subscription.enabled)
    }
  end

  defp build_attrs(params, socket, user) do
    with {:ok, map_id} <- parse_map_id(params, socket),
         :ok <- authorized_map?(map_id, socket, user),
         {:ok, name} <- parse_name(params["name"]),
         {:ok, mode} <- parse_mode(params["mode"]),
         {:ok, scope} <- build_scope(mode, params),
         {:ok, emails} <- parse_emails(params["recipient_emails"]),
         {:ok, cooldown} <- parse_cooldown(params["cooldown_hours"]) do
      {:ok,
       Map.merge(scope, %{
         map_id: map_id,
         name: name,
         recipient_emails: emails,
         cooldown_hours: cooldown,
         enabled: truthy?(params["enabled"])
       })}
    end
  end

  # Mode 1: an explicit system list. The class / corporation filters are cleared
  # because they would only narrow the list the user already chose.
  defp build_scope(@mode_systems, params) do
    with {:ok, systems} <- parse_systems(params["systems"]) do
      {:ok,
       %{
         system_ids: Enum.map(systems, & &1.id),
         system_names: Enum.map(systems, & &1.name),
         wormhole_classes: [],
         min_active_days: nil,
         max_active_days: nil,
         timezone_min: nil,
         timezone_max: nil,
         allow_missing_timezone: false
       }}
    end
  end

  # Mode 2: fuzzy filters applied to every system the tracked characters enter.
  # At least one criterion is required, otherwise the subscription would match
  # every system and send mail for every location change.
  defp build_scope(@mode_filters, params) do
    with {:ok, classes} <- parse_classes(params["wormhole_classes"]),
         {:ok, min_days, max_days} <-
           parse_range(params["min_active_days"], params["max_active_days"], 0, 60, "活跃天数"),
         {:ok, timezone_min, timezone_max} <-
           parse_range(params["timezone_min"], params["timezone_max"], -12, 14, "时区") do
      if classes == [] and is_nil(min_days) and is_nil(max_days) and is_nil(timezone_min) and
           is_nil(timezone_max) do
        {:error, "按条件筛选时，请至少设置虫洞等级、活跃天数或时区中的一个"}
      else
        {:ok,
         %{
           system_ids: [],
           system_names: [],
           wormhole_classes: classes,
           min_active_days: min_days,
           max_active_days: max_days,
           timezone_min: timezone_min,
           timezone_max: timezone_max,
           allow_missing_timezone:
             truthy?(params["allow_missing_timezone"]) and
               (not is_nil(timezone_min) or not is_nil(timezone_max))
         }}
      end
    end
  end

  defp parse_mode(@mode_filters), do: {:ok, @mode_filters}
  defp parse_mode(@mode_systems), do: {:ok, @mode_systems}
  defp parse_mode(nil), do: {:ok, @mode_systems}
  defp parse_mode(""), do: {:ok, @mode_systems}
  defp parse_mode(_mode), do: {:error, "请选择筛选方式"}

  defp parse_map_id(%{"map_id" => map_id}, _socket) when is_binary(map_id) and map_id != "",
    do: {:ok, map_id}

  defp parse_map_id(_params, _socket), do: {:error, "请选择地图"}

  defp authorized_map?(map_id, socket, _user) do
    if Enum.any?(socket.assigns.maps, &(&1.id == map_id)) do
      :ok
    else
      {:error, "只能为你有管理权限的地图创建订阅"}
    end
  end

  defp parse_name(name) when is_binary(name) do
    name = String.trim(name)

    cond do
      name == "" -> {:error, "请填写订阅名称"}
      String.length(name) > 100 -> {:error, "订阅名称不能超过 100 个字符"}
      true -> {:ok, name}
    end
  end

  defp parse_name(_name), do: {:error, "请填写订阅名称"}

  defp parse_systems(raw) do
    case SystemResolver.resolve_many(to_string(raw || "")) do
      {:ok, systems} ->
        {:ok, systems}

      {:error, {:unresolved, tokens}} ->
        {:error, "无法识别星系：#{Enum.join(tokens, "、")}（支持英文名、中文名或星系 ID）"}

      {:error, :empty} ->
        {:error, "请至少填写一个星系"}

      {:error, _} ->
        {:error, "星系解析失败，请稍后重试"}
    end
  end

  defp parse_classes(nil), do: {:ok, []}
  defp parse_classes(""), do: {:ok, []}

  defp parse_classes(classes) when is_list(classes) do
    parsed =
      classes
      |> Enum.map(&to_integer/1)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    if parsed != [] and Enum.all?(parsed, &(&1 in @classes)) do
      {:ok, Enum.sort(parsed)}
    else
      {:error, "虫洞等级只能是 1-6"}
    end
  end

  defp parse_classes(class) when is_binary(class), do: parse_classes([class])
  defp parse_classes(_classes), do: {:ok, []}

  defp parse_range(min_raw, max_raw, lower, upper, label) do
    with {:ok, min_value} <- parse_optional_int(min_raw, lower, upper, label),
         {:ok, max_value} <- parse_optional_int(max_raw, lower, upper, label) do
      cond do
        not is_nil(min_value) and not is_nil(max_value) and min_value > max_value ->
          {:error, "#{label}范围的最小值不能大于最大值"}

        true ->
          {:ok, min_value, max_value}
      end
    end
  end

  defp parse_optional_int(raw, _lower, _upper, _label) when raw in [nil, ""], do: {:ok, nil}

  defp parse_optional_int(raw, lower, upper, label) do
    case Integer.parse(to_string(raw)) do
      {value, ""} when value >= lower and value <= upper ->
        {:ok, value}

      _ ->
        {:error, "#{label}必须是 #{lower} 到 #{upper} 之间的整数"}
    end
  end

  defp parse_emails(raw) do
    emails =
      raw
      |> to_string()
      |> String.split(~r/[\s,;，；]+/u)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    invalid = Enum.reject(emails, &Regex.match?(@email_regex, &1))

    cond do
      emails == [] -> {:error, "请至少填写一个收件邮箱"}
      invalid != [] -> {:error, "邮箱格式不正确：#{Enum.join(invalid, "、")}"}
      true -> {:ok, emails}
    end
  end

  defp parse_cooldown(raw) do
    case Integer.parse(to_string(raw || "24")) do
      {hours, ""} when hours >= 1 and hours <= 720 -> {:ok, hours}
      _ -> {:error, "冷却时间必须是 1 到 720 小时之间的整数"}
    end
  end

  defp truthy?(value), do: value in [true, "true", "on", "1"]

  defp to_integer(value) when is_integer(value), do: value

  defp to_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {integer, ""} -> integer
      _ -> nil
    end
  end

  defp to_integer(_value), do: nil

  defp optional_string(nil), do: ""
  defp optional_string(value), do: to_string(value)

  defp subscription_mode(%{system_ids: []}), do: @mode_filters
  defp subscription_mode(_subscription), do: @mode_systems

  defp specific_subscription?(subscription), do: subscription_mode(subscription) == @mode_systems

  defp map_name(maps, map_id) do
    case Enum.find(maps, &(&1.id == map_id)) do
      nil -> nil
      map -> map.name
    end
  end

  defp map_option_label(map, tracked_counts) do
    "#{map.name} (#{Map.get(tracked_counts, map.id, 0)} 个已跟踪角色)"
  end

  defp checkbox_values(nil), do: []
  defp checkbox_values(values) when is_list(values), do: Enum.map(values, &to_string/1)
  defp checkbox_values(value), do: [to_string(value)]

  defp timezone_label(0), do: "UTC+0"
  defp timezone_label(offset) when offset > 0, do: "UTC+#{offset}"
  defp timezone_label(offset), do: "UTC#{offset}"

  defp filter_summary(subscription) do
    if specific_subscription?(subscription) do
      "指定星系 #{length(subscription.system_ids)} 个 · 冷却 #{subscription.cooldown_hours} 小时"
    else
      classes =
        case subscription.wormhole_classes do
          [] -> "等级不限"
          classes -> "等级 " <> Enum.map_join(classes, "、", &"C#{&1}")
        end

      active_days =
        case {subscription.min_active_days, subscription.max_active_days} do
          {nil, nil} -> "活跃天数不限"
          {min, nil} -> "活跃天数 ≥#{min}"
          {nil, max} -> "活跃天数 ≤#{max}"
          {min, max} -> "活跃天数 #{min}-#{max}"
        end

      timezone =
        case {subscription.timezone_min, subscription.timezone_max} do
          {nil, nil} ->
            "时区不限"

          {min, nil} ->
            "时区 ≥#{timezone_label(min)}"

          {nil, max} ->
            "时区 ≤#{timezone_label(max)}"

          {min, max} ->
            "时区 #{timezone_label(min)} 至 #{timezone_label(max)}"
        end

      timezone =
        if subscription.allow_missing_timezone and
             (not is_nil(subscription.timezone_min) or not is_nil(subscription.timezone_max)),
           do: timezone <> "（无时区也匹配）",
           else: timezone

      "#{classes} · #{active_days} · #{timezone} · 冷却 #{subscription.cooldown_hours} 小时"
    end
  end

  defp status_class("sent"), do: "badge-success"
  defp status_class("failed"), do: "badge-error"
  defp status_class(_status), do: "badge-warning"

  defp format_time(nil), do: "-"

  defp format_time(%DateTime{} = time) do
    Calendar.strftime(time, "%Y-%m-%d %H:%M UTC")
  end

  defp format_time(_time), do: "-"
end
