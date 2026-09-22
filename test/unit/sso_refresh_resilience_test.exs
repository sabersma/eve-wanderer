defmodule WandererApp.Esi.SsoRefreshResilienceTest do
  # Uses the shared cache, so these cannot run concurrently with each other.
  use ExUnit.Case, async: false

  alias WandererApp.Cache
  alias WandererApp.Esi.ApiClient

  @degraded_key "sso:refresh:degraded"
  @window_failures_key "sso:refresh:window_failures"
  @window_marker_prefix "sso:refresh:window:"

  setup do
    clear_breaker_state()
    on_exit(&clear_breaker_state/0)
    :ok
  end

  defp clear_breaker_state do
    Cache.delete(@degraded_key)
    Cache.delete(@window_failures_key)

    Enum.each(1..20, fn id ->
      Cache.delete("#{@window_marker_prefix}#{id}")
      ApiClient.clear_invalid_grant_strikes(id)
    end)
  end

  describe "outage detection across characters" do
    test "one character failing repeatedly does not look like an outage" do
      # Several tracking endpoints refresh the same character, so a single bad character
      # must not be able to trip the breaker on its own.
      Enum.each(1..20, fn _ ->
        ApiClient.record_sso_failure(1, {:error, :token_refresh_failed})
      end)

      refute ApiClient.sso_degraded?()
    end

    test "a wide outage trips the breaker" do
      refute ApiClient.sso_degraded?()

      Enum.each(1..10, fn id ->
        ApiClient.record_sso_failure(id, {:error, :token_refresh_failed})
      end)

      assert ApiClient.sso_degraded?()
    end

    test "a successful refresh does not count toward the outage window" do
      ApiClient.record_sso_failure(1, {:ok, %OAuth2.AccessToken{access_token: "token"}})

      refute ApiClient.sso_degraded?()
      assert Cache.lookup!(@window_failures_key, 0) == 0
    end

    test "every refresh failure mode counts, not just HTTP errors" do
      ApiClient.record_sso_failure(1, {:error, :invalid_grant})
      ApiClient.record_sso_failure(2, {:error, :econnrefused})
      ApiClient.record_sso_failure(3, {:error, :token_refresh_failed})

      assert Cache.lookup!(@window_failures_key, 0) == 3
    end
  end

  describe "invalid_grant strikes must be spread over time" do
    test "a burst of strikes inside one tick is not enough to condemn a token" do
      # This is the regression that mattered: several endpoints refresh the same
      # character within the same second, so three strikes arrived almost instantly and
      # used to wipe a healthy token.
      refute ApiClient.invalid_grant_confirmed?(3, 0)
      refute ApiClient.invalid_grant_confirmed?(5, 0)
      refute ApiClient.invalid_grant_confirmed?(3, 1)
    end

    test "too few strikes is not enough even if they span a long time" do
      refute ApiClient.invalid_grant_confirmed?(1, 600)
      refute ApiClient.invalid_grant_confirmed?(2, 600)
    end

    test "enough strikes spread over a long enough span confirms the token is dead" do
      assert ApiClient.invalid_grant_confirmed?(3, 30)
      assert ApiClient.invalid_grant_confirmed?(4, 45)
    end

    test "the span is measured from the first strike, not the most recent one" do
      {count, first_at} = ApiClient.record_invalid_grant_strike(1)
      assert count == 1

      {count, first_at_again} = ApiClient.record_invalid_grant_strike(1)
      assert count == 2
      assert first_at_again == first_at

      {count, _} = ApiClient.record_invalid_grant_strike(1)
      assert count == 3
    end

    test "strikes can be cleared, e.g. after a successful re-authorization" do
      ApiClient.record_invalid_grant_strike(1)
      ApiClient.clear_invalid_grant_strikes(1)

      {count, _} = ApiClient.record_invalid_grant_strike(1)
      assert count == 1
    end
  end
end
