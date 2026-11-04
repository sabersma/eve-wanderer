defmodule WandererApp.Notifications.Engine do
  @moduledoc """
  Listens for character location changes and runs notifications in a task.

  The tracker process emits telemetry for every real location change. Its
  handler must stay cheap, so the event is only handed to this GenServer, which
  starts a supervised task for the actual database and SMTP work.

  Map servers are deliberately not used: they shut down after four hours without
  map presence, while the character tracker keeps polling globally. A
  notification would stop working whenever nobody has the map open otherwise.
  """

  use GenServer

  require Logger

  @telemetry_event [:wanderer_app, :character, :location_changed]
  @handler_id "wanderer-notifications-location"

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    # A restart may leave the old handler attached to this module; detaching
    # first keeps exactly one handler after a crash.
    :telemetry.detach(@handler_id)

    :ok =
      :telemetry.attach(
        @handler_id,
        @telemetry_event,
        &__MODULE__.handle_event/4,
        nil
      )

    {:ok, %{}}
  end

  @doc false
  def handle_event(_event, _measurements, metadata, _config) do
    if WandererApp.Env.notifications_enabled?() do
      character_id = metadata[:character_id]
      from_system_id = metadata[:from_system_id]
      to_system_id = metadata[:to_system_id]

      if is_binary(character_id) and is_integer(to_system_id) and
           to_system_id > 0 and from_system_id != to_system_id do
        GenServer.cast(
          __MODULE__,
          {:location_changed, character_id, from_system_id, to_system_id}
        )
      end
    end
  rescue
    error ->
      Logger.error("Notification telemetry handler failed", error: inspect(error))
  end

  @impl true
  def handle_cast({:location_changed, character_id, from_system_id, to_system_id}, state) do
    Task.Supervisor.start_child(WandererApp.Notifications.TaskSupervisor, fn ->
      WandererApp.Notifications.Dispatcher.process(character_id, from_system_id, to_system_id)
    end)

    {:noreply, state}
  end

  @impl true
  def handle_info(_message, state), do: {:noreply, state}
end
