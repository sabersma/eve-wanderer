import { useSyncExternalStore } from 'react';

/**
 * Desktop windows are separate documents with separate React trees, so the
 * widget windows cannot read the main map's `selectedSystems`. The main window
 * publishes its single selection here, and a widget uses it as a fallback when
 * EVE follow has not resolved a system yet (no EVE client activated, character
 * not tracked on this map, etc.). WebView2 shares localStorage across windows
 * of the same origin, and `storage` keeps the widget reactive without polling.
 */
const STORAGE_KEY = 'wanderer:desktop:selected-system';

const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let value: string | null = read();

function emit() {
  listeners.forEach(listener => listener());
}

export function getSharedSelectedSystem(): string | null {
  return value;
}

export function subscribeSharedSelectedSystem(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSharedSelectedSystem(systemId: string | null) {
  if (value === systemId) {
    return;
  }

  try {
    if (systemId) {
      localStorage.setItem(STORAGE_KEY, systemId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage can be unavailable in hardened/private profiles.
  }

  value = systemId;
  emit();
}

if (typeof window !== 'undefined') {
  // `storage` does not fire in the window that wrote the value, which is fine:
  // only the main window publishes and only the widget windows consume.
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    const next = event.newValue;
    if (next !== value) {
      value = next;
      emit();
    }
  });
}

export function useSharedSelectedSystem(): string | null {
  return useSyncExternalStore(subscribeSharedSelectedSystem, getSharedSelectedSystem, getSharedSelectedSystem);
}
