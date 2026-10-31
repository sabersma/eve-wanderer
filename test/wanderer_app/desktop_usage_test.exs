defmodule WandererApp.DesktopUsageTest do
  use WandererApp.DataCase, async: false

  alias WandererApp.DesktopUsage
  alias WandererApp.Repo

  setup do
    user_id = Ecto.UUID.generate()

    # The table only references user_v1; inserting the row directly avoids
    # pulling the whole Ash user changeset into a telemetry test. A schemaless
    # insert needs the dumped (binary) form of the uuid.
    Repo.insert_all("user_v1", [%{id: Ecto.UUID.dump!(user_id), name: "Usage Tester"}])

    %{user_id: user_id}
  end

  defp heartbeat(install_id, user_id, attrs \\ %{}) do
    DesktopUsage.record_heartbeat(
      user_id,
      Map.merge(%{"install_id" => install_id, "version" => "0.1.1", "platform" => "Win32"}, attrs)
    )
  end

  test "upserts by install id instead of counting every window", %{user_id: user_id} do
    assert heartbeat("install-aaaa-1111", user_id) == :ok
    assert heartbeat("install-aaaa-1111", user_id, %{"version" => "0.1.2"}) == :ok

    assert [row] = Repo.all(DesktopUsage.Client)
    assert row.install_id == "install-aaaa-1111"
    assert row.version == "0.1.2"
    assert row.user_id == user_id
  end

  test "keeps first_seen_at from the first report", %{user_id: user_id} do
    assert heartbeat("install-bbbb-2222", user_id) == :ok
    [first] = Repo.all(DesktopUsage.Client)

    assert heartbeat("install-bbbb-2222", user_id) == :ok
    [second] = Repo.all(DesktopUsage.Client)

    assert second.first_seen_at == first.first_seen_at
    assert DateTime.compare(second.last_seen_at, first.last_seen_at) in [:gt, :eq]
  end

  test "ignores payloads without a usable install id", %{user_id: user_id} do
    assert DesktopUsage.record_heartbeat(user_id, %{}) == :ignored
    assert DesktopUsage.record_heartbeat(user_id, %{"install_id" => "bad id"}) == :ignored
    assert Repo.all(DesktopUsage.Client) == []
  end

  test "summary counts installs and distinct users", %{user_id: user_id} do
    assert heartbeat("install-cccc-3333", user_id) == :ok
    assert heartbeat("install-dddd-4444", user_id) == :ok

    summary = DesktopUsage.summary()

    assert summary.installs_today == 2
    assert summary.users_today == 1
    assert summary.installs_30d == 2
    assert summary.users_30d == 1
  end

  test "version_breakdown groups by version", %{user_id: user_id} do
    assert heartbeat("install-eeee-5555", user_id, %{"version" => "0.1.1"}) == :ok
    assert heartbeat("install-ffff-6666", user_id, %{"version" => "0.1.1"}) == :ok
    assert heartbeat("install-gggg-7777", user_id, %{"version" => "0.1.2"}) == :ok

    assert [{"0.1.1", 2}, {"0.1.2", 1}] = DesktopUsage.version_breakdown(30)
  end

  test "recent joins the user name", %{user_id: user_id} do
    assert heartbeat("install-hhhh-8888", user_id) == :ok

    assert [row] = DesktopUsage.recent(10)
    assert row.user_name == "Usage Tester"
    assert row.version == "0.1.1"
  end
end
