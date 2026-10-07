// @vitest-environment jsdom
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '../../src/app/query';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
} from '../../src/features/auth-session';
import { InstructorLessonEditorPage } from '../../src/pages/instructor-lesson-editor-page';
import { ApiError, type ApiClient, type ApiRequestOptions } from '../../src/shared/api';
import {
  instructorCourseQueryKey,
  instructorLessonQueryKey,
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
const lesson = {
  id: 8,
  course_id: 7,
  title: 'Verified video',
  lesson_type: 'video',
  download_url: '/unrendered.mp4',
  description: null,
  is_published: false,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
};
const uploadAcknowledgement = {
  lesson_id: 8,
  upload_id: '0123456789abcdef0123456789abcdef',
  status: 'queued',
  detail: 'File accepted for processing.',
};
const tokenStore: AccessTokenStore = { get: () => 'token', set: () => {}, clear: () => {} };

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

function LessonRouteTestControl() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        aria-label="Open lesson 8"
        onClick={() => navigate('/instructor/lessons/8/edit')}
      >
        Open lesson 8
      </button>
      <button
        type="button"
        aria-label="Open lesson 9"
        onClick={() => navigate('/instructor/lessons/9/edit')}
      >
        Open lesson 9
      </button>
    </>
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
  queryClient: QueryClient = createAppQueryClient(),
  locale: Locale = 'en',
  initialEntry = '/instructor/lessons/8/edit',
  sessionEpochRef?: SessionEpochRef,
) {
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider initialLocale={locale}>
          <LocaleTestControl locale="en" />
          <LocaleTestControl locale="ru" />
          <LocaleTestControl locale="uz" />
          <SessionProvider client={client} tokenStore={tokenStore}>
            {sessionEpochRef ? <SessionEpochProbe epochRef={sessionEpochRef} /> : null}
            <MemoryRouter initialEntries={[initialEntry]}>
              <LessonRouteTestControl />
              <Routes>
                <Route
                  path="/instructor/lessons/:lessonId/edit"
                  element={<InstructorLessonEditorPage />}
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

async function settleQueryClient(queryClient: QueryClient): Promise<void> {
  await vi.waitFor(() => {
    expect(queryClient.isMutating()).toBe(0);
    expect(queryClient.isFetching()).toBe(0);
  });
}

describe('InstructorLessonEditorPage', () => {
  it.each([
    [
      'en',
      'Edit lesson',
      'Lesson details',
      'Upload lesson file',
      'Instructor workspace',
      'Back to course',
      'All changes saved',
      'Upload file',
    ],
    [
      'ru',
      'Редактировать урок',
      'Сведения об уроке',
      'Загрузить файл урока',
      'Рабочая область преподавателя',
      'Вернуться к курсу',
      'Все изменения сохранены',
      'Загрузить файл',
    ],
    [
      'uz',
      'Darsni tahrirlash',
      'Dars tafsilotlari',
      'Dars faylini yuklash',
      'O‘qituvchi ish maydoni',
      'Kursga qaytish',
      'Barcha o‘zgarishlar saqlandi',
      'Faylni yuklash',
    ],
  ] as const)(
    'renders allocated lesson editor UI in %s',
    async (locale, title, details, upload, workspace, backToCourse, savedState, uploadFile) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/lessons/8' && options.method === 'GET')
          return decode(options, lesson);
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      await renderPage({ request }, createAppQueryClient(), locale);
      const pageTitle = await screen.findByRole('heading', { level: 1, name: title });
      expect(screen.getByRole('heading', { name: details })).toBeTruthy();
      const uploadHeading = screen.getByRole('heading', { name: upload });
      expect(uploadHeading).toBeTruthy();
      expect(screen.getByText(workspace)).toBeTruthy();
      const returnLink = screen.getByRole('link', { name: backToCourse });
      expect(
        returnLink.compareDocumentPosition(pageTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const savedStatus = screen.getByRole('status');
      expect(savedStatus.textContent).toContain(savedState);
      expect(
        uploadHeading.compareDocumentPosition(savedStatus) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: uploadFile })).toBeTruthy();
    },
  );

  it('identifies and opens unpublished instructor saved text without issuing a media request', async () => {
    const requests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      requests.push(options);
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8')
        return decode(options, {
          ...lesson,
          lesson_type: 'text',
          download_url: null,
          description: 'Saved instructor text.',
        });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };

    await renderPage({ request });
    expect(await screen.findByRole('heading', { name: 'Text lesson' })).toBeTruthy();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Details' }));
    });
    expect((await screen.findByRole('region', { name: 'Text lesson' })).textContent).toContain(
      'Saved instructor text.',
    );
    expect(requests.some((item) => item.path.startsWith('/media/lessons/'))).toBe(false);
  });

  it.each([
    ['en', 'This lesson address is not valid.'],
    ['ru', 'Адрес урока указан неверно.'],
    ['uz', 'Dars manzili noto‘g‘ri.'],
  ] as const)('localizes the invalid lesson address in %s', async (locale, invalidAddress) => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage(
      { request },
      createAppQueryClient(),
      locale,
      '/instructor/lessons/not-a-lesson/edit',
    );
    expect(await screen.findByText(invalidAddress)).toBeTruthy();
  });

  it('keeps Save lesson stable and spinner-free while preventing a duplicate PATCH', async () => {
    let releasePatch: (() => void) | undefined;
    const patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    let patchRequests = 0;
    let lessonRequests = 0;
    const mutationResponse = { ...lesson, title: 'Mutation response title' };
    const refetchedLesson = {
      ...lesson,
      title: 'Refetched normalized lesson',
      description: 'Refetched normalized description',
    };
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') {
        lessonRequests += 1;
        return decode(options, lessonRequests === 1 ? lesson : refetchedLesson);
      }
      if (options.path === '/lessons/8' && options.method === 'PATCH') {
        patchRequests += 1;
        await patchGate;
        return decode(options, mutationResponse);
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    const queryClient = await renderPage(
      { request },
      createAppQueryClient(),
      'en',
      '/instructor/lessons/8/edit',
      sessionEpochRef,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await screen.findByRole('textbox', { name: 'Lesson title' });
    const lessonTitle = screen.getByRole('textbox', { name: 'Lesson title' });
    const user = userEvent.setup();

    expect(screen.queryByRole('button', { name: 'Save lesson' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('All changes saved');
    await act(async () => {
      await user.clear(lessonTitle);
    });
    await act(async () => {
      await user.type(lessonTitle, 'Updated lesson');
    });
    const saveLesson = screen.getByRole('button', { name: 'Save lesson' });
    expect(saveLesson.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText('All changes saved')).toBeNull();

    await act(async () => {
      await user.click(saveLesson);
    });
    expect(saveLesson.hasAttribute('disabled')).toBe(true);
    expect(saveLesson.getAttribute('aria-busy')).toBe('true');
    expect(saveLesson.textContent).toBe('Save lesson');
    expect(saveLesson.querySelector('[data-part="spinner"]')).toBeNull();
    fireEvent.click(saveLesson);
    expect(patchRequests).toBe(1);

    await act(async () => {
      releasePatch?.();
      await settleQueryClient(queryClient);
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save lesson' })).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('All changes saved');
    await waitFor(() => expect(lessonRequests).toBe(2));
    const epoch = capturedSessionEpoch(sessionEpochRef);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: instructorLessonQueryKey(epoch, 8) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: instructorCourseQueryKey(epoch, 7) });
    expect((screen.getByRole('textbox', { name: 'Lesson title' }) as HTMLInputElement).value).toBe(
      'Refetched normalized lesson',
    );
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
    ).toBe('Refetched normalized description');
  });

  it('starts status observation from the accepted acknowledgement without rendering unsupported media controls', async () => {
    const uploadRequests: ApiRequestOptions[] = [];
    const queryClient = createAppQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') return decode(options, lesson);
      if (options.path === '/lessons/8/upload-file') {
        uploadRequests.push(options);
        return decode(options, uploadAcknowledgement);
      }
      if (options.path === '/lessons/uploads/0123456789abcdef0123456789abcdef/status') {
        return decode(options, {
          upload_id: '0123456789abcdef0123456789abcdef',
          lesson_id: 8,
          status: 'processing',
          failure_reason: null,
          updated_at: '2026-08-28T12:00:00Z',
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request }, queryClient);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Upload lesson file' })).toBeTruthy();
    const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('Lesson file'), { target: { files: [file] } });
    expect(screen.getByText('lesson.mp4')).toBeTruthy();
    expect(screen.getByLabelText('Lesson file').getAttribute('aria-describedby')).toBe(
      'lesson-upload-file-help',
    );
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Upload file' }));
    });
    await waitFor(() => expect(uploadRequests).toHaveLength(1));
    expect(uploadRequests[0]?.body).toBeInstanceOf(FormData);
    expect((uploadRequests[0]?.body as FormData).get('file')).toBe(file);
    expect(await screen.findByText('Processing')).toBeTruthy();
    expect(screen.queryByText('File accepted and queued')).toBeNull();
    expect(screen.queryByText('Processing status is unavailable.')).toBeNull();
    expect(screen.queryByText(/download/i)).toBeNull();
    expect(screen.queryByText(/ready|complete|progress/i)).toBeNull();
    expect(screen.queryByLabelText('Lesson file')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorLessonQueryKey(expect.any(String), 8),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: instructorCourseQueryKey(expect.any(String), 7),
    });
  });

  it('renders ready as source-file-only and never exposes a raw failure reason', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') return decode(options, lesson);
      if (options.path === '/lessons/8/upload-file') return decode(options, uploadAcknowledgement);
      if (options.path === '/lessons/uploads/0123456789abcdef0123456789abcdef/status') {
        return decode(options, {
          upload_id: '0123456789abcdef0123456789abcdef',
          lesson_id: 8,
          status: 'ready',
          failure_reason: 'PRIVATE_SOURCE_FAILURE_REASON',
          updated_at: '2026-08-28T12:00:00Z',
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
    fireEvent.change(await screen.findByLabelText('Lesson file'), { target: { files: [file] } });
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Upload file' }));
    });

    expect(await screen.findByText('Uploaded source file ready')).toBeTruthy();
    expect(screen.getByText('Subtitle and generated media status is unavailable.')).toBeTruthy();
    expect(screen.queryByText('PRIVATE_SOURCE_FAILURE_REASON')).toBeNull();
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /retry|cancel|play/i })).toBeNull();
  });

  it.each([
    ['ru', 'Загрузить файл', 'В очереди'],
    ['uz', 'Faylni yuklash', 'Navbatda'],
  ] as const)(
    'localizes the queued upload observation in %s',
    async (locale, uploadFile, queued) => {
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/lessons/8' && options.method === 'GET')
          return decode(options, lesson);
        if (options.path === '/lessons/8/upload-file') {
          return decode(options, uploadAcknowledgement);
        }
        if (options.path === '/lessons/uploads/0123456789abcdef0123456789abcdef/status') {
          return decode(options, {
            upload_id: '0123456789abcdef0123456789abcdef',
            lesson_id: 8,
            status: 'queued',
            failure_reason: null,
            updated_at: '2026-08-28T12:00:00Z',
          });
        }
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      await renderPage({ request }, createAppQueryClient(), locale);
      await screen.findByRole('heading', { level: 1 });
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(fileInput).not.toBeNull();
      if (!fileInput) return;
      fireEvent.change(fileInput, {
        target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] },
      });
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: uploadFile }));
      });
      expect(await screen.findByText(queued)).toBeTruthy();
    },
  );

  it('rejects a locally invalid upload without calling API-032', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8') return decode(options, lesson);
      throw new Error('Upload should not run');
    });
    await renderPage({ request } as ApiClient);
    await screen.findByRole('heading', { name: 'Upload lesson file' });
    const oversizedPdf = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'notes.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('Lesson file'), { target: { files: [oversizedPdf] } });
    expect(
      await screen.findByText('Choose a file that matches the stated type and size limit.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload file' }).hasAttribute('disabled')).toBe(true);
    expect(
      request.mock.calls.map(([options]) => (options as ApiRequestOptions).path),
    ).not.toContain('/lessons/8/upload-file');
  });

  it.each([
    {
      persistedType: 'video',
      unsavedType: 'pdf',
      rejectedFile: 'notes.pdf',
      accepted: '.mp4,.webm,.mov',
    },
    { persistedType: 'pdf', unsavedType: 'video', rejectedFile: 'lesson.mp4', accepted: '.pdf' },
  ] as const)(
    'keeps %s upload validation while an unsaved type change is %s',
    async ({ persistedType, unsavedType, rejectedFile, accepted }) => {
      let lessonType = persistedType;
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/lessons/8' && options.method === 'GET') {
          return decode(options, { ...lesson, lesson_type: lessonType });
        }
        if (options.path === '/lessons/8' && options.method === 'PATCH') {
          lessonType = unsavedType;
          return decode(options, { ...lesson, lesson_type: lessonType });
        }
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      const queryClient = await renderPage({ request });
      const user = userEvent.setup();
      const fileInput = await screen.findByLabelText('Lesson file');
      await act(async () => {
        await user.click(screen.getByRole('combobox', { name: 'Lesson type' }));
      });
      await act(async () => {
        await user.click(
          screen.getByRole('option', { name: unsavedType === 'video' ? 'Video' : 'PDF' }),
        );
      });
      expect(fileInput.getAttribute('accept')).toBe(accepted);
      await act(async () => {
        fireEvent.change(fileInput, {
          target: { files: [new File(['file'], rejectedFile)] },
        });
      });
      expect(
        await screen.findByText('Choose a file that matches the stated type and size limit.'),
      ).toBeTruthy();

      await act(async () => {
        await user.click(await screen.findByRole('button', { name: 'Save lesson' }));
        await settleQueryClient(queryClient);
      });
      await waitFor(() =>
        expect(screen.getByLabelText('Lesson file').getAttribute('accept')).toBe(
          unsavedType === 'video' ? '.mp4,.webm,.mov' : '.pdf',
        ),
      );
    },
  );

  it.each([
    { persistedType: 'video', updatedType: 'pdf', fileName: 'lesson.mp4' },
    { persistedType: 'pdf', updatedType: 'video', fileName: 'notes.pdf' },
  ] as const)(
    'clears a selected %s file after saving an incompatible %s lesson type',
    async ({ persistedType, updatedType, fileName }) => {
      const uploadRequests: ApiRequestOptions[] = [];
      const request: ApiClient['request'] = async (options) => {
        if (options.path === '/me') return decode(options, instructor);
        if (options.path === '/lessons/8' && options.method === 'GET') {
          return decode(options, { ...lesson, lesson_type: persistedType });
        }
        if (options.path === '/lessons/8' && options.method === 'PATCH') {
          return decode(options, { ...lesson, lesson_type: updatedType });
        }
        if (options.path === '/lessons/8/upload-file') {
          uploadRequests.push(options);
          return decode(options, { ...lesson, lesson_type: updatedType });
        }
        throw new Error(`Unexpected request: ${options.method} ${options.path}`);
      };
      const queryClient = await renderPage({ request });
      const user = userEvent.setup();
      const fileInput = await screen.findByLabelText('Lesson file');
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [new File(['file'], fileName)] } });
      });
      expect(screen.getByRole('button', { name: 'Upload file' }).hasAttribute('disabled')).toBe(
        false,
      );

      await act(async () => {
        await user.click(screen.getByRole('combobox', { name: 'Lesson type' }));
      });
      await act(async () => {
        await user.click(
          screen.getByRole('option', { name: updatedType === 'video' ? 'Video' : 'PDF' }),
        );
      });
      await act(async () => {
        await user.click(await screen.findByRole('button', { name: 'Save lesson' }));
        await settleQueryClient(queryClient);
      });

      expect(
        await screen.findByText(
          'The lesson type changed. Choose a file that matches the updated lesson type.',
        ),
      ).toBeTruthy();
      const updatedFileInput = screen.getByLabelText('Lesson file');
      expect(updatedFileInput.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('button', { name: 'Upload file' }).hasAttribute('disabled')).toBe(
        true,
      );
      expect(uploadRequests).toHaveLength(0);
    },
  );

  it('maps a verified lesson 422 issue to its select and keeps private detail out of the UI', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') return decode(options, lesson);
      if (options.path === '/lessons/8' && options.method === 'PATCH') {
        throw new ApiError({
          kind: 'validation',
          status: 422,
          message: 'PRIVATE_LESSON_TYPE_DETAIL',
          issues: [
            {
              location: ['body', 'lesson_type'],
              message: 'PRIVATE_LESSON_TYPE_DETAIL',
              type: 'enum',
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const queryClient = await renderPage({ request });
    const user = userEvent.setup();
    const lessonType = await screen.findByRole('combobox', { name: 'Lesson type' });
    await act(async () => {
      await user.click(lessonType);
    });
    await act(async () => {
      await user.click(screen.getByRole('option', { name: 'Text' }));
    });
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Save lesson' }));
      await settleQueryClient(queryClient);
    });

    expect(await screen.findByText('Check lesson type and submit again.')).toBeTruthy();
    expect(lessonType.getAttribute('aria-invalid')).toBe('true');
    expect(lessonType.getAttribute('aria-describedby')).toContain('error');
    await waitFor(() => expect(document.activeElement).toBe(lessonType));
    expect(screen.queryByText('PRIVATE_LESSON_TYPE_DETAIL')).toBeNull();
  });

  it('maps a verified publication 422 issue to the checkbox and focuses it', async () => {
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') return decode(options, lesson);
      if (options.path === '/lessons/8' && options.method === 'PATCH') {
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
    const queryClient = await renderPage({ request });
    const user = userEvent.setup();
    const checkbox = await screen.findByRole('checkbox', { name: 'Publish this lesson' });
    await act(async () => {
      await user.click(checkbox);
    });
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Save lesson' }));
      await settleQueryClient(queryClient);
    });

    expect(await screen.findByText('Check publish this lesson and submit again.')).toBeTruthy();
    expect(checkbox.getAttribute('name')).toBe('is_published');
    expect(checkbox.getAttribute('aria-invalid')).toBe('true');
    expect(checkbox.getAttribute('aria-describedby')).toBe('edit-lesson-is-published-error');
    await waitFor(() => expect(document.activeElement).toBe(checkbox));
    expect(screen.queryByText('PRIVATE_PUBLISH_DETAIL')).toBeNull();
  });

  it('maps upload file 422 issues and uses a safe generic message for unknown detail', async () => {
    let uploadAttempt = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') return decode(options, lesson);
      if (options.path === '/lessons/8/upload-file') {
        uploadAttempt += 1;
        throw new ApiError({
          kind: 'validation',
          status: 422,
          message: uploadAttempt === 1 ? 'PRIVATE_FILE_DETAIL' : 'PRIVATE_UNKNOWN_DETAIL',
          issues:
            uploadAttempt === 1
              ? [{ location: ['body', 'file'], message: 'PRIVATE_FILE_DETAIL', type: 'missing' }]
              : [
                  {
                    location: ['body', 'unknown'],
                    message: 'PRIVATE_UNKNOWN_DETAIL',
                    type: 'value_error',
                  },
                ],
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const fileInput = await screen.findByLabelText('Lesson file');
    const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Upload file' }));
    });
    expect(await screen.findByText('Lesson file is required.')).toBeTruthy();
    expect(fileInput.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(fileInput));
    expect(screen.queryByText('PRIVATE_FILE_DETAIL')).toBeNull();

    fireEvent.change(fileInput, { target: { files: [file] } });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Upload file' }));
    });
    expect(
      await screen.findByText('We could not process this form. Check your details and try again.'),
    ).toBeTruthy();
    await waitFor(() =>
      expect((document.activeElement as Element).getAttribute('role')).toBe('alert'),
    );
    expect(screen.queryByText('PRIVATE_UNKNOWN_DETAIL')).toBeNull();
  });

  it('settles an in-flight upload through the current locale while preserving file, focus and retry state', async () => {
    let rejectUpload: (reason: unknown) => void = () => {};
    const uploadResponse = new Promise<never>((_resolve, reject) => {
      rejectUpload = reject;
    });
    const uploadRequests: ApiRequestOptions[] = [];
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') return decode(options, lesson);
      if (options.path === '/lessons/8/upload-file' && options.method === 'POST') {
        uploadRequests.push(options);
        return decode(options, await uploadResponse);
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const fileInput = await screen.findByLabelText('Lesson file');
    const file = new File(['video'], 'deferred-lesson.mp4', { type: 'video/mp4' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Upload file' }));
    });
    await waitFor(() => expect(uploadRequests).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Uploading file' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(uploadRequests).toHaveLength(1);
    expect(uploadRequests[0]?.body).toBeInstanceOf(FormData);

    await act(async () => {
      await setTestLocale('ru');
      rejectUpload(
        new ApiError({
          kind: 'validation',
          status: 422,
          message: 'PRIVATE_DEFERRED_UPLOAD_DETAIL',
          issues: [
            {
              location: ['body', 'file'],
              message: 'PRIVATE_DEFERRED_UPLOAD_DETAIL',
              type: 'missing',
            },
          ],
        }),
      );
    });

    const russianFile = await screen.findByLabelText('Файл урока');
    expect(await screen.findByText('Файл урока обязательно.')).toBeTruthy();
    expect(russianFile.getAttribute('aria-invalid')).toBe('true');
    expect(russianFile.getAttribute('aria-describedby')).toContain('error');
    await waitFor(() => expect(document.activeElement).toBe(russianFile));
    expect(screen.getByRole('button', { name: 'Загрузить файл' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(screen.queryByText('PRIVATE_DEFERRED_UPLOAD_DETAIL')).toBeNull();

    await act(async () => {
      await setTestLocale('uz');
    });
    expect(await screen.findByText('Dars fayli kiritilishi shart.')).toBeTruthy();
    expect(screen.getByLabelText('Dars fayli').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Faylni yuklash' })).toBeTruthy();
  });

  it('keeps a dirty lesson title and description when an upload invalidation refetches new media metadata', async () => {
    let lessonRequestCount = 0;
    const queryClient = createAppQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') {
        lessonRequestCount += 1;
        return decode(options, {
          ...lesson,
          description: lessonRequestCount === 1 ? 'Original description' : 'Server media refreshed',
          download_url:
            lessonRequestCount === 1 ? '/unrendered.mp4' : '/media/lessons/processed.mp4',
          updated_at: `2026-09-17T00:00:0${lessonRequestCount}Z`,
        });
      }
      if (options.path === '/lessons/8/upload-file' && options.method === 'POST')
        return decode(options, uploadAcknowledgement);
      if (options.path === '/lessons/uploads/0123456789abcdef0123456789abcdef/status')
        return decode(options, {
          upload_id: '0123456789abcdef0123456789abcdef',
          lesson_id: 8,
          status: 'queued',
          failure_reason: null,
          updated_at: '2026-09-17T00:00:00Z',
        });
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    const sessionEpochRef: SessionEpochRef = { current: null };
    await renderPage({ request }, queryClient, 'en', '/instructor/lessons/8/edit', sessionEpochRef);
    const user = userEvent.setup();
    const title = (await screen.findByRole('textbox', {
      name: 'Lesson title',
    })) as HTMLInputElement;
    const description = screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
    await act(async () => {
      await user.clear(title);
      await user.type(title, 'Unsaved lesson title');
      await user.clear(description);
      await user.type(description, 'Unsaved lesson description');
    });
    fireEvent.change(screen.getByLabelText('Lesson file'), {
      target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] },
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Upload file' }));
    });

    await waitFor(() => expect(lessonRequestCount).toBeGreaterThan(1));
    const epoch = capturedSessionEpoch(sessionEpochRef);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: instructorLessonQueryKey(epoch, 8) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: instructorCourseQueryKey(epoch, 7) });
    expect(title.value).toBe('Unsaved lesson title');
    expect(description.value).toBe('Unsaved lesson description');
    expect(await screen.findByText('Queued')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load video' })).toBeTruthy();
  });

  it('keeps the returned A draft and baseline clear when an old A save fails after A to B to A', async () => {
    let rejectOldSave: (reason: unknown) => void = () => {};
    const oldSave = new Promise<never>((_resolve, reject) => {
      rejectOldSave = reject;
    });
    let lessonEightRequests = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') {
        lessonEightRequests += 1;
        return decode(options, {
          ...lesson,
          title: lessonEightRequests === 1 ? 'Initial A baseline' : 'Returned A baseline',
        });
      }
      if (options.path === '/lessons/9' && options.method === 'GET')
        return decode(options, { ...lesson, id: 9, title: 'B baseline' });
      if (options.path === '/lessons/8' && options.method === 'PATCH')
        return decode(options, await oldSave);
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    const title = (await screen.findByRole('textbox', {
      name: 'Lesson title',
    })) as HTMLInputElement;
    await act(async () => {
      await user.clear(title);
    });
    await act(async () => {
      await user.type(title, 'Old A save draft');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Save lesson' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open lesson 9' }));
    });
    await screen.findByDisplayValue('B baseline');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open lesson 8' }));
    });
    const returnedTitle = (await screen.findByDisplayValue(
      'Returned A baseline',
    )) as HTMLInputElement;
    await act(async () => {
      await user.clear(returnedTitle);
    });
    await act(async () => {
      await user.type(returnedTitle, 'Returned A draft');
    });

    await act(async () => {
      rejectOldSave(
        new ApiError({
          kind: 'validation',
          status: 422,
          message: 'PRIVATE_OLD_A_SAVE_FAILURE',
          issues: [],
        }),
      );
    });

    expect(returnedTitle.value).toBe('Returned A draft');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('PRIVATE_OLD_A_SAVE_FAILURE')).toBeNull();
  });

  it('keeps the returned A draft and file while an old A upload acknowledgement cannot start its observer', async () => {
    let resolveOldUpload: (value: typeof uploadAcknowledgement) => void = () => {};
    const oldUpload = new Promise<typeof uploadAcknowledgement>((resolve) => {
      resolveOldUpload = resolve;
    });
    const statusRequests: ApiRequestOptions[] = [];
    let lessonEightRequests = 0;
    const request: ApiClient['request'] = async (options) => {
      if (options.path === '/me') return decode(options, instructor);
      if (options.path === '/lessons/8' && options.method === 'GET') {
        lessonEightRequests += 1;
        return decode(options, {
          ...lesson,
          title: lessonEightRequests === 1 ? 'Initial A baseline' : 'Returned A baseline',
        });
      }
      if (options.path === '/lessons/9' && options.method === 'GET')
        return decode(options, { ...lesson, id: 9, title: 'B baseline' });
      if (options.path === '/lessons/8/upload-file' && options.method === 'POST')
        return decode(options, await oldUpload);
      if (options.path.includes('/status')) {
        statusRequests.push(options);
        return decode(options, {
          upload_id: uploadAcknowledgement.upload_id,
          lesson_id: 8,
          status: 'queued',
          failure_reason: null,
          updated_at: '2026-09-17T00:00:00Z',
        });
      }
      throw new Error(`Unexpected request: ${options.method} ${options.path}`);
    };
    await renderPage({ request });
    const user = userEvent.setup();
    fireEvent.change(await screen.findByLabelText('Lesson file'), {
      target: { files: [new File(['old'], 'old-a.mp4', { type: 'video/mp4' })] },
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Upload file' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open lesson 9' }));
    });
    await screen.findByDisplayValue('B baseline');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open lesson 8' }));
    });
    const returnedTitle = (await screen.findByDisplayValue(
      'Returned A baseline',
    )) as HTMLInputElement;
    await act(async () => {
      await user.clear(returnedTitle);
    });
    await act(async () => {
      await user.type(returnedTitle, 'Returned A draft');
    });
    fireEvent.change(screen.getByLabelText('Lesson file'), {
      target: { files: [new File(['returned'], 'returned-a.mp4', { type: 'video/mp4' })] },
    });

    await act(async () => {
      resolveOldUpload(uploadAcknowledgement);
    });

    expect(returnedTitle.value).toBe('Returned A draft');
    expect(screen.getByText('returned-a.mp4')).toBeTruthy();
    expect(screen.queryByText('Queued')).toBeNull();
    expect(statusRequests).toHaveLength(0);
  });
});
