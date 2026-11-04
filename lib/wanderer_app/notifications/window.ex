defmodule WandererApp.Notifications.Window do
  @moduledoc """
  Atomic first-connector claim for a subscription and system.

  The unique row per `(subscription_id, system_id)` is upserted only when its
  previous window has expired. PostgreSQL serializes the competing inserts, so
  exactly one process gets a row back and may send the notification; everyone
  else sees zero rows and stays quiet.
  """

  @default_cooldown_hours 24
  @max_cooldown_hours 720

  @claim_sql """
  INSERT INTO notification_windows_v1
    (id, subscription_id, system_id, claimed_at, expires_at, inserted_at, updated_at)
  VALUES
    (gen_random_uuid(), $1::uuid, $2::bigint, now(),
     now() + make_interval(hours => $3::int), now(), now())
  ON CONFLICT (subscription_id, system_id)
  DO UPDATE SET
    claimed_at = EXCLUDED.claimed_at,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at
  WHERE notification_windows_v1.expires_at <= now()
  RETURNING id
  """

  @doc """
  Claims the notification window for one subscription and system.

  Returns `:claimed` when this caller may send, `:cooldown` when another
  notification was sent within the cooldown, or `{:error, reason}`.
  """
  def claim(subscription_id, system_id, cooldown_hours) do
    hours = normalize_cooldown(cooldown_hours)

    with {:ok, uuid} <- dump_uuid(subscription_id) do
      case WandererApp.Repo.query(@claim_sql, [uuid, system_id, hours]) do
        {:ok, %{num_rows: 1}} -> :claimed
        {:ok, %{num_rows: 0}} -> :cooldown
        {:error, reason} -> {:error, reason}
      end
    else
      :error -> {:error, :invalid_subscription_id}
    end
  end

  @release_sql """
  DELETE FROM notification_windows_v1
  WHERE subscription_id = $1::uuid AND system_id = $2::bigint
  """

  @doc """
  Releases a claimed window after the email could not be sent.

  Without this the first connector would be silenced for the whole cooldown
  even though nobody received the notification. A rare duplicate is preferable
  to losing the first-connector event entirely.
  """
  def release(subscription_id, system_id) do
    with {:ok, uuid} <- dump_uuid(subscription_id) do
      case WandererApp.Repo.query(@release_sql, [uuid, system_id]) do
        {:ok, _} -> :ok
        {:error, reason} -> {:error, reason}
      end
    else
      :error -> {:error, :invalid_subscription_id}
    end
  end

  defp dump_uuid(<<_::128>> = binary), do: {:ok, binary}
  defp dump_uuid(id) when is_binary(id), do: Ecto.UUID.dump(id)
  defp dump_uuid(_), do: :error

  defp normalize_cooldown(hours) when is_integer(hours) and hours > 0,
    do: hours |> min(@max_cooldown_hours)

  defp normalize_cooldown(_hours), do: @default_cooldown_hours
end
