import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'wanderer:local-bookmarks:v1';
const MAX_TEXT_LENGTH = 200_000;

type BookmarkEntry = {
  text: string;
  updatedAt: number;
};

type BookmarkStore = Record<string, BookmarkEntry>;

const readStore = (): BookmarkStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const store: BookmarkStore = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([systemId, entry]) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }

      const { text, updatedAt } = entry as Partial<BookmarkEntry>;
      if (typeof text !== 'string') {
        return;
      }

      store[systemId] = { text, updatedAt: typeof updatedAt === 'number' ? updatedAt : 0 };
    });

    return store;
  } catch {
    // localStorage can be unavailable in hardened/private profiles.
    return {};
  }
};

const writeStore = (store: BookmarkStore) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore quota/availability errors; the comparison still works in memory.
  }
};

/**
 * Local, per-system storage for pasted bookmark text. Bookmarks never leave
 * the browser: they are personal data and there is no ESI endpoint for them.
 * Desktop widget windows share the same origin, so the `storage` event keeps
 * them in sync with the main window.
 */
export function useLocalBookmarks(systemId?: string) {
  const [store, setStore] = useState<BookmarkStore>(readStore);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setStore(readStore());
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const entry = systemId ? store[systemId] : undefined;

  const save = useCallback(
    (text: string) => {
      if (!systemId) {
        return;
      }

      const nextText = text.slice(0, MAX_TEXT_LENGTH);
      setStore(prev => {
        const next = { ...prev, [systemId]: { text: nextText, updatedAt: Date.now() } };
        writeStore(next);
        return next;
      });
    },
    [systemId],
  );

  const clear = useCallback(() => {
    if (!systemId) {
      return;
    }

    setStore(prev => {
      if (!(systemId in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[systemId];
      writeStore(next);
      return next;
    });
  }, [systemId]);

  return {
    text: entry?.text ?? '',
    updatedAt: entry?.updatedAt ?? 0,
    save,
    clear,
  };
}
