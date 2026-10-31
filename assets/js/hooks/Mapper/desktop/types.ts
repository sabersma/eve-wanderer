export type DesktopMode = 'main' | 'widget';

export type DesktopWidget = 'signatures' | 'jspace' | 'bookmarks' | 'kills' | 'characters';

export type EveForeground = {
  title: string;
  process: string;
  hwnd: number;
  at: number;
};

export type DesktopInfo = {
  active: boolean;
  mode: DesktopMode;
  widget: DesktopWidget | null;
  mapSlug: string | null;
};

export type DesktopBridgeState = {
  info: DesktopInfo;
  lastEve: EveForeground | null;
  followEnabled: boolean;
  /** Whole-window opacity of detached widget windows (0.3–1.0). */
  widgetOpacity: number;
  /** WebView2 zoom factor shared by every window (0.5–2.0). */
  uiScale: number;
  /** Whether this widget window is pinned above other windows. */
  alwaysOnTop: boolean;
};

export type DesktopBridgeApi = {
  version: number;
  onActiveEve: (payload: EveForeground) => void;
  onDesktopState: (payload: { lastEve?: EveForeground | null }) => void;
  setFollowEnabled: (value: boolean) => void;
  setWidgetOpacity: (value: number) => void;
  zoomIn: () => Promise<void>;
  zoomOut: () => Promise<void>;
  zoomReset: () => Promise<void>;
  openWidget: (widget: DesktopWidget) => Promise<void>;
  openMain: () => Promise<void>;
  openServerSettings: () => Promise<void>;
  closeSelf: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  ready: () => Promise<void>;
};
