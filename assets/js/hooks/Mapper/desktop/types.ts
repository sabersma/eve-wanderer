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
};

export type DesktopBridgeApi = {
  version: number;
  onActiveEve: (payload: EveForeground) => void;
  onDesktopState: (payload: { lastEve?: EveForeground | null }) => void;
  setFollowEnabled: (value: boolean) => void;
  openWidget: (widget: DesktopWidget) => Promise<void>;
  openMain: () => Promise<void>;
  openServerSettings: () => Promise<void>;
  closeSelf: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  ready: () => Promise<void>;
};
