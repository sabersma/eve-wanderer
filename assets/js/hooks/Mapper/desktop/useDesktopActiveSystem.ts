import { useMemo } from 'react';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { findActiveCharacter } from './resolve';
import { useDesktopBridgeState } from './useDesktopBridge';
import { useSharedSelectedSystem } from './selectedSystemStore';

/**
 * Resolves the system a desktop window should show.
 *
 * Widget windows follow the last activated EVE client when follow is enabled.
 * A widget window has no map of its own, so when follow cannot resolve a system
 * (EVE not activated yet, character not tracked on this map, positions still
 * loading) it falls back to the system selected in the main map window. Without
 * that fallback the widget would stay permanently empty in exactly the cases
 * where the user has not touched EVE yet.
 */
export function useDesktopActiveSystem() {
  const { info, lastEve, followEnabled } = useDesktopBridgeState();
  const {
    data: { characters, userCharacters, selectedSystems },
  } = useMapRootState();
  const sharedSelectedSystemId = useSharedSelectedSystem();

  const matchedCharacter = useMemo(
    () => findActiveCharacter(characters, userCharacters, lastEve),
    [characters, userCharacters, lastEve],
  );

  const followedSystemId = matchedCharacter?.location?.solar_system_id?.toString() ?? null;
  const selectedSystemId = selectedSystems.length === 1 ? selectedSystems[0] : null;

  const systemId: string | undefined =
    (info.mode === 'widget'
      ? ((followEnabled ? followedSystemId : null) ?? sharedSelectedSystemId ?? selectedSystemId)
      : selectedSystemId) ?? undefined;

  return {
    info,
    lastEve,
    followEnabled,
    matchedCharacter,
    followedSystemId,
    sharedSelectedSystemId,
    selectedSystemId,
    systemId,
  };
}
