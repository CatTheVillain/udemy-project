import { describe, expect, it, vi } from 'vitest';

import {
  addCourseToCart,
  enrollFree,
  requestCourseDetail,
  requestEnrollments,
  requestLessonOutline,
} from '../../../src/features/course-detail/api';
import type { SessionContextValue } from '../../../src/features/auth-session';
import { ApiError, createApiClient, type ApiRequestOptions } from '../../../src/shared/api';

const course = {
  id: 7,
  title: 'React foundations',
  description: null,
  price: '0.00',
  currency: 'USD',
};

interface RequestTrace {
  calls: number;
}

function enrollment(id: number, courseId = id) {
  return {
    id,
    user_id: 9,
    course_id: courseId,
    status: 'active',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    course: { ...course, id: courseId, title: `Course ${courseId}` },
  };
}

function enrollmentPage(
  page: number,
  items: ReturnType<typeof enrollment>[],
  total: number,
  pages: number,
) {
  return {
    items,
    page,
    page_size: 100,
    total,
    pages,
    has_next: page < pages,
    has_previous: page > 1,
  };
}

function lesson(id: number, subtitleStatus?: boolean) {
  return {
    id,
    title: `Lesson ${id}`,
    lesson_type: 'video',
    download_url: `/media/lessons/${id}.mp4`,
    subtitle_status: subtitleStatus,
    description: null,
    is_published: true,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

function lessonPage(
  page: number,
  items: ReturnType<typeof lesson>[],
  total: number,
  pages: number,
) {
  return {
    items,
    page,
    page_size: 100,
    total,
    pages,
    has_next: page < pages,
    has_previous: page > 1,
  };
}

function sessionWithRequester(
  request: SessionContextValue['requestRequired'],
): SessionContextValue {
  return {
    state: { status: 'anonymous' },
    retryBootstrap() {},
    acceptAccessToken() {},
    clearSession() {},
    requestPublic: request,
    requestOptional: request,
    requestRequired: request,
  };
}

function decodingRequester(
  payloads: readonly unknown[],
  trace?: RequestTrace,
): SessionContextValue['requestRequired'] {
  let call = 0;
  return async <TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
  ) => {
    const payload = payloads[call];
    call += 1;
    if (trace) trace.calls = call;
    return options.decode ? options.decode(payload) : (payload as TResponse);
  };
}

function transportRequester(payloads: readonly unknown[]): SessionContextValue['requestRequired'] {
  let call = 0;
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetch: async () => {
      const payload = payloads[call];
      call += 1;
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  return (options) => client.request(options);
}

describe('course-detail API trust boundaries', () => {
  it('normalizes a malformed API-010 course response through the real client boundary', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ ...course, id: '7' }), { status: 200 }),
    );
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetch });
    const error = await requestCourseDetail(
      sessionWithRequester((options) => client.request(options)),
      7,
      new AbortController().signal,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'invalid_response', status: 200 });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/courses/7',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps the lesson outline transport contract and course-owned subtitle locator', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify(lessonPage(1, [{ ...lesson(8), subtitle_status: true }], 1, 1)),
          {
            status: 200,
          },
        ),
    );
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetch });

    const outline = await requestLessonOutline(
      sessionWithRequester((options) => client.request(options)),
      7,
      new AbortController().signal,
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/courses/7/lessons?page=1&size=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(outline.items[0]?.subtitleLocator).toEqual({ courseId: 7, lessonId: 8 });
  });

  it.each([
    ['API-020', enrollFree, enrollment(4, 7)],
    [
      'API-005',
      addCourseToCart,
      {
        id: 5,
        course_id: 7,
        added_at: '2026-07-01T00:00:00Z',
        course: { id: 7, title: 'React foundations', price: '19.99', currency: 'USD' },
      },
    ],
  ] as const)(
    'accepts a complete %s mutation response before discarding it',
    async (_operation, mutate, payload) => {
      const client = createApiClient({
        baseUrl: 'https://api.example.test',
        fetch: async () => new Response(JSON.stringify(payload), { status: 201 }),
      });
      const request: SessionContextValue['requestRequired'] = (options) => client.request(options);

      await expect(mutate(sessionWithRequester(request), 7)).resolves.toBeUndefined();
    },
  );

  it.each([
    ['API-020', enrollFree, null],
    ['API-005', addCourseToCart, { id: 5 }],
  ] as const)(
    'normalizes malformed %s success as invalid_response',
    async (_operation, mutate, payload) => {
      const client = createApiClient({
        baseUrl: 'https://api.example.test',
        fetch: async () => new Response(JSON.stringify(payload), { status: 201 }),
      });
      const request: SessionContextValue['requestRequired'] = (options) => client.request(options);

      await expect(mutate(sessionWithRequester(request), 7)).rejects.toMatchObject({
        kind: 'invalid_response',
        status: 201,
      });
    },
  );

  it('supports a valid multi-page enrollment aggregate', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => enrollment(index + 1));
    const result = await requestEnrollments(
      sessionWithRequester(
        decodingRequester([
          enrollmentPage(1, firstPage, 101, 2),
          enrollmentPage(2, [enrollment(101)], 101, 2),
        ]),
      ),
      new AbortController().signal,
    );

    expect(result.items).toHaveLength(101);
    expect(result).toMatchObject({
      page: 1,
      pageSize: 100,
      pages: 2,
      total: 101,
      hasNext: false,
      hasPrevious: false,
    });
  });

  it('supports a valid multi-page metadata-only lesson aggregate', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => lesson(index + 1));
    const result = await requestLessonOutline(
      sessionWithRequester(
        decodingRequester([lessonPage(1, firstPage, 101, 2), lessonPage(2, [lesson(101)], 101, 2)]),
      ),
      7,
      new AbortController().signal,
    );

    expect(result.items).toHaveLength(101);
    expect(result.total).toBe(101);
    expect(result.items[0]).not.toHaveProperty('downloadUrl');
  });

  it.each([
    [
      'lesson outline',
      (session: SessionContextValue, signal: AbortSignal) =>
        requestLessonOutline(session, 7, signal),
      lessonPage(
        1,
        Array.from({ length: 100 }, (_, index) => lesson(index + 1)),
        1100,
        11,
      ),
      'Invalid lesson aggregate pagination',
    ],
    [
      'enrollment aggregate',
      (session: SessionContextValue, signal: AbortSignal) => requestEnrollments(session, signal),
      enrollmentPage(
        1,
        Array.from({ length: 100 }, (_, index) => enrollment(index + 1)),
        1100,
        11,
      ),
      'Invalid enrollment aggregate pagination',
    ],
  ] as const)(
    'stops %s at the accepted ten-page maximum with invalid success context',
    async (_name, requestAggregate, payload, causeMessage) => {
      const fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
      const client = createApiClient({ baseUrl: 'https://api.example.test', fetch });
      const error = await requestAggregate(
        sessionWithRequester((options) => client.request(options)),
        new AbortController().signal,
      ).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        kind: 'invalid_response',
        status: 200,
        message: 'Server returned an invalid success response',
      });
      if (!(error instanceof ApiError)) throw new TypeError('Expected ApiError');
      expect(error.originalCause).toBeInstanceOf(TypeError);
      expect(error.originalCause).not.toBeInstanceOf(ApiError);
      expect(error.originalCause).toMatchObject({ message: causeMessage });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a response-page mismatch before requesting another page', async () => {
    const trace: RequestTrace = { calls: 0 };
    const request = decodingRequester(
      [
        lessonPage(2, [lesson(101)], 101, 2),
        lessonPage(
          1,
          Array.from({ length: 100 }, (_, index) => lesson(index + 1)),
          101,
          2,
        ),
      ],
      trace,
    );

    await expect(
      requestLessonOutline(sessionWithRequester(request), 7, new AbortController().signal),
    ).rejects.toThrow('Invalid lesson aggregate cursor');
    expect(trace.calls).toBe(1);
  });

  it.each([
    [
      'changed total',
      [
        lessonPage(
          1,
          Array.from({ length: 100 }, (_, index) => lesson(index + 1)),
          101,
          2,
        ),
        lessonPage(
          2,
          Array.from({ length: 50 }, (_, index) => lesson(index + 101)),
          150,
          2,
        ),
      ],
    ],
    [
      'changed pages',
      [
        lessonPage(
          1,
          Array.from({ length: 100 }, (_, index) => lesson(index + 1)),
          101,
          2,
        ),
        { ...lessonPage(2, [lesson(101)], 101, 2), pages: 3, has_next: true },
      ],
    ],
    [
      'changed page size',
      [
        lessonPage(
          1,
          Array.from({ length: 100 }, (_, index) => lesson(index + 1)),
          101,
          2,
        ),
        { ...lessonPage(2, [lesson(101)], 101, 2), page_size: 99 },
      ],
    ],
    [
      'duplicate lesson id',
      [
        lessonPage(
          1,
          Array.from({ length: 100 }, (_, index) => lesson(index + 1)),
          101,
          2,
        ),
        lessonPage(2, [lesson(1)], 101, 2),
      ],
    ],
    ['aggregate item count mismatch', [{ ...lessonPage(1, [lesson(1)], 2, 1) }]],
  ])('rejects an unsafe lesson aggregate: %s', async (_caseName, payloads) => {
    await expect(
      requestLessonOutline(
        sessionWithRequester(decodingRequester(payloads)),
        7,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it.each([
    [
      'response page mismatch',
      [enrollmentPage(2, [enrollment(101)], 101, 2)],
      'Invalid enrollment aggregate cursor',
    ],
    [
      'changed total',
      [
        enrollmentPage(
          1,
          Array.from({ length: 100 }, (_, index) => enrollment(index + 1)),
          101,
          2,
        ),
        enrollmentPage(2, [enrollment(101)], 102, 2),
      ],
      'Invalid enrollment aggregate metadata',
    ],
    [
      'changed pages',
      [
        enrollmentPage(
          1,
          Array.from({ length: 100 }, (_, index) => enrollment(index + 1)),
          101,
          2,
        ),
        enrollmentPage(2, [enrollment(101)], 201, 3),
      ],
      'Invalid enrollment aggregate metadata',
    ],
    [
      'changed page size',
      [
        enrollmentPage(
          1,
          Array.from({ length: 100 }, (_, index) => enrollment(index + 1)),
          101,
          2,
        ),
        { ...enrollmentPage(2, [enrollment(101)], 101, 2), page_size: 99 },
      ],
      'Invalid enrollment aggregate cursor',
    ],
    [
      'duplicate enrollment id',
      [
        enrollmentPage(
          1,
          Array.from({ length: 100 }, (_, index) => enrollment(index + 1)),
          101,
          2,
        ),
        enrollmentPage(2, [enrollment(1, 101)], 101, 2),
      ],
      'Invalid enrollment aggregate identity',
    ],
    [
      'duplicate course identity',
      [
        enrollmentPage(
          1,
          Array.from({ length: 100 }, (_, index) => enrollment(index + 1)),
          101,
          2,
        ),
        enrollmentPage(2, [enrollment(101, 1)], 101, 2),
      ],
      'Invalid enrollment aggregate identity',
    ],
  ])('normalizes an unsafe enrollment aggregate: %s', async (_caseName, payloads, causeMessage) => {
    const error = await requestEnrollments(
      sessionWithRequester(transportRequester(payloads)),
      new AbortController().signal,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw new TypeError('Expected ApiError');
    expect(error).toMatchObject({
      kind: 'invalid_response',
      status: 200,
      message: 'Server returned an invalid success response',
    });
    expect(error.originalCause).toBeInstanceOf(TypeError);
    if (causeMessage !== undefined) {
      expect(error.originalCause).toMatchObject({ message: causeMessage });
    }
  });

  it.each([
    ['invalid page bounds', [{ ...enrollmentPage(1, [], 0, 0), page: 2, has_previous: true }]],
    ['items exceed total', [{ ...enrollmentPage(1, [enrollment(1)], 0, 0) }]],
    ['invalid pagination flags', [{ ...enrollmentPage(1, [enrollment(1)], 1, 1), has_next: true }]],
  ])('rejects an unsafe enrollment aggregate: %s', async (_caseName, payloads) => {
    await expect(
      requestEnrollments(
        sessionWithRequester(decodingRequester(payloads)),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it('normalizes a final enrollment aggregate count mismatch as invalid_response', async () => {
    const error = await requestEnrollments(
      sessionWithRequester(decodingRequester([enrollmentPage(1, [enrollment(1)], 2, 1)])),
      new AbortController().signal,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw new TypeError('Expected ApiError');
    expect(error).toMatchObject({
      kind: 'invalid_response',
      status: 200,
      message: 'Server returned an invalid success response',
    });
    expect(error.originalCause).toBeInstanceOf(TypeError);
    expect(error.originalCause).toMatchObject({ message: 'Invalid enrollment aggregate' });
  });
});
