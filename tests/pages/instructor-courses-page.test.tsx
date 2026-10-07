// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '../../src/app/query';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
} from '../../src/features/auth-session';
import { requestInstructorCourseCreateDisclosure } from '../../src/features/instructor-courses';
import { InstructorCoursesPage } from '../../src/pages/instructor-courses-page';
import { LocaleProvider, type Locale } from '../../src/shared/locale';
import {
  ApiError,
  createApiClient,
  type ApiClient,
  type ApiRequestOptions,
} from '../../src/shared/api';
import {
  instructorCourseCollectionQueryPrefix,
  type SessionCacheEpoch,
} from '../../src/shared/api/query-keys';

const instructor = {
  email: 'instructor@example.test',
  name: 'Ada',
  surname: 'Lovelace',
  role: 'instructor',
  birthday: null,
  phone_number: null,
  created_at: '2026-01-01T00:00:00Z',
};
const courseList = {
  items: [
    {
      id: 17,
      title: 'Verified collection course',
      description: 'Returned by the instructor collection.',
      price: '0.00',
      currency: 'USD',
      published_at: null,
      created_at: '2026-07-30T00:00:00Z',
      updated_at: '2026-07-30T00:00:00Z',
      instructor: { id: 3, name: 'Ada', surname: 'Lovelace' },
      lessons: [{ id: 1, title: 'Introduction' }],
    },
  ],
  page: 1,
  page_size: 20,
  total: 1,
  pages: 1,
  has_next: false,
  has_previous: false,
};
const emptyCourseList = { ...courseList, items: [], total: 0, pages: 0 };
const tokenStore: AccessTokenStore = {
  get: () => 'instructor-token',
  set: () => {},
  clear: () => {},
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage(
  client: ApiClient,
  store: AccessTokenStore = tokenStore,
  includeSessionReplacementControl = false,
  initialEntry = '/',
  locale: Locale = 'en',
  sessionEpochRef?: SessionEpochRef,
) {
  const queryClient = createAppQueryClient();
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider initialLocale={locale}>
          <SessionProvider client={client} tokenStore={store}>
            {sessionEpochRef ? <SessionEpochProbe epochRef={sessionEpochRef} /> : null}
            <MemoryRouter initialEntries={[initialEntry]}>
              {includeSessionReplacementControl ? <SessionReplacementControl /> : null}
              {includeSessionReplacementControl ? <SessionEndControl /> : null}
              <LocationDisplay />
              <InstructorCoursesPage />
            </MemoryRouter>
          </SessionProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );
  });
  return queryClient;
}

interface SessionEpochRef {
  current: SessionCacheEpoch | null;
}

function SessionEpochProbe({ epochRef }: { readonly epochRef: SessionEpochRef }) {
  const { cacheEpoch } = useSession();
  if (cacheEpoch) epochRef.current = cacheEpoch;
  return null;
}

function capturedSessionEpoch(epochRef: SessionEpochRef): SessionCacheEpoch {
  expect(epochRef.current).toEqual(expect.any(String));
  return epochRef.current!;
}

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function SessionReplacementControl() {
  const session = useSession();
  return (
    <button type="button" onClick={() => session.acceptAccessToken('replacement-token')}>
      Change instructor
    </button>
  );
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
  if (!options.decode) throw new Error('Expected a decoder');
  return options.decode(value);
}

describe('InstructorCoursesPage', () => {
  it.each([
    [
      'ru',
      'Курсы преподавателя',
      'Создавайте курсы, добавляйте уроки и управляйте записями студентов.',
      'Ваши курсы',
      'Навигация по страницам ваших курсов',
    ],
    [
      'uz',
      'O‘qituvchi kurslari',
      'Kurslar yarating, darslar qo‘shing va talabalarning kursga yozilishlarini boshqaring.',
      'Kurslaringiz',
      'Kurslaringiz sahifalari',
    ],
  ] as const)(
    'localizes the page introduction and collection semantic unit in %s',
    async (locale, pageTitle, pageDescription, collectionLabel, paginationLabel) => {
      const firstPage = {
        ...courseList,
        items: Array.from({ length: 20 }, (_, index) => ({
          ...courseList.items[0],
          id: index + 1,
          title: `Instructor course ${index + 1}`,
        })),
        total: 21,
        pages: 2,
        has_next: true,
      };
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        return decode(options, firstPage);
      };
      await renderPage({ request }, tokenStore, false, '/', locale);
      expect(await screen.findByRole('heading', { level: 1, name: pageTitle })).toBeTruthy();
      expect(screen.getByText(pageDescription)).toBeTruthy();
      expect(await screen.findByRole('heading', { level: 2, name: collectionLabel })).toBeTruthy();
      expect(screen.getByRole('list', { name: collectionLabel })).toBeTruthy();
      expect(screen.getByRole('navigation', { name: paginationLabel })).toBeTruthy();
    },
  );

  it.each([
    ['en', 1, '1 lesson'],
    ['en', 2, '2 lessons'],
    ['ru', 1, '1 урок'],
    ['ru', 2, '2 урока'],
    ['ru', 5, '5 уроков'],
    ['uz', 1, '1 dars'],
    ['uz', 2, '2 dars'],
  ] as const)('localizes the lesson count in %s for %i', async (locale, lessonCount, expected) => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, {
        ...courseList,
        items: [
          {
            ...courseList.items[0],
            lessons: Array.from({ length: lessonCount }, (_, index) => ({
              id: index + 1,
              title: `Lesson ${index + 1}`,
            })),
          },
        ],
      });
    };

    await renderPage({ request }, tokenStore, false, '/', locale);
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it.each([
    [
      'en',
      'Edit course',
      'Course enrollments',
      'New course actions',
      'Verified collection course actions',
      'Course created',
    ],
    [
      'ru',
      'Редактировать курс',
      'Записи на курс',
      'Действия с новым курсом',
      'Действия с курсом «Verified collection course»',
      'Курс создан',
    ],
    [
      'uz',
      'Kursni tahrirlash',
      'Kursga yozilishlar',
      'Yangi kurs bo‘yicha amallar',
      'Verified collection course kursi bo‘yicha amallar',
      'Kurs yaratildi',
    ],
  ] as const)(
    'localizes existing and newly created course actions in %s',
    async (
      locale,
      editLabel,
      enrollmentsLabel,
      newCourseActionsLabel,
      existingCourseActionsLabel,
      createdTitle,
    ) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/my') return decode(options, courseList);
        return decode(options, {
          id: 7,
          instructor_id: 3,
          title: 'Localized course',
          description: null,
          price: '0.00',
          currency: 'USD',
          published_at: null,
          created_at: '2026-07-30T00:00:00Z',
          updated_at: '2026-07-30T00:00:00Z',
        });
      };

      await renderPage({ request }, tokenStore, false, '/', locale);
      const existingActions = await screen.findByRole('navigation', {
        name: existingCourseActionsLabel,
      });
      expect(within(existingActions).getByRole('link', { name: editLabel })).toBeTruthy();
      const existingMenuTrigger = within(existingActions).getByRole('button', {
        name: existingCourseActionsLabel,
      });
      await act(async () => {
        await userEvent.setup().click(existingMenuTrigger);
      });
      expect(
        within(existingActions).getByRole('menuitem', { name: enrollmentsLabel }),
      ).toBeTruthy();
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      expect(document.activeElement).toBe(existingMenuTrigger);

      act(() => requestInstructorCourseCreateDisclosure());
      const title = await screen.findByRole('textbox');
      await act(async () => {
        await userEvent.setup().type(title, 'Localized course');
        fireEvent.submit(title.closest('form') as HTMLFormElement);
      });

      const createdHeading = await screen.findByText(createdTitle);
      const creationStatus = createdHeading.closest('[role="status"]');
      expect(creationStatus?.className).toContain('creationNotice');
      expect(creationStatus?.querySelector('svg')).toBeTruthy();
      const createdActions = screen.getByRole('navigation', { name: newCourseActionsLabel });
      expect(within(createdActions).getByRole('link', { name: editLabel })).toBeTruthy();
      expect(within(createdActions).queryByRole('link', { name: enrollmentsLabel })).toBeNull();
    },
  );

  it('submits a verified 255-character title', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const createRequests: ApiRequestOptions[] = [];
    const collectionRequests: ApiRequestOptions[] = [];
    const createdTitle = 'A'.repeat(255);
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/my') {
        collectionRequests.push(options);
        return decode(
          options,
          collectionRequests.length === 1
            ? courseList
            : {
                ...courseList,
                items: [{ ...courseList.items[0], id: 7, title: createdTitle }],
              },
        );
      }
      createRequests.push(options);
      return decode(options, {
        id: 7,
        instructor_id: 3,
        title: createdTitle,
        description: null,
        price: '0.00',
        currency: 'USD',
        published_at: null,
        created_at: '2026-07-30T00:00:00Z',
        updated_at: '2026-07-30T00:00:00Z',
      });
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderPage(
      { request },
      tokenStore,
      false,
      '/',
      'en',
      sessionEpochRef,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    expect(document.querySelector('[data-part="instructor-courses-hero"]')).toBeNull();
    const pageTitle = screen.getByRole('heading', { level: 1, name: 'Instructor courses' });
    expect(pageTitle).toBeTruthy();
    expect(
      screen.queryByText(
        'Create meaningful courses, share your expertise, and inspire learners to grow.',
      ),
    ).toBeNull();
    expect(await screen.findByText('Verified collection course')).toBeTruthy();
    const collectionActions = screen.getByRole('navigation', {
      name: 'Verified collection course actions',
    });
    expect(
      within(collectionActions).getByRole('link', { name: 'Edit course' }).getAttribute('href'),
    ).toBe('/instructor/courses/17/edit');
    expect(
      within(collectionActions)
        .getByRole('button', { name: 'Verified collection course actions' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    await act(async () => {
      await user.click(
        within(collectionActions).getByRole('button', {
          name: 'Verified collection course actions',
        }),
      );
    });
    expect(
      within(collectionActions)
        .getByRole('menuitem', { name: 'Course enrollments' })
        .getAttribute('href'),
    ).toBe('/instructor/courses/17/enrollments');
    expect(collectionRequests).toHaveLength(1);
    expect(collectionRequests.map((request) => request.query)).toEqual([
      { page: 1, page_size: 20 },
    ]);
    expect(screen.queryByRole('textbox', { name: 'Course title' })).toBeNull();
    act(() => requestInstructorCourseCreateDisclosure());
    const title = await screen.findByRole('textbox', { name: 'Course title' });
    expect(title.id).toBe('instructor-course-title');
    const createForm = title.closest('form');
    if (!createForm) throw new Error('Expected the create course form');
    await act(async () => {
      await user.type(title, createdTitle);
      await user.click(within(createForm).getByRole('button', { name: 'Create course' }));
    });
    await waitFor(() => expect(createRequests).toHaveLength(1));
    expect(createRequests[0]?.body).toEqual({ title: createdTitle });
    const newCourseActions = await screen.findByRole('navigation', { name: 'New course actions' });
    const collectionHeading = screen.getByRole('heading', { level: 2, name: 'Your courses' });
    await waitFor(() => expect(document.activeElement).toBe(collectionHeading));
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(
      within(newCourseActions).getByRole('link', { name: 'Edit course' }).getAttribute('href'),
    ).toBe('/instructor/courses/7/edit');
    expect(within(newCourseActions).queryByRole('link', { name: 'Course enrollments' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Course title' })).toBeNull();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    });
    expect(screen.queryByText('Course created')).toBeNull();
    await waitFor(() => expect(collectionRequests).toHaveLength(2));
    expect(collectionRequests[1]?.query).toEqual({ page: 1, page_size: 20 });
    const epoch = capturedSessionEpoch(sessionEpochRef);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseCollectionQueryPrefix(epoch),
    });
    const refreshedActions = await screen.findByRole('navigation', {
      name: `${createdTitle} actions`,
    });
    expect(
      within(refreshedActions).getByRole('link', { name: 'Edit course' }).getAttribute('href'),
    ).toBe('/instructor/courses/7/edit');
  });

  it.each([
    ['Enter', 'Course enrollments'],
    [' ', 'Course enrollments'],
    ['ArrowDown', 'Course enrollments'],
    ['ArrowUp', 'Delete course'],
  ] as const)('opens the course actions menu with %s and focuses %s', async (key, itemName) => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, courseList);
    };
    await renderPage({ request });
    const trigger = await screen.findByRole('button', {
      name: 'Verified collection course actions',
    });
    trigger.focus();

    await act(async () => {
      await userEvent.setup().keyboard(key === ' ' ? ' ' : `{${key}}`);
    });

    const focusedItem = await screen.findByRole('menuitem', { name: itemName });
    await waitFor(() => expect(document.activeElement).toBe(focusedItem));
  });

  it('focuses the first menuitem after pointer opening and wraps directional navigation', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, courseList);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', {
      name: 'Verified collection course actions',
    });
    await act(async () => {
      await user.click(trigger);
    });
    const enrollments = screen.getByRole('menuitem', { name: 'Course enrollments' });
    const deleteCourse = screen.getByRole('menuitem', { name: 'Delete course' });
    await waitFor(() => expect(document.activeElement).toBe(enrollments));

    await act(async () => {
      await user.keyboard('{ArrowDown}');
    });
    expect(document.activeElement).toBe(deleteCourse);
    await act(async () => {
      await user.keyboard('{ArrowDown}');
    });
    expect(document.activeElement).toBe(enrollments);
    await act(async () => {
      await user.keyboard('{ArrowUp}');
    });
    expect(document.activeElement).toBe(deleteCourse);
    await act(async () => {
      await user.keyboard('{Home}');
    });
    expect(document.activeElement).toBe(enrollments);
    await act(async () => {
      await user.keyboard('{End}');
    });
    expect(document.activeElement).toBe(deleteCourse);
    await act(async () => {
      await user.keyboard('{Escape}');
    });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Tab and Shift+Tab without trapping native sequential focus', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, courseList);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', {
      name: 'Verified collection course actions',
    });

    await act(async () => {
      await user.click(trigger);
    });
    const firstItem = screen.getByRole('menuitem', { name: 'Course enrollments' });
    await waitFor(() => expect(document.activeElement).toBe(firstItem));
    await act(async () => {
      await user.tab();
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).not.toBe(trigger);

    trigger.focus();
    await act(async () => {
      await user.keyboard('{ArrowDown}');
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('menuitem', { name: 'Course enrollments' }),
      ),
    );
    await act(async () => {
      await user.tab({ shift: true });
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('activates the focused destructive menuitem through the keyboard', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return decode(options, courseList);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', {
      name: 'Verified collection course actions',
    });
    trigger.focus();

    await act(async () => {
      await user.keyboard('{ArrowUp}');
    });
    const deleteAction = await screen.findByRole('menuitem', { name: 'Delete course' });
    await waitFor(() => expect(document.activeElement).toBe(deleteAction));
    await act(async () => {
      await user.keyboard('{Enter}');
    });

    expect(await screen.findByRole('dialog', { name: 'Delete this course?' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the verified course deletion through the compact overflow menu and confirmation', async () => {
    const deleteRequests: ApiRequestOptions[] = [];
    const collectionRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/my') {
        collectionRequests.push(options);
        return decode(options, collectionRequests.length === 1 ? courseList : emptyCourseList);
      }
      deleteRequests.push(options);
      return decode(options, { message: 'deleted' });
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderPage(
      { request },
      tokenStore,
      false,
      '/',
      'en',
      sessionEpochRef,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    expect(await screen.findByText('Verified collection course')).toBeTruthy();
    expect(screen.queryByText('Returned by the instructor collection.')).toBeNull();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Verified collection course actions' }));
    });
    const deleteAction = screen.getByRole('menuitem', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteAction);
    });
    expect(await screen.findByRole('dialog', { name: 'Delete this course?' })).toBeTruthy();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Delete course' }));
    });
    await waitFor(() => expect(deleteRequests).toHaveLength(1));
    expect(deleteRequests[0]?.path).toBe('/courses/17');
    await waitFor(() => expect(collectionRequests).toHaveLength(2));
    const epoch = capturedSessionEpoch(sessionEpochRef);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseCollectionQueryPrefix(epoch),
    });
    expect(screen.queryByText('Verified collection course')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verified collection course actions' })).toBeNull();
  });

  it('uses named arrow directions, preserves the verified query, and hides unavailable direction slots', async () => {
    const collectionRequests: ApiRequestOptions[] = [];
    const firstPage = {
      ...courseList,
      items: Array.from({ length: 20 }, (_, index) => ({
        ...courseList.items[0],
        id: index + 1,
        title: index === 0 ? 'Verified collection course' : `Instructor course ${index + 1}`,
      })),
      total: 21,
      pages: 2,
      has_next: true,
    };
    const secondPage = {
      ...firstPage,
      items: [{ ...courseList.items[0], id: 18, title: 'Second instructor course' }],
      page: 2,
      has_next: false,
      has_previous: true,
    };
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      collectionRequests.push(options);
      return decode(options, options.query?.page === 2 ? secondPage : firstPage);
    };

    await renderPage({ request });
    expect(await screen.findByText('Verified collection course')).toBeTruthy();
    const user = userEvent.setup();
    const pagination = screen.getByRole('navigation', { name: 'Your courses pagination' });
    expect(pagination.querySelectorAll('.ui-pagination__button--direction')).toHaveLength(1);
    expect(
      pagination.querySelectorAll('.ui-pagination__direction-slot[aria-hidden="true"]'),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Go to previous page' })).toBeNull();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    });
    expect(await screen.findByText('Second instructor course')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go to next page' })).toBeNull();
    expect(
      pagination.querySelectorAll('.ui-pagination__direction-slot[aria-hidden="true"]'),
    ).toHaveLength(1);

    const pageTwoRequests = collectionRequests.filter((request) => request.query?.page === 2);
    expect(pageTwoRequests).toHaveLength(1);
    expect(pageTwoRequests[0]?.query).toEqual({ page: 2, page_size: 20 });
  });

  it('focuses the collection heading only after a user-requested page settles', async () => {
    let resolveSecondPage: (() => void) | undefined;
    const firstPage = {
      ...courseList,
      items: Array.from({ length: 20 }, (_, index) => ({
        ...courseList.items[0],
        id: index + 1,
        title: `Instructor course ${index + 1}`,
      })),
      total: 21,
      pages: 2,
      has_next: true,
    };
    const secondPage = {
      ...firstPage,
      items: [{ ...courseList.items[0], id: 18, title: 'Second instructor course' }],
      page: 2,
      has_next: false,
      has_previous: true,
    };
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.query?.page !== 2) return decode(options, firstPage);
      await new Promise<void>((resolve) => {
        resolveSecondPage = resolve;
      });
      return decode(options, secondPage);
    };

    await renderPage({ request });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Your courses' });
    expect(document.activeElement).not.toBe(heading);

    const nextPage = screen.getByRole('button', { name: 'Go to next page' });
    await act(async () => {
      await userEvent.setup().click(nextPage);
    });
    expect(document.activeElement).not.toBe(heading);

    await act(async () => resolveSecondPage?.());
    expect(await screen.findByText('Second instructor course')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('blocks an oversized or whitespace-only title locally and returns keyboard focus to the field', async () => {
    const createRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/my') return decode(options, emptyCourseList);
      createRequests.push(options);
      return decode(options, {
        id: 7,
        instructor_id: 3,
        title: 'Course',
        description: null,
        price: '0.00',
        currency: 'USD',
        published_at: null,
        created_at: '2026-07-30T00:00:00Z',
        updated_at: '2026-07-30T00:00:00Z',
      });
    };
    await renderPage({ request });
    const user = userEvent.setup();
    expect(await screen.findByText('You have not created any courses yet.')).toBeTruthy();
    act(() => requestInstructorCourseCreateDisclosure());
    const title = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      fireEvent.change(title, { target: { value: 'A'.repeat(256) } });
      fireEvent.submit(title.closest('form') as HTMLFormElement);
    });
    expect(await screen.findByText('Course title must be 255 characters or fewer.')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(title);
    expect(createRequests).toHaveLength(0);

    await act(async () => {
      fireEvent.change(title, { target: { value: '   ' } });
      await user.keyboard('{Enter}');
    });
    expect(await screen.findByText('Enter a course title.')).toBeTruthy();
    expect(document.activeElement).toBe(title);
    expect(createRequests).toHaveLength(0);
  });

  it('focuses the named generic failure summary after an unaddressable create failure', async () => {
    const request = vi.fn(async (options) => {
      if (options.path === '/me') return options.decode?.(instructor);
      if (options.path === '/courses/my') return options.decode?.(emptyCourseList);
      throw new Error('private upstream failure');
    });
    await renderPage({ request } as ApiClient);
    const user = userEvent.setup();
    act(() => requestInstructorCourseCreateDisclosure());
    const title = await screen.findByRole('textbox', { name: 'Course title' });
    expect(title.getAttribute('name')).toBe('title');
    const createForm = title.closest('form');
    if (!createForm) throw new Error('Expected the create course form');
    await act(async () => {
      await user.type(title, 'A course');
      await user.click(within(createForm).getByRole('button', { name: 'Create course' }));
    });
    const summary = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(summary.textContent).toContain('We could not create the course');
  });

  it('renders a loading skeleton before the decoder-faithful empty collection resolves', async () => {
    let resolveCollection: (() => void) | undefined;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      return new Promise((resolve) => {
        resolveCollection = () => resolve(decode(options, emptyCourseList));
      });
    };
    await renderPage({ request });
    expect(await screen.findByLabelText('Loading your courses')).toBeTruthy();
    await act(async () => {
      resolveCollection?.();
    });
    expect(await screen.findByText('You have not created any courses yet.')).toBeTruthy();
  });

  it.each([
    [401, 'unauthorized', 'Sign in again to view your courses.'],
    [403, 'forbidden', 'You do not have permission to view instructor courses.'],
    [422, 'validation', 'The requested course page is not valid. Try another page.'],
  ] as const)(
    'maps the verified %i collection failure without inventing another state',
    async (status, kind, message) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        throw new ApiError({ kind, status, message: 'private collection failure' });
      };
      await renderPage({ request });
      expect((await screen.findByRole('alert')).textContent).toContain('Course list unavailable');
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByText('This course was not found.')).toBeNull();
    },
  );

  it('maps a generic collection failure to a labelled retry that restores decoder-faithful content', async () => {
    let allowSuccess = false;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (!allowSuccess) throw new ApiError({ kind: 'server', status: 500, message: 'private' });
      return decode(options, courseList);
    };
    await renderPage({ request });
    expect(await screen.findByText('We could not load your courses. Try again.')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    allowSuccess = true;
    await act(async () => {
      await userEvent.setup().keyboard('{Enter}');
    });
    expect(await screen.findByText('Verified collection course')).toBeTruthy();
  });

  it('removes collection retry after a retained failure loses its private cache epoch', async () => {
    const collectionRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      collectionRequests.push(options);
      throw new ApiError({ kind: 'server', status: 500, message: 'private' });
    };
    await renderPage({ request }, tokenStore, true);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(collectionRequests).toHaveLength(1);

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'End instructor session' }));
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
    expect(collectionRequests).toHaveLength(1);
  });

  it('resets an unaddressable 422 collection page to page one before retrying', async () => {
    const collectionRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      collectionRequests.push(options);
      if (options.query?.page === 9)
        throw new ApiError({ kind: 'validation', status: 422, message: 'private' });
      return decode(options, courseList);
    };
    await renderPage({ request }, tokenStore, false, '/?page=9');
    expect(
      await screen.findByText('The requested course page is not valid. Try another page.'),
    ).toBeTruthy();
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText('Verified collection course')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('');
    expect(collectionRequests[collectionRequests.length - 1]?.query).toEqual({
      page: 1,
      page_size: 20,
    });
    expect(collectionRequests.filter((request) => request.query?.page === 1)).toHaveLength(1);
  });

  it('does not project a deferred old-session collection after the session cache epoch changes', async () => {
    let activeToken = 'original-token';
    let resolveOriginalCollection: (() => void) | undefined;
    const collectionTokens: string[] = [];
    const store: AccessTokenStore = {
      get: () => activeToken,
      set: (token) => {
        activeToken = token;
      },
      clear: () => {
        activeToken = '';
      },
    };
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      collectionTokens.push(activeToken);
      if (activeToken === 'original-token') {
        return new Promise((resolve) => {
          resolveOriginalCollection = () =>
            resolve(
              decode(options, {
                ...courseList,
                items: [{ ...courseList.items[0], title: 'Old instructor course' }],
              }),
            );
        });
      }
      return decode(options, {
        ...courseList,
        items: [{ ...courseList.items[0], title: 'Replacement instructor course' }],
      });
    };
    await renderPage({ request }, store, true);
    expect(await screen.findByLabelText('Loading your courses')).toBeTruthy();
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Change instructor' }));
    });
    expect(await screen.findByText('Replacement instructor course')).toBeTruthy();
    await act(async () => {
      resolveOriginalCollection?.();
    });
    expect(collectionTokens).toContain('original-token');
    expect(collectionTokens).toContain('replacement-token');
    expect(collectionTokens[collectionTokens.length - 1]).toBe('replacement-token');
    expect(screen.queryByText('Old instructor course')).toBeNull();
  });

  it('uses the session request boundary to suppress overlapping create transports', async () => {
    let resolveCreate: ((value: Response) => void) | undefined;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/me')) return Promise.resolve(new Response(JSON.stringify(instructor)));
      if (url.includes('/courses/my'))
        return Promise.resolve(new Response(JSON.stringify(emptyCourseList)));
      return new Promise<Response>((resolve) => {
        resolveCreate = resolve;
      });
    });
    await renderPage(createApiClient({ baseUrl: 'https://api.example.test', fetch }));
    act(() => requestInstructorCourseCreateDisclosure());
    const title = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      fireEvent.change(title, { target: { value: 'A course' } });
    });
    const form = title.closest('form');
    if (!form) throw new Error('Expected a form');
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    resolveCreate?.(
      new Response(
        JSON.stringify({
          id: 7,
          instructor_id: 3,
          title: 'A course',
          description: null,
          price: '0.00',
          currency: 'USD',
          published_at: null,
          created_at: '2026-07-30T00:00:00Z',
          updated_at: '2026-07-30T00:00:00Z',
        }),
      ),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const refetchInput = fetch.mock.calls[3]?.[0];
    const refetchUrl = refetchInput instanceof Request ? refetchInput.url : String(refetchInput);
    expect(refetchUrl).toContain('/courses/my');
  });
});
