defmodule WandererApp.Notifications.Email do
  @moduledoc """
  Composes and sends the system notification emails.
  """

  import Swoosh.Email

  alias WandererApp.Env
  alias WandererApp.Mailer

  @doc """
  Sends the notification for the first character that entered the system.

  Returns the mailer result. A missing sender address is an error instead of a
  silent drop, so the delivery log shows why nothing was delivered.
  """
  def deliver(subscription, character, system_id, system_name, map_name, top_corporation) do
    config = Env.notifications_config()
    from_address = config[:from_address]

    with true <- is_binary(from_address) and from_address != "",
         {:ok, email} <-
           build(subscription, character, system_id, system_name, map_name, top_corporation) do
      Mailer.deliver(email)
    else
      false -> {:error, :sender_not_configured}
      error -> error
    end
  end

  @doc "Sends a test email for a subscription (used by the page)."
  def send_test(subscription, map_name) do
    config = Env.notifications_config()
    from_address = config[:from_address]

    if is_binary(from_address) and from_address != "" do
      rows = [
        {"订阅", subscription.name},
        {"地图", map_name || subscription.map_id},
        {"收件人", Enum.join(subscription.recipient_emails, ", ")}
      ]

      body = """
      这是一封测试邮件。

      #{Enum.map_join(rows, "\n", fn {label, value} -> "#{label}：#{value}" end)}

      收到这封邮件说明 SMTP 配置可用。真实通知会在符合条件的角色进入订阅星系时发送。
      """

      new()
      |> to(subscription.recipient_emails)
      |> from({config[:from_name], from_address})
      |> subject("[星系通知] 测试 - #{subscription.name}")
      |> text_body(body)
      |> html_body("<p>这是一封测试邮件。</p>" <> details_html(rows))
      |> Mailer.deliver()
    else
      {:error, :sender_not_configured}
    end
  end

  defp build(subscription, character, system_id, system_name, map_name, top_corporation) do
    config = Env.notifications_config()
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    rows = [
      {"订阅名称", subscription.name},
      {"星系", "#{system_name} (ID: #{system_id})"},
      {"首个连接角色", character.name},
      {"角色 ID", character.eve_id},
      {"军团", character.corporation_name},
      {"联盟", character.alliance_name},
      {"地图", map_name},
      {"时间", "#{DateTime.to_iso8601(now)} UTC"}
    ]

    rows = rows ++ top_corporation_rows(top_corporation)

    text =
      """
      星系通知：有成员进入了订阅的星系。

      #{Enum.map_join(rows, "\n", fn {label, value} -> "#{label}：#{value || "-"}" end)}
      """

    email =
      new()
      |> to(subscription.recipient_emails)
      |> from({config[:from_name], config[:from_address]})
      |> subject("[星系通知] #{subscription.name} · #{system_name}")
      |> text_body(text)
      |> html_body(notification_html(subscription, rows))

    {:ok, email}
  end

  defp top_corporation_rows(nil), do: []

  defp top_corporation_rows(top) do
    name = top["corporation_name"] || "Corp##{top["corporation_id"]}"

    timezone =
      case top["timezone_offset"] do
        nil -> "未知"
        offset when is_integer(offset) and offset >= 0 -> "UTC+#{offset}"
        offset -> "UTC#{offset}"
      end

    window =
      case top["active_window_utc"] do
        %{"start" => start, "end" => finish} ->
          "#{pad_hour(start)}:00-#{pad_hour(finish)}:59 UTC"

        _ ->
          "-"
      end

    [
      {"Top1 活跃军团 (60D)", name},
      {"Top1 活跃天数", top["active_days"]},
      {"Top1 活跃等级", top["activity_level"]},
      {"Top1 活跃时区", "#{timezone} (#{window})"}
    ]
  end

  defp notification_html(subscription, rows) do
    "<h2>星系通知</h2>" <>
      "<p>有成员进入了 <strong>#{esc(subscription.name)}</strong> 订阅的星系。</p>" <>
      details_html(rows)
  end

  defp details_html([]), do: "<p>订阅配置正常。</p>"

  defp details_html(rows) do
    items =
      rows
      |> Enum.map_join(fn {label, value} ->
        "<tr><td style=\"padding:4px 12px 4px 0;color:#666\">#{esc(label)}</td>" <>
          "<td style=\"padding:4px 0\">#{esc(value || "-")}</td></tr>"
      end)

    "<table style=\"border-collapse:collapse;font-family:sans-serif;font-size:14px\">#{items}</table>"
  end

  defp esc(value) do
    value
    |> to_string()
    |> Phoenix.HTML.html_escape()
    |> Phoenix.HTML.safe_to_string()
  end

  defp pad_hour(hour) when is_integer(hour) do
    hour |> Integer.to_string() |> String.pad_leading(2, "0")
  end

  defp pad_hour(_hour), do: "--"
end
