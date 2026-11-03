import { CharacterTypeRaw } from '@/hooks/Mapper/types/character';
import { findActiveCharacter, findCharacterById, resolveFollowedSystemId } from './resolve';
import { EveForeground } from './types';

const character = (name: string, eveId: string, systemId: number | null = null): CharacterTypeRaw =>
  ({
    name,
    eve_id: eveId,
    location: systemId == null ? null : { solar_system_id: systemId, structure_id: null, station_id: null },
  }) as CharacterTypeRaw;

const eve = (title: string): EveForeground => ({
  title,
  process: 'exefile.exe',
  hwnd: 1,
  at: 0,
});

describe('findActiveCharacter', () => {
  it('does not mistake a character whose name is a substring of the title', () => {
    // "love I" is a substring of "Galbrena love icecream" but is a different character.
    const characters = [character('Galbrena love icecream', '1'), character('love I', '2')];

    expect(findActiveCharacter(characters, [], eve('Galbrena love icecream - EVE'))?.name).toBe(
      'Galbrena love icecream',
    );
  });

  it('returns null when only a substring match exists', () => {
    const characters = [character('love I', '2')];

    expect(findActiveCharacter(characters, ['2'], eve('Galbrena love icecream - EVE'))).toBeNull();
  });

  it('matches names next to punctuation and at the ends of the title', () => {
    const characters = [character('Alt 2', '1')];

    expect(findActiveCharacter(characters, [], eve('EVE: Alt 2.'))?.name).toBe('Alt 2');
    expect(findActiveCharacter(characters, [], eve('Alt 2 - EVE'))?.name).toBe('Alt 2');
  });

  it('prefers the longest whole-name match', () => {
    const characters = [character('Alice', '1'), character('Alice Alt Long', '2')];

    expect(findActiveCharacter(characters, ['1'], eve('Alice Alt Long - EVE'))?.name).toBe(
      'Alice Alt Long',
    );
  });

  it("uses the user's own characters to break ties", () => {
    const characters = [character('Ann', '1'), character('Bob', '2')];

    expect(findActiveCharacter(characters, ['1'], eve('Ann Bob - EVE'))?.name).toBe('Ann');
  });
});

describe('findCharacterById', () => {
  const characters = [character('Ann', '1'), character('Bob', '2')];

  it('finds the character with the matching eve id', () => {
    expect(findCharacterById(characters, '2')?.name).toBe('Bob');
  });

  it('returns null for a missing or empty id', () => {
    expect(findCharacterById(characters, '3')).toBeNull();
    expect(findCharacterById(characters, null)).toBeNull();
  });
});

describe('resolveFollowedSystemId', () => {
  const characters = [character('Active', '1', 31000001), character('Alt', '2', 31000002)];

  it('follows the character in the last activated EVE window in active mode', () => {
    expect(resolveFollowedSystemId(characters, ['1'], eve('Active - EVE'), 'active', null)).toBe('31000001');
  });

  it('follows the explicitly selected character in character mode', () => {
    expect(resolveFollowedSystemId(characters, ['1'], eve('Active - EVE'), 'character', '2')).toBe('31000002');
  });

  it('returns null in selection mode and for an unknown character', () => {
    expect(resolveFollowedSystemId(characters, ['1'], eve('Active - EVE'), 'selection', '2')).toBeNull();
    expect(resolveFollowedSystemId(characters, ['1'], eve('Active - EVE'), 'character', '3')).toBeNull();
  });
});
