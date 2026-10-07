import { type Page, type Request, type Response, type Route } from '@playwright/test';

const student = {
  email: 'student@example.test',
  name: 'Sam',
  surname: 'Student',
  role: 'student',
  birthday: null,
  phone_number: null,
  created_at: '2026-01-01T00:00:00Z',
};

export interface CartApiRequest {
  readonly method: string;
  readonly pathname: string;
}

export type CartApiRouteHandler = (route: Route, request: CartApiRequest) => Promise<void>;

export type CartD03Scenario =
  | 'clear-success'
  | 'clear-pending'
  | 'admitted-surface'
  | 'localized-return-mutations';

interface CartD03Course {
  readonly id: number;
  readonly title: string;
  readonly price: string;
  readonly currency: string;
}

interface CartD03Item {
  readonly id: number;
  readonly course_id: number;
  readonly added_at: string;
  readonly course: CartD03Course;
}

interface CartD03Response {
  readonly id: number;
  readonly items: readonly CartD03Item[];
  readonly total_price: string;
  readonly currency: string;
  readonly item_count: number;
}

export interface CartD03Controller {
  readonly scenario: CartD03Scenario;
  completePendingClear(): void;
  getClearRequestCount(): number;
  install(): Promise<void>;
  navigateToCart(): Promise<void>;
}

export interface CartD03ControllerOptions {
  readonly returnTo?: string;
}

type CartNavigationAction = () => Promise<unknown>;

const cartReadySurface = 'article[aria-busy]';

export const cartAdmissionItem: CartD03Item = {
  id: 10,
  course_id: 7,
  added_at: '2026-01-01T00:00:00Z',
  course: {
    id: 7,
    title:
      'A deliberately long cart course title that must remain operable at every required viewport width',
    price: '19.990',
    currency: 'USD',
  },
};

function cartD03Response(items: readonly CartD03Item[] = [cartAdmissionItem]): CartD03Response {
  return {
    id: 1,
    items,
    total_price: items.length === 0 ? '0.00' : '1000000000000000000000019.0001',
    currency: 'USD',
    item_count: items.length,
  };
}

export async function fulfillCartJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function installCartStudent(page: Page) {
  await page.addInitScript(() => localStorage.setItem('learnhub.access-token', 'student-token'));
}

export function isCartApiPath(pathname: string): boolean {
  return pathname === '/cart' || pathname.startsWith('/cart/');
}

export function isSuccessfulCartReadResponse(response: Response): boolean {
  const request = response.request();
  return (
    request.method() === 'GET' &&
    new URL(response.url()).pathname === '/cart' &&
    response.status() >= 200 &&
    response.status() < 300 &&
    request.resourceType() !== 'document'
  );
}

function cartApiRequest(request: Request): CartApiRequest | null {
  const url = new URL(request.url());
  if (request.resourceType() === 'document' || !isCartApiPath(url.pathname)) return null;
  return { method: request.method(), pathname: url.pathname };
}

export async function routeCartApi(page: Page, handler: CartApiRouteHandler) {
  await page.route('**/*', async (route) => {
    const request = cartApiRequest(route.request());
    if (!request) {
      await route.fallback();
      return;
    }
    await handler(route, request);
  });
}

export async function installCartAdmissionRoutes(page: Page, handler: CartApiRouteHandler) {
  await page.route('**/me', (route) => fulfillCartJson(route, student));
  await page.route('**/enrollments/my?page=1&page_size=100', (route) =>
    fulfillCartJson(route, {
      items: [],
      page: 1,
      page_size: 100,
      total: 0,
      pages: 0,
      has_next: false,
      has_previous: false,
    }),
  );
  await routeCartApi(page, handler);
}

async function navigateToCartAndAwaitReadySurface(page: Page, action: CartNavigationAction) {
  const cartResponse = page.waitForResponse(isSuccessfulCartReadResponse);
  await action();
  const failure = await (await cartResponse).finished();
  if (failure !== null) throw new Error(`Cart read response did not finish: ${failure}`);
  await page.locator(cartReadySurface).waitFor({ state: 'visible' });
}

export function createCartD03Controller(
  page: Page,
  scenario: CartD03Scenario,
  options: CartD03ControllerOptions = {},
): CartD03Controller {
  let clearRequests = 0;
  let resolvePendingClear: (() => void) | undefined;
  const pendingClear = new Promise<void>((resolve) => {
    resolvePendingClear = resolve;
  });

  return {
    scenario,
    completePendingClear() {
      resolvePendingClear?.();
    },
    getClearRequestCount() {
      return clearRequests;
    },
    async install() {
      await installCartStudent(page);
      if (scenario === 'localized-return-mutations') {
        const secondItem: CartD03Item = {
          ...cartAdmissionItem,
          id: 11,
          course_id: 8,
          course: { ...cartAdmissionItem.course, id: 8, title: 'Second browser cart course' },
        };
        let currentItems: readonly CartD03Item[] = [cartAdmissionItem, secondItem];
        await installCartAdmissionRoutes(page, async (route, request) => {
          const requestLabel = `${request.method} ${request.pathname}`;
          if (requestLabel === 'GET /cart')
            return fulfillCartJson(route, cartD03Response(currentItems));
          if (requestLabel === 'DELETE /cart/items/7') {
            currentItems = [secondItem];
            return route.fulfill({ status: 204 });
          }
          if (requestLabel === 'DELETE /cart') {
            currentItems = [];
            return route.fulfill({ status: 204 });
          }
          throw new Error(`Unexpected localized Cart request ${requestLabel}`);
        });
        return;
      }

      let currentCart: CartD03Response =
        scenario === 'admitted-surface'
          ? {
              id: 1,
              items: [cartAdmissionItem],
              total_price: cartAdmissionItem.course.price,
              currency: cartAdmissionItem.course.currency,
              item_count: 1,
            }
          : cartD03Response();
      await installCartAdmissionRoutes(page, async (route, request) => {
        const requestLabel = `${request.method} ${request.pathname}`;
        if (requestLabel === 'GET /cart') return fulfillCartJson(route, currentCart);
        if (scenario === 'admitted-surface')
          throw new Error(`Unexpected admitted Cart request ${requestLabel}`);
        if (requestLabel === 'DELETE /cart') {
          clearRequests += 1;
          if (scenario === 'clear-pending') await pendingClear;
          currentCart = cartD03Response([]);
          return route.fulfill({ status: 204 });
        }
        throw new Error(`Unexpected cart request ${requestLabel}`);
      });
    },
    async navigateToCart() {
      await navigateToCartAndAwaitReadySurface(page, () =>
        page.goto('/cart', { waitUntil: 'commit' }),
      );
      if (options.returnTo === undefined) return;
      await page.evaluate((returnTo) => {
        window.history.replaceState(
          { ...window.history.state, usr: { returnTo } },
          '',
          window.location.href,
        );
      }, options.returnTo);
      await navigateToCartAndAwaitReadySurface(page, () => page.reload({ waitUntil: 'commit' }));
    },
  };
}
