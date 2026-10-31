import { ParsedBookmark } from '../types';

const HEADER_NAMES = new Set(['name', '名称', '位标名称', 'bookmark']);
const HEADER_FOLDERS = new Set(['folder', '文件夹', '位置', 'folder path']);

const lastFolderSegment = (path: string) => {
  const segments = path
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments[segments.length - 1] : undefined;
};

/**
 * Parses the tab-separated text copied from the in-game bookmark list, e.g.
 *
 *   HZM 5-k4c\t黑海岸5-5 / .虫洞口\t-
 *   XCR-433 5-5\t黑海岸5-5 / .虫洞口\t2026.10.31 15:35
 *
 * The third column is informational only and is never used for matching.
 * Folder paths are kept for display; the folder name itself is user-defined,
 * so it must not drive the comparison.
 */
export const parseBookmarks = (text: string): ParsedBookmark[] => {
  const parsed: ParsedBookmark[] = [];

  if (!text) {
    return parsed;
  }

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }

    const columns = line.split('\t');
    const name = (columns[0] ?? '').trim();

    if (!name) {
      return;
    }

    const folderPath = (columns[1] ?? '').trim();

    // Some clipboard sources include a header row; skip it instead of showing
    // it as a custom bookmark.
    if (index === 0 && HEADER_NAMES.has(name.toLowerCase()) && HEADER_FOLDERS.has(folderPath.toLowerCase())) {
      return;
    }

    const time = (columns[2] ?? '').trim();

    parsed.push({
      key: `${index}:${name}`,
      name,
      folderPath: folderPath || undefined,
      folder: folderPath ? lastFolderSegment(folderPath) : undefined,
      time: time && time !== '-' ? time : undefined,
    });
  });

  return parsed;
};
