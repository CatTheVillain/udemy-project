// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AppShell } from '../../src/app/layouts/AppShell';
import { claimInstructorCoursesNewTabFocus } from '../../src/app/layouts/instructor-courses-focus-marker';
import { presentCart } from '../../src/app/layouts/navigation-presentation';
import { AppRouter } from '../../src/app/router/AppRouter';
import { SessionProvider, type AccessTokenStore } from '../../src/features/auth-session';
import { INSTRUCTOR_COURSE_CREATE_REQUEST_EVENT } from '../../src/features/instructor-courses';
import type { ApiClient, ApiRequestOptions } from '../../src/shared/api';
import { ThemeProvider } from '../../src/shared/ui/theme';
import { localeRuntime, LocaleProvider } from '../../src/shared/locale';

const APP_SHELL_STYLES = readFileSync(
  pathToFileURL(resolve(process.cwd(), 'src/app/layouts/AppShell.module.css')),
  'utf8',
);
const DESKTOP_MEDIA_QUERY_MARKER = '@media (min-width: 768px) {';
const desktopMediaQueryIndex = APP_SHELL_STYLES.lastIndexOf(DESKTOP_MEDIA_QUERY_MARKER);
if (desktopMediaQueryIndex < 0) {
  throw new Error(`AppShell desktop media query marker is missing: ${DESKTOP_MEDIA_QUERY_MARKER}`);
}
const DESKTOP_APP_SHELL_STYLES = APP_SHELL_STYLES.slice(desktopMediaQueryIndex);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  await localeRuntime.changeLanguage('en');
  localStorage.clear();
});

function tokenStore(token: string | null): AccessTokenStore {
  return { get: () => token, set() {}, clear() {} };
}

function cartResponse(itemCount: number) {
  return { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: itemCount };
}

function authenticatedClient(
  role: 'student' | 'instructor' | 'admin',
  cart = cartResponse(0),
): ApiClient {
  return {
    request: async <TResponse, TBody>(options: ApiRequestOptions<TBody, TResponse>) => {
      const value =
        options.path === '/me'
          ? {
              email: `${role}@example.test`,
              name: role,
              surname: 'User',
              role,
              birthday: null,
              phone_number: null,
              created_at: '2026-01-01T00:00:00Z',
            }
          : cart;
      return options.decode ? options.decode(value) : (value as TResponse);
    },
  };
}

function renderShell(client: ApiClient, token: string | null, path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialDensityMode="marketplace">
        <LocaleProvider>
          <SessionProvider client={client} tokenStore={tokenStore(token)}>
            <MemoryRouter initialEntries={[path]}>
              <AppShell />
              <LocationStateProbe />
            </MemoryRouter>
          </SessionProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function renderRouter(client: ApiClient, token: string | null, path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialDensityMode="marketplace">
        <LocaleProvider>
          <SessionProvider client={client} tokenStore={tokenStore(token)}>
            <MemoryRouter initialEntries={[path]}>
              <AppRouter />
            </MemoryRouter>
          </SessionProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

interface AppShellScrollHarness {
  readonly scrollToSpy: Mock<
    [leftOrOptions?: number | ScrollToOptions, topArgument?: number],
    void
  >;
  flushAnimationFrame(advanceMs?: number): void;
  getScrollTop(): number;
  setMaxScrollTop(value: number): void;
  setScrollTop(value: number): void;
}

function ScrollRestoreTestNavigation() {
  const navigate = useNavigate();

  return (
    <>
      <button type="button" onClick={() => navigate('/login')}>
        Go to login
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
    </>
  );
}

function renderScrollRestoreHarness(): AppShellScrollHarness {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let nowMs = 0;
  let maxScrollTop = Number.POSITIVE_INFINITY;
  let scrollTop = 0;
  let scrollLeft = 0;
  let nextAnimationFrameId = 1;
  const animationFrameCallbacks = new Map<number, FrameRequestCallback>();

  Object.defineProperty(window, 'scrollX', {
    configurable: true,
    get: () => scrollLeft,
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollTop,
  });

  const scrollToSpy: Mock<[leftOrOptions?: number | ScrollToOptions, topArgument?: number], void> =
    vi.fn((leftOrOptions?: number | ScrollToOptions, topArgument?: number) => {
      let nextLeft = scrollLeft;
      let nextTop = scrollTop;

      if (typeof leftOrOptions === 'object' && leftOrOptions !== null) {
        nextLeft = leftOrOptions.left ?? nextLeft;
        nextTop = leftOrOptions.top ?? nextTop;
      } else {
        nextLeft = typeof leftOrOptions === 'number' ? leftOrOptions : nextLeft;
        nextTop = typeof topArgument === 'number' ? topArgument : nextTop;
      }

      scrollLeft = nextLeft;
      scrollTop = Math.min(nextTop, maxScrollTop);
    });

  vi.stubGlobal('scrollTo', scrollToSpy);
  vi.spyOn(window.performance, 'now').mockImplementation(() => nowMs);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrameCallbacks.set(frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((frameId: number) => {
      animationFrameCallbacks.delete(frameId);
    }),
  );

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialDensityMode="marketplace">
        <LocaleProvider>
          <SessionProvider client={authenticatedClient('student')} tokenStore={tokenStore(null)}>
            <MemoryRouter initialEntries={['/']}>
              <ScrollRestoreTestNavigation />
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<h1>Catalog test page</h1>} />
                  <Route path="login" element={<h1>Login test page</h1>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </SessionProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return {
    scrollToSpy,
    flushAnimationFrame(advanceMs = 16) {
      nowMs += advanceMs;
      const scheduledFrames = [...animationFrameCallbacks.values()];
      animationFrameCallbacks.clear();
      for (const callback of scheduledFrames) {
        callback(nowMs);
      }
    },
    getScrollTop() {
      return scrollTop;
    },
    setMaxScrollTop(value: number) {
      maxScrollTop = value;
    },
    setScrollTop(value: number) {
      scrollTop = value;
    },
  };
}

function LocationStateProbe() {
  const location = useLocation();
  return <output aria-label="location state">{JSON.stringify(location.state)}</output>;
}

function stubCompactViewport(matches = true) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767.98px)' ? matches : false,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function stubTabletViewport(matches = true) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 768px) and (max-width: 1023px)' ? matches : false,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function stubFinePointer(matches = true) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(hover: hover) and (pointer: fine)' ? matches : false,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function firePointerTransition(
  target: Element,
  type: 'pointerover' | 'pointerout',
  pointerType: 'mouse' | 'touch',
) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(target, event);
}

interface ResidualLocaleExpectation {
  readonly locale: 'en' | 'ru' | 'uz';
  readonly logOut: string;
  readonly studentNavigation: string;
  readonly anonymousNavigation: string;
  readonly skipToMainContent: string;
  readonly learnHubHome: string;
  readonly createCourse: string;
}

interface HeaderNavigationLocaleExpectation {
  readonly locale: 'en' | 'ru' | 'uz';
  readonly catalog: string;
  readonly logIn: string;
  readonly signUp: string;
  readonly myLearning: string;
  readonly instructorCourses: string;
}

const RESIDUAL_LOCALE_EXPECTATIONS: readonly ResidualLocaleExpectation[] = [
  {
    locale: 'en',
    logOut: 'Log out',
    studentNavigation: 'Student navigation',
    anonymousNavigation: 'Anonymous navigation',
    skipToMainContent: 'Skip to main content',
    learnHubHome: 'LearnHub home',
    createCourse: 'Create course',
  },
  {
    locale: 'ru',
    logOut: 'Выйти',
    studentNavigation: 'Навигация студента',
    anonymousNavigation: 'Навигация гостя',
    skipToMainContent: 'Перейти к основному содержимому',
    learnHubHome: 'Главная LearnHub',
    createCourse: 'Создать курс',
  },
  {
    locale: 'uz',
    logOut: 'Chiqish',
    studentNavigation: 'Talaba navigatsiyasi',
    anonymousNavigation: 'Mehmon navigatsiyasi',
    skipToMainContent: "Asosiy mazmunga o'tish",
    learnHubHome: 'LearnHub bosh sahifasi',
    createCourse: 'Kurs yaratish',
  },
];

const HEADER_NAVIGATION_LOCALE_EXPECTATIONS: readonly HeaderNavigationLocaleExpectation[] = [
  {
    locale: 'en',
    catalog: 'Catalog',
    logIn: 'Log in',
    signUp: 'Sign up',
    myLearning: 'My learning',
    instructorCourses: 'Instructor courses',
  },
  {
    locale: 'ru',
    catalog: 'Каталог',
    logIn: 'Войти',
    signUp: 'Регистрация',
    myLearning: 'Моё обучение',
    instructorCourses: 'Курсы преподавателя',
  },
  {
    locale: 'uz',
    catalog: 'Katalog',
    logIn: 'Kirish',
    signUp: 'Ro‘yxatdan o‘tish',
    myLearning: 'Ta’limim',
    instructorCourses: 'O‘qituvchi kurslari',
  },
];

describe('AppShell student cart query and presentation', () => {
  it('atomically consumes an explicit instructor-collection new-tab focus marker before focus can run', () => {
    localStorage.clear();
    const requestedAt = Date.now();
    localStorage.setItem(
      'learnhub.instructor-courses.new-tab-focus',
      JSON.stringify({
        destination: '/instructor/courses',
        requestedAt,
        sourcePath: '/instructor/courses/42/edit',
      }),
    );

    expect(
      claimInstructorCoursesNewTabFocus(
        '/instructor/courses',
        `${window.location.origin}/instructor/courses/42/edit`,
        requestedAt,
      ),
    ).toBe(true);

    // The first receiver may unmount before its scheduled focus callback. A second receiver
    // must not replay the marker during that gap.
    expect(
      claimInstructorCoursesNewTabFocus(
        '/instructor/courses',
        `${window.location.origin}/instructor/courses/42/edit`,
        requestedAt,
      ),
    ).toBe(false);
    expect(localStorage.getItem('learnhub.instructor-courses.new-tab-focus')).toBeNull();

    for (const invalidReferrer of ['', 'not a URL']) {
      localStorage.setItem(
        'learnhub.instructor-courses.new-tab-focus',
        JSON.stringify({
          destination: '/instructor/courses',
          requestedAt,
          sourcePath: '/instructor/courses/42/edit',
        }),
      );

      expect(
        claimInstructorCoursesNewTabFocus('/instructor/courses', invalidReferrer, requestedAt),
      ).toBe(false);
      expect(localStorage.getItem('learnhub.instructor-courses.new-tab-focus')).toBeNull();
      expect(
        claimInstructorCoursesNewTabFocus(
          '/instructor/courses',
          `${window.location.origin}/instructor/courses/42/edit`,
          requestedAt,
        ),
      ).toBe(false);
    }

    expect(
      claimInstructorCoursesNewTabFocus(
        '/instructor/courses/42/edit',
        `${window.location.origin}/instructor/courses/42/edit`,
        requestedAt,
      ),
    ).toBe(false);

    localStorage.setItem(
      'learnhub.instructor-courses.new-tab-focus',
      JSON.stringify({
        destination: '/instructor/courses',
        requestedAt,
        sourcePath: '/instructor/courses/42/edit',
      }),
    );
    expect(
      claimInstructorCoursesNewTabFocus(
        '/instructor/courses',
        `${window.location.origin}/instructor/courses/43/edit`,
        requestedAt,
      ),
    ).toBe(false);
    expect(localStorage.getItem('learnhub.instructor-courses.new-tab-focus')).toBeNull();

    localStorage.setItem(
      'learnhub.instructor-courses.new-tab-focus',
      JSON.stringify({
        destination: '/instructor/courses',
        requestedAt,
        sourcePath: '/instructor/courses/42/edit',
      }),
    );
    expect(
      claimInstructorCoursesNewTabFocus(
        '/instructor/courses',
        'https://untrusted.example/instructor/courses/42/edit',
        requestedAt,
      ),
    ).toBe(false);
    expect(localStorage.getItem('learnhub.instructor-courses.new-tab-focus')).toBeNull();
  });

  it('rejects and consumes malformed instructor-collection new-tab focus markers', () => {
    const requestedAt = Date.now();
    const malformedMarkers: readonly unknown[] = [
      null,
      [],
      {},
      {
        destination: '/instructor/courses',
        sourcePath: '/instructor/courses/42/edit',
      },
      {
        destination: '/instructor/courses',
        requestedAt: String(requestedAt),
        sourcePath: '/instructor/courses/42/edit',
      },
      {
        destination: 42,
        requestedAt,
        sourcePath: '/instructor/courses/42/edit',
      },
      {
        destination: '/instructor/courses',
        requestedAt,
        sourcePath: false,
      },
      {
        destination: '/instructor/courses',
        requestedAt: Number.MAX_VALUE,
        sourcePath: '/instructor/courses/42/edit',
      },
    ];

    for (const marker of malformedMarkers) {
      const serialized = JSON.stringify(marker);
      if (serialized === undefined)
        throw new Error('Malformed marker fixture must be serializable');
      localStorage.setItem('learnhub.instructor-courses.new-tab-focus', serialized);

      expect(
        claimInstructorCoursesNewTabFocus(
          '/instructor/courses',
          `${window.location.origin}/instructor/courses/42/edit`,
          requestedAt,
        ),
      ).toBe(false);
      expect(localStorage.getItem('learnhub.instructor-courses.new-tab-focus')).toBeNull();
      expect(
        claimInstructorCoursesNewTabFocus(
          '/instructor/courses',
          `${window.location.origin}/instructor/courses/42/edit`,
          requestedAt,
        ),
      ).toBe(false);
    }
  });

  it('renders the compact anonymous header and fallback navigation below the desktop breakpoint', async () => {
    stubCompactViewport();
    renderShell(authenticatedClient('student'), null, '/');

    const header = document.querySelector<HTMLElement>('[data-app-shell-header]');
    expect(header?.className).toContain('headerAnonymousMobile');
    expect(await screen.findByRole('navigation', { name: 'Anonymous navigation' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cart' })).toBeNull();
    expect(APP_SHELL_STYLES).toContain('@media (max-width: 767.98px) {');
    expect(APP_SHELL_STYLES).toContain('@media (min-width: 480px) and (max-width: 767.98px) {');
  });

  it.each(HEADER_NAVIGATION_LOCALE_EXPECTATIONS)(
    'localizes desktop and instructor-compact navigation through the one runtime in $locale',
    async ({ locale, catalog, logIn, signUp, myLearning, instructorCourses }) => {
      localStorage.setItem('learnhub.locale', locale);
      renderShell(authenticatedClient('student'), null, '/');

      const primaryNavigation = await screen.findByRole('navigation', {
        name: /Primary navigation|Основная навигация|Asosiy navigatsiya/,
      });
      const accountNavigation = screen.getByRole('navigation', {
        name: /Account navigation|Навигация по аккаунту|Akkaunt navigatsiyasi/,
      });
      expect(
        within(primaryNavigation).getByRole('link', { name: catalog }).getAttribute('href'),
      ).toBe('/');
      expect(
        within(accountNavigation).getByRole('link', { name: logIn }).getAttribute('href'),
      ).toBe('/login');
      expect(
        within(accountNavigation).getByRole('link', { name: signUp }).getAttribute('href'),
      ).toBe('/signup');
      cleanup();

      renderShell(authenticatedClient('student'), 'student-token', '/learning');
      const studentNavigation = await screen.findByRole('navigation', {
        name: /Primary navigation|Основная навигация|Asosiy navigatsiya/,
      });
      expect(
        within(studentNavigation).getByRole('link', { name: catalog }).getAttribute('href'),
      ).toBe('/');
      expect(
        (await within(studentNavigation).findByRole('link', { name: myLearning })).getAttribute(
          'href',
        ),
      ).toBe('/learning');
      cleanup();

      stubCompactViewport();
      renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');
      const mobileNavigationTrigger = await screen.findByRole('button', {
        name: /Open navigation|Открыть навигацию|Navigatsiyani ochish/,
      });
      fireEvent.click(mobileNavigationTrigger);
      const compactNavigation = await screen.findByRole('navigation', {
        name: /Mobile navigation|Мобильная навигация|Mobil navigatsiya/,
      });
      expect(
        within(compactNavigation)
          .getByRole('link', { name: instructorCourses })
          .getAttribute('href'),
      ).toBe('/instructor/courses');
      expect(
        within(compactNavigation).getByRole('button', {
          name: /Create course|Создать курс|Kurs yaratish/,
        }),
      ).toBeTruthy();
      expect(document.querySelector('[data-part="instructor-course-actions"]')).toBeNull();
    },
  );

  it('keeps Instructor courses active beside LearnHub and styles Create course as the active header action', async () => {
    const request = vi.fn(
      async <TResponse, TBody>(options: ApiRequestOptions<TBody, TResponse>) => {
        if (options.path === '/me')
          return options.decode?.({
            email: 'instructor@example.test',
            name: 'instructor',
            surname: 'User',
            role: 'instructor',
            birthday: null,
            phone_number: null,
            created_at: '2026-01-01T00:00:00Z',
          }) as TResponse;
        if (options.path === '/courses/my')
          return options.decode?.({
            items: [],
            page: 1,
            page_size: 20,
            total: 0,
            pages: 1,
            has_next: false,
            has_previous: false,
          }) as TResponse;
        throw new Error(`Unexpected request ${options.path}`);
      },
    );
    renderRouter(
      { request: request as ApiClient['request'] },
      'instructor-token',
      '/instructor/courses?source=header#creation',
    );

    const routeLink = await screen.findByRole('link', { name: 'Instructor courses' });
    const header = document.querySelector<HTMLElement>('[data-app-shell-header]');
    const createAction = within(header!).getByRole('button', { name: 'Create course' });
    const user = userEvent.setup();

    expect(routeLink.getAttribute('href')).toBe('/instructor/courses');
    expect(routeLink.getAttribute('aria-current')).toBe('page');
    expect(header!.contains(routeLink)).toBe(true);
    expect(header!.contains(createAction)).toBe(true);
    expect(createAction.className).toContain('navLink');
    expect(createAction.className).toContain('navAction');
    expect(screen.queryByRole('textbox', { name: 'Course title' })).toBeNull();

    await act(async () => {
      await user.click(createAction);
    });
    const titleTarget = await screen.findByRole('textbox', { name: 'Course title' });
    await waitFor(() => expect(document.activeElement).toBe(titleTarget));
    expect(request.mock.calls.map(([options]) => options.path)).toEqual(['/me', '/courses/my']);
  });

  it.each(['/instructor/courses/7/edit', '/instructor/courses/7/enrollments'])(
    'keeps Instructor courses beside LearnHub on %s',
    async (path) => {
      renderShell(authenticatedClient('instructor'), 'instructor-token', path);

      const routeLink = await screen.findByRole('link', { name: 'Instructor courses' });
      const header = document.querySelector<HTMLElement>('[data-app-shell-header]');
      const headerStart = header?.querySelector<HTMLElement>('[class*="headerCatalogStart"]');
      const headerEnd = header?.querySelector<HTMLElement>('[class*="headerCatalogEnd"]');

      expect(headerStart?.contains(routeLink)).toBe(true);
      expect(headerEnd?.contains(routeLink)).toBe(false);
      expect(header?.className).toContain('headerInstructorCourses');
      expect(routeLink.getAttribute('href')).toBe('/instructor/courses');
      expect(routeLink.getAttribute('aria-current')).toBeNull();
      expect(routeLink.className).not.toContain('navLinkActive');
    },
  );

  it('fetches API-002 immediately for a student through the current cache epoch and renders zero', async () => {
    const request = vi.fn(authenticatedClient('student').request);
    const client = renderShell({ request: request as ApiClient['request'] }, 'student-token');

    expect(await screen.findByRole('link', { name: 'Cart (0)' })).toBeTruthy();
    expect(request.mock.calls.map(([options]) => options.path)).toEqual(['/me', '/cart']);
    expect(
      [...client.getQueryCache().getAll()].some((query) => query.queryKey[2] === 'API-002'),
    ).toBe(true);
  });

  it.each([
    [undefined, null],
    [1, '1'],
    [9, '9'],
    [10, '10'],
    [99, '99'],
    [100, '99+'],
  ])(
    'presents cart count %s as badge %s',
    (itemCount: number | undefined, badge: string | null) => {
      expect(presentCart(itemCount)).toEqual({ badge });
    },
  );

  it('does not fetch API-002 or render assistant controls for anonymous, instructor, or admin sessions', async () => {
    const anonymousRequest = vi.fn(authenticatedClient('student').request);
    renderShell({ request: anonymousRequest as ApiClient['request'] }, null);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Catalog' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Cart' }).getAttribute('href')).toBe('/cart');
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).toBeNull();
    expect(anonymousRequest).not.toHaveBeenCalled();
    cleanup();

    const instructorRequest = vi.fn(authenticatedClient('instructor').request);
    renderShell(
      { request: instructorRequest as ApiClient['request'] },
      'instructor-token',
      '/instructor/courses',
    );
    await waitFor(() =>
      expect(instructorRequest.mock.calls.map(([options]) => options.path)).toEqual(['/me']),
    );
    expect(screen.queryByRole('link', { name: /Cart/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).toBeNull();
    cleanup();

    const adminRequest = vi.fn(authenticatedClient('admin').request);
    renderShell({ request: adminRequest as ApiClient['request'] }, 'admin-token');
    await waitFor(() =>
      expect(adminRequest.mock.calls.map(([options]) => options.path)).toEqual(['/me']),
    );
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).toBeNull();
  });

  it('keeps anonymous desktop auth actions secondary and removes Cart from compact DOM order', async () => {
    stubCompactViewport();
    renderShell(authenticatedClient('student'), null, '/login');

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    await waitFor(() =>
      expect(within(primaryNavigation).getByRole('link', { name: 'Catalog' })).toBeTruthy(),
    );
    const accountNavigation = screen.getByRole('navigation', { name: 'Account navigation' });
    const login = within(accountNavigation).getByRole('link', { name: 'Log in' });

    expect(within(primaryNavigation).queryByRole('link', { name: 'Log in' })).toBeNull();
    expect(login.getAttribute('aria-current')).toBe('page');
    expect(login.className).toContain('navLinkLogin');
    expect(screen.queryByRole('link', { name: 'Cart' })).toBeNull();
    expect(
      [...document.querySelectorAll('a')].map((link) => link.textContent?.trim()),
    ).not.toContain('Cart');
  });

  it('uses the updated shared cache entry and marks the cart active beyond its count', async () => {
    const client = renderShell(authenticatedClient('student'), 'student-token', '/cart');
    const cart = await screen.findByRole('link', { name: 'Cart (0)' });
    expect(cart.getAttribute('aria-current')).toBe('page');
    expect(cart.querySelector('svg')).toBeTruthy();

    const cartQuery = client
      .getQueryCache()
      .getAll()
      .find(
        (query) =>
          typeof query.state.data === 'object' &&
          query.state.data !== null &&
          'itemCount' in query.state.data,
      );
    expect(cartQuery).toBeTruthy();
    client.setQueryData(cartQuery?.queryKey ?? ['missing-cart-query'], {
      id: 1,
      items: [],
      totalPrice: '0.00',
      currency: 'USD',
      itemCount: 9,
    });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Cart (9)' })).toBeTruthy());
  });

  it.each([
    { compact: false, label: 'desktop Cart link' },
    { compact: true, label: 'student-mobile Cart link' },
  ])('carries the exact internal source in Router state from the $label', async ({ compact }) => {
    if (compact) stubCompactViewport();
    renderShell(authenticatedClient('student'), 'student-token', '/learning?page=2#courses');

    const cart = await screen.findByRole('link', { name: 'Cart (0)' });
    fireEvent.click(cart);

    expect(screen.getByLabelText('location state').textContent).toBe(
      JSON.stringify({ returnTo: '/learning?page=2#courses' }),
    );
    cleanup();
  });

  it('uses decorative outline icons in desktop named links without changing Cart or Profile semantics', async () => {
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const brand = await screen.findByRole('link', { name: 'LearnHub home' });
    const assistant = screen.getByRole('link', { name: 'Open AI assistant' });
    const cart = await screen.findByRole('link', { name: 'Cart (0)' });
    const profile = screen.getByRole('button', { name: 'Account menu for student User' });
    const brandMark = brand.querySelector('img');
    const assistantIcon = assistant.querySelector('svg');

    expect(brandMark?.getAttribute('aria-hidden')).toBe('true');
    expect(brandMark?.getAttribute('alt')).toBe('');
    expect(brandMark?.getAttribute('src')).toContain('learnhub-book-ui018.png');
    expect(assistant.querySelector('img')).toBeNull();
    expect(assistantIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(assistantIcon?.getAttribute('focusable')).toBe('false');
    expect(assistantIcon?.getAttribute('width')).toBe('28');
    expect(assistantIcon?.getAttribute('height')).toBe('28');
    expect(assistantIcon?.getAttribute('stroke-width')).toBe('1.75');
    expect(cart.querySelector('svg')?.getAttribute('width')).toBe('25');
    expect(cart.querySelector('svg')?.getAttribute('height')).toBe('25');
    expect(cart.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.75');
    expect(profile.getAttribute('aria-expanded')).toBe('false');
  });

  it('delays the AI assistant tooltip for pointers, opens it on focus, and keeps Escape dismissed until blur', async () => {
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const assistant = await screen.findByRole('link', { name: 'Open AI assistant' });
    vi.useFakeTimers();
    expect(screen.queryByRole('tooltip', { name: 'AI chat' })).toBeNull();

    await act(() => fireEvent.pointerEnter(assistant));
    await act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByRole('tooltip', { name: 'AI chat' })).toBeNull();
    await act(() => vi.advanceTimersByTime(1));
    const pointerTooltip = screen.getByRole('tooltip', { name: 'AI chat' });
    expect(assistant.getAttribute('aria-describedby')).toBe(pointerTooltip.id);

    await act(() => fireEvent.pointerLeave(assistant));
    expect(screen.queryByRole('tooltip', { name: 'AI chat' })).toBeNull();

    void act(() => assistant.focus());
    const focusTooltip = screen.getByRole('tooltip', { name: 'AI chat' });
    expect(assistant.getAttribute('aria-describedby')).toBe(focusTooltip.id);
    expect(document.activeElement).toBe(assistant);

    await act(() => fireEvent.keyDown(assistant, { key: 'Escape' }));
    expect(screen.queryByRole('tooltip', { name: 'AI chat' })).toBeNull();
    expect(document.activeElement).toBe(assistant);

    await act(() => fireEvent.pointerEnter(assistant));
    await act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip', { name: 'AI chat' })).toBeNull();

    await act(() => fireEvent.blur(assistant));
    await act(() => fireEvent.pointerLeave(assistant));
    await act(() => fireEvent.pointerEnter(assistant));
    await act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip', { name: 'AI chat' })).toBeTruthy();
  });

  it('renders one accessible LearnHub brand with the shell landmarks through the DOM', async () => {
    renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');

    const brand = await screen.findByRole('link', { name: 'LearnHub home' });
    expect(screen.getAllByRole('link', { name: 'LearnHub home' })).toHaveLength(1);
    expect(brand.textContent?.trim()).toBe('LearnHub');
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getByRole('main').getAttribute('id')).toBe('main-content');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
  });

  it.each(RESIDUAL_LOCALE_EXPECTATIONS)(
    'localizes every DRAFT-18 AppShell and AccountMenu seam in $locale',
    async ({
      locale,
      logOut,
      studentNavigation,
      anonymousNavigation,
      skipToMainContent,
      learnHubHome,
      createCourse,
    }) => {
      localStorage.setItem('learnhub.locale', locale);
      renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');

      const brand = await screen.findByRole('link', { name: learnHubHome });
      expect(brand.textContent?.trim()).toBe('LearnHub');
      expect(brand.getAttribute('href')).toBe('/instructor/courses');
      expect(screen.getByRole('link', { name: skipToMainContent }).getAttribute('href')).toBe(
        '#main-content',
      );
      expect(screen.getByRole('button', { name: createCourse })).toBeTruthy();
      fireEvent.click(
        screen.getByRole('button', {
          name: new RegExp('Account menu|Меню аккаунта|akkaunt menyusi'),
        }),
      );
      expect(screen.getByRole('button', { name: logOut })).toBeTruthy();
      cleanup();

      stubCompactViewport();
      renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');
      await screen.findByRole('button', {
        name: new RegExp('Account menu|Меню аккаунта|akkaunt menyusi'),
      });
      const mobileNavigationTrigger = screen.getByRole('button', {
        name: /Open navigation|Открыть навигацию|Navigatsiyani ochish/,
      });
      fireEvent.click(mobileNavigationTrigger);
      expect(
        within(
          await screen.findByRole('navigation', {
            name: /Mobile navigation|Мобильная навигация|Mobil navigatsiya/,
          }),
        ).getByRole('button', { name: createCourse }),
      ).toBeTruthy();
      cleanup();

      renderShell(authenticatedClient('student'), 'student-token');
      expect(await screen.findByRole('navigation', { name: studentNavigation })).toBeTruthy();
      cleanup();

      renderShell(authenticatedClient('student'), null);
      expect(screen.getByRole('navigation', { name: anonymousNavigation })).toBeTruthy();
    },
  );

  it('renders the Instructor LearnHub brand as an accessible Instructor courses home link', async () => {
    renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');
    const user = userEvent.setup();

    await screen.findByRole('link', { name: 'Instructor courses' });
    const header = document.querySelector<HTMLElement>('[data-app-shell-header]');
    const brandMark = header?.querySelector<HTMLImageElement>(
      'img[src*="learnhub-book-ui018.png"]',
    );
    const brand = brandMark?.parentElement;

    const brandLink = screen.getByRole('link', { name: 'LearnHub home' });
    expect(brand?.textContent?.trim()).toBe('LearnHub');
    expect(brandLink.getAttribute('href')).toBe('/instructor/courses');
    expect(brandMark?.getAttribute('aria-hidden')).toBe('true');
    expect(brandMark?.getAttribute('alt')).toBe('');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
    await user.tab();
    expect(document.activeElement).toBe(brandLink);
  });

  it.each([
    { locale: 'ru', logInLabel: 'Войти' },
    { locale: 'uz', logInLabel: 'Kirish' },
  ] as const)(
    'keeps the $locale device locale through Log out and a shell remount',
    async ({ locale, logInLabel }) => {
      localStorage.setItem('learnhub.locale', locale);
      renderShell(authenticatedClient('student'), 'student-token');
      const accountTrigger = await screen.findByRole('button', {
        name: /account menu|меню аккаунта|akkaunt menyusi/i,
      });
      expect(accountTrigger.getAttribute('title')).toBeNull();
      expect(accountTrigger.getAttribute('aria-controls')).toBeNull();

      fireEvent.mouseEnter(accountTrigger);
      const accountDetails = screen.getByRole('group', {
        name: /account details|данные аккаунта|akkaunt/i,
      });
      expect(accountDetails).toBeTruthy();
      expect(accountTrigger.getAttribute('aria-controls')).toBe(accountDetails.id);
      expect(screen.getByText('student@example.test')).toBeTruthy();
      expect(screen.getByText('student User')).toBeTruthy();
      expect(
        accountDetails.querySelector('[data-part="account-menu-profile"]')?.textContent,
      ).toContain('student User');
      expect(screen.getByRole('separator')).toBeTruthy();

      fireEvent.click(accountTrigger);
      expect(accountTrigger.getAttribute('aria-expanded')).toBe('true');

      fireEvent.click(accountTrigger);
      expect(accountTrigger.getAttribute('aria-expanded')).toBe('false');
      expect(accountTrigger.getAttribute('aria-controls')).toBeNull();
      expect(
        screen.queryByRole('group', { name: /account details|данные аккаунта|akkaunt/i }),
      ).toBeNull();

      fireEvent.click(accountTrigger);
      expect(accountTrigger.getAttribute('aria-expanded')).toBe('true');
      expect(
        screen.getByRole('group', { name: /account details|данные аккаунта|akkaunt/i }),
      ).toBeTruthy();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('group', { name: 'Account details for student User' })).toBeNull();
      expect(accountTrigger.getAttribute('aria-controls')).toBeNull();
      expect(document.activeElement).toBe(accountTrigger);

      fireEvent.click(accountTrigger);
      const logout = screen.getByRole('button', { name: /log out|выйти|chiqish/i });
      expect(logout.querySelector('svg')).toBeTruthy();
      fireEvent.click(logout);
      await waitFor(() => expect(screen.getByRole('link', { name: logInLabel })).toBeTruthy());
      expect(
        screen.queryByRole('button', { name: /account menu|меню аккаунта|akkaunt menyusi/i }),
      ).toBeNull();
      expect(localStorage.getItem('learnhub.locale')).toBe(locale);
      expect(document.documentElement.lang).toBe(locale);

      cleanup();
      renderShell(authenticatedClient('student'), null);
      expect(await screen.findByRole('link', { name: logInLabel })).toBeTruthy();
      expect(document.documentElement.lang).toBe(locale);
    },
  );

  it('completes explicit logout without touching locale storage', async () => {
    renderShell(authenticatedClient('student'), 'student-token');
    const accountTrigger = await screen.findByRole('button', {
      name: 'Account menu for student User',
    });
    fireEvent.click(accountTrigger);
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('removal denied');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy());
    expect(removeItem).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe('en');
  });

  it.each([
    { locale: 'en', role: 'student', label: 'Student' },
    { locale: 'ru', role: 'instructor', label: 'Преподаватель' },
    { locale: 'uz', role: 'admin', label: 'Administrator' },
  ] as const)(
    'renders the $role account role as $label in $locale and retains same-trigger reopening',
    async ({ locale, role, label }) => {
      localStorage.setItem('learnhub.locale', locale);
      renderShell(authenticatedClient(role), `${role}-token`);

      const accountTrigger = await screen.findByRole('button', {
        name: /account menu|меню аккаунта|akkaunt menyusi/i,
      });
      fireEvent.click(accountTrigger);
      expect(screen.getByText(label, { exact: true })).toBeTruthy();

      fireEvent.click(accountTrigger);
      expect(accountTrigger.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(accountTrigger);
      expect(accountTrigger.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText(label, { exact: true })).toBeTruthy();
    },
  );

  it('restores account focus when scroll removes its focused details without stealing outside focus', async () => {
    renderShell(authenticatedClient('student'), 'student-token');
    const accountTrigger = await screen.findByRole('button', {
      name: 'Account menu for student User',
    });

    fireEvent.click(accountTrigger);
    const logout = screen.getByRole('button', { name: 'Log out' });
    act(() => logout.focus());
    expect(document.activeElement).toBe(logout);

    fireEvent.scroll(window);
    expect(screen.queryByRole('group', { name: 'Account details for student User' })).toBeNull();
    expect(document.activeElement).toBe(accountTrigger);

    fireEvent.click(accountTrigger);
    const outsideTarget = document.createElement('button');
    document.body.append(outsideTarget);
    act(() => outsideTarget.focus());
    fireEvent.pointerDown(outsideTarget);
    expect(screen.queryByRole('group', { name: 'Account details for student User' })).toBeNull();
    expect(document.activeElement).toBe(outsideTarget);
    outsideTarget.remove();
  });

  it('uses one route-only labelled bottom navigation for authenticated student mobile', async () => {
    stubCompactViewport();
    const request = vi.fn(authenticatedClient('student').request);
    renderShell({ request: request as ApiClient['request'] }, 'student-token');

    const studentNavigation = await screen.findByRole('navigation', { name: 'Student navigation' });
    expect(
      within(studentNavigation).getByRole('link', { name: 'Catalog' }).getAttribute('href'),
    ).toBe('/');
    expect(
      within(studentNavigation).getByRole('link', { name: 'My learning' }).getAttribute('href'),
    ).toBe('/learning');
    const mobileAssistant = within(studentNavigation).getByRole('link', { name: 'AI chat' });
    expect(mobileAssistant.getAttribute('href')).toBe('/ai-chat');
    expect(mobileAssistant.querySelector('svg')?.getAttribute('width')).toBe('20');
    expect(mobileAssistant.querySelector('svg')?.getAttribute('height')).toBe('20');
    await waitFor(() =>
      expect(within(studentNavigation).getByRole('link', { name: 'Cart (0)' })).toBeTruthy(),
    );
    expect(
      within(studentNavigation).getByRole('link', { name: 'Cart (0)' }).getAttribute('href'),
    ).toBe('/cart');
    expect(screen.getByRole('button', { name: 'Account menu for student User' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open navigation|Close navigation/ })).toBeNull();

    fireEvent.click(mobileAssistant);
    expect(request.mock.calls.map(([options]) => options.path)).toEqual(['/me', '/cart']);
  });

  it.each(['student', 'instructor', 'admin'] as const)(
    'uses the authenticated responsive header for %s at the mobile breakpoint',
    async (role) => {
      stubCompactViewport();
      renderShell(authenticatedClient(role), `${role}-token`);

      await screen.findByRole('button', { name: `Account menu for ${role} User` });
      const header = document.querySelector<HTMLElement>('[data-app-shell-header]');

      expect(header?.className).toContain('headerAuthenticatedMobile');
      expect(header?.className).not.toContain('headerAnonymousMobile');
    },
  );

  it('combines authenticated tablet profile and navigation in one role-aware drawer', async () => {
    stubTabletViewport();
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    await screen.findByRole('button', { name: 'Open navigation' });
    const header = document.querySelector<HTMLElement>('[data-app-shell-header]');
    expect(header).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Account menu for student User' })).toBeNull();
    expect(within(header!).queryByRole('link', { name: 'Open AI assistant' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Menu' });
    expect(within(drawer).getByText('student User')).toBeTruthy();
    expect(within(drawer).queryByText('student@example.test')).toBeNull();
    expect(within(drawer).getByRole('link', { name: 'Catalog' }).getAttribute('href')).toBe('/');
    expect(within(drawer).getByRole('link', { name: 'My learning' }).getAttribute('href')).toBe(
      '/learning',
    );
    expect(within(drawer).getByRole('link', { name: 'AI chat' }).getAttribute('href')).toBe(
      '/ai-chat',
    );
    expect(within(drawer).getByRole('button', { name: 'Log out' })).toBeTruthy();
  });

  it('keeps compact Instructor actions ordered, removes the duplicate header creation action, and retains drawer creation', async () => {
    stubCompactViewport();
    renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');

    const menu = await screen.findByRole('button', { name: 'Open navigation' });
    const profile = screen.getByRole('button', { name: 'Account menu for instructor User' });
    const language = screen.getByRole('button', { name: 'Change language' });

    expect(menu.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      profile.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create course' })).toBeNull();

    fireEvent.click(menu);
    const drawer = await screen.findByRole('dialog', { name: 'Menu' });
    expect(within(drawer).getByRole('button', { name: 'Create course' })).toBeTruthy();
  });

  it('waits for the Instructor drawer to close before requesting the create course form', async () => {
    stubCompactViewport();
    renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');
    const createRequests = vi.fn();
    document.addEventListener(INSTRUCTOR_COURSE_CREATE_REQUEST_EVENT, createRequests);

    try {
      fireEvent.click(await screen.findByRole('button', { name: 'Open navigation' }));
      const drawer = await screen.findByRole('dialog', { name: 'Menu' });
      fireEvent.click(within(drawer).getByRole('button', { name: 'Create course' }));

      expect(createRequests).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
      await waitFor(() => expect(createRequests).toHaveBeenCalledTimes(1));
    } finally {
      document.removeEventListener(INSTRUCTOR_COURSE_CREATE_REQUEST_EVENT, createRequests);
    }
  });

  it.each([
    ['Русский', 'Навигация студента'],
    ["O'zbek", 'Talaba navigatsiyasi'],
  ])(
    'updates the student mobile navigation landmark after selecting %s',
    async (localeOption, label) => {
      stubCompactViewport();
      renderShell(authenticatedClient('student'), 'student-token', '/learning');

      await screen.findByRole('button', { name: 'Account menu for student User' });
      fireEvent.click(screen.getByRole('button', { name: 'Change language' }));
      fireEvent.click(screen.getByRole('button', { name: localeOption }));

      expect(await screen.findByRole('navigation', { name: label })).toBeTruthy();
    },
  );

  it.each([
    ['Русский', 'Навигация гостя'],
    ["O'zbek", 'Mehmon navigatsiyasi'],
  ])(
    'updates the anonymous mobile navigation landmark after selecting %s',
    async (localeOption, label) => {
      stubCompactViewport();
      renderShell(authenticatedClient('student'), null);

      fireEvent.click(await screen.findByRole('button', { name: 'Change language' }));
      fireEvent.click(screen.getByRole('button', { name: localeOption }));

      expect(await screen.findByRole('navigation', { name: label })).toBeTruthy();
    },
  );

  it('changes the desktop language through the labelled selector without changing the route', async () => {
    const request = vi.fn(authenticatedClient('student').request);
    renderShell({ request: request as ApiClient['request'] }, 'student-token', '/learning');

    const trigger = await screen.findByRole('button', { name: 'Change language' });
    expect(trigger.textContent).toBe('EN');
    expect(trigger.querySelector('.lucide-chevron-down')).toBeTruthy();
    expect(trigger.querySelector('.lucide-globe')).toBeNull();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(trigger);
    });
    const russian = screen.getByRole('button', { name: 'Русский' });
    await act(async () => {
      await user.click(russian);
    });

    expect(localStorage.getItem('learnhub.locale')).toBe('ru');
    expect(screen.getByRole('button', { name: 'Изменить язык' })).toBeTruthy();
  });

  it.each([
    {
      localeOption: 'Русский',
      role: 'anonymous' as const,
      token: null,
      path: '/',
      labels: ['Каталог', 'Войти', 'Регистрация'],
    },
    {
      localeOption: "O'zbek",
      role: 'student' as const,
      token: 'student-token',
      path: '/learning',
      labels: ['Katalog', 'Ta’limim'],
    },
    {
      localeOption: 'Русский',
      role: 'instructor' as const,
      token: 'instructor-token',
      path: '/instructor/courses',
      labels: ['Курсы преподавателя'],
    },
  ])(
    'updates $role desktop navigation after choosing $localeOption',
    async ({ localeOption, role, token, path, labels }) => {
      renderShell(authenticatedClient(role === 'anonymous' ? 'student' : role), token, path);

      fireEvent.click(await screen.findByRole('button', { name: 'Change language' }));
      fireEvent.click(screen.getByRole('button', { name: localeOption }));

      for (const label of labels) {
        expect(await screen.findByRole('link', { name: label })).toBeTruthy();
      }
    },
  );

  it('restores a focused desktop locale option to its trigger when scroll dismisses the menu', async () => {
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const trigger = await screen.findByRole('button', { name: 'Change language' });
    fireEvent.click(trigger);
    const russian = screen.getByRole('button', { name: 'Русский' });
    act(() => russian.focus());
    expect(document.activeElement).toBe(russian);

    fireEvent.scroll(window);

    expect(screen.queryByRole('button', { name: 'Русский' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal unrelated focus when scroll dismisses the desktop locale menu', async () => {
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const trigger = await screen.findByRole('button', { name: 'Change language' });
    fireEvent.click(trigger);
    const outsideTarget = document.createElement('button');
    document.body.append(outsideTarget);
    act(() => outsideTarget.focus());

    fireEvent.scroll(window);

    expect(screen.queryByRole('button', { name: 'Русский' })).toBeNull();
    expect(document.activeElement).toBe(outsideTarget);
    outsideTarget.remove();
  });

  it('closes the desktop locale menu when focus moves outside while preserving inside focus', async () => {
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const trigger = await screen.findByRole('button', { name: 'Change language' });
    fireEvent.click(trigger);
    const russian = screen.getByRole('button', { name: 'Русский' });
    act(() => russian.focus());
    expect(screen.getByRole('button', { name: 'Русский' })).toBeTruthy();

    const outsideTarget = document.createElement('button');
    document.body.append(outsideTarget);
    act(() => outsideTarget.focus());

    expect(screen.queryByRole('button', { name: 'Русский' })).toBeNull();
    expect(document.activeElement).toBe(outsideTarget);
    expect(removeEventListener).toHaveBeenCalledWith('focusin', expect.any(Function));
    outsideTarget.remove();
  });

  it.each(['{Enter}', '{Space}'])(
    'opens the desktop language menu once when the focused native trigger receives %s',
    async (key) => {
      renderShell(authenticatedClient('student'), 'student-token', '/learning');

      const trigger = await screen.findByRole('button', { name: 'Change language' });
      const user = userEvent.setup();
      await act(async () => {
        trigger.focus();
        await user.keyboard(key);
      });

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByLabelText('Language menu')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /English|Русский|O'zbek/ })).toHaveLength(3);
    },
  );

  it('opens the desktop language menu for a fine mouse pointer and bridges the menu gap', async () => {
    stubFinePointer();
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const trigger = await screen.findByRole('button', { name: 'Change language' });
    vi.useFakeTimers();
    const selector = trigger.parentElement;
    expect(selector).toBeTruthy();
    if (!selector) return;

    firePointerTransition(selector, 'pointerover', 'mouse');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Language menu')).toBeTruthy();
    expect(document.activeElement).not.toBe(trigger);

    firePointerTransition(selector, 'pointerout', 'mouse');
    await act(() => vi.advanceTimersByTime(120));
    firePointerTransition(selector, 'pointerover', 'mouse');
    await act(() => vi.advanceTimersByTime(240));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    firePointerTransition(selector, 'pointerout', 'mouse');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await act(() => vi.advanceTimersByTime(240));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    firePointerTransition(selector, 'pointerover', 'mouse');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    firePointerTransition(selector, 'pointerover', 'mouse');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    firePointerTransition(selector, 'pointerout', 'mouse');
    await act(() => vi.advanceTimersByTime(240));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Language menu')).toBeNull();
  });

  it('does not use hover disclosure for touch or coarse pointers', async () => {
    stubFinePointer(false);
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const trigger = await screen.findByRole('button', { name: 'Change language' });
    const selector = trigger.parentElement;
    expect(selector).toBeTruthy();
    if (!selector) return;

    firePointerTransition(selector, 'pointerover', 'mouse');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    stubFinePointer(true);
    firePointerTransition(selector, 'pointerover', 'touch');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('orders desktop student controls as AI, Cart, Profile, then Language', async () => {
    renderShell(authenticatedClient('student'), 'student-token', '/learning');

    const assistant = await screen.findByRole('link', { name: 'Open AI assistant' });
    const cart = await screen.findByRole('link', { name: 'Cart' });
    const profile = screen.getByRole('button', { name: 'Account menu for student User' });
    const language = screen.getByRole('button', { name: 'Change language' });

    expect(assistant.compareDocumentPosition(cart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cart.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      profile.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(DESKTOP_APP_SHELL_STYLES).toMatch(
      /\.headerCartAccountGroup \.cartLink\s*\{\s*order:\s*1;/,
    );
    expect(DESKTOP_APP_SHELL_STYLES).toMatch(
      /\.headerCartAccountGroup \.account\s*\{\s*order:\s*2;/,
    );
  });

  it('keeps the student catalog search slot on Course Detail', async () => {
    renderShell(authenticatedClient('student'), 'student-token', '/courses/7');

    expect(await screen.findByRole('search', { name: 'Course catalog search' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Catalog' })).toBeTruthy();
  });

  it('uses the enrollment-aware assistant destination from student mobile navigation', async () => {
    stubCompactViewport();
    renderShell(
      authenticatedClient('student'),
      'student-token',
      '/learning/enrollments/42/lesson-3',
    );

    const navigation = await screen.findByRole('navigation', { name: 'Student navigation' });
    const assistant = within(navigation).getByRole('link', { name: 'AI chat' });
    expect(assistant.getAttribute('href')).toBe('/learning/enrollments/42/ai-chat');
    fireEvent.click(assistant);
    await waitFor(() =>
      expect(screen.getByLabelText('location state').textContent).toBe(
        '{"returnTo":"/learning/enrollments/42/lesson-3"}',
      ),
    );
  });

  it('places authenticated mobile Language after Profile and removes it from the account popover', async () => {
    stubCompactViewport();
    renderShell(authenticatedClient('student'), 'student-token');

    const accountMenu = await screen.findByRole('button', {
      name: 'Account menu for student User',
    });
    const language = screen.getByRole('button', { name: 'Change language' });
    expect(
      accountMenu.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(language);
    expect(screen.getByLabelText('Language menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(accountMenu);
    const accountDetails = screen.getByRole('group', {
      name: 'Account details for student User',
    });
    expect(within(accountDetails).queryByRole('button', { name: /Language/ })).toBeNull();
  });

  it('places the Instructor menu after LearnHub and keeps Profile before Language', async () => {
    stubCompactViewport();
    renderShell(authenticatedClient('instructor'), 'instructor-token', '/instructor/courses');

    const accountMenu = await screen.findByRole('button', {
      name: 'Account menu for instructor User',
    });
    const brand = screen.getByRole('link', { name: 'LearnHub home' });
    const language = screen.getByRole('button', { name: 'Change language' });
    const navigationTrigger = screen.getByRole('button', { name: 'Open navigation' });
    expect(
      brand.compareDocumentPosition(navigationTrigger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      navigationTrigger.compareDocumentPosition(accountMenu) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      accountMenu.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(accountMenu);
    const accountDetails = screen.getByRole('group', {
      name: 'Account details for instructor User',
    });
    expect(within(accountDetails).queryByRole('button', { name: /Language/ })).toBeNull();
  });

  it.each([
    ['en', 'student', 'Student', 'Account menu for student User'],
    ['ru', 'instructor', 'Преподаватель', 'Меню аккаунта: instructor User'],
    ['uz', 'admin', 'Administrator', 'admin Userning akkaunt menyusi'],
  ] as const)(
    'localizes the visible %s account role for %s without changing the profile identity',
    async (locale, role, expectedRole, accountMenuName) => {
      localStorage.setItem('learnhub.locale', locale);
      renderShell(authenticatedClient(role), `${role}-token`);

      const accountMenu = await screen.findByRole('button', {
        name: accountMenuName,
      });
      await act(async () => {
        await userEvent.setup().click(accountMenu);
      });

      expect(await screen.findByText(expectedRole, { exact: true })).toBeTruthy();
      expect(screen.queryByText(role, { exact: true })).toBeNull();
    },
  );

  it('preserves the saved POP target when the bounded restore deadline expires', async () => {
    const harness = renderScrollRestoreHarness();
    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 1, name: 'Catalog test page' });

    act(() => {
      harness.setScrollTop(93);
      fireEvent.scroll(window);
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go to login' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Login test page' });
    expect(harness.getScrollTop()).toBe(0);

    act(() => {
      harness.setMaxScrollTop(0);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go back' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Catalog test page' });
    expect(harness.getScrollTop()).toBe(0);

    act(() => {
      harness.flushAnimationFrame(400);
      harness.flushAnimationFrame(400);
      harness.flushAnimationFrame(400);
      harness.setMaxScrollTop(200);
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go to login' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go back' }));
    });

    expect(harness.getScrollTop()).toBe(93);
  });

  it('cancels stale POP restore work after a newer navigation without losing the saved target', async () => {
    const harness = renderScrollRestoreHarness();
    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 1, name: 'Catalog test page' });

    act(() => {
      harness.setScrollTop(93);
      fireEvent.scroll(window);
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go to login' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Login test page' });

    act(() => {
      harness.setMaxScrollTop(0);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go back' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Catalog test page' });
    const restoreCallsBeforeCancellation = harness.scrollToSpy.mock.calls.filter(
      ([left, top]) => left === 0 && top === 93,
    ).length;

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go to login' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Login test page' });

    act(() => {
      harness.setMaxScrollTop(200);
      harness.flushAnimationFrame(1_200);
      harness.flushAnimationFrame(1_200);
    });

    expect(harness.getScrollTop()).toBe(0);
    expect(
      harness.scrollToSpy.mock.calls.filter(([left, top]) => left === 0 && top === 93).length,
    ).toBe(restoreCallsBeforeCancellation);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go back' }));
    });

    expect(harness.getScrollTop()).toBe(93);
  });
});
