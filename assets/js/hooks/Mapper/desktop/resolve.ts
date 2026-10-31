import { CharacterTypeRaw } from '@/hooks/Mapper/types/character';
import { EveForeground } from './types';

/**
 * EVE window titles normally contain the character name. Match against the
 * characters already loaded for this map, preferring the user's own characters
 * and then the longest name (so "Alt 2" does not win over "Alt 2 Main").
 *
 * Kept in a module with no React/context imports: `MapRootProvider` needs this
 * helper, and importing it through the `desktop` barrel would pull the context
 * hook back in and create a circular import.
 */
export function findActiveCharacter(
  characters: CharacterTypeRaw[],
  userCharacters: string[],
  lastEve: EveForeground | null,
): CharacterTypeRaw | null {
  const title = lastEve?.title?.trim().toLowerCase();
  if (!title) {
    return null;
  }

  const matches = characters.filter(character => {
    const name = character.name?.trim().toLowerCase();
    return !!name && title.includes(name);
  });

  if (matches.length === 0) {
    return null;
  }

  return matches.sort((left, right) => {
    const leftOwn = userCharacters.includes(left.eve_id) ? 1 : 0;
    const rightOwn = userCharacters.includes(right.eve_id) ? 1 : 0;

    if (leftOwn !== rightOwn) {
      return rightOwn - leftOwn;
    }

    return (right.name?.length ?? 0) - (left.name?.length ?? 0);
  })[0];
}

export function resolveFollowedSystemId(
  characters: CharacterTypeRaw[],
  userCharacters: string[],
  lastEve: EveForeground | null,
): string | null {
  const character = findActiveCharacter(characters, userCharacters, lastEve);
  return character?.location?.solar_system_id?.toString() ?? null;
}
