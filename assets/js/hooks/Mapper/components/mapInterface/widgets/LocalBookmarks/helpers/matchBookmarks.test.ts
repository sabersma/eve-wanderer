import { SignatureGroup, SignatureKind, SystemSignature } from '@/hooks/Mapper/types';
import { compareBookmarks } from './matchBookmarks';
import { parseBookmarks } from './parseBookmarks';

const signature = (eve_id: string, name = 'Unknown', temporary_name?: string): SystemSignature => ({
  eve_id,
  kind: SignatureKind.CosmicSignature,
  name,
  group: SignatureGroup.Wormhole,
  type: '',
  ...(temporary_name ? { temporary_name } : {}),
});

const SAMPLE = [
  '0 挂靠点\t黑海岸5-5 / .战术点\t-',
  '0 超级深空2\t黑海岸5-5 / .战术点\t-',
  '0 超级深空3\t黑海岸5-5 / .战术点\t-',
  '0 超级深空\t黑海岸5-5 / .战术点\t-',
  '铁壁后2AU\t黑海岸5-5 / .战术点\t-',
  'HZM 5-k4c\t黑海岸5-5 / .虫洞口\t-',
  'OTZ 5-k4b\t黑海岸5-5 / .虫洞口\t2026.11.01 12:32',
  'XCR-433 5-5\t黑海岸5-5 / .虫洞口\t2026.10.31 15:35',
  'ZXJ 5-k4\t黑海岸5-5 / .虫洞口\t-',
  '移动式仓库* 敌对已增强\t黑海岸5-5 / .虫洞口\t2026.11.01 13:17',
  'FUS-970 富足的偏远矿场\t黑海岸5-5 / 气云遗迹\t-',
  'GWV-140 巨量蓄矿场 //\t黑海岸5-5 / 气云遗迹\t2026.11.01 12:56',
  'GWV-140 巨量蓄矿场\t黑海岸5-5 / 气云遗迹\t-',
  'PZI-723 不安全的前沿服务器阵列\t黑海岸5-5 / 气云遗迹\t-',
  'TNO-515 猖獗无人机巢穴\t黑海岸5-5 / 气云遗迹\t-',
].join('\n');

describe('compareBookmarks', () => {
  it('classifies the real pasted list', () => {
    const signatures = [
      signature('HZM-111'),
      signature('OTZ-222'),
      signature('ZXJ-333'),
      signature('XCR-433'),
      signature('FUS-970', '富足的偏远矿场'),
      signature('GWV-140', '巨量蓄矿场'),
      signature('ABC-999'),
    ];

    const result = compareBookmarks(signatures, parseBookmarks(SAMPLE));

    expect(result.counts).toEqual({
      signatures: 7,
      signaturesMatched: 6,
      signaturesUnmatched: 1,
      signaturesAmbiguous: 0,
      bookmarks: 15,
      bookmarksMatched: 7,
      bookmarksStale: 2,
      bookmarksSuspected: 0,
      bookmarksAmbiguous: 0,
      bookmarksCustom: 6,
    });

    const byName = new Map(result.bookmarks.map(item => [item.bookmark.name, item]));
    expect(byName.get('HZM 5-k4c')).toMatchObject({ status: 'matched', evidence: { kind: 'letters', token: 'HZM' } });
    expect(byName.get('XCR-433 5-5')).toMatchObject({
      status: 'matched',
      evidence: { kind: 'full', token: 'XCR-433' },
    });
    expect(byName.get('PZI-723 不安全的前沿服务器阵列')).toMatchObject({
      status: 'stale',
      evidence: { kind: 'full' },
    });
    expect(byName.get('0 挂靠点')).toMatchObject({ status: 'custom' });
    expect(byName.get('移动式仓库* 敌对已增强')).toMatchObject({ status: 'custom' });

    expect(result.signatures.find(item => item.signature.eve_id === 'ABC-999')?.status).toBe('unmatched');
    expect(result.signatures.find(item => item.signature.eve_id === 'GWV-140')?.matchedBookmarks).toHaveLength(2);
  });

  it('matches a site name when no signal ID is present', () => {
    const result = compareBookmarks(
      [signature('FUS-970', '富足的偏远矿场')],
      parseBookmarks('富足的偏远矿场\tfolder\t-'),
    );

    expect(result.bookmarks[0]).toMatchObject({ status: 'matched', evidence: { kind: 'site' } });
  });

  it('treats a missing letters-only reference as suspected', () => {
    const result = compareBookmarks([signature('ABC-123')], parseBookmarks('HZM 5-k4c'));

    expect(result.bookmarks[0]).toMatchObject({ status: 'suspected', evidence: { kind: 'letters', token: 'HZM' } });
  });

  it('treats a missing full ID as stale even when another token could match', () => {
    const result = compareBookmarks(
      [signature('HZM-111', '富足的偏远矿场')],
      parseBookmarks('OLD-999 HZM 富足的偏远矿场'),
    );

    expect(result.bookmarks[0]).toMatchObject({ status: 'stale', evidence: { kind: 'full', token: 'OLD-999' } });
  });

  it('matches digits only when the suffix is unique', () => {
    const unique = compareBookmarks([signature('XCR-433')], parseBookmarks('433 5-5'));
    expect(unique.bookmarks[0]).toMatchObject({ status: 'matched', evidence: { kind: 'digits', token: '433' } });

    const ambiguous = compareBookmarks([signature('ABC-433'), signature('DEF-433')], parseBookmarks('433 5-5'));
    expect(ambiguous.bookmarks[0].status).toBe('ambiguous');
    expect(ambiguous.counts.signaturesUnmatched).toBe(0);
    expect(ambiguous.counts.signaturesAmbiguous).toBe(2);
  });

  it('marks an ambiguous letters token and does not count signatures as matched', () => {
    const result = compareBookmarks([signature('HZM-111'), signature('HZM-222')], parseBookmarks('HZM 5-k4c'));

    expect(result.bookmarks[0].status).toBe('ambiguous');
    expect(result.signatures.every(item => item.status === 'ambiguous')).toBe(true);
  });

  it('ignores case differences', () => {
    const result = compareBookmarks([signature('XCR-433')], parseBookmarks('xcr-433 5-5'));
    expect(result.bookmarks[0]).toMatchObject({ status: 'matched', evidence: { kind: 'full' } });
  });

  it('keeps custom bookmarks when no signal token is present', () => {
    const result = compareBookmarks([signature('ABC-123')], parseBookmarks('超级深空2\t.战术点\t-'));

    expect(result.bookmarks[0]).toMatchObject({ status: 'custom' });
    expect(result.signatures[0].status).toBe('unmatched');
  });
});
