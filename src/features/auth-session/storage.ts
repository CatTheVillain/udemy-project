export interface AccessTokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export interface ExceptionSafeAccessTokenStore {
  get(): string | null;
  set(token: string): boolean;
  clear(): void;
}

export const ACCESS_TOKEN_STORAGE_KEY = 'learnhub.access-token';

function getBrowserStorage(): Storage {
  const storage = globalThis.localStorage;
  if (!storage) {
    throw new Error('localStorage is unavailable');
  }
  return storage;
}

export function createBrowserAccessTokenStore(
  storageKey = ACCESS_TOKEN_STORAGE_KEY,
): AccessTokenStore {
  return {
    get: () => getBrowserStorage().getItem(storageKey),
    set: (token) => getBrowserStorage().setItem(storageKey, token),
    clear: () => getBrowserStorage().removeItem(storageKey),
  };
}

export function isAccessTokenStorageEvent(
  event: StorageEvent,
  storageKey = ACCESS_TOKEN_STORAGE_KEY,
): boolean {
  if (event.key !== storageKey && event.key !== null) return false;

  if (!event.storageArea) return true;
  try {
    return event.storageArea === getBrowserStorage();
  } catch {
    return true;
  }
}

export function createExceptionSafeAccessTokenStore(
  store: AccessTokenStore,
): ExceptionSafeAccessTokenStore {
  let blocked = false;

  return {
    get() {
      if (blocked) return null;
      try {
        return store.get();
      } catch {
        blocked = true;
        return null;
      }
    },
    set(token) {
      try {
        store.set(token);
        blocked = false;
        return true;
      } catch {
        blocked = true;
        try {
          store.clear();
        } catch {
          // The store remains blocked, so a partially written token cannot be reused.
        }
        return false;
      }
    },
    clear() {
      blocked = true;
      try {
        store.clear();
      } catch {
        // Keep the store blocked for this provider even when persistence is unavailable.
      }
    },
  };
}
