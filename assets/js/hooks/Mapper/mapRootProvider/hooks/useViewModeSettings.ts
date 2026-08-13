import { useCallback, useMemo } from 'react';
import useLocalStorageState from 'use-local-storage-state';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';

const LS_KEY = 'wanderer_view_mode_v1';

export interface ViewModeSettings {
  viewMode: ViewMode;
  selectedHomeSystemId: string | null;
}

const DEFAULT_SETTINGS: ViewModeSettings = {
  viewMode: 'all',
  selectedHomeSystemId: null,
};

/**
 * Per-map view-mode preference, stored in a dedicated localStorage key with
 * cross-tab sync disabled. This keeps each browser tab (each user's view)
 * isolated from the others, so switching home views in one tab never resets
 * another tab back to "all".
 */
export function useViewModeSettings(map_slug: string | null) {
  const [allSettings, setAllSettings] = useLocalStorageState<Record<string, ViewModeSettings>>(LS_KEY, {
    defaultValue: {},
    storageSync: false,
  });

  const settings = useMemo<ViewModeSettings>(() => {
    return map_slug ? allSettings[map_slug] ?? DEFAULT_SETTINGS : DEFAULT_SETTINGS;
  }, [map_slug, allSettings]);

  const updateSettings = useCallback(
    (patch: Partial<ViewModeSettings>) => {
      if (!map_slug) return;
      setAllSettings(prev => ({
        ...prev,
        [map_slug]: { ...(prev[map_slug] ?? DEFAULT_SETTINGS), ...patch },
      }));
    },
    [map_slug, setAllSettings],
  );

  return { viewModeSettings: settings, updateViewModeSettings: updateSettings };
}
