import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createInstructorLesson,
  createInstructorLessonUploadStatusObserver,
  deleteInstructorLesson,
  mapInstructorEditorFormFailure,
  requestInstructorEditorCourse,
  requestInstructorEditorLesson,
  requestInstructorLessonUploadStatus,
  updateInstructorCourse,
  uploadInstructorLessonFile,
} from '../../../src/features/instructor-course-editor';
import type { SessionContextValue } from '../../../src/features/auth-session';
import { ApiError, createApiClient, type ApiRequestOptions } from '../../../src/shared/api';

const course = {
  id: 7,
  title: 'Verified course',
  description: 'Course description',
  price: '10.00',
  currency: 'USD',
  published_at: null,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
  instructor: { id: 3, name: 'Ada', surname: 'Lovelace' },
  lessons: [
    {
      id: 8,
      title: 'Introduction',
      lesson_type: 'video',
      download_url: '/media/lessons/video.mp4',
      description: null,
      is_published: false,
      created_at: '2026-08-08T00:00:00Z',
      updated_at: '2026-08-08T00:00:00Z',
    },
  ],
};
const lesson = {
  id: 8,
  course_id: 7,
  title: 'Introduction',
  lesson_type: 'video',
  download_url: '/media/lessons/video.mp4',
  description: null,
  is_published: false,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
};
const UPLOAD_ID = '0123456789abcdef0123456789abcdef';
const uploadAcknowledgement = {
  lesson_id: 8,
  upload_id: UPLOAD_ID,
  status: 'queued',
  detail: 'File accepted for processing.',
};
const uploadStatus = {
  upload_id: UPLOAD_ID,
  lesson_id: 8,
  status: 'processing',
  failure_reason: null,
  updated_at: '2026-08-28T12:00:00Z',
};

afterEach(() => {
  vi.useRealTimers();
});

function sessionWith(requestRequired: SessionContextValue['requestRequired']): SessionContextValue {
  return {
    state: {
      status: 'authenticated',
      user: {
        email: 'instructor@example.test',
        name: 'Ada',
        surname: 'Lovelace',
        role: 'instructor',
        birthday: null,
        phoneNumber: null,
        createdAt: '2026-08-08T00:00:00Z',
      },
    },
    cacheEpoch: 'editor-test' as SessionContextValue['cacheEpoch'],
    retryBootstrap: () => undefined,
    acceptAccessToken: () => undefined,
    clearSession: () => undefined,
    requestPublic: requestRequired,
    requestRequired,
    requestOptional: requestRequired,
  };
}

function decode<TResponse, TBody>(
  options: ApiRequestOptions<TBody, TResponse>,
  value: unknown,
): TResponse {
  if (!options.decode) throw new Error('Expected decoder');
  return options.decode(value);
}

function asSessionRequest(
  request: (options: ApiRequestOptions) => Promise<unknown>,
): SessionContextValue['requestRequired'] {
  return async <TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
  ): Promise<TResponse> => (await request(options)) as TResponse;
}

describe('instructor course editor API', () => {
  it('normalizes a malformed API-010 editor response through the real client boundary', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...course, instructor: { ...course.instructor, id: '3' } }), {
          status: 200,
        }),
    );
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetch });
    const error = await requestInstructorEditorCourse(
      sessionWith(asSessionRequest((options) => client.request(options))),
      7,
      new AbortController().signal,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'invalid_response', status: 200 });
  });

  it('does not map a hostile inherited 422 field location or emit a rendered summary', () => {
    const failure = mapInstructorEditorFormFailure(
      new ApiError({
        kind: 'validation',
        status: 422,
        message: 'PRIVATE_CONSTRUCTOR_DETAIL',
        issues: [
          {
            location: ['body', 'constructor'],
            message: 'PRIVATE_CONSTRUCTOR_DETAIL',
            type: 'missing',
          },
        ],
      }),
      {
        actionKey: 'courseEditorSaveThisCourse',
        unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
        forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
        notFoundKey: 'courseEditorThisCourseIsNoLongerAvailable',
        badRequestKey: null,
      },
      { title: { field: 'title', labelKey: 'courseEditorCourseTitle' } },
    );

    expect(failure).toEqual({ fields: {}, summary: { kind: 'couldNotProcessForm' } });
    expect(typeof failure.summary).not.toBe('string');
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_CONSTRUCTOR_DETAIL');
  });

  it('uses the registered course CRUD and lesson-create contracts with only verified fields', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) => {
      if (options.path === '/courses/7' && options.method === 'GET') return decode(options, course);
      if (options.path === '/courses/7' && options.method === 'PATCH')
        return decode(options, { ...course, instructor_id: 3 });
      if (options.path === '/courses/7/lessons') return decode(options, lesson);
      return decode(options, { message: 'Lesson deleted successfully' });
    });
    const session = sessionWith(asSessionRequest(request));
    await expect(
      requestInstructorEditorCourse(session, 7, new AbortController().signal),
    ).resolves.toMatchObject({
      id: 7,
      lessons: [{ id: 8, courseId: 7, mediaLocator: { filename: 'video.mp4' } }],
    });
    await updateInstructorCourse(session, 7, {
      title: 'Updated course',
      description: 'Updated description',
      price: '20.00',
      currency: 'EUR',
    });
    await createInstructorLesson(session, 7, {
      title: 'New lesson',
      lessonType: 'pdf',
      description: 'Notes',
      isPublished: true,
    });
    await deleteInstructorLesson(session, 7, 8);
    expect(
      request.mock.calls.map(([options]) => [options.method, options.path, options.body]),
    ).toEqual([
      ['GET', '/courses/7', undefined],
      [
        'PATCH',
        '/courses/7',
        {
          title: 'Updated course',
          description: 'Updated description',
          price: '20.00',
          currency: 'EUR',
        },
      ],
      [
        'POST',
        '/courses/7/lessons',
        { title: 'New lesson', lesson_type: 'pdf', description: 'Notes', is_published: true },
      ],
      ['DELETE', '/courses/7/lessons/8', undefined],
    ]);
  });

  it.each([
    null,
    '/media/lessons/%00private.pdf',
    '/media/lessons/../private.pdf',
    '/media/lessons/private%2Fnotes.pdf',
    '/media/lessons/private notes.pdf',
  ])('fails closed for noncanonical instructor lesson locators: %s', async (downloadUrl) => {
    const request = vi.fn(async (options: ApiRequestOptions) =>
      decode(options, { ...lesson, download_url: downloadUrl }),
    );

    await expect(
      requestInstructorEditorLesson(
        sessionWith(asSessionRequest(request)),
        8,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ mediaLocator: null });
  });

  it('sends API-032 as authenticated multipart file data and never maps terminal media state', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) =>
      decode(options, uploadAcknowledgement),
    );
    const session = sessionWith(asSessionRequest(request));
    const file = new File(['lesson'], 'lesson.mp4', { type: 'video/mp4' });
    await expect(uploadInstructorLessonFile(session, 8, file)).resolves.toEqual({
      lessonId: 8,
      uploadId: UPLOAD_ID,
      status: 'queued',
      detail: 'File accepted for processing.',
    });
    const options = request.mock.calls[0]?.[0] as ApiRequestOptions<FormData>;
    expect(options.method).toBe('POST');
    expect(options.path).toBe('/lessons/8/upload-file');
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get('file')).toBe(file);
    expect(options.query).toBeUndefined();
  });

  it('reads and validates API-036 only for the acknowledged upload and lesson', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) => decode(options, uploadStatus));
    const signal = new AbortController().signal;
    await expect(
      requestInstructorLessonUploadStatus(
        sessionWith(asSessionRequest(request)),
        { lessonId: 8, uploadId: UPLOAD_ID },
        signal,
      ),
    ).resolves.toBe('processing');
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: 'GET',
      path: `/lessons/uploads/${UPLOAD_ID}/status`,
      authPolicy: 'required',
      signal,
    });
  });

  it('correlates a valid backend-producer upload ID without path rewriting', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) => decode(options, uploadStatus));

    await expect(
      requestInstructorLessonUploadStatus(
        sessionWith(asSessionRequest(request)),
        { lessonId: 8, uploadId: UPLOAD_ID },
        new AbortController().signal,
      ),
    ).resolves.toBe('processing');
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      path: `/lessons/uploads/${UPLOAD_ID}/status`,
    });
  });

  it.each([
    '.',
    '..',
    'upload/segment',
    'upload?query',
    'upload#fragment',
    'upload%2Fsegment',
    '0123456789abcdef0123456789abcdeg',
    '0123456789abcdef0123456789abcdef0',
    '0123456789abcdef0123456789abcdeF',
  ])('rejects invalid producer upload IDs before an API-036 transport request: %s', (uploadId) => {
    const request = vi.fn();

    expect(() =>
      requestInstructorLessonUploadStatus(
        sessionWith(asSessionRequest(request)),
        { lessonId: 8, uploadId },
        new AbortController().signal,
      ),
    ).toThrow('Invalid upload status upload id');
    expect(request).not.toHaveBeenCalled();
  });

  it('observes one acknowledged upload at a fixed logical cadence and stops after the fifteenth GET', async () => {
    vi.useFakeTimers();
    const receivedStatuses: string[] = [];
    const request = vi.fn(async (options: ApiRequestOptions) => decode(options, uploadStatus));
    const observer = createInstructorLessonUploadStatusObserver({
      session: sessionWith(asSessionRequest(request)),
      reference: { lessonId: 8, uploadId: UPLOAD_ID },
      onStatus: (status) => receivedStatuses.push(status),
    });

    await Promise.resolve();
    await Promise.resolve();
    for (let index = 1; index < 15; index += 1) {
      await vi.advanceTimersByTimeAsync(2_000);
    }

    expect(request).toHaveBeenCalledTimes(15);
    expect(receivedStatuses).toEqual([
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'processing',
      'unavailable',
    ]);
    observer.dispose();
  });

  it('stops on a terminal result and ignores a late result after disposal', async () => {
    vi.useFakeTimers();
    let resolveStatus: (value: typeof uploadStatus) => void = () => undefined;
    const deferredStatus = new Promise<typeof uploadStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const observed: string[] = [];
    const request = vi.fn(async (options: ApiRequestOptions) =>
      decode(options, await deferredStatus),
    );
    const observer = createInstructorLessonUploadStatusObserver({
      session: sessionWith(asSessionRequest(request)),
      reference: { lessonId: 8, uploadId: UPLOAD_ID },
      onStatus: (status) => observed.push(status),
    });

    observer.dispose();
    resolveStatus({ ...uploadStatus, status: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual([]);

    const terminalRequest = vi.fn(async (options: ApiRequestOptions) =>
      decode(options, { ...uploadStatus, status: 'failed', failure_reason: 'PRIVATE_REASON' }),
    );
    createInstructorLessonUploadStatusObserver({
      session: sessionWith(asSessionRequest(terminalRequest)),
      reference: { lessonId: 8, uploadId: UPLOAD_ID },
      onStatus: (status) => observed.push(status),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual(['failed']);
    expect(JSON.stringify(observed)).not.toContain('PRIVATE_REASON');
    expect(terminalRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    new ApiError({ kind: 'forbidden', status: 403, message: 'PRIVATE_FORBIDDEN' }),
    new ApiError({ kind: 'not_found', status: 404, message: 'PRIVATE_NOT_FOUND' }),
    new ApiError({ kind: 'server', status: 500, message: 'PRIVATE_SERVER' }),
    new TypeError('PRIVATE_MALFORMED'),
  ])('maps non-authenticated status errors to the neutral stopped observation', async (error) => {
    vi.useFakeTimers();
    const observed: string[] = [];
    const request = vi.fn(async () => Promise.reject(error));
    createInstructorLessonUploadStatusObserver({
      session: sessionWith(asSessionRequest(request)),
      reference: { lessonId: 8, uploadId: UPLOAD_ID },
      onStatus: (status) => observed.push(status),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual(['unavailable']);
    expect(JSON.stringify(observed)).not.toContain('PRIVATE_');
  });

  it('leaves a 401 response to the required-session owner without a local status projection', async () => {
    vi.useFakeTimers();
    const observed: string[] = [];
    const request = vi.fn(async () =>
      Promise.reject(
        new ApiError({ kind: 'unauthorized', status: 401, message: 'PRIVATE_UNAUTHORIZED' }),
      ),
    );
    createInstructorLessonUploadStatusObserver({
      session: sessionWith(asSessionRequest(request)),
      reference: { lessonId: 8, uploadId: UPLOAD_ID },
      onStatus: (status) => observed.push(status),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual([]);
  });

  it('aborts an in-flight logical GET at the thirty-second observation deadline', async () => {
    vi.useFakeTimers();
    const observed: string[] = [];
    let signal: AbortSignal | undefined;
    const request = vi.fn((options: ApiRequestOptions) => {
      signal = options.signal;
      return new Promise<never>(() => undefined);
    });
    createInstructorLessonUploadStatusObserver({
      session: sessionWith(asSessionRequest(request)),
      reference: { lessonId: 8, uploadId: UPLOAD_ID },
      onStatus: (status) => observed.push(status),
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(observed).toEqual(['unavailable']);
  });

  it.each([
    [{ ...uploadStatus, upload_id: '' }, 'upload status upload id'],
    [{ ...uploadStatus, lesson_id: 0 }, 'upload status lesson id'],
    [{ ...uploadStatus, lesson_id: 9 }, 'upload status lesson id'],
    [{ ...uploadStatus, status: 'complete' }, 'upload status status'],
    [{ ...uploadStatus, failure_reason: 42 }, 'upload status failure reason'],
    [{ ...uploadStatus, updated_at: 'not-a-date' }, 'upload status updated at'],
    [{ ...uploadStatus, updated_at: '2026-08-28' }, 'upload status updated at'],
    [{ ...uploadStatus, updated_at: '2026-02-29T12:00:00Z' }, 'upload status updated at'],
    [{ ...uploadStatus, updated_at: '2026-02-30T12:00:00Z' }, 'upload status updated at'],
  ])('rejects malformed or mismatched API-036 payloads', async (response, message) => {
    const request = vi.fn(async (options: ApiRequestOptions) => decode(options, response));
    await expect(
      requestInstructorLessonUploadStatus(
        sessionWith(asSessionRequest(request)),
        { lessonId: 8, uploadId: UPLOAD_ID },
        new AbortController().signal,
      ),
    ).rejects.toThrow(message);
  });

  it.each(['2028-02-29T12:00:00Z', '2026-08-28T12:00:00.123Z', '2026-08-28T17:30:00+05:30'])(
    'accepts calendar-valid RFC3339 API-036 timestamps: %s',
    async (updatedAt) => {
      const request = vi.fn(async (options: ApiRequestOptions) =>
        decode(options, { ...uploadStatus, updated_at: updatedAt }),
      );

      await expect(
        requestInstructorLessonUploadStatus(
          sessionWith(asSessionRequest(request)),
          { lessonId: 8, uploadId: UPLOAD_ID },
          new AbortController().signal,
        ),
      ).resolves.toBe('processing');
    },
  );

  it.each([
    [{ ...uploadAcknowledgement, lesson_id: 0 }, 'upload acknowledgement lesson id'],
    [{ ...uploadAcknowledgement, lesson_id: 9 }, 'upload acknowledgement lesson id'],
    [{ ...uploadAcknowledgement, upload_id: '' }, 'upload acknowledgement upload id'],
    [
      { ...uploadAcknowledgement, upload_id: '0123456789abcdef0123456789abcdeg' },
      'upload acknowledgement upload id',
    ],
    [
      { ...uploadAcknowledgement, upload_id: '0123456789abcdef0123456789abcdeF' },
      'upload acknowledgement upload id',
    ],
    [{ ...uploadAcknowledgement, status: 'processing' }, 'Invalid upload acknowledgement status'],
    [{ ...uploadAcknowledgement, detail: null }, 'upload acknowledgement detail'],
    [lesson, 'upload acknowledgement upload id'],
  ])('rejects malformed or obsolete API-032 acknowledgements', async (response, message) => {
    const request = vi.fn(async (options: ApiRequestOptions) => decode(options, response));

    await expect(
      uploadInstructorLessonFile(
        sessionWith(asSessionRequest(request)),
        8,
        new File(['lesson'], 'lesson.mp4', { type: 'video/mp4' }),
      ),
    ).rejects.toThrow(message);
  });

  it('rejects malformed success payloads rather than projecting an unverified editor state', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) =>
      decode(options, { ...course, lessons: [{ ...course.lessons[0], lesson_type: 'audio' }] }),
    );
    await expect(
      requestInstructorEditorCourse(
        sessionWith(asSessionRequest(request)),
        7,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Unsupported lesson type: audio');
  });

  it('rejects a created lesson whose parent course differs from the API-015 course', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) =>
      decode(options, { ...lesson, course_id: 9 }),
    );

    await expect(
      createInstructorLesson(sessionWith(asSessionRequest(request)), 7, {
        title: 'New lesson',
        lessonType: 'pdf',
        description: 'Notes',
        isPublished: true,
      }),
    ).rejects.toThrow('Invalid lesson course id');
  });
});
