import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  decodeUserProfileDto,
  mapUserProfileDto,
  type UserProfile,
  type UserProfileDto,
} from '@entities/user';
import {
  ApiError,
  createApiClient,
  type ApiClient,
  type ApiRequestOptions,
  type SessionCacheEpoch,
} from '@shared/api';
import {
  createBrowserAccessTokenStore,
  createExceptionSafeAccessTokenStore,
  isAccessTokenStorageEvent,
  type AccessTokenStore,
} from './storage';

export type { SessionCacheEpoch } from '@shared/api';

interface BootstrappingSessionState {
  readonly status: 'bootstrapping';
}
interface AnonymousSessionState {
  readonly status: 'anonymous';
}
interface AuthenticatedSessionState {
  readonly status: 'authenticated';
  readonly user: UserProfile;
}
interface SessionErrorState {
  readonly status: 'error';
}

export type SessionState =
  BootstrappingSessionState | AnonymousSessionState | AuthenticatedSessionState | SessionErrorState;

declare const sessionIdentityBrand: unique symbol;

/**
 * Opaque in-memory owner for work that must not continue under a replaced token.
 * It intentionally contains neither the token nor profile data.
 */
export type SessionIdentity = string & { readonly [sessionIdentityBrand]: 'SessionIdentity' };

export interface SessionContextValue {
  state: SessionState;
  cacheEpoch?: SessionCacheEpoch | null;
  captureSessionIdentity?(): SessionIdentity;
  isSessionIdentityCurrent?(identity: SessionIdentity): boolean;
  retryBootstrap(): void;
  acceptAccessToken(token: string): void;
  clearSession(): void;
  requestPublic<TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
  ): Promise<TResponse>;
  requestRequired<TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
  ): Promise<TResponse>;
  requestOptional<TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
  ): Promise<TResponse>;
}

interface SessionIdentityOwner {
  captureSessionIdentity(): SessionIdentity;
  isSessionIdentityCurrent(identity: SessionIdentity): boolean;
}

type SessionProviderContextValue = SessionContextValue & SessionIdentityOwner;

interface SessionProviderProps {
  children: ReactNode;
  client?: ApiClient;
  tokenStore?: AccessTokenStore;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
}

const SessionContext = createContext<SessionProviderContextValue | null>(null);
SessionContext.displayName = 'SessionContext';
let sessionCacheEpochSequence = 0;

function createSessionCacheEpoch(): SessionCacheEpoch {
  sessionCacheEpochSequence += 1;
  return `session-cache-${sessionCacheEpochSequence}` as SessionCacheEpoch;
}

function createSessionIdentity(generation: number): SessionIdentity {
  return `session-identity-${generation}` as SessionIdentity;
}

function forSessionGeneration<TBody, TResponse>(
  options: ApiRequestOptions<TBody, TResponse>,
  generation: number,
): ApiRequestOptions<TBody, TResponse> {
  if (!options.dedupeKey) return options;
  return {
    ...options,
    dedupeKey: `session:${generation}:${options.dedupeKey}`,
  };
}

export function SessionProvider({
  children,
  client: suppliedClient,
  tokenStore: suppliedTokenStore,
  apiBaseUrl = '',
  fetchImplementation,
}: SessionProviderProps) {
  const browserTokenStoreRef = useRef<AccessTokenStore | null>(null);
  if (!suppliedTokenStore && !browserTokenStoreRef.current) {
    browserTokenStoreRef.current = createBrowserAccessTokenStore();
  }
  const sourceTokenStore = suppliedTokenStore ?? browserTokenStoreRef.current;
  const tokenStore = useMemo(
    () => createExceptionSafeAccessTokenStore(sourceTokenStore as AccessTokenStore),
    [sourceTokenStore],
  );
  const [state, setState] = useState<SessionState>({ status: 'bootstrapping' });
  const [cacheEpoch, setCacheEpoch] = useState<SessionCacheEpoch | null>(null);
  const [bootstrapSequence, setBootstrapSequence] = useState(0);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const sessionIdentityRef = useRef<SessionIdentity>(createSessionIdentity(generationRef.current));
  const sessionTokenRef = useRef<string | null>(tokenStore.get());

  const transitionToToken = useCallback((token: string | null) => {
    generationRef.current += 1;
    if (sessionTokenRef.current !== token) {
      sessionTokenRef.current = token;
      sessionIdentityRef.current = createSessionIdentity(generationRef.current);
    }
    if (!mountedRef.current) return;

    setCacheEpoch(null);
    if (!token) {
      setState({ status: 'anonymous' });
      return;
    }

    setState({ status: 'bootstrapping' });
    setBootstrapSequence((sequence) => sequence + 1);
  }, []);

  const captureSessionIdentity = useCallback(() => sessionIdentityRef.current, []);

  const isSessionIdentityCurrent = useCallback(
    (identity: SessionIdentity) =>
      sessionIdentityRef.current === identity && tokenStore.get() === sessionTokenRef.current,
    [tokenStore],
  );

  const isCurrentSnapshot = useCallback(
    (generation: number, token: string | null) =>
      mountedRef.current && generationRef.current === generation && tokenStore.get() === token,
    [tokenStore],
  );

  const reconcileReplacedToken = useCallback(
    (generation: number, token: string | null) => {
      if (
        !mountedRef.current ||
        generationRef.current !== generation ||
        tokenStore.get() === token
      ) {
        return false;
      }
      transitionToToken(tokenStore.get());
      return true;
    },
    [tokenStore, transitionToToken],
  );

  const clearSession = useCallback(() => {
    tokenStore.clear();
    transitionToToken(null);
  }, [tokenStore, transitionToToken]);

  const clearSessionForSnapshot = useCallback(
    (generation: number, token: string | null) => {
      if (!isCurrentSnapshot(generation, token)) return false;
      tokenStore.clear();
      transitionToToken(null);
      return true;
    },
    [isCurrentSnapshot, tokenStore, transitionToToken],
  );

  const ownedClient = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl,
        fetch: fetchImplementation,
        getAccessToken: () => tokenStore.get(),
        getRequestIdentity: () => String(generationRef.current),
        isRequestIdentityCurrent: (identity) =>
          mountedRef.current && String(generationRef.current) === identity,
      }),
    [apiBaseUrl, fetchImplementation, tokenStore],
  );
  const client = suppliedClient ?? ownedClient;

  const bootstrap = useCallback(async () => {
    const generation = generationRef.current;
    const token = tokenStore.get();
    if (!token) {
      if (isCurrentSnapshot(generation, token)) {
        setCacheEpoch(null);
        setState({ status: 'anonymous' });
      }
      return;
    }

    if (isCurrentSnapshot(generation, token)) setState({ status: 'bootstrapping' });
    try {
      const profile = await client.request<UserProfileDto>(
        forSessionGeneration(
          {
            path: '/me',
            dedupeKey: 'bootstrap',
            decode: decodeUserProfileDto,
          },
          generation,
        ),
      );
      if (isCurrentSnapshot(generation, token)) {
        setCacheEpoch(createSessionCacheEpoch());
        setState({ status: 'authenticated', user: mapUserProfileDto(profile) });
      } else reconcileReplacedToken(generation, token);
    } catch (error) {
      if (!isCurrentSnapshot(generation, token)) {
        reconcileReplacedToken(generation, token);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        clearSessionForSnapshot(generation, token);
      } else {
        setState({ status: 'error' });
      }
    }
  }, [clearSessionForSnapshot, client, isCurrentSnapshot, reconcileReplacedToken, tokenStore]);

  useEffect(() => {
    mountedRef.current = true;
    void bootstrap();
    return () => {
      mountedRef.current = false;
    };
  }, [bootstrap, bootstrapSequence]);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (!isAccessTokenStorageEvent(event)) return;
      transitionToToken(tokenStore.get());
    };

    globalThis.addEventListener?.('storage', handleStorageChange);
    return () => globalThis.removeEventListener?.('storage', handleStorageChange);
  }, [tokenStore, transitionToToken]);

  const retryBootstrap = useCallback(() => {
    transitionToToken(tokenStore.get());
  }, [tokenStore, transitionToToken]);

  const acceptAccessToken = useCallback(
    (token: string) => {
      if (!tokenStore.set(token)) {
        transitionToToken(null);
        return;
      }
      transitionToToken(tokenStore.get());
    },
    [tokenStore, transitionToToken],
  );

  const requestRequired = useCallback(
    async <TResponse, TBody = unknown>(
      options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
    ): Promise<TResponse> => {
      const generation = generationRef.current;
      const token = tokenStore.get();
      try {
        const response = await client.request<TResponse, TBody>(
          forSessionGeneration({ ...options, authPolicy: 'required' }, generation),
        );
        if (!isCurrentSnapshot(generation, token)) {
          reconcileReplacedToken(generation, token);
          throw new ApiError({
            kind: 'aborted',
            status: null,
            message: 'Request belongs to a replaced session',
          });
        }
        return response;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearSessionForSnapshot(generation, token);
        }
        throw error;
      }
    },
    [clearSessionForSnapshot, client, isCurrentSnapshot, reconcileReplacedToken, tokenStore],
  );

  const requestOptional = useCallback(
    async <TResponse, TBody = unknown>(
      options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
    ): Promise<TResponse> => {
      const generation = generationRef.current;
      const token = tokenStore.get();
      try {
        const response = await client.request<TResponse, TBody>(
          forSessionGeneration({ ...options, authPolicy: 'optional' }, generation),
        );
        if (!isCurrentSnapshot(generation, token)) {
          reconcileReplacedToken(generation, token);
          throw new ApiError({
            kind: 'aborted',
            status: null,
            message: 'Request belongs to a replaced session',
          });
        }
        return response;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401 || !token) {
          throw error;
        }
        if (!clearSessionForSnapshot(generation, token)) throw error;
        return client.request<TResponse, TBody>(
          forSessionGeneration({ ...options, authPolicy: 'public' }, generationRef.current),
        );
      }
    },
    [clearSessionForSnapshot, client, isCurrentSnapshot, reconcileReplacedToken, tokenStore],
  );

  const requestPublic = useCallback(
    <TResponse, TBody = unknown>(
      options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
    ): Promise<TResponse> => client.request<TResponse, TBody>({ ...options, authPolicy: 'public' }),
    [client],
  );

  const value = useMemo<SessionProviderContextValue>(
    () => ({
      state,
      cacheEpoch,
      captureSessionIdentity,
      isSessionIdentityCurrent,
      retryBootstrap,
      acceptAccessToken,
      clearSession,
      requestPublic,
      requestRequired,
      requestOptional,
    }),
    [
      acceptAccessToken,
      cacheEpoch,
      captureSessionIdentity,
      clearSession,
      isSessionIdentityCurrent,
      requestOptional,
      requestPublic,
      requestRequired,
      retryBootstrap,
      state,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
}
