import { useSyncExternalStore } from 'react';
import { getDesktopState, subscribeDesktop } from './bridge';

export function useDesktopBridgeState() {
  return useSyncExternalStore(subscribeDesktop, getDesktopState, getDesktopState);
}
