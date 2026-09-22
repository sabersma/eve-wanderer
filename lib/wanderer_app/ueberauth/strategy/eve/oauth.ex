defmodule WandererApp.Ueberauth.Strategy.Eve.OAuth do
  @moduledoc """
  OAuth2 for Eve.

  Add `client_id` and `client_secret` to your configuration:

      config :wanderer_app, WandererApp.Ueberauth.Strategy.Eve.OAuth,
        client_id: System.get_env("EVE_APP_ID"),
        client_secret: System.get_env("EVE_APP_SECRET")

  """
  use OAuth2.Strategy

  @defaults [
    strategy: __MODULE__,
    site: "https://login.eveonline.com",
    authorize_url: "/v2/oauth/authorize/",
    token_url: "https://login.eveonline.com/v2/oauth/token"
  ]

  @body_preview_limit 500

  @doc false
  # Normalizes an HTTP-level failure into `{:error, {:http_error, status, body_preview}}`.
  #
  # Used when the response body carries no OAuth `error` document. EVE SSO sits behind
  # Cloudflare, which answers with diagnostics such as the plain-text `error code: 526`
  # (invalid origin TLS certificate) when CCP's origin is unhealthy. The status code is
  # what makes those diagnosable, so it is preserved rather than folded into the body.
  def error_response(%OAuth2.Response{status_code: status, body: body}) do
    {:error, {:http_error, status, body_preview(body)}}
  end

  @doc """
  Construct a client for requests to Eve.

  This will be setup automatically for you in `Ueberauth.Strategy.Eve`.

  These options are only useful for usage outside the normal callback phase of Ueberauth.
  """
  def client(opts \\ []) do
    config = Application.get_env(:ueberauth, __MODULE__, [])

    json_library = Ueberauth.json_library()

    @defaults
    |> Keyword.merge(config)
    |> Keyword.merge(opts)
    |> resolve_values()
    |> generate_client_id()
    |> generate_client_secret()
    |> OAuth2.Client.new()
    |> OAuth2.Client.put_serializer("application/json", json_library)
  end

  @doc """
  Provides the authorize url for the request phase of Ueberauth. No need to call this usually.
  """
  def authorize_url!(params \\ [], opts \\ []) do
    opts
    |> Keyword.put(:redirect_uri, "#{WandererApp.Env.base_url()}/auth/eve/callback")
    |> client
    |> OAuth2.Client.authorize_url!(params)
  end

  def get(token, url, headers \\ [], opts \\ []) do
    [token: token]
    |> Keyword.put(:redirect_uri, "#{WandererApp.Env.base_url()}/auth/eve/callback")
    |> client
    |> put_param("response_type", "code")
    |> put_param("client_id", client().client_id)
    |> put_param("state", "ccp_auth_response")
    |> OAuth2.Client.get(url, headers, opts)
  end

  def get_access_token(params \\ [], opts \\ []) do
    case opts
         |> client
         |> OAuth2.Client.get_token(params ++ [grant_type: "authorization_code"], []) do
      {:ok, %OAuth2.Client{token: token}} ->
        case Map.get(token, :access_token) do
          nil ->
            %{"error" => error, "error_description" => description} = token.other_params
            {:error, {error, description}}

          _ ->
            {:ok, token}
        end

      {:error, %OAuth2.Response{body: %{"error" => error}} = response} ->
        description = Map.get(response.body, "error_description", "")
        {:error, {error, description}}

      {:error, %OAuth2.Response{} = response} ->
        error_response(response)

      {:error, %OAuth2.Error{reason: reason}} ->
        {:error, {"error", describe(reason)}}

      {:error, error} ->
        {:error, {"error", describe(error)}}
    end
  end

  def get_refresh_token(params \\ [], opts \\ []) do
    case opts
         |> client
         |> refresh_token(params) do
      {:ok, %OAuth2.Client{token: token} = _response} ->
        case Map.get(token, :access_token) do
          nil ->
            %{"error" => error, "error_description" => description} = token.other_params
            {:error, {error, description}}

          _ ->
            {:ok, token}
        end

      {:error, %OAuth2.Response{body: %{"error" => error}} = response} ->
        description = Map.get(response.body, "error_description", "")
        {:error, {error, description}}

      {:error, %OAuth2.Response{} = response} ->
        error_response(response)

      {:error, error} ->
        {:error, error}
    end
  end

  # Strategy Callbacks

  def authorize_url(client, params) do
    OAuth2.Strategy.AuthCode.authorize_url(client, params)
  end

  def get_token(client, params, headers) do
    client
    |> put_header("Accept", "application/x-www-form-urlencoded")
    |> put_header("Host", "login.eveonline.com")
    |> merge_params(params)
    |> basic_auth()
    |> put_headers(headers)
  end

  # Non-binary bodies must not raise here: a JSON object without an `error` key, an
  # array, or `nil` all reach this point, and `to_string/1` only accepts strings,
  # atoms and chardata. `inspect/1` is total and renders every term.
  defp body_preview(body) when is_binary(body), do: truncate(String.trim(body))
  defp body_preview(body), do: body |> inspect(limit: 20, pretty: false) |> truncate()

  defp truncate(text) when byte_size(text) <= @body_preview_limit, do: text

  defp truncate(text) do
    String.slice(text, 0, @body_preview_limit) <> "...(truncated)"
  end

  defp describe(value) when is_binary(value), do: value
  defp describe(value) when is_atom(value), do: Atom.to_string(value)
  defp describe(value), do: inspect(value, limit: 20, pretty: false)

  defp resolve_values(list) do
    for {key, value} <- list do
      {key, resolve_value(value)}
    end
  end

  defp resolve_value({m, f, a}) when is_atom(m) and is_atom(f), do: apply(m, f, a)
  defp resolve_value(v), do: v

  defp generate_client_secret(opts) do
    if is_tuple(opts[:client_secret]) do
      {module, fun} = opts[:client_secret]
      secret = apply(module, fun, [opts])
      Keyword.put(opts, :client_secret, secret)
    else
      opts
    end
  end

  defp generate_client_id(opts) do
    if is_tuple(opts[:client_id]) do
      {module, fun} = opts[:client_id]
      secret = apply(module, fun, [opts])
      Keyword.put(opts, :client_id, secret)
    else
      opts
    end
  end
end
