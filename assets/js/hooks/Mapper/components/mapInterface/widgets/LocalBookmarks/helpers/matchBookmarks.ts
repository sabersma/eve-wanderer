import { SystemSignature } from '@/hooks/Mapper/types';
import { BookmarkComparison, BookmarkMatchKind, ComparisonResult, ParsedBookmark, SignatureComparison } from '../types';

const FULL_ID_RE = /\b[A-Z0-9]{3}-\d{3}\b/g;
const LETTERS_RE = /\b[A-Z]{3}\b/g;
const DIGITS_RE = /\b\d{3}\b/g;
const SIGNATURE_ID_RE = /^([A-Z0-9]{3})-(\d{3})$/;

// `name` can fall back to labels such as "Wormhole" or "Gas Site" for unscanned
// signatures; matching bookmark names against those would create noise.
const IGNORED_SITE_NAMES = new Set(
  [
    'UNKNOWN',
    'COSMIC SIGNATURE',
    'COSMIC ANOMALY',
    'STRUCTURE',
    'SHIP',
    'DEPLOYABLE',
    'DRONE',
    'STARBASE',
    'WORMHOLE',
    'GAS SITE',
    'RELIC SITE',
    'DATA SITE',
    'ORE SITE',
    'COMBAT SITE',
  ].map(value => value.toUpperCase()),
);

const normalize = (value?: string) => (value ?? '').normalize('NFKC').toUpperCase().trim();

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const uniqueSignatures = (signatures: SystemSignature[]): SystemSignature[] => {
  const seen = new Set<string>();
  return signatures.filter(signature => {
    if (seen.has(signature.eve_id)) {
      return false;
    }
    seen.add(signature.eve_id);
    return true;
  });
};

type SignatureIndex = {
  byFullId: Map<string, SystemSignature[]>;
  byLetters: Map<string, SystemSignature[]>;
  byDigits: Map<string, SystemSignature[]>;
  siteNames: { value: string; signature: SystemSignature }[];
};

const addToIndex = (index: Map<string, SystemSignature[]>, key: string, signature: SystemSignature) => {
  const current = index.get(key);
  if (current) {
    current.push(signature);
  } else {
    index.set(key, [signature]);
  }
};

const buildIndex = (signatures: SystemSignature[]): SignatureIndex => {
  const index: SignatureIndex = {
    byFullId: new Map(),
    byLetters: new Map(),
    byDigits: new Map(),
    siteNames: [],
  };

  signatures.forEach(signature => {
    const fullId = normalize(signature.eve_id);
    addToIndex(index.byFullId, fullId, signature);

    const parts = SIGNATURE_ID_RE.exec(fullId);
    if (parts) {
      addToIndex(index.byLetters, parts[1], signature);
      addToIndex(index.byDigits, parts[2], signature);
    }

    [signature.name, signature.temporary_name].forEach(rawName => {
      const siteName = normalize(rawName);
      if (siteName.length >= 2 && !IGNORED_SITE_NAMES.has(siteName)) {
        index.siteNames.push({ value: siteName, signature });
      }
    });
  });

  return index;
};

const matched = (
  bookmark: ParsedBookmark,
  signature: SystemSignature,
  evidence: { kind: BookmarkMatchKind; token: string },
): BookmarkComparison => ({ bookmark, status: 'matched', matched: signature, evidence });

const ambiguous = (
  bookmark: ParsedBookmark,
  candidates: SystemSignature[],
  evidence: { kind: BookmarkMatchKind; token: string },
): BookmarkComparison => ({ bookmark, status: 'ambiguous', candidates, evidence });

const matchBookmark = (bookmark: ParsedBookmark, index: SignatureIndex): BookmarkComparison => {
  const value = normalize(bookmark.name);

  // A full signature ID is the strongest evidence. If it is present but no
  // longer in the current list, the bookmark is stale even if the name also
  // contains weaker tokens (those belong to a different, unrelated signature).
  const fullIds = unique(value.match(FULL_ID_RE) ?? []);
  if (fullIds.length > 0) {
    const candidates = uniqueSignatures(fullIds.flatMap(id => index.byFullId.get(id) ?? []));
    if (candidates.length === 1) {
      return matched(bookmark, candidates[0], { kind: 'full', token: fullIds[0] });
    }
    if (candidates.length > 1) {
      return ambiguous(bookmark, candidates, { kind: 'full', token: fullIds[0] });
    }
    return { bookmark, status: 'stale', evidence: { kind: 'full', token: fullIds[0] } };
  }

  // Letters-only or digits-only references are weaker: they can match one
  // current signature, be ambiguous, or be a signal that disappeared.
  const letters = unique(value.match(LETTERS_RE) ?? []);
  if (letters.length > 0) {
    const candidates = uniqueSignatures(letters.flatMap(token => index.byLetters.get(token) ?? []));
    if (candidates.length === 1) {
      return matched(bookmark, candidates[0], { kind: 'letters', token: letters[0] });
    }
    if (candidates.length > 1) {
      return ambiguous(bookmark, candidates, { kind: 'letters', token: letters[0] });
    }
    return { bookmark, status: 'suspected', evidence: { kind: 'letters', token: letters[0] } };
  }

  const siteHits = index.siteNames.filter(({ value: siteName }) => value.includes(siteName));
  const siteCandidates = uniqueSignatures(siteHits.map(hit => hit.signature));
  if (siteCandidates.length === 1) {
    return matched(bookmark, siteCandidates[0], { kind: 'site', token: siteHits[0].value });
  }
  if (siteCandidates.length > 1) {
    return ambiguous(bookmark, siteCandidates, { kind: 'site', token: siteHits[0].value });
  }

  const digits = unique(value.match(DIGITS_RE) ?? []);
  if (digits.length > 0) {
    const candidates = uniqueSignatures(digits.flatMap(token => index.byDigits.get(token) ?? []));
    if (candidates.length === 1) {
      return matched(bookmark, candidates[0], { kind: 'digits', token: digits[0] });
    }
    if (candidates.length > 1) {
      return ambiguous(bookmark, candidates, { kind: 'digits', token: digits[0] });
    }
    return { bookmark, status: 'suspected', evidence: { kind: 'digits', token: digits[0] } };
  }

  return { bookmark, status: 'custom' };
};

const compareSignatures = (signatures: SystemSignature[], bookmarks: BookmarkComparison[]): SignatureComparison[] => {
  const matchedById = new Map<string, BookmarkComparison[]>();
  const ambiguousById = new Map<string, BookmarkComparison[]>();

  bookmarks.forEach(bookmark => {
    if (bookmark.status === 'matched' && bookmark.matched) {
      matchedById.set(bookmark.matched.eve_id, [...(matchedById.get(bookmark.matched.eve_id) ?? []), bookmark]);
    }

    if (bookmark.status === 'ambiguous') {
      bookmark.candidates?.forEach(candidate => {
        ambiguousById.set(candidate.eve_id, [...(ambiguousById.get(candidate.eve_id) ?? []), bookmark]);
      });
    }
  });

  return signatures.map(signature => {
    const matchedBookmarks = matchedById.get(signature.eve_id) ?? [];
    const ambiguousBookmarks = ambiguousById.get(signature.eve_id) ?? [];

    const status = matchedBookmarks.length > 0 ? 'matched' : ambiguousBookmarks.length > 0 ? 'ambiguous' : 'unmatched';

    return {
      signature,
      status,
      matchedBookmarks,
      ambiguousBookmarks,
    };
  });
};

const countBookmarks = (bookmarks: BookmarkComparison[]) =>
  bookmarks.reduce(
    (acc, bookmark) => {
      switch (bookmark.status) {
        case 'matched':
          acc.matched += 1;
          break;
        case 'stale':
          acc.stale += 1;
          break;
        case 'suspected':
          acc.suspected += 1;
          break;
        case 'ambiguous':
          acc.ambiguous += 1;
          break;
        case 'custom':
          acc.custom += 1;
          break;
      }
      return acc;
    },
    { matched: 0, stale: 0, suspected: 0, ambiguous: 0, custom: 0 },
  );

export const compareBookmarks = (signatures: SystemSignature[], bookmarks: ParsedBookmark[]): ComparisonResult => {
  const index = buildIndex(signatures);
  const results = bookmarks.map(bookmark => matchBookmark(bookmark, index));
  const signatureComparisons = compareSignatures(signatures, results);
  const bookmarkCounts = countBookmarks(results);

  return {
    signatures: signatureComparisons,
    bookmarks: results,
    counts: {
      signatures: signatures.length,
      signaturesMatched: signatureComparisons.filter(item => item.status === 'matched').length,
      signaturesUnmatched: signatureComparisons.filter(item => item.status === 'unmatched').length,
      signaturesAmbiguous: signatureComparisons.filter(item => item.status === 'ambiguous').length,
      bookmarks: results.length,
      bookmarksMatched: bookmarkCounts.matched,
      bookmarksStale: bookmarkCounts.stale,
      bookmarksSuspected: bookmarkCounts.suspected,
      bookmarksAmbiguous: bookmarkCounts.ambiguous,
      bookmarksCustom: bookmarkCounts.custom,
    },
  };
};
