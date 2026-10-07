// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '../../src/app/query';
import type { Cart } from '../../src/entities/cart';
import { SessionProvider, type AccessTokenStore } from '../../src/features/auth-session';
import { CartPage, CompositeCheckoutNotice } from '../../src/pages/cart-page/CartPage';
import {
  CartCompositeCheckoutProvider,
  type CartCompositeCheckoutWorkflow,
} from '../../src/features/checkout-cart';
import { ApiError, type ApiClient, type ApiRequestOptions } from '../../src/shared/api';
import { localeRuntime } from '../../src/shared/locale';
import { QueryClientProvider } from '@tanstack/react-query';

const student = {
  email: 'student@example.test',
  name: 'Sam',
  surname: 'Student',
  role: 'student',
  birthday: null,
  phone_number: null,
  created_at: '2026-01-01T00:00:00Z',
};
const cartWithItems = {
  id: 1,
  items: [
    {
      id: 10,
      course_id: 7,
      added_at: '2026-01-01T00:00:00Z',
      course: { id: 7, title: 'Long accessible course title', price: '19.990', currency: 'USD' },
    },
    {
      id: 11,
      course_id: 8,
      added_at: '2026-01-01T00:00:00Z',
      course: { id: 8, title: 'Second course', price: '10.00', currency: 'USD' },
    },
  ],
  total_price: '29.990',
  currency: 'USD',
  item_count: 2,
};
const cartWithThreeItems = {
  id: 1,
  items: [
    {
      id: 10,
      course_id: 7,
      added_at: '2026-01-01T00:00:00Z',
      course: { id: 7, title: 'First course', price: '10.00', currency: 'USD' },
    },
    {
      id: 11,
      course_id: 8,
      added_at: '2026-01-01T00:00:00Z',
      course: { id: 8, title: 'Middle course', price: '10.00', currency: 'USD' },
    },
    {
      id: 12,
      course_id: 9,
      added_at: '2026-01-01T00:00:00Z',
      course: { id: 9, title: 'Last course', price: '10.00', currency: 'USD' },
    },
  ],
  total_price: '30.00',
  currency: 'USD',
  item_count: 3,
};

function cartWithItemCount(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: index + 100,
    course_id: index + 100,
    added_at: '2026-01-01T00:00:00Z',
    course: {
      id: index + 100,
      title: `Course ${index + 1}`,
      price: '10.00',
      currency: 'USD',
    },
  }));
  return {
    id: 1,
    items,
    total_price: `${count * 10}.00`,
    currency: 'USD',
    item_count: count,
  };
}

const CART_RESIDUAL_COPY = {
  en: {
    breadcrumb: 'Breadcrumb',
    cart: 'Cart',
    cartCourses: 'Cart courses',
    cartTotal: 'Cart total',
    courseCount: '2 courses',
    courseLabel: 'Course',
    empty: 'Your cart is empty',
    failure: 'Simulate payment failure',
    mockCheckout: 'Complete mock payment',
    orderSummary: 'Order summary',
    price: 'Price',
    total: 'Total',
  },
  ru: {
    breadcrumb: 'Хлебные крошки',
    cart: 'Корзина',
    cartCourses: 'Курсы в корзине',
    cartTotal: 'Итог корзины',
    courseCount: '2 курса',
    courseLabel: 'Курс',
    empty: 'Ваша корзина пуста',
    failure: 'Сымитировать ошибку платежа',
    mockCheckout: 'Завершить тестовый платёж',
    orderSummary: 'Итоги заказа',
    price: 'Цена',
    total: 'Итого',
  },
  uz: {
    breadcrumb: 'Yo‘l ko‘rsatkich',
    cart: 'Savat',
    cartCourses: 'Savatdagi kurslar',
    cartTotal: 'Savat jami',
    courseCount: '2 ta kurs',
    courseLabel: 'Kurs',
    empty: 'Savatingiz bo‘sh',
    failure: 'To‘lov xatosini taqlid qilish',
    mockCheckout: 'Sinov to‘lovini yakunlash',
    orderSummary: 'Buyurtma yakuni',
    price: 'Narx',
    total: 'Jami',
  },
} as const;

const CART_MAPPED_CONSUMER_COPY = {
  en: {
    clearAction: 'Clear cart',
    clearVisible: 'Clear',
    clearDialog: 'Clear cart?',
    clearStatus: 'Cart cleared.',
    learningReturn: 'My learning',
    removeStatus: 'Course removed from cart.',
  },
  ru: {
    clearAction: 'Очистить корзину',
    clearVisible: 'Очистить',
    clearDialog: 'Очистить корзину?',
    clearStatus: 'Корзина очищена.',
    learningReturn: 'Моё обучение',
    removeStatus: 'Курс удалён из корзины.',
  },
  uz: {
    clearAction: 'Savatni tozalash',
    clearVisible: 'Tozalash',
    clearDialog: 'Savat tozalansinmi?',
    clearStatus: 'Savat tozalandi.',
    learningReturn: 'Ta’limim',
    removeStatus: 'Kurs savatdan olib tashlandi.',
  },
} as const;

interface CartReturnTargetExpectation {
  readonly expectedHref: string;
  readonly labels: Readonly<Record<'en' | 'ru' | 'uz', string>>;
  readonly returnTo?: string;
}

const CART_RETURN_TARGET_EXPECTATIONS: readonly CartReturnTargetExpectation[] = [
  { expectedHref: '/', labels: { en: 'Catalog', ru: 'Каталог', uz: 'Katalog' } },
  { returnTo: '/', expectedHref: '/', labels: { en: 'Catalog', ru: 'Каталог', uz: 'Katalog' } },
  {
    returnTo: '/courses/7?tab=outline#lessons',
    expectedHref: '/courses/7?tab=outline#lessons',
    labels: { en: 'Course details', ru: 'Сведения о курсе', uz: 'Kurs tafsilotlari' },
  },
  {
    returnTo: '/signup',
    expectedHref: '/signup',
    labels: { en: 'Create account', ru: 'Создать аккаунт', uz: 'Akkaunt yaratish' },
  },
  {
    returnTo: '/login',
    expectedHref: '/login',
    labels: { en: 'Log in', ru: 'Войти', uz: 'Kirish' },
  },
  {
    returnTo: '/forgot-password',
    expectedHref: '/forgot-password',
    labels: { en: 'Forgot password', ru: 'Забыли пароль', uz: 'Parolni unutdingizmi' },
  },
  {
    returnTo: '/reset-password',
    expectedHref: '/reset-password',
    labels: { en: 'Reset password', ru: 'Сбросить пароль', uz: 'Parolni tiklash' },
  },
  {
    returnTo: '/learning?page=2#courses',
    expectedHref: '/learning?page=2#courses',
    labels: { en: 'My learning', ru: 'Моё обучение', uz: 'Ta’limim' },
  },
  {
    returnTo: '/learning/enrollments/4',
    expectedHref: '/learning/enrollments/4',
    labels: {
      en: 'Learning details',
      ru: 'Сведения об обучении',
      uz: 'Ta’lim tafsilotlari',
    },
  },
  {
    returnTo: '/learning/enrollments/4/ai-chat',
    expectedHref: '/learning/enrollments/4/ai-chat',
    labels: { en: 'Course assistant', ru: 'Ассистент курса', uz: 'Kurs yordamchisi' },
  },
  {
    returnTo: '/ai-chat',
    expectedHref: '/ai-chat',
    labels: { en: 'AI assistant', ru: 'ИИ-ассистент', uz: 'AI yordamchi' },
  },
  {
    returnTo: '/instructor/courses',
    expectedHref: '/instructor/courses',
    labels: {
      en: 'Instructor courses',
      ru: 'Курсы преподавателя',
      uz: 'O‘qituvchi kurslari',
    },
  },
  {
    returnTo: '/instructor/courses/7/edit',
    expectedHref: '/instructor/courses/7/edit',
    labels: { en: 'Edit course', ru: 'Редактировать курс', uz: 'Kursni tahrirlash' },
  },
  {
    returnTo: '/instructor/courses/7/enrollments',
    expectedHref: '/instructor/courses/7/enrollments',
    labels: { en: 'Course enrollments', ru: 'Записи на курс', uz: 'Kursga yozilishlar' },
  },
  {
    returnTo: '/instructor/lessons/12/edit',
    expectedHref: '/instructor/lessons/12/edit',
    labels: { en: 'Edit lesson', ru: 'Редактировать урок', uz: 'Darsni tahrirlash' },
  },
];

function tokenStore(token = 'student-token'): AccessTokenStore {
  let value: string | null = token;
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

interface CartRouteEntry {
  readonly pathname: string;
  readonly state?: unknown;
}

type CartInitialEntry = string | CartRouteEntry;

function decode<TResponse, TBody>(
  options: ApiRequestOptions<TBody, TResponse>,
  value: unknown,
): TResponse {
  return options.decode ? options.decode(value) : (value as TResponse);
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div aria-label="Current route">{`${location.pathname}${location.search}${location.hash}`}</div>
  );
}

async function renderCart(request: ApiClient['request'], initialEntry: CartInitialEntry = '/cart') {
  const queryClient = createAppQueryClient();
  await act(async () => {
    render(
      <I18nextProvider i18n={localeRuntime}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider client={{ request }} tokenStore={tokenStore()}>
            <MemoryRouter
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
              initialEntries={[initialEntry]}
            >
              <CartCompositeCheckoutProvider>
                <LocationProbe />
                <CartPage />
              </CartCompositeCheckoutProvider>
            </MemoryRouter>
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );
  });
  return queryClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localeRuntime.addResource('en', 'cart', 'retryPayment', 'Retry payment');
  localeRuntime.addResource('en', 'cart', 'paymentRetryRequired', 'Payment retry required');
});

beforeEach(async () => {
  await localeRuntime.changeLanguage('en');
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CART_PAGE_SOURCE = readFileSync(
  pathToFileURL(resolve(process.cwd(), 'src/pages/cart-page/CartPage.tsx')),
  'utf8',
);
const CART_PAGE_STYLES = readFileSync(
  pathToFileURL(resolve(process.cwd(), 'src/pages/cart-page/CartPage.module.css')),
  'utf8',
);
const CART_SUMMARY_JUMP_SOURCE = readFileSync(
  pathToFileURL(resolve(process.cwd(), 'src/pages/cart-page/use-cart-summary-jump.ts')),
  'utf8',
);

function cssDeclarationBlock(source: string, selectorStart: string): string {
  const selectorOffset = source.indexOf(selectorStart);
  expect(selectorOffset).toBeGreaterThanOrEqual(0);
  const blockStart = source.indexOf('{', selectorOffset);
  const blockEnd = source.indexOf('}', blockStart);
  expect(blockStart).toBeGreaterThan(selectorOffset);
  expect(blockEnd).toBeGreaterThan(blockStart);
  return source.slice(blockStart + 1, blockEnd);
}

async function interact(action: () => Promise<void>) {
  await act(async () => {
    await action();
  });
}

async function removeCourseAndExpectFocus(courseId: number, expectedActionName: string) {
  let currentItems = cartWithThreeItems.items;
  const request: ApiClient['request'] = async <TResponse, TBody>(
    options: ApiRequestOptions<TBody, TResponse>,
  ) => {
    if (options.path === '/me') return decode(options, student);
    if (options.path === '/cart' && options.method === 'GET') {
      return decode(options, {
        ...cartWithThreeItems,
        items: currentItems,
        item_count: currentItems.length,
      });
    }
    if (options.path === `/cart/items/${courseId}`) {
      currentItems = currentItems.filter((item) => item.course_id !== courseId);
      return decode(options, undefined);
    }
    throw new Error(`Unexpected request ${options.method} ${options.path}`);
  };
  await renderCart(request);
  const user = userEvent.setup();

  const removeAction = await screen.findByRole('button', {
    name: `Remove ${cartWithThreeItems.items.find((item) => item.course_id === courseId)?.course.title}`,
  });
  await interact(() => user.click(removeAction));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: expectedActionName })).toBe(document.activeElement),
  );
}

describe('CartPage', () => {
  it('keeps the backend-401 login recovery bound to a 44px local text-link target', () => {
    expect(CART_PAGE_SOURCE).toMatch(
      /<Link\s+className=\{styles\.loginRecoveryLink\}\s+to=\{`\/login\?returnTo=\$\{encodeURIComponent\('\/cart'\)\}`\}\s*>/,
    );

    const loginRecoveryRule = cssDeclarationBlock(CART_PAGE_STYLES, '.loginRecoveryLink,');
    expect(loginRecoveryRule).toContain('display: inline-flex;');
    expect(loginRecoveryRule).toContain('min-height: var(--control-height-md);');
    expect(loginRecoveryRule).toContain('align-items: center;');
    expect(loginRecoveryRule).toContain('font-size: var(--type-body-md-size);');
    expect(loginRecoveryRule).toContain('font-weight: var(--font-weight-medium);');
    expect(loginRecoveryRule).toContain('line-height: var(--type-body-md-lh);');
  });

  it('keeps the backend-403 catalog recovery in the same DD-258 typography family', () => {
    const catalogRecoveryRule = cssDeclarationBlock(CART_PAGE_STYLES, '.catalogLink');

    expect(CART_PAGE_SOURCE).toContain('<Link className={styles.catalogLink} to="/">');
    expect(catalogRecoveryRule).toContain('min-height: var(--control-height-md);');
    expect(catalogRecoveryRule).toContain('font-size: var(--type-body-md-size);');
    expect(catalogRecoveryRule).toContain('font-weight: var(--font-weight-medium);');
    expect(catalogRecoveryRule).toContain('line-height: var(--type-body-md-lh);');
  });

  it('measures the summary jump from the structural Cart navigation seam, not localized copy', () => {
    expect(CART_SUMMARY_JUMP_SOURCE).toContain(
      'querySelector<HTMLAnchorElement>(\'nav a[href="/cart"]\')',
    );
    expect(CART_SUMMARY_JUMP_SOURCE).not.toContain('[aria-label="Student navigation"]');
  });

  it.each([
    ['en', 1, '1 course'],
    ['en', 2, '2 courses'],
    ['ru', 1, '1 курс'],
    ['ru', 2, '2 курса'],
    ['ru', 5, '5 курсов'],
    ['uz', 2, '2 ta kurs'],
  ] as const)(
    'uses the existing natural course-count plural in %s for %i items',
    async (locale, count, expected) => {
      await act(() => localeRuntime.changeLanguage(locale));
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, cartWithItemCount(count));
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };

      await renderCart(request);

      expect(await screen.findByText(expected, { exact: true })).toBeTruthy();
    },
  );

  it.each(['en', 'ru', 'uz'] as const)(
    'localizes every allocated safe return label in %s without changing its route target',
    async (locale) => {
      await act(() => localeRuntime.changeLanguage(locale));
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, cartWithItems);
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };

      for (const expectation of CART_RETURN_TARGET_EXPECTATIONS) {
        await renderCart(request, {
          pathname: '/cart',
          state:
            expectation.returnTo === undefined ? undefined : { returnTo: expectation.returnTo },
        });

        const source = await screen.findByRole('link', { name: expectation.labels[locale] });
        expect(source.getAttribute('href')).toBe(expectation.expectedHref);
        if (locale !== 'en') expect(source.textContent).not.toBe(expectation.labels.en);
        cleanup();
      }
    },
  );

  it.each(['en', 'ru', 'uz'] as const)(
    'renders the admitted visible and accessible Cart family in %s',
    async (locale) => {
      const copy = CART_RESIDUAL_COPY[locale];
      await act(() => localeRuntime.changeLanguage(locale));
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, cartWithItems);
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };

      await renderCart(request);

      expect(await screen.findByRole('heading', { level: 1, name: copy.cart })).toBeTruthy();
      expect(screen.getByRole('navigation', { name: copy.breadcrumb })).toBeTruthy();
      const courses = screen.getByRole('list', { name: copy.cartCourses });
      expect(within(courses).getAllByText(copy.courseLabel)).toHaveLength(2);
      expect(within(courses).getAllByText(copy.price)).toHaveLength(2);
      expect(screen.getByText(copy.courseCount)).toBeTruthy();
      const total = screen.getByRole('complementary', { name: copy.cartTotal });
      expect(within(total).getByRole('heading', { name: copy.orderSummary })).toBeTruthy();
      expect(within(total).getByText(copy.total)).toBeTruthy();
      expect(within(total).getByRole('button', { name: copy.mockCheckout })).toBeTruthy();
      expect(within(total).getByRole('button', { name: copy.failure })).toBeTruthy();
      expect(within(courses).queryByRole('button', { name: copy.failure })).toBeNull();
      expect(document.body.textContent).not.toMatch(/Translation unavailable|(?:cart|a11y):\w+/);
      cleanup();

      await renderCart(async <TResponse, TBody>(options: ApiRequestOptions<TBody, TResponse>) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, { ...cartWithItems, items: [], item_count: 0 });
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      });
      expect(await screen.findByRole('heading', { name: copy.empty })).toBeTruthy();
    },
  );

  it.each([
    {
      entry: { pathname: '/cart', state: { returnTo: '/learning?page=2#courses' } },
      expectedLabel: 'My learning',
      expectedHref: '/learning?page=2#courses',
    },
    {
      entry: { pathname: '/cart', state: { returnTo: '/' } },
      expectedLabel: 'Catalog',
      expectedHref: '/',
    },
    {
      entry: { pathname: '/cart', state: { returnTo: '/courses/7?tab=outline#lessons' } },
      expectedLabel: 'Course details',
      expectedHref: '/courses/7?tab=outline#lessons',
    },
    {
      entry: { pathname: '/cart', state: { returnTo: '/instructor/courses/7/edit' } },
      expectedLabel: 'Edit course',
      expectedHref: '/instructor/courses/7/edit',
    },
    {
      entry: { pathname: '/cart', state: { returnTo: 'https://outside.example/cart' } },
      expectedLabel: 'Catalog',
      expectedHref: '/',
    },
    {
      entry: { pathname: '/cart', state: { returnTo: '/cart?coupon=SAVE' } },
      expectedLabel: 'Catalog',
      expectedHref: '/',
    },
  ])(
    'renders only the safe source return link for resolved Cart state',
    async ({ entry, expectedLabel, expectedHref }) => {
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, cartWithItems);
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };

      await renderCart(request, entry);

      const source = await screen.findByRole('link', { name: expectedLabel });
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(source.getAttribute('href')).toBe(expectedHref);
      expect(breadcrumb.contains(source)).toBe(true);
      expect(source.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(screen.getByText('/', { selector: 'span' })).toBeTruthy();
      expect(screen.getByText('Cart', { selector: 'span' })).toBeTruthy();
      expect(screen.getByText('Cart', { selector: '[aria-current="page"]' })).toBeTruthy();
      expect(
        source.compareDocumentPosition(screen.getByRole('heading', { name: 'Cart' })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it.each(['pointer', 'Enter', 'Space'])(
    'uses the existing Router click path for the safe My learning return on %s',
    async (activation) => {
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, cartWithItems);
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };
      await renderCart(request, {
        pathname: '/cart',
        state: { returnTo: '/learning?page=2#courses' },
      });
      const user = userEvent.setup();
      const source = await screen.findByRole('link', { name: 'My learning' });

      source.focus();
      expect(source).toBe(document.activeElement);
      if (activation === 'pointer') await interact(() => user.click(source));
      if (activation === 'Enter') await interact(() => user.keyboard('{Enter}'));
      if (activation === 'Space') await interact(() => user.keyboard(' '));

      await waitFor(() =>
        expect(screen.getByLabelText('Current route').textContent).toBe('/learning?page=2#courses'),
      );
    },
  );

  it('activates the non-self Catalog fallback through the Router click path on unmodified Space', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, cartWithItems);
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request, { pathname: '/cart', state: { returnTo: '/cart?coupon=SAVE' } });
    const user = userEvent.setup();
    const source = await screen.findByRole('link', { name: 'Catalog' });

    source.focus();
    expect(source).toBe(document.activeElement);
    await interact(() => user.keyboard(' '));

    await waitFor(() => expect(screen.getByLabelText('Current route').textContent).toBe('/'));
  });

  it('accepts Chromium Space-key aliases without changing the safe return target', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, cartWithItems);
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request, {
      pathname: '/cart',
      state: { returnTo: '/learning?page=2#courses' },
    });
    const source = await screen.findByRole('link', { name: 'My learning' });

    source.focus();
    fireEvent.keyDown(source, { key: 'Space', code: 'Space' });

    await waitFor(() =>
      expect(screen.getByLabelText('Current route').textContent).toBe('/learning?page=2#courses'),
    );
  });

  it('uses the no-observer fallback to expose one mobile summary jump without checkout', async () => {
    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    try {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      vi.stubGlobal('IntersectionObserver', undefined);
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query === '(max-width: 1023px)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      );
      const scrollIntoView = vi.fn();
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      });
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, cartWithItems);
        if (options.path === '/cart/checkout') throw new Error('Checkout must not run');
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };

      await renderCart(request);
      const summaryHeading = await screen.findByRole('heading', { name: 'Order summary' });
      Object.defineProperty(summaryHeading, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          bottom: 1024,
          height: 24,
          left: 0,
          right: 0,
          toJSON: () => ({}),
          top: 1000,
          width: 200,
          x: 0,
          y: 1000,
        }),
      });
      fireEvent.scroll(window);

      const jump = await screen.findByRole('button', { name: 'Go to order summary' });
      expect(screen.getAllByRole('heading', { name: 'Order summary' })).toHaveLength(1);
      const cartCourses = screen.getByRole('list', { name: 'Cart courses' });
      expect(
        cartCourses.compareDocumentPosition(jump) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const user = userEvent.setup();
      screen.getByRole('button', { name: 'Remove Second course' }).focus();
      await interact(() => user.tab());
      expect(jump).toBe(document.activeElement);
      await interact(() => user.tab());
      expect(screen.getByRole('button', { name: 'Complete mock payment' })).toBe(
        document.activeElement,
      );
      await interact(() => user.tab());
      expect(screen.getByRole('button', { name: 'Simulate payment failure' })).toBe(
        document.activeElement,
      );
      fireEvent.click(jump);
      expect(summaryHeading).toBe(document.activeElement);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(screen.getByRole('button', { name: 'Complete mock payment' })).toBeTruthy();
    } finally {
      if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight);
      else delete (window as { innerHeight?: number }).innerHeight;
      if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
      else delete (window as { innerWidth?: number }).innerWidth;
      if (originalScrollIntoView)
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('clears cancelled summary frames across effect restart and unmount cleanup', async () => {
    const originalSummaryBounds = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect',
    );
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frameCallbacks.set(nextFrameId, callback);
      return nextFrameId;
    });
    const cancelAnimationFrame = vi.fn((frameId: number) => {
      frameCallbacks.delete(frameId);
    });
    let summaryTop = 1000;
    try {
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          bottom: summaryTop + 24,
          height: 24,
          left: 0,
          right: 200,
          toJSON: () => ({}),
          top: summaryTop,
          width: 200,
          x: 0,
          y: summaryTop,
        }),
      });
      vi.stubGlobal('IntersectionObserver', undefined);
      vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
      vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(options, cartWithItems);
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };

      const queryClient = await renderCart(request);
      expect(await screen.findByRole('button', { name: 'Go to order summary' })).toBeTruthy();
      expect(requestAnimationFrame).not.toHaveBeenCalled();

      fireEvent.scroll(window);
      fireEvent.resize(window);
      fireEvent.scroll(window);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(frameCallbacks.size).toBe(1);
      const firstFrame = frameCallbacks.get(1);
      if (!firstFrame) throw new Error('Expected the summary visibility frame.');
      frameCallbacks.delete(1);
      await act(async () => {
        firstFrame(0);
      });

      fireEvent.resize(window);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
      expect(frameCallbacks.has(2)).toBe(true);

      const cartQuery = queryClient
        .getQueryCache()
        .getAll()
        .find((query) => query.queryKey[2] === 'API-002');
      const cachedCart = cartQuery?.state.data as Cart | undefined;
      if (!cartQuery || !cachedCart) throw new Error('Expected the cached Cart query.');
      await act(async () => {
        queryClient.setQueryData<Cart>(cartQuery.queryKey, {
          ...cachedCart,
          totalPrice: `${cachedCart.totalPrice}0`,
        });
      });
      await waitFor(() => expect(cancelAnimationFrame).toHaveBeenCalledWith(2));
      expect(frameCallbacks.size).toBe(0);

      summaryTop = 80;
      fireEvent.resize(window);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(3);
      const restartedFrame = frameCallbacks.get(3);
      if (!restartedFrame) throw new Error('Expected a frame after the summary effect restarted.');
      frameCallbacks.delete(3);
      await act(async () => {
        restartedFrame(0);
      });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Go to order summary' })).toBeNull(),
      );

      fireEvent.scroll(window);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(4);
      expect(frameCallbacks.has(4)).toBe(true);
      cleanup();
      expect(cancelAnimationFrame).toHaveBeenCalledWith(4);
      expect(frameCallbacks.size).toBe(0);
    } finally {
      if (originalSummaryBounds)
        Object.defineProperty(
          HTMLElement.prototype,
          'getBoundingClientRect',
          originalSummaryBounds,
        );
      else
        delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it('keeps the admitted cart visible and route stable until a simulated failure is restored', async () => {
    const cartResources = localeRuntime.getResourceBundle('en', 'cart') as Record<string, string>;
    delete cartResources.retryPayment;
    delete cartResources.paymentRetryRequired;
    let cartReads = 0;
    let paymentRequests = 0;
    let courseRemoved = false;
    const pendingEnrollment = {
      id: 70,
      user_id: 1,
      course_id: 7,
      status: 'pending_payment',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      course: {
        id: 7,
        title: 'Long accessible course title',
        description: null,
        price: '19.990',
        currency: 'USD',
      },
    };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET') {
        cartReads += 1;
        return decode(
          options,
          courseRemoved
            ? { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 }
            : cartReads === 1
              ? { ...cartWithItems, items: [cartWithItems.items[0]], item_count: 1 }
              : cartReads === 2
                ? { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 }
                : {
                    id: 1,
                    items: [cartWithItems.items[0]],
                    total_price: '19.990',
                    currency: 'USD',
                    item_count: 1,
                  },
        );
      }
      if (options.path === '/cart/checkout')
        return decode(options, { message: 'accepted', enrolled_courses: 1 });
      if (options.path === '/enrollments/my')
        return decode(options, {
          items: [pendingEnrollment],
          page: 1,
          page_size: 100,
          total: 1,
          pages: 1,
          has_next: false,
          has_previous: false,
        });
      if (options.path === '/payments/complete') {
        paymentRequests += 1;
        return decode(options, { enrollment_id: 70, status: 'cancelled', message: 'cancelled' });
      }
      if (options.path === '/cart/items')
        return decode(options, {
          id: 10,
          course_id: 7,
          added_at: '2026-01-01T00:00:00Z',
          course: {
            id: 7,
            title: 'Long accessible course title',
            price: '19.990',
            currency: 'USD',
          },
        });
      if (options.path === '/cart/items/7' && options.method === 'DELETE') {
        courseRemoved = true;
        return decode(options, undefined);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const summary = await screen.findByRole('complementary', { name: 'Cart total' });
    expect(
      screen.queryByRole('button', {
        name: 'Simulate payment failure: Long accessible course title',
      }),
    ).toBeNull();
    const simulateFailure = within(summary).getByRole('button', {
      name: 'Simulate payment failure',
    });
    vi.useFakeTimers();
    fireEvent.click(simulateFailure);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByLabelText('Current route').textContent).toBe('/cart');
    expect(screen.getByRole('heading', { name: 'Cart' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Cart courses' }).textContent).toContain(
      'Long accessible course title',
    );
    expect(screen.queryByRole('heading', { name: 'Your cart is empty' })).toBeNull();
    expect(screen.getByText('Payment pending', { exact: true })).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Remove Long accessible course title',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Clear cart' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(paymentRequests).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_999);
    });
    expect(screen.getByLabelText('Current route').textContent).toBe('/cart');
    expect(screen.getByRole('list', { name: 'Cart courses' }).textContent).toContain(
      'Long accessible course title',
    );
    expect(screen.getByText('Payment pending', { exact: true })).toBeTruthy();
    expect(paymentRequests).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(paymentRequests).toBe(1);
    expect(screen.getAllByText('Payment failed')).toHaveLength(1);
    const restoredCourseCard = screen
      .getByRole('link', { name: 'Long accessible course title' })
      .closest<HTMLElement>('[role="listitem"]');
    if (!restoredCourseCard) throw new Error('The restored Cart course card is unavailable.');
    const restoredPaymentAlert = within(restoredCourseCard).getByRole('alert');
    expect(restoredPaymentAlert.textContent).toContain('Payment failed');
    expect(restoredPaymentAlert.textContent).toContain('The course was returned to your cart.');
    expect(document.activeElement).toBe(restoredPaymentAlert);
    expect(
      screen.getByRole('button', { name: 'Retry mock payment: Long accessible course title' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Retry mock payment: Long accessible course title' })
        .textContent,
    ).toBe('Retry payment');
    expect(
      within(summary).getByText('Payment retry required · 1 course', { exact: true }),
    ).toBeTruthy();
    expect(within(summary).queryByRole('button', { name: 'Complete mock payment' })).toBeNull();
    expect(within(summary).queryByRole('button', { name: 'Simulate payment failure' })).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Retry mock payment: Long accessible course title',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByText('Checkout accepted')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Check My Learning' })).toBeNull();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Long accessible course title' }));
    await screen.findByRole('heading', { name: 'Your cart is empty' });
    await waitFor(() => expect(courseRemoved).toBe(true));
    expect(screen.queryByText('Payment failed', { exact: true })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Retry mock payment: Long accessible course title' }),
    ).toBeNull();
    expect(screen.queryByText('Payment retry required · 1 course', { exact: true })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Your cart is empty' }),
    );
  });

  it.each(['Complete mock payment', 'Simulate payment failure'])(
    'starts %s after an earlier empty-cart recovery check',
    async (actionName) => {
      let hasCartItems = false;
      let enrollmentReads = 0;
      let checkoutRequests = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET')
          return decode(
            options,
            hasCartItems
              ? cartWithItems
              : { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 },
          );
        if (options.path === '/enrollments/my') {
          enrollmentReads += 1;
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
        if (options.path === '/cart/checkout') {
          checkoutRequests += 1;
          return decode(options, { message: 'accepted', enrolled_courses: 2 });
        }
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };
      const queryClient = await renderCart(request);

      expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeTruthy();
      await waitFor(() => expect(enrollmentReads).toBe(1));

      hasCartItems = true;
      await act(async () => {
        await queryClient.invalidateQueries();
      });
      fireEvent.click(await screen.findByRole('button', { name: actionName }));

      await waitFor(() => expect(checkoutRequests).toBe(1));
    },
  );

  it('keeps recovery and the completed result visible when the cart is empty', async () => {
    const counts = { checkout: 0, enrollmentReads: 0, payments: 0 };
    const pendingEnrollment = {
      id: 70,
      user_id: 1,
      course_id: 7,
      status: 'pending_payment',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      course: {
        id: 7,
        title: 'Recovered empty-cart course',
        description: null,
        price: '19.990',
        currency: 'USD',
      },
    };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, {
          id: 1,
          items: [],
          total_price: '0.00',
          currency: 'USD',
          item_count: 0,
        });
      if (options.path === '/enrollments/my') {
        counts.enrollmentReads += 1;
        return decode(options, {
          items: [pendingEnrollment],
          page: 1,
          page_size: 100,
          total: 1,
          pages: 1,
          has_next: false,
          has_previous: false,
        });
      }
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        throw new Error('Recovery must not create another checkout.');
      }
      if (options.path === '/payments/complete') {
        counts.payments += 1;
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeTruthy();
    expect(await screen.findByText('Payment pending')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Payment pending' }).textContent).toContain(
      'Recovered empty-cart course',
    );
    const resume = await screen.findByRole('button', { name: 'Check pending payment' });
    await interact(() => user.click(resume));

    expect(await screen.findByText('Payment completed')).toBeTruthy();
    expect(screen.getByText('Recovered empty-cart course')).toBeTruthy();
    expect(counts).toEqual({ checkout: 0, enrollmentReads: 2, payments: 1 });
    expect(screen.queryByText('Checkout accepted')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Check My Learning' })).toBeNull();
  });

  it('keeps initial empty-Cart recovery discovery visually quiet', () => {
    const checkout: CartCompositeCheckoutWorkflow = {
      phase: 'discovering_recovery',
      completionPlan: [],
      results: [],
      recoveryCandidates: [],
      pending: true,
      start: vi.fn(),
      retryRestoredCourse: vi.fn(),
      dismissRestoredCourses: vi.fn(),
      dismissSuccessfulCourses: vi.fn(),
      discoverRecovery: vi.fn(),
      resumeRecovery: vi.fn(),
    };
    render(
      <I18nextProvider i18n={localeRuntime}>
        <CompositeCheckoutNotice
          checkout={checkout}
          courseTitles={new Map()}
          onRetryPayment={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.queryByText('Payment pending', { exact: true })).toBeNull();
    expect(screen.queryByText('Checking out…', { exact: true })).toBeNull();
  });

  it('renders every server-proven recovery candidate in the populated-Cart notice', () => {
    const resumeRecovery = vi.fn();
    const checkout: CartCompositeCheckoutWorkflow = {
      phase: 'recovery_candidates',
      completionPlan: [],
      results: [],
      recoveryCandidates: [
        {
          enrollmentId: 70,
          courseId: 7,
          course: {
            id: 7,
            title: 'Recovered alongside cart course',
            description: null,
            price: '19.990',
            currency: 'USD',
          },
        },
        {
          enrollmentId: 71,
          courseId: 9,
          course: {
            id: 9,
            title: 'Second recovered course',
            description: null,
            price: '10.00',
            currency: 'USD',
          },
        },
      ],
      pending: false,
      start: vi.fn(),
      retryRestoredCourse: vi.fn(),
      dismissRestoredCourses: vi.fn(),
      dismissSuccessfulCourses: vi.fn(),
      discoverRecovery: vi.fn(),
      resumeRecovery,
    };
    render(
      <I18nextProvider i18n={localeRuntime}>
        <CompositeCheckoutNotice
          checkout={checkout}
          courseTitles={new Map([[8, 'Unrelated cart course']])}
          onRetryPayment={vi.fn()}
        />
      </I18nextProvider>,
    );

    const candidates = screen.getByRole('list', { name: 'Payment pending' });
    expect(candidates.textContent).toContain('Recovered alongside cart course');
    expect(candidates.textContent).toContain('Second recovered course');
    expect(screen.getByRole('button', { name: 'Check pending payment' })).toBeTruthy();
  });

  it('keeps a restored result visible but omits its retry while integrity is unknown', () => {
    const retry = vi.fn();
    const checkout: CartCompositeCheckoutWorkflow = {
      phase: 'checkout_integrity_unknown',
      completionPlan: [],
      results: [
        { enrollmentId: 70, courseId: 7, kind: 'restored' },
        { enrollmentId: 80, courseId: 8, kind: 'integrity_unknown' },
      ],
      recoveryCandidates: [],
      pending: false,
      start: vi.fn(),
      retryRestoredCourse: vi.fn(),
      dismissRestoredCourses: vi.fn(),
      dismissSuccessfulCourses: vi.fn(),
      discoverRecovery: vi.fn(),
      resumeRecovery: vi.fn(),
    };
    render(
      <I18nextProvider i18n={localeRuntime}>
        <CompositeCheckoutNotice
          checkout={checkout}
          courseTitles={
            new Map([
              [7, 'Proven active course'],
              [8, 'Uncertain course'],
            ])
          }
          onRetryPayment={retry}
        />
      </I18nextProvider>,
    );

    const warning = screen.getByText('Payment result needs checking', { exact: true });
    const provenResult = screen.getByText('Payment failed', { exact: true });
    expect(screen.getByText('Proven active course')).toBeTruthy();
    expect(screen.queryByText('Uncertain course')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Retry mock payment: Proven active course',
      }),
    ).toBeNull();
    expect(retry).not.toHaveBeenCalled();
    expect(
      warning.compareDocumentPosition(provenResult) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the exact long server total without decimal recomputation', async () => {
    const totalPrice = '1000000000000000000000019.0001';
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, { ...cartWithItems, total_price: totalPrice });
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);

    expect((await screen.findByLabelText('Cart total')).textContent).toContain(
      '$1,000,000,000,000,000,000,000,019.0001',
    );
  });

  it('composes the exact Cart list-and-summary hierarchy without a selection control', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, cartWithItems);
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);

    expect(screen.queryByText('Student workspace')).toBeNull();
    expect(await screen.findByText('2 courses')).toBeTruthy();
    expect(screen.queryByText('2 courses in cart')).toBeNull();
    expect(screen.queryByText('Courses')).toBeNull();
    expect(screen.queryByRole('button', { name: /select all/i })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Long accessible course title' }).getAttribute('href'),
    ).toBe('/courses/7');
    expect(
      screen
        .getByRole('link', { name: 'Preview Long accessible course title' })
        .getAttribute('href'),
    ).toBe('/courses/7');
    expect(
      screen
        .getByRole('button', { name: 'Remove Long accessible course title' })
        .querySelector('svg'),
    ).toBeTruthy();
    const cartItem = screen
      .getByRole('link', { name: 'Long accessible course title' })
      .closest<HTMLElement>('[role="listitem"]');
    if (!cartItem) throw new Error('Long-title Cart item is unavailable.');
    const price = within(cartItem).getByText('Price', { selector: 'p' });
    const remove = screen.getByRole('button', { name: 'Remove Long accessible course title' });
    expect(price.parentElement?.parentElement).toBe(
      remove.parentElement?.parentElement?.parentElement,
    );
    expect(price.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const summary = screen.getByLabelText('Cart total');
    expect(within(summary).getByRole('heading', { name: 'Order summary' })).toBeTruthy();
    expect(within(summary).getByText('Total')).toBeTruthy();
    expect(within(summary).getByRole('separator')).toBeTruthy();
    expect(summary.textContent).toContain('$29.990');
    const clearCart = screen.getByRole('button', { name: 'Clear cart' });
    expect(clearCart.querySelector('svg')).toBeTruthy();
    expect(clearCart.className).toContain('clearCartButton');
    const titleGroup = screen.getByRole('heading', { name: 'Cart' }).parentElement;
    expect(titleGroup?.className).toContain('titleRow');
    expect(titleGroup?.parentElement?.className).toContain('toolbar');
    expect(titleGroup?.parentElement?.contains(clearCart)).toBe(true);
    const checkout = screen.getByRole('button', { name: 'Complete mock payment' });
    expect(checkout).toBeTruthy();
    const disclosure = within(summary).getByText('Insecure checkout');
    expect(disclosure.tagName).toBe('SPAN');
    expect(disclosure.parentElement?.tagName).toBe('P');
    expect(disclosure.parentElement?.children).toHaveLength(2);
    expect(disclosure.parentElement?.children[0]?.tagName.toLowerCase()).toBe('svg');
    expect(disclosure.parentElement?.children[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(disclosure.parentElement?.children[1]).toBe(disclosure);
    expect(summary.contains(checkout)).toBe(true);
  });

  it('does not display a converted or collapsed Total for mixed authoritative row currencies', async () => {
    const mixedCurrencyCart = {
      ...cartWithItems,
      items: [
        cartWithItems.items[0],
        {
          ...cartWithItems.items[1],
          course: { ...cartWithItems.items[1].course, currency: 'EUR' },
        },
      ],
    };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, mixedCurrencyCart);
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);

    expect(await screen.findByText('Total unavailable')).toBeTruthy();
    expect(screen.getByLabelText('Cart total').textContent).not.toContain('USD 29.990');
    expect(screen.getByText('$19.990')).toBeTruthy();
    expect(screen.getByText('€10.00')).toBeTruthy();
  });

  it('centers an empty-cart recovery card with its real catalog link', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, {
          id: 1,
          items: [],
          total_price: '0.00',
          currency: 'USD',
          item_count: 0,
        });
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);

    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse courses' }).getAttribute('href')).toBe('/');
  });

  it('keeps the newest initial-error retry focus intent when an obsolete retry fails', async () => {
    let reads = 0;
    let rejectFirstRetry: ((error: Error) => void) | undefined;
    const firstRetry = new Promise<unknown>((_resolve, reject) => {
      rejectFirstRetry = reject;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET') {
        reads += 1;
        if (reads === 1) throw new ApiError({ kind: 'server', status: 503, message: 'private' });
        if (reads === 2) return decode(options, await firstRetry);
        if (reads === 3) return decode(options, cartWithItems);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();
    const refresh = await screen.findByRole('button', { name: 'Refresh cart' });
    await act(async () => {
      fireEvent.click(refresh);
      fireEvent.click(refresh);
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(
      (screen.getByRole('button', { name: 'Refresh cart' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      rejectFirstRetry?.(new ApiError({ kind: 'server', status: 503, message: 'private' }));
    });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Refresh cart' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await interact(() => user.click(screen.getByRole('button', { name: 'Refresh cart' })));
    await waitFor(() => expect(reads).toBe(3));
    await screen.findByRole('button', { name: 'Remove Long accessible course title' });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Cart' })).toBe(document.activeElement),
    );
  });

  it('does not steal focus during an ordinary retained-data refresh', async () => {
    let reads = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET') {
        reads += 1;
        if (reads === 2) throw new ApiError({ kind: 'server', status: 503, message: 'private' });
        return decode(options, cartWithItems);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const queryClient = await renderCart(request);
    const remove = await screen.findByRole('button', {
      name: 'Remove Long accessible course title',
    });

    await act(async () => {
      await queryClient.invalidateQueries(
        {
          predicate: (query) => query.queryKey[0] === 'private' && query.queryKey[2] === 'API-002',
        },
        { throwOnError: false },
      );
    });
    const refresh = await screen.findByRole('button', { name: 'Refresh cart' });
    remove.focus();
    await act(async () => {
      fireEvent.click(refresh);
    });

    await waitFor(() => expect(reads).toBe(3));
    expect(remove).toBe(document.activeElement);
  });

  it('serializes destructive input, exposes aggregate busy state, and revalidates the shared cart after removal', async () => {
    let resolveRemove: (() => void) | undefined;
    let cartReads = 0;
    let removeRequests = 0;
    let clearRequests = 0;
    const pendingRemove = new Promise<void>((resolve) => {
      resolveRemove = resolve;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET') {
        cartReads += 1;
        return decode(
          options,
          cartReads === 1
            ? cartWithItems
            : {
                ...cartWithItems,
                items: [cartWithItems.items[1]],
                total_price: '10.00',
                item_count: 1,
              },
        );
      }
      if (options.path === '/cart/items/7') {
        removeRequests += 1;
        await pendingRemove;
        return decode(options, undefined);
      }
      if (options.path === '/cart') {
        clearRequests += 1;
        return decode(options, undefined);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();

    const remove = await screen.findByRole('button', {
      name: 'Remove Long accessible course title',
    });
    await interact(() => user.click(remove));
    await waitFor(() => expect(removeRequests).toBe(1));
    expect(screen.getByRole('article').getAttribute('aria-busy')).toBe('true');
    const pendingRemoveAction = screen.getByRole('button', {
      name: 'Remove Long accessible course title',
    });
    expect((pendingRemoveAction as HTMLButtonElement).disabled).toBe(false);
    expect(pendingRemoveAction.getAttribute('aria-busy')).toBeNull();
    expect(pendingRemoveAction.querySelector('[data-part="spinner"]')).toBeNull();
    expect((screen.getByRole('button', { name: 'Clear cart' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await interact(() =>
      user.dblClick(screen.getByRole('button', { name: 'Remove Second course' })),
    );
    expect(removeRequests).toBe(1);
    expect(clearRequests).toBe(0);

    await act(async () => {
      resolveRemove?.();
    });
    expect(await screen.findByText('Course removed from cart.')).toBeTruthy();
    await waitFor(() => expect(cartReads).toBe(2));
    expect(screen.getAllByText('$10.00')).toHaveLength(2);
  });

  it('preserves stale content on a background failure and clears remove feedback only after a successful recovery', async () => {
    let reads = 0;
    let removeAttempts = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET') {
        reads += 1;
        if (reads === 2) throw new ApiError({ kind: 'server', status: 503, message: 'private' });
        return decode(options, cartWithItems);
      }
      if (options.path === '/cart/items/7') {
        removeAttempts += 1;
        throw new ApiError({ kind: 'not_found', status: 404, message: 'private' });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();
    const remove = await screen.findByRole('button', {
      name: 'Remove Long accessible course title',
    });
    await interact(() => user.click(remove));
    const refresh = await screen.findByRole('button', { name: 'Refresh cart' });
    expect(screen.getByText('Cart changed')).toBeTruthy();
    await interact(() => user.click(refresh));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByRole('heading', { name: 'Cart' })).toBeTruthy();
    await interact(() => user.click(screen.getAllByRole('button', { name: 'Refresh cart' })[0]));
    await waitFor(() => expect(reads).toBe(3));
    expect(removeAttempts).toBe(1);
    expect(screen.queryByText('Cart changed')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Cart' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Remove Long accessible course title' }),
    ).toBeTruthy();
  });

  it('requires confirmation before clearing and revalidates the empty cart result', async () => {
    let reads = 0;
    let clearRequests = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET') {
        reads += 1;
        return decode(
          options,
          reads === 1
            ? cartWithItems
            : { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 },
        );
      }
      if (options.path === '/cart' && options.method === 'DELETE') {
        clearRequests += 1;
        return decode(options, undefined);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();
    const clear = await screen.findByRole('button', { name: 'Clear cart' });
    await interact(() => user.click(clear));
    expect(clearRequests).toBe(0);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(document.activeElement);
    await interact(() => user.keyboard('{Escape}'));
    expect(clear).toBe(document.activeElement);
    await interact(() => user.click(clear));
    await interact(() =>
      user.click(
        within(screen.getByRole('dialog', { name: 'Clear cart?' })).getByRole('button', {
          name: 'Clear cart',
        }),
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Cart cleared.');
    expect(clearRequests).toBe(1);
    expect(reads).toBe(2);
  });

  it.each(['ru', 'uz'] as const)(
    'announces the localized polite clear-cart status in %s without changing the write or focus contract',
    async (locale) => {
      await act(() => localeRuntime.changeLanguage(locale));
      let reads = 0;
      let clearRequests = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET') {
          reads += 1;
          return decode(
            options,
            reads === 1
              ? cartWithItems
              : { id: 1, items: [], total_price: '0.00', currency: 'USD', item_count: 0 },
          );
        }
        if (options.path === '/cart' && options.method === 'DELETE') {
          clearRequests += 1;
          return decode(options, undefined);
        }
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };
      await renderCart(request);
      const user = userEvent.setup();
      const copy = CART_MAPPED_CONSUMER_COPY[locale];
      const clear = await screen.findByRole('button', { name: copy.clearAction });
      expect(clear.textContent).toContain(copy.clearVisible);

      await interact(() => user.click(clear));
      await interact(() =>
        user.click(
          within(screen.getByRole('dialog', { name: copy.clearDialog })).getByRole('button', {
            name: copy.clearAction,
          }),
        ),
      );

      const status = screen.getByRole('status');
      await waitFor(() => expect(status.textContent).toContain(copy.clearStatus));
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(status.textContent).not.toContain('Cart cleared.');
      expect(clearRequests).toBe(1);
      expect(reads).toBe(2);
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1 })).toBe(document.activeElement),
      );
    },
  );

  it.each(['ru', 'uz'] as const)(
    'announces the localized polite course-removal status in %s without changing the write contract',
    async (locale) => {
      await act(() => localeRuntime.changeLanguage(locale));
      let reads = 0;
      let removeRequests = 0;
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart' && options.method === 'GET') {
          reads += 1;
          return decode(
            options,
            reads === 1
              ? cartWithItems
              : {
                  ...cartWithItems,
                  items: [cartWithItems.items[1]],
                  total_price: '10.00',
                  item_count: 1,
                },
          );
        }
        if (options.path === '/cart/items/7' && options.method === 'DELETE') {
          removeRequests += 1;
          return decode(options, undefined);
        }
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };
      await renderCart(request);
      const user = userEvent.setup();
      const remove = await screen
        .findAllByRole('button', { name: /Long accessible course title/ })
        .then((buttons) => buttons.find((button) => button.dataset.cartRemoveCourseId === '7'));
      if (!remove) throw new Error('Expected the course-specific remove action.');

      await interact(() => user.click(remove));

      const status = screen.getByRole('status');
      const copy = CART_MAPPED_CONSUMER_COPY[locale];
      await waitFor(() => expect(status.textContent).toContain(copy.removeStatus));
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(status.textContent).not.toContain('Course removed from cart.');
      expect(removeRequests).toBe(1);
      expect(reads).toBe(2);
    },
  );

  it('uses a truthful pending label while the confirmed cart clear is in flight', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, cartWithItems);
      if (options.path === '/cart' && options.method === 'DELETE') return new Promise(() => {});
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();
    const clear = await screen.findByRole('button', { name: 'Clear cart' });

    await interact(() => user.click(clear));
    await interact(() =>
      user.click(
        within(screen.getByRole('dialog', { name: 'Clear cart?' })).getByRole('button', {
          name: 'Clear cart',
        }),
      ),
    );

    await waitFor(() => {
      const confirmation = screen.getByRole('button', { name: 'Clearing cart...' });
      expect((confirmation as HTMLButtonElement).disabled).toBe(true);
      expect(confirmation.getAttribute('aria-busy')).toBe('true');
      expect(
        within(screen.getByRole('dialog', { name: 'Clear cart?' })).getByRole('status').textContent,
      ).toContain('Clearing cart...');
    });
  });

  it('keeps retained cart content recoverable when post-remove revalidation fails', async () => {
    let reads = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET') {
        reads += 1;
        if (reads === 2) throw new ApiError({ kind: 'server', status: 503, message: 'private' });
        return decode(options, cartWithItems);
      }
      if (options.path === '/cart/items/7') return decode(options, undefined);
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();
    const remove = await screen.findByRole('button', {
      name: 'Remove Long accessible course title',
    });

    await interact(() => user.click(remove));
    expect(await screen.findByText('Cart update needs a refresh')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Remove Long accessible course title' }),
    ).toBeTruthy();
    expect(reads).toBe(2);
  });

  it('keeps focus on the next remove action after removing the first item', async () => {
    await removeCourseAndExpectFocus(7, 'Remove Middle course');
  });

  it('keeps focus on the next remove action after removing the middle item', async () => {
    await removeCourseAndExpectFocus(8, 'Remove Last course');
  });

  it('keeps focus on the previous remove action after removing the last item', async () => {
    await removeCourseAndExpectFocus(9, 'Remove Middle course');
  });

  it('moves focus to the empty-cart heading after removing the sole item', async () => {
    let currentItems = [cartWithItems.items[0]];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart' && options.method === 'GET')
        return decode(options, {
          ...cartWithItems,
          items: currentItems,
          item_count: currentItems.length,
          total_price: currentItems.length === 0 ? '0.00' : '19.990',
        });
      if (options.path === '/cart/items/7') {
        currentItems = [];
        return decode(options, undefined);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    await renderCart(request);
    const user = userEvent.setup();

    const remove = await screen.findByRole('button', {
      name: 'Remove Long accessible course title',
    });
    await interact(() => user.click(remove));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Your cart is empty' })).toBe(
        document.activeElement,
      ),
    );
  });
});
