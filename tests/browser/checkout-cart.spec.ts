import { expect, test, type Page, type Route } from '@playwright/test';

import { cartWorkflowOrigin } from './cart-workflow-server';
import {
  createHttpFailureAccounting,
  createRequestFailureAccounting,
  findUnexpectedConsoleErrors,
  matchesAcceptedRequestConsole,
  type ConsoleErrorEvidence,
} from './support/visual-quality';

type PaymentOutcome = 'success' | 'failed';
type EnrollmentStatus = 'active' | 'cancelled' | 'pending_payment';
type FixtureLocale = 'en' | 'ru' | 'uz';

interface FixtureCourse {
  readonly id: number;
  readonly price: string;
  readonly title: string;
}
interface FixtureEnrollment {
  readonly course: FixtureCourse;
  readonly id: number;
  status: EnrollmentStatus;
}
interface RequestRecord {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
}
interface LostCheckoutReceipt {
  readonly errorText: 'net::ERR_FAILED';
  readonly method: 'POST';
  readonly path: '/cart/checkout';
  readonly query: '';
  readonly url: string;
}
interface CartFixtureOptions {
  readonly cartCourseIds?: readonly number[];
  readonly checkoutMode?: 'lost' | 'normal';
  readonly completionMode?: 'lost' | 'malformed' | 'normal';
  readonly completionStatusByEnrollment?: Readonly<Record<number, EnrollmentStatus>>;
  readonly enrollmentReadDelayMs?: number;
  readonly enrollments?: readonly FixtureEnrollment[];
  readonly initialPending?: readonly number[];
  readonly uncertainCompletionEnrollmentId?: number;
  readonly unrelatedCourseIdAfterRestore?: number;
}

const student = {
  birthday: null,
  created_at: '2026-01-01T00:00:00Z',
  email: 'student@example.test',
  name: 'Sam',
  phone_number: null,
  role: 'student',
  surname: 'Student',
};
const courses: Readonly<Record<number, FixtureCourse>> = {
  7: { id: 7, price: '19.99', title: 'Advanced TypeScript Architecture' },
  8: { id: 8, price: '29.99', title: 'FastAPI and Async SQLAlchemy' },
  9: { id: 9, price: '39.99', title: 'Accessible Frontend Systems' },
};

function enrollment(id: number, courseId: number, status: EnrollmentStatus): FixtureEnrollment {
  return { course: courses[courseId]!, id, status };
}

function pageOf(items: readonly FixtureEnrollment[]) {
  return {
    has_next: false,
    has_previous: false,
    items: items.map((item) => ({
      course: { ...item.course, currency: 'USD', description: null },
      course_id: item.course.id,
      created_at: '2026-01-01T00:00:00Z',
      id: item.id,
      status: item.status,
      updated_at: '2026-01-01T00:00:00Z',
      user_id: 1,
    })),
    page: 1,
    page_size: 100,
    pages: 1,
    total: items.length,
  };
}

function cartOf(courseIds: readonly number[]) {
  return {
    currency: 'USD',
    id: 1,
    item_count: courseIds.length,
    items: courseIds.map((courseId, index) => ({
      added_at: '2026-01-01T00:00:00Z',
      course: { ...courses[courseId]!, currency: 'USD' },
      course_id: courseId,
      id: 100 + index,
    })),
    total_price: courseIds
      .reduce((sum, courseId) => sum + Number(courses[courseId]!.price), 0)
      .toFixed(2),
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status });
}
async function noContent(route: Route): Promise<void> {
  await route.fulfill({ status: 204 });
}

function isCartCompositeApiPath(path: string): boolean {
  return (
    path === '/me' ||
    path === '/courses' ||
    path === '/cart' ||
    path === '/cart/checkout' ||
    path === '/cart/items' ||
    path.startsWith('/cart/items/') ||
    path.startsWith('/enrollments/') ||
    path === '/payments/complete'
  );
}

class CartCompositeFixture {
  readonly records: RequestRecord[] = [];
  readonly lostCheckoutReceipts: LostCheckoutReceipt[] = [];
  cartCourseIds: number[];
  readonly checkoutMode: 'lost' | 'normal';
  readonly completionMode: 'lost' | 'malformed' | 'normal';
  readonly completionStatusByEnrollment: Readonly<Record<number, EnrollmentStatus>>;
  readonly enrollmentReadDelayMs: number;
  readonly enrollments: FixtureEnrollment[];
  readonly uncertainCompletionEnrollmentId: number | undefined;
  readonly unrelatedCourseIdAfterRestore: number | undefined;
  private lostCheckoutIntent = false;

  constructor(options: CartFixtureOptions = {}) {
    this.cartCourseIds = [...(options.cartCourseIds ?? [7])];
    this.checkoutMode = options.checkoutMode ?? 'normal';
    this.completionMode = options.completionMode ?? 'normal';
    this.completionStatusByEnrollment = options.completionStatusByEnrollment ?? {};
    this.enrollmentReadDelayMs = options.enrollmentReadDelayMs ?? 0;
    this.uncertainCompletionEnrollmentId = options.uncertainCompletionEnrollmentId;
    this.unrelatedCourseIdAfterRestore = options.unrelatedCourseIdAfterRestore;
    this.enrollments = [...(options.enrollments ?? [])];
    for (const courseId of options.initialPending ?? [])
      this.enrollments.push(enrollment(70 + courseId, courseId, 'pending_payment'));
  }

  count(path: string, method?: string): number {
    return this.records.filter(
      (record) => record.path === path && (method === undefined || record.method === method),
    ).length;
  }
  bodies(path: string): readonly unknown[] {
    return this.records.filter((record) => record.path === path).map((record) => record.body);
  }
  registerLostCheckoutIntent(): void {
    if (this.lostCheckoutIntent) throw new Error('Lost checkout intent was already registered.');
    this.lostCheckoutIntent = true;
  }

  private record(route: Route): RequestRecord {
    const request = route.request();
    const rawBody = request.postData();
    const record = {
      body: rawBody === null ? null : (JSON.parse(rawBody) as unknown),
      method: request.method(),
      path: new URL(request.url()).pathname,
    };
    this.records.push(record);
    return record;
  }
  private enrollmentById(id: number): FixtureEnrollment | undefined {
    return this.enrollments.find((item) => item.id === id);
  }

  async install(page: Page, locale: FixtureLocale = 'en'): Promise<void> {
    await page.addInitScript((initialLocale) => {
      localStorage.setItem('learnhub.access-token', 'student-token');
      localStorage.setItem('learnhub.locale', initialLocale);
    }, locale);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().resourceType() === 'document' ||
        url.origin !== cartWorkflowOrigin ||
        !isCartCompositeApiPath(url.pathname)
      )
        return route.fallback();
      const record = this.record(route);
      if (record.path === '/me') return json(route, student);
      if (record.path === '/courses' && record.method === 'GET')
        return json(route, {
          has_next: false,
          has_previous: false,
          items: Object.values(courses).map((course) => ({
            ...course,
            currency: 'USD',
            description: null,
            instructor: { id: 1, name: 'Ada', surname: 'Lovelace' },
            lessons: [{ id: 1, title: 'Intro' }],
            published_at: '2026-01-01T00:00:00Z',
          })),
          page: 1,
          page_size: 24,
          pages: 1,
          total: Object.keys(courses).length,
        });
      if (record.path === '/cart' && record.method === 'GET')
        return json(route, cartOf(this.cartCourseIds));
      if (record.path === '/cart/checkout' && record.method === 'POST') {
        for (const courseId of this.cartCourseIds) {
          const existingEnrollment = this.enrollments.find((item) => item.course.id === courseId);
          if (existingEnrollment !== undefined) existingEnrollment.status = 'pending_payment';
          else this.enrollments.push(enrollment(70 + courseId, courseId, 'pending_payment'));
        }
        this.cartCourseIds = [];
        if (this.checkoutMode === 'lost') {
          const request = route.request();
          const url = new URL(request.url());
          if (
            this.lostCheckoutIntent &&
            request.method() === 'POST' &&
            url.pathname === '/cart/checkout' &&
            url.search === ''
          )
            this.lostCheckoutReceipts.push({
              errorText: 'net::ERR_FAILED',
              method: 'POST',
              path: '/cart/checkout',
              query: '',
              url: request.url(),
            });
          return route.abort('failed');
        }
        return json(route, { enrolled_courses: 1, message: 'legacy acknowledgement' });
      }
      if (record.path === '/enrollments/my' && record.method === 'GET') {
        if (this.enrollmentReadDelayMs > 0)
          await new Promise((resolve) => setTimeout(resolve, this.enrollmentReadDelayMs));
        return json(route, pageOf(this.enrollments));
      }
      const enrollmentMatch = /^\/enrollments\/(\d+)$/.exec(record.path);
      if (enrollmentMatch && record.method === 'GET') {
        const item = this.enrollmentById(Number(enrollmentMatch[1]));
        return item
          ? json(route, pageOf([item]).items[0])
          : json(route, { detail: 'not found' }, 404);
      }
      if (record.path === '/payments/complete' && record.method === 'POST') {
        const payload = record.body as { enrollment_id?: number; status?: PaymentOutcome };
        const item = this.enrollmentById(payload.enrollment_id ?? -1);
        if (!item || (payload.status !== 'success' && payload.status !== 'failed'))
          return json(route, { detail: 'bad request' }, 400);
        if (item.id === this.uncertainCompletionEnrollmentId) {
          item.status = 'pending_payment';
          return json(route, { message: 'uncertain completion' });
        }
        item.status =
          this.completionStatusByEnrollment[item.id] ??
          (payload.status === 'success' ? 'active' : 'cancelled');
        if (this.completionMode === 'lost') return route.abort('failed');
        if (this.completionMode === 'malformed') return json(route, { message: 'broken' });
        return json(route, { enrollment_id: item.id, message: 'completed', status: item.status });
      }
      const removeMatch = /^\/cart\/items\/(\d+)$/.exec(record.path);
      if (removeMatch && record.method === 'DELETE') {
        this.cartCourseIds = this.cartCourseIds.filter((id) => id !== Number(removeMatch[1]));
        return noContent(route);
      }
      if (record.path === '/cart/items' && record.method === 'POST') {
        const payload = record.body as { course_id?: number };
        if (typeof payload.course_id !== 'number')
          return json(route, { detail: 'bad request' }, 400);
        if (!this.cartCourseIds.includes(payload.course_id))
          this.cartCourseIds.push(payload.course_id);
        if (
          payload.course_id === 7 &&
          this.unrelatedCourseIdAfterRestore !== undefined &&
          !this.cartCourseIds.includes(this.unrelatedCourseIdAfterRestore)
        )
          this.cartCourseIds.push(this.unrelatedCourseIdAfterRestore);
        const courseId = payload.course_id;
        return json(route, {
          added_at: '2026-01-01T00:00:00Z',
          course: { ...courses[courseId]!, currency: 'USD' },
          course_id: courseId,
          id: 100 + this.cartCourseIds.indexOf(courseId),
        });
      }
      throw new Error(`Unexpected API request ${record.method} ${record.path}`);
    });
  }
}

function overflow(page: Page) {
  return page.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
}
async function openCart(
  page: Page,
  fixture: CartCompositeFixture,
  locale: FixtureLocale = 'en',
): Promise<void> {
  await fixture.install(page, locale);
  await page.goto('/cart');
}

test('keeps a refreshed empty Cart quiet while recovery discovery is pending', async ({ page }) => {
  const fixture = new CartCompositeFixture({
    cartCourseIds: [],
    enrollmentReadDelayMs: 1_000,
    enrollments: [enrollment(77, 7, 'active')],
  });

  await openCart(page, fixture);
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  await expect.poll(() => fixture.count('/enrollments/my', 'GET')).toBe(1);
  await expect(page.getByText('Payment pending', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Checking out…', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(1_050);
  await expect(page.getByText('Payment pending', { exact: true })).toHaveCount(0);
  expect(fixture.count('/cart/checkout', 'POST')).toBe(0);
  expect(fixture.count('/payments/complete', 'POST')).toBe(0);
});

test('proves the whole Cart payment once and focuses the terminal result without legacy acknowledgement', async ({
  page,
}) => {
  const fixture = new CartCompositeFixture({ cartCourseIds: [7, 8] });
  const diagnostics: string[] = [];
  page.on('pageerror', (error) => diagnostics.push(error.message));
  await openCart(page, fixture);
  await page.clock.install();
  await page.clock.pauseAt(new Date('2030-01-01T00:00:00Z'));
  const action = page.getByRole('button', { name: 'Complete mock payment', exact: true });
  const disclosureText = page.getByText('Insecure checkout', { exact: true });
  await expect(disclosureText).toHaveJSProperty('tagName', 'SPAN');
  const disclosure = disclosureText.locator('..');
  await expect(disclosure).toHaveJSProperty('tagName', 'P');
  await expect(disclosure.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  expect(await disclosure.locator(':scope > *').evaluateAll((children) => children.length)).toBe(2);
  await action.dblclick();
  await expect(page.getByText('Payment completed', { exact: true })).toHaveCount(2);
  expect(fixture.count('/cart/checkout', 'POST')).toBe(1);
  expect(fixture.count('/payments/complete', 'POST')).toBe(2);
  expect(fixture.count('/enrollments/my', 'GET')).toBe(1);
  expect(fixture.count('/cart', 'GET')).toBeGreaterThanOrEqual(3);
  await expect(page.getByText('Checkout accepted', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Check My Learning', exact: true })).toHaveCount(0);
  await expect(
    page
      .getByText('Payment completed', { exact: true })
      .first()
      .locator('xpath=ancestor::div[@tabindex="-1"][1]'),
  ).toBeFocused();
  await page.clock.fastForward(7_999);
  await expect(page.getByText('Payment completed', { exact: true })).toHaveCount(2);
  await page.clock.fastForward(1);
  await expect(page.getByText('Payment completed', { exact: true })).toHaveCount(0);
  expect(diagnostics).toEqual([]);
});

test('clears successful payment confirmation when Cart unmounts', async ({ page }) => {
  const fixture = new CartCompositeFixture({ cartCourseIds: [7] });
  await openCart(page, fixture);
  await page.getByRole('button', { name: 'Complete mock payment', exact: true }).click();
  await expect(page.getByText('Payment completed', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'My learning', exact: true }).click();
  await expect(page).toHaveURL('/learning');
  await page.getByRole('link', { name: /^Cart/ }).click();
  await expect(page).toHaveURL('/cart');

  await expect(page.getByText('Payment completed', { exact: true })).toHaveCount(0);
  expect(fixture.count('/payments/complete', 'POST')).toBe(1);
});

test('dismisses a deleted failed course and retries the remaining restored course', async ({
  page,
}) => {
  const fixture = new CartCompositeFixture({
    cartCourseIds: [7, 8],
    unrelatedCourseIdAfterRestore: 9,
  });
  await openCart(page, fixture);
  await page.clock.install();
  await page.clock.pauseAt(new Date('2030-01-01T00:00:00Z'));
  await page.getByRole('button', { name: 'Simulate payment failure', exact: true }).click();
  await expect(page).toHaveURL('/cart');
  await expect(page.getByText('Payment pending', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Cart courses' }).getByRole('listitem')).toHaveCount(
    2,
  );
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Remove Advanced TypeScript Architecture' }),
  ).toBeDisabled();
  expect(fixture.count('/payments/complete', 'POST')).toBe(0);
  await page.clock.fastForward(6_999);
  await expect(page).toHaveURL('/cart');
  await expect(page.getByText('Payment pending', { exact: true })).toBeVisible();
  expect(fixture.count('/payments/complete', 'POST')).toBe(0);
  await page.clock.fastForward(1);
  await expect(page.getByRole('list', { name: 'Cart courses' }).getByRole('listitem')).toHaveCount(
    3,
  );
  await expect(page.getByText('Payment failed', { exact: true })).toHaveCount(2);
  for (const courseTitle of ['Advanced TypeScript Architecture', 'FastAPI and Async SQLAlchemy']) {
    const courseCard = page
      .getByRole('link', { name: courseTitle, exact: true })
      .locator('xpath=ancestor::*[@role="listitem"][1]');
    const recovery = courseCard.getByRole('alert');
    await expect(recovery).toContainText('Payment failed');
    await expect(recovery).toContainText('The course was returned to your cart.');
    await expect(recovery).toHaveCSS('background-color', 'rgb(254, 242, 242)');
    await expect(recovery).toHaveCSS('border-left-width', '4px');
    await expect(recovery).toHaveCSS('border-left-color', 'rgb(185, 28, 28)');
  }
  expect(fixture.cartCourseIds).toEqual([7, 9, 8]);
  expect(fixture.count('/payments/complete', 'POST')).toBe(2);
  const summary = page.getByRole('complementary', { name: 'Cart total' });
  await expect(
    summary.getByText('Payment retry required · 2 courses', { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByRole('button', { name: 'Complete mock payment', exact: true }),
  ).toHaveCount(0);
  await expect(
    summary.getByRole('button', { name: 'Simulate payment failure', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overflow(page)).toMatchObject({ client: 390, document: 390 });
  await expect(
    page
      .getByRole('link', { name: 'Advanced TypeScript Architecture', exact: true })
      .locator('xpath=ancestor::*[@role="listitem"][1]')
      .getByRole('alert'),
  ).toHaveCSS('flex-direction', 'column');
  const firstRecovery = page
    .getByRole('link', { name: 'Advanced TypeScript Architecture', exact: true })
    .locator('xpath=ancestor::*[@role="listitem"][1]')
    .getByRole('alert');
  await expect(firstRecovery.getByText('Payment failed', { exact: true })).toBeVisible();
  await expect(
    firstRecovery.getByText('The course was returned to your cart.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Remove Advanced TypeScript Architecture', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Advanced TypeScript Architecture', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Payment failed', { exact: true })).toHaveCount(1);
  await expect(
    summary.getByText('Payment retry required · 1 course', { exact: true }),
  ).toBeVisible();

  const retry = page.getByRole('button', {
    name: 'Retry mock payment: FastAPI and Async SQLAlchemy',
  });
  await expect(retry).toHaveText('Retry payment');
  await expect(retry).toBeEnabled();
  await expect(retry).toHaveCSS('background-color', 'rgb(91, 63, 214)');
  await retry.click();
  await expect(page.getByText('Payment completed', { exact: true })).toBeVisible();
  await expect(summary.getByText('Payment retry required', { exact: false })).toHaveCount(0);
  await expect(
    summary.getByRole('button', { name: 'Complete mock payment', exact: true }),
  ).toBeVisible();
  expect(fixture.count('/cart/checkout', 'POST')).toBe(2);
  expect(fixture.count('/cart/items/7', 'DELETE')).toBe(1);
  expect(fixture.count('/cart/items/9', 'DELETE')).toBe(1);
  expect(fixture.count('/cart/items', 'POST')).toBeGreaterThanOrEqual(2);
  const paymentBodies = fixture.bodies('/payments/complete') as readonly {
    enrollment_id: number;
  }[];
  expect(paymentBodies.map((body) => body.enrollment_id)).toEqual([77, 78, 78]);
});

test('admits loss only from full truth, locks ambiguity, and preserves a proven prefix', async ({
  page,
}) => {
  const fixture = new CartCompositeFixture({ checkoutMode: 'lost' });
  const httpFailures = createHttpFailureAccounting();
  const requestFailures = createRequestFailureAccounting();
  const consoleErrors: ConsoleErrorEvidence[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('requestfailed', (request) =>
    requestFailures.observe(request.method(), request.url(), request.failure()?.errorText ?? ''),
  );
  page.on('response', (response) =>
    httpFailures.observe(response.request().method(), response.url(), response.status()),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  await openCart(page, fixture);
  fixture.registerLostCheckoutIntent();
  requestFailures.allow(
    { errorText: 'net::ERR_FAILED', method: 'POST', path: '/cart/checkout' },
    1,
  );
  await page.getByRole('button', { name: 'Complete mock payment', exact: true }).click();
  await expect(page.getByText('Payment completed', { exact: true })).toBeVisible();
  await expect.poll(() => requestFailures.acceptedFailures().length).toBe(1);
  await expect.poll(() => consoleErrors.length).toBe(1);
  const [receipt] = fixture.lostCheckoutReceipts;
  const [acceptedFailure] = requestFailures.acceptedFailures();
  expect(fixture.lostCheckoutReceipts).toHaveLength(1);
  expect(receipt).toEqual({
    errorText: 'net::ERR_FAILED',
    method: 'POST',
    path: '/cart/checkout',
    query: '',
    url: acceptedFailure!.url,
  });
  expect(matchesAcceptedRequestConsole(consoleErrors[0]!, acceptedFailure!)).toBe(true);
  expect(fixture.count('/cart/checkout', 'POST')).toBe(1);
  expect(fixture.count('/payments/complete', 'POST')).toBe(1);

  const rejectedPage = await page.context().newPage();
  const rejectedFixture = new CartCompositeFixture({ checkoutMode: 'lost' });
  const rejectedFailures = createRequestFailureAccounting();
  const rejectedConsoleErrors: ConsoleErrorEvidence[] = [];
  rejectedPage.on('requestfailed', (request) =>
    rejectedFailures.observe(request.method(), request.url(), request.failure()?.errorText ?? ''),
  );
  rejectedPage.on('console', (message) => {
    if (message.type() === 'error')
      rejectedConsoleErrors.push({ text: message.text(), url: message.location().url });
  });
  try {
    await openCart(rejectedPage, rejectedFixture);
    await rejectedPage.getByRole('button', { name: 'Complete mock payment', exact: true }).click();
    await expect.poll(() => rejectedFailures.violations().requestFailures.length).toBe(1);
    await expect.poll(() => rejectedConsoleErrors.length).toBe(1);
    expect(rejectedFixture.lostCheckoutReceipts).toEqual([]);
    expect(rejectedFailures.violations().unconsumedExpectedRequestFailures).toEqual([]);
    expect(
      findUnexpectedConsoleErrors(rejectedConsoleErrors, [], rejectedFailures.acceptedFailures()),
    ).toHaveLength(1);
  } finally {
    await rejectedPage.close();
  }

  await page.unroute('**/*');
  const ambiguous = new CartCompositeFixture({
    cartCourseIds: [7],
    enrollments: [enrollment(77, 7, 'pending_payment'), enrollment(78, 7, 'pending_payment')],
  });
  await openCart(page, ambiguous);
  const action = page.getByRole('button', { name: 'Complete mock payment', exact: true });
  await action.click();
  await expect(page.getByText('Payment result needs checking', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Complete mock payment', exact: true }),
  ).toHaveCount(0);
  expect(ambiguous.count('/payments/complete', 'POST')).toBe(0);

  await page.unroute('**/*');
  const provenPrefix = new CartCompositeFixture({
    cartCourseIds: [7, 8],
    completionStatusByEnrollment: { 77: 'cancelled' },
    uncertainCompletionEnrollmentId: 78,
  });
  await openCart(page, provenPrefix);
  const prefixAction = page.getByRole('button', {
    name: 'Complete mock payment',
    exact: true,
  });
  await prefixAction.dblclick();
  const warning = page.getByText('Payment result needs checking', { exact: true });
  await expect(warning).toBeVisible();
  await expect(page.getByText('Payment failed', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('link', { name: 'Advanced TypeScript Architecture', exact: true })
      .locator('xpath=ancestor::*[@role="listitem"][1]')
      .getByRole('alert'),
  ).toContainText('The course was returned to your cart.');
  await expect(page.getByText('FastAPI and Async SQLAlchemy', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Retry mock payment: Advanced TypeScript Architecture',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(warning.locator('xpath=ancestor::div[@tabindex="-1"][1]')).toBeFocused();
  expect(provenPrefix.count('/payments/complete', 'POST')).toBe(2);
  expect(provenPrefix.count('/cart/items', 'POST')).toBe(1);
  const terminalRequestCount = provenPrefix.records.length;
  await page.keyboard.press('Enter');
  expect(provenPrefix.records).toHaveLength(terminalRequestCount);
  expect(pageErrors).toEqual([]);
  expect(httpFailures.violations()).toEqual({
    errorResponses: [],
    unconsumedExpectedResponses: [],
  });
  expect(requestFailures.violations()).toEqual({
    requestFailures: [],
    unconsumedExpectedRequestFailures: [],
  });
  expect(consoleErrors).toHaveLength(1);
  expect(
    findUnexpectedConsoleErrors(
      consoleErrors,
      httpFailures.acceptedFailures(),
      requestFailures.acceptedFailures(),
    ),
  ).toEqual([]);
});

test('reconciles a malformed completion exactly once without repeating payment', async ({
  page,
}) => {
  const fixture = new CartCompositeFixture({ completionMode: 'malformed' });
  await openCart(page, fixture);
  await page.getByRole('button', { name: 'Complete mock payment', exact: true }).click();
  await expect(page.getByText('Payment completed', { exact: true })).toBeVisible();
  expect(fixture.count('/payments/complete', 'POST')).toBe(1);
  expect(fixture.count('/enrollments/77', 'GET')).toBe(1);
});

test('discovers all empty-Cart pending candidates and resumes exact identities without checkout', async ({
  page,
}) => {
  const fixture = new CartCompositeFixture({ cartCourseIds: [], initialPending: [7, 8] });
  await openCart(page, fixture);
  const catalogLink = page.getByRole('link', { name: 'Browse courses', exact: true });
  await catalogLink.hover();
  await expect(catalogLink).toHaveCSS('color', 'rgb(73, 50, 182)');
  await expect(catalogLink).toHaveCSS('text-decoration-line', 'underline');
  await expect(page.getByText('Advanced TypeScript Architecture', { exact: true })).toBeVisible();
  await expect(page.getByText('FastAPI and Async SQLAlchemy', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check pending payment', exact: true }).click();
  await expect(page.getByText('Payment completed', { exact: true })).toHaveCount(2);
  expect(fixture.count('/cart/checkout', 'POST')).toBe(0);
  expect(fixture.count('/payments/complete', 'POST')).toBe(2);

  const box = await catalogLink.boundingBox();
  if (box === null) throw new Error('Expected the empty-Cart catalog link to have a bounding box.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(catalogLink).toHaveCSS('color', 'rgb(73, 50, 182)');
  await expect(catalogLink).toHaveCSS('text-decoration-line', 'underline');
  await page.mouse.up();
});

const localizedFailureControls: Readonly<Record<FixtureLocale, string>> = {
  en: 'Simulate payment failure',
  ru: 'Сымитировать ошибку платежа',
  uz: 'To‘lov xatosini taqlid qilish',
};

for (const locale of ['en', 'ru', 'uz'] as const) {
  test(`renders CCMP terminal content and controls without overflow in ${locale}`, async ({
    page,
  }) => {
    const fixture = new CartCompositeFixture();
    await openCart(page, fixture, locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    const failure = page.getByRole('button', {
      name: localizedFailureControls[locale],
      exact: true,
    });
    await expect(failure).toBeVisible();
    await expect(failure).toHaveCSS('min-height', '44px');
    await failure.focus();
    await expect(failure).toBeFocused();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ height: 900, width });
      const geometry = await overflow(page);
      expect(geometry.document).toBeLessThanOrEqual(geometry.client);
      expect(geometry.body).toBeLessThanOrEqual(geometry.client);
    }
  });
}
