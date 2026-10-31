import { SystemSignature } from '@/hooks/Mapper/types';

/** One row pasted from the in-game People & Places bookmark list. */
export type ParsedBookmark = {
  key: string;
  name: string;
  folderPath?: string;
  /** Last folder segment, e.g. `.虫洞口`. Display-only: folder names are user-defined. */
  folder?: string;
  time?: string;
};

export type BookmarkMatchKind = 'full' | 'letters' | 'site' | 'digits';

export type BookmarkStatus = 'matched' | 'stale' | 'suspected' | 'ambiguous' | 'custom';

export type BookmarkComparison = {
  bookmark: ParsedBookmark;
  status: BookmarkStatus;
  /** Set when exactly one current signature was found. */
  matched?: SystemSignature;
  /** Set for ambiguous matches so the user can check them by hand. */
  candidates?: SystemSignature[];
  evidence?: { kind: BookmarkMatchKind; token: string };
};

export type SignatureStatus = 'matched' | 'unmatched' | 'ambiguous';

export type SignatureComparison = {
  signature: SystemSignature;
  status: SignatureStatus;
  matchedBookmarks: BookmarkComparison[];
  ambiguousBookmarks: BookmarkComparison[];
};

export type ComparisonCounts = {
  signatures: number;
  signaturesMatched: number;
  signaturesUnmatched: number;
  signaturesAmbiguous: number;
  bookmarks: number;
  bookmarksMatched: number;
  bookmarksStale: number;
  bookmarksSuspected: number;
  bookmarksAmbiguous: number;
  bookmarksCustom: number;
};

export type ComparisonResult = {
  signatures: SignatureComparison[];
  bookmarks: BookmarkComparison[];
  counts: ComparisonCounts;
};
