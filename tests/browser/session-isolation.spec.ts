import { expect, test, type Page } from '@playwright/test';

const accessTokenKey = 'learnhub.access-token';
const learningCollectionPath = '/enrollments/my?page=1&page_size=100';

interface BrowserProfile {
  readonly email: string;
  readonly name: string;
  readonly surname: string;
  readonly role: 'student' | 'instructor';
}

const profileA: BrowserProfile = {
  email: 'ada@example.test',
  name: 'Ada',
  surname: 'A',
  role: 'student',
};

const profileB: BrowserProfile = {
  email: 'bea@example.test',
  name: 'Bea',
  surname: 'B',
  role: 'instructor',
};

function profilePayload(profile: BrowserProfile) {
  return {
    ...profile,
    birthday: null,
    phone_number: null,
    created_at: '2026-07-20T00:00:00Z',
  };
}

interface RuntimeDiagnostics {
  readonly consoleErrors: string[];
  readonly errorResponses: string[];
  readonly pageErrors: string[];
  readonly requestFailures: string[];
}

function observeRuntimeDiagnostics(page: Page): RuntimeDiagnostics {
  const diagnostics: RuntimeDiagnostics = {
    consoleErrors: [],
    errorResponses: [],
    pageErrors: [],
    requestFailures: [],
  };
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown failure';
    diagnostics.requestFailures.push(
      `${request.method()} ${new URL(request.url()).pathname} ${failure}`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      diagnostics.errorResponses.push(
        `${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`,
      );
  });
  return diagnostics;
}

test('applies an external token replacement and removal to the already-open tab', async ({
  context,
  page,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('Session-isolation test requires a base URL');
  const applicationOrigin = new URL(baseURL).origin;
  const firstTabAuthorizations: Array<string | null> = [];
  const firstTabCartAuthorizations: Array<string | null> = [];
  const api021Requests: Array<{ method: string; path: string; authorization: string | null }> = [];
  const completedPrivateRequestsByPage = new Map<Page, Set<string>>();
  const browserErrors: string[] = [];
  const observedPages: Page[] = [];
  const diagnosticsByPage = new Map<Page, RuntimeDiagnostics>();
  const recordCompletedPrivateRequest = (candidate: Page, path: string) => {
    const requests = completedPrivateRequestsByPage.get(candidate) ?? new Set<string>();
    requests.add(path);
    completedPrivateRequestsByPage.set(candidate, requests);
  };
  const observePage = (candidate: Page) => {
    if (diagnosticsByPage.has(candidate)) return;
    observedPages.push(candidate);
    diagnosticsByPage.set(candidate, observeRuntimeDiagnostics(candidate));
    candidate.on('requestfinished', (request) => {
      if (request.method() !== 'GET') return;
      const url = new URL(request.url());
      const path = `${url.pathname}${url.search}`;
      if (path === '/cart' || path === learningCollectionPath)
        recordCompletedPrivateRequest(candidate, path);
    });
  };
  const expectInitialPrivateDataSettled = async (candidate: Page) => {
    await expect
      .poll(() => [...(completedPrivateRequestsByPage.get(candidate) ?? [])].sort())
      .toEqual(['/cart', learningCollectionPath]);
  };
  observePage(page);
  context.on('page', observePage);
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
  await context.addInitScript(
    ({ key, origin }) => {
      if (globalThis.location.origin === origin) localStorage.setItem(key, 'token-A');
    },
    { key: accessTokenKey, origin: applicationOrigin },
  );
  await context.route('**/me', async (route) => {
    const authorization = route.request().headers().authorization ?? null;
    if (route.request().frame().page() === page) firstTabAuthorizations.push(authorization);
    const profile = authorization === 'Bearer token-B' ? profileB : profileA;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profilePayload(profile)),
    });
  });
  await context.route('**/cart', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') throw new Error(`Unexpected cart request ${request.method()}`);
    if (request.frame().page() === page)
      firstTabCartAuthorizations.push(request.headers().authorization ?? null);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        items: [],
        total_price: '0.00',
        currency: 'USD',
        item_count: 0,
      }),
    });
  });
  await context.route('**/enrollments/my*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const observed = {
      method: request.method(),
      path: `${url.pathname}${url.search}`,
      authorization: request.headers().authorization ?? null,
    };
    api021Requests.push(observed);
    if (
      observed.method !== 'GET' ||
      observed.path !== learningCollectionPath ||
      observed.authorization !== 'Bearer token-A'
    ) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: `Unexpected API-021 request: ${JSON.stringify(observed)}` }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        page: 1,
        page_size: 100,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      }),
    });
  });

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Account menu for Ada A' })).toBeVisible();
  await expectInitialPrivateDataSettled(page);

  const writer = await context.newPage();
  await writer.goto('/login');
  await expect(writer.getByRole('button', { name: 'Account menu for Ada A' })).toBeVisible();
  await expectInitialPrivateDataSettled(writer);
  await writer.evaluate((key) => localStorage.setItem(key, 'token-B'), accessTokenKey);

  await expect(page.getByRole('button', { name: 'Account menu for Bea B' })).toBeVisible();
  expect(firstTabAuthorizations).toEqual(['Bearer token-A', 'Bearer token-B']);
  expect(api021Requests).not.toHaveLength(0);
  for (const request of api021Requests) {
    expect(request).toEqual({
      method: 'GET',
      path: learningCollectionPath,
      authorization: 'Bearer token-A',
    });
  }
  expect(api021Requests).not.toContainEqual({
    method: 'GET',
    path: learningCollectionPath,
    authorization: 'Bearer token-B',
  });
  expect(firstTabCartAuthorizations).not.toHaveLength(0);
  expect(new Set(firstTabCartAuthorizations)).toEqual(new Set(['Bearer token-A']));
  expect(await page.evaluate((key) => localStorage.getItem(key), accessTokenKey)).toBe('token-B');

  await writer.evaluate((key) => localStorage.removeItem(key), accessTokenKey);
  await expect(page.getByRole('button', { name: /Account menu for/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), accessTokenKey)).toBeNull();
  expect(observedPages).toHaveLength(2);
  expect(observedPages).toEqual([page, writer]);
  for (const observedPage of observedPages) {
    const diagnostics = diagnosticsByPage.get(observedPage);
    expect(diagnostics).toBeDefined();
    expect(diagnostics?.pageErrors).toEqual([]);
    expect(diagnostics?.consoleErrors).toEqual([]);
    expect(diagnostics?.requestFailures).toEqual([]);
    expect(diagnostics?.errorResponses).toEqual([]);
  }
  expect(browserErrors).toEqual([]);
});

test('accepts an external B login after the current tab logs out through the account menu', async ({
  context,
  page,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('Session-isolation test requires a base URL');
  const applicationOrigin = new URL(baseURL).origin;
  const firstTabAuthorizations: Array<string | null> = [];
  const publicCatalogRequests: Array<{
    authorization: string | null;
    method: string;
    path: string;
  }> = [];
  const instructorCourseRequests: Array<{
    authorization: string | null;
    method: string;
    path: string;
  }> = [];
  const completedPrivateRequestsByPage = new Map<Page, Set<string>>();
  const diagnosticsByPage = new Map<Page, RuntimeDiagnostics>();
  const observedPages: Page[] = [];
  const recordCompletedPrivateRequest = (candidate: Page, path: string) => {
    const requests = completedPrivateRequestsByPage.get(candidate) ?? new Set<string>();
    requests.add(path);
    completedPrivateRequestsByPage.set(candidate, requests);
  };
  const observePage = (candidate: Page) => {
    if (diagnosticsByPage.has(candidate)) return;
    observedPages.push(candidate);
    diagnosticsByPage.set(candidate, observeRuntimeDiagnostics(candidate));
    candidate.on('requestfinished', (request) => {
      if (request.method() !== 'GET') return;
      const url = new URL(request.url());
      const path = `${url.pathname}${url.search}`;
      if (path === '/cart' || path === learningCollectionPath)
        recordCompletedPrivateRequest(candidate, path);
    });
  };
  const expectInitialPrivateDataSettled = async (candidate: Page) => {
    await expect
      .poll(() => [...(completedPrivateRequestsByPage.get(candidate) ?? [])].sort())
      .toEqual(['/cart', learningCollectionPath]);
  };
  observePage(page);
  context.on('page', observePage);
  await page.addInitScript(
    ({ key, origin }) => {
      if (globalThis.location.origin === origin) localStorage.setItem(key, 'token-A');
    },
    { key: accessTokenKey, origin: applicationOrigin },
  );
  await context.route('**/me', async (route) => {
    const authorization = route.request().headers().authorization ?? null;
    if (route.request().frame().page() === page) firstTabAuthorizations.push(authorization);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        profilePayload(authorization === 'Bearer token-B' ? profileB : profileA),
      ),
    });
  });
  await context.route('**/cart', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        items: [],
        total_price: '0.00',
        currency: 'USD',
        item_count: 0,
      }),
    }),
  );
  await context.route('**/enrollments/my*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        page: 1,
        page_size: 100,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      }),
    }),
  );
  await context.route('**/courses/my?*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const observed = {
      authorization: request.headers().authorization ?? null,
      method: request.method(),
      path: `${url.pathname}${url.search}`,
    };
    instructorCourseRequests.push(observed);
    if (
      observed.method !== 'GET' ||
      observed.authorization !== 'Bearer token-B' ||
      observed.path !== '/courses/my?page=1&page_size=20'
    ) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: `Unexpected instructor course request: ${JSON.stringify(observed)}`,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        page: 1,
        page_size: 20,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      }),
    });
  });
  await context.route('**/courses?*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const observed = {
      authorization: request.headers().authorization ?? null,
      method: request.method(),
      path: `${url.pathname}${url.search}`,
    };
    publicCatalogRequests.push(observed);
    const maximumPriceRequest =
      observed.method === 'GET' &&
      observed.authorization === null &&
      observed.path === '/courses?page=1&page_size=1&sort=-price';
    const catalogRequest =
      observed.method === 'GET' &&
      observed.authorization === null &&
      observed.path === '/courses?page=1&page_size=24&sort=created_at';
    if (!maximumPriceRequest && !catalogRequest) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: `Unexpected public Catalog request: ${JSON.stringify(observed)}`,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: maximumPriceRequest
          ? [
              {
                id: 7,
                title: 'React',
                description: null,
                price: '9.99',
                currency: 'USD',
                published_at: '2026-01-01T00:00:00Z',
                instructor: { id: 1, name: 'Ada', surname: 'Lovelace' },
                lessons: [{ id: 1, title: 'Intro' }],
              },
            ]
          : [],
        page: 1,
        page_size: maximumPriceRequest ? 1 : 24,
        total: maximumPriceRequest ? 1 : 0,
        pages: maximumPriceRequest ? 1 : 0,
        has_next: false,
        has_previous: false,
      }),
    });
  });

  await page.goto('/login');
  const account = page.getByRole('button', { name: 'Account menu for Ada A' });
  await expect(account).toBeVisible();
  await expectInitialPrivateDataSettled(page);
  await account.click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), accessTokenKey)).toBeNull();

  const writer = await context.newPage();
  await writer.goto('/login');
  await writer.evaluate((key) => localStorage.setItem(key, 'token-B'), accessTokenKey);

  await expect(page.getByRole('button', { name: 'Account menu for Bea B' })).toBeVisible();
  expect(firstTabAuthorizations).toEqual(['Bearer token-A', 'Bearer token-B']);
  await expect.poll(() => instructorCourseRequests.length).toBeGreaterThan(0);
  for (const request of instructorCourseRequests) {
    expect(request).toEqual({
      authorization: 'Bearer token-B',
      method: 'GET',
      path: '/courses/my?page=1&page_size=20',
    });
  }
  await expect
    .poll(() =>
      publicCatalogRequests.some(
        (request) => request.path === '/courses?page=1&page_size=1&sort=-price',
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      publicCatalogRequests.some(
        (request) => request.path === '/courses?page=1&page_size=24&sort=created_at',
      ),
    )
    .toBe(true);
  for (const request of publicCatalogRequests) {
    expect(request.authorization).toBeNull();
    expect(request.method).toBe('GET');
    expect([
      '/courses?page=1&page_size=1&sort=-price',
      '/courses?page=1&page_size=24&sort=created_at',
    ]).toContain(request.path);
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), accessTokenKey)).toBe('token-B');
  expect(observedPages).toEqual([page, writer]);
  for (const observedPage of observedPages) {
    const diagnostics = diagnosticsByPage.get(observedPage);
    expect(diagnostics?.pageErrors).toEqual([]);
    expect(diagnostics?.consoleErrors).toEqual([]);
    expect(diagnostics?.requestFailures).toEqual([]);
    expect(diagnostics?.errorResponses).toEqual([]);
  }
});
