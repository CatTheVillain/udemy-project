// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defaultScheduler, notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '../../src/app/query';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
  type SessionContextValue,
} from '../../src/features/auth-session';
import * as authSession from '../../src/features/auth-session';
import {
  CourseDetailPage,
  resolveCourseCatalogReturnTarget,
} from '../../src/pages/course-detail-page/CourseDetailPage';
import { CourseActionPanel } from '../../src/pages/course-detail-page/CourseActionPanel';
import courseDetailStyles from '../../src/pages/course-detail-page/CourseDetailPage.module.css';
import {
  courseMutationDisposition,
  type CourseMutationDisposition,
  type CoursePrimaryActionState,
} from '../../src/features/course-detail';
import { ApiError, type ApiClient, type ApiRequestOptions } from '../../src/shared/api';
import { localeRuntime, type Locale } from '../../src/shared/locale';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COURSE_DETAIL_STYLES = readFileSync(
  pathToFileURL(resolve(process.cwd(), 'src/pages/course-detail-page/CourseDetailPage.module.css')),
  'utf8',
);

function cssDeclarationBlock(source: string, selectorStart: string): string {
  const selectorOffset = source.indexOf(selectorStart);
  expect(selectorOffset).toBeGreaterThanOrEqual(0);
  const blockStart = source.indexOf('{', selectorOffset);
  const blockEnd = source.indexOf('}', blockStart);
  expect(blockEnd).toBeGreaterThan(blockStart);
  return source.slice(blockStart + 1, blockEnd);
}

const course = {
  id: 7,
  title: 'React foundations',
  description: 'Build reliable interfaces.',
  price: '0.00',
  currency: 'USD',
  published_at: '2026-07-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  instructor: { id: 2, name: 'Ada', surname: 'Lovelace' },
  lessons: [],
};

const courseActionPanelCourse = {
  id: course.id,
  instructorId: course.instructor.id,
  instructorName: `${course.instructor.name} ${course.instructor.surname}`,
  title: course.title,
  description: course.description,
  price: course.price,
  currency: course.currency,
  publishedAt: course.published_at,
  lessons: [],
};

interface LocalizedCourseActionScenario {
  readonly locale: Locale;
  readonly guestGuidance: string;
  readonly guestLabel: string;
  readonly disabled: readonly [CoursePrimaryActionState, string][];
}

interface LocalizedCourseActionPriceScenario {
  readonly locale: Locale;
  readonly freeLabel: string;
  readonly unavailableLabel: string;
}

const localizedCourseActionScenarios: readonly LocalizedCourseActionScenario[] = [
  {
    locale: 'ru',
    guestGuidance: 'Войти, чтобы записаться бесплатно.',
    guestLabel: 'Записаться бесплатно',
    disabled: [
      [{ kind: 'disabled', labelKey: 'course:courseIsNotPublished' }, 'Курс не опубликован'],
      [{ kind: 'disabled', labelKey: 'course:actionUnavailable' }, 'Действие недоступно'],
      [
        { kind: 'disabled', labelKey: 'course:unavailableForAccount' },
        'Недоступно для этого аккаунта',
      ],
      [{ kind: 'disabled', labelKey: 'course:checkingAvailability' }, 'Проверяем доступность'],
      [{ kind: 'disabled', labelKey: 'course:alreadyEnrolled' }, 'Вы уже записаны'],
      [{ kind: 'disabled', labelKey: 'course:alreadyInCart' }, 'Уже в корзине'],
    ],
  },
  {
    locale: 'uz',
    guestGuidance: 'Kiring bepul yozilish uchun.',
    guestLabel: 'Bepul yozilish',
    disabled: [
      [{ kind: 'disabled', labelKey: 'course:courseIsNotPublished' }, 'Kurs nashr qilinmagan'],
      [{ kind: 'disabled', labelKey: 'course:actionUnavailable' }, 'Amal mavjud emas'],
      [
        { kind: 'disabled', labelKey: 'course:unavailableForAccount' },
        'Bu akkaunt uchun mavjud emas',
      ],
      [{ kind: 'disabled', labelKey: 'course:checkingAvailability' }, 'Mavjudligi tekshirilmoqda'],
      [{ kind: 'disabled', labelKey: 'course:alreadyEnrolled' }, 'Siz allaqachon yozilgansiz'],
      [{ kind: 'disabled', labelKey: 'course:alreadyInCart' }, 'Savatda allaqachon bor'],
    ],
  },
];

const localizedCourseActionPriceScenarios: readonly LocalizedCourseActionPriceScenario[] = [
  { locale: 'en', freeLabel: 'FREE', unavailableLabel: 'Price unavailable' },
  { locale: 'ru', freeLabel: 'БЕСПЛАТНО', unavailableLabel: 'Цена недоступна' },
  { locale: 'uz', freeLabel: 'BEPUL', unavailableLabel: 'Narx mavjud emas' },
];

const studentProfile = {
  email: 'student@example.test',
  name: 'Sam',
  surname: 'Student',
  role: 'student',
  birthday: null,
  phone_number: null,
  created_at: '2026-01-01T00:00:00Z',
};
const emptyCart = { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 };
const emptyEnrollments = {
  items: [],
  page: 1,
  page_size: 100,
  total: 0,
  pages: 0,
  has_next: false,
  has_previous: false,
};
const enrollmentMutation = {
  id: 4,
  user_id: 9,
  course_id: 7,
  status: 'active',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  course: {
    id: 7,
    title: course.title,
    description: course.description,
    price: '0.00',
    currency: course.currency,
  },
};
const cartItemMutation = {
  id: 5,
  course_id: 7,
  added_at: '2026-07-01T00:00:00Z',
  course: { id: 7, title: course.title, price: '19.99', currency: course.currency },
};

interface CourseActionRendererScenario {
  readonly name: string;
  readonly disposition: CourseMutationDisposition;
  readonly message: string;
}

const courseActionRendererScenarios: readonly CourseActionRendererScenario[] = [
  {
    name: 'retryable failure',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'offline', status: null, message: 'private offline detail' }),
    ),
    message: 'The action failed. Check your connection and try again.',
  },
  {
    name: 'generic failure',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'validation', status: 422, message: 'private validation detail' }),
    ),
    message: 'This action is currently unavailable.',
  },
  {
    name: 'publication failure',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'bad_request', status: 400, message: 'Course is not published' }),
    ),
    message: 'Course is not published',
  },
  {
    name: 'unauthorized failure',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'unauthorized', status: 401, message: 'private credentials detail' }),
    ),
    message: 'Log in again to continue.',
  },
  {
    name: 'forbidden failure',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'forbidden', status: 403, message: 'private authorization detail' }),
    ),
    message: 'This action is not available for your account.',
  },
  {
    name: 'not-found failure',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'not_found', status: 404, message: 'private missing detail' }),
    ),
    message: 'This course is no longer available.',
  },
  {
    name: 'already-enrolled conflict',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'conflict', status: 409, message: 'Already enrolled in this course' }),
    ),
    message: 'The course is already in your learning list.',
  },
  {
    name: 'already-in-cart conflict',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'conflict', status: 409, message: 'Course already in cart' }),
    ),
    message: 'The course is already in your cart.',
  },
  {
    name: 'stale conflict',
    disposition: courseMutationDisposition(
      new ApiError({ kind: 'conflict', status: 409, message: 'private stale conflict detail' }),
    ),
    message: 'The course state changed. Availability has been refreshed.',
  },
];

interface CourseResidualLocaleScenario {
  readonly locale: Locale;
  readonly loadingDetails: string;
  readonly loadingOutline: string;
  readonly outlineHeading: string;
  readonly emptyOutline: string;
  readonly lessonMarker: string;
  readonly lessonType: string;
  readonly draftCourse: string;
  readonly notFoundDescription: string;
}

const courseResidualLocaleScenarios: readonly CourseResidualLocaleScenario[] = [
  {
    locale: 'en',
    loadingDetails: 'Loading course details',
    loadingOutline: 'Loading course outline',
    outlineHeading: 'Course outline',
    emptyOutline: 'No lessons have been added yet.',
    lessonMarker: 'lesson ·',
    lessonType: 'Video',
    draftCourse: 'Draft course',
    notFoundDescription: 'This course does not exist or is no longer available.',
  },
  {
    locale: 'ru',
    loadingDetails: 'Загрузка сведений о курсе',
    loadingOutline: 'Загрузка программы курса',
    outlineHeading: 'Программа курса',
    emptyOutline: 'Уроки ещё не добавлены.',
    lessonMarker: 'урок ·',
    lessonType: 'Видео',
    draftCourse: 'Черновик курса',
    notFoundDescription: 'Курс не существует или больше недоступен.',
  },
  {
    locale: 'uz',
    loadingDetails: 'Kurs tafsilotlari yuklanmoqda',
    loadingOutline: 'Kurs dasturi yuklanmoqda',
    outlineHeading: 'Kurs dasturi',
    emptyOutline: 'Hali darslar qo‘shilmagan.',
    lessonMarker: 'dars ·',
    lessonType: 'Video',
    draftCourse: 'Kurs qoralamasi',
    notFoundDescription: 'Bu kurs mavjud emas yoki endi ochiq emas.',
  },
];

function lesson(downloadUrl: string | null) {
  return {
    id: 3,
    title: 'Welcome',
    lesson_type: 'video',
    download_url: downloadUrl,
    description: 'Course orientation.',
    is_published: true,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

function outline(downloadUrl: string | null, items = 1) {
  return {
    items: items === 0 ? [] : [lesson(downloadUrl)],
    page: 1,
    page_size: 100,
    total: items,
    pages: items,
    has_next: false,
    has_previous: false,
  };
}

function store(token: string | null = null): AccessTokenStore {
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

function decode<TResponse, TBody>(
  options: ApiRequestOptions<TBody, TResponse>,
  value: unknown,
): TResponse {
  return options.decode ? options.decode(value) : (value as TResponse);
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

type ScheduledNotification = () => void;

interface SchedulerAdmissionOptions {
  readonly timeout: number;
}

const schedulerAdmissionTimeout: SchedulerAdmissionOptions = { timeout: 100 };

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function captureScheduledNotification(
  admitNotification: () => void,
  options: SchedulerAdmissionOptions = schedulerAdmissionTimeout,
): Promise<ScheduledNotification> {
  let scheduledNotification: ScheduledNotification | undefined;
  notifyManager.setScheduler((notification) => {
    scheduledNotification = notification;
  });
  try {
    admitNotification();
    await waitFor(() => expect(scheduledNotification).toBeDefined(), options);
    if (!scheduledNotification) throw new Error('Scheduled notification was not captured.');
    return scheduledNotification;
  } finally {
    notifyManager.setScheduler(defaultScheduler);
  }
}

interface PageHarnessOptions {
  readonly sessionControls?: boolean;
  readonly routeControls?: boolean;
  readonly tokenStore?: AccessTokenStore;
}

function PageHarnessControls({ sessionControls, routeControls }: PageHarnessOptions) {
  const session = useSession();
  const navigate = useNavigate();
  return (
    <>
      {routeControls ? (
        <button type="button" onClick={() => navigate('/courses/8')}>
          Open course 8
        </button>
      ) : null}
      {routeControls ? (
        <button type="button" onClick={() => navigate('/courses/7')}>
          Return to course 7
        </button>
      ) : null}
      {sessionControls ? (
        <button type="button" onClick={session.clearSession}>
          Clear session
        </button>
      ) : null}
    </>
  );
}

interface CourseDetailRouteEntry {
  readonly pathname: string;
  readonly state: unknown;
}

type CourseDetailInitialEntry = string | CourseDetailRouteEntry;

function renderPage(
  request: ApiClient['request'],
  token: string | null = null,
  path: CourseDetailInitialEntry = '/courses/7',
  options: PageHarnessOptions = {},
) {
  const queryClient = createAppQueryClient();
  const view = render(
    <I18nextProvider i18n={localeRuntime}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider client={{ request }} tokenStore={options.tokenStore ?? store(token)}>
          <MemoryRouter
            initialEntries={[path]}
            future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          >
            <PageHarnessControls {...options} />
            <Routes>
              <Route path="/courses/:courseId" element={<CourseDetailPage />} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { ...view, queryClient };
}

beforeEach(async () => {
  await localeRuntime.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  notifyManager.setScheduler(defaultScheduler);
  vi.restoreAllMocks();
});

describe('CourseDetailPage', () => {
  it.each([
    {
      name: 'accepts a complete canonical Catalog return target and retains its fragment',
      state: {
        returnTo: '/?search_query=React&min_price=5&max_price=10&sort=-price&page=3#results',
      },
      href: '/?search_query=React&min_price=5&max_price=10&sort=-price&page=3#results',
    },
    {
      name: 'accepts a same-origin absolute canonical Catalog return target',
      state: {
        returnTo: `${globalThis.location.origin}/?search_query=React&min_price=5&max_price=10&sort=-price&page=3#results`,
      },
      href: '/?search_query=React&min_price=5&max_price=10&sort=-price&page=3#results',
    },
    { name: 'fails closed for absent state', state: undefined, href: '/' },
    { name: 'fails closed for a null state', state: null, href: '/' },
    { name: 'fails closed for a primitive state', state: 'catalog', href: '/' },
    { name: 'fails closed for an array state', state: [{ returnTo: '/' }], href: '/' },
    {
      name: 'fails closed for an inherited return target',
      state: Object.create({ returnTo: '/?page=3' }),
      href: '/',
    },
    { name: 'fails closed for a non-string return target', state: { returnTo: 3 }, href: '/' },
    {
      name: 'fails closed for an extra state key',
      state: { returnTo: '/?page=3', extra: true },
      href: '/',
    },
    {
      name: 'fails closed for a non-enumerable extra own state key',
      state: Object.defineProperty({ returnTo: '/?page=3' }, 'extra', { value: true }),
      href: '/',
    },
    {
      name: 'fails closed for a symbol extra own state key',
      state: { returnTo: '/?page=3', [Symbol('extra')]: true },
      href: '/',
    },
    {
      name: 'fails closed for an external return target',
      state: { returnTo: 'https://evil.test/' },
      href: '/',
    },
    {
      name: 'fails closed for a protocol-relative target',
      state: { returnTo: '//evil.test/' },
      href: '/',
    },
    { name: 'fails closed for a backslash target', state: { returnTo: '\\evil.test/' }, href: '/' },
    {
      name: 'fails closed for a credentialed target',
      state: { returnTo: 'https://user@evil.test/' },
      href: '/',
    },
    {
      name: 'fails closed for unknown Catalog query state',
      state: { returnTo: '/?unknown=value' },
      href: '/',
    },
    {
      name: 'fails closed for duplicate query dimensions',
      state: { returnTo: '/?page=3&page=3' },
      href: '/',
    },
    {
      name: 'fails closed for an inverted price range',
      state: { returnTo: '/?min_price=10&max_price=5' },
      href: '/',
    },
    {
      name: 'fails closed for a malformed price',
      state: { returnTo: '/?min_price=abc' },
      href: '/',
    },
    { name: 'fails closed for an invalid page', state: { returnTo: '/?page=0' }, href: '/' },
    {
      name: 'fails closed for an invalid sort',
      state: { returnTo: '/?sort=unexpected' },
      href: '/',
    },
    {
      name: 'fails closed for noncanonical query order',
      state: { returnTo: '/?page=3&sort=-price' },
      href: '/',
    },
    {
      name: 'fails closed for noncanonical query encoding',
      state: { returnTo: '/?search_query=React%20Basics' },
      href: '/',
    },
    { name: 'fails closed for a non-Catalog path', state: { returnTo: '/courses/7' }, href: '/' },
    {
      name: 'fails closed for a literal parent dot-segment path',
      state: { returnTo: '/foo/..?page=3#results' },
      href: '/',
    },
    {
      name: 'fails closed for a literal current dot-segment path',
      state: { returnTo: '/./?page=3#results' },
      href: '/',
    },
    {
      name: 'fails closed for a percent-encoded parent dot-segment path',
      state: { returnTo: '/%2e%2e?page=3#results' },
      href: '/',
    },
    {
      name: 'fails closed for an absolute literal parent dot-segment path',
      state: { returnTo: `${globalThis.location.origin}/foo/..?page=3#results` },
      href: '/',
    },
    {
      name: 'fails closed for an absolute percent-encoded parent dot-segment path',
      state: { returnTo: `${globalThis.location.origin}/%2e%2e?page=3#results` },
      href: '/',
    },
    {
      name: 'fails closed for a wrong-shaped state',
      state: { returnTo: '/?page=3', unexpected: true },
      href: '/',
    },
  ])('$name', async ({ state, href }) => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/courses/7/reviews')
        return decode(options, {
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          pages: 0,
          has_next: false,
          has_previous: false,
        });
      throw new Error(`Unexpected request ${options.path}`);
    };

    renderPage(request, null, { pathname: '/courses/7', state });

    const returnLink = await screen.findByRole('link', { name: 'Back to catalog' });
    expect(returnLink.getAttribute('href')).toBe(href);
    expect(returnLink.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('fails closed without invoking a hostile return target accessor', () => {
    let getterWasInvoked = false;
    const state = Object.defineProperty({}, 'returnTo', {
      enumerable: true,
      get: () => {
        getterWasInvoked = true;
        throw new Error('hostile route state getter');
      },
    });

    expect(resolveCourseCatalogReturnTarget(state)).toBe('/');
    expect(getterWasInvoked).toBe(false);
  });

  it('fails closed without invoking a hostile route-state get trap', () => {
    let getTrapWasInvoked = false;
    const state = new Proxy(
      { returnTo: '/?page=3', extra: true },
      {
        get: () => {
          getTrapWasInvoked = true;
          throw new Error('hostile route state get trap');
        },
      },
    );

    expect(resolveCourseCatalogReturnTarget(state)).toBe('/');
    expect(getTrapWasInvoked).toBe(false);
  });

  it('fails closed when route-state key introspection throws', () => {
    const state = new Proxy(
      { returnTo: '/' },
      {
        ownKeys: () => {
          throw new Error('hostile route state ownKeys trap');
        },
      },
    );

    expect(resolveCourseCatalogReturnTarget(state)).toBe('/');
  });

  it('fails closed for a revoked route-state proxy', () => {
    const { proxy, revoke } = Proxy.revocable({ returnTo: '/' }, {});
    revoke();

    expect(resolveCourseCatalogReturnTarget(proxy)).toBe('/');
  });

  it.each([
    ['en', 'Back to catalog'],
    ['ru', 'Вернуться в каталог'],
    ['uz', 'Katalogga qaytish'],
  ] as const)(
    'renders exactly one localized contextual link before the unchanged eyebrow in %s',
    async (locale, label) => {
      await localeRuntime.changeLanguage(locale);
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/courses/7') return decode(options, course);
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        if (options.path === '/courses/7/reviews')
          return decode(options, {
            items: [],
            page: 1,
            page_size: 20,
            total: 0,
            pages: 0,
            has_next: false,
            has_previous: false,
          });
        throw new Error(`Unexpected request ${options.path}`);
      };
      renderPage(request);
      const links = await screen.findAllByRole('link', { name: label });
      expect(links).toHaveLength(1);
      const eyebrow = screen.getByText(
        locale === 'en'
          ? 'Course details'
          : locale === 'ru'
            ? 'Сведения о курсе'
            : 'Kurs tafsilotlari',
      );
      expect(
        links[0].compareDocumentPosition(eyebrow) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(links[0].querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    },
  );

  it('keeps the not-found recovery typography and active violet in its bounded local rules', () => {
    const recoveryRule = cssDeclarationBlock(
      COURSE_DETAIL_STYLES,
      '.state .courseNotFoundReturnLink:focus-visible {\n  color:',
    );
    const activeRule = cssDeclarationBlock(
      COURSE_DETAIL_STYLES,
      '.state .courseNotFoundReturnLink:active {\n  color:',
    );

    expect(recoveryRule).toContain('font-size: var(--type-body-md-size);');
    expect(recoveryRule).toContain('font-weight: var(--font-weight-medium);');
    expect(recoveryRule).toContain('line-height: var(--type-body-md-lh);');
    expect(activeRule).toContain('color: var(--action-primary-bg-hover);');
  });

  it('mounts the public reviews seam only after course detail succeeds', async () => {
    const reviews = {
      items: [],
      page: 1,
      page_size: 20,
      total: 0,
      pages: 0,
      has_next: false,
      has_previous: false,
    };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/courses/7/reviews') return decode(options, reviews);
      throw new Error(`Unexpected request ${options.path}`);
    };

    renderPage(request);

    expect(await screen.findByRole('heading', { level: 1, name: course.title })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Reviews' })).toBeTruthy();
  });

  it('resets review pagination to the first page when navigating to another course', async () => {
    const reviewRequests: Array<{
      readonly path: string;
      readonly page: number;
      readonly pageSize: number;
    }> = [];
    const courseEight = { ...course, id: 8, title: 'Course eight' };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/8') return decode(options, courseEight);
      if (options.path === '/courses/7/lessons' || options.path === '/courses/8/lessons')
        return decode(options, outline(null));
      if (options.path === '/courses/7/reviews' || options.path === '/courses/8/reviews') {
        const query = options.query as { readonly page: number; readonly page_size: number };
        reviewRequests.push({ path: options.path, page: query.page, pageSize: query.page_size });
        return decode(options, {
          items: [],
          page: query.page,
          page_size: 20,
          total: 40,
          pages: 2,
          has_next: query.page < 2,
          has_previous: query.page > 1,
        });
      }
      throw new Error(`Unexpected request ${options.path}`);
    };

    renderPage(request, null, '/courses/8', { routeControls: true });
    const user = userEvent.setup();

    await screen.findByRole('heading', { level: 1, name: 'Course eight' });
    await waitFor(() =>
      expect(reviewRequests).toContainEqual({ path: '/courses/8/reviews', page: 1, pageSize: 20 }),
    );
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Return to course 7' }));
    });
    await screen.findByRole('heading', { level: 1, name: course.title });
    await screen.findByRole('button', { name: 'Go to page 2' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    });
    await waitFor(() =>
      expect(reviewRequests).toContainEqual({ path: '/courses/7/reviews', page: 2, pageSize: 20 }),
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open course 8' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'Course eight' });
    await waitFor(() =>
      expect(reviewRequests).toContainEqual({ path: '/courses/8/reviews', page: 1, pageSize: 20 }),
    );
    expect(reviewRequests).not.toContainEqual({
      path: '/courses/8/reviews',
      page: 2,
      pageSize: 20,
    });
  });

  it.each(localizedCourseActionScenarios)(
    'renders every guest and disabled Course Action descriptor in $locale',
    async ({ locale, guestGuidance, guestLabel, disabled }) => {
      await localeRuntime.changeLanguage(locale);
      const renderAction = (action: CoursePrimaryActionState) =>
        render(
          <I18nextProvider i18n={localeRuntime}>
            <MemoryRouter>
              <CourseActionPanel
                action={action}
                course={courseActionPanelCourse}
                isDraft={false}
                mutationState={{ status: 'idle' }}
                onRetryPreflight={() => {}}
                onSubmitAction={() => {}}
                preflight="eligible"
              />
            </MemoryRouter>
          </I18nextProvider>,
        );

      renderAction({
        kind: 'login',
        helper: {
          linkTextKey: 'course:signIn',
          guidanceKey: 'course:signInToEnrollForFree',
        },
        labelKey: 'course:enrollForFree',
        to: '/login?returnTo=%2Fcourses%2F7',
      });
      const guestLink = screen.getByRole('link', { name: locale === 'ru' ? 'Войти' : 'Kiring' });
      expect(guestLink.closest('p')?.textContent).toBe(guestGuidance);
      expect((screen.getByRole('button', { name: guestLabel }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      cleanup();

      disabled.forEach(([action, label]) => {
        renderAction(action);
        expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(
          true,
        );
        cleanup();
      });
    },
  );

  it.each(localizedCourseActionPriceScenarios)(
    'renders localized free and unavailable Course Action prices in $locale without exposing raw invalid data',
    async ({ locale, freeLabel, unavailableLabel }) => {
      await localeRuntime.changeLanguage(locale);
      const renderAction = (price: string) =>
        render(
          <I18nextProvider i18n={localeRuntime}>
            <MemoryRouter>
              <CourseActionPanel
                action={{ kind: 'enroll', labelKey: 'catalog:enrollFree' }}
                course={{ ...courseActionPanelCourse, price }}
                isDraft={false}
                mutationState={{ status: 'idle' }}
                onRetryPreflight={() => {}}
                onSubmitAction={() => {}}
                preflight="eligible"
              />
            </MemoryRouter>
          </I18nextProvider>,
        );

      const freeView = renderAction('0.00');
      expect(screen.getByText(freeLabel)).toBeTruthy();
      expect(document.querySelector('data')?.getAttribute('value')).toBe('0.00');
      freeView.unmount();

      renderAction('not-a-decimal');
      expect(screen.getByText(unavailableLabel)).toBeTruthy();
      expect(document.body.textContent).not.toContain('USD not-a-decimal');
      expect(document.querySelector('data')?.getAttribute('value')).toBe('not-a-decimal');
    },
  );

  it.each(courseActionRendererScenarios)(
    'renders the exact public message for $name without private mutation detail',
    ({ disposition, message }) => {
      render(
        <I18nextProvider i18n={localeRuntime}>
          <MemoryRouter>
            <CourseActionPanel
              action={{ kind: 'enroll', labelKey: 'catalog:enrollFree' }}
              course={courseActionPanelCourse}
              isDraft={false}
              mutationState={{ status: 'error', disposition }}
              onRetryPreflight={() => {}}
              onSubmitAction={() => {}}
              preflight="eligible"
            />
          </MemoryRouter>
        </I18nextProvider>,
      );

      expect(screen.getByText(message)).toBeTruthy();
      expect(document.body.textContent).not.toContain('private');
    },
  );

  it('keeps the shared reconciliation message locale-reactive while it remains visible', async () => {
    render(
      <I18nextProvider i18n={localeRuntime}>
        <MemoryRouter>
          <CourseActionPanel
            action={{ kind: 'enroll', labelKey: 'catalog:enrollFree' }}
            course={courseActionPanelCourse}
            isDraft={false}
            mutationState={{ status: 'idle' }}
            onRetryPreflight={() => {}}
            onSubmitAction={() => {}}
            preflight="unavailable"
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByText('We could not verify your enrollment or cart.')).toBeTruthy();
    await act(async () => {
      await localeRuntime.changeLanguage('ru');
    });
    expect(screen.getByText('Не удалось проверить запись на курс или корзину.')).toBeTruthy();
    await act(async () => {
      await localeRuntime.changeLanguage('uz');
    });
    expect(screen.getByText('Kursga yozilish yoki savatni tekshirib bo‘lmadi.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Qayta urinish' })).toBeTruthy();
  });

  it.each([
    {
      locale: 'ru' as const,
      price: '0.00',
      label: 'Записаться',
      mutationPath: '/enrollments',
      mutationResponse: enrollmentMutation,
    },
    {
      locale: 'uz' as const,
      price: '19.99',
      label: 'Savatga qo‘shish',
      mutationPath: '/cart/items',
      mutationResponse: cartItemMutation,
    },
  ])(
    'localizes the eligible authenticated primary action in $locale without changing its write target',
    async ({ locale, price, label, mutationPath, mutationResponse }) => {
      await localeRuntime.changeLanguage(locale);
      let mutationRequests = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, studentProfile);
        if (options.path === '/courses/7') return decode(options, { ...course, price });
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        if (options.path === '/cart') return decode(options, emptyCart);
        if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
        if (options.path === mutationPath) {
          mutationRequests += 1;
          return decode(options, mutationResponse);
        }
        throw new Error(`Unexpected request ${options.path}`);
      };
      renderPage(request, 'token');

      await waitFor(() =>
        expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: label }));
      });
      await waitFor(() => expect(mutationRequests).toBe(1));
    },
  );

  it('keeps an authenticated session without a cache epoch in non-actionable preflight state', async () => {
    let preflightReads = 0;
    let writes = 0;
    const reviews = {
      items: [],
      page: 1,
      page_size: 20,
      total: 0,
      pages: 0,
      has_next: false,
      has_previous: false,
    };
    const reviewResponse = createDeferred<typeof reviews>();
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/courses/7/reviews')
        return decode(options, await reviewResponse.promise);
      if (options.path === '/cart' || options.path === '/enrollments/my') {
        preflightReads += 1;
        return decode(options, options.path === '/cart' ? emptyCart : emptyEnrollments);
      }
      if (options.path === '/enrollments' || options.path === '/cart/items') writes += 1;
      throw new Error(`Unexpected request ${options.path}`);
    };
    const requestSession = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ): Promise<TResponse> => request(options);
    const session: SessionContextValue = {
      state: {
        status: 'authenticated',
        user: {
          email: studentProfile.email,
          name: studentProfile.name,
          surname: studentProfile.surname,
          role: 'student',
          birthday: studentProfile.birthday,
          phoneNumber: studentProfile.phone_number,
          createdAt: studentProfile.created_at,
        },
      },
      cacheEpoch: null,
      retryBootstrap: () => {},
      acceptAccessToken: () => {},
      clearSession: () => {},
      requestPublic: requestSession,
      requestRequired: requestSession,
      requestOptional: requestSession,
    };
    const useSessionSpy = vi.spyOn(authSession, 'useSession').mockReturnValue(session);
    const queryClient = createAppQueryClient();
    const view = render(
      <I18nextProvider i18n={localeRuntime}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/courses/7']}>
            <Routes>
              <Route path="/courses/:courseId" element={<CourseDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    await screen.findByRole('heading', { level: 3, name: 'Welcome' });
    const action = screen.getByRole('button', { name: 'Checking availability' });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(preflightReads).toBe(0);
    await userEvent.setup().click(action);
    expect(writes).toBe(0);
    const notify = await captureScheduledNotification(() => reviewResponse.resolve(reviews));
    await act(async () => {
      notify();
    });
    expect(screen.getByText('No reviews yet.')).toBeTruthy();
    view.unmount();
    useSessionSpy.mockRestore();
  });

  it('restores the default scheduler when notification admission is missing', async () => {
    const setScheduler = vi.spyOn(notifyManager, 'setScheduler');

    await expect(captureScheduledNotification(() => {})).rejects.toThrow();
    expect(setScheduler).toHaveBeenLastCalledWith(defaultScheduler);
  });

  it.each(courseResidualLocaleScenarios)(
    'resolves every admitted course residual in $locale without changing API-authored data',
    async (copy) => {
      await localeRuntime.changeLanguage(copy.locale);
      const pendingDetailRequest: ApiClient['request'] = async <TResponse,>() =>
        await new Promise<TResponse>(() => undefined);
      const detailLoading = renderPage(pendingDetailRequest);
      expect(screen.getByRole('status', { name: copy.loadingDetails })).toBeTruthy();
      detailLoading.unmount();

      const pendingOutlineRequest: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/courses/7') return decode(options, course);
        return await new Promise<TResponse>(() => undefined);
      };
      const outlineLoading = renderPage(pendingOutlineRequest);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'React foundations' }),
      ).toBeTruthy();
      expect(screen.getByRole('status', { name: copy.loadingOutline })).toBeTruthy();
      outlineLoading.unmount();

      const populatedRequest: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/courses/7') return decode(options, course);
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        throw new Error(`Unexpected request ${options.path}`);
      };
      const populated = renderPage(populatedRequest);
      expect(
        await screen.findByRole('heading', { level: 2, name: copy.outlineHeading }),
      ).toBeTruthy();
      expect(await screen.findByRole('heading', { level: 3, name: 'Welcome' })).toBeTruthy();
      expect(screen.getByText(new RegExp(`${copy.lessonType} ${copy.lessonMarker}`))).toBeTruthy();
      expect(screen.getByText('Ada Lovelace')).toBeTruthy();
      populated.unmount();

      const draftRequest: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/courses/7')
          return decode(options, { ...course, published_at: null });
        if (options.path === '/courses/7/lessons') return decode(options, outline(null, 0));
        throw new Error(`Unexpected request ${options.path}`);
      };
      const draft = renderPage(draftRequest);
      expect(await screen.findByText(copy.draftCourse)).toBeTruthy();
      expect(await screen.findByText(copy.emptyOutline)).toBeTruthy();
      draft.unmount();

      const invalidRequest = vi.fn(async () => undefined) as unknown as ApiClient['request'];
      renderPage(invalidRequest, null, '/courses/not-a-number');
      expect(screen.getByText(copy.notFoundDescription)).toBeTruthy();
      expect(invalidRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/media/lessons/private.mp4', 'populated-link'],
    [null, 'anonymous-redacted'],
    [null, 'explicit-null'],
  ])('renders %s as metadata only for the %s fixture', async (downloadUrl, _fixtureName) => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(downloadUrl));
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'React foundations' }),
    ).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 3, name: 'Welcome' })).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(document.querySelector('data')?.textContent).toBe('FREE');
    expect(document.querySelector('data')?.getAttribute('value')).toBe('0.00');
    expect(screen.getByText('1', { selector: 'dd' })).toBeTruthy();
    const signIn = await screen.findByRole('link', { name: 'Sign in' });
    expect(signIn.getAttribute('href')).toBe('/login?returnTo=%2Fcourses%2F7');
    expect(signIn.closest('p')?.textContent).toBe('Sign in to enroll for free.');
    expect(
      (screen.getByRole('button', { name: 'Enroll for free' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(document.body.textContent).not.toContain('/media/lessons/');
    expect(document.querySelector('audio, video, source, [download]')).toBeNull();
    expect(screen.queryByRole('button', { name: /play|download/i })).toBeNull();
  });

  it('renders paid guest guidance without a preflight or mutation request', async () => {
    const paths: string[] = [];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      paths.push(options.path);
      if (options.path === '/courses/7') return decode(options, { ...course, price: '19.99' });
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/courses/7/reviews')
        return decode(options, {
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          pages: 0,
          has_next: false,
          has_previous: false,
        });
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request);

    const signIn = await screen.findByRole('link', { name: 'Sign in' });
    expect(signIn.getAttribute('href')).toBe('/login?returnTo=%2Fcourses%2F7');
    expect(signIn.closest('p')?.textContent).toBe('Sign in to add this course to your cart.');
    const button = screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(paths).toEqual(['/courses/7', '/courses/7/reviews', '/courses/7/lessons']);
  });

  it.each([
    ['0.00', 'Enroll for free'],
    ['19.99', 'Add to cart'],
  ])(
    'marks the %s guest unavailable action for the local disabled CTA treatment',
    async (price, label) => {
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/courses/7') return decode(options, { ...course, price });
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        throw new Error(`Unexpected request ${options.path}`);
      };

      renderPage(request);

      const action = (await screen.findByRole('button', { name: label })) as HTMLButtonElement;
      expect(action.disabled).toBe(true);
      expect(action.className).toContain('guestUnavailableAction');
    },
  );

  it('clears a genuine invalid bearer after 401 before rendering public redacted metadata', async () => {
    const tokenStore = store('invalid-bearer');
    const requestPolicies: Array<{ path: string; policy: string | undefined }> = [];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      requestPolicies.push({ path: options.path, policy: options.authPolicy });
      if (options.path === '/me')
        throw new ApiError({
          kind: 'unauthorized',
          status: 401,
          message: 'Could not validate credentials',
        });
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/courses/7/reviews')
        return decode(options, {
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          pages: 0,
          has_next: false,
          has_previous: false,
        });
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'invalid-bearer', '/courses/7', { tokenStore });

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
    expect(requestPolicies).toContainEqual({ path: '/courses/7/reviews', policy: 'public' });
    expect(requestPolicies.filter(({ policy }) => policy === 'optional')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('/media/lessons/');
    expect(document.querySelector('audio, video, source, [download]')).toBeNull();
  });

  it('renders detail 404 without requesting the outline', async () => {
    const paths: string[] = [];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      paths.push(options.path);
      throw new ApiError({ kind: 'not_found', status: 404, message: 'Course not found' });
    };
    renderPage(request);

    expect(await screen.findByRole('heading', { level: 1, name: 'Course not found' })).toBeTruthy();
    const returnLink = screen.getByRole('link', { name: 'Return to the course catalog' });
    expect(returnLink.getAttribute('href')).toBe('/');
    expect(returnLink.classList.contains(courseDetailStyles.courseNotFoundReturnLink)).toBe(true);
    expect(paths).toEqual(['/courses/7']);
  });

  it('resolves a settled course-detail failure in the current locale without exposing server detail', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7')
        throw new ApiError({
          kind: 'invalid_response',
          status: 200,
          message: 'private decoder detail',
        });
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request);

    expect(await screen.findByRole('heading', { name: 'Course data is unavailable' })).toBeTruthy();
    await act(() => localeRuntime.changeLanguage('ru'));
    expect(await screen.findByRole('heading', { name: 'Данные курса недоступны' })).toBeTruthy();
    expect(screen.getByText('Сервер вернул некорректный ответ. Повторите попытку.')).toBeTruthy();
    expect(screen.queryByText('private decoder detail')).toBeNull();
  });

  it('retries only the failed outline query and exposes an empty outline distinctly', async () => {
    let outlineAttempts = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') {
        outlineAttempts += 1;
        if (outlineAttempts === 1)
          throw new ApiError({ kind: 'server', status: 503, message: 'private detail' });
        return decode(options, {
          items: [],
          page: 1,
          page_size: 100,
          total: 0,
          pages: 0,
          has_next: false,
          has_previous: false,
        });
      }
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request);
    const user = userEvent.setup();

    expect(await screen.findByText('We could not load this course')).toBeTruthy();
    expect(screen.getByText('Please try again.', { selector: 'p' })).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await act(async () => {
      await user.keyboard('{Enter}');
    });
    expect(await screen.findByText('No lessons have been added yet.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Course outline' })).toBe(
      document.activeElement,
    );
    expect(screen.getByRole('status').textContent).toContain('Course outline recovered');
    expect(outlineAttempts).toBe(2);
  });

  it('renders invalid-response recovery when lesson pagination metadata drifts across pages', async () => {
    let outlineAttempts = 0;
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...lesson(null),
      id: index + 1,
    }));
    const secondPage = Array.from({ length: 50 }, (_, index) => ({
      ...lesson(null),
      id: index + 101,
    }));
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') {
        outlineAttempts += 1;
        const payload =
          outlineAttempts === 1
            ? {
                items: firstPage,
                page: 1,
                page_size: 100,
                total: 101,
                pages: 2,
                has_next: true,
                has_previous: false,
              }
            : outlineAttempts === 2
              ? {
                  items: secondPage,
                  page: 2,
                  page_size: 100,
                  total: 150,
                  pages: 2,
                  has_next: false,
                  has_previous: true,
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
        try {
          return decode(options, payload);
        } catch (cause) {
          throw new ApiError({
            kind: 'invalid_response',
            status: 200,
            message: 'Server returned an invalid success response',
            cause,
          });
        }
      }
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request);

    expect(
      await screen.findByText('The server returned an invalid response. Try again.'),
    ).toBeTruthy();
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText('No lessons have been added yet.')).toBeTruthy();
    expect(outlineAttempts).toBe(3);
  });

  it('moves focus to recovered detail content and announces a detail retry success', async () => {
    let detailAttempts = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') {
        detailAttempts += 1;
        if (detailAttempts === 1)
          throw new ApiError({ kind: 'server', status: 503, message: 'private detail' });
        return decode(options, course);
      }
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request);
    const user = userEvent.setup();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    await act(async () => {
      await user.keyboard('{Enter}');
    });
    const heading = await screen.findByRole('heading', { level: 1, name: 'React foundations' });
    await waitFor(() => expect(heading).toBe(document.activeElement));
    expect(screen.getByRole('status').textContent).toContain('Course details recovered');
    expect(detailAttempts).toBe(2);
  });

  it('does not let a later background detail success consume a failed retry focus intent', async () => {
    let detailAttempts = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') {
        detailAttempts += 1;
        if (detailAttempts < 3)
          throw new ApiError({ kind: 'server', status: 503, message: 'private detail' });
        return decode(options, course);
      }
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      throw new Error(`Unexpected request ${options.path}`);
    };
    const { queryClient } = renderPage(request);
    const user = userEvent.setup();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => {
      await user.click(retry);
    });
    await screen.findByRole('button', { name: 'Try again' });
    const sentinel = document.createElement('button');
    document.body.append(sentinel);
    sentinel.focus();
    await act(async () => {
      await queryClient.refetchQueries();
    });
    await screen.findByRole('heading', { name: 'React foundations' });
    expect(document.activeElement).toBe(sentinel);
    sentinel.remove();
  });

  it('does not let a pending detail retry focus after its course identity changes', async () => {
    let resolveRetry: (() => void) | undefined;
    const retryResponse = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    let courseSevenRequests = 0;
    const courseEight = { ...course, id: 8, title: 'Course eight' };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/courses/7') {
        courseSevenRequests += 1;
        if (courseSevenRequests === 1)
          throw new ApiError({ kind: 'server', status: 503, message: 'private detail' });
        await retryResponse;
        return decode(options, course);
      }
      if (options.path === '/courses/8') return decode(options, courseEight);
      if (options.path === '/courses/7/lessons' || options.path === '/courses/8/lessons')
        return decode(options, outline(null));
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, null, '/courses/7', { routeControls: true });
    const user = userEvent.setup();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => {
      await user.click(retry);
    });
    await waitFor(() => expect(courseSevenRequests).toBe(2));
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open course 8' }));
    });
    await screen.findByRole('heading', { name: 'Course eight' });
    const sentinel = document.createElement('button');
    document.body.append(sentinel);
    sentinel.focus();
    await act(async () => {
      resolveRetry?.();
    });
    await waitFor(() => expect(document.activeElement).toBe(sentinel));
    sentinel.remove();
  });

  it('shows an authenticated Draft without preflight reads or a mutation', async () => {
    const paths: string[] = [];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      paths.push(options.path);
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7')
        return decode(options, { ...course, published_at: null, price: '9.99' });
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'student-token');

    expect(await screen.findAllByText('Course is not published')).toHaveLength(2);
    expect(
      (screen.getByRole('button', { name: 'Course is not published' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(paths).toContain('/me');
    expect(paths).toContain('/courses/7');
    expect(paths).toContain('/courses/7/lessons');
    expect(paths).not.toContain('/cart');
    expect(paths).not.toContain('/enrollments/my');
  });

  it('deduplicates a pending free enrollment and retains success while enrollment truth converges', async () => {
    let resolveEnrollment: (() => void) | undefined;
    let mutationCount = 0;
    const pending = new Promise<void>((resolve) => {
      resolveEnrollment = resolve;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/courses/7/reviews')
        return decode(options, {
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          pages: 0,
          has_next: false,
          has_previous: false,
        });
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
      if (options.path === '/enrollments') {
        mutationCount += 1;
        await pending;
        return decode(options, enrollmentMutation);
      }
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token');

    const button = await screen.findByRole('button', { name: 'Enroll free' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Please wait…' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Please wait…' }).getAttribute('aria-busy')).toBe(
      'true',
    );
    await waitFor(() => expect(mutationCount).toBe(1));
    resolveEnrollment?.();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Already enrolled' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(await screen.findByText('You are now enrolled in this course.')).toBeTruthy();
  });

  it('uses distinct paid-cart success copy while cart truth converges without claiming course access', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, { ...course, price: '19.99' });
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
      if (options.path === '/cart/items') return decode(options, cartItemMutation);
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token');

    const addToCart = await screen.findByRole('button', { name: 'Add to cart' });
    await act(async () => {
      await userEvent.setup().click(addToCart);
    });
    expect(
      ((await screen.findByRole('button', { name: 'Already in cart' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText('This course was added to your cart.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/access has been updated|now enrolled/i);
  });

  it.each([
    ['/enrollments', '0.00', 'Enroll free', null],
    ['/cart/items', '19.99', 'Add to cart', { id: 5 }],
  ])(
    'fails closed when %s returns a malformed success payload',
    async (mutationPath, price, actionLabel, payload) => {
      let mutationRequests = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, studentProfile);
        if (options.path === '/courses/7') return decode(options, { ...course, price });
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        if (options.path === '/cart') return decode(options, emptyCart);
        if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
        if (options.path === mutationPath) {
          mutationRequests += 1;
          try {
            return decode(options, payload);
          } catch (cause) {
            throw new ApiError({
              kind: 'invalid_response',
              status: 201,
              message: 'Server returned an invalid success response',
              cause,
            });
          }
        }
        throw new Error(`Unexpected request ${options.path}`);
      };
      renderPage(request, 'token');

      const action = await screen.findByRole('button', { name: actionLabel });
      await act(async () => {
        await userEvent.setup().click(action);
      });
      expect(await screen.findByText('This action is currently unavailable.')).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'Action unavailable' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(screen.queryByText('You are now enrolled in this course.')).toBeNull();
      expect(screen.queryByText('This course was added to your cart.')).toBeNull();
      expect(mutationRequests).toBe(1);
    },
  );

  it('fails preflight closed and sends no mutation when enrollment pagination is invalid', async () => {
    let mutationRequests = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') {
        return decode(options, { ...emptyEnrollments, page: 2, has_previous: true });
      }
      if (options.path === '/enrollments' || options.path === '/cart/items') {
        mutationRequests += 1;
      }
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token');

    expect(
      ((await screen.findByRole('button', { name: 'Action unavailable' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(mutationRequests).toBe(0);
  });

  it.each([
    [
      new ApiError({
        kind: 'unauthorized',
        status: 401,
        message: 'Could not validate credentials',
      }),
      'Sign in',
      1,
    ],
    [
      new ApiError({ kind: 'forbidden', status: 403, message: 'private forbidden detail' }),
      'Action unavailable',
      0,
    ],
    [
      new ApiError({ kind: 'not_found', status: 404, message: 'Course not found' }),
      'Action unavailable',
      1,
    ],
    [
      new ApiError({ kind: 'bad_request', status: 400, message: 'Course is not published' }),
      'Action unavailable',
      1,
    ],
    [
      new ApiError({ kind: 'bad_request', status: 400, message: 'Cannot enroll' }),
      'Action unavailable',
      0,
    ],
    [
      new ApiError({ kind: 'validation', status: 422, message: 'private validation detail' }),
      'Action unavailable',
      0,
    ],
    [
      new ApiError({ kind: 'conflict', status: 409, message: 'Unexpected conflict' }),
      'Enroll free',
      0,
    ],
  ])(
    'fails closed after terminal mutation outcome %# and performs the exact detail refresh',
    async (mutationError, expectedLabel, expectedDetailDelta) => {
      let detailRequests = 0;
      let mutationRequests = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, studentProfile);
        if (options.path === '/courses/7') {
          detailRequests += 1;
          return decode(options, course);
        }
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        if (options.path === '/cart') return decode(options, emptyCart);
        if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
        if (options.path === '/enrollments') {
          mutationRequests += 1;
          throw mutationError;
        }
        throw new Error(`Unexpected request ${options.path}`);
      };
      renderPage(request, 'token');
      const user = userEvent.setup();

      const enroll = await screen.findByRole('button', { name: 'Enroll free' });
      const detailRequestsBeforeMutation = detailRequests;
      await act(async () => {
        await user.click(enroll);
      });
      const resultingAction = await screen.findByRole(
        expectedLabel === 'Sign in' ? 'link' : 'button',
        { name: expectedLabel },
      );
      if (expectedLabel === 'Action unavailable' && resultingAction instanceof HTMLButtonElement)
        expect(resultingAction.disabled).toBe(true);
      expect(document.body.textContent).not.toContain('private forbidden detail');
      expect(document.body.textContent).not.toContain('private validation detail');
      await waitFor(() =>
        expect(detailRequests).toBe(detailRequestsBeforeMutation + expectedDetailDelta),
      );
      if (resultingAction instanceof HTMLButtonElement) fireEvent.click(resultingAction);
      expect(mutationRequests).toBe(1);
    },
  );

  it('re-resolves a retained mutation failure when the active locale changes', async () => {
    let mutationRequests = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
      if (options.path === '/enrollments') {
        mutationRequests += 1;
        throw new ApiError({ kind: 'offline', status: null, message: 'private mutation detail' });
      }
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token');

    const enroll = await screen.findByRole('button', { name: 'Enroll free' });
    await act(async () => {
      await userEvent.setup().click(enroll);
    });
    expect(
      await screen.findByText('The action failed. Check your connection and try again.'),
    ).toBeTruthy();
    await act(async () => {
      await localeRuntime.changeLanguage('ru');
    });
    expect(
      await screen.findByText(
        'Не удалось выполнить действие. Проверьте подключение и повторите попытку.',
      ),
    ).toBeTruthy();
    await act(async () => {
      await localeRuntime.changeLanguage('uz');
    });
    expect(
      await screen.findByText(
        'Amalni bajarib bo‘lmadi. Ulanishni tekshirib, qayta urinib ko‘ring.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('private mutation detail')).toBeNull();
    expect(mutationRequests).toBe(1);
  });

  it.each([
    [
      'Already enrolled in this course',
      'The course is already in your learning list.',
      '/enrollments/my',
      '/enrollments',
      '0.00',
      'Enroll free',
    ],
    [
      'Course already in cart',
      'The course is already in your cart.',
      '/cart',
      '/cart/items',
      '19.99',
      'Add to cart',
    ],
  ])(
    'clears a known-conflict override and feedback when its refreshed owner remains eligible: %s',
    async (message, publicMessage, refreshedPath, mutationPath, price, actionLabel) => {
      const counts = new Map<string, number>();
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        counts.set(options.path, (counts.get(options.path) ?? 0) + 1);
        if (options.path === '/me') return decode(options, studentProfile);
        if (options.path === '/courses/7') return decode(options, { ...course, price });
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        if (options.path === '/cart') return decode(options, emptyCart);
        if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
        if (options.path === mutationPath)
          throw new ApiError({ kind: 'conflict', status: 409, message });
        throw new Error(`Unexpected request ${options.path}`);
      };
      renderPage(request, 'token');

      const actionButton = await screen.findByRole('button', { name: actionLabel });
      await act(async () => {
        await userEvent.setup().click(actionButton);
      });
      expect(
        ((await screen.findByRole('button', { name: actionLabel })) as HTMLButtonElement).disabled,
      ).toBe(false);
      await waitFor(() => expect(counts.get(refreshedPath)).toBe(2));
      expect(counts.get(refreshedPath === '/cart' ? '/enrollments/my' : '/cart')).toBe(1);
      expect(counts.get(mutationPath)).toBe(1);
      expect(screen.queryByText(publicMessage)).toBeNull();
    },
  );

  it('clears the generic-conflict override after both preflight owners confirm eligibility', async () => {
    const counts = new Map<string, number>();
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      counts.set(options.path, (counts.get(options.path) ?? 0) + 1);
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
      if (options.path === '/enrollments')
        throw new ApiError({ kind: 'conflict', status: 409, message: 'Unexpected conflict' });
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token');
    const user = userEvent.setup();

    const enroll = await screen.findByRole('button', { name: 'Enroll free' });
    await act(async () => {
      await user.click(enroll);
    });
    expect(
      ((await screen.findByRole('button', { name: 'Enroll free' })) as HTMLButtonElement).disabled,
    ).toBe(false);
    await waitFor(() => expect(counts.get('/cart')).toBe(2));
    expect(counts.get('/enrollments/my')).toBe(2);
    expect(counts.get('/enrollments')).toBe(1);
    expect(
      screen.queryByText('The course state changed. Availability has been refreshed.'),
    ).toBeNull();
  });

  it('clears a generic-conflict notice after authoritative eligibility returns', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/courses/7/reviews')
        return decode(options, {
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          pages: 0,
          has_next: false,
          has_previous: false,
        });
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
      if (options.path === '/enrollments')
        throw new ApiError({ kind: 'conflict', status: 409, message: 'Unexpected conflict' });
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token');

    const enroll = await screen.findByRole('button', { name: 'Enroll free' });
    await act(async () => {
      await userEvent.setup().click(enroll);
    });
    await screen.findByRole('button', { name: 'Enroll free' });
    expect(
      screen.queryByText('The course state changed. Availability has been refreshed.'),
    ).toBeNull();
    expect(document.querySelectorAll('.ui-notice')).toHaveLength(0);
  });

  it('retains success until authority converges, then clears it after authoritative removal', async () => {
    let enrolled = false;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') {
        return decode(
          options,
          enrolled
            ? {
                ...emptyEnrollments,
                items: [enrollmentMutation],
                total: 1,
                pages: 1,
              }
            : emptyEnrollments,
        );
      }
      if (options.path === '/enrollments') return decode(options, enrollmentMutation);
      throw new Error(`Unexpected request ${options.path}`);
    };
    const { queryClient } = renderPage(request, 'token');

    const enroll = await screen.findByRole('button', { name: 'Enroll free' });
    await act(async () => {
      await userEvent.setup().click(enroll);
    });
    expect(
      ((await screen.findByRole('button', { name: 'Already enrolled' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(await screen.findByText('You are now enrolled in this course.')).toBeTruthy();

    enrolled = true;
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(
      ((await screen.findByRole('button', { name: 'Already enrolled' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText('You are now enrolled in this course.')).toBeTruthy();

    const committedStates: Array<{ hasEligibleAction: boolean; hasSuccessNotice: boolean }> = [];
    const observer = new MutationObserver(() => {
      committedStates.push({
        hasEligibleAction: screen.queryByRole('button', { name: 'Enroll free' }) !== null,
        hasSuccessNotice: screen.queryByText('You are now enrolled in this course.') !== null,
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    enrolled = false;
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(
      ((await screen.findByRole('button', { name: 'Enroll free' })) as HTMLButtonElement).disabled,
    ).toBe(false);
    await waitFor(() =>
      expect(screen.queryByText('You are now enrolled in this course.')).toBeNull(),
    );
    observer.disconnect();
    expect(committedStates).not.toContainEqual({ hasEligibleAction: true, hasSuccessNotice: true });
  });

  it.each([
    new ApiError({ kind: 'offline', status: null, message: 'private offline detail' }),
    new ApiError({ kind: 'server', status: 500, message: 'private server detail' }),
  ])(
    'retains an explicit new-attempt action only for retryable mutation errors',
    async (mutationError) => {
      let mutationRequests = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, studentProfile);
        if (options.path === '/courses/7') return decode(options, course);
        if (options.path === '/courses/7/lessons') return decode(options, outline(null));
        if (options.path === '/cart') return decode(options, emptyCart);
        if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
        if (options.path === '/enrollments') {
          mutationRequests += 1;
          throw mutationError;
        }
        throw new Error(`Unexpected request ${options.path}`);
      };
      renderPage(request, 'token');
      const user = userEvent.setup();

      const enroll = await screen.findByRole('button', { name: 'Enroll free' });
      await act(async () => {
        await user.click(enroll);
      });
      expect(
        await screen.findByText('The action failed. Check your connection and try again.'),
      ).toBeTruthy();
      const retry = screen.getByRole('button', { name: 'Enroll free' });
      expect((retry as HTMLButtonElement).disabled).toBe(false);
      await act(async () => {
        await user.click(retry);
      });
      expect(mutationRequests).toBe(2);
    },
  );

  it('does not carry a completed mutation disposition to another course', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/8')
        return decode(options, { ...course, id: 8, title: 'Course eight' });
      if (options.path.endsWith('/lessons')) return decode(options, outline(null));
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
      if (options.path === '/enrollments') return decode(options, enrollmentMutation);
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token', '/courses/7', { routeControls: true });
    const user = userEvent.setup();

    const enroll = await screen.findByRole('button', { name: 'Enroll free' });
    await act(async () => {
      await user.click(enroll);
    });
    expect(
      ((await screen.findByRole('button', { name: 'Already enrolled' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(await screen.findByText('You are now enrolled in this course.')).toBeTruthy();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open course 8' }));
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Course eight' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Enroll free' })).toBeTruthy();
    expect(screen.queryByText('You are now enrolled in this course.')).toBeNull();
  });

  it.each([
    ['success', undefined],
    [
      'known conflict',
      new ApiError({ kind: 'conflict', status: 409, message: 'Already enrolled in this course' }),
    ],
  ])(
    'reconciles the attempted course cache after a pending route change on %s',
    async (_outcome, mutationError) => {
      let resolveMutation: (() => void) | undefined;
      let mutationRequests = 0;
      let enrollmentRequests = 0;
      let enrolled = false;
      const pending = new Promise<void>((resolve) => {
        resolveMutation = () => {
          enrolled = true;
          resolve();
        };
      });
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, studentProfile);
        if (options.path === '/courses/7') return decode(options, course);
        if (options.path === '/courses/8')
          return decode(options, { ...course, id: 8, title: 'Course eight' });
        if (options.path.endsWith('/lessons')) return decode(options, outline(null));
        if (options.path === '/cart') return decode(options, emptyCart);
        if (options.path === '/enrollments/my') {
          enrollmentRequests += 1;
          return decode(
            options,
            enrolled
              ? {
                  ...emptyEnrollments,
                  items: [
                    {
                      id: 12,
                      user_id: 9,
                      course_id: 7,
                      status: 'active',
                      created_at: '2026-07-01T00:00:00Z',
                      updated_at: '2026-07-01T00:00:00Z',
                      course: {
                        id: 7,
                        title: course.title,
                        description: course.description,
                        price: course.price,
                        currency: course.currency,
                      },
                    },
                  ],
                  total: 1,
                  pages: 1,
                }
              : emptyEnrollments,
          );
        }
        if (options.path === '/enrollments') {
          mutationRequests += 1;
          await pending;
          if (mutationError) throw mutationError;
          return decode(options, enrollmentMutation);
        }
        throw new Error(`Unexpected request ${options.path}`);
      };
      renderPage(request, 'token', '/courses/7', { routeControls: true });
      const user = userEvent.setup();

      const enroll = await screen.findByRole('button', { name: 'Enroll free' });
      await act(async () => {
        await user.click(enroll);
      });
      const openCourseEight = screen.getByRole('button', { name: 'Open course 8' });
      await act(async () => {
        await user.click(openCourseEight);
      });
      expect(await screen.findByRole('heading', { level: 1, name: 'Course eight' })).toBeTruthy();
      const enrollmentRequestsBeforeResolution = enrollmentRequests;
      await act(async () => {
        resolveMutation?.();
      });
      await waitFor(() => expect(enrollmentRequests).toBe(enrollmentRequestsBeforeResolution + 1));
      expect(screen.getByRole('button', { name: 'Enroll free' })).toBeTruthy();

      const returnToCourseSeven = screen.getByRole('button', { name: 'Return to course 7' });
      await act(async () => {
        await user.click(returnToCourseSeven);
      });
      expect(
        ((await screen.findByRole('button', { name: 'Already enrolled' })) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Already enrolled' }));
      expect(mutationRequests).toBe(1);
    },
  );

  it('ignores a late mutation outcome after the session identity changes', async () => {
    let resolveEnrollment: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveEnrollment = resolve;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, studentProfile);
      if (options.path === '/courses/7') return decode(options, course);
      if (options.path === '/courses/7/lessons') return decode(options, outline(null));
      if (options.path === '/cart') return decode(options, emptyCart);
      if (options.path === '/enrollments/my') return decode(options, emptyEnrollments);
      if (options.path === '/enrollments') {
        await pending;
        return decode(options, enrollmentMutation);
      }
      throw new Error(`Unexpected request ${options.path}`);
    };
    renderPage(request, 'token', '/courses/7', { sessionControls: true });
    const user = userEvent.setup();

    const enroll = await screen.findByRole('button', { name: 'Enroll free' });
    await act(async () => {
      await user.click(enroll);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Clear session' }));
    });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
    resolveEnrollment?.();
    await waitFor(() =>
      expect(screen.queryByText('You are now enrolled in this course.')).toBeNull(),
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('rejects invalid route IDs without a request', async () => {
    const request = vi.fn(async () => undefined) as unknown as ApiClient['request'];
    renderPage(request, null, '/courses/not-a-number');
    expect(screen.getByRole('heading', { level: 1, name: 'Course not found' })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
