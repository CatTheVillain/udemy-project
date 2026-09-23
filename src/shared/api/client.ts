import { ApiError, normalizeHttpError, normalizeTransportError } from './errors';

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type AuthPolicy = 'public' | 'optional' | 'required';
export type QueryValue = string | number | boolean | null | undefined;
type ApiResponseType = 'json' | 'blob';
export type ApiQuery = Readonly<Record<string, QueryValue>>;

export interface ApiRequestOptions<TBody = unknown, TResponse = unknown> {
  method?: ApiMethod;
  path: string;
  query?: ApiQuery;
  body?: TBody;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  dedupeKey?: string;
  responseType?: ApiResponseType;
  authPolicy?: AuthPolicy;
  decode?: (value: unknown) => TResponse;
}

export interface ApiClientConfig {
  baseUrl?: string;
  fetch?: typeof fetch;
  getAccessToken?: () => string | null | undefined;
  getRequestIdentity?: () => string | null | undefined;
  isRequestIdentityCurrent?: (identity: string) => boolean;
  onUnauthorized?: (error: ApiError) => void;
  maxSafeAttempts?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function staleRequestError(): ApiError {
  return new ApiError({
    kind: 'aborted',
    status: null,
    message: 'Request belongs to a replaced session',
  });
}

export interface ApiClient {
  request<TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, TResponse>,
  ): Promise<TResponse>;
}

export interface ApiBinaryResponse {
  blob: Blob;
  contentType: string | null;
  contentDisposition: string | null;
  filename?: string;
}

function buildUrl(baseUrl: string, path: string, query?: ApiQuery): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${normalizedBase}${normalizedPath}`;

  if (!query) {
    return url;
  }

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });
  const search = params.toString();
  return search === '' ? url : `${url}?${search}`;
}

function shouldRetry(
  method: ApiMethod,
  error: ApiError,
  attempt: number,
  maxAttempts: number,
): boolean {
  if (method !== 'GET' || attempt >= maxAttempts || error.kind === 'aborted') {
    return false;
  }

  return error.kind === 'offline' || error.status === 500;
}

function responseDecoder<TBody, TResponse>(
  options: ApiRequestOptions<TBody, TResponse>,
): ((value: unknown) => TResponse) | undefined {
  return 'decode' in options
    ? (options.decode as ((value: unknown) => TResponse) | undefined)
    : undefined;
}

function normalizeContentType(headerValue: string | null, blob: Blob): string | null {
  const contentType = (headerValue ?? blob.type).split(';', 1)[0].trim().toLowerCase();
  return contentType === '' ? null : contentType;
}

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('');
}

function safeFilename(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const encodedMatch = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition);
  const plainMatch = /filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(contentDisposition);
  const encodedValue = encodedMatch?.[1]?.trim();
  const plainValue = (plainMatch?.[1] ?? plainMatch?.[2])?.trim();
  let candidate = encodedValue ?? plainValue;

  if (!candidate) {
    return undefined;
  }

  if (encodedValue) {
    try {
      candidate = decodeURIComponent(encodedValue);
    } catch {
      return undefined;
    }
  }

  const basename = stripControlCharacters(candidate.split(/[\\/]/).pop() ?? '').trim();
  return basename && basename !== '.' && basename !== '..' ? basename : undefined;
}

async function parseSuccess<TResponse>(
  response: Response,
  responseType: ApiResponseType,
  decode?: (value: unknown) => TResponse,
): Promise<TResponse> {
  if (response.status === 204) {
    if (responseType === 'json' && decode) return decode(undefined);
    return undefined as TResponse;
  }

  if (responseType === 'blob') {
    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    const binaryResponse: ApiBinaryResponse = {
      blob,
      contentType: normalizeContentType(response.headers.get('Content-Type'), blob),
      contentDisposition,
      filename: safeFilename(contentDisposition),
    };
    return binaryResponse as TResponse;
  }

  const value: unknown = await response.json();
  return decode ? decode(value) : (value as TResponse);
}

export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  const maxSafeAttempts = Math.max(1, config.maxSafeAttempts ?? 2);
  const retryDelayMs = Math.max(0, config.retryDelayMs ?? 100);
  const sleep =
    config.sleep ??
    ((milliseconds: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  const inFlight = new Map<string, Promise<unknown>>();

  function assertRequestIdentity(identity: string | null): void {
    if (
      identity !== null &&
      config.isRequestIdentityCurrent !== undefined &&
      !config.isRequestIdentityCurrent(identity)
    ) {
      throw staleRequestError();
    }
  }

  async function execute<TResponse, TBody>(
    options: ApiRequestOptions<TBody, TResponse>,
    token: string | null | undefined,
    identity: string | null,
  ): Promise<TResponse> {
    const method = options.method ?? 'GET';
    const url = buildUrl(config.baseUrl ?? '', options.path, options.query);
    const headers = new Headers(options.headers);
    if (options.authPolicy === 'public') {
      headers.delete('Authorization');
    }
    headers.set('Accept', options.responseType === 'blob' ? '*/*' : 'application/json');

    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body !== undefined && !isFormData) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let attempt = 0;
    while (attempt < maxSafeAttempts) {
      attempt += 1;
      try {
        assertRequestIdentity(identity);
        const response = await fetchImplementation(url, {
          method,
          headers,
          body:
            options.body === undefined
              ? undefined
              : isFormData
                ? (options.body as BodyInit)
                : JSON.stringify(options.body),
          signal: options.signal,
        });

        if (!response.ok) {
          const apiError = await normalizeHttpError(response);
          assertRequestIdentity(identity);
          if (apiError.status === 401) {
            try {
              config.onUnauthorized?.(apiError);
            } catch {
              // Session cleanup is observational and must not replace the transport error.
            }
          }
          if (shouldRetry(method, apiError, attempt, maxSafeAttempts)) {
            await sleep(retryDelayMs);
            continue;
          }
          throw apiError;
        }

        let parsed: TResponse;
        try {
          parsed = await parseSuccess<TResponse>(
            response,
            options.responseType ?? 'json',
            responseDecoder(options),
          );
        } catch (error) {
          throw new ApiError({
            kind: 'invalid_response',
            status: response.status,
            message: 'Server returned an invalid success response',
            cause: error,
          });
        }
        assertRequestIdentity(identity);
        return parsed;
      } catch (error) {
        const apiError = normalizeTransportError(error);
        assertRequestIdentity(identity);
        if (shouldRetry(method, apiError, attempt, maxSafeAttempts)) {
          await sleep(retryDelayMs);
          continue;
        }
        throw apiError;
      }
    }

    throw new ApiError({ kind: 'offline', status: null, message: 'Unable to reach the server' });
  }

  return {
    request<TResponse, TBody = unknown>(
      options: ApiRequestOptions<TBody, TResponse>,
    ): Promise<TResponse> {
      const token = options.authPolicy === 'public' ? null : config.getAccessToken?.();
      const identity =
        options.authPolicy === 'public' ? null : (config.getRequestIdentity?.() ?? null);
      if (!options.dedupeKey) {
        return execute<TResponse, TBody>(options, token, identity);
      }

      const method = options.method ?? 'GET';
      const url = buildUrl(config.baseUrl ?? '', options.path, options.query);
      const key = `${method}:${url}:${identity ?? `token:${token ?? 'anonymous'}`}:${options.dedupeKey}`;
      const existing = inFlight.get(key);
      if (existing) {
        return existing as Promise<TResponse>;
      }

      const request = execute<TResponse, TBody>(options, token, identity).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, request);
      return request;
    },
  };
}
