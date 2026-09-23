import { expect, test } from '@playwright/test';

const accessTokenKey = 'learnhub.access-token';

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

test('applies an external token replacement and removal to the already-open tab', async ({
  context,
  page,
}) => {
  const firstTabAuthorizations: Array<string | null> = [];
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
  await context.addInitScript((key) => localStorage.setItem(key, 'token-A'), accessTokenKey);
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

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Account menu for Ada A' })).toBeVisible();

  const writer = await context.newPage();
  await writer.goto('/login');
  await writer.evaluate((key) => localStorage.setItem(key, 'token-B'), accessTokenKey);

  await expect(page.getByRole('button', { name: 'Account menu for Bea B' })).toBeVisible();
  expect(firstTabAuthorizations).toEqual(['Bearer token-A', 'Bearer token-B']);
  expect(await page.evaluate((key) => localStorage.getItem(key), accessTokenKey)).toBe('token-B');

  await writer.evaluate((key) => localStorage.removeItem(key), accessTokenKey);
  await expect(page.getByRole('button', { name: /Account menu for/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), accessTokenKey)).toBeNull();
  expect(browserErrors).toEqual([]);
});
