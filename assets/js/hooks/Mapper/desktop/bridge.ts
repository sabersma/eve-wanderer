import { DesktopBridgeApi, DesktopBridgeState, DesktopInfo, DesktopWidget, EveForeground } from './types';

const FOLLOW_STORAGE_KEY = 'wanderer:desktop:follow';
const WIDGET_OPACITY_STORAGE_KEY = 'wanderer:desktop:widget-opacity';

export const MIN_WIDGET_OPACITY = 0.3;
export const MAX_WIDGET_OPACITY = 1;

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
  widgetOpacity: MAX_WIDGET_OPACITY,
  uiScale: 1,
  alwaysOnTop: false,
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

function clampWidgetOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return MAX_WIDGET_OPACITY;
  }
  // Round to the slider's 1% steps so config.json does not collect values
  // like 0.35000000000000003.
  return Math.round(Math.min(MAX_WIDGET_OPACITY, Math.max(MIN_WIDGET_OPACITY, value)) * 100) / 100;
}

function readWidgetOpacity(): number {
  try {
    const value = localStorage.getItem(WIDGET_OPACITY_STORAGE_KEY);
    return value == null ? MAX_WIDGET_OPACITY : clampWidgetOpacity(Number(value));
  } catch {
    return MAX_WIDGET_OPACITY;
  }
}

function writeWidgetOpacity(value: number) {
  try {
    localStorage.setItem(WIDGET_OPACITY_STORAGE_KEY, String(value));
  } catch {
    // localStorage can be unavailable in hardened/private profiles.
  }
}

// Keep the follow toggle and widget opacity in sync across the main map and
// every widget window (they share one WebView2 profile/origin). `storage` does
// not fire in the window that wrote the value, hence the local setState in the
// setters.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === FOLLOW_STORAGE_KEY) {
      setState({ followEnabled: readFollowEnabled() });
    } else if (event.key === WIDGET_OPACITY_STORAGE_KEY) {
      setState({ widgetOpacity: readWidgetOpacity() });
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

export function setWidgetOpacity(value: number) {
  const opacity = clampWidgetOpacity(value);
  writeWidgetOpacity(opacity);
  setState({ widgetOpacity: opacity });
  // Faded by the OS on the whole native window, not with CSS: the title bar,
  // table and text all get the same alpha and the WebView2 surface stays
  // opaque, so the game shows through instead of a white page backdrop.
  void invokeDesktop('set_widget_opacity', { opacity });
}

async function applyZoom(command: 'zoom_in' | 'zoom_out' | 'zoom_reset') {
  const scale = await invokeDesktop<number>(command);
  // Zoom applies to every window and is cached in config.json; the command
  // returns the clamped value so the main bar's label matches the real scale.
  if (typeof scale === 'number' && Number.isFinite(scale)) {
    setState({ uiScale: scale });
  }
}

export async function zoomIn() {
  await applyZoom('zoom_in');
}

export async function zoomOut() {
  await applyZoom('zoom_out');
}

export async function zoomReset() {
  await applyZoom('zoom_reset');
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
  // Update the toggle first: the command persists the choice in config.json so
  // the widget opens pinned next time. Widget windows each keep their own flag,
  // so this is not synced through localStorage.
  setState({ alwaysOnTop: value });
  await invokeDesktop('set_always_on_top', { value });
}

export async function setWindowTitle(title: string) {
  await invokeDesktop('set_window_title', { title });
}

async function ready() {
  if (!state.info.active) {
    return;
  }

  const result = await invokeDesktop<{
    lastEve?: EveForeground | null;
    widgetOpacity?: number;
    uiScale?: number;
    alwaysOnTop?: boolean;
  }>('desktop_ready', {
    mode: state.info.mode,
    widget: state.info.widget,
  });

  if (result?.lastEve !== undefined) {
    setLastEve(result.lastEve);
  }

  // `config.json` is what the window was actually created with; align the
  // slider (and its localStorage mirror) so a value cached by an older build
  // does not make the UI disagree with the window.
  if (result?.widgetOpacity != null) {
    const opacity = clampWidgetOpacity(result.widgetOpacity);
    writeWidgetOpacity(opacity);
    setState({ widgetOpacity: opacity });
  }

  if (result?.uiScale != null && Number.isFinite(result.uiScale)) {
    setState({ uiScale: result.uiScale });
  }

  if (result?.alwaysOnTop != null) {
    setState({ alwaysOnTop: result.alwaysOnTop });
  }
}

const api: DesktopBridgeApi = {
  version: 1,
  onActiveEve,
  onDesktopState,
  setFollowEnabled,
  setWidgetOpacity,
  zoomIn,
  zoomOut,
  zoomReset,
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
    widgetOpacity: readWidgetOpacity(),
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
