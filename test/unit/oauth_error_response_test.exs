defmodule WandererApp.Ueberauth.Strategy.Eve.OAuthErrorResponseTest do
  use ExUnit.Case, async: true

  alias WandererApp.Ueberauth.Strategy.Eve.OAuth

  defp response(status, body), do: %OAuth2.Response{status_code: status, body: body}

  test "keeps the HTTP status code for Cloudflare's plain-text body" do
    assert {:error, {:http_error, 526, "error code: 526"}} =
             OAuth.error_response(response(526, "error code: 526\n"))
  end

  test "keeps other upstream status codes" do
    assert {:error, {:http_error, 502, "Bad Gateway"}} =
             OAuth.error_response(response(502, "Bad Gateway"))
  end

  test "does not raise on a map body without an error key" do
    assert {:error, {:http_error, 500, preview}} =
             OAuth.error_response(response(500, %{"message" => "internal"}))

    assert is_binary(preview)
    assert preview =~ "message"
  end

  test "does not raise on a list body" do
    assert {:error, {:http_error, 500, preview}} =
             OAuth.error_response(response(500, [%{"detail" => "boom"}]))

    assert is_binary(preview)
  end

  test "does not raise on a nil body" do
    assert {:error, {:http_error, 504, preview}} = OAuth.error_response(response(504, nil))
    assert is_binary(preview)
  end

  test "truncates oversized bodies but still returns a string" do
    assert {:error, {:http_error, 500, preview}} =
             OAuth.error_response(response(500, String.duplicate("a", 5_000)))

    assert is_binary(preview)
    assert String.ends_with?(preview, "...(truncated)")
    assert String.length(preview) < 5_000
  end
end
