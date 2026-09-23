// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionPrivateCacheLifecycle } from '../../../src/app/query';
import type { UserProfileDto } from '../../../src/entities/user';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
} from '../../../src/features/auth-session';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface MutableTokenStore extends AccessTokenStore {
  value: string | null;
}

type FetchArguments = Parameters<typeof fetch>;
type FetchResult = ReturnType<typeof fetch>;

const profileA: UserProfileDto = {
  email: 'a@example.test',
  name: 'Ada',
  surname: 'A',
  role: 'student',
  birthday: null,
  phone_number: '+10000000000',
  created_at: '2026-07-20T00:00:00Z',
};

const profileB: UserProfileDto = {
  ...profileA,
  email: 'b@example.test',
  name: 'Bea',
  role: 'instructor',
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function tokenStore(initial: string | null): MutableTokenStore {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(token) {
      this.value = token;
    },
    clear() {
      this.value = null;
    },
  };
}

function profileResponse(authorization: string | null): Response {
  const profile = authorization === 'Bearer token-B' ? profileB : profileA;
  return new Response(JSON.stringify(profile), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function dispatchExternalTokenChange(): void {
  window.dispatchEvent(new StorageEvent('storage', { key: 'learnhub.access-token' }));
}

function SessionProbe() {
  const { cacheEpoch, requestRequired, state } = useSession();
  const [result, setResult] = useState('idle');

  function run(method: 'GET' | 'POST') {
    void requestRequired<{ source: string }>({
      method,
      path: method === 'GET' ? '/private-data' : '/private-mutation',
      dedupeKey: `${method}-private-request`,
    }).then(
      (response) => setResult(response.source),
      () => setResult('failed'),
    );
  }

  return (
    <div>
      <output aria-label="session state">{state.status}</output>
      <output aria-label="session user">
        {state.status === 'authenticated' ? state.user.email : 'anonymous'}
      </output>
      <output aria-label="cache epoch">{cacheEpoch ?? 'none'}</output>
      <output aria-label="request result">{result}</output>
      <button type="button" onClick={() => run('GET')}>
        Run private read
      </button>
      <button type="button" onClick={() => run('POST')}>
        Run private mutation
      </button>
    </div>
  );
}

function renderSession(
  store: MutableTokenStore,
  fetchImplementation: typeof fetch,
  queryClient?: QueryClient,
) {
  const subject = (
    <SessionProvider
      apiBaseUrl="https://api.learnhub.test"
      fetchImplementation={fetchImplementation}
      tokenStore={store}
    >
      <SessionProbe />
      {queryClient ? <SessionPrivateCacheLifecycle /> : null}
    </SessionProvider>
  );
  return queryClient
    ? render(<QueryClientProvider client={queryClient}>{subject}</QueryClientProvider>)
    : render(subject);
}

async function expectAuthenticated(email: string): Promise<string> {
  await waitFor(() => expect(screen.getByLabelText('session user').textContent).toBe(email));
  const epoch = screen.getByLabelText('cache epoch').textContent;
  expect(epoch).not.toBe('none');
  return epoch as string;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SessionProvider external token ownership', () => {
  it('replaces A profile and request bearer with B after a real storage event', async () => {
    const store = tokenStore('token-A');
    const authorizations: Array<string | null> = [];
    const fetchImplementation = vi.fn<FetchArguments, FetchResult>(async (input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      authorizations.push(authorization);
      if (String(input).endsWith('/me')) return profileResponse(authorization);
      return new Response(JSON.stringify({ source: authorization }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderSession(store, fetchImplementation);
    const epochA = await expectAuthenticated('a@example.test');

    store.value = 'token-B';
    await act(async () => dispatchExternalTokenChange());
    const epochB = await expectAuthenticated('b@example.test');
    expect(epochB).not.toBe(epochA);

    await act(async () =>
      userEvent.setup().click(screen.getByRole('button', { name: 'Run private read' })),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('request result').textContent).toBe('Bearer token-B'),
    );
    expect(authorizations).toEqual(['Bearer token-A', 'Bearer token-B', 'Bearer token-B']);
  });

  it('ends the local session and removes its private cache when another tab removes the token', async () => {
    const store = tokenStore('token-A');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchImplementation = vi.fn<FetchArguments, FetchResult>(async (_input, init) =>
      profileResponse(new Headers(init?.headers).get('Authorization')),
    );

    renderSession(store, fetchImplementation, queryClient);
    const epochA = await expectAuthenticated('a@example.test');
    queryClient.setQueryData(['private', epochA, 'cart'], { retained: true });
    queryClient.setQueryData(['public', 'catalog'], { retained: true });

    store.value = null;
    await act(async () => dispatchExternalTokenChange());
    await waitFor(() =>
      expect(screen.getByLabelText('session state').textContent).toBe('anonymous'),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(['private', epochA, 'cart'])).toBeUndefined(),
    );
    expect(queryClient.getQueryData(['public', 'catalog'])).toEqual({ retained: true });
  });

  it('rejects a late A success after A to B to A without replacing the later A lifetime', async () => {
    const store = tokenStore('token-A');
    const originalAResponse = deferred<Response>();
    const authorizations: Array<string | null> = [];
    const fetchImplementation = vi.fn<FetchArguments, FetchResult>((input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      authorizations.push(authorization);
      if (String(input).endsWith('/me')) return Promise.resolve(profileResponse(authorization));
      return originalAResponse.promise;
    });

    renderSession(store, fetchImplementation);
    const firstEpochA = await expectAuthenticated('a@example.test');
    await act(async () =>
      userEvent.setup().click(screen.getByRole('button', { name: 'Run private read' })),
    );
    await waitFor(() => expect(authorizations).toEqual(['Bearer token-A', 'Bearer token-A']));

    store.value = 'token-B';
    await act(async () => dispatchExternalTokenChange());
    await expectAuthenticated('b@example.test');
    store.value = 'token-A';
    await act(async () => dispatchExternalTokenChange());
    const laterEpochA = await expectAuthenticated('a@example.test');
    expect(laterEpochA).not.toBe(firstEpochA);

    await act(async () =>
      originalAResponse.resolve(
        new Response(JSON.stringify({ source: 'late A' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('request result').textContent).toBe('failed'));
    expect(screen.getByLabelText('session user').textContent).toBe('a@example.test');
    expect(store.value).toBe('token-A');
  });

  it('does not let a late A 401 clear B and never retries an A mutation as B', async () => {
    const store = tokenStore('token-A');
    const mutationResponse = deferred<Response>();
    const fetchImplementation = vi.fn<FetchArguments, FetchResult>((input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      if (String(input).endsWith('/me')) return Promise.resolve(profileResponse(authorization));
      return mutationResponse.promise;
    });

    renderSession(store, fetchImplementation);
    await expectAuthenticated('a@example.test');
    await act(async () =>
      userEvent.setup().click(screen.getByRole('button', { name: 'Run private mutation' })),
    );
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));

    store.value = 'token-B';
    await act(async () => dispatchExternalTokenChange());
    await expectAuthenticated('b@example.test');
    await act(async () =>
      mutationResponse.resolve(
        new Response(JSON.stringify({ detail: 'expired A' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('request result').textContent).toBe('failed'));
    expect(screen.getByLabelText('session user').textContent).toBe('b@example.test');
    expect(store.value).toBe('token-B');
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer token-A',
    );
  });
});
