// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationTitleBoundary, AppRouter, densityForPath } from '../../src/app/router';
import { createAppQueryClient } from '../../src/app/query';
import type { UserProfileDto, UserRoleDto } from '../../src/entities/user';
import { SessionProvider, type AccessTokenStore } from '../../src/features/auth-session';
import { CartCompositeCheckoutProvider } from '../../src/features/checkout-cart';
import type { ApiClient, ApiRequestOptions } from '../../src/shared/api';
import { ThemeProvider } from '../../src/shared/ui/theme';

function profile(role: UserRoleDto): UserProfileDto {
  return {
    email: `${role}@example.com`,
    name: role === 'student' ? 'Sam' : role === 'instructor' ? 'Indira' : 'Alex',
    surname: 'User',
    role,
    birthday: null,
    phone_number: null,
    created_at: '2026-07-20T00:00:00Z',
  };
}

function store(token: string | null): AccessTokenStore {
  let value = token;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
    clear: () => {
      value = null;
    },
  };
}

function clientFor(role: UserRoleDto): ApiClient {
  return {
    request: async <TResponse, TBody = unknown>(
      options: ApiRequestOptions<TBody, TResponse>,
    ): Promise<TResponse> => {
      const value: unknown =
        options.path === '/courses/42'
          ? {
              id: 42,
              title: 'Editor course',
              description: null,
              price: '0.00',
              currency: 'USD',
              published_at: null,
              created_at: '2026-07-20T00:00:00Z',
              updated_at: '2026-07-20T00:00:00Z',
              instructor: { id: 3, name: 'Indira', surname: 'User' },
              lessons: [],
            }
          : options.path === '/enrollments/my'
            ? {
                items: [],
                page: 1,
                page_size: 20,
                total: 0,
                pages: 0,
                has_next: false,
                has_previous: false,
              }
            : options.path.startsWith('/enrollments/')
              ? {
                  id: 42,
                  user_id: 1,
                  course_id: 7,
                  status: 'active',
                  created_at: '2026-07-01T00:00:00Z',
                  updated_at: '2026-07-01T00:00:00Z',
                  course: {
                    id: 7,
                    title: 'Learning details',
                    description: null,
                    price: '0.00',
                    currency: 'USD',
                  },
                }
              : options.path === '/courses/7/progress'
                ? { course_id: 7, completed_lessons: 0, total_lessons: 0, progress_percentage: 0 }
                : options.path === '/courses/7/lessons'
                  ? {
                      items: [],
                      page: 1,
                      page_size: 100,
                      total: 0,
                      pages: 0,
                      has_next: false,
                      has_previous: false,
                    }
                  : profile(role);
      return 'decode' in options && options.decode ? options.decode(value) : (value as TResponse);
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="current location">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

function FocusNavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate('/login')}>
        Navigate pathname
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Navigate back
      </button>
      <button type="button" onClick={() => navigate('/', { replace: true })}>
        Replace pathname
      </button>
      <button
        type="button"
        onClick={() =>
          navigate({ pathname: location.pathname, search: '?focus=next', hash: location.hash })
        }
      >
        Navigate search
      </button>
      <button
        type="button"
        onClick={() =>
          navigate({ pathname: location.pathname, search: location.search, hash: '#focus-target' })
        }
      >
        Navigate focus fragment
      </button>
      <button
        type="button"
        onClick={() =>
          navigate({ pathname: location.pathname, search: location.search, hash: '#second-target' })
        }
      >
        Navigate second fragment
      </button>
      <button
        type="button"
        onClick={() =>
          navigate({
            pathname: location.pathname,
            search: location.search,
            hash: '#missing-target',
          })
        }
      >
        Navigate missing fragment
      </button>
      <input id="focus-target" aria-label="Focus fragment target" />
      <input id="second-target" aria-label="Second fragment target" />
    </div>
  );
}

interface RenderAppOptions {
  readonly cartCompositeCheckout?: boolean;
  readonly focusNavigationProbe?: boolean;
  readonly initialEntries?: string[];
  readonly initialIndex?: number;
}

interface ViewportMatch {
  readonly mobile: boolean;
  readonly tablet: boolean;
}

function stubViewportMatchMedia({ mobile, tablet }: ViewportMatch): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches:
          query === '(max-width: 767.98px)'
            ? mobile
            : query === '(min-width: 768px) and (max-width: 1023px)'
              ? tablet
              : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  );
}

function headerSemanticOrder(header: HTMLElement): string[] {
  return Array.from(
    header.querySelectorAll('a, button[aria-label], input, [data-account-initials]'),
  ).map((element) => {
    if (element instanceof HTMLInputElement) {
      return (
        element.getAttribute('aria-label') ??
        element.labels?.item(0)?.textContent?.trim() ??
        element.name
      );
    }
    return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
  });
}

function renderApp(path: string, role?: UserRoleDto, options: RenderAppOptions = {}) {
  const request = vi.fn(role ? clientFor(role).request : async () => profile('student'));
  const client = { request } as ApiClient;
  const initialPathname = new URL(path, 'https://learnhub.test').pathname;
  return {
    request,
    ...render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ThemeProvider initialDensityMode={densityForPath(initialPathname)}>
          <SessionProvider client={client} tokenStore={store(role ? 'token' : null)}>
            <MemoryRouter
              initialEntries={options.initialEntries ?? [path]}
              initialIndex={options.initialIndex}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              {options.cartCompositeCheckout ? (
                <CartCompositeCheckoutProvider>
                  <ApplicationTitleBoundary>
                    <AppRouter />
                  </ApplicationTitleBoundary>
                  <LocationProbe />
                  {options.focusNavigationProbe ? <FocusNavigationProbe /> : null}
                </CartCompositeCheckoutProvider>
              ) : (
                <>
                  <ApplicationTitleBoundary>
                    <AppRouter />
                  </ApplicationTitleBoundary>
                  <LocationProbe />
                  {options.focusNavigationProbe ? <FocusNavigationProbe /> : null}
                </>
              )}
            </MemoryRouter>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  cleanup();
  globalThis.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

describe('application routing and guards', () => {
  it('composes PAGE-002 and preserves its safe login return target', async () => {
    const client: ApiClient = {
      request: async <TResponse, TBody = unknown>(options: ApiRequestOptions<TBody, TResponse>) => {
        const value = options.path.endsWith('/lessons')
          ? {
              items: [],
              page: 1,
              page_size: 100,
              total: 0,
              pages: 0,
              has_next: false,
              has_previous: false,
            }
          : {
              id: 7,
              title: 'React foundations',
              description: null,
              price: '0.00',
              currency: 'USD',
              published_at: '2026-07-01T00:00:00Z',
              created_at: '2026-07-01T00:00:00Z',
              updated_at: '2026-07-01T00:00:00Z',
              instructor: { id: 2, name: 'Ada', surname: 'Lovelace' },
              lessons: [],
            };
        return options.decode ? options.decode(value) : (value as TResponse);
      },
    };
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ThemeProvider initialDensityMode="marketplace">
          <SessionProvider client={client} tokenStore={store(null)}>
            <MemoryRouter
              initialEntries={['/courses/7']}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              <ApplicationTitleBoundary>
                <AppRouter />
              </ApplicationTitleBoundary>
              <LocationProbe />
            </MemoryRouter>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    const login = await screen.findByRole('link', { name: 'Sign in' });
    expect(login.getAttribute('href')).toBe('/login?returnTo=%2Fcourses%2F7');
    await act(async () => {
      await userEvent.setup().click(login);
    });
    await screen.findByRole('heading', { level: 1, name: 'Log in' });
    expect(screen.getByLabelText('current location').textContent).toBe(
      '/login?returnTo=%2Fcourses%2F7',
    );
  });

  it('keeps the busy bootstrap main landmark separate from its polite status region', async () => {
    const client: ApiClient = {
      request: <TResponse,>() => new Promise<TResponse>(() => undefined),
    };
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ThemeProvider initialDensityMode="marketplace">
          <SessionProvider client={client} tokenStore={store('token')}>
            <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
              <ApplicationTitleBoundary>
                <AppRouter />
              </ApplicationTitleBoundary>
            </MemoryRouter>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(document.title).toBe('Preparing your workspace | LearnHub'));

    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(within(main).getAllByRole('status')).toHaveLength(1);
    const status = within(main).getByRole('status', { name: 'Loading application' });
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(
      within(main).getByRole('heading', { level: 1, name: 'Preparing your workspace' }),
    ).toBeTruthy();
    expect(main.textContent).toContain('We are verifying your session.');
  });

  it('redirects an anonymous protected visit with a safe path/query/hash returnTo', async () => {
    renderApp('/cart?coupon=SAVE#summary');

    await screen.findByRole('heading', { level: 1, name: 'Log in' });
    expect(screen.getByLabelText('current location').textContent).toBe(
      '/login?returnTo=%2Fcart%3Fcoupon%3DSAVE%23summary',
    );
  });

  it('falls back to the student home when Login returnTo targets an Instructor route', async () => {
    renderApp('/login?returnTo=%2Finstructor%2Fcourses', 'student');

    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    expect(screen.getByLabelText('current location').textContent).toBe('/learning');
    expect(
      screen.queryByRole('heading', { level: 1, name: 'You do not have access to this page' }),
    ).toBeNull();
  });

  it('falls back to the Instructor home when Login returnTo targets a student route', async () => {
    renderApp('/login?returnTo=%2Flearning', 'instructor');

    await screen.findByRole('heading', { level: 1, name: 'Instructor courses' });
    expect(screen.getByLabelText('current location').textContent).toBe('/instructor/courses');
    expect(
      screen.queryByRole('heading', { level: 1, name: 'You do not have access to this page' }),
    ).toBeNull();
  });

  it('redirects an Instructor from the Catalog root to Instructor courses', async () => {
    const { request } = renderApp('/?search_query=React#catalog', 'instructor', {
      focusNavigationProbe: true,
      initialEntries: ['/instructor/courses', '/?search_query=React#catalog'],
      initialIndex: 1,
    });

    await screen.findByText('Instructor courses', { selector: 'h1' });
    expect(screen.getByLabelText('current location').textContent).toBe('/instructor/courses');
    const requestedPaths = request.mock.calls.map(([options]) => options.path);
    expect(requestedPaths).toContain('/me');
    expect(requestedPaths).not.toContain('/courses');

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Navigate back' }));
    });

    expect(screen.getByLabelText('current location').textContent).toBe('/instructor/courses');
  });

  it('routes an anonymous AppShell Cart action through the protected login return', async () => {
    renderApp('/');
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByRole('link', { name: 'Cart' }));
    });

    await screen.findByRole('heading', { level: 1, name: 'Log in' });
    expect(screen.getByLabelText('current location').textContent).toBe('/login?returnTo=%2Fcart');
  });

  it('keeps anonymous Cart-to-Login actions in the stable end-side order', async () => {
    renderApp('/login?returnTo=%2Fcart');
    await screen.findByRole('heading', { level: 1, name: 'Log in' });

    expect(headerSemanticOrder(screen.getByRole('banner'))).toEqual([
      'LearnHub home',
      'Catalog',
      'Cart',
      'Log in',
      'Sign up',
      'Change language',
    ]);
  });

  it('renders an accessible forbidden state for an authenticated wrong role', async () => {
    renderApp('/cart', 'instructor');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You do not have access to this page' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Cart' })).toBe(null);
    expect(screen.getByRole('link', { name: 'Back to catalog' }).getAttribute('href')).toBe('/');
  });

  it('shows only guest navigation to an anonymous user', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    const catalogSearch = screen.getByRole('search', { name: 'Course catalog search' });
    const headerSearch = within(catalogSearch).getByLabelText('Search courses') as HTMLInputElement;
    expect(headerSearch.getAttribute('placeholder')).toBe('Search courses, topics, or instructors');
    const label = headerSearch.labels?.item(0);
    expect(label?.textContent).toBe('Search courses');
    const icon = catalogSearch.querySelector('svg[aria-hidden="true"]');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('focusable')).toBe('false');
    expect(icon?.getAttribute('role')).toBe(null);
    expect(within(catalogSearch).queryByRole('button', { name: 'Search' })).toBeNull();
    expect(headerSearch.getAttribute('role')).toBe('combobox');
    expect(headerSearch.getAttribute('aria-autocomplete')).toBe('list');
    expect(headerSearch.getAttribute('autocomplete')).toBe('off');
    expect(headerSearch.getAttribute('aria-expanded')).toBe('false');
    expect(headerSearch.getAttribute('aria-controls')).toBe(null);
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const browse = within(navigation).getByRole('link', { name: 'Catalog' });
    expect(browse).toBeTruthy();
    const accountNavigation = screen.getByRole('navigation', { name: 'Account navigation' });
    const logIn = within(accountNavigation).getByRole('link', { name: 'Log in' });
    const signUp = within(accountNavigation).getByRole('link', { name: 'Sign up' });
    expect(logIn.getAttribute('href')).toBe('/login');
    expect(signUp.getAttribute('href')).toBe('/signup');
    expect(browse.getAttribute('aria-current')).toBe('page');
    expect(logIn.getAttribute('aria-current')).toBe(null);
    expect(signUp.getAttribute('aria-current')).toBe(null);
    const header = screen.getByRole('banner');
    expect(header.hasAttribute('data-app-shell-header')).toBe(true);
    expect(document.querySelectorAll('[data-app-shell-header]')).toHaveLength(1);
    expect(header.contains(navigation)).toBe(true);
    expect(header.contains(catalogSearch)).toBe(true);
    expect(header.contains(accountNavigation)).toBe(true);
    expect(headerSemanticOrder(header)).toEqual([
      'LearnHub home',
      'Catalog',
      'Search courses',
      'Cart',
      'Log in',
      'Sign up',
      'Change language',
    ]);
    expect(screen.getByRole('link', { name: 'Cart' }).getAttribute('href')).toBe('/cart');
    expect(within(navigation).queryByRole('link', { name: 'Cart' })).toBe(null);
    expect(within(navigation).queryByRole('link', { name: 'Instructor courses' })).toBe(null);
  });

  it('does not render the catalog search on a non-catalog route', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Log in' });
    expect(screen.queryByRole('search', { name: 'Course catalog search' })).toBe(null);
  });

  it.each([
    ['anonymous', '/', undefined, 'Master the Skills Shaping the Future'],
    ['authenticated', '/learning', 'student', 'My learning'],
  ] as const)(
    'renders one complete accessible brand in the %s header',
    async (_session, path, role, heading) => {
      renderApp(path, role);
      await screen.findByRole('heading', { level: 1, name: heading });

      const brand = screen.getByRole('link', { name: 'LearnHub home' });
      const marks = brand.querySelectorAll(':scope > img');
      const wordmarks = brand.querySelectorAll(':scope > span');

      expect(brand.getAttribute('aria-label')).toBe('LearnHub home');
      expect(brand.textContent?.replace(/\s+/g, ' ').trim()).toBe('LearnHub');
      expect(marks).toHaveLength(1);
      expect(marks[0]?.getAttribute('aria-hidden')).toBe('true');
      expect(marks[0]?.getAttribute('alt')).toBe('');
      expect(marks[0]?.getAttribute('src')).toContain('learnhub-book-ui018.png');
      expect(wordmarks).toHaveLength(1);
      expect(wordmarks[0]?.textContent).toBe('LearnHub');
    },
  );

  it.each(['/login/help', '/signup/help'])(
    'does not mark a guest auth leaf current on unknown nested path %s',
    async (path) => {
      renderApp(path);
      await screen.findByRole('heading', { level: 1, name: 'Page not found' });
      const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
      const accountNavigation = screen.getByRole('navigation', { name: 'Account navigation' });
      expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
      expect(
        within(accountNavigation)
          .getByRole('link', { name: 'Sign up' })
          .getAttribute('aria-current'),
      ).toBe(null);
      expect(
        within(accountNavigation)
          .getByRole('link', { name: 'Log in' })
          .getAttribute('aria-current'),
      ).toBe(null);
    },
  );

  it('shows student navigation and marks the current page', async () => {
    renderApp('/learning', 'student');
    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(screen.getByRole('link', { name: /Cart/ })).toBeTruthy();
    expect(
      within(navigation).getByRole('link', { name: 'My learning' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(navigation).queryByRole('link', { name: 'My courses' })).toBe(null);
  });

  it.each([
    [
      '/learning',
      'student' as const,
      'My learning',
      'Sam User',
      [
        'LearnHub home',
        'Catalog',
        'My learning',
        'Search courses',
        'Open AI assistant',
        'Cart',
        'Account menu for Sam User',
        'Change language',
      ],
    ],
    [
      '/instructor/courses',
      'instructor' as const,
      'Instructor courses',
      'Indira User',
      ['LearnHub home', 'Instructor courses', 'Account menu for Indira User', 'Change language'],
    ],
  ])(
    'uses the D04 desktop header order and account-menu trigger for %s',
    async (path, role, workspaceLabel, identity, expectedOrder) => {
      renderApp(path, role);
      await screen.findByRole('link', { name: workspaceLabel });

      const header = document.querySelector<HTMLElement>('[data-app-shell-header]');
      expect(header).not.toBeNull();
      if (!header) throw new Error('Expected the application shell header.');
      const initialsMarker = header.querySelector('[data-account-initials]');
      expect(headerSemanticOrder(header)).toEqual(expectedOrder);
      expect(initialsMarker?.getAttribute('aria-label')).toBe(`Account menu for ${identity}`);
      expect(initialsMarker?.getAttribute('title')).toBeNull();
      expect(initialsMarker?.textContent).toBe(role === 'student' ? 'SU' : 'IU');
      expect(initialsMarker?.tagName).toBe('BUTTON');
    },
  );

  it('submits the persistent workspace search to the canonical catalog URL and resets page', async () => {
    renderApp('/learning?page=3', 'student');
    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    const search = screen.getByRole('combobox', { name: 'Search courses' });

    fireEvent.change(search, { target: { value: 'React' } });
    fireEvent.submit(screen.getByRole('search', { name: 'Course catalog search' }));

    await waitFor(() =>
      expect(screen.getByLabelText('current location').textContent).toBe('/?search_query=React'),
    );
  });

  it('uses route metadata to set workspace density initially and marketplace density after navigation', async () => {
    renderApp('/learning', 'student');
    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-density')).toBe('workspace'),
    );
    await waitFor(() => expect(document.title).toBe('My learning | LearnHub'));

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('link', { name: 'LearnHub home' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-density')).toBe('marketplace'),
    );
    await waitFor(() => expect(document.title).toBe('Course catalog | LearnHub'));
    await waitFor(() => expect(screen.getByRole('main')).toBe(document.activeElement));
  });

  it('waits for 500ms of quiet input before canonically navigating a header search', async () => {
    renderApp('/?sort=price&page=3');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    await act(async () => undefined);
    vi.useFakeTimers();
    const search = screen.getByRole('combobox', { name: 'Search courses' });

    fireEvent.change(search, { target: { value: 'Re' } });
    await act(async () => vi.advanceTimersByTime(499));
    expect(screen.getByLabelText('current location').textContent).toBe('/?sort=price&page=3');

    fireEvent.change(search, { target: { value: 'React' } });
    await act(async () => vi.advanceTimersByTime(499));
    expect(screen.getByLabelText('current location').textContent).toBe('/?sort=price&page=3');

    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByLabelText('current location').textContent).toBe(
      '/?search_query=React&sort=price',
    );
  });

  it('cancels a persistent workspace header-search debounce after navigation to Cart', async () => {
    const { request } = renderApp('/learning?page=3', 'student', {
      cartCompositeCheckout: true,
    });
    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    await act(async () => undefined);
    vi.useFakeTimers();
    const search = screen.getByRole('combobox', { name: 'Search courses' });
    const catalogRequestCount = () =>
      request.mock.calls.filter(([options]) => (options as ApiRequestOptions).path === '/courses')
        .length;

    fireEvent.change(search, { target: { value: 'React' } });
    const requestsBeforeNavigation = catalogRequestCount();
    fireEvent.click(screen.getByRole('link', { name: 'Cart' }));
    expect(screen.getByLabelText('current location').textContent).toBe('/cart');

    await act(async () => vi.advanceTimersByTime(500));

    expect(screen.getByLabelText('current location').textContent).toBe('/cart');
    expect(catalogRequestCount()).toBe(requestsBeforeNavigation);
    expect(globalThis.localStorage.getItem('learnhub.catalog-search-history')).toBeNull();
  });

  it('keeps Enter immediate and does not add debounced drafts to recent-search history', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    await act(async () => undefined);
    vi.useFakeTimers();
    const search = screen.getByRole('combobox', { name: 'Search courses' });

    fireEvent.change(search, { target: { value: 'Debounced only' } });
    await act(async () => vi.advanceTimersByTime(500));
    expect(globalThis.localStorage.getItem('learnhub.catalog-search-history')).toBeNull();

    const currentSearch = screen.getByRole('combobox', { name: 'Search courses' });
    fireEvent.change(currentSearch, { target: { value: 'Explicit Enter' } });
    fireEvent.submit(screen.getByRole('search', { name: 'Course catalog search' }));
    expect(screen.getByLabelText('current location').textContent).toBe(
      '/?search_query=Explicit+Enter',
    );
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.getByLabelText('current location').textContent).toBe(
      '/?search_query=Explicit+Enter',
    );
    expect(globalThis.localStorage.getItem('learnhub.catalog-search-history')).toBe(
      JSON.stringify(['Explicit Enter']),
    );
  });

  it('waits for composition to end before starting the search debounce', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    await act(async () => undefined);
    vi.useFakeTimers();
    const search = screen.getByRole('combobox', { name: 'Search courses' });

    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: 'React' } });
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.getByLabelText('current location').textContent).toBe('/');

    fireEvent.compositionEnd(search, { data: 'React' });
    await act(async () => vi.advanceTimersByTime(499));
    expect(screen.getByLabelText('current location').textContent).toBe('/');
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByLabelText('current location').textContent).toBe('/?search_query=React');
  });

  it('renders an immediate accessible clear control that keeps focus on the search input', async () => {
    renderApp('/?search_query=React');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    const clear = screen.getByRole('button', { name: 'Clear' });

    fireEvent.click(clear);
    await waitFor(() => expect(screen.getByLabelText('current location').textContent).toBe('/'));
    const currentSearch = screen.getByRole('combobox', { name: 'Search courses' });
    await waitFor(() => expect(document.activeElement).toBe(currentSearch));
    expect((currentSearch as HTMLInputElement).value).toBe('');
  });

  it('removes the recent-search outside-pointer listener when the open draft has zero matches', async () => {
    globalThis.localStorage.setItem(
      'learnhub.catalog-search-history',
      JSON.stringify(['React Basics', 'TypeScript']),
    );
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    const user = userEvent.setup();
    const input = screen.getByRole('combobox', { name: 'Search courses' });

    await act(async () => {
      await user.click(input);
    });
    const listbox = await screen.findByRole('listbox', { name: 'Recent searches' });
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    const pointerListener = [...addEventListener.mock.calls]
      .reverse()
      .find(([type]) => type === 'pointerdown')?.[1];
    expect(pointerListener).toBeTruthy();

    fireEvent.change(input, { target: { value: 'no matching history' } });
    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull(),
    );
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBeNull();
    await waitFor(() =>
      expect(removeEventListener).toHaveBeenCalledWith('pointerdown', pointerListener, true),
    );
  });

  it.each([
    ['/LOGIN/', undefined, 'Log in | LearnHub'],
    ['/Learning/', 'student' as const, 'My learning | LearnHub'],
    ['/instructor/courses/ABC/edit/', 'instructor' as const, 'Edit course | LearnHub'],
  ])('applies Router-parity metadata and title for %s', async (path, role, expectedTitle) => {
    renderApp(path, role);
    await waitFor(() => expect(document.title).toBe(expectedTitle));
    expect(document.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe(
      role ? 'workspace' : 'auth',
    );
  });

  it.each([
    ['/LOGIN/', undefined, 'Log in', 'auth', 'marketplace'],
    ['/COURSES/Course-42/', undefined, 'Course not found', 'public', 'marketplace'],
    [
      '/INSTRUCTOR/COURSES/Course-42/ENROLLMENTS/',
      'instructor',
      'Course enrollments',
      'workspace',
      'workspace',
    ],
  ] as const)(
    'keeps route metadata aligned with rendered routing for %s',
    async (path, role, heading, layout, density) => {
      renderApp(path, role);
      await screen.findByRole('heading', { level: 1, name: heading });
      expect(document.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe(layout);
      await waitFor(() =>
        expect(document.documentElement.getAttribute('data-density')).toBe(density),
      );
    },
  );

  it('does not mark the My learning section as the current page on learning details', async () => {
    renderApp('/learning/enrollments/42', 'student');
    await screen.findByRole('heading', { level: 1, name: 'Learning details' });
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(
      within(navigation).getByRole('link', { name: 'My learning' }).getAttribute('aria-current'),
    ).toBe(null);
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('keeps an encoded guest login usable as anonymous recovery', async () => {
    renderApp('/l%6Fgin?returnTo=%2Fcart#recovery');

    await screen.findByRole('heading', { level: 1, name: 'Log in' });
    expect(screen.getByLabelText('current location').textContent).toBe(
      '/l%6Fgin?returnTo=%2Fcart#recovery',
    );
    expect(document.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('auth');
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-density')).toBe('marketplace'),
    );
  });

  it('keeps an encoded instructor workspace route role-guarded with workspace metadata', async () => {
    renderApp('/instruct%6Fr/courses?tab=drafts#overview', 'instructor');

    await screen.findByRole('heading', { level: 1, name: 'Instructor courses' });
    expect(screen.getByLabelText('current location').textContent).toBe(
      '/instruct%6Fr/courses?tab=drafts#overview',
    );
    expect(document.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('workspace');
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-density')).toBe('workspace'),
    );
  });

  it('shows instructor navigation without student links', async () => {
    renderApp('/instructor/courses', 'instructor');
    await screen.findByRole('heading', { level: 1, name: 'Instructor courses' });
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).getByRole('link', { name: 'Instructor courses' })).toBeTruthy();
    expect(within(navigation).queryByRole('link', { name: 'Course enrollments' })).toBe(null);
    expect(within(navigation).queryByRole('link', { name: 'Cart' })).toBe(null);
    expect(within(navigation).queryByRole('link', { name: 'My learning' })).toBe(null);
  });

  it('does not expose course enrollments in instructor header navigation on editor routes', async () => {
    renderApp('/instructor/courses/42/edit', 'instructor');
    await screen.findByRole('heading', { level: 1, name: 'Edit course' });
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).queryByRole('link', { name: 'Course enrollments' })).toBe(null);
  });

  it('does not expose course enrollments in instructor header navigation on roster routes', async () => {
    renderApp('/instructor/courses/42/enrollments', 'instructor');
    await screen.findByRole('heading', { level: 1, name: 'Course enrollments' });
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).queryByRole('link', { name: 'Course enrollments' })).toBe(null);
  });

  it('does not expose contextual instructor navigation to a student', async () => {
    renderApp('/instructor/courses/42/edit', 'student');
    await screen.findByRole('heading', { level: 1, name: 'You do not have access to this page' });
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).queryByRole('link', { name: 'Course enrollments' })).toBe(null);
  });

  it('gives admin no invented workspace and redirects guest-only routes home', async () => {
    renderApp('/login', 'admin');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    expect(screen.getByLabelText('current location').textContent).toBe('/');
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).queryAllByRole('link')).toHaveLength(0);
  });

  it('renders a not-found state for unknown routes', async () => {
    renderApp('/does-not-exist');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to catalog' }).getAttribute('href')).toBe('/');
    await waitFor(() => expect(document.title).toBe('Page not found | LearnHub'));
  });

  it('exposes the skip link and semantic landmarks', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('keeps pathname main focus while making same-path query focus scroll-safe without stealing fragment focus', async () => {
    const scheduledFrames: FrameRequestCallback[] = [];
    const focusCalls: Array<{ options: FocusOptions | undefined; target: HTMLElement }> = [];
    const nativeFocus = HTMLElement.prototype.focus;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function recordFocus(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      focusCalls.push({ options, target: this });
      nativeFocus.call(this, options);
    });
    const view = renderApp('/', undefined, { focusNavigationProbe: true });
    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' });

    const firstTarget = screen.getByLabelText('Focus fragment target');
    const secondTarget = screen.getByLabelText('Second fragment target');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Navigate focus fragment' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('current location').textContent).toBe('/#focus-target'),
    );
    firstTarget.focus();
    expect(scheduledFrames).toHaveLength(0);
    expect(firstTarget).toBe(document.activeElement);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Navigate focus fragment' }));
    });
    firstTarget.focus();
    expect(scheduledFrames).toHaveLength(0);
    expect(firstTarget).toBe(document.activeElement);

    await act(async () => {
      screen.getByRole('button', { name: 'Navigate focus fragment' }).click();
      screen.getByRole('button', { name: 'Navigate second fragment' }).click();
    });
    await waitFor(() =>
      expect(screen.getByLabelText('current location').textContent).toBe('/#second-target'),
    );
    secondTarget.focus();
    expect(scheduledFrames).toHaveLength(0);
    expect(secondTarget).toBe(document.activeElement);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Navigate missing fragment' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('current location').textContent).toBe('/#missing-target'),
    );
    expect(scheduledFrames).toHaveLength(0);
    expect(() => view.unmount()).not.toThrow();

    renderApp('/', undefined, { focusNavigationProbe: true });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Navigate pathname' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Log in' });
    expect(scheduledFrames).toHaveLength(1);
    act(() => scheduledFrames.shift()?.(0));
    const main = screen.getByRole('main');
    expect(main).toBe(document.activeElement);
    expect(focusCalls.filter((call) => call.target === main).map((call) => call.options)).toEqual([
      { preventScroll: true },
    ]);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Navigate search' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('current location').textContent).toBe('/login?focus=next'),
    );
    expect(scheduledFrames).toHaveLength(1);
    act(() => scheduledFrames.shift()?.(0));
    expect(main).toBe(document.activeElement);
    expect(focusCalls.filter((call) => call.target === main).map((call) => call.options)).toEqual([
      { preventScroll: true },
      { preventScroll: true },
    ]);
  });

  it('resets path-changing pushes and replaces while preserving query scroll and delegating fragments to their targets', async () => {
    const scrollTo = vi.mocked(window.scrollTo);
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    try {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      });
      renderApp('/', undefined, { focusNavigationProbe: true });
      const user = userEvent.setup();
      await screen.findByRole('heading', {
        level: 1,
        name: 'Master the Skills Shaping the Future',
      });

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Navigate pathname' }));
      });
      await screen.findByRole('heading', { level: 1, name: 'Log in' });
      expect(scrollTo).toHaveBeenCalledWith(0, 0);

      scrollTo.mockClear();
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Replace pathname' }));
      });
      await screen.findByRole('heading', {
        level: 1,
        name: 'Master the Skills Shaping the Future',
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(0, 0);

      scrollTo.mockClear();
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Navigate pathname' }));
      });
      await screen.findByRole('heading', { level: 1, name: 'Log in' });

      scrollTo.mockClear();
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Navigate search' }));
      });
      await waitFor(() =>
        expect(screen.getByLabelText('current location').textContent).toBe('/login?focus=next'),
      );
      expect(scrollTo).not.toHaveBeenCalled();

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Navigate focus fragment' }));
      });
      await waitFor(() =>
        expect(screen.getByLabelText('current location').textContent).toBe(
          '/login?focus=next#focus-target',
        ),
      );
      expect(scrollIntoView).toHaveBeenCalledWith();
    } finally {
      if (originalScrollIntoView)
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('restores the stored POP position without replacing the incoming entry before restoration', async () => {
    let scrollLeft = 0;
    let scrollTop = 0;
    const originalScrollX = Object.getOwnPropertyDescriptor(window, 'scrollX');
    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    const scrollTo = vi.mocked(window.scrollTo);

    try {
      Object.defineProperties(window, {
        scrollX: { configurable: true, get: () => scrollLeft },
        scrollY: { configurable: true, get: () => scrollTop },
      });
      renderApp('/', undefined, { focusNavigationProbe: true });
      const user = userEvent.setup();
      await screen.findByRole('heading', {
        level: 1,
        name: 'Master the Skills Shaping the Future',
      });

      scrollLeft = 18;
      scrollTop = 246;
      window.dispatchEvent(new Event('scroll'));
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Navigate pathname' }));
      });
      await screen.findByRole('heading', { level: 1, name: 'Log in' });

      scrollTo.mockClear();
      scrollLeft = 0;
      scrollTop = 0;
      window.dispatchEvent(new Event('scroll'));
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Navigate back' }));
      });

      await screen.findByRole('heading', {
        level: 1,
        name: 'Master the Skills Shaping the Future',
      });
      expect(scrollTo).toHaveBeenCalledWith(18, 246);
    } finally {
      if (originalScrollX) Object.defineProperty(window, 'scrollX', originalScrollX);
      else delete (window as { scrollX?: number }).scrollX;
      if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY);
      else delete (window as { scrollY?: number }).scrollY;
    }
  });

  it('closes mobile navigation when Escape is pressed while its trigger remains focused', async () => {
    stubViewportMatchMedia({ mobile: false, tablet: true });
    renderApp('/instructor/courses', 'instructor');
    await screen.findByRole('heading', { level: 1, name: 'Instructor courses' });
    await act(async () => {});
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await act(async () => {
      await user.click(trigger);
    });
    const drawer = await screen.findByRole('dialog', { name: 'Menu' });
    const closeNavigation = within(drawer).getByRole('button', { name: 'Close navigation' });
    await waitFor(() => expect(closeNavigation).toBe(document.activeElement));
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeTruthy();
    await act(async () => {
      await user.keyboard('{Escape}');
    });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBe(null));
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();
    await waitFor(() => expect(trigger).toBe(document.activeElement));
  });

  it('restores the mobile trigger after removing a hash from the current pathname and search', async () => {
    stubViewportMatchMedia({ mobile: false, tablet: true });
    renderApp('/instructor/courses#mobile-menu-focus', 'instructor');
    await screen.findByRole('heading', { level: 1, name: 'Instructor courses' });
    await act(async () => {});
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await act(async () => {
      await user.click(trigger);
    });
    const mobileNavigation = await screen.findByRole('navigation', {
      name: 'Mobile navigation',
    });
    const currentRouteLink = within(mobileNavigation).getByRole('link', {
      name: 'Instructor courses',
    });
    await act(async () => {
      await user.click(currentRouteLink);
    });

    await waitFor(() =>
      expect(screen.getByLabelText('current location').textContent).toBe('/instructor/courses'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBe(null),
    );
    await waitFor(() => expect(trigger).toBe(document.activeElement));
  });

  it('renders product copy without workflow or internal page metadata', async () => {
    const view = renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Log in' });
    expect(view.container.textContent).not.toMatch(/PAGE-\d+|FE-\d+|later task|scheduled/i);
    expect(view.container.textContent).toContain('Access your learning or instructor workspace.');
  });

  it('keeps protected-session recovery stable without backend detail', async () => {
    const client: ApiClient = {
      request: async () => {
        throw new Error('private upstream hostname and diagnostic details');
      },
    };
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ThemeProvider initialDensityMode="marketplace">
          <SessionProvider client={client} tokenStore={store('token')}>
            <MemoryRouter
              initialEntries={['/cart']}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              <ApplicationTitleBoundary>
                <AppRouter />
              </ApplicationTitleBoundary>
            </MemoryRouter>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Session check failed' });
    await waitFor(() => expect(document.title).toBe('Session check failed | LearnHub'));
    expect(screen.getByRole('alert').textContent).toContain(
      'We could not verify your session. Check your connection and try again.',
    );
    expect(document.body.textContent).not.toContain('private upstream hostname');
  });

  it('keeps an unknown route on the session-error title during a retryable bootstrap failure', async () => {
    const client: ApiClient = {
      request: async () => {
        throw new Error('private upstream hostname and diagnostic details');
      },
    };
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ThemeProvider initialDensityMode="marketplace">
          <SessionProvider client={client} tokenStore={store('token')}>
            <MemoryRouter
              initialEntries={['/does-not-exist']}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              <ApplicationTitleBoundary>
                <AppRouter />
              </ApplicationTitleBoundary>
            </MemoryRouter>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Session check failed' });
    await waitFor(() => expect(document.title).toBe('Session check failed | LearnHub'));
    expect(document.body.textContent).not.toContain('private upstream hostname');
  });

  it('keeps a guest recovery route usable after a retryable session bootstrap failure', async () => {
    const tokenStore = store('retained-token');
    const client: ApiClient = {
      request: async () => {
        throw new Error('private upstream hostname and diagnostic details');
      },
    };
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ThemeProvider initialDensityMode="marketplace">
          <SessionProvider client={client} tokenStore={tokenStore}>
            <MemoryRouter
              initialEntries={['/forgot-password']}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              <ApplicationTitleBoundary>
                <AppRouter />
              </ApplicationTitleBoundary>
            </MemoryRouter>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Forgot password' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Forgot password | LearnHub'));
    expect(screen.queryByRole('heading', { name: 'Session check failed' })).toBeNull();
    expect(tokenStore.get()).toBe('retained-token');
    expect(document.body.textContent).not.toContain('private upstream hostname');
  });

  it('keeps encoded login recovery usable after a retained-token bootstrap failure', async () => {
    const tokenStore = store('retained-token');
    const client: ApiClient = {
      request: async () => {
        throw new Error('private upstream hostname and diagnostic details');
      },
    };
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ThemeProvider initialDensityMode="marketplace">
          <SessionProvider client={client} tokenStore={tokenStore}>
            <MemoryRouter
              initialEntries={['/l%6Fgin']}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              <ApplicationTitleBoundary>
                <AppRouter />
              </ApplicationTitleBoundary>
            </MemoryRouter>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Session check failed' })).toBeNull();
    expect(document.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('auth');
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-density')).toBe('marketplace'),
    );
    await waitFor(() => expect(document.title).toBe('Log in | LearnHub'));
    expect(tokenStore.get()).toBe('retained-token');
    expect(document.body.textContent).not.toContain('private upstream hostname');
  });
});
