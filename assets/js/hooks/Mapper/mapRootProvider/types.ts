import { WindowStoreInfo } from '@/hooks/Mapper/mapRootProvider/hooks/useStoreWidgets.ts';
import { SignatureSettingsType } from '@/hooks/Mapper/constants/signatures.ts';

export enum AvailableThemes {
  default = 'default',
  pathfinder = 'pathfinder',
}

export enum MiniMapPlacement {
  rightTop = 'rightTop',
  rightBottom = 'rightBottom',
  leftTop = 'leftTop',
  leftBottom = 'leftBottom',
  hide = 'hide',
}

export enum PingsPlacement {
  rightTop = 'rightTop',
  rightBottom = 'rightBottom',
  leftTop = 'leftTop',
  leftBottom = 'leftBottom',
}

export type InterfaceStoredSettings = {
  isShowMenu: boolean;
  isShowKSpace: boolean;
  isThickConnections: boolean;
  isShowUnsplashedSignatures: boolean;
  isShowBackgroundPattern: boolean;
  isSoftBackground: boolean;
  theme: AvailableThemes;
  minimapPlacement: MiniMapPlacement;
  pingsPlacement: PingsPlacement;
};

export type RoutesType = {
  path_type: 'shortest' | 'secure' | 'insecure';
  include_mass_crit: boolean;
  include_eol: boolean;
  include_frig: boolean;
  include_cruise: boolean;
  include_thera: boolean;
  avoid_wormholes: boolean;
  avoid_pochven: boolean;
  avoid_edencom: boolean;
  avoid_triglavian: boolean;
  avoid: number[];
};

export type RoutesByCategoryType =
  | 'blueLoot'
  | 'redLoot'
  | 'thera'
  | 'turnur'
  | 'so_cleaning'
  | 'trade_hubs';

export type RoutesByScopeType = 'ALL' | 'HIGH';

export type RoutesByType = {
  routes: RoutesType;
  scope: RoutesByScopeType;
  type: RoutesByCategoryType;
};

export type LocalWidgetSettings = {
  compact: boolean;
  showOffline: boolean;
  showShipName: boolean;
};

export type OnTheMapSettingsType = {
  hideOffline: boolean;
};

export type KillsWidgetSettings = {
  showAll: boolean;
  whOnly: boolean;
  excludedSystems: number[];
  timeRange: number;
};

export type MapViewPort = { zoom: number; x: number; y: number };

export type MapSettings = {
  viewport: MapViewPort;
};

export type SettingsWrapper<T> = T;

export type MapUserSettings = {
  migratedFromOld: boolean;
  version: number;
  widgets: SettingsWrapper<WindowStoreInfo>;
  interface: SettingsWrapper<InterfaceStoredSettings>;
  onTheMap: SettingsWrapper<OnTheMapSettingsType>;
  routes: SettingsWrapper<RoutesType>;
  routesBy: SettingsWrapper<RoutesByType>;
  localWidget: SettingsWrapper<LocalWidgetSettings>;
  signaturesWidget: SettingsWrapper<SignatureSettingsType>;
  killsWidget: SettingsWrapper<KillsWidgetSettings>;
  map: SettingsWrapper<MapSettings>;
};

export type MapUserSettingsStructure = {
  [mapId: string]: MapUserSettings;
};

export type WdResponse<T> = T;

export type RemoteAdminSettingsResponse = { default_settings?: string };

/**
 * Settings stored per user on the server, updated with
 * OutCommand.updateUserSettings. Lives in the root store because the map reads
 * them while rendering — the subscription view's hide mode has to be known
 * before the settings dialog is ever opened.
 */
export type UserRemoteSettings = {
  link_signature_on_splash: boolean;
  select_on_spash: boolean;
  delete_connection_with_sigs: boolean;
  /**
   * Subscription view only. false shows every cluster the user can see; true
   * restricts the view to clusters reachable from a subscribed system and
   * blocks adding systems outside them.
   */
  hide_unsubscribed_clusters: boolean;
};

export const INITIAL_USER_REMOTE_SETTINGS: UserRemoteSettings = {
  link_signature_on_splash: false,
  select_on_spash: false,
  delete_connection_with_sigs: false,
  hide_unsubscribed_clusters: false,
};

/**
 * A subscribed system with the name the server resolved for it. Sent alongside
 * `subscribed_system_ids` because a subscribed system is not necessarily on the
 * map yet — there is no map record to read a name from, and the subscription
 * chip would otherwise have to show the raw numeric id. `name` is null when the
 * server could not resolve one (unknown system id).
 */
export type SubscribedSystem = {
  id: string;
  name: string | null;
};

export enum SettingsTypes {
  killsWidget = 'killsWidget',
  localWidget = 'localWidget',
  widgets = 'widgets',
  routes = 'routes',
  routesBy = 'routesBy',
  onTheMap = 'onTheMap',
  signaturesWidget = 'signaturesWidget',
  interface = 'interface',
  map = 'map',
}

export type MigrationFunc = (prev: any) => any;
export type MigrationStructure = {
  to: number;
  up: MigrationFunc;
};
