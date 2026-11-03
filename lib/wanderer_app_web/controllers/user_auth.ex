defmodule WandererAppWeb.UserAuth do
  @moduledoc false

  use WandererAppWeb, :verified_routes
  import Plug.Conn
  import Phoenix.Controller

  alias Phoenix.LiveView

  alias WandererApp.Api.{User}

  def on_mount(:ensure_authenticated, _params, session, socket) do
    case session do
      %{"user_id" => user_id} ->
        user = User.by_id!(user_id) |> Ash.load!(:characters)
        admins = WandererApp.Env.admins()

        user_role =
          case Enum.empty?(admins) or user.hash in admins do
            true ->
              :admin

            _ ->
              :user
          end

        new_socket =
          socket
          |> Phoenix.Component.assign_new(:current_user, fn ->
            user
          end)
          |> Phoenix.Component.assign_new(:current_user_role, fn ->
            user_role
          end)

        case new_socket.assigns.current_user do
          nil ->
            {:halt, redirect_require_login(socket)}

          %User{characters: _characters} ->
            {:cont, new_socket}
        end

      %{} ->
        {:halt, redirect_require_login(socket)}
    end
  rescue
    _ -> {:halt, redirect_require_login(socket)}
  end

  def on_mount(:ensure_admin, _params, _session, socket) do
    case socket.assigns.current_user_role do
      :admin ->
        {:cont, socket}

      _ ->
        {:halt, redirect_not_admin(socket)}
    end
  end

  @doc """
  Desktop windows skip the web welcome page and go straight to EVE SSO.

  `/auth/eve?desktop=1` stores the desktop flag in the session, so the callback
  can return to `/desktop` instead of the web `/characters` page. Without this
  a freshly installed client looks exactly like the browser after login and has
  no way back to the desktop maps.

  The map slug is carried along as `return`, so a client opening directly on a
  default map comes back to that map after an expired session instead of
  landing on the chooser. Widget windows are excluded: their route has no full
  map page, so they fall back to the chooser.
  """
  def on_mount(:ensure_authenticated_desktop, params, session, socket) do
    case session do
      %{"user_id" => _} -> on_mount(:ensure_authenticated, params, session, socket)
      _ -> {:halt, LiveView.redirect(socket, to: desktop_login_path(socket, params))}
    end
  end

  # A widget window has no standalone map page to return to: `/desktop/:slug`
  # would render the whole main map inside the small widget window. The main
  # window carries the login and the chooser is the safe landing page.
  defp desktop_login_path(%{assigns: %{live_action: :widget}}, _params),
    do: ~p"/auth/eve?desktop=1"

  defp desktop_login_path(_socket, params) do
    case Map.get(params, "slug") do
      slug when is_binary(slug) ->
        if valid_map_slug?(slug) do
          ~p"/auth/eve?desktop=1&return=#{slug}"
        else
          ~p"/auth/eve?desktop=1"
        end

      _ ->
        ~p"/auth/eve?desktop=1"
    end
  end

  @doc false
  def valid_map_slug?(slug) when is_binary(slug) do
    byte_size(slug) in 1..80 and slug =~ ~r/\A[A-Za-z0-9_-]+\z/
  end

  def valid_map_slug?(_), do: false

  @doc """
  Authenticates the user by looking into the session.
  """
  def fetch_current_user(conn, _opts) do
    user_id = get_session(conn, :user_id)

    case user_id && WandererApp.Api.User.by_id(user_id, load: :characters) do
      {:ok, user} ->
        conn
        |> assign(:current_user, user)

      _ ->
        conn
        |> assign(:current_user, nil)
    end
  end

  def redirect_if_user_is_authenticated(conn, _opts) do
    if conn.assigns[:current_user] do
      conn
      |> redirect(to: ~p"/last")
      |> halt()
    else
      conn
    end
  end

  @doc """
  Used for routes that require the user to be authenticated.

  If you want to enforce the user email is confirmed before
  they use the application at all, here would be a good place.
  """
  def require_authenticated_user(conn, _opts) do
    if conn.assigns[:current_user] do
      conn
    else
      conn
      |> maybe_store_return_to()
      |> redirect(to: ~p"/characters")
      |> halt()
    end
  end

  defp redirect_require_login(socket) do
    socket
    |> LiveView.redirect(to: ~p"/welcome")
  end

  defp redirect_not_admin(socket) do
    socket
    |> LiveView.redirect(to: ~p"/")
  end

  defp maybe_store_return_to(%{method: "GET"} = conn) do
    %{request_path: request_path, query_string: query_string} = conn
    return_to = if query_string == "", do: request_path, else: request_path <> "?" <> query_string
    put_session(conn, :user_return_to, return_to)
  end

  defp maybe_store_return_to(conn), do: conn

  @doc """
  Finishes a web login.

  `require_authenticated_user/2` remembers the page an anonymous visitor asked
  for before sending them through the login flow. Return there when it is a
  local path; otherwise fall back to the character list, which is where web
  logins have always landed.
  """
  def redirect_after_login(conn) do
    return_to = get_session(conn, :user_return_to)

    conn =
      if is_binary(return_to) do
        delete_session(conn, :user_return_to)
      else
        conn
      end

    conn
    |> redirect(to: local_return_path(return_to) || ~p"/characters")
  end

  @doc false
  # Same-site absolute paths only: `//evil.example`, `https://evil.example`,
  # backslashes and control characters are dropped to keep this from becoming
  # an open redirect.
  def local_return_path(path) when is_binary(path) do
    uri = URI.parse(path)

    if uri.scheme == nil and uri.host == nil and is_binary(uri.path) and
         String.starts_with?(uri.path, "/") and not String.starts_with?(uri.path, "//") and
         not Regex.match?(~r/[\x00-\x1f\\]/, path) do
      path
    end
  end

  def local_return_path(_path), do: nil
end
