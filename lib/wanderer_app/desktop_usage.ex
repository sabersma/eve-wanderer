defmodule WandererApp.DesktopUsage do
  @moduledoc """
  Usage telemetry reported by the desktop client shell.

  The client sends a heartbeat once per window mount with a random install id
  (stored in its WebView `localStorage`), the binary version and the platform.
  Rows are upserted by `install_id`, so opening six windows still counts as one
  install.

  This lives outside Ash on purpose: it is operational telemetry for the admin
  dashboard, not map/domain data, and it is written from every desktop LiveView.
  """

  import Ecto.Query

  alias WandererApp.Repo

  # UUIDs from `crypto.randomUUID()` plus the fallback format used when the
  # WebView does not expose it.
  @install_id ~r/^[A-Za-z0-9_-]{8,128}$/

  defmodule Client do
    @moduledoc false
    use Ecto.Schema

    @primary_key {:id, :binary_id, autogenerate: true}
    @foreign_key_type :binary_id

    schema "desktop_client_v1" do
      field :install_id, :string
      field :version, :string
      field :platform, :string
      field :user_id, :binary_id
      field :first_seen_at, :utc_datetime_usec
      field :last_seen_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end
  end

  @doc """
  Records one desktop heartbeat.

  Returns `:ok` when the row was written and `:ignored` for payloads that do not
  look like a client report (missing/invalid install id).
  """
  def record_heartbeat(user_id, payload) when is_binary(user_id) and is_map(payload) do
    install_id = text(payload, "install_id")

    if is_binary(install_id) and Regex.match?(@install_id, install_id) do
      now = DateTime.utc_now()

      Repo.insert_all(
        Client,
        [
          %{
            install_id: install_id,
            user_id: user_id,
            version: text(payload, "version", 64),
            platform: text(payload, "platform", 64),
            first_seen_at: now,
            last_seen_at: now,
            inserted_at: now,
            updated_at: now
          }
        ],
        conflict_target: :install_id,
        on_conflict: {:replace, [:user_id, :version, :platform, :last_seen_at, :updated_at]}
      )

      :ok
    else
      :ignored
    end
  end

  def record_heartbeat(_user_id, _payload), do: :ignored

  @doc """
  Counts active installs and users for today, the last 7 days and 30 days.
  """
  def summary do
    now = DateTime.utc_now()

    %{
      installs_today: count_installs(today_start()),
      users_today: count_users(today_start()),
      installs_7d: count_installs(DateTime.add(now, -7, :day)),
      users_7d: count_users(DateTime.add(now, -7, :day)),
      installs_30d: count_installs(DateTime.add(now, -30, :day)),
      users_30d: count_users(DateTime.add(now, -30, :day))
    }
  end

  @doc """
  Number of active installs per client version within the last `days` days.
  """
  def version_breakdown(days \\ 30) do
    cutoff = DateTime.add(DateTime.utc_now(), -days, :day)

    Repo.all(
      from client in Client,
        where: client.last_seen_at >= ^cutoff,
        group_by: client.version,
        order_by: [desc: count(client.id)],
        select: {client.version, count(client.id)}
    )
  end

  @doc """
  Most recently seen installs, with the owning user's name when available.
  """
  def recent(limit \\ 100) do
    Repo.all(
      from client in Client,
        left_join: user in "user_v1",
        on: user.id == client.user_id,
        order_by: [desc: client.last_seen_at],
        limit: ^limit,
        select: %{
          install_id: client.install_id,
          version: client.version,
          platform: client.platform,
          user_id: client.user_id,
          user_name: user.name,
          first_seen_at: client.first_seen_at,
          last_seen_at: client.last_seen_at
        }
    )
  end

  defp count_installs(since) do
    Repo.one(
      from client in Client, where: client.last_seen_at >= ^since, select: count(client.id)
    ) || 0
  end

  defp count_users(since) do
    Repo.one(
      from client in Client,
        where: client.last_seen_at >= ^since and not is_nil(client.user_id),
        select: count(client.user_id, :distinct)
    ) || 0
  end

  defp today_start do
    DateTime.utc_now()
    |> DateTime.to_date()
    |> DateTime.new!(~T[00:00:00], "Etc/UTC")
  end

  defp text(payload, key, max_length \\ 128) do
    case payload[key] do
      value when is_binary(value) ->
        value
        |> String.trim()
        |> String.slice(0, max_length)
        |> case do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end
end
