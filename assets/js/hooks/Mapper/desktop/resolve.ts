import { CharacterTypeRaw } from '@/hooks/Mapper/types/character';
import { DesktopFollowMode, EveForeground } from './types';

const WORD_CHAR = /[\p{L}\p{N}_]/u;

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * True when `name` occurs in `title` as a whole name rather than as a substring
 * of a longer word.
 *
 * A plain `title.includes(name)` is not enough: the title "Galbrena love
 * icecream - EVE" contains "love i", so a character named "love I" would be
 * mistaken for the active one and its data shown instead. Checking the
 * characters on both sides rejects matches like "love i" inside "icecream"
 * while still allowing separators such as spaces, dashes and brackets.
 */
function containsWholeName(title: string, name: string): boolean {
  let from = 0;

  while (from <= title.length - name.length) {
    const index = title.indexOf(name, from);
    if (index === -1) {
      return false;
    }

    const before = index > 0 ? title[index - 1] : undefined;
    const after = index + name.length < title.length ? title[index + name.length] : undefined;

    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) {
      return true;
    }

    from = index + 1;
  }

  return false;
}

/**
 * EVE window titles normally contain the character name. Match against the
 * characters already loaded for this map, taking the longest whole-name match
 * (so "Alt 2" does not win over "Alt 2 Main") and using "is one of the user's
 * own characters" only to break ties.
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
  const title = lastEve?.title ? normalize(lastEve.title) : '';
  if (!title) {
    return null;
  }

  const matches = characters.filter(character => {
    const name = character.name ? normalize(character.name) : '';
    return !!name && containsWholeName(title, name);
  });

  if (matches.length === 0) {
    return null;
  }

  return matches.sort((left, right) => {
    const lengthDiff = (right.name?.length ?? 0) - (left.name?.length ?? 0);
    // The longest whole-name match is the character the title names: "Alice"
    // also appears in "Alice Alt Long", so preferring own characters first
    // would show the wrong character's location for the longer title.
    if (lengthDiff !== 0) {
      return lengthDiff;
    }

    const leftOwn = userCharacters.includes(left.eve_id) ? 1 : 0;
    const rightOwn = userCharacters.includes(right.eve_id) ? 1 : 0;
    return rightOwn - leftOwn;
  })[0];
}

export function findCharacterById(
  characters: CharacterTypeRaw[],
  characterId: string | null,
): CharacterTypeRaw | null {
  if (!characterId) {
    return null;
  }

  return characters.find(character => character.eve_id === characterId) ?? null;
}

export function resolveFollowedSystemId(
  characters: CharacterTypeRaw[],
  userCharacters: string[],
  lastEve: EveForeground | null,
  followMode: DesktopFollowMode,
  followCharacterId: string | null,
): string | null {
  if (followMode === 'selection') {
    return null;
  }

  const character =
    followMode === 'character'
      ? findCharacterById(characters, followCharacterId)
      : findActiveCharacter(characters, userCharacters, lastEve);

  return character?.location?.solar_system_id?.toString() ?? null;
}
