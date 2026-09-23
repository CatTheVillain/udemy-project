import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  breakpointTokens,
  colorTokens,
  densityTokens,
  motionTokens,
  spacingTokens,
  typographyTokens,
  zIndexTokens,
} from '@shared/ui/tokens';
import { LOCALE_RESOURCES } from '@shared/locale/resources';
import { installCatalogFixture } from './support/catalog-fixture';
import {
  APP_SHELL_BRAND_IMAGE_PATH,
  waitForAppShellBrandImage,
} from './support/app-shell-brand-image';
import {
  createHttpFailureAccounting,
  createRequestFailureAccounting,
  findUnexpectedConsoleErrors,
  type ConsoleErrorEvidence,
  type HttpFailureIdentity,
  type RequestFailureIdentity,
} from './support/visual-quality';

type BackendRole = 'student' | 'instructor' | 'admin';
type ShellSurfaceViewportWidth = 320 | 390 | 768 | 1280 | 1440;
type DesktopViewportWidth = 768 | 1024 | 1280;
type MobileViewportWidth = 320 | 390 | 767;
type StudentHeaderDesktopWidth = 1024 | 1090 | 1100 | 1110 | 1280 | 1440;

const STUDENT_HEADER_DESKTOP_WIDTHS: readonly StudentHeaderDesktopWidth[] = [
  1024, 1090, 1100, 1110, 1280, 1440,
];

function localeResourceString(resource: unknown, key: string): string {
  const value = resource && typeof resource === 'object' ? Reflect.get(resource, key) : undefined;
  if (typeof value !== 'string') throw new Error(`Missing localized resource ${key}.`);
  return value;
}

interface RepresentativeTokenSnapshot {
  density: string | null;
  colorCanvas: string;
  textPrimary: string;
  fontFamilyBase: string;
  spacing2: string;
  controlHeightMd: string;
  durationBase: string;
  breakpointMd: string;
  zDropdown: string;
  zSticky: string;
  zAccessibility: string;
  zModal: string;
  densityCardInner: string;
  htmlColor: string;
  htmlBackgroundColor: string;
  htmlFontFamily: string;
  bodyBackgroundColor: string;
}

interface HeaderSlotBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface StudentHeaderGeometry {
  account: HeaderSlotBox;
  cart: HeaderSlotBox;
  cartAccountGap: number;
  catalog: HeaderSlotBox;
  clientWidth: number;
  hasVerticalScrollbar: boolean;
  innerWidth: number;
  learning: HeaderSlotBox;
  learningWhiteSpace: string;
  overflowFree: boolean;
  search: HeaderSlotBox;
  standardGap: number;
}

interface ExpectedRequestFailureInput extends RequestFailureIdentity {
  occurrences?: number;
}

interface AppShellStaleScrollWindow extends Window {
  queueAppShellStaleScrollEvent(): void;
}

const CART_STRICT_MODE_ABORT: RequestFailureIdentity = {
  method: 'GET',
  path: '/cart',
  errorText: 'net::ERR_ABORTED',
};

const ENROLLMENTS_STRICT_MODE_ABORT: RequestFailureIdentity = {
  method: 'GET',
  path: '/enrollments/my?page=1&page_size=100',
  errorText: 'net::ERR_ABORTED',
};

const INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT: RequestFailureIdentity = {
  method: 'GET',
  path: '/courses/my?page=1&page_size=20',
  errorText: 'net::ERR_ABORTED',
};

const CATALOG_HERO_BACKGROUND_OPTIONAL_ABORT: RequestFailureIdentity = {
  method: 'GET',
  path: '/src/pages/catalog-page/assets/catalog-hero-ui025.png',
  errorText: 'net::ERR_ABORTED',
};

const INSTRUCTOR_DESKTOP_BACKGROUND_OPTIONAL_ABORT: RequestFailureIdentity = {
  method: 'GET',
  path: '/src/pages/instructor-courses-page/assets/instructor-courses-background-desktop-uifd020.png',
  errorText: 'net::ERR_ABORTED',
};

const LEARNING_EMPTY_STATE_IMAGE_PATH =
  '/src/pages/learning-list-page/assets/my-learning-empty-state-ui022.png';

const emptyCatalogCourseReviewPage = {
  items: [],
  page: 1,
  page_size: 20,
  total: 0,
  pages: 0,
  has_next: false,
  has_previous: false,
};

async function readRepresentativeTokenSnapshot(page: Page): Promise<RepresentativeTokenSnapshot> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(document.body);
    const readToken = (name: string) => rootStyle.getPropertyValue(name).trim();

    return {
      density: root.getAttribute('data-density'),
      colorCanvas: readToken('--color-canvas'),
      textPrimary: readToken('--text-primary'),
      fontFamilyBase: readToken('--font-family-base'),
      spacing2: readToken('--spacing-2'),
      controlHeightMd: readToken('--control-height-md'),
      durationBase: readToken('--duration-base'),
      breakpointMd: readToken('--bp-md'),
      zDropdown: readToken('--z-dropdown'),
      zSticky: readToken('--z-sticky'),
      zAccessibility: readToken('--z-accessibility'),
      zModal: readToken('--z-modal'),
      densityCardInner: readToken('--density-card-inner'),
      htmlColor: rootStyle.color,
      htmlBackgroundColor: rootStyle.backgroundColor,
      htmlFontFamily: rootStyle.fontFamily,
      bodyBackgroundColor: bodyStyle.backgroundColor,
    };
  });
}

async function resolveBrowserColor(page: Page, value: string) {
  return page.evaluate((color) => {
    const probe = document.createElement('span');
    probe.style.color = color;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface MobileControlChrome {
  searchBackground: string;
  searchBorderTop: string;
  searchBorderBottom: string;
  searchShadow: string;
  navigationBackground: string;
  navigationBorderTop: string;
  navigationShadow: string;
  expectedShadow: string;
}

async function sampleBrowserColor(page: Page, value: string): Promise<RgbaColor> {
  return page.evaluate((color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Browser color sampler is unavailable');
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return { red, green, blue, alpha };
  }, value);
}

async function resolveBrowserFontFamily(page: Page, value: string) {
  return page.evaluate((fontFamily) => {
    const probe = document.createElement('span');
    probe.style.fontFamily = fontFamily;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).fontFamily;
    probe.remove();
    return resolved;
  }, value);
}

async function waitForInstructorCoursesBackgroundAssets(page: Page) {
  await page
    .getByRole('heading', { level: 1, name: 'Instructor courses' })
    .evaluate(async (heading) => {
      const coursePage = heading.closest('article');
      if (!(coursePage instanceof HTMLElement))
        throw new Error('Instructor courses page container is unavailable');

      const style = getComputedStyle(coursePage);
      const variant = style.getPropertyValue('--instructor-courses-background-variant').trim();
      const expectedAssetCounts: Record<string, number> = {
        desktop: 1,
        tablet: 1,
        mobile: 2,
      };
      const expectedAssetCount = expectedAssetCounts[variant];
      if (!expectedAssetCount)
        throw new Error(
          `Unexpected Instructor courses background variant: ${variant || 'missing'}`,
        );

      const assetUrls = [
        ...new Set(
          Array.from(style.backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => {
            const assetUrl = match[2];
            if (!assetUrl) throw new Error('Instructor courses background URL is unavailable');
            const resolvedUrl = new URL(assetUrl, window.location.href);
            if (resolvedUrl.origin !== window.location.origin)
              throw new Error(
                `Instructor courses background has a non-local origin: ${resolvedUrl.origin}`,
              );
            return resolvedUrl.href;
          }),
        ),
      ];
      if (assetUrls.length !== expectedAssetCount)
        throw new Error(
          `Expected ${expectedAssetCount} ${variant} Instructor courses background asset(s), received ${assetUrls.length}`,
        );

      await Promise.all(
        assetUrls.map(
          (assetUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              const complete = () => {
                if (image.naturalWidth === 0) {
                  reject(new Error(`Instructor courses background failed: ${assetUrl}`));
                  return;
                }
                image.decode().then(resolve, () => {
                  reject(new Error(`Instructor courses background could not decode: ${assetUrl}`));
                });
              };
              image.addEventListener('load', complete, { once: true });
              image.addEventListener(
                'error',
                () => reject(new Error(`Instructor courses background failed: ${assetUrl}`)),
                { once: true },
              );
              image.src = assetUrl;
              if (image.complete) complete();
            }),
        ),
      );
    });
}

async function waitForCatalogMobileHeroBackground(page: Page) {
  await page.evaluate(async () => {
    const hero = document.querySelector('[data-part="catalog-hero"]');
    if (!(hero instanceof HTMLElement)) throw new Error('Catalog hero is unavailable');

    const backgroundImage = getComputedStyle(hero, '::before').backgroundImage;
    const assetUrls = [
      ...new Set(
        Array.from(backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => {
          const assetUrl = match[2];
          if (!assetUrl) throw new Error('Catalog mobile hero background URL is unavailable');
          const resolvedUrl = new URL(assetUrl, window.location.href);
          if (resolvedUrl.origin !== window.location.origin)
            throw new Error(
              `Catalog mobile hero background has a non-local origin: ${resolvedUrl.origin}`,
            );
          return resolvedUrl.href;
        }),
      ),
    ];
    if (assetUrls.length !== 1)
      throw new Error(
        `Expected one Catalog mobile hero background asset, received ${assetUrls.length}`,
      );

    const [assetUrl] = assetUrls;
    if (
      new URL(assetUrl).pathname !==
      '/src/pages/catalog-page/assets/catalog-hero-mobile-stars-lines-uifd001.png'
    )
      throw new Error(`Unexpected Catalog mobile hero background asset: ${assetUrl}`);

    const heroBackground = new Image();
    heroBackground.src = assetUrl;
    await heroBackground.decode();
    if (heroBackground.naturalWidth === 0) throw new Error('Catalog mobile hero background failed');
  });
}

async function waitForLearningEmptyStateIllustration(page: Page) {
  await page
    .locator('[aria-labelledby="learning-empty-heading"] img')
    .evaluate(async (image, expectedPath) => {
      if (!(image instanceof HTMLImageElement))
        throw new Error('Learning empty-state illustration is unavailable');

      const assetUrl = new URL(image.currentSrc || image.src, window.location.href);
      if (assetUrl.origin !== window.location.origin)
        throw new Error(
          `Learning empty-state illustration has a non-local origin: ${assetUrl.origin}`,
        );
      if (assetUrl.pathname !== expectedPath)
        throw new Error(`Unexpected Learning empty-state illustration: ${assetUrl.href}`);

      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener(
            'error',
            () => reject(new Error(`Learning empty-state illustration failed: ${assetUrl.href}`)),
            { once: true },
          );
        });
      }
      if (image.naturalWidth === 0)
        throw new Error(`Learning empty-state illustration failed: ${assetUrl.href}`);
      await image.decode();
    }, LEARNING_EMPTY_STATE_IMAGE_PATH);
}

async function navigateStudentHeaderAtDesktopWidth(page: Page, width: StudentHeaderDesktopWidth) {
  await page.setViewportSize({ width, height: 720 });
  await page.goto('/learning');
  await expect(page.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
  await waitForAppShellBrandImage(page);
  await waitForLearningEmptyStateIllustration(page);
}

function monitorRuntime(
  page: Page,
  expectedHttpFailures: readonly HttpFailureIdentity[] = [],
  expectedRequestFailures: readonly ExpectedRequestFailureInput[] = [],
  optionalRequestFailures: readonly RequestFailureIdentity[] = [],
) {
  const pageErrors: string[] = [];
  const consoleErrors: ConsoleErrorEvidence[] = [];
  const responseAccounting = createHttpFailureAccounting();
  const requestAccounting = createRequestFailureAccounting();
  expectedHttpFailures.forEach((failure) => responseAccounting.allow(failure, 1));
  expectedRequestFailures.forEach(({ occurrences = 1, ...failure }) => {
    requestAccounting.allow(failure, occurrences);
  });
  optionalRequestFailures.forEach((failure) => requestAccounting.allowOptional(failure));
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  page.on('requestfailed', (request) => {
    requestAccounting.observe(
      request.method(),
      request.url(),
      request.failure()?.errorText ?? 'unknown',
    );
  });
  page.on('response', (response) => {
    responseAccounting.observe(response.request().method(), response.url(), response.status());
  });
  return () => {
    const unexpectedConsoleErrors = findUnexpectedConsoleErrors(
      consoleErrors,
      responseAccounting.acceptedFailures(),
      requestAccounting.acceptedFailures(),
    );
    expect(pageErrors, 'uncaught browser errors').toEqual([]);
    expect(unexpectedConsoleErrors, 'unexpected browser console errors').toEqual([]);
    expect(
      requestAccounting.violations().requestFailures,
      'unexpected browser request failures',
    ).toEqual([]);
    expect(
      requestAccounting.violations().unconsumedExpectedRequestFailures,
      'expected browser request failures not observed',
    ).toEqual([]);
    expect(
      responseAccounting.violations().errorResponses,
      'unexpected HTTP error responses',
    ).toEqual([]);
    expect(
      responseAccounting.violations().unconsumedExpectedResponses,
      'expected HTTP error responses not observed',
    ).toEqual([]);
  };
}

function normalizeFontFamily(value: string) {
  return value.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

async function mockAuthenticatedSession(page: Page, role: BackendRole) {
  const accessTokenInit = await page.addInitScript(() => {
    localStorage.setItem('learnhub.access-token', 'browser-test-token');
  });
  await page.route('**/me', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: `${role}@example.com`,
        name: role === 'student' ? 'Sam' : role === 'instructor' ? 'Indira' : 'Alex',
        surname: 'User',
        role,
        birthday: null,
        phone_number: null,
        created_at: '2026-07-20T00:00:00Z',
      }),
    }),
  );
  return accessTokenInit;
}

interface InstructorPopupFixture {
  waitForSourceCollectionRequest(): Promise<void>;
  releaseSourceCollection(): void;
}

async function mockInstructorPopupPages(
  context: BrowserContext,
  page: Page,
): Promise<InstructorPopupFixture> {
  let resolveSourceCollectionRequest: (() => void) | null = null;
  let sourceCollectionRelease: Promise<void> | null = null;
  let resolveSourceCollectionRelease: (() => void) | null = null;
  const emptyInstructorCourseCollection = JSON.stringify({
    items: [],
    page: 1,
    page_size: 20,
    total: 0,
    pages: 0,
    has_next: false,
    has_previous: false,
  });
  await context.route('**/me', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'instructor@example.com',
        name: 'Indira',
        surname: 'User',
        role: 'instructor',
        birthday: null,
        phone_number: null,
        created_at: '2026-07-20T00:00:00Z',
      }),
    }),
  );
  await context.route(/\/courses\/my\?page=1&page_size=20$/, async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: emptyInstructorCourseCollection,
    }),
  );
  await context.route('**/courses/42', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    }),
  );
  await page.route('**/courses/42', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });
  await page.route(/\/courses\/my\?page=1&page_size=20$/, async (route) => {
    if (route.request().frame().page() !== page) {
      await route.fallback();
      return;
    }
    resolveSourceCollectionRequest?.();
    resolveSourceCollectionRequest = null;
    if (sourceCollectionRelease === null)
      throw new Error('Source collection request arrived before its release barrier was armed');
    await sourceCollectionRelease;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: emptyInstructorCourseCollection,
    });
  });
  return {
    waitForSourceCollectionRequest() {
      if (resolveSourceCollectionRequest !== null)
        throw new Error('Source collection request is already being observed');
      if (sourceCollectionRelease !== null)
        throw new Error('Source collection release barrier is already armed');
      sourceCollectionRelease = new Promise<void>((resolve) => {
        resolveSourceCollectionRelease = resolve;
      });
      return new Promise<void>((resolve) => {
        resolveSourceCollectionRequest = resolve;
      });
    },
    releaseSourceCollection() {
      if (resolveSourceCollectionRelease === null)
        throw new Error('Source collection request is not pending release');
      resolveSourceCollectionRelease();
      resolveSourceCollectionRelease = null;
    },
  };
}

interface StudentWorkspaceFixture {
  waitForEnrollmentFulfillment(): Promise<void>;
}

async function mockStudentWorkspaceData(
  page: Page,
  cartItemCount = 0,
): Promise<StudentWorkspaceFixture> {
  let resolveEnrollmentFulfillment: (() => void) | null = null;
  await page.route('**/cart', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        items: Array.from({ length: cartItemCount }, (_, index) => ({
          id: index + 1,
          course_id: index + 1,
          added_at: '2026-08-17T00:00:00Z',
          course: {
            id: index + 1,
            title: `Cart course ${index + 1}`,
            price: '0.00',
            currency: 'USD',
          },
        })),
        total_price: '0.00',
        currency: 'USD',
        item_count: cartItemCount,
      }),
    }),
  );
  await page.route('**/enrollments/my**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.search !== '?page=1&page_size=100')
      throw new Error(
        `Unexpected API-021 request ${request.method()} ${url.pathname}${url.search}`,
      );
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
    resolveEnrollmentFulfillment?.();
    resolveEnrollmentFulfillment = null;
  });
  return {
    waitForEnrollmentFulfillment() {
      if (resolveEnrollmentFulfillment !== null)
        throw new Error('Student enrollment fulfillment is already being observed');
      return new Promise<void>((resolve) => {
        resolveEnrollmentFulfillment = resolve;
      });
    },
  };
}

interface InstructorCourseCollectionFixture {
  waitForFulfillment(): Promise<void>;
}

async function mockInstructorCourseCollection(
  page: Page,
): Promise<InstructorCourseCollectionFixture> {
  let resolveFulfillment: (() => void) | null = null;

  await page.route(/\/courses\/my\?page=1&page_size=20$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
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
    resolveFulfillment?.();
    resolveFulfillment = null;
  });

  return {
    waitForFulfillment() {
      if (resolveFulfillment !== null) {
        throw new Error('Instructor course collection fulfillment is already being observed');
      }
      return new Promise<void>((resolve) => {
        resolveFulfillment = resolve;
      });
    },
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => {
    const root = document.documentElement;
    const rootRect = root.getBoundingClientRect();
    return {
      renderedRoot: rootRect.width,
      document: root.scrollWidth,
      body: document.body.scrollWidth,
    };
  });
  expect(widths.renderedRoot).toBeGreaterThan(0);
  expect(widths.document).toBeLessThanOrEqual(widths.renderedRoot + 0.5);
  expect(widths.body).toBeLessThanOrEqual(widths.renderedRoot + 0.5);
}

async function expectShellSurfacesAtViewportEdges(page: Page, width: ShellSurfaceViewportWidth) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.getByRole('contentinfo').evaluate((footer) =>
    footer.scrollIntoView({
      block: 'center',
      inline: 'nearest',
    }),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const geometry = await page.evaluate(() => {
    const header = document.querySelector('[data-app-shell-header]');
    const footer = document.querySelector('footer');
    if (!(header instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
      throw new Error('Shell surface geometry targets are unavailable');
    }
    const rootRect = document.documentElement.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
      rootOverflowY: getComputedStyle(document.documentElement).overflowY,
      root: { left: rootRect.left, right: rootRect.right, width: rootRect.width },
      header: { left: headerRect.left, right: headerRect.right },
      footer: { left: footerRect.left, right: footerRect.right },
      headerY: Math.floor((headerRect.top + headerRect.bottom) / 2),
      footerY: Math.floor((footerRect.top + footerRect.bottom) / 2),
      footerVisible: footerRect.top >= -1 && footerRect.bottom <= window.innerHeight + 1,
    };
  });
  expect(geometry.scrollbarGutter).toBe('auto');
  expect(geometry.rootOverflowY).toBe('scroll');
  expect(geometry.footerVisible).toBe(true);
  expect(geometry.root.width).toBeGreaterThan(0);
  expect(geometry.root.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.root.right).toBeLessThanOrEqual(geometry.viewport + 1);
  const physicalLeftGap = Math.max(0, geometry.root.left);
  const physicalRightGap = Math.max(0, geometry.viewport - geometry.root.right);
  expect(physicalLeftGap).toBeLessThanOrEqual(1);
  expect(physicalRightGap).toBeGreaterThanOrEqual(0);
  expect(physicalRightGap).toBeLessThanOrEqual(17);
  expect(physicalLeftGap + physicalRightGap).toBeLessThanOrEqual(17);

  const [headerScreenshot, footerScreenshot] = await Promise.all([
    page.locator('[data-app-shell-header]').screenshot({ animations: 'disabled' }),
    page.getByRole('contentinfo').screenshot({ animations: 'disabled' }),
  ]);
  const edgePixels = await page.evaluate(
    async ({ imageBase64 }) => {
      const edgePixelsForImage = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Screenshot pixel probe is unavailable');
        context.drawImage(image, 0, 0);
        const y = Math.min(4, image.naturalHeight - 1);
        const inset = Math.min(4, image.naturalWidth - 1);
        return [
          Array.from(context.getImageData(0, y, 1, 1).data),
          Array.from(context.getImageData(inset, y, 1, 1).data),
          Array.from(context.getImageData(image.naturalWidth - 1 - inset, y, 1, 1).data),
          Array.from(context.getImageData(image.naturalWidth - 1, y, 1, 1).data),
        ];
      };

      return Promise.all(imageBase64.map((base64) => edgePixelsForImage(base64)));
    },
    {
      imageBase64: [headerScreenshot.toString('base64'), footerScreenshot.toString('base64')],
    },
  );
  const [headerEdgePixels, footerEdgePixels] = edgePixels;
  const expectPixelColor = (actual: number[], expected: number[]) => {
    expect(actual).toHaveLength(expected.length);
    expect(actual.every((channel, index) => Math.abs(channel - expected[index]) <= 1)).toBe(true);
  };
  expectPixelColor(headerEdgePixels[0], headerEdgePixels[1]);
  expectPixelColor(headerEdgePixels[1], headerEdgePixels[2]);
  expectPixelColor(headerEdgePixels[2], headerEdgePixels[3]);
  expectPixelColor(footerEdgePixels[0], footerEdgePixels[1]);
  expectPixelColor(footerEdgePixels[1], footerEdgePixels[2]);
  expectPixelColor(footerEdgePixels[2], footerEdgePixels[3]);
  await expectNoHorizontalOverflow(page);
}

async function requiredBoundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'expected a rendered geometry target').not.toBeNull();
  return box!;
}

async function expectBrandComposition(brand: Locator, accessibleName?: string) {
  await expect(brand).toBeVisible();
  if (accessibleName !== undefined) await expect(brand).toHaveAccessibleName(accessibleName);
  await expect(brand).toHaveText('LearnHub');

  const metrics = await brand.evaluate((link) => {
    const marks = link.querySelectorAll(':scope > img[aria-hidden="true"]');
    const wordmarks = link.querySelectorAll(':scope > span');
    const mark = marks.item(0);
    const wordmark = wordmarks.item(0);
    if (
      marks.length !== 1 ||
      wordmarks.length !== 1 ||
      !(mark instanceof HTMLImageElement) ||
      !(wordmark instanceof HTMLElement)
    ) {
      throw new Error('Brand composition targets are unavailable');
    }

    const linkRect = link.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const wordmarkRect = wordmark.getBoundingClientRect();
    const markStyle = getComputedStyle(mark);
    const linkStyle = getComputedStyle(link);
    const wordmarkStyle = getComputedStyle(wordmark);
    return {
      linkText: link.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      markAriaHidden: mark.getAttribute('aria-hidden'),
      markAlt: mark.alt,
      markSource: mark.getAttribute('src'),
      wordmarkText: wordmark.textContent,
      wordmarkVisible: wordmarkStyle.display !== 'none',
      markWidth: markRect.width,
      markHeight: markRect.height,
      centerDelta: Math.abs(
        (markRect.top + markRect.bottom) / 2 - (wordmarkRect.top + wordmarkRect.bottom) / 2,
      ),
      markInsideLink:
        markRect.left >= linkRect.left - 0.5 &&
        markRect.right <= linkRect.right + 0.5 &&
        markRect.top >= linkRect.top - 0.5 &&
        markRect.bottom <= linkRect.bottom + 0.5,
      wordmarkInsideLink:
        wordmarkRect.left >= linkRect.left - 0.5 &&
        wordmarkRect.right <= linkRect.right + 0.5 &&
        wordmarkRect.top >= linkRect.top - 0.5 &&
        wordmarkRect.bottom <= linkRect.bottom + 0.5,
      markDisplay: markStyle.display,
      markObjectFit: markStyle.objectFit,
      wordmarkWeight: linkStyle.fontWeight,
      expectedWeight: getComputedStyle(document.documentElement)
        .getPropertyValue('--font-weight-semibold')
        .trim(),
    };
  });

  expect(metrics.linkText).toBe('LearnHub');
  expect(metrics.markAriaHidden).toBe('true');
  expect(metrics.markAlt).toBe('');
  expect(metrics.markSource).toContain('learnhub-book-ui018.png');
  expect(metrics.wordmarkText).toBe('LearnHub');
  expect(metrics.markWidth).toBe(44);
  expect(metrics.markHeight).toBe(44);
  if (metrics.wordmarkVisible) expect(metrics.centerDelta).toBeLessThanOrEqual(1);
  expect(metrics.markInsideLink).toBe(true);
  expect(metrics.wordmarkInsideLink).toBe(true);
  expect(metrics.markDisplay).toBe('block');
  expect(metrics.markObjectFit).toBe('contain');
  expect(metrics.wordmarkWeight).toBe(metrics.expectedWeight);
}

async function expectBrandFocusTreatment(page: Page, brand: Locator) {
  await page.getByRole('link', { name: 'Skip to main content' }).focus();
  await page.keyboard.press('Tab');
  await expect(brand).toBeFocused();

  const focus = await brand.evaluate((link) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--focus-ring)';
    document.body.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(link);
    return {
      color: style.outlineColor,
      expectedColor,
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.color).toBe(focus.expectedColor);
}

async function expectAnonymousDesktopHeaderGeometry(page: Page, width: DesktopViewportWidth) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');

  const brand = page.getByRole('link', { name: 'LearnHub home' });
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const accountNavigation = page.getByRole('navigation', { name: 'Account navigation' });
  const browse = navigation.getByRole('link', { name: 'Catalog' });
  const cart = page.getByRole('link', { name: /^Cart/ });
  const login = accountNavigation.getByRole('link', { name: 'Log in' });
  const signup = accountNavigation.getByRole('link', { name: 'Sign up' });
  await expectBrandComposition(brand);
  await expectBrandFocusTreatment(page, brand);
  await expect(browse).toBeVisible();
  await expect(cart).toBeVisible();
  await expect(login).toBeVisible();
  await expect(signup).toBeVisible();
  expect(await navigation.locator('a').allTextContents()).toEqual(['Catalog']);
  expect(await accountNavigation.locator('a').allTextContents()).toEqual(['Log in', 'Sign up']);

  const [brandBox, browseBox, loginBox, signupBox] = await Promise.all([
    requiredBoundingBox(brand),
    requiredBoundingBox(browse),
    requiredBoundingBox(login),
    requiredBoundingBox(signup),
  ]);
  const brandToBrowseGap = browseBox.x - (brandBox.x + brandBox.width);
  const loginToSignupGap = signupBox.x - (loginBox.x + loginBox.width);
  expect(brandToBrowseGap).toBeGreaterThanOrEqual(0);
  expect(brandToBrowseGap).toBeLessThanOrEqual(32);
  expect(loginToSignupGap).toBeGreaterThanOrEqual(0);
  expect(loginToSignupGap).toBeLessThanOrEqual(16);

  const idleStyles = await Promise.all([
    browse.evaluate((link) => {
      const style = getComputedStyle(link);
      const after = getComputedStyle(link, '::after');
      const probe = document.createElement('span');
      probe.style.color = 'var(--action-primary-bg)';
      document.body.append(probe);
      const expectedPurple = getComputedStyle(probe).color;
      probe.remove();
      return {
        background: style.backgroundColor,
        color: style.color,
        underlineBackground: after.backgroundColor,
        underlineHeight: after.height,
        underlineWidth: after.width,
        expectedPurple,
      };
    }),
    signup.evaluate((link) => {
      const style = getComputedStyle(link);
      const probe = document.createElement('span');
      probe.style.color = 'var(--action-primary-fg)';
      probe.style.background = 'var(--action-primary-bg)';
      document.body.append(probe);
      const expected = getComputedStyle(probe);
      const result = {
        color: style.color,
        background: style.backgroundColor,
        expectedColor: expected.color,
        expectedBackground: expected.backgroundColor,
      };
      probe.remove();
      return result;
    }),
  ]);
  expect(idleStyles[0].color).toBe(idleStyles[0].expectedPurple);
  expect(idleStyles[0].background).toBe('rgba(0, 0, 0, 0)');
  expect(idleStyles[0].underlineBackground).toBe(idleStyles[0].expectedPurple);
  expect(idleStyles[0].underlineHeight).toBe('2px');
  expect(idleStyles[0].underlineWidth).toBe('24px');
  expect(idleStyles[1].color).toBe(idleStyles[1].expectedColor);
  expect(idleStyles[1].background).toBe(idleStyles[1].expectedBackground);
  const loginRestStyle = await login.evaluate((link) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-secondary)';
    document.body.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      color: getComputedStyle(link).color,
      background: getComputedStyle(link).backgroundColor,
      expectedColor,
    };
  });
  expect(loginRestStyle.color).toBe(loginRestStyle.expectedColor);
  expect(loginRestStyle.background).toBe('rgba(0, 0, 0, 0)');
  await login.hover();
  const expectedLoginHoverStyle = await login.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--action-secondary-fg)';
    probe.style.background = 'var(--action-secondary-bg)';
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const result = [expected.color, expected.backgroundColor];
    probe.remove();
    return result;
  });
  await expect
    .poll(() =>
      login.evaluate((link) => {
        const style = getComputedStyle(link);
        return [style.color, style.backgroundColor];
      }),
    )
    .toEqual(expectedLoginHoverStyle);
  const loginPointerBox = await requiredBoundingBox(login);
  await page.mouse.move(
    loginPointerBox.x + loginPointerBox.width / 2,
    loginPointerBox.y + loginPointerBox.height / 2,
  );
  await page.mouse.down();
  const expectedLoginPressedBackground = await login.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--action-secondary-bg-pressed)';
    document.body.append(probe);
    const expectedBackground = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return expectedBackground;
  });
  await expect
    .poll(() => login.evaluate((link) => getComputedStyle(link).backgroundColor))
    .toBe(expectedLoginPressedBackground);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await cart.focus();
  await page.keyboard.press('Tab');
  await expect(login).toBeFocused();
  const loginFocusStyle = await login.evaluate((link) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const style = getComputedStyle(link);
    return {
      color: style.outlineColor,
      expectedColor: rootStyle.getPropertyValue('--focus-ring').trim(),
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(loginFocusStyle.style).not.toBe('none');
  expect(loginFocusStyle.width).toBeGreaterThan(0);
  expect(loginFocusStyle.color).toBe(
    await resolveBrowserColor(page, loginFocusStyle.expectedColor),
  );
  await signup.hover();
  await expect
    .poll(() =>
      signup.evaluate((link) => {
        const probe = document.createElement('span');
        probe.style.background = 'var(--action-primary-bg-hover)';
        document.body.append(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return getComputedStyle(link).backgroundColor === expectedBackground;
      }),
    )
    .toBe(true);
  await signup.focus();
  await expect(signup).toBeFocused();
  const focusStyle = await signup.evaluate((link) => getComputedStyle(link).outlineStyle);
  expect(focusStyle).not.toBe('none');
  await expectNoHorizontalOverflow(page);

  await page.goto('/login');
  const activeLogin = page
    .getByRole('navigation', { name: 'Account navigation' })
    .getByRole('link', { name: 'Log in' });
  await expect(activeLogin).toHaveAttribute('aria-current', 'page');
  const activeLoginStyle = await activeLogin.evaluate((link) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--action-secondary-fg)';
    probe.style.background = 'var(--action-secondary-bg-hover)';
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const result = {
      color: getComputedStyle(link).color,
      background: getComputedStyle(link).backgroundColor,
      expectedColor: expected.color,
      expectedBackground: expected.backgroundColor,
    };
    probe.remove();
    return result;
  });
  expect(activeLoginStyle.color).toBe(activeLoginStyle.expectedColor);
  expect(activeLoginStyle.background).toBe(activeLoginStyle.expectedBackground);
}

async function expectAnonymousMobileNavigation(page: Page, width: MobileViewportWidth) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(220);
  const navigation = page.getByRole('navigation', { name: 'Anonymous navigation' });
  const browse = navigation.getByRole('link', { name: 'Catalog' });
  const login = navigation.getByRole('link', { name: 'Log in' });
  const signup = navigation.getByRole('link', { name: 'Sign up' });
  expect(await navigation.locator('a').allTextContents()).toEqual(['Catalog', 'Log in', 'Sign up']);
  await expect(page.getByRole('button', { name: /Open navigation|Close navigation/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('link', { name: /^Cart/ })).toHaveCount(0);
  await expect(page.locator('a[href="/cart"]')).toHaveCount(0);
  const browseState = await browse.evaluate((link) => {
    const linkStyle = getComputedStyle(link);
    const indicatorStyle = getComputedStyle(link, '::after');
    return {
      indicatorTransitionDuration: indicatorStyle.transitionDuration,
      paddingBottom: linkStyle.paddingBottom,
    };
  });
  expect(browseState.paddingBottom).toBe('4px');
  expect(browseState.indicatorTransitionDuration).toBe('0s');
  await browse.focus();
  await page.keyboard.press('Tab');
  await expect(login).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(signup).toBeFocused();
  const stickyGeometry = await page.evaluate(async () => {
    const header = document.querySelector<HTMLElement>('[data-app-shell-header]');
    const search = document.querySelector<HTMLElement>('form[role="search"]');
    if (!header || !search) throw new Error('Anonymous mobile sticky targets are unavailable.');
    window.scrollTo({ top: 320 });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      headerTop: header.getBoundingClientRect().top,
      searchTop: search.getBoundingClientRect().top,
      searchTopInset: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--spacing-2'),
      ),
      searchBackground: getComputedStyle(search).backgroundColor,
      searchBorderTop: getComputedStyle(search).borderTopColor,
      searchBorderTopWidth: getComputedStyle(search).borderTopWidth,
      searchShadow: getComputedStyle(search).boxShadow,
    };
  });
  if (width < 480) expect(stickyGeometry.headerTop).toBeLessThan(0);
  else expect(stickyGeometry.headerTop).toBeCloseTo(0, 1);
  expect(stickyGeometry.searchTopInset).toBe(8);
  expect(stickyGeometry.searchTop).toBeGreaterThanOrEqual(0);
  const stickyInsetTolerance = 2;
  expect(stickyGeometry.searchTop).toBeLessThanOrEqual(
    stickyGeometry.searchTopInset + stickyInsetTolerance,
  );
  expect(
    [0, stickyGeometry.searchTopInset].some(
      (expectedTop) => Math.abs(stickyGeometry.searchTop - expectedTop) <= stickyInsetTolerance,
    ),
  ).toBe(true);
  if (width < 480) {
    expect(stickyGeometry.searchBackground).toBe(
      await resolveBrowserColor(page, colorTokens['--state-control-highlight']),
    );
    expect(stickyGeometry.searchBorderTop).toBe(
      await resolveBrowserColor(page, colorTokens['--border-default']),
    );
    expect(stickyGeometry.searchBorderTopWidth).toBe('1px');
    expect(stickyGeometry.searchShadow).not.toBe('none');
  } else {
    expect(stickyGeometry.searchBackground).toBe('rgba(0, 0, 0, 0)');
    expect(stickyGeometry.searchBorderTopWidth).toBe('0px');
    expect(stickyGeometry.searchShadow).toBe('none');
  }
  await expectNoHorizontalOverflow(page);
}

async function expectInstructorDesktopHeaderNavigation(
  page: Page,
  width: DesktopViewportWidth,
  collectionFixture: InstructorCourseCollectionFixture,
) {
  await page.setViewportSize({ width, height: 900 });
  await Promise.all([collectionFixture.waitForFulfillment(), page.goto('/instructor/courses')]);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Instructor courses', includeHidden: true }),
  ).toHaveCount(1);

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const instructorCourses = navigation.getByRole('link', { name: 'Instructor courses' });
  const profile = page.getByRole('button', { name: 'Account menu for Indira User' });
  await expect(navigation).toBeVisible();
  await expect(instructorCourses).toBeVisible();
  await expect(instructorCourses).toHaveAttribute('aria-current', 'page');
  await expect(instructorCourses).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await instructorCourses.hover();
  await expect(instructorCourses).toHaveCSS(
    'color',
    await resolveBrowserColor(page, colorTokens['--action-primary-bg-hover']),
  );
  await expect(instructorCourses).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(profile).toBeVisible();
  await expect(page.getByRole('link', { name: /^Cart/ })).toHaveCount(0);

  await requiredBoundingBox(instructorCourses);
  await requiredBoundingBox(profile);
  await expectNoHorizontalOverflow(page);
  await page.mouse.move(0, 0);
}

async function readStudentHeaderGeometry(page: Page): Promise<StudentHeaderGeometry> {
  return page.getByRole('banner').evaluate((header) => {
    const read = (selector: string) => {
      const element = header.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing header slot target: ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const root = document.documentElement;
    const cart = read('a[aria-label^="Cart"]');
    const account = read('[data-account-initials]');
    return {
      catalog: read('nav[aria-label="Primary navigation"] a[href="/"]'),
      search: read('input[name="search_query"]'),
      cart,
      account,
      cartAccountGap: account.x - (cart.x + cart.width),
      learning: read('a[href="/learning"]'),
      clientWidth: root.clientWidth,
      innerWidth: window.innerWidth,
      hasVerticalScrollbar: root.scrollHeight > root.clientHeight,
      learningWhiteSpace: getComputedStyle(
        header.querySelector<HTMLElement>('a[href="/learning"]')!,
      ).whiteSpace,
      overflowFree: root.scrollWidth <= root.clientWidth,
      standardGap: Number.parseFloat(getComputedStyle(root).getPropertyValue('--spacing-4')),
    };
  });
}

async function expectMenuAtHeaderInlineStart(page: Page) {
  const geometry = await page
    .getByRole('button', { name: 'Open navigation' })
    .evaluate((button) => {
      const header = button.closest('[data-app-shell-header]');
      const inner = header?.firstElementChild;
      const brand = header?.querySelector<HTMLElement>('a[aria-label="LearnHub home"]');
      if (!(inner instanceof HTMLElement) || !(brand instanceof HTMLElement)) {
        throw new Error('Header geometry target is unavailable');
      }
      const innerRect = inner.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const brandRect = brand.getBoundingClientRect();
      const contentStart = innerRect.left + Number.parseFloat(getComputedStyle(inner).paddingLeft);
      return {
        brandStartOffset: Math.abs(brandRect.left - contentStart),
        brandToMenuGap: buttonRect.left - brandRect.right,
      };
    });
  expect(geometry.brandStartOffset).toBeLessThanOrEqual(1);
  expect(geometry.brandToMenuGap).toBeGreaterThanOrEqual(0);
  expect(geometry.brandToMenuGap).toBeLessThanOrEqual(32);
}

async function expectMobileMenuGeometry(page: Page) {
  const metrics = await page.getByRole('button', { name: 'Open navigation' }).evaluate((button) => {
    const icons = button.querySelectorAll('svg[aria-hidden="true"]');
    const icon = icons.item(0);
    const header = button.closest('[data-app-shell-header]');
    if (icons.length !== 1 || !(icon instanceof SVGElement) || !(header instanceof HTMLElement)) {
      throw new Error('Mobile menu geometry targets are unavailable');
    }

    const buttonRect = button.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const style = getComputedStyle(button);
    const iconStyle = getComputedStyle(icon);
    return {
      iconDisplay: iconStyle.display,
      iconVisibility: iconStyle.visibility,
      iconOpacity: Number.parseFloat(iconStyle.opacity),
      iconWidth: iconRect.width,
      iconHeight: iconRect.height,
      width: buttonRect.width,
      height: buttonRect.height,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      iconLeftInset: iconRect.left - buttonRect.left,
      iconRightInset: buttonRect.right - iconRect.right,
      iconTopInset: iconRect.top - buttonRect.top,
      iconBottomInset: buttonRect.bottom - iconRect.bottom,
      horizontalCenterOffset: Math.abs(
        (iconRect.left + iconRect.right) / 2 - (buttonRect.left + buttonRect.right) / 2,
      ),
      verticalCenterOffset: Math.abs(
        (iconRect.top + iconRect.bottom) / 2 - (buttonRect.top + buttonRect.bottom) / 2,
      ),
      clientWidth: button.clientWidth,
      scrollWidth: button.scrollWidth,
      clientHeight: button.clientHeight,
      scrollHeight: button.scrollHeight,
      headerClientWidth: header.clientWidth,
      headerScrollWidth: header.scrollWidth,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });

  expect(metrics.iconDisplay).not.toBe('none');
  expect(metrics.iconVisibility).toBe('visible');
  expect(metrics.iconOpacity).toBeGreaterThan(0);
  expect(metrics.iconWidth).toBeGreaterThan(0);
  expect(metrics.iconHeight).toBeGreaterThan(0);
  expect(metrics.width).toBeGreaterThanOrEqual(44);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
  expect(metrics.paddingLeft).toBeGreaterThanOrEqual(8);
  expect(metrics.paddingRight).toBeGreaterThanOrEqual(8);
  expect(metrics.iconLeftInset).toBeGreaterThanOrEqual(metrics.paddingLeft);
  expect(metrics.iconRightInset).toBeGreaterThanOrEqual(metrics.paddingRight);
  expect(metrics.iconTopInset).toBeGreaterThan(0);
  expect(metrics.iconBottomInset).toBeGreaterThan(0);
  expect(metrics.horizontalCenterOffset).toBeLessThanOrEqual(1);
  expect(metrics.verticalCenterOffset).toBeLessThanOrEqual(1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
  expect(metrics.headerScrollWidth).toBeLessThanOrEqual(metrics.headerClientWidth);
  expect(metrics.outlineStyle).not.toBe('none');
  expect(metrics.outlineWidth).toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  await installCatalogFixture(page);
  await page.route('**/courses/7/reviews?page=1&page_size=20', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyCatalogCourseReviewPage),
    });
  });
});

test('redirects an anonymous protected route with its internal returnTo', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/cart?coupon=SAVE#summary');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/cart?coupon=SAVE#summary');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('persists desktop and anonymous-mobile locale selections on the current route', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await expect(page.getByRole('link', { name: 'LearnHub home' })).toHaveText('LearnHub');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
    'href',
    '#main-content',
  );

  const desktopTrigger = page.getByRole('button', { name: 'Change language' });
  await desktopTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Русский' })).toBeVisible();
  await page.getByRole('button', { name: 'Русский' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  expect(await page.evaluate(() => localStorage.getItem('learnhub.locale'))).toBe('ru');
  await expect(page.getByRole('button', { name: 'Изменить язык' })).toBeVisible();
  const russianPrimaryNavigation = page.getByRole('navigation', { name: 'Основная навигация' });
  const russianAccountNavigation = page.getByRole('navigation', { name: 'Навигация по аккаунту' });
  await expect(russianPrimaryNavigation.getByRole('link', { name: 'Каталог' })).toBeVisible();
  await expect(russianAccountNavigation.getByRole('link', { name: 'Войти' })).toBeVisible();
  await expect(russianAccountNavigation.getByRole('link', { name: 'Регистрация' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Главная LearnHub' })).toHaveText('LearnHub');
  await expect(page.getByRole('link', { name: 'Перейти к основному содержимому' })).toHaveAttribute(
    'href',
    '#main-content',
  );
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('button', { name: 'Изменить язык' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Навигация гостя' })).toBeVisible();
  const mobileTrigger = page.getByRole('button', { name: 'Изменить язык' });
  await mobileTrigger.click();
  const uzbek = page.getByRole('button', { name: "O'zbek" });
  await expect(uzbek).toHaveAttribute('aria-pressed', 'false');
  await uzbek.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uz');
  expect(await page.evaluate(() => localStorage.getItem('learnhub.locale'))).toBe('uz');
  await expect(page.getByRole('button', { name: 'Tilni o‘zgartirish' })).toBeVisible();
  const uzbekAnonymousNavigation = page.getByRole('navigation', { name: 'Mehmon navigatsiyasi' });
  await expect(uzbekAnonymousNavigation).toBeVisible();
  await expect(uzbekAnonymousNavigation.getByRole('link', { name: 'Katalog' })).toBeVisible();
  await expect(uzbekAnonymousNavigation.getByRole('link', { name: 'Kirish' })).toBeVisible();
  await expect(
    uzbekAnonymousNavigation.getByRole('link', { name: 'Ro‘yxatdan o‘tish' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'LearnHub bosh sahifasi' })).toHaveText('LearnHub');
  await expect(page.getByRole('link', { name: "Asosiy mazmunga o'tish" })).toHaveAttribute(
    'href',
    '#main-content',
  );
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps desktop language hover disclosure open across its gap and preserves other dismissal paths', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'Change language' });
  const menu = page.locator('[aria-label="Language menu"]');
  await trigger.hover();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  await expect(trigger).not.toBeFocused();

  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  if (!triggerBox || !menuBox) throw new Error('Language disclosure geometry is unavailable.');
  expect(menuBox.y - (triggerBox.y + triggerBox.height)).toBeCloseTo(12, 1);
  const traversalX = Math.min(
    Math.max(triggerBox.x + triggerBox.width / 2, menuBox.x + 4),
    menuBox.x + menuBox.width - 4,
  );
  await page.mouse.move(traversalX, triggerBox.y + triggerBox.height + 4);
  await page.waitForTimeout(60);
  await page.mouse.move(traversalX, menuBox.y + 4);
  await expect(menu).toBeVisible();

  await page.mouse.move(8, 300);
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.locator('main').click({ position: { x: 16, y: 180 } });
  await expect(menu).toHaveCount(0);

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await expect(menu).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(8, 300);
  await trigger.hover();
  await expect(menu).toBeVisible();
  await expect(trigger.locator('[data-language-selector-chevron]')).toHaveCSS('transform', 'none');
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('localizes the student desktop navigation in Russian and Uzbek', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [CART_STRICT_MODE_ABORT, ENROLLMENTS_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.addInitScript(() => localStorage.setItem('learnhub.locale', 'ru'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/learning');

  const russianNavigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(russianNavigation.getByRole('link', { name: 'Каталог' })).toBeVisible();
  await expect(russianNavigation.getByRole('link', { name: 'Моё обучение' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('button', { name: 'Изменить язык' }).click();
  await page.getByRole('button', { name: "O'zbek" }).click();
  const uzbekNavigation = page.getByRole('navigation', { name: 'Asosiy navigatsiya' });
  await expect(uzbekNavigation.getByRole('link', { name: 'Katalog' })).toBeVisible();
  await expect(uzbekNavigation.getByRole('link', { name: 'Ta’limim' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('localizes the instructor desktop and compact navigation in Russian and Uzbek', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await page.addInitScript(() => localStorage.setItem('learnhub.locale', 'ru'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await Promise.all([collectionFixture.waitForFulfillment(), page.goto('/instructor/courses')]);

  const russianNavigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(
    russianNavigation.getByRole('link', { name: 'Курсы преподавателя' }),
  ).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Изменить язык' }).click();
  await page.getByRole('button', { name: "O'zbek" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNavigationTrigger = page.getByRole('button', { name: 'Navigatsiyani ochish' });
  await mobileNavigationTrigger.click();
  const compactNavigation = page.getByRole('navigation', { name: 'Mobil navigatsiya' });
  await expect(
    compactNavigation.getByRole('link', { name: 'O‘qituvchi kurslari' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(mobileNavigationTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('returns focus to the desktop language trigger when scrolling dismisses a focused option', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'Change language' });
  await trigger.click();
  const russian = page.getByRole('button', { name: 'Русский' });
  await russian.focus();
  await expect(russian).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 200));

  await expect(russian).toHaveCount(0);
  await expect(trigger).toBeFocused();
  assertRuntimeClean();
});

test('dismisses the desktop language menu when Tab moves focus outside its options', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'Change language' });
  await trigger.click();
  const uzbek = page.getByRole('button', { name: "O'zbek" });
  await uzbek.focus();
  await expect(uzbek).toBeFocused();
  await page.keyboard.press('Tab');

  await expect(uzbek).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  assertRuntimeClean();
});

test('places authenticated-student Language beside Profile and outside its popover', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [CART_STRICT_MODE_ABORT, ENROLLMENTS_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'student');
  const studentWorkspaceFixture = await mockStudentWorkspaceData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await Promise.all([
    studentWorkspaceFixture.waitForEnrollmentFulfillment(),
    page.goto('/learning', { waitUntil: 'domcontentloaded' }),
  ]);

  const account = page.getByRole('button', { name: 'Account menu for Sam User' });
  const language = page.getByRole('button', { name: 'Change language' });
  await expect(language).toHaveText('EN');
  const accountBox = await account.boundingBox();
  const languageBox = await language.boundingBox();
  if (!accountBox || !languageBox)
    throw new Error('Mobile header control geometry is unavailable.');
  expect(languageBox.x).toBeGreaterThanOrEqual(accountBox.x + accountBox.width);
  expect(
    Math.abs(accountBox.y + accountBox.height / 2 - (languageBox.y + languageBox.height / 2)),
  ).toBeLessThanOrEqual(1);

  await account.click();
  const accountDetails = page.getByRole('group', { name: 'Account details for Sam User' });
  await expect(accountDetails.getByText('Student', { exact: true })).toBeVisible();
  await expect(accountDetails.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(accountDetails.getByRole('button', { name: /Language/ })).toHaveCount(0);
  await account.click();
  await expect(page.getByRole('group', { name: 'Account details for Sam User' })).toHaveCount(0);
  await expect(account).toBeFocused();

  await language.click();
  const languageMenu = page.locator('[aria-label="Language menu"]');
  const searchInput = page.locator('header input').first();
  const languageMenuBox = await languageMenu.boundingBox();
  const searchInputBox = await searchInput.boundingBox();
  if (!languageMenuBox || !searchInputBox)
    throw new Error('Mobile language-menu overlap geometry is unavailable.');
  const overlapTop = Math.max(languageMenuBox.y, searchInputBox.y);
  const overlapBottom = Math.min(
    languageMenuBox.y + languageMenuBox.height,
    searchInputBox.y + searchInputBox.height,
  );
  expect(overlapBottom).toBeGreaterThan(overlapTop);
  expect(
    await page.evaluate(
      ({ x, y }) => {
        const menu = document.querySelector('[aria-label="Language menu"]');
        return menu?.contains(document.elementFromPoint(x, y)) ?? false;
      },
      {
        x: languageMenuBox.x + Math.min(24, languageMenuBox.width / 2),
        y: overlapTop + Math.min(8, (overlapBottom - overlapTop) / 2),
      },
    ),
  ).toBe(true);
  const russian = page.getByRole('button', { name: 'Русский' });
  await expect(russian).toHaveAttribute('aria-pressed', 'false');
  await russian.click();
  await expect(page.getByRole('navigation', { name: 'Навигация студента' })).toBeVisible();
  const localizedLanguage = page.getByRole('button', { name: 'Изменить язык' });
  await expect(localizedLanguage).toHaveText('RU');
  await expect(localizedLanguage).toBeVisible();
  await expect(localizedLanguage).toBeFocused();
  await localizedLanguage.click();
  const uzbek = page.getByRole('button', { name: "O'zbek" });
  await expect(uzbek).toHaveAttribute('aria-pressed', 'false');
  await uzbek.click();
  await expect(page.getByRole('navigation', { name: 'Talaba navigatsiyasi' })).toBeVisible();
  const uzbekLanguage = page.getByRole('button', {
    name: localeResourceString(LOCALE_RESOURCES.uz.navigation, 'changeLanguage'),
  });
  await expect(uzbekLanguage).toHaveText('UZ');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Русский' })).toHaveCount(0);
  await expect(uzbekLanguage).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('places authenticated-instructor Language between Profile and Menu', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await Promise.all([collectionFixture.waitForFulfillment(), page.goto('/instructor/courses')]);

  const profile = page.getByRole('button', { name: 'Account menu for Indira User' });
  const language = page.getByRole('button', { name: 'Change language' });
  const mobileNavigationTrigger = page.getByRole('button', { name: 'Open navigation' });
  const profileBox = await profile.boundingBox();
  const languageBox = await language.boundingBox();
  const menuBox = await mobileNavigationTrigger.boundingBox();
  if (!profileBox || !languageBox || !menuBox)
    throw new Error('Instructor mobile header control geometry is unavailable.');
  expect(languageBox.x).toBeGreaterThanOrEqual(profileBox.x + profileBox.width);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(profileBox.x);
  expect(
    Math.abs(profileBox.y + profileBox.height / 2 - (languageBox.y + languageBox.height / 2)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(languageBox.y + languageBox.height / 2 - (menuBox.y + menuBox.height / 2)),
  ).toBeLessThanOrEqual(1);

  await profile.click();
  const accountDetails = page.getByRole('group', { name: 'Account details for Indira User' });
  await expect(accountDetails).toBeVisible();
  await expect(accountDetails.getByText('Instructor', { exact: true })).toBeVisible();
  await expect(accountDetails.getByRole('button', { name: /Language/ })).toHaveCount(0);
  await profile.click();

  await language.click();
  const english = page.getByRole('button', { name: 'English' });
  const russian = page.getByRole('button', { name: 'Русский' });
  await expect(english).toHaveAttribute('aria-pressed', 'true');
  await expect(russian).toHaveAttribute('aria-pressed', 'false');
  await russian.click();

  const localizedLanguage = page.getByRole('button', { name: 'Изменить язык' });
  await expect(localizedLanguage).toHaveText('RU');
  await expect(localizedLanguage).toBeVisible();
  await expect(page.getByRole('link', { name: 'Главная LearnHub' })).toHaveText('LearnHub');
  await expect(page.getByRole('link', { name: 'Перейти к основному содержимому' })).toBeVisible();
  await expect(localizedLanguage).toBeFocused();
  await localizedLanguage.click();
  await expect(russian).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Русский' })).toHaveCount(0);
  await expect(localizedLanguage).toBeFocused();
  const localizedMobileNavigationTrigger = page.getByRole('button', {
    name: localeResourceString(LOCALE_RESOURCES.ru.a11y, 'openNavigation'),
  });
  await localizedMobileNavigationTrigger.click();
  await expect(
    page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('button', {
      name: localeResourceString(LOCALE_RESOURCES.ru.instructor, 'coursesCreateCourse'),
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(localizedMobileNavigationTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('replaces attempted Instructor Catalog history with Instructor courses', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [{ ...INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT, occurrences: 4 }],
    [INSTRUCTOR_DESKTOP_BACKGROUND_OPTIONAL_ABORT],
  );
  const publicCatalogRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/courses')
      publicCatalogRequests.push(request.url());
  });
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const expectInstructorCoursesOnly = async (url: string) => {
    await expect(page).toHaveURL(url);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Instructor courses', includeHidden: true }),
    ).toHaveCount(1);
    await expect(page.locator('[data-part="catalog-page"]')).toHaveCount(0);
    expect(publicCatalogRequests).toEqual([]);
  };

  // A: initial Instructor history entry and collection fulfillment #1.
  await Promise.all([
    collectionFixture.waitForFulfillment(),
    page.goto('/instructor/courses?source=history#start'),
  ]);
  await expectInstructorCoursesOnly('/instructor/courses?source=history#start');

  // B: attempted public Catalog entry; C: RouteBoundary Navigate replace destination and fulfillment #2.
  await Promise.all([
    collectionFixture.waitForFulfillment(),
    page.goto('/?search_query=React#catalog'),
  ]);
  await expectInstructorCoursesOnly('/instructor/courses');

  // Back restores A and fulfillment #3; B is absent because the redirect used replace.
  await Promise.all([collectionFixture.waitForFulfillment(), page.goBack()]);
  await expectInstructorCoursesOnly('/instructor/courses?source=history#start');

  // Forward restores C, never attempted Catalog B, and fulfillment #4.
  await Promise.all([collectionFixture.waitForFulfillment(), page.goForward()]);
  await expectInstructorCoursesOnly('/instructor/courses');
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('routes the Instructor LearnHub brand to Instructor courses with native link keyboard semantics', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [{ ...INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT, occurrences: 3 }],
  );
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  async function openFrom(query: string) {
    await Promise.all([
      collectionFixture.waitForFulfillment(),
      page.goto(`/instructor/courses?source=${query}#brand`),
    ]);
    const brand = page.getByRole('link', { name: 'LearnHub home' });
    await expect(brand).toHaveAttribute('href', '/instructor/courses');
    return brand;
  }

  const pointerBrand = await openFrom('pointer');
  await pointerBrand.click();
  await expect(page).toHaveURL('/instructor/courses');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('/instructor/courses?source=pointer#brand');

  const enterBrand = await openFrom('enter');
  await enterBrand.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/instructor/courses');
  await expect(page.locator('#main-content')).toBeFocused();

  const spaceBrand = await openFrom('space');
  await spaceBrand.focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL('/instructor/courses?source=space#brand');
  await expect(spaceBrand).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('resets pathname navigation while restoring the browser history entry scroll position', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.addInitScript(() => {
    const nativeScrollTo = window.scrollTo;
    let queueStaleScrollEvent = false;
    Object.assign(window, {
      queueAppShellStaleScrollEvent() {
        queueStaleScrollEvent = true;
      },
    });
    window.scrollTo = ((...args: Parameters<typeof window.scrollTo>) => {
      nativeScrollTo.apply(window, args);
      if (!queueStaleScrollEvent) return;
      queueStaleScrollEvent = false;
      queueMicrotask(() => window.dispatchEvent(new Event('scroll')));
    }) as typeof window.scrollTo;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  const catalogScroll = await page.evaluate(() => window.scrollY);
  expect(catalogScroll).toBeGreaterThan(0);

  await page.evaluate(() => {
    const staleScrollWindow = window as unknown as AppShellStaleScrollWindow;
    staleScrollWindow.queueAppShellStaleScrollEvent();
  });
  await page.getByRole('link', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#main-content')).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(catalogScroll, 0);
  await expect(page.locator('#main-content')).toBeFocused();

  await page.goForward();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#main-content')).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps recent search history open through debounced typing and clearing without requiring a blur', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'learnhub.catalog-search-history',
      JSON.stringify(['React testing', 'TypeScript']),
    );
  });
  await installCatalogFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search courses' });
  const history = page.getByRole('listbox', { name: 'Recent searches' });
  await search.focus();
  await expect(history).toBeVisible();
  await search.fill('React');
  await search.press('Escape');
  await expect(history).toHaveCount(0);
  await expect(page).toHaveURL(/search_query=React/);
  await expect(search).toBeFocused();
  await expect(history).toHaveCount(0);
  await search.click();
  await expect(history).toBeVisible();
  await expect(history.getByRole('option', { name: 'React testing' })).toBeVisible();

  await search.fill('Reac');
  await expect(page).toHaveURL(/search_query=Reac/);
  await expect(history).toBeVisible();
  await expect(history.getByRole('option', { name: 'React testing' })).toBeVisible();

  await search.fill('');
  await expect(page).toHaveURL('/');
  await expect(search).toHaveValue('');
  await expect(history).toBeVisible();
  await expect(history.getByRole('option', { name: 'TypeScript' })).toBeVisible();
  await search.press('Escape');
  await expect(history).toHaveCount(0);
  await search.click();
  await expect(history).toBeVisible();
  await search.press('ArrowDown');
  await expect(history.getByRole('option', { name: 'React testing' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  assertRuntimeClean();
});

test('preserves same-path query scroll and navigates a hash target in Chromium', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Found 1 course', exact: true }),
  ).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 180));
  const sortTrigger = page.getByRole('button', { name: 'Sort by: Oldest' });
  await sortTrigger.focus();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?sort=-created_at$/);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Sort by: Newest' })).toBeFocused();

  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  const beforeHashNavigation = await page.locator('#main-content').evaluate((mainContent) => ({
    scrollY: window.scrollY,
    targetTop: mainContent.getBoundingClientRect().top,
  }));
  expect(beforeHashNavigation.scrollY).toBeGreaterThan(0);
  // WebKit and Chromium can already have the target aligned after the footer scroll.
  // In that case hash navigation must preserve the visible target instead of requiring movement.
  const targetWasAlreadyAligned =
    beforeHashNavigation.targetTop >= -1 && beforeHashNavigation.targetTop <= 1;
  if (targetWasAlreadyAligned) {
    await expect(page.locator('#main-content')).toBeInViewport();
  } else {
    expect(beforeHashNavigation.targetTop).toBeLessThan(-1);
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?sort=-created_at#main-content$/);
  if (targetWasAlreadyAligned) {
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeHashNavigation.scrollY);
  } else {
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeLessThan(beforeHashNavigation.scrollY);
  }
  await expect(page.locator('#main-content')).toBeInViewport();
  await expect
    .poll(() =>
      page
        .locator('#main-content')
        .evaluate((mainContent) => mainContent.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual(-1);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.locator('#main-content')).toHaveCSS('outline-style', 'solid');
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('aligns anonymous desktop navigation and renders the lighter brand', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  const compactMenu = page.getByRole('button', { name: 'Open navigation' });
  await expect(compactMenu).toBeVisible();
  await compactMenu.click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Catalog' }).last()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(compactMenu).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await expectAnonymousDesktopHeaderGeometry(page, 1024);
  await expectAnonymousDesktopHeaderGeometry(page, 1280);
  assertRuntimeClean();
});

test('keeps anonymous mobile navigation in visual and keyboard order', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(page);
  await expectAnonymousMobileNavigation(page, 320);
  await expectAnonymousMobileNavigation(page, 390);
  await expectAnonymousMobileNavigation(page, 767);
  assertRuntimeClean();
});

test('keeps header and footer surfaces at the physical viewport edges without symmetric gutters', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page, [], [], [CATALOG_HERO_BACKGROUND_OPTIONAL_ABORT]);
  for (const width of [320, 390, 768, 1280, 1440] as const) {
    await expectShellSurfacesAtViewportEdges(page, width);
  }
  assertRuntimeClean();
});

test('keeps the complete LearnHub brand accessible when authenticated', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [ENROLLMENTS_STRICT_MODE_ABORT, CART_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/learning');
  const brand = page.getByRole('link', { name: 'LearnHub home' });
  await expectBrandComposition(brand);
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps the accepted shared-header marks and quiet desktop Bot interaction states', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [
      { ...ENROLLMENTS_STRICT_MODE_ABORT, occurrences: 2 },
      { ...CART_STRICT_MODE_ABORT, occurrences: 4 },
    ],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/learning');

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const catalog = navigation.getByRole('link', { name: 'Catalog', exact: true });
  const learning = navigation.getByRole('link', { name: 'My learning', exact: true });

  await expect(learning).toHaveAttribute('aria-current', 'page');
  await catalog.hover();
  await expect(catalog).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(catalog).toHaveCSS('color', 'rgb(91, 63, 214)');
  await learning.focus();
  await expect(learning).toHaveCSS('outline-width', '2px');

  const assistant = page.getByRole('link', { name: 'Open AI assistant' });
  await assistant.hover();
  await page.waitForTimeout(200);
  await expect(assistant).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(assistant).toHaveCSS('color', 'rgb(75, 50, 181)');
  await expect(assistant).toHaveCSS('transform', 'matrix(1.08, 0, 0, 1.08, 0, 0)');

  await page.mouse.down();
  await page.waitForTimeout(200);
  await expect(assistant).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(assistant).toHaveCSS('color', 'rgb(75, 50, 181)');
  await expect(assistant).toHaveCSS('transform', 'matrix(0.96, 0, 0, 0.96, 0, 0)');
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.waitForTimeout(200);

  await assistant.focus();
  await expect(assistant).toHaveCSS('outline-width', '3px');

  const geometry = await page.evaluate(() => {
    const assistantLink = document.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open AI assistant"]',
    );
    const cartLink = document.querySelector<HTMLAnchorElement>('a[aria-label^="Cart"]');
    const profileButton = document.querySelector<HTMLElement>('[data-account-initials]');
    const languageButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Change language"]',
    );
    const activeLink = document.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Primary navigation"] a[aria-current="page"]',
    );
    if (!assistantLink || !cartLink || !profileButton || !languageButton || !activeLink) {
      throw new Error('Shared-header visual targets are unavailable.');
    }
    const assistantIcon = assistantLink.querySelector('svg');
    const cartIcon = cartLink.querySelector('svg');
    if (!(assistantIcon instanceof SVGElement) || !(cartIcon instanceof SVGElement)) {
      throw new Error('Shared-header icon targets are unavailable.');
    }
    const rect = (element: Element) => element.getBoundingClientRect().toJSON();
    return {
      assistant: rect(assistantLink),
      profile: rect(profileButton),
      cart: rect(cartLink),
      language: rect(languageButton),
      assistantIcon: {
        ariaHidden: assistantIcon.getAttribute('aria-hidden'),
        focusable: assistantIcon.getAttribute('focusable'),
        width: rect(assistantIcon).width,
        height: rect(assistantIcon).height,
        stroke: assistantIcon.getAttribute('stroke-width'),
        framed: assistantIcon.querySelector('img, span, button') !== null,
      },
      cartIcon: {
        width: rect(cartIcon).width,
        height: rect(cartIcon).height,
        stroke: cartIcon.getAttribute('stroke-width'),
      },
      activeIndicator: {
        height: getComputedStyle(activeLink, '::after').height,
        opacity: getComputedStyle(activeLink, '::after').opacity,
        transitionDuration: getComputedStyle(activeLink, '::after').transitionDuration,
        width: getComputedStyle(activeLink, '::after').width,
      },
    };
  });
  expect(geometry.assistant.width).toBe(44);
  expect(geometry.profile.width).toBe(44);
  expect(geometry.cart.width).toBe(44);
  expect(geometry.language.height).toBeGreaterThanOrEqual(44);
  expect(geometry.assistant.right).toBeLessThanOrEqual(geometry.profile.x + 0.5);
  expect(geometry.profile.right).toBeLessThanOrEqual(geometry.language.x + 0.5);
  expect(geometry.cart.right).toBeLessThanOrEqual(geometry.profile.x + 0.5);
  expect(geometry.assistantIcon).toEqual({
    ariaHidden: 'true',
    focusable: 'false',
    width: 28,
    height: 28,
    stroke: '1.75',
    framed: false,
  });
  expect(geometry.cartIcon).toEqual({ width: 25, height: 25, stroke: '1.75' });
  expect(geometry.activeIndicator.width).toBe('24px');
  expect(geometry.activeIndicator.height).toBe('2px');
  expect(geometry.activeIndicator.opacity).toBe('1');
  expect(geometry.activeIndicator.transitionDuration).toBe('0.18s, 0.18s');

  await page.goto('/ai-chat');
  await expect(assistant).toHaveAttribute('aria-current', 'page');
  await expect(assistant).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(assistant).toHaveCSS('color', 'rgb(75, 50, 181)');
  await expect(assistant).toHaveCSS('transform', 'none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/learning');
  await assistant.hover();
  await expect(assistant).toHaveCSS('transform', 'none');
  await page.mouse.down();
  await expect(assistant).toHaveCSS('transform', 'none');
  await page.mouse.move(0, 0);
  await page.mouse.up();

  await page.goto('/');
  await expect(catalog).toHaveAttribute('aria-current', 'page');
  const reducedMotion = await catalog.evaluate((link) => {
    const indicator = getComputedStyle(link, '::after');
    return { duration: indicator.transitionDuration, transform: indicator.transform };
  });
  expect(reducedMotion).toEqual({ duration: '0s', transform: 'matrix(1, 0, 0, 1, -12, 0)' });
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('exposes representative production tokens across marketplace and workspace density', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT],
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const marketplace = await readRepresentativeTokenSnapshot(page);
  const expectedCanvasColor = await resolveBrowserColor(page, colorTokens['--color-canvas']);
  const expectedTextColor = await resolveBrowserColor(page, colorTokens['--text-primary']);
  const expectedFontFamily = await resolveBrowserFontFamily(
    page,
    typographyTokens['--font-family-base'],
  );

  expect(marketplace.density).toBe('marketplace');
  expect(marketplace.colorCanvas.toLowerCase()).toBe(colorTokens['--color-canvas'].toLowerCase());
  expect(marketplace.textPrimary.toLowerCase()).toBe(colorTokens['--text-primary'].toLowerCase());
  expect(normalizeFontFamily(marketplace.fontFamilyBase)).toBe(
    normalizeFontFamily(expectedFontFamily),
  );
  expect(marketplace.spacing2).toBe(spacingTokens['--spacing-2']);
  expect(marketplace.controlHeightMd).toBe(spacingTokens['--control-height-md']);
  expect(marketplace.durationBase).toBe(motionTokens['--duration-base']);
  expect(marketplace.breakpointMd).toBe(breakpointTokens['--bp-md']);
  expect(marketplace.zDropdown).toBe(zIndexTokens['--z-dropdown']);
  expect(marketplace.zSticky).toBe(zIndexTokens['--z-sticky']);
  expect(marketplace.zAccessibility).toBe(zIndexTokens['--z-accessibility']);
  expect(marketplace.zModal).toBe(zIndexTokens['--z-modal']);
  expect(Number(marketplace.zSticky)).toBeLessThan(Number(marketplace.zAccessibility));
  expect(Number(marketplace.zAccessibility)).toBeLessThan(Number(marketplace.zModal));
  expect(marketplace.densityCardInner).toBe(densityTokens.marketplace.cardInnerPadding);
  expect(marketplace.htmlColor).toBe(expectedTextColor);
  expect(marketplace.htmlBackgroundColor).toBe(expectedCanvasColor);
  expect(marketplace.bodyBackgroundColor).toBe(expectedCanvasColor);
  expect(marketplace.htmlFontFamily).toBe(expectedFontFamily);

  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await Promise.all([collectionFixture.waitForFulfillment(), page.goto('/instructor/courses')]);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Instructor courses', includeHidden: true }),
  ).toHaveCount(1);

  const workspace = await readRepresentativeTokenSnapshot(page);
  expect(workspace.density).toBe('workspace');
  expect(workspace.densityCardInner).toBe(densityTokens.workspace.cardInnerPadding);
  expect(workspace.colorCanvas).toBe(marketplace.colorCanvas);
  expect(workspace.spacing2).toBe(marketplace.spacing2);
  expect(workspace.controlHeightMd).toBe(marketplace.controlHeightMd);
  expect(workspace.durationBase).toBe(marketplace.durationBase);
  expect(workspace.breakpointMd).toBe(marketplace.breakpointMd);
  expect(workspace.zDropdown).toBe(marketplace.zDropdown);
  expect(workspace.zSticky).toBe(marketplace.zSticky);
  expect(workspace.zAccessibility).toBe(marketplace.zAccessibility);
  expect(workspace.zModal).toBe(marketplace.zModal);
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps the accepted instructor navigation and initials marker at desktop widths', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [{ ...INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT, occurrences: 2 }],
    [INSTRUCTOR_DESKTOP_BACKGROUND_OPTIONAL_ABORT],
  );
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await expectInstructorDesktopHeaderNavigation(page, 1024, collectionFixture);
  await expectInstructorDesktopHeaderNavigation(page, 1280, collectionFixture);
  assertRuntimeClean();
});

test('keeps Instructor courses neutral and hover-violet on nested desktop workspace routes', async ({
  page,
}) => {
  await mockAuthenticatedSession(page, 'instructor');
  await page.route('**/courses/42', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/instructor/courses/42/edit');

  const instructorCourses = page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Instructor courses' });
  await expect(instructorCourses).not.toHaveAttribute('aria-current', 'page');
  await expect(instructorCourses).toHaveCSS('color', 'rgb(55, 65, 81)');
  await expect(instructorCourses).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(
    await instructorCourses.evaluate((link) => getComputedStyle(link, '::after').opacity),
  ).toBe('0');
  await instructorCourses.hover();
  await expect(instructorCourses).toHaveCSS('color', 'rgb(73, 50, 182)');
  await expect(instructorCourses).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expectNoHorizontalOverflow(page);
});

test('shows authenticated account details on hover and preserves the device locale through Log out', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('learnhub.locale', 'ru');
    localStorage.setItem('browser-oracle-unrelated-key', 'preserve-me');
  });
  const accessTokenInit = await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/learning');
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [CART_STRICT_MODE_ABORT, ENROLLMENTS_STRICT_MODE_ABORT],
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');

  const account = page.getByRole('button', { name: 'Меню аккаунта: Sam User' });
  await account.hover();
  const accountDetails = page.getByRole('group', { name: 'Данные аккаунта: Sam User' });
  await expect(accountDetails).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const [accountBox, menuBox] = await Promise.all([
    account.boundingBox(),
    accountDetails.boundingBox(),
  ]);
  if (!accountBox || !menuBox) throw new Error('Account details geometry is unavailable.');
  expect(
    Math.abs(accountBox.x + accountBox.width / 2 - (menuBox.x + menuBox.width / 2)),
  ).toBeLessThanOrEqual(0.5);
  expect(menuBox.y - (accountBox.y + accountBox.height)).toBeCloseTo(12, 1);
  await page.mouse.move(accountBox.x + accountBox.width / 2, accountBox.y + accountBox.height - 1);
  await page.mouse.move(menuBox.x + menuBox.width - accountBox.width / 2, menuBox.y + 1, {
    steps: 8,
  });
  await expect(accountDetails).toBeVisible();
  await expect(accountDetails.locator('[data-part="account-menu-profile"]')).toBeVisible();
  await expect(accountDetails.getByText('student@example.com')).toBeVisible();
  await expect(accountDetails.getByText('Sam User')).toBeVisible();
  const role = accountDetails.getByText('Студент', { exact: true });
  await expect(role).toBeVisible();
  await expect(role).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(role).toHaveCSS(
    'color',
    await resolveBrowserColor(page, colorTokens['--text-secondary']),
  );
  await expect(accountDetails.locator('[data-part="account-menu-role-icon"]')).toBeVisible();
  const [emailBox, roleBox] = await Promise.all([
    accountDetails.getByText('student@example.com').boundingBox(),
    role.boundingBox(),
  ]);
  if (!emailBox || !roleBox) throw new Error('Account-menu role geometry is unavailable.');
  expect(roleBox.x).toBeGreaterThanOrEqual(emailBox.x);
  expect(roleBox.y).toBeGreaterThanOrEqual(emailBox.y + emailBox.height);
  const logout = accountDetails.getByRole('button', { name: 'Выйти' });
  await expect(logout.locator('svg')).toBeVisible();
  await expect(logout).toHaveCSS('border-top-style', 'none');
  await expect(logout).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await logout.hover();
  await expect(logout).toHaveCSS('background-color', 'rgb(238, 240, 244)');
  await logout.click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Войти' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('learnhub.access-token'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('learnhub.locale'))).toBe('ru');
  expect(await page.evaluate(() => localStorage.getItem('browser-oracle-unrelated-key'))).toBe(
    'preserve-me',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await accessTokenInit.dispose();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Войти' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  assertRuntimeClean();
});

test('keeps a clicked account menu open until Escape or an outside click', async ({ page }) => {
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/learning');

  const account = page.getByRole('button', { name: 'Account menu for Sam User' });
  const accountDetails = page.getByRole('group', { name: 'Account details for Sam User' });
  await account.hover();
  await expect(accountDetails).toBeVisible();
  await expect(account).toHaveCSS('box-shadow', 'rgb(91, 63, 214) 0px 0px 0px 1px');
  await page.mouse.move(8, 300);
  await expect(accountDetails).toBeHidden();
  await expect(account).toHaveCSS('box-shadow', 'none');

  await account.click();
  await expect(accountDetails).toBeVisible();
  await expect(account).toHaveCSS('box-shadow', 'rgb(91, 63, 214) 0px 0px 0px 1px');
  await page.mouse.move(8, 300);
  await expect(accountDetails).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(accountDetails).toBeHidden();
  await expect(account).toBeFocused();
  await expect(account).toHaveCSS('box-shadow', 'none');

  await account.click();
  await expect(accountDetails).toBeVisible();
  await page.locator('main').click({ position: { x: 1, y: 1 } });
  await expect(accountDetails).toBeHidden();
});

test('keeps desktop language and account disclosures mutually exclusive', async ({ page }) => {
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/learning');

  const language = page.getByRole('button', { name: 'Change language' });
  const languageMenu = page.locator('[aria-label="Language menu"]');
  const account = page.getByRole('button', { name: 'Account menu for Sam User' });
  const accountDetails = page.getByRole('group', { name: 'Account details for Sam User' });

  await language.hover();
  await expect(languageMenu).toBeVisible();

  await account.hover();
  await expect(accountDetails).toBeVisible();
  await expect(languageMenu).toHaveCount(0);

  await language.hover();
  await expect(languageMenu).toBeVisible();
  await expect(accountDetails).toHaveCount(0);

  await account.click();
  await expect(accountDetails).toBeVisible();
  await language.hover();
  await expect(languageMenu).toBeVisible();
  await expect(accountDetails).toHaveCount(0);
});

test('restores the account trigger when viewport scroll removes its focused details', async ({
  page,
}) => {
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/learning');
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.blockSize = '200vh';
    document.body.append(spacer);
  });

  const account = page.getByRole('button', { name: 'Account menu for Sam User' });
  await account.click();
  const accountDetails = page.getByRole('group', { name: 'Account details for Sam User' });
  const logout = page.getByRole('button', { name: 'Log out' });
  await expect(accountDetails).toBeVisible();
  await logout.focus();
  await expect(logout).toBeFocused();

  await page.evaluate(() => window.scrollTo({ top: 320 }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(accountDetails).toHaveCount(0);
  await expect(account).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Change language' })).toBeFocused();
});

test('keeps anonymous Cart-to-Login actions in their stable desktop end group', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/login?returnTo=%2Fcart');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();

  const geometry = await page.getByRole('banner').evaluate((header) => {
    const byName = (name: string) =>
      Array.from(header.querySelectorAll<HTMLAnchorElement>('a')).find(
        (link) => (link.getAttribute('aria-label') ?? link.textContent?.trim()) === name,
      );
    const cart = byName('Cart');
    const logIn = byName('Log in');
    const signUp = byName('Sign up');
    if (!cart || !logIn || !signUp)
      throw new Error('Anonymous Cart/auth header controls are missing.');
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    return {
      sequence: Array.from(header.querySelectorAll('a, input')).map((element) =>
        element instanceof HTMLInputElement
          ? element.name
          : (element.getAttribute('aria-label') ?? element.textContent?.trim()),
      ),
      cart: rect(cart),
      logIn: rect(logIn),
      signUp: rect(signUp),
      loginWhiteSpace: getComputedStyle(logIn).whiteSpace,
      signUpWhiteSpace: getComputedStyle(signUp).whiteSpace,
    };
  });
  expect(geometry.sequence).toEqual(['LearnHub home', 'Catalog', 'Cart', 'Log in', 'Sign up']);
  expect(geometry.cart.height).toBeGreaterThanOrEqual(44);
  expect(geometry.logIn.height).toBeGreaterThanOrEqual(44);
  expect(geometry.signUp.height).toBeGreaterThanOrEqual(44);
  expect(geometry.loginWhiteSpace).toBe('nowrap');
  expect(geometry.signUpWhiteSpace).toBe('nowrap');
  assertRuntimeClean();
});

test('shows a bootstrap state then student-only workspace navigation', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [ENROLLMENTS_STRICT_MODE_ABORT, CART_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.route('**/me', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/learning');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Preparing your workspace' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
  await expect(page).toHaveTitle('My learning | LearnHub');
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(page.getByRole('link', { name: /^Cart/ })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'My learning' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(navigation.getByRole('link', { name: 'My courses' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account menu for Sam User' })).toBeVisible();

  await page.setViewportSize({ width: 890, height: 900 });
  await expect(navigation).toBeHidden();
  const header = page.getByRole('banner');
  const navigationTrigger = page.getByRole('button', { name: 'Open navigation' });
  await expect(navigationTrigger).toBeVisible();
  await expect(header.getByRole('button', { name: 'Account menu for Sam User' })).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'Open AI assistant' })).toHaveCount(0);
  await expect(header.getByRole('link', { name: /^Cart/ })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Change language' })).toBeVisible();
  const tabletSearch = await page.getByRole('search').boundingBox();
  expect(tabletSearch).not.toBeNull();
  expect(tabletSearch!.width).toBeGreaterThanOrEqual(192);
  const tabletHeaderOrder = await header.evaluate((element) => {
    const brand = element.querySelector<HTMLElement>('a[aria-label="LearnHub home"]');
    const menu = element.querySelector<HTMLElement>('button[aria-haspopup="dialog"]');
    const search = element.querySelector<HTMLElement>('form[role="search"]');
    if (!brand || !menu || !search)
      throw new Error('Authenticated tablet header slots are missing');
    return {
      brandRight: brand.getBoundingClientRect().right,
      menuLeft: menu.getBoundingClientRect().left,
      menuRight: menu.getBoundingClientRect().right,
      searchLeft: search.getBoundingClientRect().left,
    };
  });
  expect(tabletHeaderOrder.brandRight).toBeLessThanOrEqual(tabletHeaderOrder.menuLeft);
  expect(tabletHeaderOrder.menuRight).toBeLessThanOrEqual(tabletHeaderOrder.searchLeft);
  await navigationTrigger.click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  const drawerHeaderGeometry = await drawer.evaluate((element) => {
    const header = element.querySelector<HTMLElement>('.ui-dialog__header');
    const close = element.querySelector<HTMLElement>('.ui-dialog__close');
    const profile = element.querySelector<HTMLElement>('[data-part="account-menu-profile"]');
    const avatar = profile?.querySelector<HTMLElement>('[aria-hidden="true"]');
    if (!header || !close || !avatar) throw new Error('Tablet drawer header anatomy is missing');
    const drawerBox = element.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    const avatarBox = avatar.getBoundingClientRect();
    return {
      avatarBottomInset: headerBox.bottom - avatarBox.bottom,
      avatarCenterDelta: Math.abs(
        avatarBox.top + avatarBox.height / 2 - (headerBox.top + headerBox.height / 2),
      ),
      avatarHeight: avatarBox.height,
      avatarLeftInset: avatarBox.left - headerBox.left,
      avatarTopInset: avatarBox.top - headerBox.top,
      avatarWidth: avatarBox.width,
      closeCenterDelta: Math.abs(
        closeBox.top + closeBox.height / 2 - (headerBox.top + headerBox.height / 2),
      ),
      closeHeight: closeBox.height,
      closeWidth: closeBox.width,
      closeHasSvg: Boolean(close.querySelector('svg')),
      closeOutsideDrawer: closeBox.left >= drawerBox.right,
      closeInsideViewport: closeBox.right <= window.innerWidth,
      headerBorderWidth: Number.parseFloat(getComputedStyle(header).borderBottomWidth),
    };
  });
  expect(drawerHeaderGeometry.closeHeight).toBeGreaterThanOrEqual(44);
  expect(drawerHeaderGeometry.closeWidth).toBeGreaterThanOrEqual(44);
  expect(drawerHeaderGeometry.closeCenterDelta).toBeLessThanOrEqual(1);
  expect(drawerHeaderGeometry.closeHasSvg).toBe(true);
  expect(drawerHeaderGeometry.closeOutsideDrawer).toBe(true);
  expect(drawerHeaderGeometry.closeInsideViewport).toBe(true);
  expect(drawerHeaderGeometry.headerBorderWidth).toBeGreaterThanOrEqual(1);
  expect(drawerHeaderGeometry.avatarHeight).toBeGreaterThanOrEqual(64);
  expect(drawerHeaderGeometry.avatarWidth).toBeGreaterThanOrEqual(64);
  expect(drawerHeaderGeometry.avatarCenterDelta).toBeLessThanOrEqual(1);
  expect(drawerHeaderGeometry.avatarLeftInset).toBeGreaterThanOrEqual(20);
  expect(drawerHeaderGeometry.avatarTopInset).toBeGreaterThanOrEqual(20);
  expect(drawerHeaderGeometry.avatarBottomInset).toBeGreaterThanOrEqual(20);
  await expect(drawer.getByText('Sam User')).toBeVisible();
  await expect(drawer.getByText('student@example.com')).toHaveCount(0);
  await expect(drawer.getByRole('link', { name: 'Catalog' })).toHaveAttribute('href', '/');
  await expect(drawer.getByRole('link', { name: 'My learning' })).toHaveAttribute(
    'href',
    '/learning',
  );
  await expect(drawer.getByRole('link', { name: 'AI chat' })).toHaveAttribute('href', '/ai-chat');
  const catalogLink = drawer.getByRole('link', { name: 'Catalog' });
  const assistantLink = drawer.getByRole('link', { name: 'AI chat' });
  const hoverAppearance = async (link: typeof catalogLink) => {
    await link.hover();
    return expect
      .poll(
        () =>
          link.evaluate(async (element) => {
            const read = () => {
              const style = getComputedStyle(element);
              return `${style.backgroundColor}|${style.color}`;
            };
            let appearance = read();
            for (let frame = 0; frame < 3; frame += 1) {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              const nextAppearance = read();
              if (nextAppearance !== appearance) return null;
              appearance = nextAppearance;
            }
            return appearance;
          }),
        { timeout: 1_000 },
      )
      .not.toBeNull()
      .then(async () =>
        link.evaluate((element) => {
          const style = getComputedStyle(element);
          return { backgroundColor: style.backgroundColor, color: style.color };
        }),
      );
  };
  const catalogHover = await hoverAppearance(catalogLink);
  const assistantHover = await hoverAppearance(assistantLink);
  expect(catalogHover).toEqual(assistantHover);
  expect(catalogHover.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  const logout = drawer.getByRole('button', { name: 'Log out' });
  const logoutGeometry = await logout.evaluate((button) => {
    const footer = button.parentElement;
    if (!(footer instanceof HTMLElement)) throw new Error('Tablet drawer footer is missing');
    const buttonBox = button.getBoundingClientRect();
    const footerStyle = getComputedStyle(footer);
    const footerBox = footer.getBoundingClientRect();
    const footerContentLeft = footerBox.left + Number.parseFloat(footerStyle.paddingLeft);
    const footerContentRight = footerBox.right - Number.parseFloat(footerStyle.paddingRight);
    return {
      leftDelta: Math.abs(buttonBox.left - footerContentLeft),
      rightDelta: Math.abs(buttonBox.right - footerContentRight),
      height: buttonBox.height,
    };
  });
  expect(logoutGeometry.leftDelta).toBeLessThanOrEqual(1);
  expect(logoutGeometry.rightDelta).toBeLessThanOrEqual(1);
  expect(logoutGeometry.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(navigationTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps the tablet drawer present through a normal navigation before focusing its destination', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [],
    [CART_STRICT_MODE_ABORT, ENROLLMENTS_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.route('**/courses**', async (route) =>
    route.fulfill({
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
    }),
  );
  await page.setViewportSize({ width: 890, height: 900 });
  await page.goto('/learning');
  await expect(page.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();

  const navigationTrigger = page.getByRole('button', { name: 'Open navigation' });
  await navigationTrigger.click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  const catalog = drawer.getByRole('link', { name: 'Catalog', exact: true });
  await expect(drawer).toBeVisible();
  await expect(catalog).toHaveAttribute('href', '/');

  await catalog.click();
  await expect(page).toHaveURL('/');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps the student Catalog, Search, Cart, and account slots stable across Catalog, My learning, and Cart', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [],
    [
      // React Query may cancel these exact in-flight route-owned reads while this test changes
      // routes. They are optional because a fulfilled request is equally valid; every other
      // failed request, and any excess cancellation, remains a runtime failure.
      CART_STRICT_MODE_ABORT,
      CART_STRICT_MODE_ABORT,
      ENROLLMENTS_STRICT_MODE_ABORT,
      ENROLLMENTS_STRICT_MODE_ABORT,
    ],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.route('**/courses**', async (route) =>
    route.fulfill({
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
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Catalog', exact: true })).toBeVisible();

  const readSlots = () =>
    page.getByRole('banner').evaluate((header) => {
      const read = (selector: string) => {
        const element = header.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing header slot target: ${selector}`);
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        catalog: read('nav[aria-label="Primary navigation"] a[href="/"]'),
        search: read('input[name="search_query"]'),
        cart: read('a[aria-label^="Cart"]'),
        account: read('[data-account-initials]'),
        learningWhiteSpace: getComputedStyle(
          header.querySelector<HTMLElement>('a[href="/learning"]')!,
        ).whiteSpace,
        overflowFree: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });

  const catalogSlots = await readSlots();
  await page.getByRole('link', { name: 'My learning', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
  const learningSlots = await readSlots();

  await page.getByRole('link', { name: /^Cart/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cart' })).toBeVisible();
  const cartSlots = await readSlots();

  expect(learningSlots).toEqual(catalogSlots);
  expect(cartSlots).toEqual(catalogSlots);
  expect(learningSlots.learningWhiteSpace).toBe('nowrap');
  expect(Math.abs(learningSlots.search.width - 544)).toBeLessThanOrEqual(1);
  expect(learningSlots.cart.height).toBeGreaterThanOrEqual(44);
  expect(learningSlots.account.height).toBeGreaterThanOrEqual(44);
  expect(learningSlots.overflowFree).toBe(true);
  assertRuntimeClean();
});

test('applies the accepted desktop header affordances without changing navigation semantics', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [CART_STRICT_MODE_ABORT, ENROLLMENTS_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page, 100);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/learning');

  const catalog = page.getByRole('link', { name: 'Catalog', exact: true });
  const learning = page.getByRole('link', { name: 'My learning', exact: true });
  const assistant = page.getByRole('link', { name: 'Open AI assistant' });
  const cart = page.getByRole('link', { name: 'Cart (99+)' });
  const cartBadge = cart.locator('span');
  await expect(catalog).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await catalog.hover();
  await expect(catalog).toHaveCSS('color', 'rgb(91, 63, 214)');
  await expect(catalog).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(learning).toHaveAttribute('aria-current', 'page');

  await expect(page.getByRole('tooltip', { name: 'AI chat' })).toHaveCount(0);
  await assistant.hover();
  await page.waitForTimeout(300);
  await expect(page.getByRole('tooltip', { name: 'AI chat' })).toHaveCount(0, {
    timeout: 100,
  });
  await page.waitForTimeout(250);
  const tooltip = page.getByRole('tooltip', { name: 'AI chat' });
  await expect(tooltip).toBeVisible();
  expect(await assistant.getAttribute('aria-describedby')).toBe(await tooltip.getAttribute('id'));
  const tooltipGeometry = await tooltip.evaluate((node) => {
    const tip = node.getBoundingClientRect();
    const target = node.parentElement?.getBoundingClientRect();
    if (!target) throw new Error('AI assistant tooltip target is missing.');
    const style = getComputedStyle(node);
    return {
      top: style.top,
      center: tip.left + tip.width / 2 - (target.left + target.width / 2),
      background: style.backgroundColor,
    };
  });
  expect(tooltipGeometry.top).toBe('56px');
  expect(tooltipGeometry.center).toBeCloseTo(0, 1);
  expect(tooltipGeometry.background).toBe('rgb(31, 41, 55)');
  await assistant.focus();
  await page.keyboard.press('Escape');
  await expect(assistant).toBeFocused();
  await expect(tooltip).toHaveCount(0);

  const cartIcon = cart.locator('svg');
  await expect(cart).toHaveCSS('color', 'rgb(17, 24, 39)');
  await expect(cart).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(cart).toHaveCSS('transform', 'none');
  const readCartContainerGeometry = () =>
    cart.evaluate((link) => {
      const badge = link.querySelector('span');
      if (!badge) throw new Error('Cart count badge is unavailable.');
      const rect = (element: Element) => element.getBoundingClientRect().toJSON();
      return {
        link: rect(link),
        badge: rect(badge),
        linkTransform: getComputedStyle(link).transform,
        badgeTransform: getComputedStyle(badge).transform,
      };
    });
  const restContainerGeometry = await readCartContainerGeometry();
  await cart.hover();
  await expect(cart).toHaveCSS('transform', 'none');
  await expect(cartIcon).toHaveCSS('transform', 'matrix(1.08, 0, 0, 1.08, 0, 0)');
  await expect(cartBadge).toHaveCSS('transform', 'none');
  expect(await readCartContainerGeometry()).toEqual(restContainerGeometry);
  await page.mouse.down();
  await expect(cart).toHaveCSS('transform', 'none');
  await expect(cartIcon).toHaveCSS('transform', 'matrix(0.96, 0, 0, 0.96, 0, 0)');
  await expect(cartBadge).toHaveCSS('transform', 'none');
  expect(await readCartContainerGeometry()).toEqual(restContainerGeometry);
  await page.mouse.up();
  await cart.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cart' })).toBeVisible();
  await expect(cart).toHaveCSS('transform', 'none');
  await expect(cartIcon).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(cartBadge).toHaveCSS('transform', 'none');
  expect(await readCartContainerGeometry()).toEqual(restContainerGeometry);
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps Search contained before the accepted Cart-to-Profile desktop group', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [
      { ...ENROLLMENTS_STRICT_MODE_ABORT, occurrences: 6 },
      { ...CART_STRICT_MODE_ABORT, occurrences: 6 },
    ],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);

  for (const width of STUDENT_HEADER_DESKTOP_WIDTHS) {
    await navigateStudentHeaderAtDesktopWidth(page, width);

    const geometry = await readStudentHeaderGeometry(page);
    const learningRight = geometry.learning.x + geometry.learning.width;
    const searchRight = geometry.search.x + geometry.search.width;
    expect(geometry.standardGap).toBeGreaterThan(0);
    expect(geometry.search.x).toBeGreaterThanOrEqual(learningRight + geometry.standardGap - 0.5);
    expect(geometry.cart.x).toBeGreaterThanOrEqual(searchRight + geometry.standardGap - 0.5);
    expect(geometry.account.x).toBeGreaterThanOrEqual(
      geometry.cart.x + geometry.cart.width + geometry.standardGap - 1,
    );
    expect(geometry.search.width).toBeLessThanOrEqual(544);
    expect(geometry.cart.height).toBeGreaterThanOrEqual(44);
    expect(geometry.account.height).toBeGreaterThanOrEqual(44);
    expect(geometry.cartAccountGap).toBeCloseTo(15, 1);
    expect(geometry.learningWhiteSpace).toBe('nowrap');
    expect(geometry.overflowFree).toBe(true);
  }

  assertRuntimeClean();
});

test('waits for the real AppShell brand image before every student-header reload', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [
      { ...ENROLLMENTS_STRICT_MODE_ABORT, occurrences: 6 },
      { ...CART_STRICT_MODE_ABORT, occurrences: 6 },
    ],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);

  let releaseHeldLogo!: () => void;
  const heldLogo = new Promise<void>((resolve) => {
    releaseHeldLogo = resolve;
  });
  let logoRequests = 0;
  const completedWidths: StudentHeaderDesktopWidth[] = [];
  await page.route(`**${APP_SHELL_BRAND_IMAGE_PATH}`, async (route) => {
    logoRequests += 1;
    if (logoRequests === 1) await heldLogo;
    await route.fallback();
  });

  const runSixColdLoads = (async () => {
    for (const width of STUDENT_HEADER_DESKTOP_WIDTHS) {
      await navigateStudentHeaderAtDesktopWidth(page, width);
      completedWidths.push(width);
    }
  })();

  try {
    await expect.poll(() => logoRequests).toBe(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(completedWidths).toEqual([]);

    releaseHeldLogo();
    await runSixColdLoads;
    expect(completedWidths).toEqual(STUDENT_HEADER_DESKTOP_WIDTHS);
  } finally {
    releaseHeldLogo();
    await runSixColdLoads.catch(() => undefined);
  }

  assertRuntimeClean();
});

test('preserves student header geometry when Catalog alone requires a document scrollbar', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [
      { ...CART_STRICT_MODE_ABORT, occurrences: 13 },
      { ...ENROLLMENTS_STRICT_MODE_ABORT, occurrences: 4 },
    ],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.route('**/courses**', async (route) =>
    route.fulfill({
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
    }),
  );
  const gotoCatalog = async () => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 2, name: 'Found 1 course' })).toBeVisible();
  };

  for (const width of [1090, 1100, 1110, 1280] as const) {
    await page.setViewportSize({ width, height: 900 });
    await gotoCatalog();
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.id = 'scrollbar-geometry-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.blockSize = '200vh';
      document.body.append(spacer);
    });
    const tallCatalog = await readStudentHeaderGeometry(page);
    expect(tallCatalog.hasVerticalScrollbar).toBe(true);

    await page.evaluate(() => document.querySelector('#scrollbar-geometry-spacer')?.remove());
    await page.goto('/learning');
    await expect(page.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
    await waitForLearningEmptyStateIllustration(page);
    const shortLearning = await readStudentHeaderGeometry(page);
    expect(shortLearning.hasVerticalScrollbar).toBe(false);

    expect(shortLearning.catalog).toEqual(tallCatalog.catalog);
    expect(shortLearning.search).toEqual(tallCatalog.search);
    expect(shortLearning.cart).toEqual(tallCatalog.cart);
    expect(shortLearning.account).toEqual(tallCatalog.account);
    expect(shortLearning.clientWidth).toBe(tallCatalog.clientWidth);
    expect(shortLearning.learningWhiteSpace).toBe('nowrap');
    expect(shortLearning.overflowFree).toBe(true);

    await gotoCatalog();
    await expect(page.getByRole('link', { name: 'Catalog', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.id = 'scrollbar-geometry-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.blockSize = '200vh';
      document.body.append(spacer);
    });
    const returnedTallCatalog = await readStudentHeaderGeometry(page);
    expect(returnedTallCatalog).toEqual(tallCatalog);
  }

  await page.setViewportSize({ width: 390, height: 720 });
  await gotoCatalog();
  await waitForCatalogMobileHeroBackground(page);
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('composes the student mobile shell with a scroll-away identity row and route-only AI tab', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [{ ...CART_STRICT_MODE_ABORT, occurrences: 6 }],
  );
  await mockAuthenticatedSession(page, 'student');
  await mockStudentWorkspaceData(page);
  await page.route('**/courses**', async (route) =>
    route.fulfill({
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
    }),
  );
  const chatRequestUrls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/chat/') chatRequestUrls.push(request.url());
  });

  for (const width of [320, 390, 618, 767] as const) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(220);

    const profile = page.getByRole('button', { name: 'Account menu for Sam User' });
    const studentNavigation = page.getByRole('navigation', { name: 'Student navigation' });
    const catalog = studentNavigation.getByRole('link', { name: 'Catalog', exact: true });
    const aiChat = studentNavigation.getByRole('link', { name: 'AI chat', exact: true });
    const cart = studentNavigation.getByRole('link', { name: 'Cart (0)', exact: true });
    await expect(profile).toBeVisible();
    await expect(studentNavigation).toBeVisible();
    const controlChrome = await page.evaluate<MobileControlChrome>(() => {
      const search = document.querySelector<HTMLElement>('form[role="search"]');
      const navigation = document.querySelector<HTMLElement>('[aria-label="Student navigation"]');
      if (!search || !navigation) {
        throw new Error('Student mobile control-chrome targets are unavailable.');
      }
      const expectedShadow = document.createElement('div');
      expectedShadow.style.boxShadow = 'var(--shadow-2)';
      document.body.append(expectedShadow);
      const expectedShadowValue = getComputedStyle(expectedShadow).boxShadow;
      expectedShadow.remove();
      const searchStyle = getComputedStyle(search);
      const navigationStyle = getComputedStyle(navigation);
      return {
        searchBackground: searchStyle.backgroundColor,
        searchBorderTop: searchStyle.borderTopColor,
        searchBorderBottom: searchStyle.borderBottomColor,
        searchShadow: searchStyle.boxShadow,
        navigationBackground: navigationStyle.backgroundColor,
        navigationBorderTop: navigationStyle.borderTopColor,
        navigationShadow: navigationStyle.boxShadow,
        expectedShadow: expectedShadowValue,
      };
    });
    const [
      searchBackground,
      searchBorderTop,
      searchBorderBottom,
      navigationBackground,
      navigationBorderTop,
    ] = await Promise.all([
      sampleBrowserColor(page, controlChrome.searchBackground),
      sampleBrowserColor(page, controlChrome.searchBorderTop),
      sampleBrowserColor(page, controlChrome.searchBorderBottom),
      sampleBrowserColor(page, controlChrome.navigationBackground),
      sampleBrowserColor(page, controlChrome.navigationBorderTop),
    ]);
    expect({
      searchBackground,
      searchBorderTop,
      searchBorderBottom,
      searchShadow: controlChrome.searchShadow,
      navigationBackground,
      navigationBorderTop,
      navigationShadow: controlChrome.navigationShadow,
      expectedShadow: controlChrome.expectedShadow,
    }).toEqual({
      searchBackground: { red: 255, green: 255, blue: 255, alpha: 255 },
      searchBorderTop: { red: 0, green: 0, blue: 0, alpha: 0 },
      searchBorderBottom: { red: 0, green: 0, blue: 0, alpha: 0 },
      searchShadow: 'none',
      navigationBackground: { red: 238, green: 240, blue: 244, alpha: 255 },
      navigationBorderTop: { red: 209, green: 213, blue: 219, alpha: 255 },
      navigationShadow: controlChrome.expectedShadow,
      expectedShadow: controlChrome.expectedShadow,
    });
    await expect(catalog).toHaveAttribute('aria-current', 'page');
    await expect(catalog).toHaveCSS('color', 'rgb(91, 63, 214)');
    await expect
      .poll(() => catalog.evaluate((link) => getComputedStyle(link, '::after').width))
      .toBe('20px');
    await expect(aiChat).toHaveAttribute('href', '/ai-chat');
    await expect(cart).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open AI assistant' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Open navigation|Close navigation/ }),
    ).toHaveCount(0);

    await profile.click();
    const accountDetails = page.getByRole('group', { name: 'Account details for Sam User' });
    await expect(accountDetails).toBeVisible();
    const menuRect = await accountDetails.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    expect(menuRect.x).toBeGreaterThanOrEqual(0);
    expect(menuRect.right).toBeLessThanOrEqual(width);
    const accountMenuLayer = await page.evaluate(() => {
      const accountMenu =
        document.querySelector<HTMLElement>('[data-account-initials]')?.parentElement;
      const search = document.querySelector<HTMLElement>('form[role="search"]');
      if (!accountMenu || !search)
        throw new Error('Student mobile overlay targets are unavailable.');
      return {
        accountMenu: Number(getComputedStyle(accountMenu).zIndex),
        search: Number(getComputedStyle(search).zIndex),
      };
    });
    expect(accountMenuLayer.accountMenu).toBeGreaterThan(accountMenuLayer.search);

    const scrollGeometry = await page.evaluate(async () => {
      const profileElement = document.querySelector<HTMLElement>('[data-account-initials]');
      const searchElement = document.querySelector<HTMLElement>('form[role="search"]');
      if (!profileElement || !searchElement)
        throw new Error('Student mobile shell targets are unavailable.');
      window.scrollTo({ top: 320 });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        profileBottom: profileElement.getBoundingClientRect().bottom,
        searchTop: searchElement.getBoundingClientRect().top,
        searchBackground: getComputedStyle(searchElement).backgroundColor,
        searchBorderTop: getComputedStyle(searchElement).borderTopColor,
        searchBorderBottom: getComputedStyle(searchElement).borderBottomColor,
        searchShadow: getComputedStyle(searchElement).boxShadow,
      };
    });
    expect(scrollGeometry.profileBottom).toBeLessThanOrEqual(0);
    expect(scrollGeometry.searchTop).toBeCloseTo(0, 1);
    expect(scrollGeometry.searchBackground).toBe('rgb(238, 240, 244)');
    expect(scrollGeometry.searchBorderTop).toBe('rgb(209, 213, 219)');
    expect(scrollGeometry.searchBorderBottom).toBe('rgb(209, 213, 219)');
    expect(scrollGeometry.searchShadow).toBe(controlChrome.expectedShadow);
    await expect(accountDetails).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const terminalGeometry = await page.evaluate(async () => {
      const main = document.querySelector<HTMLElement>('main');
      const footer = document.querySelector<HTMLElement>('main + footer');
      const navigation = document.querySelector<HTMLElement>('[aria-label="Student navigation"]');
      if (!footer || !main || !navigation) {
        throw new Error('Student mobile terminal targets are unavailable.');
      }
      footer.scrollIntoView({ block: 'end' });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        footerBottom: footer.getBoundingClientRect().bottom,
        navigationTop: navigation.getBoundingClientRect().top,
        paddingBottom: getComputedStyle(footer).paddingBottom,
        terminalContentBottom: Math.max(
          ...Array.from(footer.children, (child) => child.getBoundingClientRect().bottom),
        ),
      };
    });
    expect(terminalGeometry.paddingBottom).toBe('96px');
    expect(terminalGeometry.footerBottom).toBeGreaterThan(terminalGeometry.navigationTop);
    expect(terminalGeometry.terminalContentBottom).toBeLessThanOrEqual(
      terminalGeometry.navigationTop,
    );

    const studentLinks = [
      catalog,
      studentNavigation.getByRole('link', { name: 'My learning' }),
      aiChat,
      cart,
    ];
    for (const [index, link] of studentLinks.entries()) {
      await link.focus();
      await expect(link).toBeFocused();
      if (index < studentLinks.length - 1) {
        await page.keyboard.press('Tab');
        await expect(studentLinks[index + 1]).toBeFocused();
      }
    }

    await aiChat.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/ai-chat');
    await page.locator('[data-part="ai-chat-hero-image"]').evaluate(async (image) => {
      if (!(image instanceof HTMLImageElement))
        throw new Error('AI chat hero image is unavailable');
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => reject(new Error('AI chat hero image failed')), {
            once: true,
          });
        });
      }
      if (image.naturalWidth === 0) throw new Error('AI chat hero image failed');
    });

    expect(chatRequestUrls).toEqual([]);
  }

  await page.setViewportSize({ width: 768, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Student navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account menu for Sam User' })).toHaveCount(0);
  const tabletNavigationTrigger = page.getByRole('button', { name: 'Open navigation' });
  await tabletNavigationTrigger.click();
  const tabletDrawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(tabletDrawer).toBeVisible();
  await expect(tabletDrawer.getByText('Sam User')).toBeVisible();
  await expect(tabletDrawer.getByRole('button', { name: 'Log out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tabletDrawer).toHaveCount(0);
  await expect(tabletNavigationTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);

  // A 195px CSS viewport models 390px at browser page zoom 200%; applying CSS zoom to
  // documentElement does not update the viewport media queries that drive mobile reflow.
  await page.setViewportSize({ width: 195, height: 360 });
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Search courses' })
    .fill('Responsive search content '.repeat(12));
  const compactProfile = page.getByRole('button', { name: 'Account menu for Sam User' });
  const compactAccountDetails = page.getByRole('group', {
    name: 'Account details for Sam User',
  });
  await compactProfile.click();
  await expect(compactAccountDetails).toBeVisible();
  const compactMenuRect = await compactAccountDetails.evaluate((element) =>
    element.getBoundingClientRect().toJSON(),
  );
  expect(compactMenuRect.x).toBeGreaterThanOrEqual(0);
  expect(compactMenuRect.right).toBeLessThanOrEqual(195);
  expect(compactMenuRect.y).toBeGreaterThanOrEqual(0);
  expect(compactMenuRect.bottom).toBeLessThanOrEqual(360);

  const compactTerminalGeometry = await page.evaluate(async () => {
    const footer = document.querySelector<HTMLElement>('main + footer');
    const navigation = document.querySelector<HTMLElement>('[aria-label="Student navigation"]');
    if (!footer || !navigation) {
      throw new Error('Compact effective-200% terminal targets are unavailable.');
    }
    footer.scrollIntoView({ block: 'end' });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      footerBottom: footer.getBoundingClientRect().bottom,
      navigationTop: navigation.getBoundingClientRect().top,
      terminalContentBottom: Math.max(
        ...Array.from(footer.children, (child) => child.getBoundingClientRect().bottom),
      ),
    };
  });
  expect(compactTerminalGeometry.footerBottom).toBeGreaterThan(
    compactTerminalGeometry.navigationTop,
  );
  expect(compactTerminalGeometry.terminalContentBottom).toBeLessThanOrEqual(
    compactTerminalGeometry.navigationTop,
  );

  await page.keyboard.press('Escape');
  await expect(compactProfile).toBeFocused();
  const compactStudentNavigation = page.getByRole('navigation', { name: 'Student navigation' });
  const compactStudentLinks = [
    compactStudentNavigation.getByRole('link', { name: 'Catalog', exact: true }),
    compactStudentNavigation.getByRole('link', { name: 'My learning' }),
    compactStudentNavigation.getByRole('link', { name: 'AI chat', exact: true }),
    compactStudentNavigation.getByRole('link', { name: 'Cart (0)', exact: true }),
  ];
  for (const [index, link] of compactStudentLinks.entries()) {
    await link.focus();
    await expect(link).toBeFocused();
    if (index < compactStudentLinks.length - 1) {
      await page.keyboard.press('Tab');
      await expect(compactStudentLinks[index + 1]).toBeFocused();
    }
  }
  await expectNoHorizontalOverflow(page);

  assertRuntimeClean();
});

test('rejects malformed successful session data without authenticating or clearing it as a 401', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.addInitScript(() =>
    localStorage.setItem('learnhub.access-token', 'potentially-valid-token'),
  );
  await page.route('**/me', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ role: 'student' }),
    }),
  );
  await page.goto('/learning');
  await expect(page.getByRole('heading', { level: 1, name: 'Session check failed' })).toBeVisible();
  await expect(page.getByText(/student/)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('learnhub.access-token'))).toBe(
    'potentially-valid-token',
  );
  await expect(page).toHaveTitle('Session check failed | LearnHub');
  assertRuntimeClean();
});

test('keeps public desktop auth actions at the header end after a recoverable session check failure', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page, [{ method: 'GET', path: '/me', status: 503 }]);
  await installCatalogFixture(page);
  await page.addInitScript(() => localStorage.setItem('learnhub.access-token', 'retry-token'));
  await page.route('**/me', async (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Service unavailable' }),
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' }),
  ).toBeVisible();
  const accountNavigation = page.getByRole('navigation', { name: 'Account navigation' });
  const login = accountNavigation.getByRole('link', { name: 'Log in' });
  const signup = accountNavigation.getByRole('link', { name: 'Sign up' });
  await expect(login).toBeVisible();
  await expect(signup).toBeVisible();
  expect(await accountNavigation.locator('a').allTextContents()).toEqual(['Log in', 'Sign up']);

  const headerGeometry = await page.locator('[data-app-shell-header]').evaluate((header) => {
    const inner = header.firstElementChild;
    const accountNavigation = header.querySelector<HTMLElement>(
      '[aria-label="Account navigation"]',
    );
    const signup = Array.from(header.querySelectorAll<HTMLAnchorElement>('a')).find(
      (link) => link.textContent?.trim() === 'Sign up',
    );
    const language = header.querySelector<HTMLButtonElement>(
      'button[aria-label="Change language"]',
    );
    if (!(inner instanceof HTMLElement) || !accountNavigation || !signup || !language)
      throw new Error('Public header geometry targets are unavailable.');
    const innerRect = inner.getBoundingClientRect();
    const accountRect = accountNavigation.getBoundingClientRect();
    const loginRect = Array.from(header.querySelectorAll<HTMLAnchorElement>('a'))
      .find((link) => link.textContent?.trim() === 'Log in')
      ?.getBoundingClientRect();
    const signupRect = signup.getBoundingClientRect();
    const languageRect = language.getBoundingClientRect();
    if (!loginRect) throw new Error('Public header Log in geometry target is unavailable.');
    return {
      accountLeft: accountRect.left,
      innerCenter: innerRect.left + innerRect.width / 2,
      innerRight: innerRect.right,
      loginRight: loginRect.right,
      signupRight: signupRect.right,
      languageLeft: languageRect.left,
      languageRight: languageRect.right,
      languageHeight: languageRect.height,
    };
  });
  expect(headerGeometry.accountLeft).toBeGreaterThan(headerGeometry.innerCenter);
  expect(headerGeometry.loginRight).toBeLessThanOrEqual(headerGeometry.signupRight);
  expect(headerGeometry.signupRight).toBeLessThanOrEqual(headerGeometry.languageLeft);
  expect(headerGeometry.innerRight - headerGeometry.languageRight).toBeLessThanOrEqual(24.5);
  expect(headerGeometry.languageHeight).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps Router metadata, layout, density, and titles aligned for a case/trailing parameter route', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await mockAuthenticatedSession(page, 'instructor');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/instructor/COURSES/ABC/edit/');
  await expect(page.getByRole('heading', { level: 1, name: 'Edit course' })).toBeVisible();
  await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', 'workspace');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'workspace');
  await expect(page).toHaveTitle('Edit course | LearnHub');
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByRole('heading', { level: 1, name: 'Edit course' })).toBeVisible();
  await page.getByRole('link', { name: 'Skip to main content' }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expectMobileMenuGeometry(page);
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps wrong-role content hidden behind an accessible forbidden state', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [],
    [INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await page.goto('/cart');
  await expect(
    page.getByRole('heading', { level: 1, name: 'You do not have access to this page' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Cart' })).toHaveCount(0);
  const catalogLink = page.getByRole('link', { name: 'Back to catalog' });
  await expect(catalogLink).toHaveAttribute('href', '/');

  for (const width of [320, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(catalogLink).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  await expect(catalogLink).toHaveCSS('color', 'rgb(75, 50, 181)');
  await expect(catalogLink).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(catalogLink).toHaveCSS('border-top-width', '0px');
  await expect(catalogLink).toHaveCSS('text-decoration-line', 'none');
  expect(
    await catalogLink.evaluate((link) => {
      const card = link.parentElement;
      if (!(card instanceof HTMLElement)) throw new Error('Forbidden card is unavailable.');
      const linkRect = link.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return Math.abs(linkRect.left + linkRect.width / 2 - (cardRect.left + cardRect.width / 2));
    }),
  ).toBeLessThanOrEqual(0.5);
  await catalogLink.hover();
  await expect(catalogLink).toHaveCSS('text-decoration-line', 'underline');
  await expect(catalogLink).toHaveCSS('text-decoration-thickness', '1px');
  await catalogLink.focus();
  await expect(catalogLink).toBeFocused();
  await expect(catalogLink).toHaveCSS('outline-width', '2px');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '200%';
  });
  await expect(catalogLink).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });

  await Promise.all([collectionFixture.waitForFulfillment(), catalogLink.click()]);
  await expect(page).toHaveURL('/instructor/courses');
  assertRuntimeClean();
});

test('clears an invalid stored bearer when /me rejects it', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(page, [{ method: 'GET', path: '/me', status: 401 }]);
  await page.addInitScript(() => localStorage.setItem('learnhub.access-token', 'expired-token'));
  await page.route('**/me', async (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Expired token' }),
    }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Master the Skills Shaping the Future' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Found 1 course' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Account navigation' })
      .getByRole('link', { name: 'Log in', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('learnhub.access-token'))).toBe(null);
  assertRuntimeClean();
});

test('announces a recoverable session error and retries /me', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [{ method: 'GET', path: '/me', status: 503 }],
    [],
    [CART_STRICT_MODE_ABORT, ENROLLMENTS_STRICT_MODE_ABORT],
  );
  await mockStudentWorkspaceData(page);
  await page.addInitScript(() => localStorage.setItem('learnhub.access-token', 'retry-token'));
  let attempts = 0;
  await page.route('**/me', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Service unavailable' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'student@example.com',
        name: 'Sam',
        surname: 'User',
        role: 'student',
        birthday: null,
        phone_number: null,
        created_at: '2026-07-20T00:00:00Z',
      }),
    });
  });
  await page.goto('/learning');
  await expect(page.getByRole('heading', { level: 1, name: 'Session check failed' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'We could not verify your session. Check your connection and try again.',
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
  expect(attempts).toBe(2);
  assertRuntimeClean();
});

test('supports keyboard-operated mobile navigation and focus restoration', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [],
    [INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT],
  );
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await Promise.all([
    collectionFixture.waitForFulfillment(),
    page.goto('/instructor/courses#mobile-menu-focus'),
  ]);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Instructor courses', includeHidden: true }),
  ).toHaveCount(1);
  await expectBrandComposition(page.getByRole('link', { name: 'LearnHub home' }));
  await expect(page.getByRole('button', { name: 'Change language' })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await expectMenuAtHeaderInlineStart(page);
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expectMobileMenuGeometry(page);

  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: 'Instructor courses' }).last().focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();

  await page.keyboard.press('Enter');
  const currentRouteLink = page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Instructor courses' });
  await expect(currentRouteLink).toHaveAttribute('aria-current', 'page');
  await currentRouteLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expect(page).toHaveURL(/\/instructor\/courses$/);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 740 });
  await expectBrandComposition(page.getByRole('link', { name: 'LearnHub home' }));
  await expect(page.getByRole('button', { name: 'Change language' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await expectMenuAtHeaderInlineStart(page);
  await expectMobileMenuGeometry(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  assertRuntimeClean();
});

test('preserves the source mobile menu and focus for modified and new-tab activation', async ({
  page,
  context,
}) => {
  const popupFixture = await mockInstructorPopupPages(context, page);
  await mockAuthenticatedSession(page, 'instructor');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/instructor/courses/42/edit');
  await expect(page.getByRole('heading', { level: 2, name: 'Course details' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Course title' })).toHaveValue('Editor course');
  const originalUrl = page.url();
  const menu = page.getByRole('button', { name: 'Open navigation' });

  async function openAndFocusInstructorCourses() {
    if ((await page.getByRole('navigation', { name: 'Mobile navigation' }).count()) === 0) {
      await menu.click();
    }
    const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(navigation).toBeVisible();
    const link = navigation.getByRole('link', { name: 'Instructor courses' });
    await link.focus();
    await expect(link).toBeFocused();
    return { navigation, link };
  }

  const control = await openAndFocusInstructorCourses();
  const controlPopupPromise = context.waitForEvent('page');
  await control.link.click({ modifiers: ['Control'] });
  const controlPopup = await controlPopupPromise;
  const assertControlPopupRuntimeClean = monitorRuntime(
    controlPopup,
    [],
    [INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT],
  );
  await controlPopup.waitForURL(/\/instructor\/courses(?:[?#]|$)/);
  await expect(controlPopup.getByRole('heading', { level: 2, name: 'Your courses' })).toBeFocused();
  await expect(controlPopup.getByText('You have not created any courses yet.')).toBeVisible();
  expect(new URL(controlPopup.url()).pathname).toBe('/instructor/courses');
  expect(page.url()).toBe(originalUrl);
  await expect(control.navigation).toBeVisible();
  await expect(control.link).toBeFocused();
  await controlPopup.close();
  assertControlPopupRuntimeClean();

  const meta = await openAndFocusInstructorCourses();
  const metaDefaultAllowed = await meta.link.evaluate((element) => {
    let defaultPreventedByApplication = true;
    const observeThenCancelNavigation = (event: MouseEvent) => {
      defaultPreventedByApplication = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', observeThenCancelNavigation, { once: true });
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    element.dispatchEvent(event);
    return !defaultPreventedByApplication;
  });
  expect(metaDefaultAllowed).toBe(true);
  expect(page.url()).toBe(originalUrl);
  await expect(meta.navigation).toBeVisible();
  await expect(meta.link).toBeFocused();

  const middle = await openAndFocusInstructorCourses();
  const middlePopupPromise = context.waitForEvent('page');
  await middle.link.click({ button: 'middle' });
  const middlePopup = await middlePopupPromise;
  const assertMiddlePopupRuntimeClean = monitorRuntime(
    middlePopup,
    [],
    [INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT],
  );
  await middlePopup.waitForURL(/\/instructor\/courses(?:[?#]|$)/);
  await expect(middlePopup.getByRole('heading', { level: 2, name: 'Your courses' })).toBeFocused();
  await expect(middlePopup.getByText('You have not created any courses yet.')).toBeVisible();
  expect(new URL(middlePopup.url()).pathname).toBe('/instructor/courses');
  expect(page.url()).toBe(originalUrl);
  await expect(middle.navigation).toBeVisible();
  await expect(middle.link).toBeFocused();
  await middlePopup.close();
  assertMiddlePopupRuntimeClean();

  const ordinary = await openAndFocusInstructorCourses();
  const sourceCollectionRequest = popupFixture.waitForSourceCollectionRequest();
  await ordinary.link.click();
  await sourceCollectionRequest;
  await expect(page).toHaveURL(/\/instructor\/courses$/);
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
  popupFixture.releaseSourceCollection();
  await expect(page.getByText('You have not created any courses yet.')).toBeVisible();
  const assertRuntimeClean = monitorRuntime(page);
  await expect(page).toHaveTitle('Instructor courses | LearnHub');
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('renders the not-found route at mobile width without overflow', async ({ page }) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.addInitScript(() => localStorage.setItem('learnhub.locale', 'ru'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/missing-page');
  await expect(page.getByRole('heading', { level: 1, name: 'Страница не найдена' })).toBeVisible();
  await expect(page).toHaveTitle('Страница не найдена | LearnHub');
  await expect(page.getByRole('link', { name: 'Перейти к основному содержимому' })).toHaveAttribute(
    'href',
    '#main-content',
  );
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps focused skip navigation above sticky search chrome and below the dialog modal tier', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.addInitScript(() => {
    localStorage.setItem('learnhub.catalog-search-history', JSON.stringify(['React testing']));
  });
  await installCatalogFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const search = page.getByRole('combobox', { name: 'Search courses' });
  const searchListbox = page.getByRole('listbox', { name: 'Recent searches' });
  await search.focus();
  await expect(searchListbox).toBeVisible();
  const dropdownLayers = await page.evaluate(() => {
    const header = document.querySelector('[data-app-shell-header]');
    const listbox = document.querySelector('[role="listbox"]');
    if (!(header instanceof HTMLElement) || !(listbox instanceof HTMLElement)) {
      throw new Error('Open search layering targets are unavailable');
    }
    return {
      header: getComputedStyle(header).zIndex,
      searchListbox: getComputedStyle(listbox).zIndex,
    };
  });
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(searchListbox).toHaveCount(0);
  await expect
    .poll(async () => {
      const box = await skipLink.boundingBox();
      return box !== null && box.y + box.height > 0;
    })
    .toBe(true);

  const focusedSkipLayers = await page.evaluate(() => {
    const skip = document.querySelector('a[href="#main-content"]');
    if (!(skip instanceof HTMLElement)) {
      throw new Error('Focused skip-link layering target is unavailable');
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const skipRect = skip.getBoundingClientRect();
    return {
      skip: getComputedStyle(skip).zIndex,
      modal: rootStyle.getPropertyValue('--z-modal').trim(),
      skipVisible: skipRect.bottom > 0 && skipRect.top < window.innerHeight,
    };
  });

  expect(dropdownLayers).toEqual({
    header: zIndexTokens['--z-sticky'],
    searchListbox: zIndexTokens['--z-dropdown'],
  });
  expect(focusedSkipLayers).toEqual({
    skip: zIndexTokens['--z-accessibility'],
    // Dialog's portalled backdrop consumes this modal tier.
    modal: zIndexTokens['--z-modal'],
    skipVisible: true,
  });
  expect(Number(dropdownLayers.searchListbox)).toBeLessThan(Number(dropdownLayers.header));
  expect(Number(dropdownLayers.header)).toBeLessThan(Number(focusedSkipLayers.skip));
  expect(Number(focusedSkipLayers.skip)).toBeLessThan(Number(focusedSkipLayers.modal));
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('keeps catalog search history Enter, pointer, and touch selection focus-safe and canonical', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.addInitScript(() => {
    localStorage.setItem('learnhub.catalog-search-history', JSON.stringify(['React', 'Redux']));
  });
  await installCatalogFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?sort=-price&page=2');

  const search = page.getByRole('combobox', { name: 'Search courses' });
  await search.focus();
  await search.fill('rea');
  const filteredHistory = page.getByRole('listbox', { name: 'Recent searches' });
  await expect(filteredHistory.getByRole('option')).toHaveCount(1);
  await expect(filteredHistory.getByRole('option', { name: 'React' })).toBeVisible();
  await expect(filteredHistory.getByRole('option', { name: 'Redux' })).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  const react = page.getByRole('option', { name: 'React' });
  const reactOptionId = await react.getAttribute('id');
  expect(reactOptionId).not.toBeNull();
  if (reactOptionId === null) throw new Error('React history option must have an id');
  await expect(search).toHaveAttribute('aria-activedescendant', reactOptionId);
  await expect(react).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/?search_query=React&sort=-price');
  await expect(search).toBeFocused();
  const retainedHistory = page.getByRole('listbox', { name: 'Recent searches' });
  await expect(retainedHistory).toBeVisible();
  await expect(retainedHistory.getByRole('option')).toHaveCount(2);
  await expect(search).not.toHaveAttribute('aria-activedescendant', /.+/);

  const redux = page.getByRole('option', { name: 'Redux' });
  await redux.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await redux.dispatchEvent('click');
  await expect(page).toHaveURL('/?search_query=Redux&sort=-price');
  await expect(search).toBeFocused();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('removes non-essential shell transitions when reduced motion is requested', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/');

  const transitions = await page.evaluate(() => {
    const skipLink = document.querySelector('a[href="#main-content"]');
    const navigationLink = document.querySelector('nav[aria-label="Primary navigation"] a');
    if (!(skipLink instanceof HTMLElement) || !(navigationLink instanceof HTMLElement)) {
      throw new Error('Reduced-motion shell targets are unavailable');
    }
    return {
      skipLink: getComputedStyle(skipLink).transitionDuration,
      navigationLink: getComputedStyle(navigationLink).transitionDuration,
    };
  });
  expect(transitions).toEqual({ skipLink: '0s', navigationLink: '0s' });
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});

test('redirects an Instructor from the Catalog root to Instructor courses', async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on('request', (request) => requestedPaths.push(new URL(request.url()).pathname));
  await mockAuthenticatedSession(page, 'instructor');
  const collectionFixture = await mockInstructorCourseCollection(page);
  const collectionLoaded = collectionFixture.waitForFulfillment();

  await page.goto('/?search_query=React#catalog');
  await expect(page).toHaveURL('/instructor/courses');
  await collectionLoaded;
  await expect(page.locator('[data-part="catalog-page"]')).toHaveCount(0);
  expect(requestedPaths).not.toContain('/courses');
  await expectNoHorizontalOverflow(page);
});

test('keeps instructor course-management content readable without student destinations', async ({
  page,
}) => {
  const assertRuntimeClean = monitorRuntime(
    page,
    [{ method: 'GET', path: '/courses/8/enrollments?page=1&page_size=20', status: 403 }],
    [
      {
        method: 'GET',
        path: '/courses/7/enrollments?page=1&page_size=20',
        errorText: 'net::ERR_ABORTED',
        occurrences: 6,
      },
      { ...INSTRUCTOR_COURSE_COLLECTION_STRICT_MODE_ABORT, occurrences: 7 },
      {
        method: 'GET',
        path: '/courses/8/enrollments?page=1&page_size=20',
        errorText: 'net::ERR_ABORTED',
      },
    ],
  );
  await mockAuthenticatedSession(page, 'instructor');
  await mockInstructorCourseCollection(page);
  const longName = `Ada-${'LongName'.repeat(20)}`;
  const longEmail = `${'very-long-address.'.repeat(12)}example.test`;
  await page.route(/\/courses\/[78]\/enrollments\?page=1&page_size=20$/, async (route) => {
    if (route.request().url().includes('/courses/8/enrollments')) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Forbidden' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 9,
            user_id: 12,
            course_id: 7,
            status: 'active',
            created_at: '2026-07-30T00:00:00Z',
            updated_at: '2026-07-30T01:00:00Z',
            user: { id: 12, name: longName, surname: 'Student', email: longEmail },
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
        pages: 1,
        has_next: false,
        has_previous: false,
      }),
    });
  });
  await page.route(/\/courses$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        instructor_id: 3,
        title: 'An instructor course',
        description: null,
        price: '0.00',
        currency: 'USD',
        published_at: null,
        created_at: '2026-08-04T00:00:00Z',
        updated_at: '2026-08-04T00:00:00Z',
      }),
    });
  });

  for (const width of [320, 768, 1023, 1024] as const) {
    await page.setViewportSize({ width, height: 844 });
    if (new URL(page.url()).pathname === '/instructor/courses')
      await waitForInstructorCoursesBackgroundAssets(page);
    await page.goto('/instructor/courses');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Instructor courses', includeHidden: true }),
    ).toHaveCount(1);
    await expect(page.locator('[data-part="instructor-courses-hero"]')).toHaveCount(0);
    const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
    const navigationTrigger = page.getByRole('button', { name: 'Open navigation' });
    if (width >= 768 && width <= 1023) {
      await expect(primaryNavigation).toBeHidden();
      await expect(navigationTrigger).toBeVisible();
      await expect(
        page.getByRole('banner').getByRole('button', { name: 'Account menu for Indira User' }),
      ).toBeVisible();
      await expect(
        page.getByRole('banner').getByRole('button', { name: 'Change language' }),
      ).toBeVisible();
      await expect(page.getByRole('banner').getByRole('link', { name: /^Cart/ })).toHaveCount(0);
      if (width === 768) {
        await navigationTrigger.click();
        const drawer = page.getByRole('dialog', { name: 'Menu' });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByText('Indira User')).toBeVisible();
        await expect(drawer.getByText('instructor@example.com')).toHaveCount(0);
        await expect(drawer.getByRole('link', { name: 'Instructor courses' })).toHaveAttribute(
          'href',
          '/instructor/courses',
        );
        await expect(drawer.getByRole('link', { name: 'AI chat' })).toHaveCount(0);
        await expect(drawer.getByRole('button', { name: 'Create course' })).toBeVisible();
        await expect(drawer.getByRole('button', { name: 'Log out' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
        await expect(navigationTrigger).toBeFocused();
      }
    } else if (width >= 1024) {
      await expect(primaryNavigation).toBeVisible();
      await expect(navigationTrigger).toBeHidden();
    }
    await expectNoHorizontalOverflow(page);
    await waitForInstructorCoursesBackgroundAssets(page);
  }

  await page.setViewportSize({ width: 1024, height: 844 });
  await waitForInstructorCoursesBackgroundAssets(page);
  await page.goto('/instructor/courses?source=header#creation');
  await waitForInstructorCoursesBackgroundAssets(page);
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const instructorCourses = primaryNavigation.getByRole('link', { name: 'Instructor courses' });
  const headerCreate = page
    .getByRole('banner')
    .getByRole('button', { name: 'Create course', exact: true });
  const profile = page.getByRole('button', { name: 'Account menu for Indira User' });
  const createRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/courses' && request.method() === 'POST') {
      createRequests.push(request.url());
    }
  });
  await expect(instructorCourses).toHaveAttribute('href', '/instructor/courses');
  await expect(instructorCourses).toHaveAttribute('aria-current', 'page');
  await expect(headerCreate).toHaveAttribute('type', 'button');
  await expect(headerCreate).toHaveClass(/navAction/);
  const [headerCreateBox, profileBox] = await Promise.all([
    headerCreate.boundingBox(),
    profile.boundingBox(),
  ]);
  expect(headerCreateBox).not.toBeNull();
  expect(profileBox).not.toBeNull();
  expect(headerCreateBox!.x + headerCreateBox!.width).toBeLessThanOrEqual(profileBox!.x);
  await headerCreate.press('Enter');
  const courseTitle = page.getByRole('textbox', { name: 'Course title' });
  await expect(courseTitle).toBeFocused();
  await expect(page).toHaveURL('/instructor/courses?source=header#creation');
  expect(createRequests).toEqual([]);

  await courseTitle.fill('Unsubmitted course title');
  const historyLengthBeforeSpace = await page.evaluate(() => window.history.length);
  await headerCreate.focus();
  await page.keyboard.press('Space');
  await expect(courseTitle).toBeFocused();
  await expect(courseTitle).toHaveValue('Unsubmitted course title');
  await expect(page).toHaveURL('/instructor/courses?source=header#creation');
  expect(await page.evaluate(() => window.history.length)).toBe(historyLengthBeforeSpace);
  expect(createRequests).toEqual([]);
  await expectNoHorizontalOverflow(page);

  for (const width of [320, 390, 768, 1280] as const) {
    await page.setViewportSize({ width, height: 844 });
    if (new URL(page.url()).pathname === '/instructor/courses')
      await waitForInstructorCoursesBackgroundAssets(page);
    await page.goto('/instructor/courses/7/enrollments');
    await expect(page.getByRole('heading', { level: 1, name: 'Course enrollments' })).toBeVisible();
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    const returnLink = breadcrumb.getByRole('link', { name: 'Instructor courses' });
    await expect(returnLink).toHaveAttribute('href', '/instructor/courses');
    await expect(returnLink).toBeVisible();
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Course enrollments');
    expect(
      await returnLink.evaluate((link) => link.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(longName)).toBeVisible();
    await expect(page.getByText(longEmail)).toBeVisible();
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => {
        const canvas = document.querySelector('article');
        const footer = document.querySelector('footer');
        if (!canvas || !footer) throw new Error('Expected Instructor canvas and footer.');
        return canvas.getBoundingClientRect().bottom - footer.getBoundingClientRect().top;
      }),
    ).toBeGreaterThanOrEqual(-1);
    await expect(page.getByRole('link', { name: 'Cart' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open AI assistant' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Student navigation' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/instructor/courses/7/enrollments');
  const rosterHeading = page.getByRole('heading', { level: 1, name: 'Course enrollments' });
  const rosterBreadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const rosterReturnLink = rosterBreadcrumb.getByRole('link', { name: 'Instructor courses' });
  await expect(rosterHeading).toBeVisible();
  await expect(rosterBreadcrumb).toBeVisible();
  await expect(rosterReturnLink).toBeVisible();
  await expect(page.getByText(longName)).toBeVisible();
  await rosterReturnLink.focus();
  await expect(rosterReturnLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/instructor/courses');
  const instructorCoursesHeading = page.getByRole('heading', {
    level: 1,
    name: 'Instructor courses',
    includeHidden: true,
  });
  await expect(instructorCoursesHeading).toBeVisible();
  await waitForInstructorCoursesBackgroundAssets(page);

  await page.setViewportSize({ width: 320, height: 844 });
  await waitForInstructorCoursesBackgroundAssets(page);
  await page.goto('/instructor/courses');
  const compactNavigationTrigger = page.getByRole('button', { name: 'Open navigation' });
  await compactNavigationTrigger.click();
  await page
    .getByRole('dialog', { name: 'Menu' })
    .getByRole('button', { name: 'Create course' })
    .click();
  const create = page
    .getByRole('region', { name: 'Create course' })
    .getByRole('button', { name: 'Create course', exact: true });
  await expect(create).toBeVisible();
  await waitForInstructorCoursesBackgroundAssets(page);
  await page.getByRole('textbox', { name: 'Course title' }).fill('An instructor course');
  const createHeight = await create.evaluate((button) => button.getBoundingClientRect().height);
  await create.click();
  const courseActions = page.getByRole('navigation', { name: 'New course actions' });
  await expect(courseActions).toBeVisible();
  const successHeight = await courseActions
    .getByRole('link', { name: 'Edit course' })
    .evaluate((link) => link.getBoundingClientRect().height);
  expect(createHeight).toBeGreaterThanOrEqual(44);
  expect(successHeight).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1280, height: 844 });
  await waitForInstructorCoursesBackgroundAssets(page);
  await page.goto('/instructor/courses/7/enrollments');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Instructor courses' })
      .evaluate((link) => link.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await expect(page.getByText(longEmail)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/instructor/courses/8/enrollments');
  await expect(
    page.getByText('You do not have permission to view these enrollments.'),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  assertRuntimeClean();
});
