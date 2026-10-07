import { expect, test, type Page, type Request } from '@playwright/test';

import {
  cartAdmissionItem as cartItem,
  createCartD03Controller,
  fulfillCartJson as json,
  installCartAdmissionRoutes,
  installCartStudent as installStudent,
  isCartApiPath,
  type CartApiRequest,
} from './fixtures/cart-workflow-fixture';
const exactLongTotal = '1000000000000000000000019.0001';
const exactLongTotalEnglish = '$1,000,000,000,000,000,000,000,019.0001';

const cartResidualCopy = {
  en: {
    breadcrumb: 'Breadcrumb',
    cart: 'Cart',
    clearAction: 'Clear cart',
    clearVisible: 'Clear',
    cartCourses: 'Cart courses',
    cartTotal: 'Cart total',
    courseCount: '1 course',
    courseLabel: 'Course',
    mockCheckout: 'Complete mock payment',
    orderSummary: 'Order summary',
    price: 'Price',
    coursePrice: '$19.990',
    total: 'Total',
  },
  ru: {
    breadcrumb: 'Хлебные крошки',
    cart: 'Корзина',
    clearAction: 'Очистить корзину',
    clearVisible: 'Очистить',
    cartCourses: 'Курсы в корзине',
    cartTotal: 'Итог корзины',
    courseCount: '1 курс',
    courseLabel: 'Курс',
    mockCheckout: 'Завершить тестовый платёж',
    orderSummary: 'Итоги заказа',
    price: 'Цена',
    coursePrice: '19,990\u00a0$',
    total: 'Итого',
  },
  uz: {
    breadcrumb: 'Yo‘l ko‘rsatkich',
    cart: 'Savat',
    clearAction: 'Savatni tozalash',
    clearVisible: 'Tozalash',
    cartCourses: 'Savatdagi kurslar',
    cartTotal: 'Savat jami',
    courseCount: '1 ta kurs',
    courseLabel: 'Kurs',
    mockCheckout: 'Sinov to‘lovini yakunlash',
    orderSummary: 'Buyurtma yakuni',
    price: 'Narx',
    coursePrice: '$\u00a019.990',
    total: 'Jami',
  },
} as const;

const cartMappedConsumerCopy = {
  ru: {
    clearAction: 'Очистить корзину',
    clearVisible: 'Очистить',
    clearDialog: 'Очистить корзину?',
    clearStatus: 'Корзина очищена.',
    empty: 'Ваша корзина пуста',
    learningReturn: 'Моё обучение',
    removeStatus: 'Курс удалён из корзины.',
  },
  uz: {
    clearAction: 'Savatni tozalash',
    clearVisible: 'Tozalash',
    clearDialog: 'Savat tozalansinmi?',
    clearStatus: 'Savat tozalandi.',
    empty: 'Savatingiz bo‘sh',
    learningReturn: 'Ta’limim',
    removeStatus: 'Kurs savatdan olib tashlandi.',
  },
} as const;

interface CartRequestLifecycle {
  readonly requests: CartRequestRecord[];
  readonly diagnostics: string[];
  initialReadBoundary?: number;
}

interface CartRequestRecord {
  label: string;
  readonly authorization: string | undefined;
  responseStatus?: number;
  responseFailure?: Error | null;
  finished: boolean;
  failure?: string;
}

interface CartLifecycleExpectation {
  readonly selectedMutations: readonly string[];
}

function cartApiRequest(request: Request): CartApiRequest | null {
  const url = new URL(request.url());
  if (request.resourceType() === 'document' || !isCartApiPath(url.pathname)) return null;
  return { method: request.method(), pathname: url.pathname };
}

function cartRequestLabel(request: CartApiRequest): string {
  return `${request.method} ${request.pathname}`;
}

function trackCartRequestLifecycle(page: Page): CartRequestLifecycle {
  const lifecycle: CartRequestLifecycle = {
    requests: [],
    diagnostics: [],
  };
  const records = new Map<Request, CartRequestRecord>();
  page.on('request', (request) => {
    const cartRequest = cartApiRequest(request);
    if (!cartRequest) return;
    const record: CartRequestRecord = {
      label: cartRequestLabel(cartRequest),
      authorization: request.headers().authorization,
      finished: false,
    };
    records.set(request, record);
    lifecycle.requests.push(record);
  });
  page.on('response', (response) => {
    const cartRequest = cartApiRequest(response.request());
    if (!cartRequest) return;
    const record = records.get(response.request());
    if (!record) return;
    record.responseStatus = response.status();
    void response
      .finished()
      .then((failure) => {
        record.responseFailure = failure;
      })
      .catch((error: unknown) => {
        record.responseFailure = error instanceof Error ? error : new Error(String(error));
      });
  });
  page.on('requestfinished', (request) => {
    const cartRequest = cartApiRequest(request);
    if (!cartRequest) return;
    const record = records.get(request);
    if (record) record.finished = true;
  });
  page.on('requestfailed', (request) => {
    const cartRequest = cartApiRequest(request);
    if (!cartRequest) return;
    const record = records.get(request);
    if (record) record.failure = request.failure()?.errorText ?? 'unknown failure';
  });
  page.on('pageerror', (error) => lifecycle.diagnostics.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') lifecycle.diagnostics.push(message.text());
  });
  return lifecycle;
}

function markPopulatedCartRead(lifecycle: CartRequestLifecycle) {
  lifecycle.initialReadBoundary = lifecycle.requests.length;
}

async function expectSuccessfulCartLifecycle(
  lifecycle: CartRequestLifecycle,
  expectation: CartLifecycleExpectation,
) {
  const initialReadBoundary = lifecycle.initialReadBoundary;
  if (initialReadBoundary === undefined) throw new Error('Populated Cart read was not marked.');
  await expect
    .poll(() =>
      lifecycle.requests.every((request) => request.finished || request.failure !== undefined),
    )
    .toBe(true);
  await expect
    .poll(() =>
      lifecycle.requests.every(
        (request) => request.responseFailure !== undefined || request.failure !== undefined,
      ),
    )
    .toBe(true);

  const initialReads = lifecycle.requests
    .slice(0, initialReadBoundary)
    .filter(
      (request) =>
        request.label === 'GET /cart' &&
        request.authorization === 'Bearer student-token' &&
        request.responseStatus === 200 &&
        request.responseFailure === null &&
        request.finished,
    );
  expect(initialReads.length).toBeGreaterThanOrEqual(1);
  expect(lifecycle.requests.map((request) => request.label)).toEqual(
    expect.arrayContaining(['GET /cart', ...expectation.selectedMutations]),
  );
  expect(
    lifecycle.requests.every((request) => request.authorization === 'Bearer student-token'),
  ).toBe(true);
  expect(lifecycle.requests.every((request) => request.failure === undefined)).toBe(true);
  expect(lifecycle.requests.every((request) => request.responseFailure === null)).toBe(true);
  expect(lifecycle.requests.every((request) => request.finished)).toBe(true);
  expect(
    lifecycle.requests.every((request) =>
      request.label === 'GET /cart'
        ? request.responseStatus === 200
        : expectation.selectedMutations.includes(request.label) && request.responseStatus === 204,
    ),
  ).toBe(true);

  const mutations = lifecycle.requests.filter((request) => request.label !== 'GET /cart');
  expect(mutations.map((request) => request.label)).toEqual(expectation.selectedMutations);
  const lastMutation = Math.max(...mutations.map((request) => lifecycle.requests.indexOf(request)));
  expect(
    lifecycle.requests
      .slice(lastMutation + 1)
      .some(
        (request) =>
          request.label === 'GET /cart' &&
          request.authorization === 'Bearer student-token' &&
          request.responseStatus === 200 &&
          request.responseFailure === null &&
          request.finished,
      ),
  ).toBe(true);
  expect(lifecycle.diagnostics).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.client);
  expect(widths.body).toBeLessThanOrEqual(widths.client);
}

async function expectSummaryJumpClearsGlobalAssistant(page: Page): Promise<void> {
  const summaryJump = page.getByRole('button', { name: 'Go to order summary', exact: true });
  const assistant = page.getByRole('button', { name: 'Open AI assistant', exact: true });
  await expect(summaryJump).toHaveCount(1);
  await expect(assistant).toHaveCount(1);
  await expect(summaryJump).toHaveCSS('min-height', '44px');
  await expect(assistant).toHaveCSS('width', '60px');

  const [summaryBox, assistantBox] = await Promise.all([
    summaryJump.boundingBox(),
    assistant.boundingBox(),
  ]);
  if (!summaryBox || !assistantBox)
    throw new Error('Summary-jump or global assistant geometry is unavailable.');
  expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(assistantBox.x - 16);
}

function cart(items = [cartItem]) {
  return {
    id: 1,
    items,
    total_price: items.length === 0 ? '0.00' : exactLongTotal,
    currency: 'USD',
    item_count: items.length,
  };
}

function longCart() {
  return cart(
    Array.from({ length: 24 }, (_, index) => ({
      ...cartItem,
      id: index + 10,
      course_id: index + 7,
      course: {
        ...cartItem.course,
        id: index + 7,
        title: `Long Cart course ${index + 1}: ${cartItem.course.title}`,
      },
    })),
  );
}

test.describe('FE-009 cart workflow QA harness', () => {
  test('keeps the compact Cart summary jump clear of the global assistant', async ({ page }) => {
    await installStudent(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await installCartAdmissionRoutes(page, async (route, request) => {
      if (request.method === 'GET' && request.pathname === '/cart') return json(route, longCart());
      throw new Error(`Unexpected cart request ${request.method} ${request.pathname}`);
    });

    for (const width of [768, 820, 1023]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/cart');
      await expectSummaryJumpClearsGlobalAssistant(page);
      await expectNoHorizontalOverflow(page);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('offers one mobile summary jump above Student navigation without duplicating checkout', async ({
    page,
  }) => {
    await installStudent(page);
    const consoleErrors: string[] = [];
    let checkoutPosts = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await installCartAdmissionRoutes(page, async (route, request) => {
      if (request.method === 'GET' && request.pathname === '/cart') return json(route, longCart());
      if (request.method === 'POST' && request.pathname === '/cart/checkout') {
        checkoutPosts += 1;
        return json(route, { message: 'unexpected', enrolled_courses: 0 });
      }
      throw new Error(`Unexpected cart request ${request.method} ${request.pathname}`);
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto('/cart');
    const jump = page.getByRole('button', { name: 'Go to order summary', exact: true });
    const summaryHeading = page.getByRole('heading', { name: 'Order summary', exact: true });
    const navigation = page.getByRole('navigation', { name: 'Student navigation' });
    await expect(jump).toHaveCount(1);
    await expect(summaryHeading).toHaveCount(1);
    await expect(jump).toHaveCSS('min-height', '44px');
    const [jumpBox, navigationBox] = await Promise.all([
      jump.boundingBox(),
      navigation.boundingBox(),
    ]);
    if (!jumpBox || !navigationBox)
      throw new Error('Summary-jump or Student-navigation geometry is unavailable.');
    expect(jumpBox.y + jumpBox.height).toBeLessThanOrEqual(navigationBox.y);
    const sourceOrder = await page.evaluate(() => {
      const cartCourses = document.querySelector<HTMLElement>('[aria-label="Cart courses"]');
      const jumpControl = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Go to order summary',
      );
      const summaryHeading = Array.from(document.querySelectorAll('h2')).find(
        (heading) => heading.textContent === 'Order summary',
      );
      if (!cartCourses || !jumpControl || !summaryHeading)
        throw new Error('Cart source-order targets are unavailable.');
      return {
        cartCoursesBeforeJump: Boolean(
          cartCourses.compareDocumentPosition(jumpControl) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        jumpBeforeSummary: Boolean(
          jumpControl.compareDocumentPosition(summaryHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      };
    });
    expect(sourceOrder).toEqual({ cartCoursesBeforeJump: true, jumpBeforeSummary: true });
    const compactLayout = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('[aria-label="Cart courses"]')
        ?.parentElement?.parentElement;
      const courseList = document.querySelector<HTMLElement>(
        '[aria-label="Cart courses"]',
      )?.parentElement;
      const jumpContainer = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Go to order summary',
      )?.parentElement;
      const remove = document.querySelector<HTMLButtonElement>('[data-cart-remove-course-id]');
      const item = remove?.closest<HTMLElement>('[role="listitem"]');
      const price = Array.from(item?.querySelectorAll('p') ?? []).find(
        (paragraph) => paragraph.textContent === 'Price',
      );
      if (!content || !courseList || !jumpContainer || !remove || !price)
        throw new Error('Compact Cart layout targets are unavailable.');
      const contentBox = content.getBoundingClientRect();
      const listBox = courseList.getBoundingClientRect();
      const removeBox = remove.getBoundingClientRect();
      const priceBox = price.parentElement?.getBoundingClientRect();
      if (!priceBox) throw new Error('Compact Cart price geometry is unavailable.');
      return {
        listTop: listBox.top,
        contentTop: contentBox.top,
        listLeft: listBox.left,
        contentLeft: contentBox.left,
        listWidth: listBox.width,
        contentWidth: contentBox.width,
        priceBeforeRemove: Boolean(
          price.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        sameFooter:
          price.parentElement?.parentElement === remove.parentElement?.parentElement?.parentElement,
        priceLeft: priceBox.left,
        removeLeft: removeBox.left,
        removeHeight: removeBox.height,
        removeWidth: removeBox.width,
      };
    });
    expect(compactLayout.listTop).toBeCloseTo(compactLayout.contentTop, 0);
    expect(compactLayout.listLeft).toBeCloseTo(compactLayout.contentLeft, 0);
    expect(compactLayout.listWidth).toBeCloseTo(compactLayout.contentWidth, 0);
    expect(compactLayout).toMatchObject({
      priceBeforeRemove: true,
      sameFooter: true,
      removeHeight: 44,
      removeWidth: 44,
    });
    expect(compactLayout.priceLeft).toBeLessThan(compactLayout.removeLeft);
    await jump.press('Enter');
    await expect(summaryHeading).toBeFocused();
    await expect(jump).toHaveCount(0);
    expect(checkoutPosts).toBe(0);

    for (const width of [320, 390, 617, 767, 768, 1023, 1024, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      const geometry = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.clientWidth);
      expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.clientWidth);
      if (width >= 1024)
        await expect(
          page.getByRole('button', { name: 'Go to order summary', exact: true }),
        ).toHaveCount(0);
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = '200%';
    });
    const zoomed = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(zoomed.documentWidth).toBeLessThanOrEqual(zoomed.clientWidth);
    expect(zoomed.bodyWidth).toBeLessThanOrEqual(zoomed.clientWidth);
    expect(consoleErrors).toEqual([]);
  });

  for (const [locale, localeOption] of [
    ['en', null],
    ['ru', 'Русский'],
    ['uz', "O'zbek"],
  ] as const) {
    test(`contains the long Cart surface at effective 200% in ${locale}`, async ({ page }) => {
      await installStudent(page);
      const consoleErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      await installCartAdmissionRoutes(page, async (route, request) => {
        if (request.method === 'GET' && request.pathname === '/cart')
          return json(route, longCart());
        throw new Error(`Unexpected cart request ${request.method} ${request.pathname}`);
      });

      await page.setViewportSize({ width: 1280, height: 700 });
      await page.goto('/cart');
      if (localeOption) {
        await page.getByRole('button', { name: 'Change language' }).click();
        await page.getByRole('button', { name: localeOption, exact: true }).click();
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = '200%';
      });

      await expectNoHorizontalOverflow(page);
      expect(consoleErrors).toEqual([]);
    });
  }

  test('uses authenticated fixtures for exact cart mutation, cache count, focus/status, reduced motion, and five-width diagnostics', async ({
    page,
  }, testInfo) => {
    await installStudent(page);
    const lifecycle = trackCartRequestLifecycle(page);
    let currentCart = cart();
    expect(currentCart).toMatchObject({ total_price: exactLongTotal, currency: 'USD' });
    await installCartAdmissionRoutes(page, async (route, request) => {
      const requestLabel = cartRequestLabel(request);
      if (requestLabel === 'GET /cart') return json(route, currentCart);
      if (requestLabel === 'DELETE /cart/items/7') {
        currentCart = cart([]);
        return route.fulfill({ status: 204 });
      }
      throw new Error(`Unexpected cart request ${requestLabel}`);
    });

    const initialCartResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/cart' &&
        response.status() === 200 &&
        response.request().resourceType() !== 'document',
    );
    await page.goto('/cart');
    const initialFailure = await (await initialCartResponse).finished();
    if (initialFailure !== null)
      throw new Error(`Initial Cart response did not finish: ${initialFailure}`);
    await expect(page.getByRole('heading', { name: 'Cart', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
    await expect(page.getByLabel('Cart total').locator('strong')).toHaveText(exactLongTotalEnglish);
    markPopulatedCartRead(lifecycle);

    const courseLink = page.getByRole('link', { name: cartItem.course.title, exact: true });
    await courseLink.hover();
    await expect(courseLink).toHaveCSS('color', 'rgb(91, 63, 214)');

    for (const width of [320, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole('button', { name: /remove a deliberately long cart course/i }),
      ).toBeVisible();
      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.clientWidth);
      expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.clientWidth);
      await testInfo.attach(`cart-${width}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === '/cart/items/7' &&
        response.status() === 204,
    );
    const revalidationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/cart' &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: /remove a deliberately long cart course/i }).click();
    const [deleteFailure, revalidationFailure] = await Promise.all([
      (await deleteResponse).finished(),
      (await revalidationResponse).finished(),
    ]);
    if (deleteFailure !== null)
      throw new Error(`Cart delete response did not finish: ${deleteFailure}`);
    if (revalidationFailure !== null)
      throw new Error(`Cart revalidation response did not finish: ${revalidationFailure}`);
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeFocused();
    await expect(page.getByRole('status')).toContainText('Course removed from cart.');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedMotionDuration = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--duration-base').trim(),
    );
    expect(['0ms', '0s'].includes(reducedMotionDuration)).toBe(true);
    await expectSuccessfulCartLifecycle(lifecycle, {
      selectedMutations: ['DELETE /cart/items/7'],
    });
  });

  test('keeps the initiating remove control visually unchanged without a loading spinner while its DELETE request is pending', async ({
    page,
  }) => {
    await installStudent(page);
    let resolveDelete: (() => void) | undefined;
    const pendingDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    let currentCart = cart();
    await installCartAdmissionRoutes(page, async (route, request) => {
      const requestLabel = cartRequestLabel(request);
      if (requestLabel === 'GET /cart') return json(route, currentCart);
      if (requestLabel === 'DELETE /cart/items/7') {
        await pendingDelete;
        currentCart = cart([]);
        return route.fulfill({ status: 204 });
      }
      throw new Error(`Unexpected cart request ${requestLabel}`);
    });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/cart');
    const remove = page.getByRole('button', {
      name: /remove a deliberately long cart course/i,
    });
    const idleBox = await remove.boundingBox();
    if (!idleBox) throw new Error('Idle Cart remove-control geometry is unavailable.');

    await remove.click();
    await expect(remove).toBeEnabled();
    await expect(remove).not.toHaveAttribute('aria-busy', 'true');
    await expect(remove.locator('[data-part="spinner"]')).toHaveCount(0);
    const pendingBox = await remove.boundingBox();
    if (!pendingBox) throw new Error('Pending Cart remove-control geometry is unavailable.');
    expect(pendingBox).toEqual(idleBox);

    const geometry = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.clientWidth);

    resolveDelete?.();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeFocused();
  });

  test('keeps authenticated 403 on a safe catalog recovery action instead of a guest-route loop', async ({
    page,
  }) => {
    await installStudent(page);
    await installCartAdmissionRoutes(page, async (route, request) => {
      if (request.method === 'GET' && request.pathname === '/cart') {
        await json(route, { detail: 'private' }, 403);
        return;
      }
      throw new Error(`Unexpected cart request ${request.method} ${request.pathname}`);
    });
    await page.goto('/cart');
    await expect(page.getByText('Cart is unavailable')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse courses' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: /log in/i })).toHaveCount(0);
  });

  test('uses the exact API-003 clear request and revalidates the cart', async ({ page }) => {
    const lifecycle = trackCartRequestLifecycle(page);
    const controller = createCartD03Controller(page, 'clear-success');
    await controller.install();

    await page.goto('/cart');
    await expect(page.getByRole('button', { name: 'Clear cart' }).first()).toBeVisible();
    markPopulatedCartRead(lifecycle);
    await page.getByRole('button', { name: 'Clear cart' }).first().click();
    await page.getByRole('button', { name: 'Clear cart' }).last().click();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeFocused();
    await expectSuccessfulCartLifecycle(lifecycle, {
      selectedMutations: ['DELETE /cart'],
    });
  });

  test('announces one pending clear across required reflow widths and prevents duplicate confirmation', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const lifecycle = trackCartRequestLifecycle(page);
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    const controller = createCartD03Controller(page, 'clear-pending');
    await controller.install();

    await page.goto('/cart');
    const clearInvoker = page.getByRole('button', { name: 'Clear cart' }).first();
    await expect(clearInvoker).toBeVisible();
    markPopulatedCartRead(lifecycle);
    await clearInvoker.click();
    const dialog = page.getByRole('dialog', { name: 'Clear cart?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(clearInvoker).toBeFocused();

    await clearInvoker.click();
    await dialog.getByRole('button', { name: 'Clear cart' }).press('Enter');
    const pendingConfirmation = dialog.getByRole('button', { name: 'Clearing cart...' });
    await expect(pendingConfirmation).toBeDisabled();
    await expect(pendingConfirmation).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('status')).toHaveText('Clearing cart...');
    await expect.poll(() => controller.getClearRequestCount()).toBe(1);
    await page.keyboard.press('Enter');
    const pendingBox = await pendingConfirmation.boundingBox();
    if (!pendingBox) throw new Error('Pending clear confirmation geometry is unavailable.');
    await page.mouse.click(
      pendingBox.x + pendingBox.width / 2,
      pendingBox.y + pendingBox.height / 2,
    );
    await expect.poll(() => controller.getClearRequestCount()).toBe(1);

    for (const width of [320, 390, 768, 1280] as const) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dialog).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    await page.setViewportSize({ width: 640, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expectNoHorizontalOverflow(page);
    await expect(pendingConfirmation.locator('[data-part="spinner"]')).toHaveCSS(
      'animation-name',
      'none',
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });

    controller.completePendingClear();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeFocused();
    await expectSuccessfulCartLifecycle(lifecycle, {
      selectedMutations: ['DELETE /cart'],
    });
    expect(runtimeErrors).toEqual([]);
  });
});

for (const locale of ['en', 'ru', 'uz'] as const) {
  test(`renders the complete admitted Cart surface without overflow or writes in ${locale}`, async ({
    page,
  }) => {
    test.slow();
    const copy = cartResidualCopy[locale];
    const diagnostics: string[] = [];
    let writes = 0;
    page.on('pageerror', (error) => diagnostics.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(message.text());
    });
    page.on('request', (request) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes += 1;
    });
    const controller = createCartD03Controller(page, 'admitted-surface');
    await controller.install();

    await page.goto('/cart');
    if (locale !== 'en') {
      await page.getByRole('button', { name: 'Change language' }).press('Enter');
      await page
        .getByRole('button', { name: locale === 'ru' ? 'Русский' : "O'zbek", exact: true })
        .press('Enter');
    }

    for (const width of [320, 390, 768, 1280] as const) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { level: 1, name: copy.cart })).toBeVisible();
      const clearToolbarAction = page.getByRole('button', { name: copy.clearAction }).first();
      await expect(clearToolbarAction).toHaveText(copy.clearVisible);
      await expect(clearToolbarAction.locator('svg[aria-hidden="true"]')).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: copy.breadcrumb })).toBeVisible();
      const courses = page.getByRole('list', { name: copy.cartCourses });
      await expect(courses.getByText(copy.courseLabel, { exact: true })).toBeVisible();
      await expect(courses.getByText(copy.price, { exact: true })).toBeVisible();
      await expect(courses.getByText(copy.coursePrice, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.courseCount, { exact: true })).toBeVisible();
      const summary = page.getByRole('complementary', { name: copy.cartTotal });
      await expect(summary.getByRole('heading', { name: copy.orderSummary })).toBeVisible();
      await expect(summary.getByText(copy.total, { exact: true })).toBeVisible();
      const checkout = summary.getByRole('button', { name: copy.mockCheckout });
      await checkout.focus();
      await expect(checkout).toBeFocused();
      await expectNoHorizontalOverflow(page);
    }

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expectNoHorizontalOverflow(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await cdp.detach();
    await expect(page.locator('body')).not.toContainText(
      /Translation unavailable|a11y:\w+|cart:\w+/,
    );
    expect({ diagnostics, writes }).toEqual({ diagnostics: [], writes: 0 });
  });
}

for (const locale of ['ru', 'uz'] as const) {
  test(`localizes the mapped Cart return and polite mutation statuses in ${locale}`, async ({
    page,
  }) => {
    test.slow();
    const copy = cartMappedConsumerCopy[locale];
    const diagnostics: string[] = [];
    const lifecycle = trackCartRequestLifecycle(page);
    page.on('pageerror', (error) => diagnostics.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(message.text());
    });
    const controller = createCartD03Controller(page, 'localized-return-mutations', {
      returnTo: '/learning?page=2#courses',
    });
    await controller.install();

    await controller.navigateToCart();
    await expect(page.getByRole('heading', { name: 'Cart', exact: true, level: 1 })).toBeVisible();
    markPopulatedCartRead(lifecycle);
    await page.getByRole('button', { name: 'Change language' }).press('Enter');
    await page
      .getByRole('button', { name: locale === 'ru' ? 'Русский' : "O'zbek", exact: true })
      .press('Enter');

    const returnLink = page
      .getByRole('navigation', { name: cartResidualCopy[locale].breadcrumb })
      .getByRole('link', { name: copy.learningReturn, exact: true });
    await expect(returnLink).toHaveAttribute('href', '/learning?page=2#courses');
    await expect(page.getByRole('link', { name: 'My learning', exact: true })).toHaveCount(0);

    const remove = page.locator('[data-cart-remove-course-id="7"]');
    await remove.click();
    const status = page.getByRole('status');
    await expect(status).toContainText(copy.removeStatus);
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).not.toContainText('Course removed from cart.');
    await expect(page.locator('[data-cart-remove-course-id="8"]')).toBeFocused();

    const clearInvoker = page.getByRole('button', { name: copy.clearAction }).first();
    await expect(clearInvoker).toHaveText(copy.clearVisible);
    await clearInvoker.click();
    const dialog = page.getByRole('dialog', { name: copy.clearDialog });
    await dialog.getByRole('button', { name: copy.clearAction }).press('Enter');
    await expect(page.getByRole('heading', { name: copy.empty })).toBeFocused();
    await expect(page.getByRole('status')).toContainText(copy.clearStatus);
    await expect(page.getByRole('status')).not.toContainText('Cart cleared.');

    for (const width of [320, 390, 768, 1280] as const) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expectNoHorizontalOverflow(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await cdp.detach();

    await expectSuccessfulCartLifecycle(lifecycle, {
      selectedMutations: ['DELETE /cart/items/7', 'DELETE /cart'],
    });
    expect(diagnostics).toEqual([]);
  });
}
