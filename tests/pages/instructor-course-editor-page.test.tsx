// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '../../src/app/query';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
} from '../../src/features/auth-session';
import { InstructorCourseEditorPage } from '../../src/pages/instructor-course-editor-page';
import instructorCourseEditorStyles from '../../src/pages/instructor-course-editor-page/InstructorCourseEditorPage.module.css';
import { InstructorCoursesPage } from '../../src/pages/instructor-courses-page';
import { ApiError, type ApiClient, type ApiRequestOptions } from '../../src/shared/api';
import {
  instructorCourseCollectionQueryPrefix,
  instructorCourseQueryKey,
  type SessionCacheEpoch,
} from '../../src/shared/api/query-keys';
import { LocaleProvider, useLocale, type Locale } from '../../src/shared/locale';

const instructor = {
  email: 'instructor@example.test',
  name: 'Ada',
  surname: 'Lovelace',
  role: 'instructor',
  birthday: null,
  phone_number: null,
  created_at: '2026-08-08T00:00:00Z',
};

const INSTRUCTOR_COURSE_EDITOR_STYLES = readFileSync(
  pathToFileURL(
    resolve(
      process.cwd(),
      'src/pages/instructor-course-editor-page/InstructorCourseEditorPage.module.css',
    ),
  ),
  'utf8',
);

function cssDeclarationBlock(source: string, selectorStart: string): string {
  const selectorOffset = source.indexOf(selectorStart);
  expect(selectorOffset).toBeGreaterThanOrEqual(0);
  const blockStart = source.indexOf('{', selectorOffset);
  const blockEnd = source.indexOf('}', blockStart);
  expect(blockEnd).toBeGreaterThan(blockStart);
  return source.slice(blockStart + 1, blockEnd);
}
const course = {
  id: 7,
  title: 'Verified course',
  description: null,
  price: '10.00',
  currency: 'USD',
  published_at: null,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
  instructor: { id: 3, name: 'Ada', surname: 'Lovelace' },
  lessons: [
    {
      id: 8,
      course_id: 7,
      title: 'Existing lesson',
      lesson_type: 'video',
      download_url: '/unrendered.mp4',
      description: null,
      is_published: false,
      created_at: '2026-08-08T00:00:00Z',
      updated_at: '2026-08-08T00:00:00Z',
    },
  ],
};
const tokenStore: AccessTokenStore = { get: () => 'token', set: () => {}, clear: () => {} };

function createTokenStore(initialToken: string): AccessTokenStore {
  let token: string | null = initialToken;
  return {
    get: () => token,
    set: (nextToken) => {
      token = nextToken;
    },
    clear: () => {
      token = null;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface LocaleTestControlProps {
  readonly locale: Locale;
}

function LocaleTestControl({ locale }: LocaleTestControlProps) {
  const { setLocale } = useLocale();
  return (
    <button
      type="button"
      aria-label={`Set test locale to ${locale}`}
      onClick={() => setLocale(locale)}
    >
      Set test locale to {locale}
    </button>
  );
}

async function setTestLocale(locale: Locale) {
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: `Set test locale to ${locale}` }));
}

function decode<TResponse, TBody>(
  options: ApiRequestOptions<TBody, TResponse>,
  value: unknown,
): TResponse {
  if (!options.decode) throw new Error('Expected a decoder');
  return options.decode(value);
}

async function renderPage(
  client: ApiClient,
  initialEntry = '/instructor/courses/7/edit',
  locale: Locale = 'en',
  includeSessionEndControl = false,
  sessionStore: AccessTokenStore = tokenStore,
  sessionEpochRef?: SessionEpochRef,
) {
  const queryClient = createAppQueryClient();
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider initialLocale={locale}>
          <LocaleTestControl locale="en" />
          <LocaleTestControl locale="ru" />
          <LocaleTestControl locale="uz" />
          <SessionProvider client={client} tokenStore={sessionStore}>
            {sessionEpochRef ? <SessionEpochProbe epochRef={sessionEpochRef} /> : null}
            <MemoryRouter initialEntries={[initialEntry]}>
              {includeSessionEndControl ? <EditorTestControls /> : null}
              <Routes>
                <Route
                  path="/instructor/courses/:courseId/edit"
                  element={<InstructorCourseEditorPage />}
                />
              </Routes>
            </MemoryRouter>
          </SessionProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );
  });
  return queryClient;
}

async function renderEditorWithCoursesDestination(
  client: ApiClient,
  sessionEpochRef?: SessionEpochRef,
) {
  const queryClient = createAppQueryClient();
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider initialLocale="en">
          <SessionProvider client={client} tokenStore={tokenStore}>
            {sessionEpochRef ? <SessionEpochProbe epochRef={sessionEpochRef} /> : null}
            <MemoryRouter initialEntries={['/instructor/courses/7/edit']}>
              <Routes>
                <Route
                  path="/instructor/courses/:courseId/edit"
                  element={<InstructorCourseEditorPage />}
                />
                <Route path="/instructor/courses" element={<InstructorCoursesPage />} />
              </Routes>
            </MemoryRouter>
          </SessionProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );
  });
  return queryClient;
}

function EditorTestControls() {
  const session = useSession();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => session.clearSession()}>
        End instructor session
      </button>
      <button type="button" onClick={() => session.acceptAccessToken('token-b')}>
        Switch to instructor B
      </button>
      <button type="button" onClick={() => session.acceptAccessToken('token-a')}>
        Switch to instructor A
      </button>
      <button type="button" onClick={() => navigate('/instructor/courses/8/edit')}>
        Open course B
      </button>
    </>
  );
}

async function settleQueryClient(queryClient: QueryClient): Promise<void> {
  await vi.waitFor(() => {
    expect(queryClient.isMutating()).toBe(0);
    expect(queryClient.isFetching()).toBe(0);
  });
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

async function getResolvedEditorAction(action: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  return screen.getByRole('button', { name: action });
}

function expectContextualReturnBeforeEditorHeading(currentLabel = 'Edit course') {
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const returnLink = within(breadcrumb).getByRole('link', { name: 'Instructor courses' });
  const heading = screen.getByRole('heading', { level: 1, name: 'Edit course' });

  expect(returnLink.getAttribute('href')).toBe('/instructor/courses');
  expect(
    within(breadcrumb).getByText(currentLabel, { selector: '[aria-current="page"]' }),
  ).toBeTruthy();
  expect(
    returnLink.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

describe('InstructorCourseEditorPage', () => {
  it('keeps the upload-failure recovery typography in its dedicated local rule', () => {
    const recoveryRule = cssDeclarationBlock(
      INSTRUCTOR_COURSE_EDITOR_STYLES,
      '.createdLessonUploadRecoveryLink,',
    );

    expect(recoveryRule).toContain('font-size: var(--type-body-md-size);');
    expect(recoveryRule).toContain('font-weight: var(--font-weight-medium);');
    expect(recoveryRule).toContain('line-height: var(--type-body-md-lh);');
  });

  it.each([
    ['en', 'Save changes'],
    ['ru', 'Сохранить изменения'],
    ['uz', 'O‘zgarishlarni saqlash'],
  ] as const)(
    'renders the immutable save-course control label in %s',
    async (locale, saveLabel) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET')
          return decode(options, course);
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };

      await renderPage({ request }, '/instructor/courses/7/edit', locale);
      expect(await getResolvedEditorAction(saveLabel)).toBeTruthy();
    },
  );

  it('removes course retry after a retained failure loses its private cache epoch', async () => {
    const courseRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      courseRequests.push(options);
      throw new ApiError({ kind: 'server', status: 500, message: 'private' });
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(courseRequests).toHaveLength(1);

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'End instructor session' }));
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
    expect(courseRequests).toHaveLength(1);
  });

  it('keeps course retry available while its current private cache epoch remains active', async () => {
    let allowSuccess = false;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (!allowSuccess) throw new ApiError({ kind: 'server', status: 500, message: 'private' });
      return decode(options, course);
    };

    await renderPage({ request });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    allowSuccess = true;
    await act(async () => {
      await userEvent.setup().click(retry);
    });

    expect(
      (await screen.findByRole('textbox', { name: 'Course title' })).getAttribute('value'),
    ).toBe(course.title);
  });

  it('ignores a delayed save after its course owner changes', async () => {
    let resolveUpdate: (value: unknown) => void = () => {};
    const updateResponse = new Promise<unknown>((resolve) => {
      resolveUpdate = resolve;
    });
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/8' && options.method === 'GET')
        return decode(options, { ...course, id: 8, title: 'Course B' });
      if (options.path === '/courses/7' && options.method === 'PATCH')
        return decode(options, await updateResponse);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true);
    const user = userEvent.setup();
    const courseTitle = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      await user.clear(courseTitle);
      await user.type(courseTitle, 'Save from course A');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open course B' }));
    });
    expect(
      ((await screen.findByRole('textbox', { name: 'Course title' })) as HTMLInputElement).value,
    ).toBe('Course B');

    await act(async () => {
      resolveUpdate({ ...course, title: 'Saved A response' });
      await updateResponse;
    });
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: 'Course title' }) as HTMLInputElement).value,
      ).toBe('Course B'),
    );
  });

  it('uses the current save normalized response after dirty course edits', async () => {
    let resolveUpdate: (value: unknown) => void = () => {};
    const updateResponse = new Promise<unknown>((resolve) => {
      resolveUpdate = resolve;
    });
    let updateRequestCount = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'PATCH') {
        updateRequestCount += 1;
        return decode(options, await updateResponse);
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request });
    const user = userEvent.setup();
    const courseTitle = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      await user.clear(courseTitle);
      await user.type(courseTitle, 'Dirty local title');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    await waitFor(() => expect(updateRequestCount).toBe(1));
    await act(async () => {
      resolveUpdate({ ...course, instructor_id: 3, title: 'Normalized server title' });
      await updateResponse;
    });
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: 'Course title' }) as HTMLInputElement).value,
      ).toBe('Normalized server title'),
    );
  });

  it('does not continue a stale create response with an upload under another owner', async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    const createResponse = new Promise<unknown>((resolve) => {
      resolveCreate = resolve;
    });
    const mutationPaths: string[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/8' && options.method === 'GET')
        return decode(options, { ...course, id: 8, title: 'Course B' });
      if (options.path === '/courses/7/lessons' && options.method === 'POST') {
        mutationPaths.push(options.path);
        return decode(options, await createResponse);
      }
      if (options.path === '/lessons/9/upload-file' && options.method === 'POST') {
        mutationPaths.push(options.path);
        return decode(options, {
          lesson_id: 9,
          upload_id: '0123456789abcdef0123456789abcdef',
          status: 'queued',
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true);
    const user = userEvent.setup();
    const addLesson = await screen.findByRole('button', { name: 'Add lesson' });
    await act(async () => {
      await user.click(addLesson);
    });
    const lessonTitle = await screen.findByRole('textbox', { name: 'Lesson title' });
    await act(async () => {
      await user.type(lessonTitle, 'Delayed PDF');
      await user.click(screen.getByRole('combobox', { name: 'Lesson type' }));
    });
    const pdfOption = await screen.findByRole('option', { name: 'PDF' });
    await act(async () => {
      await user.click(pdfOption);
      fireEvent.change(screen.getByLabelText('Lesson file (optional)'), {
        target: { files: [new File(['pdf'], 'delayed.pdf', { type: 'application/pdf' })] },
      });
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });
    await waitFor(() => expect(mutationPaths).toEqual(['/courses/7/lessons']));
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open course B' }));
    });
    await act(async () => {
      resolveCreate({ ...course.lessons[0], id: 9, lesson_type: 'pdf', title: 'Delayed PDF' });
      await createResponse;
    });
    await waitFor(() => expect(mutationPaths).toEqual(['/courses/7/lessons']));
  });

  it('does not focus a stale create after its refresh waits across an owner change', async () => {
    let courseReads = 0;
    let resolveStaleRefresh: (value: unknown) => void = () => {};
    const staleRefresh = new Promise<unknown>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') {
        courseReads += 1;
        return decode(options, courseReads === 1 ? course : await staleRefresh);
      }
      if (options.path === '/courses/8' && options.method === 'GET')
        return decode(options, { ...course, id: 8, title: 'Course B' });
      if (options.path === '/courses/7/lessons' && options.method === 'POST')
        return decode(options, { ...course.lessons[0], id: 9, title: 'Created lesson' });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true);
    const user = userEvent.setup();
    const addLesson = await screen.findByRole('button', { name: 'Add lesson' });
    await act(async () => {
      await user.click(addLesson);
    });
    const lessonTitle = await screen.findByRole('textbox', { name: 'Lesson title' });
    await act(async () => {
      await user.type(lessonTitle, 'Created lesson');
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });
    await waitFor(() => expect(courseReads).toBeGreaterThan(1));
    const openCourseB = screen.getByRole('button', { name: 'Open course B' });
    await act(async () => {
      await user.click(openCourseB);
    });
    expect(document.activeElement).toBe(openCourseB);
    await act(async () => {
      resolveStaleRefresh(course);
      await staleRefresh;
    });
    await waitFor(() => expect(document.activeElement).toBe(openCourseB));
  });

  it('keeps a delayed delete from navigating after the session changes A to B to A', async () => {
    let resolveDelete: (value: unknown) => void = () => {};
    const deleteResponse = new Promise<unknown>((resolve) => {
      resolveDelete = resolve;
    });
    const sessionStore = createTokenStore('token-a');
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'DELETE')
        return decode(options, await deleteResponse);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true, sessionStore);
    const user = userEvent.setup();
    const deleteCourse = await screen.findByRole('button', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteCourse);
      await user.click(screen.getByRole('button', { name: 'Delete course' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Switch to instructor B' }));
      await user.click(screen.getByRole('button', { name: 'Switch to instructor A' }));
    });
    await act(async () => {
      resolveDelete({ message: 'Course deleted.' });
      await deleteResponse;
    });
    expect(await screen.findByRole('heading', { name: 'Edit course' })).toBeTruthy();
  });

  it('does not retain a stale A delete failure after A to B to A and logout', async () => {
    let rejectDelete: (reason: unknown) => void = () => {};
    const deleteResponse = new Promise<unknown>((_resolve, reject) => {
      rejectDelete = reject;
    });
    void deleteResponse.catch(() => {});
    const sessionStore = createTokenStore('token-a');
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'DELETE')
        return decode(options, await deleteResponse);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true, sessionStore);
    const user = userEvent.setup();
    const deleteCourse = await screen.findByRole('button', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteCourse);
      await user.click(screen.getByRole('button', { name: 'Delete course' }));
      await user.click(screen.getByRole('button', { name: 'Switch to instructor B' }));
      await user.click(screen.getByRole('button', { name: 'Switch to instructor A' }));
      rejectDelete(
        new ApiError({ kind: 'not_found', status: 404, message: 'PRIVATE_STALE_A_DELETE_DETAIL' }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'End instructor session' }));
    });

    await waitFor(() => expect(screen.queryByText('PRIVATE_STALE_A_DELETE_DETAIL')).toBeNull());
  });

  it('clears an open destructive confirmation when the editor owner changes', async () => {
    const deleteRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/8' && options.method === 'GET')
        return decode(options, { ...course, id: 8, title: 'Course B' });
      if (options.method === 'DELETE') {
        deleteRequests.push(options);
        return decode(options, { message: 'Deleted.' });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true);
    const user = userEvent.setup();
    const deleteCourse = await screen.findByRole('button', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteCourse);
    });
    expect(await screen.findByRole('dialog', { name: 'Delete this course?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open course B' }));
    expect(
      ((await screen.findByRole('textbox', { name: 'Course title' })) as HTMLInputElement).value,
    ).toBe('Course B');
    expect(screen.queryByRole('dialog', { name: 'Delete this course?' })).toBeNull();
    expect(deleteRequests).toHaveLength(0);
  });

  it('releases a pending A delete so B can open its own destructive confirmation', async () => {
    let resolveDeleteA: (value: unknown) => void = () => {};
    const deleteA = new Promise<unknown>((resolve) => {
      resolveDeleteA = resolve;
    });
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/8' && options.method === 'GET')
        return decode(options, { ...course, id: 8, title: 'Course B' });
      if (options.path === '/courses/7' && options.method === 'DELETE')
        return decode(options, await deleteA);
      if (options.path === '/courses/8' && options.method === 'DELETE')
        return decode(options, { message: 'Course B deleted.' });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true);
    const user = userEvent.setup();
    const deleteAButton = await screen.findByRole('button', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteAButton);
    });
    const deleteADialog = await screen.findByRole('dialog', { name: 'Delete this course?' });
    await act(async () => {
      await user.click(within(deleteADialog).getByRole('button', { name: 'Delete course' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deleting course...' })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open course B' }));
    await screen.findByRole('textbox', { name: 'Course title' });
    const deleteBButton = screen.getByRole('button', { name: 'Delete course' });
    expect((deleteBButton as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      await user.click(deleteBButton);
    });
    expect(await screen.findByRole('dialog', { name: 'Delete this course?' })).toBeTruthy();

    await act(async () => {
      resolveDeleteA({ message: 'Course A deleted.' });
      await deleteA;
    });
    expect(screen.getByRole('dialog', { name: 'Delete this course?' })).toBeTruthy();
  });

  it('does not refresh after a create response loses its session before the callback continues', async () => {
    let courseReads = 0;
    let resolveCreate: (value: unknown) => void = () => {};
    const createResponse = new Promise<unknown>((resolve) => {
      resolveCreate = resolve;
    });
    const sessionStore = createTokenStore('token-a');
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') {
        courseReads += 1;
        return decode(options, course);
      }
      if (options.path === '/courses/7/lessons' && options.method === 'POST')
        return decode(options, await createResponse);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true, sessionStore);
    const user = userEvent.setup();
    const addLesson = await screen.findByRole('button', { name: 'Add lesson' });
    await act(async () => {
      await user.click(addLesson);
    });
    const lessonTitle = await screen.findByRole('textbox', { name: 'Lesson title' });
    await act(async () => {
      await user.type(lessonTitle, 'Session-bound lesson');
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });
    const readsBeforeResponse = courseReads;
    await act(async () => {
      resolveCreate({ ...course.lessons[0], id: 9, title: 'Session-bound lesson' });
      fireEvent.click(screen.getByRole('button', { name: 'Switch to instructor B' }));
      await createResponse;
    });
    await waitFor(() => expect(courseReads).toBe(readsBeforeResponse + 1));
  });

  it('does not carry a failed A delete into B destructive confirmation', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/8' && options.method === 'GET')
        return decode(options, { ...course, id: 8, title: 'Course B' });
      if (options.path === '/courses/7' && options.method === 'DELETE')
        throw new ApiError({ kind: 'not_found', status: 404, message: 'PRIVATE_A_DELETE_DETAIL' });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/7/edit', 'en', true);
    const user = userEvent.setup();
    const deleteCourse = await screen.findByRole('button', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteCourse);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Delete this course?' });
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Delete course' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open course B' }));
    await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Delete course' }));
    });
    expect(await screen.findByRole('dialog', { name: 'Delete this course?' })).toBeTruthy();
    expect(screen.queryByText('PRIVATE_A_DELETE_DETAIL')).toBeNull();
  });

  it.each([
    ['en', ['Video', 'Text', 'PDF']],
    ['ru', ['Видео', 'Текст', 'PDF']],
    ['uz', ['Video', 'Matn', 'PDF']],
  ] as const)(
    'renders immutable lesson types through localized instructor labels in %s',
    async (locale, lessonTypeLabels) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET')
          return decode(options, {
            ...course,
            lessons: [
              { ...course.lessons[0], id: 8, title: 'Video lesson', lesson_type: 'video' },
              { ...course.lessons[0], id: 9, title: 'Text lesson', lesson_type: 'text' },
              { ...course.lessons[0], id: 10, title: 'PDF lesson', lesson_type: 'pdf' },
            ],
          });
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };

      await renderPage({ request }, '/instructor/courses/7/edit', locale);
      for (const [index, label] of lessonTypeLabels.entries()) {
        const lessonTitle = ['Video lesson', 'Text lesson', 'PDF lesson'][index]!;
        const lessonRow = (await screen.findByRole('heading', { name: lessonTitle })).closest('li');
        expect(lessonRow).not.toBeNull();
        expect(
          within(lessonRow!).getByText(
            (_, element) => element?.tagName === 'P' && element.textContent?.startsWith(label),
          ),
        ).toBeTruthy();
      }
    },
  );

  it.each([
    ['en', 'Breadcrumb', 'This course address is not valid.'],
    ['ru', 'Хлебные крошки', 'Адрес курса указан неверно.'],
    ['uz', 'Yo‘l ko‘rsatkich', 'Kurs manzili noto‘g‘ri.'],
  ] as const)(
    'localizes the invalid course address and breadcrumb accessible name in %s',
    async (locale, breadcrumbName, invalidAddress) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };

      await renderPage({ request }, '/instructor/courses/not-a-course/edit', locale);
      expect(await screen.findByText(invalidAddress)).toBeTruthy();
      expect(screen.getByRole('navigation', { name: breadcrumbName })).toBeTruthy();
    },
  );

  it.each([
    [
      'ru',
      'Удалить курс',
      'Удалить этот курс?',
      'Удалить курс «Verified course»? Это действие необратимо.',
      'Удалить урок',
      'Удалить этот урок?',
      'Удалить урок «Existing lesson»? Это действие необратимо.',
    ],
    [
      'uz',
      'Kursni o‘chirish',
      'Bu kurs o‘chirilsinmi?',
      'Verified course kursi o‘chirilsinmi? Bu amalni ortga qaytarib bo‘lmaydi.',
      'Darsni o‘chirish',
      'Bu dars o‘chirilsinmi?',
      'Existing lesson darsi o‘chirilsinmi? Bu amalni ortga qaytarib bo‘lmaydi.',
    ],
  ] as const)(
    'renders localized destructive dialog copy in %s',
    async (
      locale,
      courseAction,
      courseDialogName,
      courseDescription,
      lessonAction,
      lessonDialogName,
      lessonDescription,
    ) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET')
          return decode(options, course);
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      await renderPage({ request }, '/instructor/courses/7/edit', locale);
      const user = userEvent.setup();
      const deleteCourse = await getResolvedEditorAction(courseAction);

      await act(async () => {
        await user.click(deleteCourse);
      });
      expect((await screen.findByRole('dialog', { name: courseDialogName })).textContent).toContain(
        courseDescription,
      );
      await act(async () => {
        await user.keyboard('{Escape}');
      });

      await act(async () => {
        await user.click(await getResolvedEditorAction(lessonAction));
      });
      expect((await screen.findByRole('dialog', { name: lessonDialogName })).textContent).toContain(
        lessonDescription,
      );
    },
  );

  it.each([
    ['ru', 'Удалить урок', 'Удалить этот урок?', 'Курс или урок больше недоступен.'],
    ['uz', 'Darsni o‘chirish', 'Bu dars o‘chirilsinmi?', 'Kurs yoki dars endi mavjud emas.'],
  ] as const)(
    'renders a localized delete failure in %s',
    async (locale, action, dialogName, failureMessage) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET')
          return decode(options, course);
        if (options.method === 'DELETE')
          throw new ApiError({ kind: 'not_found', status: 404, message: 'PRIVATE_DELETE_DETAIL' });
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      await renderPage({ request }, '/instructor/courses/7/edit', locale);
      const user = userEvent.setup();
      const deleteAction = await getResolvedEditorAction(action);
      await act(async () => {
        await user.click(deleteAction);
      });
      const dialog = await screen.findByRole('dialog', { name: dialogName });
      await act(async () => {
        await user.click(within(dialog).getByRole('button', { name: action }));
      });
      expect(await screen.findByText(failureMessage)).toBeTruthy();
      expect(screen.queryByText('PRIVATE_DELETE_DETAIL')).toBeNull();
    },
  );

  it.each([
    ['ru', 401, 'Удалить урок', 'Удалить этот урок?', 'Войдите снова, чтобы продолжить.'],
    ['ru', 403, 'Удалить урок', 'Удалить этот урок?', 'У вас нет прав на изменение этого курса.'],
    ['uz', 401, 'Darsni o‘chirish', 'Bu dars o‘chirilsinmi?', 'Davom etish uchun qayta kiring.'],
    [
      'uz',
      403,
      'Darsni o‘chirish',
      'Bu dars o‘chirilsinmi?',
      'Bu kursni o‘zgartirish huquqingiz yo‘q.',
    ],
  ] as const)(
    'renders the localized delete authorization failure in %s (%i)',
    async (locale, status, action, dialogName, failureMessage) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET')
          return decode(options, course);
        if (options.method === 'DELETE')
          throw new ApiError({ kind: 'http', status, message: 'PRIVATE_AUTHORIZATION_DETAIL' });
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      await renderPage({ request }, '/instructor/courses/7/edit', locale);
      const user = userEvent.setup();
      const deleteAction = await getResolvedEditorAction(action);
      await act(async () => {
        await user.click(deleteAction);
      });
      const dialog = await screen.findByRole('dialog', { name: dialogName });
      await act(async () => {
        await user.click(within(dialog).getByRole('button', { name: action }));
      });
      expect(await screen.findByText(failureMessage)).toBeTruthy();
      expect(screen.queryByText('PRIVATE_AUTHORIZATION_DETAIL')).toBeNull();
    },
  );

  it('renders the contextual return before the editor heading in invalid, loading, error, and resolved states', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request }, '/instructor/courses/not-an-id/edit');
    expectContextualReturnBeforeEditorHeading();

    cleanup();
    await renderPage({
      request: async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET') return new Promise(() => {});
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      },
    });
    expect(await screen.findByLabelText('Loading course editor')).toBeTruthy();
    expectContextualReturnBeforeEditorHeading();

    cleanup();
    await renderPage({
      request: async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET') {
          throw new ApiError({ kind: 'not_found', status: 404, message: 'PRIVATE_LOAD_DETAIL' });
        }
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      },
    });
    expect(await screen.findByText('This course is no longer available.')).toBeTruthy();
    expectContextualReturnBeforeEditorHeading();

    cleanup();
    await renderPage({ request });
    expect(await screen.findByRole('heading', { name: 'Edit course' })).toBeTruthy();
    expectContextualReturnBeforeEditorHeading('Verified course');
  });

  it('separates course editing, the empty lesson action, and the danger zone', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET')
        return decode(options, { ...course, lessons: [] });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();

    expect(await screen.findByText('Review course information and lessons.')).toBeTruthy();
    const details = (await screen.findByRole('heading', { name: 'Course details' })).closest(
      'section',
    );
    const dangerZone = (await screen.findByRole('heading', { name: 'Danger zone' })).closest(
      'section',
    );
    if (!details || !dangerZone) throw new Error('Expected editor sections');
    expect(within(details).getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(
      within(details).getByRole('spinbutton', { name: 'Price' }).hasAttribute('required'),
    ).toBe(true);
    expect(
      within(details).getByRole('textbox', { name: 'Currency' }).hasAttribute('required'),
    ).toBe(true);
    expect(within(details).queryByRole('button', { name: 'Delete course' })).toBeNull();
    expect(within(dangerZone).getByRole('button', { name: 'Delete course' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No lessons yet' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Create lesson' })).toBeNull();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Add lesson' }));
    });
    const createLesson = screen.getByRole('heading', { name: 'Create lesson' }).closest('section');
    if (!createLesson) throw new Error('Expected create-lesson section');
    expect(
      createLesson.compareDocumentPosition(dangerZone) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Lesson title' })),
    );
  });

  it('creates only verified lesson fields and returns focus after cancelling the identified delete', async () => {
    const createRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7/lessons' && options.method === 'POST') {
        createRequests.push(options);
        return decode(options, { ...course.lessons[0], id: 9, title: 'New lesson' });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderPage(
      { request },
      undefined,
      undefined,
      false,
      tokenStore,
      sessionEpochRef,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Edit course' })).toBeTruthy();
    const returnLink = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole(
      'link',
      {
        name: 'Instructor courses',
      },
    );
    expect(returnLink.getAttribute('href')).toBe('/instructor/courses');
    returnLink.focus();
    expect(document.activeElement).toBe(returnLink);

    const deleteLesson = screen.getByRole('button', { name: 'Delete lesson' });
    await act(async () => {
      await user.click(deleteLesson);
    });
    expect(await screen.findByRole('dialog', { name: 'Delete this lesson?' })).toBeTruthy();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    await waitFor(() => expect(document.activeElement).toBe(deleteLesson));

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Add lesson' }));
    });
    const lessonTitle = screen.getByRole('textbox', { name: 'Lesson title' });
    await act(async () => {
      await user.type(lessonTitle, 'New lesson');
    });
    fireEvent.click(screen.getByRole('combobox', { name: 'Lesson type' }));
    await act(async () => {
      await user.click(screen.getByRole('option', { name: 'PDF' }));
    });
    await act(async () => {
      await user.type(
        screen.getAllByRole('textbox', { name: 'Description' })[1]!,
        'Verified notes',
      );
      await user.click(screen.getByRole('checkbox', { name: 'Publish this lesson' }));
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });
    await waitFor(() => expect(createRequests).toHaveLength(1));
    expect(createRequests[0]?.body).toEqual({
      title: 'New lesson',
      lesson_type: 'pdf',
      description: 'Verified notes',
      is_published: true,
    });
    expect(createRequests[0]?.body).not.toHaveProperty('download_url');
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: instructorCourseQueryKey(expect.any(String), 7),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseCollectionQueryPrefix(expect.any(String)),
    });
  });

  it('creates a PDF lesson before uploading its optional selected file with the returned lesson id', async () => {
    const mutationRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7/lessons' && options.method === 'POST') {
        mutationRequests.push(options);
        return decode(options, {
          ...course.lessons[0],
          id: 9,
          title: 'PDF with source',
          lesson_type: 'pdf',
        });
      }
      if (options.path === '/lessons/9/upload-file' && options.method === 'POST') {
        mutationRequests.push(options);
        return decode(options, {
          lesson_id: 9,
          upload_id: '0123456789abcdef0123456789abcdef',
          status: 'queued',
          detail: 'File accepted and queued for processing',
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const queryClient = await renderPage({ request });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Edit course' });
    const pdf = new File(['pdf'], 'react-notes.pdf', { type: 'application/pdf' });
    await act(async () => await user.click(screen.getByRole('button', { name: 'Add lesson' })));
    await act(async () => {
      await user.type(screen.getByRole('textbox', { name: 'Lesson title' }), 'PDF with source');
    });
    await act(async () => await user.click(screen.getByRole('combobox', { name: 'Lesson type' })));
    await act(async () => await user.click(screen.getByRole('option', { name: 'PDF' })));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Lesson file (optional)'), {
        target: { files: [pdf] },
      });
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
      await settleQueryClient(queryClient);
    });

    await waitFor(() => expect(mutationRequests).toHaveLength(2));
    expect(mutationRequests.map(({ path }) => path)).toEqual([
      '/courses/7/lessons',
      '/lessons/9/upload-file',
    ]);
    expect(mutationRequests[1]?.body).toBeInstanceOf(FormData);
    expect((mutationRequests[1]?.body as FormData).get('file')).toBe(pdf);
    expect(screen.queryByRole('heading', { name: 'Create lesson' })).toBeNull();
  });

  it('retains the file help alongside the error when a lesson file is invalid', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Edit course' });
    await act(async () => user.click(await screen.findByRole('button', { name: 'Add lesson' })));
    await act(async () => await user.click(screen.getByRole('combobox', { name: 'Lesson type' })));
    await act(async () => await user.click(screen.getByRole('option', { name: 'PDF' })));
    const file = screen.getByLabelText('Lesson file (optional)');
    await act(async () => {
      fireEvent.change(file, {
        target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] },
      });
    });

    expect(file.getAttribute('aria-invalid')).toBe('true');
    expect(file.getAttribute('aria-describedby')).toContain('create-lesson-file-help');
    expect(file.getAttribute('aria-describedby')).toContain('create-lesson-file-error');
  });

  it('rechecks an invalid optional lesson file on submit without creating a lesson', async () => {
    const createRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7/lessons' && options.method === 'POST') {
        createRequests.push(options);
        return decode(options, course.lessons[0]);
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Edit course' });
    await act(async () => await user.click(screen.getByRole('button', { name: 'Add lesson' })));
    await act(async () => {
      await user.type(screen.getByRole('textbox', { name: 'Lesson title' }), 'PDF source');
    });
    await act(async () => {
      await user.click(screen.getByRole('combobox', { name: 'Lesson type' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('option', { name: 'PDF' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Lesson file (optional)'), {
        target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] },
      });
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });

    expect(createRequests).toHaveLength(0);
    expect(
      screen.getByText('Choose a file that matches the stated type and size limit.'),
    ).toBeTruthy();
  });

  it('keeps a created lesson and offers its editor when the automatic file upload fails', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7/lessons' && options.method === 'POST')
        return decode(options, {
          ...course.lessons[0],
          id: 9,
          title: 'Created before upload failure',
          lesson_type: 'pdf',
        });
      if (options.path === '/lessons/9/upload-file' && options.method === 'POST')
        throw new Error('private upload failure');
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const queryClient = await renderPage({ request });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Edit course' });
    await act(async () => await user.click(screen.getByRole('button', { name: 'Add lesson' })));
    await act(async () => {
      await user.type(
        screen.getByRole('textbox', { name: 'Lesson title' }),
        'Created before upload failure',
      );
    });
    await act(async () => await user.click(screen.getByRole('combobox', { name: 'Lesson type' })));
    await act(async () => await user.click(screen.getByRole('option', { name: 'PDF' })));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Lesson file (optional)'), {
        target: { files: [new File(['pdf'], 'react-notes.pdf', { type: 'application/pdf' })] },
      });
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
      await settleQueryClient(queryClient);
    });

    expect(
      await screen.findByText('Lesson created, but the file could not be uploaded.'),
    ).toBeTruthy();
    const recoveryLink = screen
      .getAllByRole('link', { name: 'Edit lesson' })
      .find((link) => link.getAttribute('href') === '/instructor/lessons/9/edit');
    expect(recoveryLink).toBeTruthy();
    expect(recoveryLink?.getAttribute('href')).toBe('/instructor/lessons/9/edit');
    expect(
      recoveryLink?.classList.contains(
        instructorCourseEditorStyles.createdLessonUploadRecoveryLink,
      ),
    ).toBe(true);
    expect(screen.queryByText('private upload failure')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Create lesson' })).toBeNull();
  });

  it('shows that text lessons need no file and removes the file control', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Edit course' });
    await act(async () => user.click(await screen.findByRole('button', { name: 'Add lesson' })));
    expect(screen.getByLabelText('Lesson file (optional)')).toBeTruthy();
    await act(async () => await user.click(screen.getByRole('combobox', { name: 'Lesson type' })));
    await act(async () => await user.click(screen.getByRole('option', { name: 'Text' })));

    expect(screen.queryByLabelText('Lesson file (optional)')).toBeNull();
    expect(screen.getByText('File upload is unavailable for text lessons.')).toBeTruthy();
  });

  it('keeps local required-title feedback associated with the field and prevents a mutation', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7') return decode(options, course);
      throw new Error('Mutation should not run');
    });
    await renderPage({ request } as ApiClient);
    const courseTitle = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      fireEvent.change(courseTitle, { target: { value: '' } });
      fireEvent.submit(courseTitle.closest('form') as HTMLFormElement);
    });
    expect((await screen.findAllByText('Enter a course title.')).length).toBeGreaterThan(0);
    expect(courseTitle.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(courseTitle);
    expect(
      request.mock.calls.map(([options]) => (options as ApiRequestOptions).method),
    ).not.toContain('PATCH');
  });

  it('maps a verified course 422 issue to the named field without exposing server detail', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'PATCH') {
        throw new ApiError({
          kind: 'validation',
          status: 422,
          message: 'PRIVATE_COURSE_TITLE_DETAIL',
          issues: [
            {
              location: ['body', 'title'],
              message: 'PRIVATE_COURSE_TITLE_DETAIL',
              type: 'missing',
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const courseTitle = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
    });

    expect(await screen.findByText('Course title is required.')).toBeTruthy();
    expect(courseTitle.getAttribute('aria-invalid')).toBe('true');
    expect(courseTitle.getAttribute('aria-describedby')).toContain('error');
    await waitFor(() => expect(document.activeElement).toBe(courseTitle));
    expect(screen.queryByText('PRIVATE_COURSE_TITLE_DETAIL')).toBeNull();
  });

  it('resolves a persistent 422 field descriptor in EN, RU and UZ without clearing the input', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'PATCH') {
        throw new ApiError({
          kind: 'validation',
          status: 422,
          message: 'PRIVATE_LOCALE_SWITCH_DETAIL',
          issues: [
            {
              location: ['body', 'title'],
              message: 'PRIVATE_LOCALE_SWITCH_DETAIL',
              type: 'missing',
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      await user.clear(title);
      await user.type(title, 'Persistent title');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    expect(await screen.findByText('Course title is required.')).toBeTruthy();
    expect(title.getAttribute('aria-describedby')).toContain('error');
    expect((title as HTMLInputElement).value).toBe('Persistent title');
    await act(async () => {
      await setTestLocale('ru');
    });
    expect(await screen.findByText('Название курса обязательно.')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Название курса' }) as HTMLInputElement).value,
    ).toBe('Persistent title');
    await act(async () => {
      await setTestLocale('uz');
    });
    expect(await screen.findByText('Kurs nomi kiritilishi shart.')).toBeTruthy();
    expect(screen.queryByText('PRIVATE_LOCALE_SWITCH_DETAIL')).toBeNull();
  });

  it('settles an in-flight course mutation through the current locale without duplicate writes', async () => {
    let rejectUpdate: (reason: unknown) => void = () => {};
    const updateResponse = new Promise<never>((_resolve, reject) => {
      rejectUpdate = reject;
    });
    const updateRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'PATCH') {
        updateRequests.push(options);
        return decode(options, await updateResponse);
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      await user.clear(title);
      await user.type(title, 'Deferred course title');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    await waitFor(() => expect(updateRequests).toHaveLength(1));
    const saveChanges = screen.getByRole('button', { name: 'Save changes' });
    expect(saveChanges.hasAttribute('disabled')).toBe(true);
    expect(saveChanges.getAttribute('aria-busy')).toBe('true');
    expect(saveChanges.querySelector('[data-part="spinner"]')).toBeNull();
    expect(updateRequests).toHaveLength(1);
    expect((title as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      await setTestLocale('ru');
      rejectUpdate(
        new ApiError({
          kind: 'validation',
          status: 422,
          message: 'PRIVATE_DEFERRED_COURSE_DETAIL',
          issues: [
            {
              location: ['body', 'title'],
              message: 'PRIVATE_DEFERRED_COURSE_DETAIL',
              type: 'value_error',
            },
          ],
        }),
      );
    });

    const russianTitle = await screen.findByRole('textbox', { name: 'Название курса' });
    expect(
      await screen.findByText('Проверьте поле название курса и отправьте форму снова.'),
    ).toBeTruthy();
    expect(russianTitle.getAttribute('aria-describedby')).toContain('error');
    expect((russianTitle as HTMLInputElement).value).toBe('Deferred course title');
    await waitFor(() => expect(document.activeElement).toBe(russianTitle));
    expect(screen.queryByText('PRIVATE_DEFERRED_COURSE_DETAIL')).toBeNull();

    await act(async () => {
      await setTestLocale('uz');
    });
    expect(
      await screen.findByText('Iltimos, kurs nomi maydonini tekshirib, qayta yuboring.'),
    ).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Kurs nomi' }) as HTMLInputElement).value).toBe(
      'Deferred course title',
    );
  });

  it('preserves unsaved course edits when a course refetch returns the same identity', async () => {
    let courseRequestCount = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') {
        courseRequestCount += 1;
        return decode(options, { ...course, title: `Server course ${courseRequestCount}` });
      }
      if (options.path === '/courses/7/lessons' && options.method === 'POST') {
        return decode(options, { ...course.lessons[0], id: 9, title: 'New lesson' });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const courseTitle = await screen.findByRole('textbox', { name: 'Course title' });
    await act(async () => {
      await user.clear(courseTitle);
      await user.type(courseTitle, 'Unsaved instructor edit');
      await user.click(screen.getByRole('button', { name: 'Add lesson' }));
    });
    const lessonTitle = await screen.findByRole('textbox', { name: 'Lesson title' });
    await act(async () => {
      await user.type(lessonTitle, 'New lesson');
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });

    await waitFor(() => expect(courseRequestCount).toBeGreaterThan(1));
    expect((courseTitle as HTMLInputElement).value).toBe('Unsaved instructor edit');
  });

  it.each([
    'Ordinary course title',
    'Dollar $& title',
    'Dollar $` title',
    "Dollar $' title",
    'Braces {courseTitle}',
    'Unicode курс — dars',
  ])('keeps the literal destructive course title %s and returns focus on cancel', async (title) => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET')
        return decode(options, { ...course, title });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const deleteCourse = await screen.findByRole('button', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteCourse);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Delete this course?' });
    expect(dialog.textContent).toContain(title);
    const descriptionId = dialog.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? '')?.textContent).toContain(title);
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    });
    await waitFor(() => expect(document.activeElement).toBe(deleteCourse));
  });

  it.each([
    'Dollar $& lesson',
    'Dollar $` lesson',
    "Dollar $' lesson",
    'Braces {lessonTitle}',
    'Unicode урок — dars',
    'Ordinary lesson title',
  ])(
    'preserves the literal hostile lesson title %s through cancel and one exact pending delete',
    async (title) => {
      let resolveDelete: (value: unknown) => void = () => {};
      const deleteResponse = new Promise<unknown>((resolve) => {
        resolveDelete = resolve;
      });
      const deleteRequests: ApiRequestOptions[] = [];
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET') {
          return decode(options, {
            ...course,
            lessons: [{ ...course.lessons[0], title }],
          });
        }
        if (options.path === '/courses/7/lessons/8' && options.method === 'DELETE') {
          deleteRequests.push(options);
          return decode(options, await deleteResponse);
        }
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      await renderPage({ request });
      const user = userEvent.setup();
      const deleteLesson = await screen.findByRole('button', { name: 'Delete lesson' });
      await act(async () => {
        await user.click(deleteLesson);
      });
      const dialog = await screen.findByRole('dialog', { name: 'Delete this lesson?' });
      expect(dialog.textContent).toContain(title);
      const descriptionId = dialog.getAttribute('aria-describedby');
      expect(document.getElementById(descriptionId ?? '')?.textContent).toContain(title);
      await act(async () => {
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      });
      await waitFor(() => expect(document.activeElement).toBe(deleteLesson));

      await act(async () => {
        await user.click(deleteLesson);
      });
      const pendingDialog = await screen.findByRole('dialog', { name: 'Delete this lesson?' });
      const confirmation = within(pendingDialog).getByRole('button', { name: 'Delete lesson' });
      await act(async () => {
        await user.click(confirmation);
      });
      await waitFor(() => expect(deleteRequests).toHaveLength(1));
      expect(
        screen.getByRole('button', { name: 'Deleting lesson...' }).hasAttribute('disabled'),
      ).toBe(true);
      expect(deleteRequests).toHaveLength(1);
      expect(deleteRequests[0]?.path).toBe('/courses/7/lessons/8');
      expect(screen.getByRole('status').textContent).toContain('Deleting lesson...');

      await act(async () => {
        resolveDelete({ message: 'Lesson deleted.' });
        await deleteResponse;
      });
    },
  );

  it('locks all course inputs for the full pending-save duration', async () => {
    let resolveUpdate: (updatedCourse: typeof course) => void = () => {};
    const updateResponse = new Promise<typeof course>((resolve) => {
      resolveUpdate = resolve;
    });
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'PATCH') {
        return decode(options, await updateResponse);
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const courseTitle = await screen.findByRole('textbox', { name: 'Course title' });
    const description = screen.getAllByRole('textbox', { name: 'Description' })[0]!;
    const price = screen.getByRole('spinbutton', { name: 'Price' });
    const currency = screen.getByRole('textbox', { name: 'Currency' });

    await act(async () => {
      await user.clear(courseTitle);
      await user.type(courseTitle, 'Submitted course title');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
    });

    await waitFor(() => {
      expect((courseTitle as HTMLInputElement).disabled).toBe(true);
      expect((description as HTMLTextAreaElement).disabled).toBe(true);
      expect((price as HTMLInputElement).disabled).toBe(true);
      expect((currency as HTMLInputElement).disabled).toBe(true);
    });
    await user.type(courseTitle, ' post-submit edit');
    expect((courseTitle as HTMLInputElement).value).toBe('Submitted course title');

    await act(async () => {
      resolveUpdate({ ...course, title: 'Submitted course title' });
      await updateResponse;
    });
    await waitFor(() => {
      expect((courseTitle as HTMLInputElement).disabled).toBe(false);
      expect((description as HTMLTextAreaElement).disabled).toBe(false);
      expect((price as HTMLInputElement).disabled).toBe(false);
      expect((currency as HTMLInputElement).disabled).toBe(false);
      expect((courseTitle as HTMLInputElement).value).toBe('Submitted course title');
    });
  });

  it('clears a failed delete mutation when cancelling or selecting a new target', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.method === 'DELETE') {
        throw new ApiError({ kind: 'not_found', status: 404, message: 'PRIVATE_DELETE_DETAIL' });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Edit course' });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Delete lesson' }));
    });
    const deleteLessonDialog = await screen.findByRole('dialog', { name: 'Delete this lesson?' });
    await act(async () => {
      await user.click(
        within(deleteLessonDialog).getByRole('button', {
          name: 'Delete lesson',
        }),
      );
    });
    expect(await screen.findByText('This course or lesson is no longer available.')).toBeTruthy();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await user.click(screen.getByRole('button', { name: 'Delete course' }));
    });

    expect(await screen.findByRole('dialog', { name: 'Delete this course?' })).toBeTruthy();
    expect(screen.queryByText('This course or lesson is no longer available.')).toBeNull();
  });

  it.each([
    {
      openDelete: 'Delete course',
      dialogName: 'Delete this course?',
      expectedPendingLabel: 'Deleting course...',
    },
    {
      openDelete: 'Delete lesson',
      dialogName: 'Delete this lesson?',
      expectedPendingLabel: 'Deleting lesson...',
    },
  ])(
    'uses $expectedPendingLabel while the confirmed delete remains pending',
    async ({ openDelete, dialogName, expectedPendingLabel }) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/courses/7' && options.method === 'GET')
          return decode(options, course);
        if (options.method === 'DELETE') return new Promise(() => {});
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      await renderPage({ request });
      const user = userEvent.setup();

      const deleteAction = await screen.findByRole('button', { name: openDelete });
      await act(async () => {
        await user.click(deleteAction);
      });
      const dialog = screen.getByRole('dialog', { name: dialogName });
      const confirmation = within(dialog).getByRole('button', { name: openDelete });
      await act(async () => {
        await user.click(confirmation);
      });

      await waitFor(() => {
        const confirmation = screen.getByRole('button', { name: expectedPendingLabel });
        expect((confirmation as HTMLButtonElement).disabled).toBe(true);
        expect(confirmation.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole('status').textContent).toContain(expectedPendingLabel);
      });
    },
  );

  it('maps a verified create-lesson publication 422 issue to the checkbox and focuses it', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7/lessons' && options.method === 'POST') {
        throw new ApiError({
          kind: 'validation',
          status: 422,
          message: 'PRIVATE_PUBLISH_DETAIL',
          issues: [
            {
              location: ['body', 'is_published'],
              message: 'PRIVATE_PUBLISH_DETAIL',
              type: 'value_error',
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const addLesson = await screen.findByRole('button', { name: 'Add lesson' });
    await act(async () => {
      await user.click(addLesson);
    });
    const checkbox = await screen.findByRole('checkbox', { name: 'Publish this lesson' });
    await act(async () => {
      await user.type(screen.getByRole('textbox', { name: 'Lesson title' }), 'New lesson');
      await user.click(checkbox);
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });

    expect(await screen.findByText('Check publish this lesson and submit again.')).toBeTruthy();
    expect(checkbox.getAttribute('name')).toBe('is_published');
    expect(checkbox.getAttribute('aria-invalid')).toBe('true');
    expect(checkbox.getAttribute('aria-describedby')).toBe('create-lesson-is-published-error');
    await waitFor(() => expect(document.activeElement).toBe(checkbox));
    expect(screen.queryByText('PRIVATE_PUBLISH_DETAIL')).toBeNull();
  });

  it('refetches and renders a retained course after creating a lesson', async () => {
    const createdLesson = { ...course.lessons[0], id: 9, title: 'Refetched created lesson' };
    let courseReads = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') {
        courseReads += 1;
        return decode(
          options,
          courseReads === 1 ? course : { ...course, lessons: [...course.lessons, createdLesson] },
        );
      }
      if (options.path === '/courses/7/lessons' && options.method === 'POST')
        return decode(options, createdLesson);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderPage(
      { request },
      undefined,
      undefined,
      false,
      tokenStore,
      sessionEpochRef,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    const addLesson = await screen.findByRole('button', { name: 'Add lesson' });
    const epoch = capturedSessionEpoch(sessionEpochRef);
    await act(async () => {
      await user.click(addLesson);
    });
    const lessonTitle = await screen.findByRole('textbox', { name: 'Lesson title' });
    await act(async () => {
      await user.type(lessonTitle, createdLesson.title);
      await user.click(screen.getByRole('button', { name: 'Create lesson' }));
    });

    expect(await screen.findByText(createdLesson.title)).toBeTruthy();
    expect(courseReads).toBe(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseQueryKey(epoch, 7),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseCollectionQueryPrefix(epoch),
    });
  });

  it('refetches and renders the normalized course after saving it', async () => {
    const normalizedTitle = 'Normalized refetched course';
    let courseReads = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') {
        courseReads += 1;
        return decode(options, courseReads === 1 ? course : { ...course, title: normalizedTitle });
      }
      if (options.path === '/courses/7' && options.method === 'PATCH')
        return decode(options, { ...course, instructor_id: 3, title: normalizedTitle });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderPage(
      { request },
      undefined,
      undefined,
      false,
      tokenStore,
      sessionEpochRef,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Course title' });
    const epoch = capturedSessionEpoch(sessionEpochRef);
    await act(async () => {
      await user.clear(title);
      await user.type(title, 'Draft needing normalization');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
    });

    await waitFor(() => expect((title as HTMLInputElement).value).toBe(normalizedTitle));
    expect(courseReads).toBe(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseQueryKey(epoch, 7),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseCollectionQueryPrefix(epoch),
    });
  });

  it('refetches a retained course without the deleted lesson and removes its editor UI', async () => {
    let courseReads = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') {
        courseReads += 1;
        return decode(options, courseReads === 1 ? course : { ...course, lessons: [] });
      }
      if (options.path === '/courses/7/lessons/8' && options.method === 'DELETE')
        return decode(options, { message: 'Lesson deleted.' });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderPage(
      { request },
      undefined,
      undefined,
      false,
      tokenStore,
      sessionEpochRef,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    expect(await screen.findByText('Existing lesson')).toBeTruthy();
    const epoch = capturedSessionEpoch(sessionEpochRef);
    const deleteLesson = screen.getByRole('button', { name: 'Delete lesson' });
    await act(async () => {
      await user.click(deleteLesson);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Delete this lesson?' });
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Delete lesson' }));
    });

    await waitFor(() => expect(courseReads).toBe(2));
    expect(screen.queryByText('Existing lesson')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete lesson' })).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseQueryKey(epoch, 7),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseCollectionQueryPrefix(epoch),
    });
  });

  it('navigates through the real course collection route after deleting a course', async () => {
    let courseReads = 0;
    let collectionReads = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/courses/7' && options.method === 'GET') {
        courseReads += 1;
        if (courseReads === 1) return decode(options, course);
        throw new ApiError({
          kind: 'not_found',
          status: 404,
          message: 'Deleted course is unavailable',
        });
      }
      if (options.path === '/courses/7' && options.method === 'DELETE')
        return decode(options, { message: 'Course deleted.' });
      if (options.path === '/courses/my' && options.method === 'GET') {
        collectionReads += 1;
        return decode(options, {
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          pages: 0,
          has_next: false,
          has_previous: false,
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderEditorWithCoursesDestination({ request }, sessionEpochRef);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    expect(await screen.findByText(course.title)).toBeTruthy();
    const epoch = capturedSessionEpoch(sessionEpochRef);
    const deleteCourse = screen.getByRole('button', { name: 'Delete course' });
    await act(async () => {
      await user.click(deleteCourse);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Delete this course?' });
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Delete course' }));
    });

    expect(await screen.findByRole('heading', { name: 'Instructor courses' })).toBeTruthy();
    await waitFor(() => expect(collectionReads).toBe(1));
    expect(screen.queryByText(course.title)).toBeNull();
    expect(courseReads).toBe(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseQueryKey(epoch, 7),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseCollectionQueryPrefix(epoch),
    });
  });
});
