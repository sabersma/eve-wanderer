defmodule WandererApp.Notifications.WindowTest do
  @moduledoc """
  Covers the atomic cooldown claim against the real database.

  The claim is the only thing that prevents two tracker processes from sending
  two emails for the same first connection, so the second call must see the row
  written by the first one as a cooldown.
  """

  use WandererApp.DataCase, async: false

  alias WandererApp.Api.NotificationSubscription
  alias WandererApp.Notifications.Window

  setup do
    user = insert(:user)
    map = insert(:map)

    {:ok, subscription} =
      NotificationSubscription.create(%{
        name: "window test",
        map_id: map.id,
        user_id: user.id,
        system_ids: [31_000_001],
        system_names: ["J123456"],
        recipient_emails: ["test@example.com"]
      })

    %{subscription: subscription}
  end

  test "a string uuid claims once and then reports a cooldown", %{subscription: subscription} do
    assert Window.claim(subscription.id, 31_000_001, 24) == :claimed
    assert Window.claim(subscription.id, 31_000_001, 24) == :cooldown
  end

  test "each system has its own window", %{subscription: subscription} do
    assert Window.claim(subscription.id, 31_000_001, 24) == :claimed
    assert Window.claim(subscription.id, 31_000_002, 24) == :claimed
    assert Window.claim(subscription.id, 31_000_001, 24) == :cooldown
  end

  test "an expired window can be claimed again", %{subscription: subscription} do
    assert Window.claim(subscription.id, 31_000_001, 1) == :claimed

    Repo.query!(
      "UPDATE notification_windows_v1 SET expires_at = now() - interval '1 minute' WHERE subscription_id = $1",
      [Ecto.UUID.dump!(subscription.id)]
    )

    assert Window.claim(subscription.id, 31_000_001, 1) == :claimed
  end

  test "releasing a failed send allows the next connection to notify", %{
    subscription: subscription
  } do
    assert Window.claim(subscription.id, 31_000_001, 24) == :claimed
    assert Window.release(subscription.id, 31_000_001) == :ok
    assert Window.claim(subscription.id, 31_000_001, 24) == :claimed
  end

  test "an invalid subscription id is rejected", %{subscription: _subscription} do
    assert Window.claim("not-a-uuid", 31_000_001, 24) == {:error, :invalid_subscription_id}
  end
end
