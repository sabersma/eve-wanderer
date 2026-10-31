import { DesktopBridgeApi, DesktopBridgeState, DesktopInfo, DesktopWidget, EveForeground } from './types';

const FOLLOW_STORAGE_KEY = 'wanderer:desktop:follow';

const listeners = new Set<() => void>();

let state: DesktopBridgeState = {
  info: {
    active: false,
    mode: 'main',
    widget: null,
    mapSlug: null,
  },
  lastEve: null,
  followEnabled: true,
};

function emit() {
  listeners.forEach(listener => listener());
}

function setState(next: Partial<DesktopBridgeState>) {
  state = { ...state, ...next };
  emit();
}

function readFollowEnabled(): boolean {
  try {
    const value = localStorage.getItem(FOLLOW_STORAGE_KEY);
    return value == null ? true : value === 'true';
  } catch {
    return true;
  }
}

function writeFollowEnabled(value: boolean) {
  try {
    localStorage.setItem(FOLLOW_STORAGE_KEY, String(value));
  } catch {
    // localStorage can be unavailable in hardened/private profiles.
  }
}

// Keep the follow toggle in sync across the main map and every widget window
// (they share one WebView2 profile/origin). `storage` does not fire in the
// window that wrote the value, hence the local setState in setFollowEnabled.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === FOLLOW_STORAGE_KEY) {
      setState({ followEnabled: readFollowEnabled() });
    }
  });
}

export function getDesktopState(): DesktopBridgeState {
  return state;
}

export function subscribeDesktop(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isDesktopActive(): boolean {
  return state.info.active;
}

type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function getInvoke(): InvokeFn | null {
  const tauri = window.__TAURI__;
  if (tauri?.core?.invoke) {
    return tauri.core.invoke;
  }

  const internals = window.__TAURI_INTERNALS__;
  if (internals?.invoke) {
    return internals.invoke;
  }

  return null;
}

export async function invokeDesktop<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  const invoke = getInvoke();
  if (!invoke) {
    return null;
  }

  try {
    return (await invoke(command, args)) as T;
  } catch (error) {
    console.warn(`[desktop] ${command} failed`, error);
    return null;
  }
}

function setLastEve(payload: EveForeground | null) {
  setState({ lastEve: payload });
}

export function onActiveEve(payload: EveForeground) {
  if (!payload?.title) {
    return;
  }
  setLastEve(payload);
}

export function onDesktopState(payload: { lastEve?: EveForeground | null }) {
  if (payload.lastEve !== undefined) {
    setLastEve(payload.lastEve);
  }
}

export function setFollowEnabled(value: boolean) {
  writeFollowEnabled(value);
  setState({ followEnabled: value });
}

export async function openWidget(widget: DesktopWidget) {
  if (!state.info.mapSlug) {
    return;
  }

  await invokeDesktop('open_widget', {
    mapSlug: state.info.mapSlug,
    widget,
  });
}

export async function openMain() {
  await invokeDesktop('open_main');
}

export async function openServerSettings() {
  await invokeDesktop('open_server_settings');
}

export async function closeSelf() {
  await invokeDesktop('close_self');
}

export async function setAlwaysOnTop(value: boolean) {
  await invokeDesktop('set_always_on_top', { value });
}

export async function setWindowTitle(title: string) {
  await invokeDesktop('set_window_title', { title });
}

async function ready() {
  if (!state.info.active) {
    return;
  }

  const result = await invokeDesktop<{ lastEve?: EveForeground | null }>('desktop_ready', {
    mode: state.info.mode,
    widget: state.info.widget,
  });

  if (result?.lastEve !== undefined) {
    setLastEve(result.lastEve);
  }
}

const api: DesktopBridgeApi = {
  version: 1,
  onActiveEve,
  onDesktopState,
  setFollowEnabled,
  openWidget,
  openMain,
  openServerSettings,
  closeSelf,
  setAlwaysOnTop,
  setWindowTitle,
  ready,
};

/**
 * Called by the Mapper LiveView hook before React renders. The Rust side calls
 * back into `window.__wandererDesktop` once the page is ready.
 */
export function initDesktopBridge(info: DesktopInfo) {
  state = {
    ...state,
    info,
    followEnabled: readFollowEnabled(),
  };

  window.__wandererDesktop = api;
  emit();
}

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: InvokeFn;
      };
    };
    __TAURI_INTERNALS__?: {
      invoke?: InvokeFn;
    };
    __wandererDesktop?: DesktopBridgeApi;
  }
}
