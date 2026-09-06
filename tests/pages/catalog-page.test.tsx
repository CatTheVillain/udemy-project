// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CatalogPage } from '../../src/pages/catalog-page';
import { formatCatalogPrice } from '../../src/pages/catalog-page/course-card-presentation';
import { SortControl } from '../../src/pages/catalog-page/SortControl';
import { createAppQueryClient } from '../../src/app/query';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
} from '../../src/features/auth-session';
import { ApiError, type ApiClient, type ApiRequestOptions } from '../../src/shared/api';
import { LocaleProvider, useLocale } from '../../src/shared/locale';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('catalog locale-native price presentation', () => {
  it('uses the active locale when deriving a valid currency marker', () => {
    expect(formatCatalogPrice('9.99', 'USD', 'en-US')).toBe('$9.99');
    expect(formatCatalogPrice('9.99', 'USD', 'ru-RU')).not.toBe('$9.99');
  });

  it('localizes the unavailable fallback for invalid API price values', () => {
    expect(formatCatalogPrice('invalid', 'USD', 'ru-RU')).toBe('Цена недоступна');
  });
});

describe('catalog sort locale presentation', () => {
  it('uses the interpolated catalog resource rather than a diagnostic fallback', () => {
    render(
      <LocaleProvider initialLocale="en">
        <SortControl value="created_at" onChange={() => {}} onPointerOptionCommit={() => {}} />
      </LocaleProvider>,
    );

    expect(screen.getByRole('button', { name: 'Sort by: Oldest' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Translation unavailable/i })).toBeNull();
  });
});

const catalogItem = {
  id: 7,
  title: 'React',
  description: null,
  price: '9.99',
  currency: 'USD',
  published_at: null,
  instructor: { id: 1, name: 'Ada', surname: 'Lovelace' },
  lessons: [] as Array<{ id: number; title: string }>,
};

interface CatalogPaginationFixture {
  items?: Array<Omit<typeof catalogItem, 'published_at'> & { published_at: string | null }>;
  total?: number;
  page?: number;
  pages?: number;
  has_next?: boolean;
  has_previous?: boolean;
}

function response(overrides: CatalogPaginationFixture = {}) {
  return {
    items: [catalogItem],
    page: 1,
    page_size: 20,
    total: 1,
    pages: 1,
    has_next: false,
    has_previous: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function tokenStore(token: string | null = null): AccessTokenStore {
  return { get: () => token, set: () => true, clear: () => undefined };
}

function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Forward
      </button>
      <output aria-label="catalog location">{`${location.pathname}${location.search}${location.hash}`}</output>
    </>
  );
}

function CatalogSessionStatus() {
  const { state } = useSession();
  return <output aria-label="catalog session status">{state.status}</output>;
}

function CatalogSessionSwitchControl() {
  const { acceptAccessToken, state } = useSession();
  return (
    <>
      <button type="button" onClick={() => acceptAccessToken('second-token')}>
        Switch catalog session
      </button>
      <output aria-label="catalog session status">{state.status}</output>
    </>
  );
}

function CatalogLocaleSwitchControl() {
  const { setLocale } = useLocale();
  return (
    <>
      <button type="button" onClick={() => setLocale('ru')}>
        Use Russian catalog locale
      </button>
      <button type="button" onClick={() => setLocale('uz')}>
        Use Uzbek catalog locale
      </button>
    </>
  );
}

interface CatalogRenderOptions {
  queryClient?: QueryClient;
  tokenStore?: AccessTokenStore;
  withSessionSwitchControl?: boolean;
  withLocaleSwitchControl?: boolean;
  enableRatingSummary?: boolean;
  locale?: 'en' | 'ru' | 'uz';
}

function renderCatalog(
  request: ApiClient['request'],
  initialEntries: string[],
  initialIndex = initialEntries.length - 1,
  token: string | null = null,
  options: CatalogRenderOptions = {},
) {
  if (!options.enableRatingSummary) {
    class NonIntersectingObserver {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', NonIntersectingObserver);
  }
  const requestWithMaximumPriceFixture: ApiClient['request'] = async <TResponse, TBody = unknown>(
    requestOptions: ApiRequestOptions<TBody, TResponse>,
  ): Promise<TResponse> => {
    const query = requestOptions.query as
      | { readonly page?: number; readonly page_size?: number; readonly sort?: string }
      | undefined;
    if (
      requestOptions.path === '/courses' &&
      query?.page === 1 &&
      query.page_size === 1 &&
      query.sort === '-price'
    ) {
      return response() as TResponse;
    }
    return request<TResponse, TBody>(requestOptions);
  };
  return render(
    <QueryClientProvider client={options.queryClient ?? createAppQueryClient()}>
      <LocaleProvider initialLocale={options.locale ?? 'en'}>
        <SessionProvider
          client={{ request: requestWithMaximumPriceFixture }}
          tokenStore={options.tokenStore ?? tokenStore(token)}
        >
          <MemoryRouter
            initialEntries={initialEntries}
            initialIndex={initialIndex}
            future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          >
            <main id="main-content" tabIndex={-1}>
              <CatalogPage />
            </main>
            <HistoryControls />
            {options.withSessionSwitchControl ? <CatalogSessionSwitchControl /> : null}
            {options.withLocaleSwitchControl ? <CatalogLocaleSwitchControl /> : null}
          </MemoryRouter>
        </SessionProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('CatalogPage public URL and pagination behavior', () => {
  it.each([
    ['en', '4.5', 'Reviews: 2'],
    ['ru', '4,5', 'Отзывы: 2'],
    ['uz', '4,5', 'Sharhlar: 2'],
  ] as const)(
    'derives the %s course-card rating from API-037 data without adding a control',
    async (locale, average, reviewCount) => {
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        const value =
          options.path === '/courses/7/reviews'
            ? {
                items: [
                  {
                    id: 101,
                    course_id: 7,
                    user_id: 10,
                    rating: 4,
                    comment: null,
                    created_at: '2026-08-31T00:00:00Z',
                    updated_at: '2026-08-31T00:00:00Z',
                  },
                  {
                    id: 102,
                    course_id: 7,
                    user_id: 11,
                    rating: 5,
                    comment: null,
                    created_at: '2026-08-31T00:00:00Z',
                    updated_at: '2026-08-31T00:00:00Z',
                  },
                ],
                page: 1,
                page_size: 20,
                total: 2,
                pages: 1,
                has_next: false,
                has_previous: false,
              }
            : response({ items: [{ ...catalogItem, published_at: '2026-07-01T00:00:00Z' }] });
        return options.decode ? options.decode(value) : (value as TResponse);
      };

      renderCatalog(request, ['/'], 0, null, { locale, enableRatingSummary: true });

      await screen.findByText(average);
      const courseLink = screen.getByRole('link', { name: 'React' });
      const ratingRow = courseLink.querySelector<HTMLElement>('[data-part="course-card-rating"]');
      expect(courseLink.getAttribute('aria-describedby')?.split(' ')).toContain(ratingRow?.id);
      expect(ratingRow?.textContent).toContain(average);
      expect(ratingRow?.textContent).toContain(reviewCount);
      expect(within(courseLink).queryByRole('button')).toBeNull();
      expect(courseLink.querySelector('[aria-hidden="true"]')?.textContent).toContain('★');
    },
  );

  it('renders the admitted Catalog UI copy in Russian without changing course data', async () => {
    const request: ApiClient['request'] = async <TResponse,>() =>
      response({
        items: [
          {
            ...catalogItem,
            title: 'React Fundamentals',
            lessons: [
              { id: 1, title: 'Intro' },
              { id: 2, title: 'State' },
              { id: 3, title: 'Hooks' },
            ],
            price: '0.00',
            currency: 'UZS',
            published_at: '2026-07-01T00:00:00Z',
          },
          {
            ...catalogItem,
            id: 8,
            title: 'TypeScript Architecture',
            lessons: [{ id: 4, title: 'Intro' }],
            price: '9.99',
            currency: 'USD',
            published_at: '2026-07-02T00:00:00Z',
          },
        ],
        total: 2,
      }) as TResponse;

    renderCatalog(request, ['/'], 0, null, { locale: 'ru' });

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Освойте навыки, которые формируют будущее',
      }),
    ).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Найдено 2 курса' })).toBeTruthy();
    expect(screen.queryByText('Сортировка:')).toBeNull();
    expect(screen.getByRole('button', { name: 'Цена' })).toBeTruthy();
    expect(screen.getByText('БЕСПЛАТНО')).toBeTruthy();
    expect(screen.getAllByText('Подробнее')).toHaveLength(2);
    expect(screen.getByText('3 доступных урока')).toBeTruthy();
    expect(screen.getByRole('link', { name: /React Fundamentals/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Записаться' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'В корзину' })).toBeTruthy();
  });

  it('uses Uzbek count-aware Catalog labels while keeping course titles unchanged', async () => {
    const request: ApiClient['request'] = async <TResponse,>() =>
      response({
        items: [
          {
            ...catalogItem,
            title: 'FastAPI Fundamentals',
            lessons: [
              { id: 1, title: 'Intro' },
              { id: 2, title: 'API' },
            ],
            price: '0',
            published_at: '2026-07-01T00:00:00Z',
          },
        ],
      }) as TResponse;

    renderCatalog(request, ['/'], 0, null, { locale: 'uz' });

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Kelajakni shakllantiruvchi ko‘nikmalarni egallang',
      }),
    ).toBeTruthy();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Topildi 1 ta kurs' }),
    ).toBeTruthy();
    expect(screen.queryByText('Saralash:')).toBeNull();
    expect(screen.getByRole('button', { name: 'Narx' })).toBeTruthy();
    expect(screen.getByText('BEPUL')).toBeTruthy();
    expect(screen.getByText('2 ta dars mavjud')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bepul yozilish' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'FastAPI Fundamentals' })).toBeTruthy();
  });

  it('keeps authenticated API-008 requests public and preserves the session after a catalog 401', async () => {
    let storedToken: string | null = 'stored-access-token';
    const clearToken = vi.fn(() => {
      storedToken = null;
    });
    const store: AccessTokenStore = {
      get: () => storedToken,
      set: (token) => {
        storedToken = token;
      },
      clear: clearToken,
    };
    const requestHeaders = new Map<string, Headers[]>();
    const fetchImplementation: typeof fetch = async (input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const pathname = new URL(requestUrl).pathname;
      const headers = requestHeaders.get(pathname) ?? [];
      headers.push(new Headers(init?.headers));
      requestHeaders.set(pathname, headers);

      if (pathname === '/me') {
        return new Response(
          JSON.stringify({
            email: 'learner@example.test',
            name: 'Ada',
            surname: 'Lovelace',
            role: 'student',
            birthday: null,
            phone_number: null,
            created_at: '2026-07-24T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (pathname === '/courses') {
        return new Response(JSON.stringify({ detail: 'Catalog unavailable' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    };
    const fetchSpy = vi.fn(fetchImplementation);

    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <SessionProvider
          apiBaseUrl="https://api.learnhub.test"
          fetchImplementation={fetchSpy}
          tokenStore={store}
        >
          <MemoryRouter
            initialEntries={['/']}
            future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          >
            <CatalogPage />
            <CatalogSessionStatus />
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('catalog session status').textContent).toBe('authenticated'),
    );
    expect(await screen.findByText('We could not load courses')).toBeTruthy();
    expect(requestHeaders.get('/me')?.[0]?.get('Authorization')).toBe('Bearer stored-access-token');
    const catalogRequestHeaders = requestHeaders.get('/courses') ?? [];
    expect(catalogRequestHeaders).toHaveLength(3);
    for (const headers of catalogRequestHeaders) expect(headers.get('Authorization')).toBeNull();
    expect(clearToken).not.toHaveBeenCalled();
    expect(storedToken).toBe('stored-access-token');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('renders the hero as one semantic heading with decorative background content kept out of the accessibility tree', async () => {
    const request: ApiClient['request'] = async <TResponse,>() => response() as TResponse;
    renderCatalog(request, ['/']);

    await screen.findByRole('link', { name: 'React' });
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Master the Skills Shaping the Future',
    });
    expect(heading.textContent).toBe('Master the Skills Shaping the Future');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByText(
        'Browse courses crafted by industry experts. Advance your career in technology, design, business, and leadership.',
      ),
    ).toBeTruthy();
    expect(document.querySelector('[data-part="catalog-hero"] img')).toBeNull();
  });

  it('shares student preflight across cards and submits one paid action for repeated activation', async () => {
    const requestPaths: string[] = [];
    let cartItemCount = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      requestPaths.push(options.path);
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? {
                items: [
                  { ...catalogItem, published_at: '2026-07-27T00:00:00Z' },
                  {
                    ...catalogItem,
                    id: 8,
                    title: 'TypeScript',
                    published_at: '2026-07-27T00:00:00Z',
                  },
                ],
                page: 1,
                page_size: 20,
                total: 2,
                pages: 1,
                has_next: false,
                has_previous: false,
              }
            : options.path === '/cart'
              ? {
                  id: 1,
                  items: cartItemCount
                    ? [
                        {
                          id: 1,
                          course_id: 7,
                          added_at: '2026-07-27T00:00:00Z',
                          course: { id: 7, title: 'React', price: '9.99', currency: 'USD' },
                        },
                      ]
                    : [],
                  total_price: cartItemCount ? '9.99' : '0.00',
                  currency: 'USD',
                  item_count: cartItemCount,
                }
              : options.path === '/enrollments/my'
                ? {
                    items: [],
                    page: 1,
                    page_size: 100,
                    total: 0,
                    pages: 0,
                    has_next: false,
                    has_previous: false,
                  }
                : options.path === '/cart/items'
                  ? (() => {
                      cartItemCount = 1;
                      return {
                        id: 1,
                        course_id: 7,
                        added_at: '2026-07-27T00:00:00Z',
                        course: { id: 7, title: 'React', price: '9.99', currency: 'USD' },
                      };
                    })()
                  : undefined;
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, 'student-token');

    await waitFor(() => expect(requestPaths.filter((path) => path === '/cart')).toHaveLength(1));
    await waitFor(() =>
      expect(requestPaths.filter((path) => path === '/enrollments/my')).toHaveLength(1),
    );
    const [action] = await screen.findAllByRole('button', { name: 'Add to cart' });
    expect(requestPaths.filter((path) => path === '/cart')).toHaveLength(1);
    expect(requestPaths.filter((path) => path === '/enrollments/my')).toHaveLength(1);
    await act(async () => {
      await user.dblClick(action);
    });
    await screen.findByRole('button', { name: 'Remove' });
    expect(requestPaths.filter((path) => path === '/cart/items')).toHaveLength(1);
  });

  it('keeps a confirmed cart removal visibly pending and sends one DELETE for repeated activation', async () => {
    const removal = deferred<undefined>();
    let cartContainsCourse = true;
    let removeRequests = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/cart/items/7') {
        removeRequests += 1;
        const value = await removal.promise;
        return options.decode ? options.decode(value) : (value as TResponse);
      }
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? response({ items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }] })
            : options.path === '/cart'
              ? {
                  id: 1,
                  items: cartContainsCourse
                    ? [
                        {
                          id: 1,
                          course_id: 7,
                          added_at: '2026-07-27T00:00:00Z',
                          course: { id: 7, title: 'React', price: '9.99', currency: 'USD' },
                        },
                      ]
                    : [],
                  total_price: cartContainsCourse ? '9.99' : '0.00',
                  currency: 'USD',
                  item_count: cartContainsCourse ? 1 : 0,
                }
              : options.path === '/enrollments/my'
                ? {
                    items: [],
                    page: 1,
                    page_size: 100,
                    total: 0,
                    pages: 0,
                    has_next: false,
                    has_previous: false,
                  }
                : undefined;
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, 'student-token');

    const remove = await screen.findByRole('button', { name: 'Remove' });
    await act(async () => {
      await user.dblClick(remove);
    });
    const pending = await screen.findByRole('button', { name: 'Removing…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect(removeRequests).toBe(1);

    cartContainsCourse = false;
    await act(async () => {
      removal.resolve(undefined);
    });
    await screen.findByRole('button', { name: 'Add to cart' });
  });

  it.each([
    [
      'a paid cart conflict',
      '9.99',
      '/cart/items',
      'Course already in cart',
      'Remove',
      '/cart',
      false,
    ],
    [
      'a free enrollment conflict',
      '0.00',
      '/enrollments',
      'Already enrolled in this course',
      'Enrolled',
      '/enrollments/my',
      true,
    ],
  ])(
    'maps %s to its authoritative terminal owner without exposing server detail',
    async (
      _scenario,
      price,
      mutationPath,
      conflictMessage,
      expectedAction,
      authoritativePath,
      expectedStatus,
    ) => {
      const requestPaths: string[] = [];
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        requestPaths.push(options.path);
        if (options.path === '/cart/items' || options.path === '/enrollments') {
          throw new ApiError({ kind: 'conflict', status: 409, message: conflictMessage });
        }
        const value =
          options.path === '/me'
            ? {
                email: 'student@example.test',
                name: 'Student',
                surname: 'One',
                role: 'student',
                birthday: null,
                phone_number: null,
                created_at: '2026-01-01T00:00:00Z',
              }
            : options.path === '/courses'
              ? {
                  items: [{ ...catalogItem, price, published_at: '2026-07-27T00:00:00Z' }],
                  page: 1,
                  page_size: 20,
                  total: 1,
                  pages: 1,
                  has_next: false,
                  has_previous: false,
                }
              : options.path === '/cart'
                ? { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 }
                : {
                    items: [],
                    page: 1,
                    page_size: 100,
                    total: 0,
                    pages: 0,
                    has_next: false,
                    has_previous: false,
                  };
        return options.decode ? options.decode(value) : (value as TResponse);
      };
      const user = userEvent.setup();
      renderCatalog(request, ['/'], 0, 'student-token');

      const action = await screen.findByRole('button', {
        name: price === '0.00' ? 'Enroll free' : 'Add to cart',
      });
      await act(async () => {
        await user.dblClick(action);
      });

      if (expectedStatus) {
        expect(
          (await screen.findByText(expectedAction)).closest(
            '[data-part="course-card-action-status"]',
          ),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: expectedAction })).toBeNull();
      } else {
        const terminalAction = await screen.findByRole('button', { name: expectedAction });
        expect(terminalAction).toBeTruthy();
        if (expectedAction === 'Remove') {
          expect((terminalAction as HTMLButtonElement).disabled).toBe(true);
          expect(terminalAction.getAttribute('aria-busy')).toBe('true');
          expect(screen.queryByRole('button', { name: 'Already in cart' })).toBeNull();
        }
      }
      expect(requestPaths.filter((path) => path === mutationPath)).toHaveLength(1);
      expect(requestPaths.filter((path) => path === authoritativePath)).toHaveLength(2);
      const nonAuthoritativePath = authoritativePath === '/cart' ? '/enrollments/my' : '/cart';
      expect(requestPaths.filter((path) => path === nonAuthoritativePath)).toHaveLength(1);
      expect(screen.queryByText(conflictMessage)).toBeNull();
    },
  );

  it('unlocks a known Cart conflict after authoritative membership and permits one removal', async () => {
    const requestPaths: string[] = [];
    let cartRequests = 0;
    let removed = false;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      requestPaths.push(`${options.method ?? 'GET'} ${options.path}`);
      if (options.path === '/cart/items') {
        throw new ApiError({ kind: 'conflict', status: 409, message: 'Course already in cart' });
      }
      if (options.path === '/cart/items/7') {
        removed = true;
        return undefined as TResponse;
      }
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? response({ items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }] })
            : options.path === '/cart'
              ? (() => {
                  cartRequests += 1;
                  const containsCourse = cartRequests >= 2 && !removed;
                  return {
                    id: 1,
                    items: containsCourse
                      ? [
                          {
                            id: 1,
                            course_id: 7,
                            added_at: '2026-07-27T00:00:00Z',
                            course: { id: 7, title: 'React', price: '9.99', currency: 'USD' },
                          },
                        ]
                      : [],
                    total_price: containsCourse ? '9.99' : '0.00',
                    currency: 'USD',
                    item_count: containsCourse ? 1 : 0,
                  };
                })()
              : {
                  items: [],
                  page: 1,
                  page_size: 100,
                  total: 0,
                  pages: 0,
                  has_next: false,
                  has_previous: false,
                };
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, 'student-token');

    const addToCart = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await user.click(addToCart);
    });
    const remove = await screen.findByRole('button', { name: 'Remove' });
    expect((remove as HTMLButtonElement).disabled).toBe(false);
    expect(remove.getAttribute('aria-busy')).toBeNull();
    await act(async () => {
      await user.dblClick(remove);
    });
    await screen.findByRole('button', { name: 'Add to cart' });

    expect(requestPaths.filter((path) => path === 'POST /cart/items')).toHaveLength(1);
    expect(requestPaths.filter((path) => path === 'DELETE /cart/items/7')).toHaveLength(1);
  });

  it('clears a generic conflict override only after both authoritative preflight owners settle', async () => {
    const requestPaths: string[] = [];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      requestPaths.push(options.path);
      if (options.path === '/cart/items') {
        throw new ApiError({ kind: 'conflict', status: 409, message: 'Unexpected conflict' });
      }
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? {
                items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }],
                page: 1,
                page_size: 20,
                total: 1,
                pages: 1,
                has_next: false,
                has_previous: false,
              }
            : options.path === '/cart'
              ? { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 }
              : {
                  items: [],
                  page: 1,
                  page_size: 100,
                  total: 0,
                  pages: 0,
                  has_next: false,
                  has_previous: false,
                };
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, 'student-token');

    const initialAction = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await user.click(initialAction);
    });

    expect(await screen.findByRole('button', { name: 'Add to cart' })).toBeTruthy();
    expect(requestPaths.filter((path) => path === '/cart')).toHaveLength(2);
    expect(requestPaths.filter((path) => path === '/enrollments/my')).toHaveLength(2);
    expect(screen.queryByText('Unexpected conflict')).toBeNull();
  });

  it.each([
    ['offline', new ApiError({ kind: 'offline', status: null, message: 'private offline detail' })],
    ['5xx', new ApiError({ kind: 'server', status: 503, message: 'private server detail' })],
  ])(
    're-enables the same action after a %s failure without a speculative cache write',
    async (_scenario, failure) => {
      let mutationCount = 0;
      let cartItemCount = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/cart/items') {
          mutationCount += 1;
          if (mutationCount === 1) throw failure;
          cartItemCount = 1;
          return undefined as TResponse;
        }
        const value =
          options.path === '/me'
            ? {
                email: 'student@example.test',
                name: 'Student',
                surname: 'One',
                role: 'student',
                birthday: null,
                phone_number: null,
                created_at: '2026-01-01T00:00:00Z',
              }
            : options.path === '/courses'
              ? {
                  items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }],
                  page: 1,
                  page_size: 20,
                  total: 1,
                  pages: 1,
                  has_next: false,
                  has_previous: false,
                }
              : options.path === '/cart'
                ? {
                    id: 1,
                    items:
                      cartItemCount === 0
                        ? []
                        : [
                            {
                              id: 2,
                              course_id: 7,
                              added_at: '2026-07-27T00:00:00Z',
                              course: { id: 7, title: 'React', price: '9.99', currency: 'USD' },
                            },
                          ],
                    total_price: '0.00',
                    currency: 'USD',
                    item_count: cartItemCount,
                  }
                : {
                    items: [],
                    page: 1,
                    page_size: 100,
                    total: 0,
                    pages: 0,
                    has_next: false,
                    has_previous: false,
                  };
        return options.decode ? options.decode(value) : (value as TResponse);
      };
      const user = userEvent.setup();
      renderCatalog(request, ['/'], 0, 'student-token');

      const action = await screen.findByRole('button', { name: 'Add to cart' });
      await act(async () => {
        await user.click(action);
      });
      expect(
        await screen.findByText('The action failed. Check your connection and try again.'),
      ).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(screen.queryByText(failure.message)).toBeNull();

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Add to cart' }));
      });
      expect(await screen.findByRole('button', { name: 'Remove' })).toBeTruthy();
      expect(mutationCount).toBe(2);
    },
  );

  it('fails closed with normalized feedback for an unknown mutation error', async () => {
    const rawError = new Error('private upstream implementation detail');
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/cart/items') throw rawError;
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? {
                items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }],
                page: 1,
                page_size: 20,
                total: 1,
                pages: 1,
                has_next: false,
                has_previous: false,
              }
            : options.path === '/cart'
              ? { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 }
              : {
                  items: [],
                  page: 1,
                  page_size: 100,
                  total: 0,
                  pages: 0,
                  has_next: false,
                  has_previous: false,
                };
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, 'student-token');

    const action = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await user.click(action);
    });

    expect(await screen.findByRole('button', { name: 'Action unavailable' })).toBeTruthy();
    expect(screen.getByText('This action is currently unavailable.')).toBeTruthy();
    expect(screen.queryByText(rawError.message)).toBeNull();
  });

  it('suppresses a retired session mutation outcome and derives fresh state for the replacement epoch', async () => {
    const mutation = deferred<unknown>();
    const sessionStore: AccessTokenStore & { value: string | null } = {
      value: 'first-token',
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
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/cart/items') return mutation.promise as TResponse;
      if (options.path === '/me') {
        const value = {
          email: 'student@example.test',
          name: 'Student',
          surname: 'One',
          role: 'student',
          birthday: null,
          phone_number: null,
          created_at: '2026-01-01T00:00:00Z',
        };
        return options.decode ? options.decode(value) : (value as TResponse);
      }
      const value =
        options.path === '/courses'
          ? {
              items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }],
              page: 1,
              page_size: 20,
              total: 1,
              pages: 1,
              has_next: false,
              has_previous: false,
            }
          : options.path === '/cart'
            ? { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 }
            : {
                items: [],
                page: 1,
                page_size: 100,
                total: 0,
                pages: 0,
                has_next: false,
                has_previous: false,
              };
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    const queryClient = createAppQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, null, {
      queryClient,
      tokenStore: sessionStore,
      withSessionSwitchControl: true,
    });

    const action = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await user.click(action);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Switch catalog session' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog session status').textContent).toBe('authenticated'),
    );
    await screen.findByRole('button', { name: 'Add to cart' });
    invalidateQueries.mockClear();

    await act(async () => {
      mutation.resolve(undefined);
      await mutation.promise;
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(screen.queryByText('The course is in your cart.')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('releases only the settled action after successful mutation reconciliation fails and retries preflight without replaying it', async () => {
    let cartRequests = 0;
    let mutationRequests = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/cart/items') {
        mutationRequests += 1;
        return undefined as TResponse;
      }
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? response({ items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }] })
            : options.path === '/cart'
              ? (() => {
                  cartRequests += 1;
                  if (cartRequests === 2)
                    throw new ApiError({ kind: 'offline', status: null, message: 'offline' });
                  return { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 };
                })()
              : {
                  items: [],
                  page: 1,
                  page_size: 100,
                  total: 0,
                  pages: 0,
                  has_next: false,
                  has_previous: false,
                };
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, 'student-token', { withLocaleSwitchControl: true });

    const initialAction = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await user.click(initialAction);
    });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('We could not verify your enrollment or cart.')).toBeTruthy();
    expect(mutationRequests).toBe(1);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Use Russian catalog locale' }));
    });
    expect(
      await screen.findByText('Не удалось проверить запись на курс или корзину.'),
    ).toBeTruthy();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Use Uzbek catalog locale' }));
    });
    expect(
      await screen.findByText('Kursga yozilish yoki savatni tekshirib bo‘lmadi.'),
    ).toBeTruthy();

    await act(async () => {
      await user.click(retry);
    });
    await waitFor(() => expect(cartRequests).toBe(3));
    await screen.findByRole('button', { name: 'Savatga qo‘shish' });
    expect(mutationRequests).toBe(1);
  });

  it('keeps reconciliation recovery single-flight until both reads settle and restores or clears its current attempt', async () => {
    let cartRequests = 0;
    let enrollmentRequests = 0;
    let mutationRequests = 0;
    const firstRetryCart = deferred<unknown>();
    const firstRetryEnrollments = deferred<unknown>();
    const secondRetryCart = deferred<unknown>();
    const secondRetryEnrollments = deferred<unknown>();
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/cart/items') {
        mutationRequests += 1;
        return undefined as TResponse;
      }
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? response({ items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }] })
            : options.path === '/cart'
              ? (() => {
                  cartRequests += 1;
                  if (cartRequests === 2)
                    throw new ApiError({ kind: 'offline', status: null, message: 'offline' });
                  if (cartRequests === 3) return firstRetryCart.promise;
                  if (cartRequests === 4) return secondRetryCart.promise;
                  return { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 };
                })()
              : (() => {
                  enrollmentRequests += 1;
                  if (enrollmentRequests === 2) return firstRetryEnrollments.promise;
                  if (enrollmentRequests === 3) return secondRetryEnrollments.promise;
                  return {
                    items: [],
                    page: 1,
                    page_size: 100,
                    total: 0,
                    pages: 0,
                    has_next: false,
                    has_previous: false,
                  };
                })();
      return options.decode ? options.decode(await value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, 'student-token');

    const initialAction = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await user.click(initialAction);
    });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => {
      await user.click(retry);
    });
    await act(async () => {
      await user.keyboard('{Enter}');
    });
    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => {
      const retryButton = screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement;
      expect(retryButton.disabled).toBe(true);
      expect(cartRequests).toBe(3);
      expect(enrollmentRequests).toBe(2);
    });
    expect(
      (screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).getAttribute(
        'aria-busy',
      ),
    ).toBe('true');
    expect(mutationRequests).toBe(1);

    await act(async () => {
      firstRetryCart.reject(new ApiError({ kind: 'offline', status: null, message: 'offline' }));
      firstRetryEnrollments.resolve({
        items: [],
        page: 1,
        page_size: 100,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      });
      await Promise.allSettled([firstRetryCart.promise, firstRetryEnrollments.promise]);
    });

    const restoredRetry = await screen.findByRole('button', { name: 'Try again' });
    expect((restoredRetry as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      await user.click(restoredRetry);
    });
    await act(async () => {
      secondRetryCart.resolve({
        id: 1,
        items: [],
        total_price: '0.00',
        currency: 'USD',
        item_count: 0,
      });
      secondRetryEnrollments.resolve({
        items: [],
        page: 1,
        page_size: 100,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      });
      await Promise.all([secondRetryCart.promise, secondRetryEnrollments.promise]);
    });

    await screen.findByRole('button', { name: 'Add to cart' });
    expect(screen.queryByText('We could not verify your enrollment or cart.')).toBeNull();
    expect(cartRequests).toBe(4);
    expect(enrollmentRequests).toBe(3);
    expect(mutationRequests).toBe(1);
  });

  it('retires a pending reconciliation recovery read when the session epoch changes', async () => {
    const recoveryCart = deferred<unknown>();
    const recoveryEnrollments = deferred<unknown>();
    const sessionStore: AccessTokenStore & { value: string | null } = {
      value: 'first-token',
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
    let cartRequests = 0;
    let enrollmentRequests = 0;
    let mutationRequests = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/cart/items') {
        mutationRequests += 1;
        return undefined as TResponse;
      }
      const value =
        options.path === '/me'
          ? {
              email: 'student@example.test',
              name: 'Student',
              surname: 'One',
              role: 'student',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? response({ items: [{ ...catalogItem, published_at: '2026-07-27T00:00:00Z' }] })
            : options.path === '/cart'
              ? (() => {
                  cartRequests += 1;
                  if (cartRequests === 2)
                    throw new ApiError({ kind: 'offline', status: null, message: 'offline' });
                  return cartRequests === 3
                    ? recoveryCart.promise
                    : { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 };
                })()
              : (() => {
                  enrollmentRequests += 1;
                  return enrollmentRequests === 2
                    ? recoveryEnrollments.promise
                    : {
                        items: [],
                        page: 1,
                        page_size: 100,
                        total: 0,
                        pages: 0,
                        has_next: false,
                        has_previous: false,
                      };
                })();
      return options.decode ? options.decode(await value) : (value as TResponse);
    };
    const user = userEvent.setup();
    renderCatalog(request, ['/'], 0, null, {
      tokenStore: sessionStore,
      withSessionSwitchControl: true,
    });

    const initialAction = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await user.click(initialAction);
    });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => {
      await user.click(retry);
    });
    await waitFor(() => {
      expect(cartRequests).toBe(3);
      expect(enrollmentRequests).toBe(2);
    });

    const switchSession = screen.getByRole('button', { name: 'Switch catalog session' });
    await act(async () => {
      await user.click(switchSession);
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog session status').textContent).toBe('authenticated'),
    );
    await screen.findByRole('button', { name: 'Add to cart' });

    await act(async () => {
      recoveryCart.resolve({
        id: 1,
        items: [],
        total_price: '0.00',
        currency: 'USD',
        item_count: 0,
      });
      recoveryEnrollments.resolve({
        items: [],
        page: 1,
        page_size: 100,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      });
      await Promise.all([recoveryCart.promise, recoveryEnrollments.promise]);
    });

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('We could not verify your enrollment or cart.')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(mutationRequests).toBe(1);
  });

  it('retains prior cards while a changed query is pending, then exposes an error without claiming stale results are fresh', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const request: ApiClient['request'] = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    renderCatalog(request, ['/?search_query=first', '/?search_query=second'], 0);

    first.resolve(response());
    await screen.findByRole('link', { name: 'React' });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Forward' }));
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Catalog refresh status' }).textContent).toBe(
      'Updating course results…',
    );
    expect(screen.getByRole('link', { name: 'React' })).toBeTruthy();
    expect(document.querySelector('[data-part="catalog-result-list"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
    expect(
      document.querySelector('[data-part="catalog-discovery-results"]')?.getAttribute('aria-busy'),
    ).toBe('true');
    expect(
      document.querySelectorAll('[data-part="catalog-refresh-status"][aria-live="polite"]'),
    ).toHaveLength(1);

    await act(async () => {
      second.reject(new ApiError({ kind: 'server', status: 500, message: 'Unavailable' }));
    });
    expect(await screen.findByText('We could not load courses')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Course results unavailable.' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'React' })).toBeTruthy();
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
    expect(screen.getByRole('status', { name: 'Catalog refresh status' }).textContent).toBe('');
  });

  it('shows only the refresh failure when a changed query fails after a previous empty result', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const request: ApiClient['request'] = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    renderCatalog(request, ['/?search_query=first', '/?search_query=second'], 0);

    first.resolve(response({ items: [], total: 0, pages: 0 }));
    await screen.findByRole('heading', { level: 2, name: 'Found 0 courses' });
    expect(screen.getByText('Try changing or clearing your filters.')).toBeTruthy();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Forward' }));
    });

    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Catalog refresh status' }).textContent).toBe(
      'Updating course results…',
    );

    await act(async () => {
      second.reject(new ApiError({ kind: 'server', status: 500, message: 'Unavailable' }));
    });

    expect(await screen.findByText('We could not load courses')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Course results unavailable.' }),
    ).toBeTruthy();
    expect(screen.queryByText('No courses found')).toBeNull();
    expect(screen.queryByText('Try changing or clearing your filters.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('does not expose a previous empty state while a changed query is still pending', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const request: ApiClient['request'] = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    renderCatalog(request, ['/?search_query=first', '/?search_query=second'], 0);

    first.resolve(response({ items: [], total: 0, pages: 0 }));
    await screen.findByRole('heading', { level: 2, name: 'Found 0 courses' });
    expect(screen.getByText('No courses found')).toBeTruthy();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Forward' }));
    });

    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' })).toBeTruthy();
    expect(screen.queryByText('No courses found')).toBeNull();
    expect(screen.queryByText('Try changing or clearing your filters.')).toBeNull();

    await act(async () => {
      second.resolve(response({ items: [], total: 0, pages: 0 }));
      await second.promise;
    });

    expect(await screen.findByRole('heading', { level: 2, name: 'Found 0 courses' })).toBeTruthy();
    expect(screen.getByText('No courses found')).toBeTruthy();
    expect(screen.getByText('Try changing or clearing your filters.')).toBeTruthy();
  });

  it('shows the empty state after a successful empty response without any failure notice', async () => {
    const request: ApiClient['request'] = async <TResponse,>() =>
      response({ items: [], total: 0, pages: 0 }) as TResponse;

    renderCatalog(request, ['/']);

    expect(await screen.findByRole('heading', { level: 2, name: 'Found 0 courses' })).toBeTruthy();
    expect(screen.getByText('No courses found')).toBeTruthy();
    expect(screen.getByText('Try changing or clearing your filters.')).toBeTruthy();
    expect(screen.queryByText('We could not load courses')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('delays initial catalog skeletons for 200ms and skips them when the response is fast', async () => {
    vi.useFakeTimers();
    const initial = deferred<unknown>();
    const request: ApiClient['request'] = vi.fn().mockReturnValueOnce(initial.promise);
    renderCatalog(request, ['/']);

    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' }).hidden).toBe(
      false,
    );
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' }).hidden).toBe(
      false,
    );
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
    await act(async () => {
      initial.resolve(response());
      await initial.promise;
      await vi.runAllTimersAsync();
    });
    expect(screen.getByRole('link', { name: 'React' })).toBeTruthy();
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
  });

  it('shows initial catalog skeletons only after 200ms when the first response is slow', async () => {
    vi.useFakeTimers();
    const initial = deferred<unknown>();
    const request: ApiClient['request'] = vi.fn().mockReturnValueOnce(initial.promise);
    renderCatalog(request, ['/']);

    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' }).hidden).toBe(
      false,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' }).hidden).toBe(
      false,
    );
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Loading course results…' }).hidden).toBe(
      false,
    );
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(24);
  });

  it('renders one whole-card link with a controlled disclosure popover and disabled cart action without mutations', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const items = [
      {
        ...catalogItem,
        id: 7,
        title: 'React',
        description: 'A concise course description.',
        price: '94.99',
        currency: 'USD',
        published_at: null,
        lessons: [
          { id: 1, title: 'Intro' },
          { id: 2, title: 'Hooks' },
          { id: 3, title: 'State' },
          { id: 4, title: 'Testing' },
        ],
      },
      {
        ...catalogItem,
        id: 8,
        title: 'TypeScript',
        description: null,
        price: '0.00',
        currency: 'UZS',
        published_at: '2026-07-01T00:00:00Z',
        lessons: [{ id: 5, title: 'Intro' }],
      },
      {
        ...catalogItem,
        id: 9,
        title: 'Draft free',
        description: 'A longer course description that remains visible without truncation.',
        price: '0',
        currency: 'USD',
        published_at: null,
      },
      {
        ...catalogItem,
        id: 10,
        title: 'Published paid',
        description: 'A published paid course.',
        price: '29.99',
        currency: 'USD',
        published_at: '2026-07-02T00:00:00Z',
      },
      {
        ...catalogItem,
        id: 11,
        title: 'Invalid price',
        description: 'An invalid-price course.',
        price: 'not-a-decimal',
        currency: 'US',
        published_at: null,
      },
    ];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return {
        items,
        page: 1,
        page_size: 20,
        total: items.length,
        pages: 1,
        has_next: false,
        has_previous: false,
      } as TResponse;
    };
    renderCatalog(request, ['/']);

    const reactLink = await screen.findByRole('link', { name: /React/ });
    const reactCard = reactLink.closest('article');
    expect(reactCard).toBeTruthy();
    expect(reactCard?.querySelectorAll('a')).toHaveLength(1);
    expect(reactLink.querySelector('button')).toBeNull();
    expect(reactLink.getAttribute('href')).toBe('/courses/7');
    expect(screen.getByRole('heading', { level: 3, name: 'React' })).toBeTruthy();
    expect(screen.getByText('$94.99')).toBeTruthy();
    expect(
      within(reactCard as HTMLElement).getByRole('button', { name: 'View course details' }),
    ).toBeTruthy();
    expect(reactCard?.querySelector('[data-part="course-card-body"] p')).toBeNull();
    const reactMetadata = reactCard?.querySelector('[data-part="course-card-metadata"]');
    expect(reactMetadata?.textContent).toBe('Ada Lovelace · 4 lessons available');
    expect(reactMetadata?.querySelectorAll('p')).toHaveLength(0);
    expect(
      within(reactMetadata as HTMLElement).getByText('Ada Lovelace', { exact: true }),
    ).toBeTruthy();
    expect(reactMetadata?.textContent).not.toContain('by ');
    const metadataSeparator = reactMetadata?.querySelector(
      '[data-part="course-card-metadata-separator"]',
    );
    expect(
      reactMetadata?.querySelectorAll('[data-part="course-card-metadata-separator"]'),
    ).toHaveLength(1);
    expect(metadataSeparator?.textContent).toBe(' · ');
    expect(metadataSeparator?.getAttribute('aria-hidden')).toBe('true');
    expect(
      within(reactMetadata as HTMLElement).getByText('4 lessons available', { exact: true }),
    ).toBeTruthy();
    expect(reactMetadata?.textContent).not.toContain('Instructor');
    const draftExplanationId = reactLink.getAttribute('aria-describedby');
    expect(draftExplanationId).toBeNull();
    expect(within(reactCard as HTMLElement).queryByRole('tooltip')).toBeNull();
    const price = reactCard?.querySelector('[data-part="course-card-price"]');
    if (!price) throw new Error('Card price is required.');
    const reactDisclosure = within(reactCard as HTMLElement).getByRole('button', {
      name: 'View course details',
    });
    expect(reactDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(reactDisclosure.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      reactLink.focus();
    });
    expect(reactDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(reactDisclosure.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    await act(async () => {
      fireEvent.blur(reactLink);
    });
    expect(reactDisclosure.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      await user.click(reactDisclosure);
    });
    expect(reactDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(reactDisclosure.getAttribute('aria-pressed')).toBe('true');
    expect(reactDisclosure.textContent).toBe('Details');
    const openDescriptionId = reactLink.getAttribute('aria-describedby');
    expect(openDescriptionId).toBeTruthy();
    expect(reactDisclosure.getAttribute('aria-describedby')).toBe(openDescriptionId);
    const tooltipId = reactDisclosure.getAttribute('aria-controls');
    expect(tooltipId).toBeTruthy();
    const tooltip = document.getElementById(tooltipId ?? '');
    if (!tooltip) throw new Error('Open card popover is required.');
    const tooltipContent = tooltip.querySelector('[data-part="course-card-tooltip-content"]');
    if (!tooltipContent) throw new Error('Open card tooltip reading surface is required.');
    if (!reactCard) throw new Error('React card is required.');
    const footer = reactCard.querySelector('[data-part="course-card-footer"]');
    expect(footer?.contains(price)).toBe(true);
    expect(footer?.contains(reactCard.querySelector('[data-part="course-card-actions"]'))).toBe(
      true,
    );
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip.getAttribute('aria-label')).toBeNull();
    expect(tooltip.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(openDescriptionId ?? '')?.textContent).toBe(
      'A concise course description.',
    );
    expect(reactDisclosure.getAttribute('aria-haspopup')).toBeNull();
    expect(tooltipContent.firstElementChild?.textContent).toBe(
      'This course is not available for enrollment yet.',
    );
    expect(tooltipContent.children.item(1)?.textContent).toBe('Course description: React');
    expect(tooltip?.textContent).toContain('A concise course description.');
    expect(tooltip?.textContent).not.toContain('published_at');
    expect(tooltip?.textContent).not.toContain('Draft means this course');
    expect(tooltip?.style.getPropertyValue('--catalog-tooltip-tail-top')).toBe('');
    expect(tooltip?.getAttribute('data-placement')).toBe('bottom');
    expect(tooltip.getAttribute('data-placement')).toBe('bottom');
    const publishedLink = screen.getByRole('link', { name: 'TypeScript' });
    const publishedDisclosure = within(publishedLink.closest('article') as HTMLElement).getByRole(
      'button',
      { name: 'View course details' },
    );
    expect(publishedDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(
      publishedDisclosure.querySelector('[data-part="course-card-disclosure-pill"]')?.textContent,
    ).not.toBeNull();
    await act(async () => {
      await user.click(publishedDisclosure);
    });
    const publishedTooltip = document.getElementById(
      publishedLink.getAttribute('aria-describedby') ?? '',
    );
    expect(reactDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(reactDisclosure.getAttribute('aria-pressed')).toBe('false');
    expect(reactLink.getAttribute('aria-describedby')).toBeNull();
    expect(within(reactCard as HTMLElement).queryByRole('tooltip')).toBeNull();
    expect(publishedDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(publishedDisclosure.getAttribute('aria-pressed')).toBe('true');
    expect(publishedDisclosure.textContent).toBe('Details');
    expect(publishedTooltip?.textContent).toContain('No course description is available.');
    await act(async () => {
      await user.keyboard('{Escape}');
    });
    expect(publishedDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(publishedDisclosure.getAttribute('aria-pressed')).toBe('false');
    expect(
      publishedDisclosure.querySelector('[data-part="course-card-disclosure-pill"]')?.textContent,
    ).not.toBeNull();
    await act(async () => {
      await user.click(publishedDisclosure);
    });
    await act(async () => {
      reactLink.focus();
    });
    expect(reactDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(reactDisclosure.getAttribute('aria-pressed')).toBe('false');
    expect(publishedDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(publishedDisclosure.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    await act(async () => {
      fireEvent.blur(reactLink);
    });
    expect(publishedDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(publishedDisclosure.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    await act(async () => {
      await user.click(publishedDisclosure);
    });
    expect(publishedDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(publishedDisclosure.getAttribute('aria-pressed')).toBe('false');
    expect(reactLink.getAttribute('href')).toBe('/courses/7');
    expect(
      within(publishedLink.closest('article') as HTMLElement).getByRole('button', {
        name: 'View course details',
      }),
    ).toBeTruthy();
    expect(publishedTooltip?.textContent).not.toContain('Published means this course');
    expect(publishedTooltip?.textContent).not.toContain('published_at');
    expect(screen.getByText('Price unavailable')).toBeTruthy();
    const cartButton = reactCard?.querySelector(
      '[data-part="course-card-actions"] button',
    ) as HTMLButtonElement;
    expect(cartButton.textContent).toContain('Not published');
    expect(cartButton.querySelector('svg')).toBeNull();
    expect(cartButton.disabled).toBe(true);
    expect(cartButton.closest('[data-part="course-card-actions"]')).toBeTruthy();
    const freeCard = screen.getByRole('link', { name: 'TypeScript' }).closest('article');
    expect(freeCard?.querySelector('[data-part="course-card-metadata"]')?.textContent).toBe(
      'Ada Lovelace · 1 lesson available',
    );
    const freePrice = freeCard?.querySelector<HTMLDataElement>(
      '[data-part="course-card-price"] data',
    );
    expect(freePrice?.value).toBe('0.00');
    expect(freePrice?.textContent).toBe('FREE');
    const freeLogin = within(freeCard as HTMLElement).getByRole('link', {
      name: 'Enroll free',
    });
    expect(freeLogin.getAttribute('href')).toBe('/login?returnTo=%2Fcourses%2F8');
    expect(freeLogin.closest('[data-part="course-card-actions"]')).toBeTruthy();
    expect(freeLogin.querySelector('svg')).toBeNull();
    const draftFreeCard = screen.getByRole('link', { name: 'Draft free' }).closest('article');
    const draftFreePrice = draftFreeCard?.querySelector<HTMLDataElement>(
      '[data-part="course-card-price"] data',
    );
    expect(draftFreePrice?.value).toBe('0');
    expect(draftFreePrice?.textContent).toBe('FREE');
    const draftFreeButton = draftFreeCard?.querySelector(
      '[data-part="course-card-actions"] button',
    ) as HTMLButtonElement;
    expect(draftFreeButton.textContent).toContain('Not published');
    expect(draftFreeButton.querySelector('svg')).toBeNull();
    expect(draftFreeButton.disabled).toBe(true);
    const publishedPaidCard = screen
      .getByRole('link', { name: 'Published paid' })
      .closest('article');
    const paidLogin = within(publishedPaidCard as HTMLElement).getByRole('link', {
      name: 'Add to cart',
    });
    expect(paidLogin.getAttribute('href')).toBe('/login?returnTo=%2Fcourses%2F10');
    expect(paidLogin.closest('[data-part="course-card-actions"]')).toBeTruthy();
    expect(paidLogin.querySelector('svg')).toBeNull();
    const pluralResultHeading = screen.getByRole('heading', { level: 2, name: 'Found 5 courses' });
    expect(pluralResultHeading.textContent).toBe('Found 5 courses');
    expect(pluralResultHeading.firstChild?.textContent).toBe('Found ');
    expect(pluralResultHeading.querySelector('strong')?.textContent).toBe('5');
    expect(pluralResultHeading.lastChild?.textContent).toBe(' courses');
    expect(pluralResultHeading.querySelector('strong')?.textContent).not.toContain('courses');

    expect(requests.every((requestOptions) => requestOptions.path === '/courses')).toBe(true);
  });

  it('delays fine-pointer popovers, preserves card-to-popover continuity, and keeps pin/focus arbitration truthful', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const items = [
      {
        ...catalogItem,
        id: 7,
        title: 'React',
        description: 'React description.',
        published_at: '2026-07-01T00:00:00Z',
      },
      {
        ...catalogItem,
        id: 8,
        title: 'TypeScript',
        description: 'TypeScript description.',
        published_at: '2026-07-02T00:00:00Z',
      },
    ];
    const request: ApiClient['request'] = async <TResponse,>() =>
      ({
        items,
        page: 1,
        page_size: 20,
        total: items.length,
        pages: 1,
        has_next: false,
        has_previous: false,
      }) as TResponse;
    renderCatalog(request, ['/']);

    const reactLink = await screen.findByRole('link', { name: 'React' });
    vi.useFakeTimers();
    const reactCard = reactLink.closest('article') as HTMLElement;
    const reactTrigger = within(reactCard).getByRole('button', { name: 'View course details' });
    const typeScriptCard = screen
      .getByRole('link', { name: 'TypeScript' })
      .closest('article') as HTMLElement;
    const typeScriptTrigger = within(typeScriptCard).getByRole('button', {
      name: 'View course details',
    });
    const action = within(reactCard).getByRole('link', { name: 'Add to cart' });

    fireEvent.pointerEnter(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(279);
    });
    typeScriptTrigger.focus();
    fireEvent.click(typeScriptTrigger);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip', { name: 'Course description: TypeScript' })).toBeTruthy();
    fireEvent.click(typeScriptTrigger);
    await act(async () => {
      vi.advanceTimersByTime(280);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.pointerLeave(reactCard, { pointerType: 'mouse' });
    fireEvent.pointerEnter(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(279);
    });
    fireEvent.click(reactTrigger);
    fireEvent.click(reactTrigger);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.pointerLeave(reactCard, { pointerType: 'mouse' });
    fireEvent.pointerEnter(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(279);
    });
    expect(screen.queryByRole('tooltip', { name: 'Course description: React' })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    const popover = screen.getByRole('tooltip', { name: 'Course description: React' });
    expect(reactTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(reactTrigger.getAttribute('aria-controls')).toBe(popover.id);
    expect(popover.textContent).toContain('React description.');

    fireEvent.pointerLeave(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(179);
    });
    expect(popover).toBeTruthy();
    fireEvent.pointerEnter(popover, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip', { name: 'Course description: React' })).toBeTruthy();
    fireEvent.pointerLeave(popover, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole('tooltip', { name: 'Course description: React' })).toBeNull();

    fireEvent.pointerEnter(action, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(280);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(reactTrigger);
    expect(reactTrigger.getAttribute('aria-pressed')).toBe('true');
    fireEvent.pointerEnter(typeScriptCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(280);
    });
    expect(screen.getByRole('tooltip', { name: 'Course description: React' })).toBeTruthy();
    fireEvent.click(typeScriptTrigger);
    expect(reactTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(typeScriptTrigger.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(typeScriptTrigger);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(reactTrigger);
    fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(reactTrigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {
      vi.advanceTimersByTime(16);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(reactTrigger);
    vi.useRealTimers();
  });

  it('suppresses only pointer Sort hover-through until the uncovered card exits', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const items = [
      {
        ...catalogItem,
        id: 7,
        title: 'React',
        description: 'React description.',
        published_at: '2026-07-01T00:00:00Z',
      },
    ];
    const request: ApiClient['request'] = async <TResponse,>() =>
      ({
        items,
        page: 1,
        page_size: 20,
        total: items.length,
        pages: 1,
        has_next: false,
        has_previous: false,
      }) as TResponse;
    renderCatalog(request, ['/']);

    const reactCard = (await screen.findByRole('link', { name: 'React' })).closest(
      'article',
    ) as HTMLElement;
    const elementsFromPoint = vi.fn(() => [reactCard]);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });
    const sortTrigger = document.querySelector<HTMLButtonElement>(
      '[data-part="catalog-sort-trigger"]',
    );
    if (!sortTrigger) throw new Error('Expected the Sort trigger.');
    const currentSortLabel = sortTrigger.getAttribute('aria-label')?.replace('Sort by: ', '');
    if (!currentSortLabel) throw new Error('Expected the Sort trigger label.');
    vi.useFakeTimers();

    const selectCurrentOptionWithPointer = () => {
      fireEvent.click(sortTrigger);
      fireEvent.click(screen.getByRole('option', { name: currentSortLabel }), {
        detail: 1,
        clientX: 1167,
        clientY: 442,
      });
    };

    selectCurrentOptionWithPointer();
    await act(async () => {
      vi.advanceTimersByTime(16);
    });
    fireEvent.pointerEnter(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(281);
    });
    expect(screen.queryByRole('tooltip', { name: 'Course description: React' })).toBeNull();

    fireEvent.pointerLeave(reactCard, { pointerType: 'mouse' });
    fireEvent.pointerEnter(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(280);
    });
    expect(screen.getByRole('tooltip', { name: 'Course description: React' })).toBeTruthy();

    fireEvent.pointerLeave(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    selectCurrentOptionWithPointer();
    await act(async () => {
      vi.advanceTimersByTime(16);
    });
    fireEvent.pointerEnter(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(281);
    });
    expect(screen.queryByRole('tooltip', { name: 'Course description: React' })).toBeNull();
    fireEvent.pointerLeave(reactCard, { pointerType: 'mouse' });
    fireEvent.pointerEnter(reactCard, { pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(280);
    });
    expect(screen.getByRole('tooltip', { name: 'Course description: React' })).toBeTruthy();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.useRealTimers();
  });

  it('keeps instructor catalog actions neutral without student reads or mutations', async () => {
    const requestPaths: string[] = [];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      requestPaths.push(options.path);
      const value =
        options.path === '/me'
          ? {
              email: 'teacher@example.test',
              name: 'Teacher',
              surname: 'One',
              role: 'instructor',
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : options.path === '/courses'
            ? response({
                items: [
                  {
                    ...catalogItem,
                    title: 'Instructor paid',
                    published_at: '2026-07-27T00:00:00Z',
                  },
                  {
                    ...catalogItem,
                    id: 8,
                    title: 'Instructor free',
                    price: '0.00',
                    published_at: '2026-07-27T00:00:00Z',
                  },
                  { ...catalogItem, id: 9, title: 'Instructor draft', published_at: null },
                ],
                total: 3,
              })
            : undefined;
      return options.decode ? options.decode(value) : (value as TResponse);
    };
    renderCatalog(request, ['/'], 0, 'instructor-token');

    const paidCard = (await screen.findByRole('link', { name: 'Instructor paid' })).closest(
      'article',
    ) as HTMLElement;
    const freeCard = screen
      .getByRole('link', { name: 'Instructor free' })
      .closest('article') as HTMLElement;
    const draftCard = screen
      .getByRole('link', { name: 'Instructor draft' })
      .closest('article') as HTMLElement;
    for (const card of [paidCard, freeCard]) {
      const action = within(card).getByRole('button', {
        name: 'Not available for this account',
      }) as HTMLButtonElement;
      expect(action.disabled).toBe(true);
      expect(action.querySelector('svg')).toBeNull();
    }
    const draftAction = within(draftCard).getByRole('button', {
      name: 'Not published',
    }) as HTMLButtonElement;
    expect(draftAction.disabled).toBe(true);
    expect(draftAction.querySelector('svg')).toBeNull();
    expect([...requestPaths].sort()).toEqual(['/courses', '/me']);
  });

  it('canonicalizes legacy sort before its request, applies sort immediately, and applies a changed price range on Done', async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response() as TResponse;
    };
    renderCatalog(request, [
      '/?search_query=first',
      '/?search_query=React&min_price=30&max_price=10&sort=-id&page=3',
    ]);

    await screen.findByRole('link', { name: 'React' });
    expect(screen.getByText('Ada Lovelace').parentElement?.textContent).toBe(
      'Ada Lovelace · 0 lessons available',
    );
    expect(requests[0]?.query).toEqual({
      search_query: 'React',
      min_price: undefined,
      max_price: undefined,
      sort: '-created_at',
      page: 3,
      page_size: 24,
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe(
        '/?search_query=React&sort=-created_at&page=3',
      ),
    );

    const filters = screen.getByRole('form', { name: 'Course filters' });
    expect(filters.getAttribute('data-part')).toBe('catalog-filter-form');
    expect(filters.querySelector('input[name="search_query"], select')).toBeNull();
    expect(filters.querySelector('h2')).toBeNull();
    const priceTrigger = screen.getByRole('button', { name: 'Price' });
    expect(priceTrigger.getAttribute('data-part')).toBe('catalog-price-trigger');
    expect(priceTrigger.getAttribute('aria-expanded')).toBe('false');
    const priceChevron = priceTrigger.querySelector('[data-part="catalog-price-chevron"]');
    expect(priceChevron?.getAttribute('aria-hidden')).toBe('true');
    expect(priceChevron?.getAttribute('focusable')).toBe('false');
    expect(priceTrigger.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Price range' })).toBeNull();
    await act(async () => {
      await user.click(priceTrigger);
    });
    expect(priceTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(priceTrigger.querySelector('[data-part="catalog-price-chevron"]')).toBe(priceChevron);
    const priceRange = screen.getByRole('group', { name: 'Price range' });
    const semanticLegend = priceRange.querySelector(':scope > legend');
    expect(semanticLegend?.textContent).toBe('Price range');
    expect(semanticLegend?.getAttribute('class')).toBeTruthy();
    const minimum = screen.getByLabelText('From') as HTMLInputElement;
    const maximum = screen.getByLabelText('To') as HTMLInputElement;
    expect(screen.getByRole('spinbutton', { name: 'From' })).toBe(minimum);
    expect(screen.getByRole('spinbutton', { name: 'To' })).toBe(maximum);
    expect(minimum.labels?.[0]?.textContent).toBe('From');
    expect(maximum.labels?.[0]?.textContent).toBe('To');
    expect(minimum.getAttribute('placeholder')).toBe('0');
    await waitFor(() => expect(maximum.getAttribute('placeholder')).toBe('9.99'));
    await act(async () => {
      fireEvent.change(minimum, { target: { value: '5' } });
      fireEvent.change(maximum, { target: { value: '25' } });
    });
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    await act(async () => {
      fireEvent.change(minimum, { target: { value: '' } });
      fireEvent.change(maximum, { target: { value: '' } });
      await user.click(priceTrigger);
    });
    await act(async () => {
      animationFrames.shift()?.(0);
    });
    expect(within(filters).queryByRole('button', { name: /apply/i })).toBeNull();
    expect(screen.queryByLabelText('Search courses')).toBeNull();
    const sortTrigger = screen.getByRole('button', { name: 'Sort by: Newest' });
    expect(sortTrigger.getAttribute('data-part')).toBe('catalog-sort-trigger');
    expect(sortTrigger.getAttribute('aria-controls')).toBe(null);
    expect(screen.queryByText('Sort:', { exact: true })).toBeNull();
    const toolbarControls = document.querySelector('[data-part="catalog-toolbar-controls"]');
    expect(toolbarControls).toBeTruthy();
    expect(within(toolbarControls as HTMLElement).queryByRole('combobox')).toBeNull();
    expect(Array.from(toolbarControls?.children ?? [])).toEqual([
      filters,
      sortTrigger.closest('[data-part="catalog-sort-toolbar"]'),
    ]);
    await act(async () => {
      await user.hover(sortTrigger);
    });
    const listbox = screen.getByRole('listbox', { name: 'Sort by options' });
    expect(sortTrigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(sortTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(sortTrigger.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.getAttribute('aria-activedescendant')).toBe(`${listbox.id}-option-1`);
    const sortOptions = within(listbox).getAllByRole('option');
    expect(sortOptions.map((option) => option.textContent)).toEqual([
      'Oldest',
      'Newest',
      'Low to High',
      'High to Low',
      'A to Z',
      'Z to A',
    ]);
    expect(sortOptions.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(listbox.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(listbox.querySelectorAll('[data-part="catalog-sort-radio"]')).toHaveLength(6);
    await act(async () => {
      await user.unhover(sortTrigger);
    });
    expect(screen.queryByRole('listbox', { name: 'Sort by options' })).toBeNull();
    expect(sortTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(sortTrigger.getAttribute('aria-controls')).toBe(null);
    const singularResultHeading = screen.getByRole('heading', { level: 2, name: 'Found 1 course' });
    expect(singularResultHeading.textContent).toBe('Found 1 course');
    expect(singularResultHeading.firstChild?.textContent).toBe('Found ');
    expect(singularResultHeading.querySelector('strong')?.textContent).toBe('1');
    expect(singularResultHeading.lastChild?.textContent).toBe(' course');
    expect(singularResultHeading.querySelector('strong')?.textContent).not.toContain('course');

    await act(async () => {
      sortTrigger.focus();
      await user.keyboard('{Enter}');
    });
    const keyboardListbox = await screen.findByRole('listbox', { name: 'Sort by options' });
    expect(keyboardListbox).toBe(document.activeElement);
    expect(keyboardListbox.getAttribute('data-part')).toBe('catalog-sort-listbox');
    await act(async () => {
      await user.keyboard('{ArrowDown}{Enter}');
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe(
        '/?search_query=React&sort=price',
      ),
    );
    await waitFor(() =>
      expect(requests[requests.length - 1]?.query).toEqual({
        search_query: 'React',
        min_price: undefined,
        max_price: undefined,
        sort: 'price',
        page: 1,
        page_size: 24,
      }),
    );
    expect(keyboardListbox.isConnected).toBe(false);
    await waitFor(() => expect(animationFrames).toHaveLength(1));
    const mainContent = document.getElementById('main-content');
    if (!mainContent) throw new Error('Route focus target is missing.');
    mainContent.focus();
    expect(mainContent).toBe(document.activeElement);
    await act(async () => {
      animationFrames.shift()?.(0);
    });
    expect(animationFrames).toHaveLength(1);
    await act(async () => {
      animationFrames.shift()?.(0);
    });
    expect(screen.getByRole('button', { name: 'Sort by: Low to High' })).toBe(
      document.activeElement,
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Price' }));
    });
    const currentMinimum = await screen.findByLabelText('From');
    await act(async () => {
      await user.type(currentMinimum, '5');
      await user.click(screen.getByRole('button', { name: 'Done' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe(
        '/?search_query=React&min_price=5&sort=price',
      ),
    );
    await waitFor(() =>
      expect(requests[requests.length - 1]?.query).toEqual({
        search_query: 'React',
        min_price: 5,
        max_price: undefined,
        sort: 'price',
        page: 1,
        page_size: 24,
      }),
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Back' }));
    });
    await act(async () => {
      await user.click(priceTrigger);
    });
    await waitFor(() => expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe(''));
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Forward' }));
    });
    await act(async () => {
      await user.click(priceTrigger);
    });
    await waitFor(() =>
      expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('5'),
    );
  });

  it('keeps a hover-open Sort popup open through an ordinary trigger click and activates an option', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response() as TResponse;
    };
    renderCatalog(request, ['/?page=2']);

    await screen.findByRole('link', { name: 'React' });
    const sortTrigger = screen.getByRole('button', { name: 'Sort by: Oldest' });

    await act(async () => {
      await user.hover(sortTrigger);
    });
    expect(screen.getByRole('listbox', { name: 'Sort by options' })).toBeTruthy();
    await act(async () => {
      await user.click(sortTrigger);
    });
    const listbox = screen.getByRole('listbox', { name: 'Sort by options' });
    expect(sortTrigger.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      fireEvent.click(within(listbox).getByRole('option', { name: 'Low to High' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe('/?sort=price'),
    );
    await waitFor(() =>
      expect(requests[requests.length - 1]?.query).toEqual({
        search_query: undefined,
        min_price: undefined,
        max_price: undefined,
        sort: 'price',
        page: 1,
        page_size: 24,
      }),
    );

    await act(async () => {
      fireEvent.pointerEnter(sortTrigger, { pointerType: 'touch' });
      fireEvent.click(sortTrigger);
    });
    expect(screen.getByRole('listbox', { name: 'Sort by options' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(sortTrigger);
    });
    expect(screen.queryByRole('listbox', { name: 'Sort by options' })).toBeNull();
  });

  it('closes a current Sort option without navigation, request, or focus churn', async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response({ page: 2, total: 21, pages: 2, has_previous: true }) as TResponse;
    };
    renderCatalog(request, ['/?sort=price&page=2']);

    await screen.findByRole('link', { name: 'React' });
    const trigger = screen.getByRole('button', { name: 'Sort by: Low to High' });
    const requestCount = requests.length;
    const location = screen.getByLabelText('catalog location').textContent;

    await act(async () => {
      trigger.focus();
      await user.keyboard('{Enter}');
    });
    const listbox = await screen.findByRole('listbox', { name: 'Sort by options' });
    expect(listbox).toBe(document.activeElement);
    await act(async () => {
      await user.keyboard('{Enter}');
    });

    expect(screen.queryByRole('listbox', { name: 'Sort by options' })).toBeNull();
    expect(screen.getByLabelText('catalog location').textContent).toBe(location);
    expect(requests).toHaveLength(requestCount);
    expect(animationFrames).toHaveLength(1);
    await act(async () => {
      animationFrames.shift()?.(0);
    });
    expect(trigger).toBe(document.activeElement);
  });

  it('shows linked negative-price validation on Enter without changing the URL or requesting, then applies a corrected value', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response() as TResponse;
    };
    renderCatalog(request, ['/']);

    await screen.findByRole('link', { name: 'React' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Price' }));
    });
    const minimum = screen.getByLabelText('From') as HTMLInputElement;
    await act(async () => {
      await user.type(minimum, '-1');
      await user.keyboard('{Enter}');
    });

    await screen.findByText('Enter a non-negative price.');
    expect(minimum.getAttribute('aria-invalid')).toBe('true');
    expect(minimum.getAttribute('aria-describedby')).toContain('-error');
    expect(screen.getByLabelText('catalog location').textContent).toBe('/');
    expect(requests).toHaveLength(1);

    await act(async () => {
      await user.clear(minimum);
      await user.type(minimum, '5');
      await user.keyboard('{Enter}');
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe('/?min_price=5'),
    );
    await waitFor(() =>
      expect(requests[1]?.query).toEqual({
        search_query: undefined,
        min_price: 5,
        max_price: undefined,
        sort: 'created_at',
        page: 1,
        page_size: 24,
      }),
    );
  });

  it('re-resolves a retained price validation error after the locale changes', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response() as TResponse;
    };
    renderCatalog(request, ['/'], 0, null, { withLocaleSwitchControl: true });

    await screen.findByRole('link', { name: 'React' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Price' }));
    });
    const minimum = screen.getByLabelText('From');
    await act(async () => {
      await user.type(minimum, '-1');
      await user.keyboard('{Enter}');
    });

    expect(await screen.findByText('Enter a non-negative price.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Russian catalog locale' }));
    });
    expect(await screen.findByText('Введите неотрицательное значение цены.')).toBeTruthy();
    expect(screen.getByLabelText('От').getAttribute('aria-invalid')).toBe('true');
    expect(requests).toHaveLength(1);
  });

  it('cancels an uncommitted price range when a fine pointer leaves the Price dropdown', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const user = userEvent.setup();
    const request: ApiClient['request'] = async <TResponse,>() => response() as TResponse;
    renderCatalog(request, ['/']);

    await screen.findByRole('link', { name: 'React' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Price' }));
    });
    const priceRange = screen.getByRole('group', { name: 'Price range' });
    await act(async () => {
      await user.type(screen.getByLabelText('From'), '5');
      await user.type(screen.getByLabelText('To'), '25');
      await user.unhover(priceRange);
    });

    expect(screen.getByLabelText('catalog location').textContent).toBe('/');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Price range' })).toBeNull());
  });

  it('cancels a Price draft when the dropdown is dismissed outside', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response() as TResponse;
    };
    renderCatalog(request, ['/?page=3']);

    await screen.findByRole('link', { name: 'React' });
    const initialRequestCount = requests.length;
    const trigger = screen.getByRole('button', { name: 'Price' });
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
    await act(async () => {
      await user.click(trigger);
    });
    const minimum = screen.getByLabelText('From');
    const maximum = screen.getByLabelText('To');
    await act(async () => {
      await user.type(minimum, '5');
      await user.click(maximum);
    });
    expect(screen.getByLabelText('catalog location').textContent).toBe('/?page=3');
    expect(requests).toHaveLength(initialRequestCount);

    await act(async () => {
      await user.type(maximum, '25');
      await user.click(minimum);
    });
    expect(screen.getByLabelText('catalog location').textContent).toBe('/?page=3');
    expect(requests).toHaveLength(initialRequestCount);

    const sortTrigger = screen.getByRole('button', { name: 'Sort by: Oldest' });
    await act(async () => {
      await user.click(sortTrigger);
    });
    expect(screen.queryByRole('group', { name: 'Price range' })).toBeNull();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(sortTrigger);
    expect(screen.getByLabelText('catalog location').textContent).toBe('/?page=3');
    expect(requests).toHaveLength(initialRequestCount);
  });

  it('prioritizes a negative maximum error before inverted-range validation', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response() as TResponse;
    };
    renderCatalog(request, ['/']);

    await screen.findByRole('link', { name: 'React' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Price' }));
    });
    const minimum = screen.getByLabelText('From') as HTMLInputElement;
    const maximum = screen.getByLabelText('To') as HTMLInputElement;

    await act(async () => {
      await user.type(minimum, '5');
      await user.click(maximum);
    });
    expect(screen.getByLabelText('catalog location').textContent).toBe('/');
    expect(requests).toHaveLength(1);

    await act(async () => {
      await user.type(maximum, '-1');
      await user.keyboard('{Enter}');
    });
    await screen.findByText('Enter a non-negative price.');
    expect(maximum.getAttribute('aria-invalid')).toBe('true');
    expect(maximum.getAttribute('aria-describedby')).toContain('-error');
    expect(screen.queryByText('Maximum price must be at least the minimum price.')).toBeNull();
    expect(screen.getByLabelText('catalog location').textContent).toBe('/');
    expect(requests).toHaveLength(1);

    await act(async () => {
      await user.clear(minimum);
      await user.type(minimum, '10');
      await user.clear(maximum);
      await user.type(maximum, '5');
      await user.keyboard('{Enter}');
    });
    await screen.findByText('Maximum price must be at least the minimum price.');
    expect(maximum.getAttribute('aria-invalid')).toBe('true');
    expect(maximum.getAttribute('aria-describedby')).toContain('-error');
    expect(screen.getByLabelText('catalog location').textContent).toBe('/');
    expect(requests).toHaveLength(1);

    await act(async () => {
      await user.clear(maximum);
      await user.type(maximum, '15');
      await user.keyboard('{Enter}');
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe(
        '/?min_price=10&max_price=15',
      ),
    );
    await waitFor(() => expect(requests).toHaveLength(2));
    await act(async () => {
      await user.tab();
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(requests).toHaveLength(2);
  });

  it('does not navigate for a normalized no-op and removes a cleared bound while preserving search and sort', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response() as TResponse;
    };
    renderCatalog(request, ['/?search_query=React&min_price=5&max_price=10&sort=-price&page=3']);

    await screen.findByRole('link', { name: 'React' });
    const trigger = screen.getByRole('button', { name: 'Price' });
    const appliedDescriptionId = trigger.getAttribute('aria-describedby');
    expect(appliedDescriptionId).toBeTruthy();
    expect(document.getElementById(appliedDescriptionId ?? '')?.textContent).toBe(
      'From: 5, To: 10',
    );
    await act(async () => {
      await user.click(trigger);
    });
    expect(requests).toHaveLength(1);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Done' }));
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
    expect(screen.getByLabelText('catalog location').textContent).toBe(
      '/?search_query=React&min_price=5&max_price=10&sort=-price&page=3',
    );

    await act(async () => {
      await user.click(trigger);
    });
    const reopenedMinimum = screen.getByLabelText('From');
    await act(async () => {
      await user.clear(reopenedMinimum);
      await user.type(reopenedMinimum, '7');
      await user.click(screen.getByRole('button', { name: 'Done' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe(
        '/?search_query=React&min_price=7&max_price=10&sort=-price',
      ),
    );
    await waitFor(() => expect(requests).toHaveLength(2));

    await act(async () => {
      await user.click(trigger);
    });
    const reopenedMaximum = screen.getByLabelText('To');
    await act(async () => {
      await user.clear(reopenedMaximum);
      await user.click(screen.getByRole('button', { name: 'Done' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe(
        '/?search_query=React&min_price=7&sort=-price',
      ),
    );
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]?.query).toEqual({
      search_query: 'React',
      min_price: 7,
      max_price: undefined,
      sort: '-price',
      page: 1,
      page_size: 24,
    });
    const remainingDescriptionId = screen
      .getByRole('button', { name: 'Price' })
      .getAttribute('aria-describedby');
    expect(document.getElementById(remainingDescriptionId ?? '')?.textContent).toBe('From: 7');
  });

  it('fails closed when server pagination flags and page-count metadata disagree', async () => {
    let requestCount = 0;
    const request: ApiClient['request'] = async <TResponse,>() => {
      requestCount += 1;
      return response({ page: 2, pages: 3, has_next: false, has_previous: false }) as TResponse;
    };
    renderCatalog(request, ['/'], 0, null, { locale: 'ru' });

    expect(await screen.findByText('Данные каталога недоступны')).toBeTruthy();
    expect(screen.getByText('Попробуйте ещё раз чуть позже.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'React' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Go to (previous|next|page)/ })).toBeNull();
    expect(requestCount).toBe(1);
    expect(screen.getByLabelText('catalog location').textContent).toBe('/');
  });

  it('fails closed when the server page is beyond the advertised page count', async () => {
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response({ page: 99, pages: 1, has_next: false, has_previous: true }) as TResponse;
    };
    renderCatalog(request, ['/?page=99']);

    expect(await screen.findByText('Catalog data is unavailable')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'React' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Go to (previous|next|page)/ })).toBeNull();
    expect(requests).toHaveLength(1);
    expect(screen.getByLabelText('catalog location').textContent).toBe('/?page=99');
  });

  it('serializes an enabled next-page action and propagates its normalized API-008 query', async () => {
    const user = userEvent.setup();
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      requests.push(options);
      return response({
        page: options.query?.page as number,
        total: 21,
        pages: 2,
        has_next: options.query?.page === 1,
        has_previous: options.query?.page === 2,
      }) as TResponse;
    };
    renderCatalog(request, ['/?search_query=React&min_price=5&sort=-price']);

    await screen.findByRole('link', { name: 'React' });
    expect(requests[0]?.query).toEqual({
      search_query: 'React',
      min_price: 5,
      max_price: undefined,
      sort: '-price',
      page: 1,
      page_size: 24,
    });

    const next = screen.getByRole('button', { name: 'Go to next page' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Go to page 1' })).toBeNull();
    const firstCurrentPage = screen.getByLabelText('Page 1, current page');
    expect(firstCurrentPage.getAttribute('aria-current')).toBe('page');
    expect(firstCurrentPage.textContent).toBe('1');
    await act(async () => {
      await user.click(next);
    });

    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe(
        '/?search_query=React&min_price=5&sort=-price&page=2',
      ),
    );
    await waitFor(() =>
      expect(requests[1]?.query).toEqual({
        search_query: 'React',
        min_price: 5,
        max_price: undefined,
        sort: '-price',
        page: 2,
        page_size: 24,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Go to page 2' })).toBeNull();
    const secondCurrentPage = screen.getByLabelText('Page 2, current page');
    expect(secondCurrentPage.getAttribute('aria-current')).toBe('page');
    expect(secondCurrentPage.textContent).toBe('2');
    expect(
      (screen.getByRole('button', { name: 'Go to previous page' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('keeps the result total visible while the next page is loading', async () => {
    const user = userEvent.setup();
    const nextPage = deferred<unknown>();
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      if (options.query?.page === 2) return nextPage.promise as TResponse;
      return response({
        items: Array.from({ length: 20 }, (_, index) => ({ ...catalogItem, id: index + 1 })),
        total: 24,
        pages: 2,
        has_next: true,
      }) as TResponse;
    };
    renderCatalog(request, ['/']);

    await screen.findByRole('heading', { level: 2, name: 'Found 24 courses' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    });

    expect(
      screen.getByRole('heading', { level: 2, name: 'Loading course results…' }).textContent,
    ).toBe('Found 24 courses');
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
    expect(
      screen.getAllByRole('link').some((link) => link.getAttribute('aria-label') === 'React'),
    ).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Course result pages' })).toBeTruthy();
    expect(screen.getByLabelText('Page 2, current page')).toBeTruthy();
    expect(document.querySelectorAll('.ui-pagination__ellipsis')).toHaveLength(0);

    await act(async () => {
      nextPage.resolve(response({ page: 2, total: 24, pages: 10, has_previous: true }));
      await nextPage.promise;
    });
    await screen.findByLabelText('Page 2, current page');
  });

  it('announces loading rather than a stale total while a sort change is loading', async () => {
    const user = userEvent.setup();
    const sortedResults = deferred<unknown>();
    const request: ApiClient['request'] = async <TResponse,>(options: ApiRequestOptions) => {
      if (options.query?.sort === 'price') return sortedResults.promise as TResponse;
      return response({ total: 22, pages: 2, has_next: true }) as TResponse;
    };
    renderCatalog(request, ['/']);

    await screen.findByRole('heading', { level: 2, name: 'Found 22 courses' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Sort by: Oldest' }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('listbox', { name: 'Sort by options' })).getByRole('option', {
          name: 'Low to High',
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByLabelText('catalog location').textContent).toBe('/?sort=price'),
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Loading course results…' }).textContent,
    ).toBe('Found 22 courses');
    expect(document.querySelectorAll('[data-part="skeleton"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'React' })).toBeTruthy();

    await act(async () => {
      sortedResults.resolve(response({ total: 22, pages: 2, has_next: true }));
      await sortedResults.promise;
    });
    await screen.findByRole('heading', { level: 2, name: 'Found 22 courses' });
  });
});
