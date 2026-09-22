import {
  NO_ALLIANCE_LABEL,
  NPC_CORPORATION_LABEL,
  getAffiliationLabel,
  isNpcCorporationId,
} from './affiliationTickers';

describe('isNpcCorporationId', () => {
  it('detects npc corporation ids', () => {
    expect(isNpcCorporationId(1_000_001)).toBe(true);
    expect(isNpcCorporationId(1_000_167)).toBe(true);
    expect(isNpcCorporationId(1_999_999)).toBe(true);
  });

  it('rejects player corporation ids and empty values', () => {
    expect(isNpcCorporationId(98_000_001)).toBe(false);
    expect(isNpcCorporationId(999_999)).toBe(false);
    expect(isNpcCorporationId(2_000_000)).toBe(false);
    expect(isNpcCorporationId(0)).toBe(false);
    expect(isNpcCorporationId(null)).toBe(false);
    expect(isNpcCorporationId(undefined)).toBe(false);
  });
});

describe('getAffiliationLabel', () => {
  it('renders [corp][alliance]', () => {
    expect(
      getAffiliationLabel({
        corporation_id: 98_000_001,
        corporation_ticker: 'CORP',
        alliance_id: 99_000_001,
        alliance_ticker: 'ALLY',
      }),
    ).toBe('[CORP][ALLY]');
  });

  it('falls back to [无联盟] when there is no alliance', () => {
    expect(
      getAffiliationLabel({ corporation_id: 98_000_001, corporation_ticker: 'CORP', alliance_id: null }),
    ).toBe(`[CORP][${NO_ALLIANCE_LABEL}]`);
  });

  it('replaces the ticker of npc corporations with [NPC军团]', () => {
    expect(
      getAffiliationLabel({
        corporation_id: 1_000_167,
        corporation_ticker: 'STARTER',
        alliance_id: null,
        alliance_ticker: null,
      }),
    ).toBe(`[${NPC_CORPORATION_LABEL}][${NO_ALLIANCE_LABEL}]`);
  });

  it('still reads the alliance ticker when only the ticker is provided', () => {
    expect(getAffiliationLabel({ corporation_ticker: 'CORP', alliance_ticker: 'ALLY' })).toBe('[CORP][ALLY]');
  });
});
