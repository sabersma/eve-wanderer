import { parseBookmarks } from './parseBookmarks';

const SAMPLE = [
  '0 挂靠点\t黑海岸5-5 / .战术点\t-',
  '0 超级深空2\t黑海岸5-5 / .战术点\t-',
  'HZM 5-k4c\t黑海岸5-5 / .虫洞口\t-',
  'XCR-433 5-5\t黑海岸5-5 / .虫洞口\t2026.10.31 15:35',
  'FUS-970 富足的偏远矿场\t黑海岸5-5 / 气云遗迹\t-',
].join('\n');

describe('parseBookmarks', () => {
  it('parses tab-separated rows, folders and optional times', () => {
    const rows = parseBookmarks(SAMPLE);

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ name: '0 挂靠点', folder: '.战术点', folderPath: '黑海岸5-5 / .战术点' });
    expect(rows[0].time).toBeUndefined();
    expect(rows[3]).toMatchObject({ name: 'XCR-433 5-5', folder: '.虫洞口' });
    expect(rows[3].time).toBe('2026.10.31 15:35');
    expect(rows[4].folder).toBe('气云遗迹');
  });

  it('handles CRLF and blank lines', () => {
    const rows = parseBookmarks('A-111\tfolder\r\n\r\nB-222\tfolder\r\n');

    expect(rows.map(row => row.name)).toEqual(['A-111', 'B-222']);
  });

  it('keeps single-column lines as name-only bookmarks', () => {
    const rows = parseBookmarks('only a name');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'only a name' });
    expect(rows[0].folder).toBeUndefined();
    expect(rows[0].folderPath).toBeUndefined();
  });

  it('skips a header row', () => {
    const rows = parseBookmarks('Name\tFolder\tTime\nABC-123\tfolder\t-');

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('ABC-123');
  });

  it('normalizes whitespace around columns', () => {
    const rows = parseBookmarks('  HZM 5-k4c\t  folder / .虫洞口  \t - ');

    expect(rows[0]).toMatchObject({ name: 'HZM 5-k4c', folder: '.虫洞口' });
    expect(rows[0].time).toBeUndefined();
  });
});
