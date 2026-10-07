// @vitest-environment jsdom

import { useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient, type ApiRequestOptions } from '../../../src/shared/api';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
} from '../../../src/features/auth-session';
import type { UserProfileDto } from '../../../src/entities/user';
import { cancelAndRemovePrivateQueries } from '../../../src/app/query/SessionPrivateCacheLifecycle';
import {
  instructorCourseCollectionQueryKey,
  instructorCourseQueryKey,
  instructorCourseRosterQueryKey,
  instructorLessonQueryKey,
  type SessionCacheEpoch,
} from '../../../src/shared/api/query-keys';

const profile: UserProfileDto = {
  email: 'learner@example.com',
  name: 'Ada',
  surname: 'Lovelace',
  role: 'student',
  birthday: null,
  phone_number: '+10000000000',
  created_at: '2026-07-20T00:00:00Z',
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function tokenStore(initial: string | null): AccessTokenStore & { value: string | null } {
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

type TestApiRequestOptions = ApiRequestOptions<unknown, unknown>;

function clientFrom(handler: (options: TestApiRequestOptions) => Promise<unknown>): ApiClient {
  return {
    request: async <TResponse, TBody = unknown>(
      options: ApiRequestOptions<TBody, TResponse>,
    ): Promise<TResponse> => {
      const value = await handler(options);
      return 'decode' in options && options.decode ? options.decode(value) : (value as TResponse);
    },
  };
}

function SessionStatus() {
  const { state, retryBootstrap, acceptAccessToken } = useSession();
  return (
    <div>
      <output aria-label="session status">{state.status}</output>
      <output aria-label="session role">
        {state.status === 'authenticated' ? state.user.role : 'none'}
      </output>
      {state.status === 'authenticated' ? <span>{state.user.phoneNumber}</span> : null}
      <button type="button" onClick={retryBootstrap}>
        Retry
      </button>
      <button type="button" onClick={() => acceptAccessToken('replacement-token')}>
        Accept replacement token
      </button>
    </div>
  );
}

const localeStorageKey = 'learnhub.locale';

beforeEach(() => {
  localStorage.removeItem(localeStorageKey);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(localeStorageKey);
});

describe('SessionProvider', () => {
  it('fails closed as anonymous when token storage throws during bootstrap', async () => {
    const request = vi.fn(async () => profile);
    const store: AccessTokenStore = {
      get: () => {
        throw new Error('Storage access denied');
      },
      set: () => undefined,
      clear: () => undefined,
    };
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous'),
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed without bootstrapping when token persistence throws', async () => {
    const request = vi.fn(async () => profile);
    const clear = vi.fn(() => {
      throw new Error('Storage clear denied');
    });
    const store: AccessTokenStore = {
      get: () => null,
      set: () => {
        throw new Error('Storage write denied');
      },
      clear,
    };
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous'),
    );
    const user = userEvent.setup();
    await act(async () =>
      user.click(screen.getByRole('button', { name: 'Accept replacement token' })),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous'),
    );
    expect(clear).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('becomes anonymous and suppresses a stale bearer when token cleanup throws', async () => {
    let storedToken: string | null = 'expired-token';
    const store: AccessTokenStore = {
      get: () => storedToken,
      set: (token) => {
        storedToken = token;
      },
      clear: () => {
        throw new Error('Storage clear denied');
      },
    };
    const request = vi.fn(async () => {
      throw new ApiError({ kind: 'unauthorized', status: 401, message: 'Expired' });
    });
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous'),
    );
    expect(storedToken).toBe('expired-token');
    const user = userEvent.setup();
    await act(async () => user.click(screen.getByRole('button', { name: 'Retry' })));
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous'),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stays anonymous without a token and does not call /me', async () => {
    const request = vi.fn(async (_options: ApiRequestOptions) => profile);
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={tokenStore(null)}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous'),
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('calls /me once, maps the profile, and authenticates from that authority', async () => {
    const request = vi.fn(async (_options: ApiRequestOptions) => profile);
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={tokenStore('valid-token')}>
        <SessionStatus />
      </SessionProvider>,
    );

    expect(screen.getByLabelText('session status').textContent).toBe('bootstrapping');
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('authenticated'),
    );
    expect(screen.getByText('+10000000000')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ path: '/me' });
    expect((request.mock.calls[0]?.[0] as TestApiRequestOptions).decode).toEqual(
      expect.any(Function),
    );
  });

  it('rejects malformed successful /me data without authenticating or clearing the token', async () => {
    const store = tokenStore('potentially-valid-token');
    const fetchImplementation = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ role: 'student' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    render(
      <SessionProvider
        apiBaseUrl="https://api.learnhub.test"
        fetchImplementation={fetchImplementation}
        tokenStore={store}
      >
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('session status').textContent).toBe('error'));
    expect(screen.getByLabelText('session role').textContent).toBe('none');
    expect(store.value).toBe('potentially-valid-token');
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('does not establish a session from a malformed successful /me payload', async () => {
    const store = tokenStore('malformed-profile-token');
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...profile,
            role: 'owner',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    render(
      <SessionProvider
        apiBaseUrl="https://api.learnhub.test"
        fetchImplementation={fetchImplementation}
        tokenStore={store}
      >
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('session status').textContent).toBe('error'));
    expect(screen.getByLabelText('session role').textContent).toBe('none');
    expect(store.value).toBe('malformed-profile-token');
  });

  it('clears an invalid token and becomes anonymous on /me 401', async () => {
    localStorage.setItem('learnhub.locale', 'ru');
    const store = tokenStore('expired-token');
    const request = vi.fn(async () => {
      throw new ApiError({ kind: 'unauthorized', status: 401, message: 'Expired' });
    });
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous'),
    );
    expect(store.value).toBe(null);
    expect(localStorage.getItem('learnhub.locale')).toBe('ru');
  });

  it('exposes a retryable bootstrap error without discarding a potentially valid token', async () => {
    const store = tokenStore('offline-token');
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ kind: 'offline', status: null, message: 'Network unavailable' }),
      )
      .mockResolvedValueOnce(profile);
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('session status').textContent).toBe('error'));
    expect(store.value).toBe('offline-token');
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Retry' })));
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('authenticated'),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale profile when a replacement token starts a new bootstrap generation', async () => {
    const store = tokenStore('original-token');
    const original = deferred<unknown>();
    const replacement = deferred<unknown>();
    let requestCount = 0;
    const request = vi.fn((_options: ApiRequestOptions) => {
      requestCount += 1;
      return requestCount === 1 ? original.promise : replacement.promise;
    });
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () =>
      userEvent.setup().click(screen.getByRole('button', { name: 'Accept replacement token' })),
    );
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[0]?.[0].dedupeKey).not.toBe(request.mock.calls[1]?.[0].dedupeKey);

    await act(async () => original.resolve(profile));
    expect(screen.getByLabelText('session status').textContent).toBe('bootstrapping');
    expect(screen.getByLabelText('session role').textContent).toBe('none');

    await act(async () => replacement.resolve({ ...profile, role: 'instructor' }));
    await waitFor(() =>
      expect(screen.getByLabelText('session role').textContent).toBe('instructor'),
    );
    expect(store.value).toBe('replacement-token');
  });

  it('invalidates an in-flight bootstrap when retry starts a new generation', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let requestCount = 0;
    const request = vi.fn(() => {
      requestCount += 1;
      return requestCount === 1 ? first.promise : second.promise;
    });
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={tokenStore('retry-token')}>
        <SessionStatus />
      </SessionProvider>,
    );

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Retry' })));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () =>
      first.reject(new ApiError({ kind: 'offline', status: null, message: 'Stale error' })),
    );
    expect(screen.getByLabelText('session status').textContent).toBe('bootstrapping');
    await act(async () => second.resolve(profile));
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('authenticated'),
    );
  });

  it('does not clear storage when an unmounted bootstrap later rejects with 401', async () => {
    const store = tokenStore('still-current-outside-provider');
    const pending = deferred<unknown>();
    const request = vi.fn(() => pending.promise);
    const view = render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <SessionStatus />
      </SessionProvider>,
    );
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () =>
      pending.reject(new ApiError({ kind: 'unauthorized', status: 401, message: 'Late' })),
    );
    expect(store.value).toBe('still-current-outside-provider');
  });
});

describe('session-scoped private query cleanup', () => {
  it('cancels and removes every canonical instructor family while retaining public cache data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const epoch = 'instructor-session-a' as SessionCacheEpoch;
    const privateKeys = [
      instructorCourseQueryKey(epoch, 7),
      instructorLessonQueryKey(epoch, 8),
      instructorCourseCollectionQueryKey(epoch, 1),
      instructorCourseRosterQueryKey(epoch, 7, 1),
    ];
    const publicKey = ['catalog', 'courses', 1] as const;
    const cancellations: AbortSignal[] = [];

    for (const key of privateKeys) {
      void queryClient
        .fetchQuery({
          queryKey: key,
          queryFn: ({ signal }) => {
            cancellations.push(signal);
            return new Promise<never>(() => undefined);
          },
        })
        .catch(() => undefined);
    }
    queryClient.setQueryData(publicKey, { title: 'Public course remains' });
    await waitFor(() => expect(cancellations).toHaveLength(4));

    await cancelAndRemovePrivateQueries(queryClient, epoch);

    expect(cancellations.every((signal) => signal.aborted)).toBe(true);
    expect(privateKeys.map((key) => queryClient.getQueryData(key))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(queryClient.getQueryData(publicKey)).toEqual({ title: 'Public course remains' });
    queryClient.clear();
  });

  it('does not restore late old-session data after lifecycle cleanup', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const epoch = 'instructor-session-old' as SessionCacheEpoch;
    const privateKey = instructorCourseQueryKey(epoch, 7);
    const late = deferred<{ title: string }>();
    const request = queryClient.fetchQuery({
      queryKey: privateKey,
      queryFn: () => late.promise,
    });
    queryClient.setQueryData(['catalog', 'courses', 1], { title: 'Public course remains' });
    await waitFor(() =>
      expect(queryClient.getQueryState(privateKey)?.fetchStatus).toBe('fetching'),
    );

    await cancelAndRemovePrivateQueries(queryClient, epoch);
    late.resolve({ title: 'Old instructor course' });
    await request.catch(() => undefined);

    expect(queryClient.getQueryData(privateKey)).toBeUndefined();
    expect(queryClient.getQueryData(['catalog', 'courses', 1])).toEqual({
      title: 'Public course remains',
    });
    queryClient.clear();
  });
});

function RequestHarness({ mode }: { mode: 'required' | 'optional' }) {
  const { acceptAccessToken, requestOptional, requestRequired, state } = useSession();
  const [result, setResult] = useState('idle');
  return (
    <div>
      <output aria-label="session status">{state.status}</output>
      <output aria-label="request result">{result}</output>
      <button type="button" onClick={() => acceptAccessToken('newer-token')}>
        Accept newer token
      </button>
      <button
        type="button"
        onClick={async () => {
          try {
            const response =
              mode === 'optional'
                ? await requestOptional<{ ok: boolean }>({
                    path: '/courses',
                    dedupeKey: 'public-courses',
                  })
                : await requestRequired<{ ok: boolean }>({
                    path: '/cart',
                    dedupeKey: 'current-cart',
                  });
            setResult(response.ok ? 'success' : 'unexpected');
          } catch {
            setResult('failed');
          }
        }}
      >
        Run request
      </button>
    </div>
  );
}

function OverlappingRequestHarness() {
  const { acceptAccessToken, requestRequired, state } = useSession();
  const [olderResult, setOlderResult] = useState('idle');
  const [newerResult, setNewerResult] = useState('idle');

  function runRequest(setResult: (result: string) => void) {
    void requestRequired<{ source: string }>({
      path: '/cart',
      dedupeKey: 'cart-read',
    }).then(
      (response) => setResult(response.source),
      () => setResult('failed'),
    );
  }

  return (
    <div>
      <output aria-label="session status">{state.status}</output>
      <output aria-label="session role">
        {state.status === 'authenticated' ? state.user.role : 'none'}
      </output>
      <output aria-label="older request result">{olderResult}</output>
      <output aria-label="newer request result">{newerResult}</output>
      <button type="button" onClick={() => runRequest(setOlderResult)}>
        Run older request
      </button>
      <button type="button" onClick={() => acceptAccessToken('newer-token')}>
        Accept newer token
      </button>
      <button type="button" onClick={() => runRequest(setNewerResult)}>
        Run newer request
      </button>
    </div>
  );
}

async function verifyGenerationScopedRealClientOverlap(
  olderResponse: Response,
  expectedOlderResult: string,
) {
  const store = tokenStore('older-token');
  const cartResponses = [deferred<Response>(), deferred<Response>()];
  const cartAuthorization: Array<string | null> = [];
  let cartRequestCount = 0;
  const fetchHandler: typeof fetch = async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (url.endsWith('/me')) {
      return new Response(
        JSON.stringify({
          ...profile,
          role: authorization === 'Bearer newer-token' ? 'instructor' : 'student',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    cartAuthorization.push(authorization);
    const response = cartResponses[cartRequestCount];
    cartRequestCount += 1;
    if (!response) throw new Error('Unexpected cart request');
    return response.promise;
  };
  const fetchImplementation = vi.fn(fetchHandler);

  render(
    <SessionProvider
      apiBaseUrl="https://api.learnhub.test"
      fetchImplementation={fetchImplementation}
      tokenStore={store}
    >
      <OverlappingRequestHarness />
    </SessionProvider>,
  );

  await waitFor(() => expect(screen.getByLabelText('session role').textContent).toBe('student'));
  const user = userEvent.setup();
  await act(async () => user.click(screen.getByRole('button', { name: 'Run older request' })));
  await waitFor(() => expect(cartRequestCount).toBe(1));
  await act(async () => user.click(screen.getByRole('button', { name: 'Accept newer token' })));
  await waitFor(() => expect(screen.getByLabelText('session role').textContent).toBe('instructor'));
  await act(async () => user.click(screen.getByRole('button', { name: 'Run newer request' })));
  await waitFor(() => expect(cartRequestCount).toBe(2));

  await act(async () =>
    cartResponses[1]?.resolve(
      new Response(JSON.stringify({ source: 'new-session' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('newer request result').textContent).toBe('new-session'),
  );

  await act(async () => cartResponses[0]?.resolve(olderResponse));
  await waitFor(() =>
    expect(screen.getByLabelText('older request result').textContent).toBe(expectedOlderResult),
  );
  expect(cartAuthorization).toEqual(['Bearer older-token', 'Bearer newer-token']);
  expect(screen.getByLabelText('session role').textContent).toBe('instructor');
  expect(store.value).toBe('newer-token');
}

describe('session-aware requests', () => {
  it('isolates same-key real-client work across generations when the older request succeeds', async () => {
    await verifyGenerationScopedRealClientOverlap(
      new Response(JSON.stringify({ source: 'old-session' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      'failed',
    );
  });

  it('isolates same-key real-client work and preserves the newer session after an older 401', async () => {
    await verifyGenerationScopedRealClientOverlap(
      new Response(JSON.stringify({ detail: 'Expired' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      }),
      'failed',
    );
  });

  it('clears a required-route session after a 401', async () => {
    localStorage.setItem('learnhub.locale', 'uz');
    const store = tokenStore('valid-then-expired');
    const requiredRequest = deferred<unknown>();
    const request = vi
      .fn()
      .mockResolvedValueOnce(profile)
      .mockReturnValueOnce(requiredRequest.promise);
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <RequestHarness mode="required" />
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('authenticated'),
    );
    const user = userEvent.setup();
    await act(async () => user.click(screen.getByRole('button', { name: 'Run request' })));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () =>
      requiredRequest.reject(
        new ApiError({ kind: 'unauthorized', status: 401, message: 'Expired' }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByLabelText('request result').textContent).toBe('failed');
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous');
    });
    expect(store.value).toBe(null);
    expect(localStorage.getItem('learnhub.locale')).toBe('uz');
  });

  it('ignores a stale required-request 401 after a newer token is accepted', async () => {
    const store = tokenStore('initial-token');
    const requiredRequest = deferred<unknown>();
    const replacementBootstrap = deferred<unknown>();
    let meRequests = 0;
    const request = vi.fn((options: ApiRequestOptions) => {
      if (options.path === '/me') {
        meRequests += 1;
        return meRequests === 1 ? Promise.resolve(profile) : replacementBootstrap.promise;
      }
      return requiredRequest.promise;
    });
    render(
      <SessionProvider client={clientFrom(request)} tokenStore={store}>
        <RequestHarness mode="required" />
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('authenticated'),
    );
    const user = userEvent.setup();
    await act(async () => user.click(screen.getByRole('button', { name: 'Run request' })));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () => user.click(screen.getByRole('button', { name: 'Accept newer token' })));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));

    await act(async () =>
      requiredRequest.reject(
        new ApiError({ kind: 'unauthorized', status: 401, message: 'Stale request' }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('request result').textContent).toBe('failed'));
    expect(screen.getByLabelText('session status').textContent).toBe('bootstrapping');
    expect(store.value).toBe('newer-token');

    await act(async () => replacementBootstrap.resolve({ ...profile, role: 'instructor' }));
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('authenticated'),
    );
    expect(store.value).toBe('newer-token');
  });

  it('uses the real client to remove Authorization before one anonymous optional retry', async () => {
    localStorage.setItem('learnhub.locale', 'en');
    const store = tokenStore('invalid-on-optional');
    const courseAuthorization: Array<string | null> = [];
    const courseResponses = [deferred<Response>(), deferred<Response>()];
    let courseAttempts = 0;
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get('Authorization');
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify(profile), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      courseAttempts += 1;
      courseAuthorization.push(authorization);
      const response = courseResponses[courseAttempts - 1];
      if (!response) throw new Error('Unexpected optional request');
      return response.promise;
    };
    const fetchSpy = vi.fn(fetchImplementation);
    render(
      <SessionProvider
        apiBaseUrl="https://api.learnhub.test"
        fetchImplementation={fetchSpy}
        tokenStore={store}
      >
        <RequestHarness mode="optional" />
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('session status').textContent).toBe('authenticated'),
    );
    const user = userEvent.setup();
    await act(async () => user.click(screen.getByRole('button', { name: 'Run request' })));
    await waitFor(() => expect(courseAttempts).toBe(1));
    await act(async () =>
      courseResponses[0]?.resolve(
        new Response(JSON.stringify({ detail: 'Invalid bearer' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await waitFor(() => expect(courseAttempts).toBe(2));
    await act(async () =>
      courseResponses[1]?.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByLabelText('request result').textContent).toBe('success');
      expect(screen.getByLabelText('session status').textContent).toBe('anonymous');
    });
    expect(store.value).toBe(null);
    expect(localStorage.getItem('learnhub.locale')).toBe('en');
    expect(courseAttempts).toBe(2);
    expect(courseAuthorization).toEqual(['Bearer invalid-on-optional', null]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
