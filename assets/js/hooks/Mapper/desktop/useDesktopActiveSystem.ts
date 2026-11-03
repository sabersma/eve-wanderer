import { useMemo } from 'react';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { CharacterTypeRaw } from '@/hooks/Mapper/types/character';
import { findActiveCharacter, findCharacterById } from './resolve';
import { useDesktopBridgeState } from './useDesktopBridge';
import { useSharedSelectedSystem } from './selectedSystemStore';

/**
 * Resolves the system a desktop window should show.
 *
 * Widget windows use the follow target picked in the top bar: the last
 * activated EVE client, an explicitly selected character, or the main map
 * selection. A widget window has no map of its own, so whenever follow cannot
 * resolve a system (EVE not activated yet, character not tracked on this map,
 * positions still loading) it falls back to the system selected in the main map
 * window. Without that fallback the widget would stay permanently empty in
 * exactly the cases where the user has not touched EVE yet.
 */
export function useDesktopActiveSystem() {
  const { info, lastEve, followMode, followCharacterId } = useDesktopBridgeState();
  const {
    data: { characters, userCharacters, selectedSystems },
  } = useMapRootState();
  const sharedSelectedSystemId = useSharedSelectedSystem();

  const matchedCharacter = useMemo(
    () => findActiveCharacter(characters, userCharacters, lastEve),
    [characters, userCharacters, lastEve],
  );

  const followCharacter = useMemo(
    () => findCharacterById(characters, followCharacterId),
    [characters, followCharacterId],
  );

  const followedCharacter: CharacterTypeRaw | null =
    followMode === 'character' ? followCharacter : followMode === 'active' ? matchedCharacter : null;

  const followedSystemId = followedCharacter?.location?.solar_system_id?.toString() ?? null;
  const selectedSystemId = selectedSystems.length === 1 ? selectedSystems[0] : null;

  const systemId: string | undefined =
    (info.mode === 'widget'
      ? (followedSystemId ?? sharedSelectedSystemId ?? selectedSystemId)
      : selectedSystemId) ?? undefined;

  return {
    info,
    lastEve,
    followMode,
    followCharacterId,
    followCharacter,
    followedCharacter,
    matchedCharacter,
    followedSystemId,
    sharedSelectedSystemId,
    selectedSystemId,
    systemId,
  };
}
