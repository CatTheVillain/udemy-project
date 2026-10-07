import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  assertAuthWorkflowRuntime,
  AUTH_MY_LEARNING_COLLECTION_PATH,
  authAdmissionController,
  authLocalizedResidualController,
  authWorkflowReflowController,
  type AuthWorkflow,
  fulfillAuthJson,
  installAuthAdmissionRoutes,
  installAuthWorkflowRuntime,
  requireAuthWorkflowRuntimeEvidence,
  waitForAuthAppShellBrandImage,
} from './fixtures/auth-workflows-fixture';
import {
  type HttpFailureIdentity,
  type OptionalRequestFailureAllowanceRetirement,
  type RequestFailureIdentity,
} from './support/visual-quality';

test.beforeEach(async ({ page }) => {
  await installAuthWorkflowRuntime(page);
  await installAuthAdmissionRoutes(page);
});

test.afterEach(async ({ page }) => {
  assertAuthWorkflowRuntime(page);
});

function allowHttpFailures(
  page: Page,
  ...failures: Array<HttpFailureIdentity & { occurrences?: number }>
) {
  const evidence = requireAuthWorkflowRuntimeEvidence(page);
  failures.forEach(({ occurrences = 1, ...identity }) =>
    evidence.http.allow(identity, occurrences),
  );
}

function allowRouteAbort(page: Page, route: Route, errorText: string) {
  const request = route.request();
  const url = new URL(request.url());
  requireAuthWorkflowRuntimeEvidence(page).requests.allow(
    {
      method: request.method(),
      path: `${url.pathname}${url.search}`,
      errorText,
    },
    1,
  );
}

function allowRequestFailures(
  page: Page,
  ...failures: Array<RequestFailureIdentity & { occurrences?: number }>
) {
  const evidence = requireAuthWorkflowRuntimeEvidence(page);
  failures.forEach(({ occurrences = 1, ...identity }) =>
    evidence.requests.allow(identity, occurrences),
  );
}

export function allowOptionalRequestFailure(
  page: Page,
  failure: RequestFailureIdentity,
): OptionalRequestFailureAllowanceRetirement {
  return requireAuthWorkflowRuntimeEvidence(page).requests.allowOptional(failure);
}

const fulfillJson = fulfillAuthJson;

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const rootRect = root.getBoundingClientRect();
    return {
      root: { left: rootRect.left, right: rootRect.right, width: rootRect.width },
      document: root.scrollWidth,
      body: document.body.scrollWidth,
      clippedMainControls: [
        ...document.querySelectorAll<HTMLElement>('main input, main select, main button, main a'),
      ]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < rootRect.left - 0.5 || rect.right > rootRect.right + 0.5;
        })
        .map((element) => `${element.tagName.toLowerCase()}#${element.id}`),
    };
  });
  expect(geometry.root.width).toBeGreaterThan(0);
  expect(geometry.document).toBeLessThanOrEqual(geometry.root.width + 0.5);
  expect(geometry.body).toBeLessThanOrEqual(geometry.root.width + 0.5);
  expect(geometry.clippedMainControls).toEqual([]);
}

async function getPanelCenterX(panel: Locator) {
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  if (!box) throw new Error('Expected the visible panel to have a bounding box');
  return box.x + box.width / 2;
}

async function requiredBoundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a rendered geometry target');
  return box;
}

async function dispatchSameTickSubmits(page: Page) {
  await page.locator('main form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

export async function navigateWithinApp(page: Page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState(
      { ...(window.history.state as object), key: `auth-browser-${Date.now()}` },
      '',
      nextPath,
    );
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type PasswordRevealCssProperty = 'color' | 'background' | 'borderColor';
type TokenCssProperty = 'border-color' | 'color';

interface AuthViewportScenario {
  readonly label: string;
  readonly pageScaleFactor: number;
  readonly widths: readonly number[];
}

type AuthResidualLocale = 'en' | 'ru' | 'uz';

interface AuthResidualLocaleCopy {
  readonly continueLabel: string;
  readonly createAccount: string;
  readonly createAnAccount: string;
  readonly forgotPassword: string;
  readonly logIn: string;
  readonly passwordUpdated: string;
  readonly recoveryChannel: string;
  readonly recoveryLink: string;
  readonly resetPassword: string;
  readonly resetTokenHelp: string;
}

interface AuthBackToLoginCopy {
  readonly backToLogin: string;
  readonly logInWithNewPassword: string;
  readonly resetPassword: string;
}

const AUTH_BACK_TO_LOGIN_COPY: Readonly<Record<AuthResidualLocale, AuthBackToLoginCopy>> = {
  en: {
    backToLogin: 'Back to login',
    logInWithNewPassword: 'Log in with your new password',
    resetPassword: 'Reset password',
  },
  ru: {
    backToLogin: 'Вернуться на страницу входа',
    logInWithNewPassword: 'Войти с новым паролем',
    resetPassword: 'Сбросить пароль',
  },
  uz: {
    backToLogin: 'Kirishga qaytish',
    logInWithNewPassword: 'Yangi parol bilan kirish',
    resetPassword: 'Parolni tiklash',
  },
};

export const authResidualCopy: Readonly<Record<AuthResidualLocale, AuthResidualLocaleCopy>> = {
  en: {
    continueLabel: 'Continue',
    createAccount: 'Create account',
    createAnAccount: 'Create an account',
    forgotPassword: 'Forgot your password?',
    logIn: 'Log in',
    passwordUpdated: 'Your password has been updated.',
    recoveryChannel:
      'If the account can use password recovery, the next steps will be available through the configured recovery channel.',
    recoveryLink:
      'Open the password-reset link from your recovery message to choose a new password.',
    resetPassword: 'Reset password',
    resetTokenHelp:
      'Your reset link supplies a private token. It stays hidden while you complete this form.',
  },
  ru: {
    continueLabel: 'Продолжить',
    createAccount: 'Создать аккаунт',
    createAnAccount: 'Создать аккаунт',
    forgotPassword: 'Забыли пароль?',
    logIn: 'Войти',
    passwordUpdated: 'Ваш пароль обновлён.',
    recoveryChannel:
      'Если для аккаунта доступно восстановление пароля, дальнейшие шаги будут доступны через настроенный канал восстановления.',
    recoveryLink:
      'Откройте ссылку для сброса пароля из сообщения для восстановления, чтобы выбрать новый пароль.',
    resetPassword: 'Сбросить пароль',
    resetTokenHelp:
      'Ссылка для сброса содержит приватный токен. Он остаётся скрытым, пока вы заполняете форму.',
  },
  uz: {
    continueLabel: 'Davom etish',
    createAccount: 'Akkaunt yaratish',
    createAnAccount: 'Akkaunt yaratish',
    forgotPassword: 'Parolni unutdingizmi?',
    logIn: 'Kirish',
    passwordUpdated: 'Parolingiz yangilandi.',
    recoveryChannel:
      'Agar akkaunt parolni tiklashdan foydalana olsa, keyingi qadamlar sozlangan tiklash kanali orqali mavjud bo‘ladi.',
    recoveryLink:
      'Yangi parol tanlash uchun tiklash xabaringizdagi parolni tiklash havolasini oching.',
    resetPassword: 'Parolni tiklash',
    resetTokenHelp:
      'Tiklash havolangiz maxfiy tokenni o‘z ichiga oladi. Shaklni to‘ldirayotganingizda u yashirin qoladi.',
  },
};

export const workflowUi = {
  signup: {
    path: '/signup',
    idle: 'Create account',
    pending: 'Creating account...',
    operation: '/signup',
  },
  login: {
    path: '/login',
    idle: 'Log in',
    pending: 'Logging in...',
    operation: '/login',
  },
  forgot: {
    path: '/forgot-password',
    idle: 'Continue',
    pending: 'Submitting request...',
    operation: '/forgot-password',
  },
  reset: {
    path: '/reset-password?token=responsive-token',
    idle: 'Reset password',
    pending: 'Resetting password...',
    operation: '/reset-password',
  },
} as const;

export async function fillWorkflow(page: Page, workflow: AuthWorkflow) {
  if (workflow === 'signup') {
    await page.getByLabel(/^Email/).fill('learner@example.com');
    await page.getByLabel(/^First name/).fill('Ada');
    await page.getByLabel(/^Last name/).fill('Lovelace');
    await page.getByLabel(/^Password/).fill('password');
    await page.getByLabel(/^Confirm password/).fill('password');
  } else if (workflow === 'login') {
    await page.getByLabel(/^Email/).fill('learner@example.com');
    await page.getByLabel(/^Password/).fill('password');
  } else if (workflow === 'forgot') {
    await page.getByLabel(/^Email/).fill('learner@example.com');
  } else {
    await page.getByLabel(/^New password/).fill('new password');
    await page.getByLabel(/^Confirm new password/).fill('new password');
  }
}

const profile = {
  email: 'learner@example.com',
  name: 'Ada',
  surname: 'Lovelace',
  role: 'student',
  birthday: null,
  phone_number: null,
  created_at: '2026-07-21T00:00:00Z',
};

function signupResponse(accessToken: string) {
  return {
    user: { id: 1, email: 'learner@example.com' },
    access_token: accessToken,
    token_type: 'bearer',
  };
}

async function expectTokenCss(
  locator: Locator,
  property: TokenCssProperty,
  token: '--action-primary-bg' | '--action-link',
) {
  const expectedValue = await locator.evaluate(
    (_element, expectation) => {
      const probe = document.createElement('span');
      probe.style.setProperty(expectation.property, `var(${expectation.token})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(expectation.property);
      probe.remove();
      return value;
    },
    { property, token },
  );
  await expect(locator).toHaveCSS(property, expectedValue);
}

async function expectFocusedControlInVisualViewport(page: Page) {
  const geometry = await page.evaluate(() => {
    const active = document.activeElement;
    const rect = active instanceof HTMLElement ? active.getBoundingClientRect() : null;
    const viewport = window.visualViewport;
    return {
      bottom: rect?.bottom ?? Number.POSITIVE_INFINITY,
      left: rect?.left ?? -1,
      right: rect?.right ?? Number.POSITIVE_INFINITY,
      top: rect?.top ?? -1,
      visibleBottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
      visibleLeft: viewport?.offsetLeft ?? 0,
      visibleRight: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
      visibleTop: viewport?.offsetTop ?? 0,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.visibleLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.visibleRight);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.visibleTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom);
}

export async function expectAllMainControlsReachableInVisualViewport(page: Page) {
  const controls = page.locator('main input, main select, main button, main a');
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    await control.evaluate((element) =>
      element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }),
    );
    await control.focus();
    await expect(control).toBeFocused();
    await expectFocusedControlInVisualViewport(page);
  }
}

export async function expectEffectivePageScaleViewportRelation(
  page: Page,
  pageScaleFactor: number,
) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    return {
      bodyWidth: document.body.scrollWidth,
      documentWidth: root.scrollWidth,
      layoutWidth: root.clientWidth,
      scale: viewport?.scale ?? 1,
      visualWidth: viewport?.width ?? window.innerWidth,
    };
  });
  expect(geometry.scale).toBeCloseTo(pageScaleFactor, 1);
  expect(geometry.visualWidth * geometry.scale).toBeCloseTo(geometry.layoutWidth, 0);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.layoutWidth + 0.5);
  expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.layoutWidth + 0.5);
}

for (const width of [320, 390, 768, 1280]) {
  test(`auth panels stay physically centered and catalog stays client-centered at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });

    await page.goto('/signup');
    const signupPanel = page
      .getByRole('main')
      .locator('section')
      .filter({
        has: page.getByRole('heading', { name: 'Create account' }),
      });
    const signupCenterX = await getPanelCenterX(signupPanel);
    await expectNoHorizontalOverflow(page);

    await page.goto('/login');

    const loginPanel = page
      .getByRole('main')
      .locator('section')
      .filter({
        has: page.getByRole('heading', { name: 'Log in' }),
      });
    const loginCenterX = await getPanelCenterX(loginPanel);
    await expectNoHorizontalOverflow(page);

    await page.getByRole('link', { name: 'LearnHub home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Master the Skills Shaping the Future',
      }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Found 1 course' })).toBeVisible();
    const catalogPanel = page.locator('[data-part="catalog-content"]');
    const catalogCenterX = await getPanelCenterX(catalogPanel);
    await expectNoHorizontalOverflow(page);

    if (width >= 768) {
      const centers = await page.evaluate(() => {
        const rootRect = document.documentElement.getBoundingClientRect();
        return {
          physicalViewport: window.innerWidth / 2,
          renderedRoot: (rootRect.left + rootRect.right) / 2,
        };
      });
      expect(Math.abs(signupCenterX - centers.physicalViewport)).toBeLessThanOrEqual(1);
      expect(Math.abs(loginCenterX - centers.physicalViewport)).toBeLessThanOrEqual(1);
      expect(Math.abs(catalogCenterX - centers.renderedRoot)).toBeLessThanOrEqual(1);
      expect(Math.abs(signupCenterX - loginCenterX)).toBeLessThanOrEqual(1);
    }
  });
}

test('uses the primary violet treatment for Login and Create account navigation links', async ({
  page,
}) => {
  await authAdmissionController('primary-navigation').run(page);
});

test('keeps auth panels physically centered with RTL document direction', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await page.goto('/signup');
  const originalDirection = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  try {
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    for (const width of [768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const signupPanel = page
        .getByRole('main')
        .locator('section')
        .filter({
          has: page.getByRole('heading', { name: 'Create account' }),
        });
      await expect
        .poll(async () => {
          const [signupCenterX, viewportCenterX] = await Promise.all([
            getPanelCenterX(signupPanel),
            page.evaluate(() => window.innerWidth / 2),
          ]);
          return Math.abs(signupCenterX - viewportCenterX);
        })
        .toBeLessThanOrEqual(1);
      await expectNoHorizontalOverflow(page);
    }
  } finally {
    await page.evaluate((direction) => {
      if (direction === null) document.documentElement.removeAttribute('dir');
      else document.documentElement.setAttribute('dir', direction);
    }, originalDirection);
  }
});

test('keeps one-sided signup errors aligned and scopes centered auth-card hierarchy', async ({
  page,
}) => {
  for (const width of [768, 1280]) {
    for (const omitted of ['name', 'surname'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/signup');
      await page.getByLabel(/^Email/).fill('learner@example.com');
      await page.getByLabel(/^First name/).fill(omitted === 'name' ? '' : 'Ada');
      await page.getByLabel(/^Last name/).fill(omitted === 'surname' ? '' : 'Lovelace');
      await page.getByLabel(/^Password/).fill('password');
      await page.getByLabel(/^Confirm password/).fill('password');
      await page.getByRole('button', { name: 'Create account' }).press('Enter');

      const [nameLabel, surnameLabel, nameControl, surnameControl] = await Promise.all([
        requiredBoundingBox(page.locator('label[for="name"]')),
        requiredBoundingBox(page.locator('label[for="surname"]')),
        requiredBoundingBox(page.getByLabel(/^First name/)),
        requiredBoundingBox(page.getByLabel(/^Last name/)),
      ]);
      expect(Math.abs(nameLabel.y - surnameLabel.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(nameControl.y - surnameControl.y)).toBeLessThanOrEqual(1);
      await expect(
        page.getByLabel(omitted === 'name' ? /^First name/ : /^Last name/),
      ).toBeFocused();
      await expectNoHorizontalOverflow(page);
    }
  }

  const alignments = await page.getByRole('main').evaluate((main) => {
    const card = main.querySelector('section');
    const heading = card?.querySelector('h1');
    const description = heading?.nextElementSibling;
    const footer = card?.querySelector(':scope > div:last-child');
    const label = card?.querySelector('label');
    const control = card?.querySelector('input');
    if (
      !(card instanceof HTMLElement) ||
      !(heading instanceof HTMLElement) ||
      !(description instanceof HTMLElement) ||
      !(footer instanceof HTMLElement) ||
      !(label instanceof HTMLElement) ||
      !(control instanceof HTMLElement)
    ) {
      throw new Error('Auth-card hierarchy targets are unavailable');
    }
    return {
      heading: getComputedStyle(heading).textAlign,
      description: getComputedStyle(description).textAlign,
      footer: getComputedStyle(footer).textAlign,
      label: getComputedStyle(label).textAlign,
      control: getComputedStyle(control).textAlign,
    };
  });
  expect(alignments).toEqual({
    heading: 'center',
    description: 'center',
    footer: 'center',
    label: 'start',
    control: 'start',
  });
});

test('signup covers keyboard validation, safe 422/duplicate/offline states, pending lock, and success', async ({
  page,
}) => {
  allowHttpFailures(
    page,
    { method: 'POST', path: '/signup', status: 422 },
    { method: 'POST', path: '/signup', status: 400 },
  );
  allowRequestFailures(
    page,
    { method: 'GET', path: '/cart', errorText: 'net::ERR_ABORTED' },
    { method: 'GET', path: AUTH_MY_LEARNING_COLLECTION_PATH, errorText: 'net::ERR_ABORTED' },
  );
  let attempts = 0;
  const successGate = createDeferred();
  await page.route('**/me', (route) => fulfillJson(route, 200, profile));
  await page.route('**/signup', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts += 1;
    if (attempts === 1) {
      await fulfillJson(route, 422, {
        detail: [
          { loc: ['body', 'email'], msg: 'HOSTILE_SIGNUP_EMAIL_DETAIL', type: 'value_error.email' },
          {
            loc: ['body', 'password'],
            msg: 'HOSTILE_SIGNUP_PASSWORD_DETAIL',
            type: 'vendor_private_rule',
          },
          {
            loc: ['body', 'internal'],
            msg: 'HOSTILE_SIGNUP_INTERNAL_DETAIL',
            type: 'vendor_private_rule',
          },
        ],
      });
      return;
    }
    if (attempts === 2) {
      await fulfillJson(route, 400, { detail: 'HOSTILE_SIGNUP_DUPLICATE_DETAIL' });
      return;
    }
    if (attempts === 3) {
      allowRouteAbort(page, route, 'net::ERR_INTERNET_DISCONNECTED');
      await route.abort('internetdisconnected');
      return;
    }
    await successGate.promise;
    await fulfillJson(route, 200, signupResponse('signup-browser-token'));
  });

  await page.goto('/signup');
  const submit = page.getByRole('button', { name: 'Create account' });
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/^Email/)).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
  for (const fieldLabel of [
    /^Email/,
    /^First name/,
    /^Last name/,
    /^Password/,
    /^Confirm password/,
  ] as const) {
    await expect(page.getByLabel(fieldLabel)).toHaveAttribute('aria-invalid', 'true');
  }

  const reveal = page.getByRole('button', { name: 'Show password' }).first();
  await reveal.focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel(/^Password/)).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByLabel(/^Email/).fill('learner@example.com');
  await page.getByLabel(/^First name/).fill('Ada');
  await page.getByLabel(/^Last name/).fill('Lovelace');
  await page.getByLabel(/^Password/).fill('password');
  await page.getByLabel(/^Confirm password/).fill('password');
  await submit.press('Enter');
  await expect(page.getByLabel(/^Email/)).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
  await expect(page.locator('body')).not.toContainText(
    /HOSTILE_SIGNUP_(EMAIL|PASSWORD|INTERNAL)_DETAIL/,
  );
  await page.getByRole('button', { name: 'Create account' }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('email may already be in use');
  await expect(page.locator('body')).not.toContainText('HOSTILE_SIGNUP_DUPLICATE_DETAIL');
  await page.getByRole('button', { name: 'Create account' }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('offline');

  await dispatchSameTickSubmits(page);
  await expect(page.getByRole('button', { name: 'Creating account...' })).toBeDisabled();
  await expect(page.getByLabel(/^Email/)).toBeDisabled();
  await expect.poll(() => attempts).toBe(4);
  await expect(page.getByLabel(/^Password/)).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Show password' }).first()).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const pendingRevealStyles = async () =>
    page
      .getByRole('button', { name: 'Show password' })
      .first()
      .evaluate((button) => {
        const resolve = (property: PasswordRevealCssProperty, token: string) => {
          const probe = document.createElement('span');
          probe.style[property] = `var(${token})`;
          document.body.append(probe);
          const style = getComputedStyle(probe);
          const value = property === 'background' ? style.backgroundColor : style[property];
          probe.remove();
          return value;
        };
        const style = getComputedStyle(button);
        return {
          color: style.color,
          background: style.backgroundColor,
          borderColor: style.borderColor,
          expectedColor: resolve('color', '--state-disabled-text'),
          expectedBackground: resolve('background', '--state-disabled-bg'),
          expectedBorderColor: resolve('borderColor', '--border-default'),
        };
      });
  await expect
    .poll(async () => {
      const styles = await pendingRevealStyles();
      return [
        styles.color === styles.expectedColor,
        styles.background === styles.expectedBackground,
        styles.borderColor === styles.expectedBorderColor,
      ];
    })
    .toEqual([true, true, true]);
  successGate.resolve();
  await expect(page).toHaveURL(/\/learning$/);
  await expect(page.getByRole('heading', { name: 'My learning' })).toBeVisible();
  expect(attempts).toBe(4);
});

test('keeps a re-masked password private after a pending login re-enables the same form', async ({
  page,
}) => {
  allowHttpFailures(page, { method: 'POST', path: '/login', status: 401 });
  const loginGate = createDeferred();
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await loginGate.promise;
    await fulfillJson(route, 401, { detail: 'HOSTILE_LOGIN_CREDENTIAL_DETAIL' });
  });

  await page.goto('/login');
  await page.getByLabel(/^Email/).fill('learner@example.com');
  await page.getByLabel(/^Password/).fill('password');
  await page.getByRole('button', { name: 'Show password' }).click();
  const password = page.getByLabel(/^Password/);
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Logging in...' })).toBeDisabled();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Show password' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  loginGate.resolve();
  await expect(page.getByRole('alert')).toContainText('email or password');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Show password' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('body')).not.toContainText('HOSTILE_LOGIN_CREDENTIAL_DETAIL');
});

test('uses the Sort-pattern Role listbox and purple reveal states', async ({ page }) => {
  await page.goto('/signup');
  const role = page.getByRole('button', { name: 'Role' });
  const reveal = page.getByRole('button', { name: 'Show password' }).first();

  await role.focus();
  const roleFocus = await role.evaluate((button) => {
    const resolveColor = (token: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(button);
    return {
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      expectedFocus: resolveColor('--focus-ring'),
    };
  });
  expect(roleFocus.outlineColor).toBe(roleFocus.expectedFocus);
  expect(roleFocus.outlineWidth).toBe('2px');
  expect(roleFocus.outlineOffset).toBe('2px');

  const chevron = role.locator('[data-part="signup-role-chevron"]');
  await role.hover();
  await expect(chevron).toHaveCSS('color', 'rgb(107, 114, 128)');
  await role.click();
  const listbox = page.getByRole('listbox', { name: 'Role options' });
  await expect(listbox).toBeVisible();
  await expect(role).toHaveAttribute('aria-expanded', 'true');
  await expectTokenCss(chevron, 'color', '--action-primary-bg');
  const student = listbox.getByRole('option', { name: 'Student' });
  const instructor = listbox.getByRole('option', { name: 'Instructor' });
  await expect(student).toHaveAttribute('aria-selected', 'true');
  await expectTokenCss(
    student.locator('[data-part="signup-role-radio"]'),
    'border-color',
    '--action-primary-bg',
  );
  await instructor.hover();
  await expect(instructor).toHaveCSS('background-color', 'rgb(238, 240, 244)');
  await instructor.click();
  await expect(role).toContainText('Instructor');

  await page.mouse.move(0, 0);
  await role.focus();
  await page.keyboard.press('ArrowDown');
  await expect(listbox).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(role).toContainText('Admin');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(role).toBeFocused();
  await expect(role).toContainText('Admin');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(/^Password/)).toBeFocused();

  const revealIdle = await reveal.evaluate((button) => {
    const resolveColor = (token: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const resolveBackground = (token: string) => {
      const probe = document.createElement('span');
      probe.style.background = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(button);
    return {
      color: style.color,
      background: style.backgroundColor,
      expectedColor: resolveColor('--action-secondary-fg'),
      expectedBackground: resolveBackground('--action-secondary-bg'),
    };
  });
  expect(revealIdle.color).toBe(revealIdle.expectedColor);
  expect(revealIdle.background).toBe(revealIdle.expectedBackground);

  await reveal.hover();
  const revealHoverStyles = async () =>
    reveal.evaluate((button) => {
      const resolveColor = (token: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const resolveBackground = (token: string) => {
        const probe = document.createElement('span');
        probe.style.background = `var(${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      };
      const style = getComputedStyle(button);
      return {
        color: style.color,
        background: style.backgroundColor,
        expectedColor: resolveColor('--action-primary-fg'),
        expectedBackground: resolveBackground('--action-primary-bg-hover'),
      };
    });
  await expect
    .poll(async () => {
      const styles = await revealHoverStyles();
      return [
        styles.color === styles.expectedColor,
        styles.background === styles.expectedBackground,
      ];
    })
    .toEqual([true, true]);

  await reveal.focus();
  const revealFocus = await reveal.evaluate((button) => {
    const resolveColor = (token: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(button);
    return {
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      expectedFocus: resolveColor('--focus-ring'),
    };
  });
  expect(revealFocus.outlineColor).toBe(revealFocus.expectedFocus);
  expect(revealFocus.outlineWidth).toBe('2px');
  expect(revealFocus.outlineOffset).toBe('2px');
});

function expectPublicLoginBearerSuppression(authorizations: readonly (string | null)[]) {
  expect(authorizations).toEqual(authorizations.map(() => null));
}

function expectBoundedCartReconciliation(cartRequests: number) {
  expect(cartRequests).toBe(3);
}

function expectExactLoginAttemptCount(loginRequests: number, expected: number) {
  expect(loginRequests).toBe(expected);
}

async function expectLoginRecoveryRoleHome(page: Page) {
  await expect(page).toHaveURL(/\/learning$/);
  await expect(page.getByRole('heading', { name: 'My learning' })).toBeVisible();
}

type LoginRecoveryFailure = 'credential-401' | 'server-422' | 'offline';

interface FocusedLoginRecoveryScenario {
  readonly failure: LoginRecoveryFailure;
  readonly token: string;
}

async function runFocusedLoginRecovery(page: Page, scenario: FocusedLoginRecoveryScenario) {
  const authorizations: Array<string | null> = [];
  let loginRequests = 0;
  const retireCartAbortAllowance = allowOptionalRequestFailure(page, {
    method: 'GET',
    path: '/cart',
    errorText: 'net::ERR_ABORTED',
  });
  const retireLearningAbortAllowance = allowOptionalRequestFailure(page, {
    method: 'GET',
    path: AUTH_MY_LEARNING_COLLECTION_PATH,
    errorText: 'net::ERR_ABORTED',
  });
  allowHttpFailures(
    page,
    ...(scenario.failure === 'credential-401'
      ? [{ method: 'POST', path: '/login', status: 401 }]
      : scenario.failure === 'server-422'
        ? [{ method: 'POST', path: '/login', status: 422 }]
        : []),
  );
  await page.route('**/me', (route) => fulfillJson(route, 200, profile));
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    loginRequests += 1;
    authorizations.push(route.request().headers().authorization ?? null);
    if (loginRequests > 2) return route.abort('blockedbyclient');
    if (loginRequests === 2) {
      await fulfillJson(route, 200, { access_token: scenario.token });
      return;
    }
    if (scenario.failure === 'credential-401') {
      await fulfillJson(route, 401, { detail: 'HOSTILE_LOGIN_CREDENTIAL_DETAIL' });
      return;
    }
    if (scenario.failure === 'server-422') {
      await fulfillJson(route, 422, {
        detail: [
          { loc: ['body', 'email'], msg: 'HOSTILE_LOGIN_EMAIL_422', type: 'value_error.email' },
        ],
      });
      return;
    }
    allowRouteAbort(page, route, 'net::ERR_INTERNET_DISCONNECTED');
    await route.abort('internetdisconnected');
  });

  await page.goto('/login');
  const email = page.getByLabel(/^Email/);
  const password = page.getByLabel(/^Password/);
  await email.fill('learner@example.com');
  await password.fill('password');
  await password.press('Enter');

  if (scenario.failure === 'credential-401') {
    await expect(page.getByRole('alert')).toContainText('email or password');
    await expect(page.locator('body')).not.toContainText('HOSTILE_LOGIN_CREDENTIAL_DETAIL');
  } else if (scenario.failure === 'server-422') {
    await expect(email).toBeFocused();
    await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('HOSTILE_LOGIN_EMAIL_422');
  } else {
    await expect(page.getByRole('alert')).toContainText('offline');
  }

  await email.fill('recovered@example.com');
  await expect(page.locator('#email-error')).toHaveCount(0);
  await password.press('Enter');
  await expectLoginRecoveryRoleHome(page);
  retireCartAbortAllowance();
  retireLearningAbortAllowance();
  expectExactLoginAttemptCount(loginRequests, 2);
  expectPublicLoginBearerSuppression(authorizations);
  expect(await page.evaluate(() => localStorage.getItem('learnhub.access-token'))).toBe(
    scenario.token,
  );
}

test('login keeps the connected 401 to 422 to offline to held-success Cart journey on one page', async ({
  page,
}) => {
  allowHttpFailures(
    page,
    { method: 'GET', path: '/me', status: 401 },
    { method: 'POST', path: '/login', status: 401 },
    { method: 'POST', path: '/login', status: 422 },
  );
  await page.addInitScript(() => localStorage.setItem('learnhub.access-token', 'stale-token'));
  const loginAuthorizations: Array<string | null> = [];
  let loginRequests = 0;
  let unexpectedLoginRequests = 0;
  let cartRequests = 0;
  let unexpectedCartRequests = 0;
  const loginGate = createDeferred();
  const retireCartAbortAllowance = allowOptionalRequestFailure(page, {
    method: 'GET',
    path: '/cart',
    errorText: 'net::ERR_ABORTED',
  });
  const retireLearningAbortAllowance = allowOptionalRequestFailure(page, {
    method: 'GET',
    path: AUTH_MY_LEARNING_COLLECTION_PATH,
    errorText: 'net::ERR_ABORTED',
  });

  await page.route('**/me', async (route) => {
    if (route.request().headers().authorization === 'Bearer stale-token') {
      await fulfillJson(route, 401, { detail: 'HOSTILE_STALE_SESSION_DETAIL' });
      return;
    }
    await fulfillJson(route, 200, profile);
  });
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    loginRequests += 1;
    loginAuthorizations.push(route.request().headers().authorization ?? null);
    if (loginRequests === 1) {
      await fulfillJson(route, 401, { detail: 'HOSTILE_LOGIN_CREDENTIAL_DETAIL' });
      return;
    }
    if (loginRequests === 2) {
      await fulfillJson(route, 422, {
        detail: [
          { loc: ['body', 'email'], msg: 'HOSTILE_LOGIN_EMAIL_422', type: 'value_error.email' },
          {
            loc: ['body', 'password'],
            msg: 'HOSTILE_LOGIN_PASSWORD_422',
            type: 'vendor_private_rule',
          },
        ],
      });
      return;
    }
    if (loginRequests === 3) {
      allowRouteAbort(page, route, 'net::ERR_INTERNET_DISCONNECTED');
      await route.abort('internetdisconnected');
      return;
    }
    if (loginRequests > 4) {
      unexpectedLoginRequests += 1;
      await route.abort('blockedbyclient');
      return;
    }
    await loginGate.promise;
    await fulfillJson(route, 200, { access_token: 'fresh-token' });
  });
  await page.route('**/cart', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || request.headers().authorization !== 'Bearer fresh-token') {
      unexpectedCartRequests += 1;
      await route.abort('blockedbyclient');
      return;
    }
    cartRequests += 1;
    await fulfillJson(route, 200, {
      id: 1,
      items: [],
      total_price: '0.00',
      currency: 'USD',
      item_count: 0,
    });
  });
  try {
    await page.goto('/login?returnTo=%2Fcart');
    await page.getByRole('button', { name: 'Log in' }).press('Enter');
    await expect(page.getByLabel(/^Email/)).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(loginRequests).toBe(0);

    await page.getByLabel(/^Email/).fill('learner@example.com');
    await page.getByLabel(/^Password/).fill('password');
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByRole('alert')).toContainText('email or password');
    await expect(page.locator('body')).not.toContainText(
      /HOSTILE_(LOGIN_CREDENTIAL|STALE_SESSION)_DETAIL/,
    );

    await page.getByRole('button', { name: 'Log in' }).press('Enter');
    await expect(page.getByLabel(/^Email/)).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
    await expect(page.locator('#password-error')).toContainText(
      'Check this field and submit again',
    );
    await expect(page.locator('body')).not.toContainText(/HOSTILE_LOGIN_(EMAIL|PASSWORD)_422/);
    await page.getByRole('button', { name: 'Log in' }).press('Enter');
    await expect(page.getByRole('alert')).toContainText('offline');

    await dispatchSameTickSubmits(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const pendingSubmit = page.getByRole('button', { name: 'Logging in...' });
    await expect(pendingSubmit).toBeDisabled();
    await expect(pendingSubmit).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByLabel(/^Email/)).toBeDisabled();
    await expect(page.getByLabel(/^Password/)).toBeDisabled();
    await expect.poll(() => loginRequests).toBe(4);
    loginGate.resolve();

    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
    await expect.poll(() => cartRequests).toBe(3);
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    const settledLoginRequests = loginRequests;
    const settledCartRequests = cartRequests;
    await page.waitForTimeout(100);
    expect(loginRequests).toBe(settledLoginRequests);
    expect(cartRequests).toBe(settledCartRequests);
    expectExactLoginAttemptCount(loginRequests, 4);
    expectBoundedCartReconciliation(cartRequests);
    expect(unexpectedLoginRequests).toBe(0);
    expect(unexpectedCartRequests).toBe(0);
    expectPublicLoginBearerSuppression(loginAuthorizations);
    expect(await page.evaluate(() => localStorage.getItem('learnhub.access-token'))).toBe(
      'fresh-token',
    );
  } finally {
    loginGate.resolve();
    retireCartAbortAllowance();
    retireLearningAbortAllowance();
  }
});

test('login recovers from a credential 401 without resetting the page', async ({ page }) => {
  await runFocusedLoginRecovery(page, {
    failure: 'credential-401',
    token: 'credential-recovery-token',
  });
});

test('login clears 422 field feedback before retrying to the role home', async ({ page }) => {
  await runFocusedLoginRecovery(page, {
    failure: 'server-422',
    token: 'validation-recovery-token',
  });
});

test('login recovers from offline feedback without resetting the page', async ({ page }) => {
  await runFocusedLoginRecovery(page, { failure: 'offline', token: 'offline-recovery-token' });
});

test('successful login reaches Cart with one public POST and the retained exact Cart guard', async ({
  page,
}) => {
  const retireCartAbortAllowance = allowOptionalRequestFailure(page, {
    method: 'GET',
    path: '/cart',
    errorText: 'net::ERR_ABORTED',
  });
  const loginAuthorizations: Array<string | null> = [];
  let loginRequests = 0;
  let cartRequests = 0;
  let unexpectedCartRequests = 0;
  await page.route('**/me', (route) => fulfillJson(route, 200, profile));
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    loginRequests += 1;
    loginAuthorizations.push(route.request().headers().authorization ?? null);
    if (loginRequests !== 1) return route.abort('blockedbyclient');
    await fulfillJson(route, 200, { access_token: 'fresh-cart-token' });
  });
  await page.route('**/cart', async (route) => {
    const request = route.request();
    if (
      request.method() !== 'GET' ||
      request.headers().authorization !== 'Bearer fresh-cart-token'
    ) {
      unexpectedCartRequests += 1;
      await route.abort('blockedbyclient');
      return;
    }
    cartRequests += 1;
    await fulfillJson(route, 200, {
      id: 1,
      items: [],
      total_price: '0.00',
      currency: 'USD',
      item_count: 0,
    });
  });

  await page.goto('/login?returnTo=%2Fcart');
  await page.getByLabel(/^Email/).fill('learner@example.com');
  await page.getByLabel(/^Password/).fill('password');
  await page.getByLabel(/^Password/).press('Enter');
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
  await expect.poll(() => cartRequests).toBe(3);
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  const settledLoginRequests = loginRequests;
  const settledCartRequests = cartRequests;
  await page.waitForTimeout(100);
  retireCartAbortAllowance();
  expect(loginRequests).toBe(settledLoginRequests);
  expect(cartRequests).toBe(settledCartRequests);
  expectBoundedCartReconciliation(cartRequests);
  expectExactLoginAttemptCount(loginRequests, 1);
  expect(unexpectedCartRequests).toBe(0);
  expectPublicLoginBearerSuppression(loginAuthorizations);
  expect(await page.evaluate(() => localStorage.getItem('learnhub.access-token'))).toBe(
    'fresh-cart-token',
  );
});

test('actual page recovery oracle rejects a second credential failure', async ({ page }) => {
  allowHttpFailures(page, { method: 'POST', path: '/login', status: 401, occurrences: 2 });
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await fulfillJson(route, 401, { detail: 'HOSTILE_LOGIN_CREDENTIAL_DETAIL' });
  });
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill('learner@example.com');
  await page.getByLabel(/^Password/).fill('password');
  await page.getByLabel(/^Password/).press('Enter');
  await expect(page.getByRole('alert')).toContainText('email or password');
  await page.getByRole('button', { name: 'Log in' }).press('Enter');
  await expect(expectLoginRecoveryRoleHome(page)).rejects.toThrow();
});

test('test-owned login and Cart guards reject injected credential, duplicate, and reconciliation faults', () => {
  expect(() => expectPublicLoginBearerSuppression([null, 'Bearer stale-token'])).toThrow();
  expect(() => expectPublicLoginBearerSuppression([null, null, null])).not.toThrow();
  expect(() => expectExactLoginAttemptCount(2, 1)).toThrow();
  expect(() => expectBoundedCartReconciliation(4)).toThrow();
  expect(() => expectBoundedCartReconciliation(3)).not.toThrow();
});

test('login rejects an external returnTo and falls back to the role home', async ({ page }) => {
  allowRequestFailures(page, { method: 'GET', path: '/cart', errorText: 'net::ERR_ABORTED' });
  allowOptionalRequestFailure(page, {
    method: 'GET',
    path: AUTH_MY_LEARNING_COLLECTION_PATH,
    errorText: 'net::ERR_ABORTED',
  });
  await page.route('**/me', (route) => fulfillJson(route, 200, profile));
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await fulfillJson(route, 200, { access_token: 'safe-fallback-token' });
  });
  await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fprivate');
  await page.getByLabel(/^Email/).fill('learner@example.com');
  await page.getByLabel(/^Password/).fill('password');
  await page.getByLabel(/^Password/).press('Enter');
  await expect(page).toHaveURL(/\/learning$/);
  await expect(page).not.toHaveURL(/evil\.example/);
});

test('login ignores an Instructor returnTo for a student account', async ({ page }) => {
  allowRequestFailures(page, { method: 'GET', path: '/cart', errorText: 'net::ERR_ABORTED' });
  allowOptionalRequestFailure(page, {
    method: 'GET',
    path: AUTH_MY_LEARNING_COLLECTION_PATH,
    errorText: 'net::ERR_ABORTED',
  });
  await page.route('**/me', (route) => fulfillJson(route, 200, profile));
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await fulfillJson(route, 200, { access_token: 'student-after-instructor-token' });
  });

  await page.goto('/login?returnTo=%2Finstructor%2Fcourses');
  await page.getByLabel(/^Email/).fill('learner@example.com');
  await page.getByLabel(/^Password/).fill('password');
  await page.getByLabel(/^Password/).press('Enter');

  await expect(page).toHaveURL(/\/learning$/);
  await expect(
    page.getByRole('heading', { name: 'You do not have access to this page' }),
  ).toHaveCount(0);
});

test('forgot password covers safe 422, offline retry, pending double-submit lock, and neutral success', async ({
  page,
}) => {
  await authAdmissionController('forgot-password').run(page);
});

test('reset covers missing token, safe 400/422, offline retry, pending double-submit lock, and success', async ({
  page,
}) => {
  await authAdmissionController('reset-password').run(page);
});

for (const locale of ['en', 'ru', 'uz'] as const) {
  test(`uses the primary-violet Back-to-login footer treatment in ${locale}`, async ({ page }) => {
    test.slow();
    const copy = AUTH_BACK_TO_LOGIN_COPY[locale];
    await page.addInitScript((initialLocale) => {
      localStorage.setItem('learnhub.locale', initialLocale);
    }, locale);

    await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
    const forgotFooter = page.getByRole('main').getByRole('link', { name: copy.backToLogin });
    await expect(forgotFooter).toHaveAttribute('href', '/login');
    await expectTokenCss(forgotFooter, 'color', '--action-primary-bg');
    await forgotFooter.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login$/);

    await page.route('**/reset-password', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await fulfillJson(route, 200, { message: 'ok' });
    });
    await page.goto('/reset-password?token=footer-tone-token', { waitUntil: 'domcontentloaded' });
    const resetFormFooter = page.getByRole('main').getByRole('link', { name: copy.backToLogin });
    await expect(resetFormFooter).toHaveAttribute('href', '/login');
    await expectTokenCss(resetFormFooter, 'color', '--action-primary-bg');
    await page.locator('#password').fill('new password');
    await page.locator('#passwordConfirmation').fill('new password');
    await page.getByRole('button', { name: copy.resetPassword }).press('Enter');

    const resetSuccessFooter = page.getByRole('main').getByRole('link', { name: copy.backToLogin });
    const inlineSuccessLink = page
      .getByRole('main')
      .getByRole('link', { name: copy.logInWithNewPassword });
    await expect(resetSuccessFooter).toHaveAttribute('href', '/login');
    await expectTokenCss(resetSuccessFooter, 'color', '--action-primary-bg');
    await expect(inlineSuccessLink).toHaveAttribute('href', '/login');
    await expectTokenCss(inlineSuccessLink, 'color', '--action-primary-bg');
  });

  test(`DRAFT-21 auth residual copy reflows and preserves keyboard focus in ${locale}`, async ({
    page,
  }) => {
    test.slow();
    await authLocalizedResidualController.run(page, locale);
  });
}
const authViewportScenarios: readonly AuthViewportScenario[] = [
  { label: 'default scale', pageScaleFactor: 1, widths: [320, 390, 640, 768, 1280] },
  { label: 'effective 200% page scale', pageScaleFactor: 2, widths: [1280] },
];
const authWorkflows: readonly AuthWorkflow[] = ['signup', 'login', 'forgot', 'reset'];

for (const { label, pageScaleFactor, widths } of authViewportScenarios) {
  for (const width of widths) {
    for (const workflow of authWorkflows) {
      test(`all auth workflow states reflow without clipping: ${workflow} at ${width}px (${label})`, async ({
        page,
      }) => {
        await authWorkflowReflowController.run(page, { label, pageScaleFactor, width, workflow });
      });
    }
  }
}

test('rejects auth readiness when the actual AppShell brand image is broken', async ({ page }) => {
  const logoPath = '/src/app/layouts/assets/learnhub-book-ui018.png';
  let logoRequested = false;
  allowRequestFailures(page, { method: 'GET', path: logoPath, errorText: 'net::ERR_FAILED' });
  await page.route(`**${logoPath}`, async (route) => {
    logoRequested = true;
    await route.abort('failed');
  });

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(waitForAuthAppShellBrandImage(page)).rejects.toThrow(
    'AppShell brand image failed to load',
  );
  expect(logoRequested).toBe(true);
});

test('finishes auth readiness only after a held AppShell brand image loads', async ({ page }) => {
  const logoPath = '/src/app/layouts/assets/learnhub-book-ui018.png';
  let logoRequested = false;
  const logoGate = createDeferred();
  await page.route(`**${logoPath}`, async (route) => {
    logoRequested = true;
    await logoGate.promise;
    await route.fallback();
  });

  try {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' });
    const brandImage = page.locator(`img[src*="${logoPath}"]`);
    const readiness = waitForAuthAppShellBrandImage(page);
    await expect.poll(() => logoRequested).toBe(true);
    await expect(brandImage).toBeAttached();
    logoGate.resolve();
    await readiness;
    await expect(brandImage).toHaveJSProperty('complete', true);
    expect(
      await brandImage.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
  } finally {
    logoGate.resolve();
  }
});
