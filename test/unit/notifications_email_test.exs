defmodule WandererApp.Notifications.EmailTest do
  @moduledoc """
  Builds the notification emails against Swoosh's test adapter.

  This catches composition errors (nil character fields, map names, top
  corporation rows) without contacting a real SMTP server.
  """

  use ExUnit.Case, async: false

  import Swoosh.TestAssertions

  alias WandererApp.Notifications.Email

  setup do
    previous = Application.get_env(:wanderer_app, :notifications)

    Application.put_env(:wanderer_app, :notifications,
      enabled: true,
      from_name: "BLKSH-Wanderer 星系通知",
      from_address: "notify@example.com",
      smtp_host: "smtp.example.com"
    )

    on_exit(fn ->
      if previous do
        Application.put_env(:wanderer_app, :notifications, previous)
      else
        Application.delete_env(:wanderer_app, :notifications)
      end
    end)

    :ok
  end

  test "a first-connection email names the subscription, character and top corporation" do
    subscription = %{
      name: "J113434 入口",
      recipient_emails: ["member@example.com"]
    }

    character = %{
      name: "Alice",
      eve_id: "90000001",
      corporation_name: "Test Corp",
      alliance_name: nil
    }

    top = %{
      "corporation_name" => "Top Corp",
      "active_days" => 30,
      "activity_level" => "high",
      "timezone_offset" => 8,
      "active_window_utc" => %{"start" => 12, "end" => 14}
    }

    assert {:ok, _} =
             Email.deliver(subscription, character, 31_000_016, "J113434", "Test Map", top)

    assert_email_sent(fn email ->
      email.subject == "[星系通知] J113434 入口 · J113434" and
        email.text_body =~ "Alice" and
        email.text_body =~ "Top Corp" and
        email.text_body =~ "Test Map"
    end)
  end

  test "the test email uses the subscription map name" do
    subscription = %{
      name: "测试订阅",
      map_id: "map-id",
      recipient_emails: ["member@example.com"]
    }

    assert {:ok, _} = Email.send_test(subscription, "Test Map")

    assert_email_sent(fn email ->
      email.subject == "[星系通知] 测试 - 测试订阅" and
        email.text_body =~ "Test Map" and
        email.html_body =~ "Test Map"
    end)
  end

  test "a missing sender address is reported instead of silently dropping" do
    Application.put_env(:wanderer_app, :notifications, enabled: true, from_address: "")

    assert Email.send_test(%{name: "x", map_id: "m", recipient_emails: ["a@example.com"]}, "m") ==
             {:error, :sender_not_configured}
  end
end
