// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppQueryClient } from '../../src/app/query';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
} from '../../src/features/auth-session';
import { InstructorCourseEnrollmentsPage } from '../../src/pages/instructor-course-enrollments-page';
import { ApiError, type ApiClient, type ApiRequestOptions } from '../../src/shared/api';
import { LocaleProvider, type Locale } from '../../src/shared/locale';

const instructor = {
  email: 'instructor@example.test',
  name: 'Ada',
  surname: 'Lovelace',
  role: 'instructor',
  birthday: null,
  phone_number: null,
  created_at: '2026-01-01T00:00:00Z',
};
function tokenStore(token: string | null): AccessTokenStore {
  return { get: () => token, set: () => {}, clear: () => {} };
}
const roster = {
  items: [
    {
      id: 9,
      user_id: 12,
      course_id: 7,
      status: 'active',
      created_at: '2026-07-30T00:00:00Z',
      updated_at: '2026-07-30T01:00:00Z',
      user: { id: 12, name: 'Sam', surname: 'Student', email: 'sam@example.test' },
    },
  ],
  page: 1,
  page_size: 20,
  total: 1,
  pages: 1,
  has_next: false,
  has_previous: false,
};

afterEach(cleanup);

async function renderPage(
  request: ApiClient['request'],
  token: string | null = 'instructor-token',
  initialEntry = '/instructor/courses/7/enrollments',
  locale: Locale = 'en',
  includeSessionEndControl = false,
) {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <QueryClientProvider client={createAppQueryClient()}>
        <LocaleProvider initialLocale={locale}>
          <SessionProvider client={{ request }} tokenStore={tokenStore(token)}>
            <MemoryRouter initialEntries={[initialEntry]}>
              {includeSessionEndControl ? <SessionEndControl /> : null}
              <Routes>
                <Route
                  path="/instructor/courses/:courseId/enrollments"
                  element={<InstructorCourseEnrollmentsPage />}
                />
              </Routes>
            </MemoryRouter>
          </SessionProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );
  });
  if (!view) throw new Error('Expected rendered roster page');
  return view;
}

function SessionEndControl() {
  const session = useSession();
  return (
    <button type="button" onClick={() => session.clearSession()}>
      End instructor session
    </button>
  );
}

function decode<TResponse, TBody>(
  options: ApiRequestOptions<TBody, TResponse>,
  value: unknown,
): TResponse {
  if (!options.decode) throw new Error('Expected decoder');
  return options.decode(value);
}

describe('InstructorCourseEnrollmentsPage', () => {
  it.each([
    ['en', 0, 'Breadcrumb', '0 enrollments'],
    ['en', 1, 'Breadcrumb', '1 enrollment'],
    ['en', 2, 'Breadcrumb', '2 enrollments'],
    ['ru', 1, 'Хлебные крошки', '1 запись'],
    ['ru', 2, 'Хлебные крошки', '2 записи'],
    ['ru', 5, 'Хлебные крошки', '5 записей'],
    ['uz', 1, 'Yo‘l ko‘rsatkich', '1 ta yozilish'],
    ['uz', 2, 'Yo‘l ko‘rsatkich', '2 ta yozilish'],
  ] as const)(
    'localizes the breadcrumb and enrollment count in %s for %i',
    async (locale, total, breadcrumbName, countLabel) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        return decode(options, {
          ...roster,
          items: total === 0 ? [] : roster.items,
          total,
          pages: total === 0 ? 0 : 1,
        });
      };

      await renderPage(request, 'instructor-token', '/instructor/courses/7/enrollments', locale);
      expect(await screen.findByText(countLabel)).toBeTruthy();
      expect(screen.getByRole('navigation', { name: breadcrumbName })).toBeTruthy();
    },
  );

  it.each([
    ['ru', 'Записи на курс', 'Активно'],
    ['uz', 'Kursga yozilishlar', 'Faol'],
  ] as const)('renders allocated roster UI in %s', async (locale, heading, activeStatus) => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, roster);
    };
    await renderPage(request, 'instructor-token', '/instructor/courses/7/enrollments', locale);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.getByText(activeStatus)).toBeTruthy();
  });

  it.each([
    ['active', 'Active'],
    ['cancelled', 'Cancelled'],
    ['pending_payment', 'Payment pending'],
  ])('projects the %s roster status as %s', async (status, label) => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, { ...roster, items: [{ ...roster.items[0], status }] });
    };
    await renderPage(request);
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it('preserves full long learner content in the populated roster', async () => {
    const longName = `Ada-${'LongName'.repeat(20)}`;
    const longEmail = `${'very-long-address.'.repeat(12)}example.test`;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, {
        ...roster,
        items: [
          {
            ...roster.items[0],
            user: { ...roster.items[0].user, name: longName, email: longEmail },
          },
        ],
      });
    };
    await renderPage(request);
    expect(await screen.findByText(`${longName} Student`)).toBeTruthy();
    expect(screen.getByText(longEmail)).toBeTruthy();
  });

  it('rejects an oversized course ID locally without an API-013 request', async () => {
    const rosterRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      rosterRequests.push(options);
      return decode(options, roster);
    };
    await renderPage(request, null, '/instructor/courses/9007199254740992/enrollments');
    expect(await screen.findByText('This course was not found.')).toBeTruthy();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const returnLink = within(breadcrumb).getByRole('link', { name: 'Instructor courses' });
    expect(returnLink.getAttribute('href')).toBe('/instructor/courses');
    expect(
      within(breadcrumb).getByText('Course enrollments', { selector: '[aria-current="page"]' }),
    ).toBeTruthy();
    returnLink.focus();
    expect(document.activeElement).toBe(returnLink);
    expect(rosterRequests).toHaveLength(0);
  });

  it('uses page 1 for an oversized page query', async () => {
    const rosterRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      rosterRequests.push(options);
      return decode(options, roster);
    };
    await renderPage(
      request,
      'instructor-token',
      '/instructor/courses/7/enrollments?page=9007199254740992',
    );
    await screen.findByText('sam@example.test');
    expect(rosterRequests).toHaveLength(1);
    expect(rosterRequests[0]?.query).toEqual({ page: 1, page_size: 20 });
  });

  it('renders a loading skeleton before the decoder-faithful empty roster resolves', async () => {
    let resolveRoster: (() => void) | undefined;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return new Promise((resolve) => {
        resolveRoster = () =>
          resolve(decode(options, { ...roster, items: [], total: 0, pages: 0 }));
      });
    };
    await renderPage(request, 'instructor-token');
    expect(await screen.findByLabelText('Loading course enrollments')).toBeTruthy();
    await act(async () => {
      resolveRoster?.();
    });
    expect(await screen.findByText('No enrollments yet.')).toBeTruthy();
  });

  it('propagates query cancellation through the roster AbortSignal on unmount', async () => {
    let signal: AbortSignal | undefined;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    };
    const view = await renderPage(request, 'instructor-token');
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);
    await act(async () => {
      view.unmount();
    });
    expect(signal?.aborted).toBe(true);
  });

  it('uses the labelled pagination control to request the next verified roster page', async () => {
    const requestedPages: number[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      const page = Number(options.query?.page);
      requestedPages.push(page);
      return decode(
        options,
        page === 2
          ? { ...roster, page: 2, total: 21, pages: 2, has_next: false, has_previous: true }
          : { ...roster, total: 21, pages: 2, has_next: true },
      );
    };
    await renderPage(request);
    const next = await screen.findByRole('button', { name: 'Go to next page' });
    await act(async () => {
      await userEvent.setup().click(next);
    });
    await waitFor(() => expect(screen.getByLabelText('Page 2, current page')).toBeTruthy());
    expect(requestedPages).toContain(2);
  });

  it('renders loading then empty and paginated roster states through a decoder-faithful requester', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, { ...roster, items: [], total: 0, pages: 0 });
    };
    await renderPage(request);
    expect(await screen.findByText('No enrollments yet.')).toBeTruthy();
  });

  it('maps a roster failure to a labelled keyboard retry that refetches and restores content', async () => {
    let allowSuccess = false;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (!allowSuccess) throw new ApiError({ kind: 'offline', status: null, message: 'private' });
      return decode(options, roster);
    };
    await renderPage(request);
    expect(
      await screen.findByText('We could not load course enrollments. Try again.'),
    ).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    allowSuccess = true;
    await act(async () => {
      await userEvent.setup().keyboard('{Enter}');
    });
    await waitFor(() => expect(screen.getByText('sam@example.test')).toBeTruthy());
  });

  it('removes roster retry after a retained failure loses its private cache epoch', async () => {
    const rosterRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      rosterRequests.push(options);
      throw new ApiError({ kind: 'offline', status: null, message: 'private' });
    };
    await renderPage(request, 'instructor-token', undefined, 'en', true);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(rosterRequests).toHaveLength(1);

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'End instructor session' }));
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
    expect(rosterRequests).toHaveLength(1);
  });
});
