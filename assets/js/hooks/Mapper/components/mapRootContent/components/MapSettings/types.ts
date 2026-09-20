import { InterfaceStoredSettings, UserRemoteSettings } from '@/hooks/Mapper/mapRootProvider/types.ts';

export enum UserSettingsRemoteProps {
  link_signature_on_splash = 'link_signature_on_splash',
  select_on_spash = 'select_on_spash',
  delete_connection_with_sigs = 'delete_connection_with_sigs',
  hide_unsubscribed_clusters = 'hide_unsubscribed_clusters',
}

/** The server-stored settings, whose canonical shape lives with the root store. */
export type UserSettingsRemote = UserRemoteSettings;

export type UserSettings = UserSettingsRemote & InterfaceStoredSettings;

export type SettingsListItem = {
  prop: keyof UserSettings;
  label: string;
  type: 'checkbox' | 'dropdown';
  options?: { label: string; value: string }[];
};
