// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserAccessTokenStore,
  createExceptionSafeAccessTokenStore,
  type AccessTokenStore,
} from '../../../src/features/auth-session/storage';

const storageKey = 'learnhub.storage-test-token';
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function restoreLocalStorage() {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function makeLocalStorageUnavailable() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  restoreLocalStorage();
  globalThis.localStorage?.removeItem(storageKey);
  vi.restoreAllMocks();
});

describe('access-token storage', () => {
  it('delegates get, set, and clear when browser storage is available', () => {
    const store = createBrowserAccessTokenStore(storageKey);

    store.set('available-token');
    expect(store.get()).toBe('available-token');

    store.clear();
    expect(store.get()).toBeNull();
  });

  it('throws from every raw operation when browser storage is unavailable', () => {
    makeLocalStorageUnavailable();
    const store = createBrowserAccessTokenStore(storageKey);

    expect(() => store.get()).toThrow('localStorage is unavailable');
    expect(() => store.set('unavailable-token')).toThrow('localStorage is unavailable');
    expect(() => store.clear()).toThrow('localStorage is unavailable');
  });

  it('fails closed when browser storage is unavailable', () => {
    makeLocalStorageUnavailable();
    const store = createExceptionSafeAccessTokenStore(createBrowserAccessTokenStore(storageKey));

    expect(store.get()).toBeNull();

    restoreLocalStorage();
    globalThis.localStorage.setItem(storageKey, 'persisted-token');
    expect(store.get()).toBeNull();

    makeLocalStorageUnavailable();
    expect(store.set('replacement-token')).toBe(false);
    expect(() => store.clear()).not.toThrow();
  });

  it('fails closed when the underlying storage methods throw', () => {
    const get = vi.fn(() => {
      throw new Error('read denied');
    });
    const set = vi.fn(() => {
      throw new Error('write denied');
    });
    const clear = vi.fn(() => {
      throw new Error('clear denied');
    });
    const throwingStore: AccessTokenStore = { get, set, clear };
    const store = createExceptionSafeAccessTokenStore(throwingStore);

    expect(store.get()).toBeNull();
    expect(store.get()).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);

    expect(store.set('replacement-token')).toBe(false);
    expect(set).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);

    expect(() => store.clear()).not.toThrow();
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect A after a failed clear leaves the raw token behind', () => {
    const get = vi.fn(() => 'token-A');
    const clear = vi.fn(() => {
      throw new Error('clear denied');
    });
    const store = createExceptionSafeAccessTokenStore({
      get,
      set: vi.fn(),
      clear,
    });

    expect(store.get()).toBe('token-A');
    expect(() => store.clear()).not.toThrow();
    expect(get()).toBe('token-A');
    expect(store.get()).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
