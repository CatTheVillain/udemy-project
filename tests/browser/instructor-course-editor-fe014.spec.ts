import { Buffer } from 'node:buffer';

import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import {
  createHttpFailureAccounting,
  findUnexpectedConsoleErrors,
  type ConsoleErrorEvidence,
} from './support/visual-quality';

const accessToken = 'fe014-test-only-instructor-token';
const courseId = 7;
const lessonId = 101;

const VALID_VIDEO_MP4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAACIhtZGF0//tQxAADwAABpAAAACAAADSAAAAETEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQAAAq4GBf//qtxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNDggcjI2NDMgNWM2NTcwNCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABRliIQAK//+2OfzLJOXereQdLvG0f/7UsRdg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OS41VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQAABP9tb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAtgABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAACEXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAtgAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAJwAAARRAAEAAAAAAYltZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAKxEAAAfUVXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAE0bWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAD4c3RibAAAAGBzdHNkAAAAAAAAAAEAAABQbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAAKxEAAAAAAAsZXNkcwAAAAADgICAGwABAASAgIANaxUAAAAAAPtRAAD7UQaAgIABAgAAACBzdHRzAAAAAAAAAAIAAAAGAAAEgAAAAAEAAARRAAAAKHN0c2MAAAAAAAAAAgAAAAEAAAABAAAAAQAAAAIAAAAGAAAAAQAAADBzdHN6AAAAAAAAAAAAAAAHAAAA0AAAANEAAADRAAAA0QAAANEAAADRAAAA0QAAABhzdGNvAAAAAAAAAAIAAAAwAAADygAAAhh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAACgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAoAAAAAAABAAAAAAGQbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABO21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPtzdGJsAAAAl3N0c2QAAAAAAAAAAQAAAIdhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBZAAK/+EAGGdkAAqs2V+IiIQAAAMABAAAAwDIPEiWWAEABmjr48siwAAAABhzdHRzAAAAAAAAAAEAAAABAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALKAAAAAQAAABRzdGNvAAAAAAAAAAEAAAEAAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY1Ni40MC4xMDE=',
  'base64',
);

type FixtureLocale = 'en' | 'ru' | 'uz';
type UploadStatusFixture = 'queued' | 'processing' | 'ready' | 'failed';

const FIXTURE_LOCALE_OPTION: Readonly<Record<FixtureLocale, string>> = {
  en: 'English',
  ru: 'Русский',
  uz: "O'zbek",
};

interface InstructorProfileFixture {
  readonly email: string;
  readonly name: string;
  readonly surname: string;
  readonly role: 'instructor';
  readonly birthday: null;
  readonly phone_number: null;
  readonly created_at: string;
}

interface LessonFixture {
  readonly id: number;
  readonly course_id: number;
  readonly title: string;
  readonly lesson_type: 'video' | 'text' | 'pdf';
  readonly download_url: string | null;
  readonly description: string | null;
  readonly is_published: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

interface InstructorSummaryFixture {
  readonly id: number;
  readonly name: string;
  readonly surname: string;
}

interface CourseFixture {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly price: string;
  readonly currency: string;
  readonly published_at: null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly instructor: InstructorSummaryFixture;
  readonly lessons: readonly LessonFixture[];
}

interface FixtureState {
  course: CourseFixture;
  lesson: LessonFixture;
  coursePatchStatus: number;
  lessonPatchStatus: number;
  lessonCreateStatus: number;
  uploadStatus: number;
  uploadObservationStatus: UploadStatusFixture;
  uploadObservationResponseStatus: number;
  uploadObservationLessonId: number;
  courseDeleteStatus: number;
  lessonDeleteStatus: number;
  coursePatchGate?: Promise<void>;
  lessonPatchGate?: Promise<void>;
  uploadGate?: Promise<void>;
  courseDeleteGate?: Promise<void>;
  lessonDeleteGate?: Promise<void>;
  readonly requests: Request[];
  readonly uploadStatusRequests: Request[];
  readonly mediaRequests: Request[];
}

interface DeferredAction {
  readonly promise: Promise<void>;
  resolve: () => void;
}

function deferredAction(): DeferredAction {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

const instructor: InstructorProfileFixture = {
  email: 'instructor@example.test',
  name: 'Indira',
  surname: 'Instructor',
  role: 'instructor',
  birthday: null,
  phone_number: null,
  created_at: '2026-08-08T00:00:00Z',
};

function createLesson(type: LessonFixture['lesson_type'] = 'video'): LessonFixture {
  return {
    id: lessonId,
    course_id: courseId,
    title: 'Contract-faithful lesson',
    lesson_type: type,
    download_url: null,
    description: 'An instructor-owned lesson for browser verification.',
    is_published: false,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
  };
}

function createCourse(lessons: readonly LessonFixture[]): CourseFixture {
  return {
    id: courseId,
    title: 'Contract-faithful instructor course',
    description: 'An instructor-owned course for browser verification.',
    price: '20.00',
    currency: 'USD',
    published_at: null,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
    instructor: { id: 3, name: 'Indira', surname: 'Instructor' },
    lessons,
  };
}

function createFixtureState(): FixtureState {
  const lesson = createLesson();
  return {
    course: createCourse([lesson]),
    lesson,
    coursePatchStatus: 200,
    lessonPatchStatus: 200,
    lessonCreateStatus: 200,
    uploadStatus: 200,
    uploadObservationStatus: 'processing',
    uploadObservationResponseStatus: 200,
    uploadObservationLessonId: lesson.id,
    courseDeleteStatus: 200,
    lessonDeleteStatus: 200,
    requests: [],
    uploadStatusRequests: [],
    mediaRequests: [],
  };
}

async function selectFixtureLocale(page: Page, locale: FixtureLocale): Promise<void> {
  const languageControl = page.getByRole('button', {
    name: /Change language|Изменить язык|Tilni o‘zgartirish/,
  });
  await expect(languageControl).toBeVisible();
  await languageControl.click();
  await page.getByRole('button', { name: FIXTURE_LOCALE_OPTION[locale] }).click();
}

function fulfilledCourse(course: CourseFixture) {
  return {
    ...course,
    lessons: course.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      course_id: lesson.course_id,
      lesson_type: lesson.lesson_type,
      download_url: lesson.download_url,
      description: lesson.description,
      is_published: lesson.is_published,
      created_at: lesson.created_at,
      updated_at: lesson.updated_at,
    })),
  };
}

function updatedCourse(course: CourseFixture) {
  return {
    id: course.id,
    instructor_id: course.instructor.id,
    title: course.title,
    description: course.description,
    price: course.price,
    currency: course.currency,
  };
}

function uploadId(lesson: LessonFixture) {
  return lesson.id.toString(16).padStart(32, '0');
}

function uploadAcknowledgement(lesson: LessonFixture) {
  return {
    lesson_id: lesson.id,
    upload_id: uploadId(lesson),
    status: 'queued',
    detail: 'File accepted for processing.',
  };
}

function uploadObservation(
  lesson: LessonFixture,
  status: UploadStatusFixture,
  observedLessonId: number,
) {
  return {
    upload_id: uploadId(lesson),
    lesson_id: observedLessonId,
    status,
    failure_reason: status === 'failed' ? 'PRIVATE_BACKEND_FAILURE_REASON' : null,
    updated_at: '2026-08-28T12:00:00Z',
  };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function failure(status: number, field = 'title') {
  if (status === 422) {
    return {
      detail: [
        {
          type: 'string_too_long',
          loc: ['body', field],
          msg: 'hostile fixture detail must never reach UI',
        },
      ],
    };
  }
  return { detail: 'hostile fixture detail must never reach UI' };
}

function api032RequestCount(requests: readonly Request[]): number {
  return requests.filter(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/lessons/${lessonId}/upload-file`,
  ).length;
}

async function expectAuthorized(request: Request): Promise<void> {
  expect(request.headers().authorization).toBe(`Bearer ${accessToken}`);
}

async function installInstructorFixture(page: Page, state: FixtureState): Promise<void> {
  await page.addInitScript(
    (token) => localStorage.setItem('learnhub.access-token', token),
    accessToken,
  );
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (path === '/me') {
      expect(method).toBe('GET');
      await expectAuthorized(request);
      await fulfillJson(route, 200, instructor);
      return;
    }
    if (path === `/courses/${courseId}` && method === 'GET') {
      await expectAuthorized(request);
      await fulfillJson(route, 200, fulfilledCourse(state.course));
      return;
    }
    if (path === `/courses/${courseId}/enrollments` && method === 'GET') {
      await expectAuthorized(request);
      await fulfillJson(route, 200, {
        items: [
          {
            id: 9,
            user_id: 12,
            course_id: courseId,
            status: 'active',
            created_at: '2026-08-08T00:00:00Z',
            updated_at: '2026-08-08T00:00:00Z',
            user: { id: 12, name: 'Sam', surname: 'Student', email: 'sam@example.test' },
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
        pages: 1,
        has_next: false,
        has_previous: false,
      });
      return;
    }
    if (path === `/lessons/${lessonId}` && method === 'GET') {
      await expectAuthorized(request);
      await fulfillJson(route, 200, state.lesson);
      return;
    }
    const mediaMatch = /^\/media\/lessons\/([^/]+)$/u.exec(path);
    if (mediaMatch !== null && method === 'GET') {
      await expectAuthorized(request);
      state.mediaRequests.push(request);
      const filename = decodeURIComponent(mediaMatch[1]);
      const contentType = filename.endsWith('.pdf') ? 'application/pdf' : 'video/mp4';
      await route.fulfill({
        status: 200,
        contentType,
        body:
          contentType === 'application/pdf'
            ? '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'
            : VALID_VIDEO_MP4,
      });
      return;
    }
    if (
      path === `/lessons/uploads/${lessonId.toString(16).padStart(32, '0')}/status` &&
      method === 'GET'
    ) {
      await expectAuthorized(request);
      state.uploadStatusRequests.push(request);
      if (state.uploadObservationResponseStatus !== 200) {
        await fulfillJson(
          route,
          state.uploadObservationResponseStatus,
          failure(state.uploadObservationResponseStatus),
        );
        return;
      }
      await fulfillJson(
        route,
        200,
        uploadObservation(
          state.lesson,
          state.uploadObservationStatus,
          state.uploadObservationLessonId,
        ),
      );
      return;
    }
    if (path === '/courses/my' && method === 'GET') {
      await expectAuthorized(request);
      await fulfillJson(route, 200, {
        items: [],
        page: 1,
        page_size: 20,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      });
      return;
    }

    const lessonUploadMatch = /^\/lessons\/(\d+)\/upload-file$/u.exec(path);
    const editorMutation =
      path === `/courses/${courseId}` ||
      path === `/courses/${courseId}/lessons` ||
      path === `/courses/${courseId}/lessons/${lessonId}` ||
      path === `/lessons/${lessonId}` ||
      lessonUploadMatch !== null;
    if (!editorMutation) {
      await route.continue();
      return;
    }

    await expectAuthorized(request);
    state.requests.push(request);
    if (path === `/courses/${courseId}` && method === 'PATCH') {
      expect(request.headers()['content-type']).toContain('application/json');
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['currency', 'description', 'price', 'title']);
      await state.coursePatchGate;
      if (state.coursePatchStatus !== 200) {
        await fulfillJson(route, state.coursePatchStatus, failure(state.coursePatchStatus));
        return;
      }
      state.course = { ...state.course, ...body } as CourseFixture;
      await fulfillJson(route, 200, updatedCourse(state.course));
      return;
    }
    if (path === `/courses/${courseId}/lessons` && method === 'POST') {
      expect(request.headers()['content-type']).toContain('application/json');
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'description',
        'is_published',
        'lesson_type',
        'title',
      ]);
      if (state.lessonCreateStatus !== 200) {
        await fulfillJson(route, state.lessonCreateStatus, failure(state.lessonCreateStatus));
        return;
      }
      const createdLesson: LessonFixture = {
        id: 102,
        course_id: courseId,
        title: String(body.title),
        lesson_type: body.lesson_type as LessonFixture['lesson_type'],
        download_url: null,
        description: body.description as string | null,
        is_published: body.is_published as boolean,
        created_at: '2026-08-08T00:00:00Z',
        updated_at: '2026-08-08T00:00:00Z',
      };
      state.course = { ...state.course, lessons: [...state.course.lessons, createdLesson] };
      await fulfillJson(route, 200, createdLesson);
      return;
    }
    if (path === `/courses/${courseId}/lessons/${lessonId}` && method === 'DELETE') {
      await state.lessonDeleteGate;
      if (state.lessonDeleteStatus !== 200) {
        await fulfillJson(route, state.lessonDeleteStatus, failure(state.lessonDeleteStatus));
        return;
      }
      state.course = {
        ...state.course,
        lessons: state.course.lessons.filter((lesson) => lesson.id !== lessonId),
      };
      await fulfillJson(route, 200, { message: 'Lesson deleted.' });
      return;
    }
    if (path === `/courses/${courseId}` && method === 'DELETE') {
      await state.courseDeleteGate;
      if (state.courseDeleteStatus !== 200) {
        await fulfillJson(route, state.courseDeleteStatus, failure(state.courseDeleteStatus));
        return;
      }
      await fulfillJson(route, 200, { message: 'Course deleted.' });
      return;
    }
    if (path === `/lessons/${lessonId}` && method === 'PATCH') {
      expect(request.headers()['content-type']).toContain('application/json');
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'description',
        'is_published',
        'lesson_type',
        'title',
      ]);
      await state.lessonPatchGate;
      if (state.lessonPatchStatus !== 200) {
        await fulfillJson(
          route,
          state.lessonPatchStatus,
          failure(state.lessonPatchStatus, 'is_published'),
        );
        return;
      }
      state.lesson = {
        ...state.lesson,
        title: String(body.title),
        lesson_type: body.lesson_type as LessonFixture['lesson_type'],
        description: body.description as string | null,
        is_published: body.is_published as boolean,
      };
      await fulfillJson(route, 200, state.lesson);
      return;
    }
    if (lessonUploadMatch && method === 'POST') {
      expect(request.headers()['content-type']).toContain('multipart/form-data');
      const multipart = request.postDataBuffer();
      expect(multipart?.toString('utf8')).toContain('name="file"');
      await state.uploadGate;
      if (state.uploadStatus !== 200) {
        await fulfillJson(route, state.uploadStatus, failure(state.uploadStatus, 'file'));
        return;
      }
      const uploadLessonId = Number(lessonUploadMatch[1]);
      const uploadLesson =
        state.course.lessons.find((lesson) => lesson.id === uploadLessonId) ?? state.lesson;
      await fulfillJson(route, 200, uploadAcknowledgement(uploadLesson));
      return;
    }
    await route.abort();
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.client);
  expect(widths.body).toBeLessThanOrEqual(widths.client);
}

async function uploadFixtureFile(page: Page): Promise<void> {
  const lessonFile = page.locator('input[name="file"]');
  await lessonFile.setInputFiles({
    name: 'browser-video.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('video'),
  });
  const uploadButton = page.getByRole('button', {
    name: /Upload file|Загрузить файл|Faylni yuklash/,
  });
  await uploadButton.focus();
  await expect(uploadButton).toBeFocused();
  await uploadButton.click();
}

interface HttpDiagnostic {
  readonly method: string;
  readonly pathAndQuery: string;
  readonly status: number;
  readonly url: string;
}

interface BrowserDiagnostics {
  readonly pageErrors: string[];
  readonly consoleErrors: ConsoleErrorEvidence[];
  readonly requestFailures: string[];
  readonly relevantHttp: HttpDiagnostic[];
}

interface ExpectedNegativeHttp {
  readonly method: string;
  readonly pathAndQuery: string;
  readonly status: number;
  readonly count: number;
}

const browserDiagnostics = new WeakMap<Page, BrowserDiagnostics>();

const expectedNegativeHttpByScenario: Readonly<Record<string, readonly ExpectedNegativeHttp[]>> = {
  'uses authenticated course PATCH and lesson POST contracts, including safe 422 focus': [
    { method: 'PATCH', pathAndQuery: '/courses/7', status: 422, count: 1 },
    { method: 'POST', pathAndQuery: '/courses/7/lessons', status: 422, count: 1 },
  ],
  'confirms named destructive actions and restores keyboard focus on cancel': [
    { method: 'DELETE', pathAndQuery: '/courses/7/lessons/101', status: 404, count: 1 },
  ],
  'announces truthful pending course and lesson deletes without duplicate mutations': [
    { method: 'DELETE', pathAndQuery: '/courses/7/lessons/101', status: 404, count: 1 },
  ],
  'clears a pending destructive confirmation when its request ends the session': [
    { method: 'DELETE', pathAndQuery: '/courses/7', status: 401, count: 1 },
  ],
  'uses lesson PATCH and contract-faithful multipart upload without terminal or replacement UI': [
    { method: 'PATCH', pathAndQuery: '/lessons/101', status: 422, count: 1 },
  ],
  'renders safe upload errors and keeps controls responsive under reduced motion': [
    { method: 'POST', pathAndQuery: '/lessons/101/upload-file', status: 422, count: 1 },
  ],
  'settles deferred course and upload failures in the locale selected while pending': [
    { method: 'PATCH', pathAndQuery: '/courses/7', status: 422, count: 1 },
    { method: 'POST', pathAndQuery: '/lessons/101/upload-file', status: 422, count: 1 },
  ],
};

function assertBrowserDiagnostics(
  diagnostics: BrowserDiagnostics,
  expectedNegativeHttp: readonly ExpectedNegativeHttp[] = [],
) {
  expect(diagnostics.pageErrors, 'unexpected page errors').toEqual([]);
  expect(diagnostics.requestFailures, 'unexpected request failures').toEqual([]);
  const actualNegativeHttp = diagnostics.relevantHttp.filter((response) => response.status >= 400);
  const expected = expectedNegativeHttp.flatMap(({ count, ...response }) =>
    Array.from({ length: count }, () => response),
  );
  expect(
    actualNegativeHttp.map(({ method, pathAndQuery, status }) => ({
      method,
      pathAndQuery,
      status,
    })),
    'unexpected relevant HTTP failures',
  ).toEqual(expected);

  const negativeHttpAccounting = createHttpFailureAccounting();
  expectedNegativeHttp.forEach(({ count, pathAndQuery, ...response }) => {
    negativeHttpAccounting.allow({ ...response, path: pathAndQuery }, count);
  });
  diagnostics.relevantHttp.forEach(({ method, status, url }) => {
    negativeHttpAccounting.observe(method, url, status);
  });
  expect(
    findUnexpectedConsoleErrors(
      diagnostics.consoleErrors,
      negativeHttpAccounting.acceptedFailures(),
    ),
    'unexpected console errors',
  ).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  const diagnostics: BrowserDiagnostics = {
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    relevantHttp: [],
  };
  browserDiagnostics.set(page, diagnostics);
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on('requestfailed', (request) => {
    diagnostics.requestFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    );
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname !== '127.0.0.1') return;
    diagnostics.relevantHttp.push({
      method: response.request().method(),
      pathAndQuery: `${url.pathname}${url.search}`,
      status: response.status(),
      url: response.url(),
    });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  assertBrowserDiagnostics(
    browserDiagnostics.get(page) ?? {
      pageErrors: ['missing browser diagnostic monitor'],
      consoleErrors: [],
      requestFailures: [],
      relevantHttp: [],
    },
    expectedNegativeHttpByScenario[testInfo.title] ?? [],
  );
});

async function expectInstructorCanvasToMeetFooter(page: Page) {
  const footer = page.getByRole('contentinfo');
  await footer.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => {
      const canvas = document.querySelector('article');
      const footerElement = document.querySelector('footer');
      if (!canvas || !footerElement) throw new Error('Expected Instructor canvas and footer.');
      return canvas.getBoundingClientRect().bottom - footerElement.getBoundingClientRect().top;
    }),
  ).toBeGreaterThanOrEqual(-1);
}

test('uses authenticated course PATCH and lesson POST contracts, including safe 422 focus', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  await expect(page.getByRole('heading', { name: 'Edit course' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByText('Contract-faithful instructor course', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add lesson' }).click();
  await expect(page.getByLabel('Lesson title')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(
    await page.evaluate(() => {
      const price = document.querySelector<HTMLInputElement>('input[name="price"]');
      const currency = document.querySelector<HTMLInputElement>('input[name="currency"]');
      const createLesson = document.querySelector('#create-lesson-heading')?.closest('section');
      const dangerZone = document.querySelector('#danger-zone-heading')?.closest('section');
      if (!price || !currency || !createLesson || !dangerZone) return false;
      return (
        currency.getBoundingClientRect().top > price.getBoundingClientRect().top &&
        dangerZone.compareDocumentPosition(createLesson) === Node.DOCUMENT_POSITION_PRECEDING
      );
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectInstructorCanvasToMeetFooter(page);
  state.coursePatchStatus = 422;
  await page.getByLabel('Course title').fill('An intentionally invalid contract course title');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByLabel('Course title')).toBeFocused();
  await expect(page.getByLabel('Course title')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Check course title and submit again.')).toBeVisible();
  await expect(page.getByText('hostile fixture detail must never reach UI')).toHaveCount(0);

  state.coursePatchStatus = 200;
  await page.getByLabel('Course title').fill('Saved course title');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'PATCH'))
    .toHaveLength(2);

  state.lessonCreateStatus = 422;
  await page.getByLabel('Lesson title').fill('Browser-created lesson');
  await page.getByRole('checkbox', { name: 'Publish this lesson' }).check();
  await page.getByRole('button', { name: 'Create lesson' }).click();
  await expect(page.getByLabel('Lesson title')).toBeFocused();
  await expect(page.getByLabel('Lesson title')).toHaveAttribute('aria-invalid', 'true');

  state.lessonCreateStatus = 200;
  await page.getByLabel('Lesson title').fill('Browser-created lesson');
  await page.getByRole('button', { name: 'Create lesson' }).click();
  await expect(page.getByText('Browser-created lesson')).toBeVisible();
  expect(state.requests.filter((request) => request.method() === 'POST')).toHaveLength(2);
});

test('creates a PDF lesson and then uploads its optional source file', async ({ page }) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  await page.getByRole('button', { name: 'Add lesson' }).click();
  await expect(page.getByText('MP4, WebM, or MOV up to 150 MB.', { exact: true })).toBeVisible();
  await page.getByLabel('Lesson title').fill('PDF created with source');
  await page.getByRole('combobox', { name: 'Lesson type' }).click();
  await page.getByRole('option', { name: 'PDF' }).click();
  await expect(page.getByText('PDF up to 50 MB.', { exact: true })).toBeVisible();
  await page.getByLabel('Lesson file (optional)').setInputFiles({
    name: 'browser-notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('pdf'),
  });
  const createLessonButton = page.getByRole('button', { name: 'Create lesson' });
  const [formBox, buttonBox] = await Promise.all([
    page.locator('#create-lesson-panel form').boundingBox(),
    createLessonButton.boundingBox(),
  ]);
  expect(formBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect((buttonBox?.x ?? 0) + (buttonBox?.width ?? 0)).toBeGreaterThan(
    (formBox?.x ?? 0) + (formBox?.width ?? 0) / 2,
  );
  await createLessonButton.click();

  await expect(page.getByText('PDF created with source')).toBeVisible();
  await expect
    .poll(() => state.requests.map((request) => new URL(request.url()).pathname))
    .toEqual([`/courses/${courseId}/lessons`, '/lessons/102/upload-file']);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('opens truthful saved instructor content with canonical media access and restores focus', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);

  state.lesson = {
    ...createLesson('text'),
    title: 'Saved browser text lesson',
    description: 'Saved instructor text from the browser fixture.',
  };
  state.course = createCourse([state.lesson]);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Text lesson' })).toBeVisible();
  const textDetails = page.getByRole('button', { name: 'Details' });
  await textDetails.click();
  await expect(page.getByRole('region', { name: 'Text lesson' })).toContainText(
    'Saved instructor text from the browser fixture.',
  );
  const closeText = page.getByRole('button', { name: 'Close dialog' });
  await expect(closeText).toHaveCSS('color', 'rgb(91, 63, 214)');
  await closeText.click();
  await expect(textDetails).toBeFocused();
  expect(state.mediaRequests).toEqual([]);

  state.lesson = { ...state.lesson, description: '' };
  state.course = createCourse([state.lesson]);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
  await selectFixtureLocale(page, 'ru');
  await page.getByRole('button', { name: 'Подробнее' }).click();
  await expect(page.getByRole('region', { name: 'Текстовый урок' })).toContainText(
    'Описание урока отсутствует.',
  );
  await page.getByRole('button', { name: 'Закрыть диалог' }).dispatchEvent('click');
  expect(state.mediaRequests).toEqual([]);

  state.lesson = {
    ...createLesson('video'),
    title: 'Saved browser video lesson',
    download_url: '/media/lessons/browser-video.mp4',
  };
  state.course = createCourse([state.lesson]);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Предпросмотр видео урока' })).toBeVisible();
  const loadVideo = page.getByRole('button', { name: 'Загрузить видео' });
  await loadVideo.click();
  await expect(page.getByLabel('Предпросмотр видео урока')).toBeVisible();
  await expect
    .poll(() => state.mediaRequests.map((request) => new URL(request.url()).pathname))
    .toEqual(['/media/lessons/browser-video.mp4']);
  const closeVideo = page.getByRole('button', { name: 'Закрыть диалог' });
  await expect(closeVideo).toHaveCSS('color', 'rgb(91, 63, 214)');
  await closeVideo.dispatchEvent('click');
  await expect(loadVideo).toBeFocused();

  state.lesson = {
    ...createLesson('pdf'),
    title: 'Saved browser PDF lesson',
    download_url: '/media/lessons/browser-notes.pdf',
  };
  state.course = createCourse([state.lesson]);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Предпросмотр PDF-файла урока' })).toBeVisible();
  const loadPdf = page.getByRole('button', { name: 'Загрузить PDF' });
  await loadPdf.click();
  await expect(page.getByRole('button', { name: 'Закрыть диалог' })).toBeVisible();
  await expect
    .poll(() => state.mediaRequests.map((request) => new URL(request.url()).pathname))
    .toEqual(['/media/lessons/browser-video.mp4', '/media/lessons/browser-notes.pdf']);
  const closePdf = page.getByRole('button', { name: 'Закрыть диалог' });
  await expect(closePdf).toHaveCSS('color', 'rgb(91, 63, 214)');
  await closePdf.click();
  await expect(loadPdf).toBeFocused();

  state.lesson = { ...createLesson('video'), download_url: null };
  state.course = createCourse([state.lesson]);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
  await expect(page.getByText('Медиа недоступны в этом разделе')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить видео' })).toHaveCount(0);
  expect(state.mediaRequests).toHaveLength(2);
  await expectNoHorizontalOverflow(page);
});

test('returns from the editor through the contextual Instructor courses link without a mutation', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  const returnLink = page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Instructor courses' });
  await expect(returnLink).toHaveAttribute('href', '/instructor/courses');
  await returnLink.focus();
  await expect(returnLink).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL('/instructor/courses');
  expect(state.requests.filter((request) => request.method() !== 'GET')).toEqual([]);
});

test('makes the outlined Delete course action solid red with white content on hover', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  const deleteCourse = page.getByRole('button', { name: 'Delete course' });
  await expect(deleteCourse).toHaveCSS('color', 'rgb(185, 28, 28)');
  await expect(deleteCourse).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await deleteCourse.hover();
  await expect(deleteCourse).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(deleteCourse).toHaveCSS('background-color', 'rgb(185, 28, 28)');
  await expect(deleteCourse.locator('svg')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expectNoHorizontalOverflow(page);
});

test('confirms named destructive actions and restores keyboard focus on cancel', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  const deleteLesson = page.getByRole('button', { name: 'Delete lesson' });
  await expect(deleteLesson).toBeVisible();
  await deleteLesson.focus();
  await deleteLesson.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Delete Contract-faithful lesson.');
  await page.keyboard.press('Escape');
  await expect(deleteLesson).toBeFocused();

  state.lessonDeleteStatus = 404;
  await deleteLesson.click();
  await page.getByRole('button', { name: 'Delete lesson' }).last().click();
  await expect(page.getByRole('dialog')).toContainText(
    'This course or lesson is no longer available.',
  );
  await expect(page.getByText('hostile fixture detail must never reach UI')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(deleteLesson).toBeFocused();

  state.lessonDeleteStatus = 200;
  await deleteLesson.click();
  await page.getByRole('button', { name: 'Delete lesson' }).last().click();
  await expect(page.getByText('Contract-faithful lesson')).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete course' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Delete Contract-faithful instructor course.',
  );
  await page.getByRole('button', { name: 'Delete course' }).last().click();
  await expect(page).toHaveURL(/\/instructor\/courses$/);
  expect(state.requests.filter((request) => request.method() === 'DELETE')).toHaveLength(3);
});

test('announces truthful pending course and lesson deletes without duplicate mutations', async ({
  page,
}) => {
  const state = createFixtureState();
  const lessonGate = deferredAction();
  state.lessonDeleteGate = lessonGate.promise;
  state.lessonDeleteStatus = 404;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  const deleteLesson = page.getByRole('button', { name: 'Delete lesson' });
  await expect(deleteLesson).toBeVisible();
  await deleteLesson.focus();
  await deleteLesson.press('Enter');
  const lessonDialog = page.getByRole('dialog', { name: 'Delete this lesson?' });
  await lessonDialog.getByRole('button', { name: 'Delete lesson' }).press('Enter');
  const pendingLesson = lessonDialog.getByRole('button', { name: 'Deleting lesson...' });
  await expect(pendingLesson).toBeDisabled();
  await expect(pendingLesson).toHaveAttribute('aria-busy', 'true');
  await expect(lessonDialog.getByRole('status')).toHaveText('Deleting lesson...');
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'DELETE'))
    .toHaveLength(1);
  await page.keyboard.press('Enter');
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'DELETE'))
    .toHaveLength(1);

  for (const width of [320, 390, 768, 1280] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(lessonDialog).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expectNoHorizontalOverflow(page);
  await expect(pendingLesson.locator('[data-part="spinner"]')).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });

  lessonGate.resolve();
  await expect(lessonDialog.getByRole('alert')).toContainText(
    'This course or lesson is no longer available.',
  );
  await lessonDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(deleteLesson).toBeFocused();

  const courseGate = deferredAction();
  state.courseDeleteGate = courseGate.promise;
  const deleteCourse = page.getByRole('button', { name: 'Delete course' });
  await deleteCourse.click();
  const courseDialog = page.getByRole('dialog', { name: 'Delete this course?' });
  await courseDialog.getByRole('button', { name: 'Delete course' }).click();
  const pendingCourse = courseDialog.getByRole('button', { name: 'Deleting course...' });
  await expect(pendingCourse).toBeDisabled();
  await expect(pendingCourse).toHaveAttribute('aria-busy', 'true');
  await expect(courseDialog.getByRole('status')).toHaveText('Deleting course...');
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'DELETE'))
    .toHaveLength(2);
  const pendingCourseBox = await pendingCourse.boundingBox();
  if (!pendingCourseBox) throw new Error('Pending course confirmation geometry is unavailable.');
  await page.mouse.click(
    pendingCourseBox.x + pendingCourseBox.width / 2,
    pendingCourseBox.y + pendingCourseBox.height / 2,
  );
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'DELETE'))
    .toHaveLength(2);

  courseGate.resolve();
  await expect(page).toHaveURL(/\/instructor\/courses$/);
});

test('clears a pending destructive confirmation when its request ends the session', async ({
  page,
}) => {
  const state = createFixtureState();
  const deleteGate = deferredAction();
  state.courseDeleteGate = deleteGate.promise;
  state.courseDeleteStatus = 401;
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  await page.getByRole('button', { name: 'Delete course' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this course?' });
  await dialog.getByRole('button', { name: 'Delete course' }).click();
  await expect(dialog.getByRole('button', { name: 'Deleting course...' })).toBeDisabled();
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'DELETE'))
    .toHaveLength(1);

  deleteGate.resolve();

  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(state.requests.filter((request) => request.method() === 'DELETE')).toHaveLength(1);
});

test('keeps Save lesson primary styling, geometry, and label stable without a pending spinner', async ({
  page,
}) => {
  const state = createFixtureState();
  const patchGate = deferredAction();
  state.lessonPatchGate = patchGate.promise;
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });

  const saveLesson = page.getByRole('button', { name: 'Save lesson' });
  const uploadPanel = page.getByRole('heading', { name: 'Upload lesson file' }).locator('..');
  await expect(saveLesson).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('All changes saved');
  await page.getByLabel('Lesson title').fill('Updated stable lesson');
  await expect(saveLesson).toBeEnabled();
  await expect(page.getByText('All changes saved')).toHaveCount(0);
  const [uploadBox, idleBox, idleBackground, idleColor] = await Promise.all([
    uploadPanel.boundingBox(),
    saveLesson.boundingBox(),
    saveLesson.evaluate((element) => getComputedStyle(element).backgroundColor),
    saveLesson.evaluate((element) => getComputedStyle(element).color),
  ]);
  if (!uploadBox || !idleBox) throw new Error('Lesson editor action geometry is unavailable.');
  expect(uploadBox.y + uploadBox.height).toBeLessThanOrEqual(idleBox.y);

  await saveLesson.click();
  await expect(saveLesson).toBeDisabled();
  await expect(saveLesson).toHaveAttribute('aria-busy', 'true');
  await expect(saveLesson).toHaveText('Save lesson');
  await expect(saveLesson.locator('[data-part="spinner"]')).toHaveCount(0);
  const pendingBox = await saveLesson.boundingBox();
  if (!pendingBox) throw new Error('Pending Save lesson geometry is unavailable.');
  expect(pendingBox.width).toBeCloseTo(idleBox.width, 1);
  expect(pendingBox.height).toBeCloseTo(idleBox.height, 1);
  await expect(saveLesson).toHaveCSS('background-color', idleBackground);
  await expect(saveLesson).toHaveCSS('color', idleColor);
  await expect(saveLesson).toHaveCSS('cursor', 'pointer');

  await page.keyboard.press('Enter');
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'PATCH'))
    .toHaveLength(1);
  await expectNoHorizontalOverflow(page);

  patchGate.resolve();
  await expect(saveLesson).toHaveCount(0);
  const savedState = page.getByRole('status');
  await expect(savedState).toContainText('All changes saved');
  await expect(savedState).toHaveCSS('color', 'rgb(55, 65, 81)');
  await expect(savedState.locator('svg')).toHaveCount(1);
  await expect(page.getByText('lessonEditorAllChangesSaved')).toHaveCount(0);
});

test('uses lesson PATCH and contract-faithful multipart upload without terminal or replacement UI', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });

  const lessonHeading = page.getByRole('heading', { name: 'Edit lesson' });
  const backToCourse = page.getByRole('link', { name: 'Back to course' });
  await expect(lessonHeading).toBeVisible();
  await expect(backToCourse).toHaveCSS('color', 'rgb(91, 63, 214)');
  const [backBox, headingBox] = await Promise.all([
    backToCourse.boundingBox(),
    lessonHeading.boundingBox(),
  ]);
  if (!backBox || !headingBox) throw new Error('Lesson editor header geometry is unavailable.');
  expect(backBox.x).toBeCloseTo(headingBox.x, 1);
  expect(backBox.y + backBox.height).toBeLessThanOrEqual(headingBox.y);
  state.lessonPatchStatus = 422;
  await page.getByRole('checkbox', { name: 'Publish this lesson' }).check();
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await expect(page.getByRole('checkbox', { name: 'Publish this lesson' })).toBeFocused();
  await expect(page.getByRole('checkbox', { name: 'Publish this lesson' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );

  state.lessonPatchStatus = 200;
  await page.getByLabel('Lesson title').fill('Updated browser lesson');
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'PATCH'))
    .toHaveLength(2);

  const uploadRequestsBeforeTypeChanges = api032RequestCount(state.requests);
  const lessonFile = page.locator('input[name="file"]');
  const filePicker = lessonFile.locator('..');
  await expect(filePicker).toHaveCSS('border-top-style', 'dashed');
  await lessonFile.setInputFiles({
    name: 'browser-video.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('video'),
  });
  await expect(filePicker.getByText('browser-video.mp4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled();

  await page.getByRole('combobox', { name: 'Lesson type' }).click();
  await page.getByRole('option', { name: 'PDF' }).click();
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await expect(
    page.getByText('The lesson type changed. Choose a file that matches the updated lesson type.'),
  ).toBeVisible();
  await expect(lessonFile).toHaveValue('');
  await expect(lessonFile).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeDisabled();
  expect(api032RequestCount(state.requests)).toBe(uploadRequestsBeforeTypeChanges);

  await lessonFile.setInputFiles({
    name: 'browser-notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('pdf'),
  });
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled();

  await page.getByRole('combobox', { name: 'Lesson type' }).click();
  await page.getByRole('option', { name: 'Video' }).click();
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await expect(
    page.getByText('The lesson type changed. Choose a file that matches the updated lesson type.'),
  ).toBeVisible();
  await expect(lessonFile).toHaveValue('');
  await expect(lessonFile).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeDisabled();
  expect(api032RequestCount(state.requests)).toBe(uploadRequestsBeforeTypeChanges);

  await lessonFile.setInputFiles({
    name: 'browser-video.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('video'),
  });
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled();
  await page.getByRole('button', { name: 'Upload file' }).click();
  await expect(page.getByText('Processing')).toBeVisible();
  await expect(page.getByText('File accepted and queued')).toHaveCount(0);
  await expect(page.getByText('Processing status is unavailable.')).toHaveCount(0);
  await expect(page.locator('input[name="file"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /upload|retry|cancel|download|play/i }),
  ).toHaveCount(0);
  await expect(page.getByText(/progress|ready|complete|replacement/i)).toHaveCount(0);
  expect(api032RequestCount(state.requests)).toBe(uploadRequestsBeforeTypeChanges + 1);
});

test('keeps the persisted lesson type upload rule while an unsaved type change is pending', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });

  const lessonFile = page.locator('input[name="file"]');
  await expect(lessonFile).toHaveAttribute('accept', '.mp4,.webm,.mov');

  await page.getByRole('combobox', { name: 'Lesson type' }).click();
  await page.getByRole('option', { name: 'PDF' }).click();
  await expect(page.getByRole('button', { name: 'Save lesson' })).toBeVisible();
  await expect(lessonFile).toHaveAttribute('accept', '.mp4,.webm,.mov');

  await lessonFile.setInputFiles({
    name: 'unsaved-type-change.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('pdf'),
  });
  await expect(
    page.getByText('Choose a file that matches the stated type and size limit.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeDisabled();
  expect(api032RequestCount(state.requests)).toBe(0);
});

test('renders every correlated upload observation state safely across English, Russian, and Uzbek', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const state = createFixtureState();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installInstructorFixture(page, state);

  const cases: ReadonlyArray<{
    readonly locale: FixtureLocale;
    readonly observationStatus: UploadStatusFixture | 'unavailable';
    readonly responseStatus: number;
    readonly expectedCopy: string;
    readonly expectedDetail?: string;
    readonly stopsPolling: boolean;
  }> = [
    {
      locale: 'en',
      observationStatus: 'queued',
      responseStatus: 200,
      expectedCopy: 'Queued',
      stopsPolling: false,
    },
    {
      locale: 'ru',
      observationStatus: 'processing',
      responseStatus: 200,
      expectedCopy: 'Обрабатывается',
      stopsPolling: false,
    },
    {
      locale: 'uz',
      observationStatus: 'ready',
      responseStatus: 200,
      expectedCopy: 'Yuklangan manba fayli tayyor',
      expectedDetail: 'Subtitrlar va yaratilgan media holati mavjud emas.',
      stopsPolling: true,
    },
    {
      locale: 'ru',
      observationStatus: 'failed',
      responseStatus: 200,
      expectedCopy: 'Не удалось загрузить исходный файл.',
      stopsPolling: true,
    },
    {
      locale: 'en',
      observationStatus: 'unavailable',
      responseStatus: 200,
      expectedCopy: 'Upload status is unavailable. Check the lesson later.',
      stopsPolling: true,
    },
  ];

  for (const fixture of cases) {
    state.uploadObservationStatus =
      fixture.observationStatus === 'unavailable' ? 'processing' : fixture.observationStatus;
    state.uploadObservationResponseStatus = fixture.responseStatus;
    state.uploadObservationLessonId =
      fixture.observationStatus === 'unavailable' ? lessonId + 1 : lessonId;
    state.uploadStatusRequests.length = 0;
    await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
    await expect(
      page.getByRole('heading', { name: /Edit lesson|Редактировать урок|Darsni tahrirlash/ }),
    ).toBeVisible();
    await selectFixtureLocale(page, fixture.locale);

    const failedObservation =
      fixture.responseStatus === 200
        ? null
        : page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                `/lessons/uploads/${uploadId(state.lesson)}/status` &&
              response.status() === fixture.responseStatus,
          );
    await uploadFixtureFile(page);
    if (failedObservation) await failedObservation;
    await expect(page.getByText(fixture.expectedCopy, { exact: true })).toBeVisible();
    if (fixture.expectedDetail) {
      await expect(page.getByText(fixture.expectedDetail, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('PRIVATE_BACKEND_FAILURE_REASON')).toHaveCount(0);
    await expect(page.locator('input[name="file"]')).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: /upload|загрузить|yuklash|retry|повтор|qayta|cancel|отмен|bekor|download|скач|yuklab|play|воспроиз|ijro/i,
      }),
    ).toHaveCount(0);
    await expect.poll(() => state.uploadStatusRequests.length).toBeGreaterThanOrEqual(1);
    expect(new URL(state.uploadStatusRequests[0]?.url() ?? '').pathname).toBe(
      `/lessons/uploads/${uploadId(state.lesson)}/status`,
    );

    for (const width of [320, 768, 1024, 1440] as const) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByText(fixture.expectedCopy, { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    if (fixture.stopsPolling) {
      await page.waitForTimeout(2_200);
      expect(state.uploadStatusRequests).toHaveLength(1);
    } else {
      const requestCountBeforeNavigation = state.uploadStatusRequests.length;
      await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });
      await expect(
        page.getByRole('heading', { name: /Edit course|Редактировать курс|Kursni tahrirlash/ }),
      ).toBeVisible();
      await page.waitForTimeout(2_200);
      expect(state.uploadStatusRequests).toHaveLength(requestCountBeforeNavigation);
    }
  }
});

test('renders safe upload errors and keeps controls responsive under reduced motion', async ({
  page,
}) => {
  const state = createFixtureState();
  state.uploadStatus = 422;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });

  const lessonFile = page.locator('input[name="file"]');
  await expect(lessonFile).toHaveCount(1);
  await lessonFile.setInputFiles({
    name: 'browser-video.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from('video'),
  });
  await page.getByRole('button', { name: 'Upload file' }).click();
  await expect(page.getByRole('button', { name: 'Lesson file' })).toBeFocused();
  await expect(page.locator('input[name="file"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Check lesson file and submit again.')).toBeVisible();
  await expect(page.getByText('hostile fixture detail must never reach UI')).toHaveCount(0);

  for (const width of [320, 768, 1024, 1440] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Edit lesson' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expectNoHorizontalOverflow(page);
});

test('settles deferred course and upload failures in the locale selected while pending', async ({
  page,
}) => {
  const state = createFixtureState();
  const courseGate = deferredAction();
  state.coursePatchStatus = 422;
  state.coursePatchGate = courseGate.promise;
  await installInstructorFixture(page, state);
  await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });

  const courseTitle = page.getByLabel('Course title');
  await expect(courseTitle).toBeVisible();
  await courseTitle.fill('Deferred browser course');
  const saveChanges = page.getByRole('button', { name: 'Save changes' });
  const [idleSaveBackground, idleSaveColor, idleSaveBox] = await Promise.all([
    saveChanges.evaluate((element) => getComputedStyle(element).backgroundColor),
    saveChanges.evaluate((element) => getComputedStyle(element).color),
    saveChanges.boundingBox(),
  ]);
  await saveChanges.click();
  await expect(saveChanges).toBeDisabled();
  await expect(saveChanges).toHaveAttribute('aria-busy', 'true');
  await expect(saveChanges).toHaveText('Save changes');
  await expect(saveChanges.locator('[data-part="spinner"]')).toHaveCount(0);
  await expect(saveChanges).toHaveCSS('background-color', idleSaveBackground);
  await expect(saveChanges).toHaveCSS('color', idleSaveColor);
  await expect(saveChanges).toHaveCSS('cursor', 'pointer');
  const pendingSaveBox = await saveChanges.boundingBox();
  if (!idleSaveBox || !pendingSaveBox) throw new Error('Save changes geometry is unavailable.');
  expect(pendingSaveBox.width).toBeCloseTo(idleSaveBox.width, 1);
  expect(pendingSaveBox.height).toBeCloseTo(idleSaveBox.height, 1);
  await expect
    .poll(() => state.requests.filter((request) => request.method() === 'PATCH'))
    .toHaveLength(1);
  await selectFixtureLocale(page, 'ru');
  await expect(page.getByRole('button', { name: 'Изменить язык' })).toBeVisible();
  courseGate.resolve();
  await expect(page.getByLabel('Название курса')).toBeFocused();
  await expect(
    page.getByText('Проверьте поле название курса и отправьте форму снова.'),
  ).toBeVisible();
  await expect(page.getByText('hostile fixture detail must never reach UI')).toHaveCount(0);
  await expect(page.getByLabel('Название курса')).toHaveValue('Deferred browser course');
  expect(state.requests.filter((request) => request.method() === 'PATCH')).toHaveLength(1);

  const uploadGate = deferredAction();
  state.uploadStatus = 422;
  state.uploadGate = uploadGate.promise;
  await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Редактировать урок' })).toBeVisible();
  const lessonFile = page.locator('input[name="file"]');
  await lessonFile.setInputFiles({
    name: 'deferred-browser-video.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('video'),
  });
  await page.getByRole('button', { name: 'Загрузить файл' }).click();
  await expect(page.locator('button[data-state="loading"]')).toBeDisabled();
  await expect.poll(() => api032RequestCount(state.requests)).toBe(1);
  await selectFixtureLocale(page, 'uz');
  await expect(page.getByRole('button', { name: 'Tilni o‘zgartirish' })).toBeVisible();
  uploadGate.resolve();
  await expect(page.locator('input[name="file"]')).toBeFocused();
  await expect(page.getByText('dars fayli maydonini tekshirib, qayta yuboring.')).toBeVisible();
  await expect(page.locator('input[name="file"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('hostile fixture detail must never reach UI')).toHaveCount(0);
  expect(api032RequestCount(state.requests)).toBe(1);

  for (const width of [320, 390, 768, 1280] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
});

test('keeps every hostile lesson title literal in the destructive dialog and deletes only that lesson', async ({
  page,
}) => {
  const state = createFixtureState();
  await installInstructorFixture(page, state);

  for (const title of [
    'Dollar $& lesson',
    'Dollar $` lesson',
    "Dollar $' lesson",
    'Braces {lessonTitle}',
    'Unicode урок — dars',
    'Ordinary lesson title',
  ]) {
    const lesson = { ...createLesson(), title };
    state.lesson = lesson;
    state.course = createCourse([lesson]);
    await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });
    const deleteLesson = page.getByRole('button', { name: 'Delete lesson' });
    await expect(deleteLesson).toBeVisible();
    await deleteLesson.focus();
    await deleteLesson.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete this lesson?' });
    await expect(dialog).toContainText(title);
    const descriptionId = await dialog.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${descriptionId}"]`)).toContainText(title);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(deleteLesson).toBeFocused();

    const requestCount = state.requests.filter((request) => request.method() === 'DELETE').length;
    await deleteLesson.click();
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === `/courses/${courseId}/lessons/${lessonId}` &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: 'Delete lesson' }).last().click();
    const deleteFailure = await (await deleteResponse).finished();
    if (deleteFailure !== null) {
      throw new Error(`Lesson delete response did not finish: ${deleteFailure}`);
    }
    await expect
      .poll(() => state.requests.filter((request) => request.method() === 'DELETE').length)
      .toBe(requestCount + 1);
    const deleteRequest = state.requests[state.requests.length - 1];
    expect(new URL(deleteRequest?.url() ?? '').pathname).toBe(
      `/courses/${courseId}/lessons/${lessonId}`,
    );
  }
});

test('renders allocated enrollment and lesson-editor copy in Russian and Uzbek without overflow', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const state = createFixtureState();
  await installInstructorFixture(page, state);
  for (const [
    locale,
    breadcrumb,
    courseAddressInvalid,
    enrollments,
    enrollmentCount,
    lessonAddressInvalid,
    lessonEditor,
    workspace,
    backToCourse,
    lessonTitle,
    allChangesSaved,
    saveLesson,
    uploadFile,
  ] of [
    [
      'ru',
      'Хлебные крошки',
      'Адрес курса указан неверно.',
      'Записи на курс',
      '1 запись',
      'Адрес урока указан неверно.',
      'Редактировать урок',
      'Рабочая область преподавателя',
      'Вернуться к курсу',
      'Название урока',
      'Все изменения сохранены',
      'Сохранить урок',
      'Загрузить файл',
    ],
    [
      'uz',
      'Yo‘l ko‘rsatkich',
      'Kurs manzili noto‘g‘ri.',
      'Kursga yozilishlar',
      '1 ta yozilish',
      'Dars manzili noto‘g‘ri.',
      'Darsni tahrirlash',
      'O‘qituvchi ish maydoni',
      'Kursga qaytish',
      'Dars nomi',
      'Barcha o‘zgarishlar saqlandi',
      'Darsni saqlash',
      'Faylni yuklash',
    ],
  ] as const) {
    await page.goto('/instructor/courses/not-a-course/edit', { waitUntil: 'commit' });
    await selectFixtureLocale(page, locale);
    await expect(page.getByText(courseAddressInvalid)).toBeVisible();
    await expect(page.getByRole('navigation', { name: breadcrumb })).toBeVisible();

    await page.goto(`/instructor/courses/${courseId}/enrollments`, { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: enrollments })).toBeVisible();
    await expect(page.getByText(enrollmentCount, { exact: true })).toBeVisible();
    const breadcrumbNavigation = page.getByRole('navigation', { name: breadcrumb });
    await expect(breadcrumbNavigation).toBeVisible();
    const courseReturnLink = breadcrumbNavigation.getByRole('link');
    await courseReturnLink.focus();
    await expect(courseReturnLink).toBeFocused();
    await expectNoHorizontalOverflow(page);

    await page.goto('/instructor/lessons/not-a-lesson/edit', { waitUntil: 'commit' });
    await expect(page.getByText(lessonAddressInvalid)).toBeVisible();

    await page.goto(`/instructor/lessons/${lessonId}/edit`, { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: lessonEditor })).toBeVisible();
    await expect(page.getByText(workspace, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: backToCourse })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(allChangesSaved);
    await expect(page.getByRole('button', { name: saveLesson })).toHaveCount(0);
    await page.getByLabel(lessonTitle).fill(`${state.lesson.title} updated`);
    await expect(page.getByRole('button', { name: saveLesson })).toBeVisible();
    await expect(page.getByRole('button', { name: uploadFile })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('localizes instructor course lesson-list types without changing lesson writes', async ({
  page,
}) => {
  const state = createFixtureState();
  state.course = createCourse([
    { ...createLesson('video'), id: 101, title: 'Video list lesson' },
    { ...createLesson('text'), id: 102, title: 'Text list lesson' },
    { ...createLesson('pdf'), id: 103, title: 'PDF list lesson' },
  ]);
  state.lesson = state.course.lessons[0]!;
  await installInstructorFixture(page, state);

  for (const [locale, labels] of [
    ['en', ['Video', 'Text', 'PDF']],
    ['ru', ['Видео', 'Текст', 'PDF']],
    ['uz', ['Video', 'Matn', 'PDF']],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/instructor/courses/${courseId}/edit`, { waitUntil: 'commit' });
    await selectFixtureLocale(page, locale);

    for (const [index, label] of labels.entries()) {
      const title = ['Video list lesson', 'Text list lesson', 'PDF list lesson'][index]!;
      const row = page.getByRole('heading', { name: title }).locator('xpath=ancestor::li');
      await expect(row.locator('p')).toContainText(label);
    }

    const firstEdit = page
      .getByRole('link', { name: /Edit lesson|Редактировать урок|Darsni tahrirlash/ })
      .first();
    await firstEdit.focus();
    await expect(firstEdit).toBeFocused();
    await page.setViewportSize({ width: 640, height: 900 });
    await expectNoHorizontalOverflow(page);
  }

  expect(state.requests.filter((request) => request.method() !== 'GET')).toEqual([]);
});

test('rejects an ERR_ABORTED diagnostic through the fail-closed monitor control', () => {
  expect(() =>
    assertBrowserDiagnostics({
      pageErrors: [],
      consoleErrors: [],
      requestFailures: ['GET http://127.0.0.1:4174/fixture net::ERR_ABORTED'],
      relevantHttp: [],
    }),
  ).toThrow();
});

test('accounts for exact expected-negative HTTP console diagnostics through the local monitor', () => {
  const expected = [{ method: 'PATCH', pathAndQuery: '/courses/7', status: 422, count: 1 }];
  const response = {
    method: 'PATCH',
    pathAndQuery: '/courses/7',
    status: 422,
    url: 'http://127.0.0.1:4174/courses/7',
  };
  const failedResource = 'Failed to load resource: the server responded with a status of 422';

  expect(() =>
    assertBrowserDiagnostics(
      {
        pageErrors: [],
        consoleErrors: [{ text: failedResource, url: response.url }],
        requestFailures: [],
        relevantHttp: [response],
      },
      expected,
    ),
  ).not.toThrow();
  expect(() =>
    assertBrowserDiagnostics(
      {
        pageErrors: [],
        consoleErrors: [{ text: failedResource, url: 'http://127.0.0.1:4174/other' }],
        requestFailures: [],
        relevantHttp: [response],
      },
      expected,
    ),
  ).toThrow();
  expect(() =>
    assertBrowserDiagnostics(
      {
        pageErrors: [],
        consoleErrors: [
          {
            text: 'Failed to load resource: the server responded with a status of 401',
            url: response.url,
          },
        ],
        requestFailures: [],
        relevantHttp: [response],
      },
      expected,
    ),
  ).toThrow();
  expect(() =>
    assertBrowserDiagnostics(
      {
        pageErrors: [],
        consoleErrors: [
          { text: failedResource, url: response.url },
          { text: failedResource, url: response.url },
        ],
        requestFailures: [],
        relevantHttp: [response],
      },
      expected,
    ),
  ).toThrow();
  expect(() =>
    assertBrowserDiagnostics(
      { pageErrors: [], consoleErrors: [], requestFailures: [], relevantHttp: [response] },
      [],
    ),
  ).toThrow();
  expect(() =>
    assertBrowserDiagnostics(
      { pageErrors: [], consoleErrors: [], requestFailures: [], relevantHttp: [] },
      expected,
    ),
  ).toThrow();
});

async function discoverPrimitiveModuleUrls(page: Page) {
  const moduleUrls = await page.evaluate(async () => {
    const urls = {
      dialog: new URL('/src/shared/ui/primitives/Dialog.tsx', location.origin).href,
      select: new URL('/src/shared/ui/primitives/Select.tsx', location.origin).href,
      locale: new URL('/src/shared/locale/LocaleProvider.tsx', location.origin).href,
      main: new URL('/src/main.tsx', location.origin).href,
    };
    const sources = await Promise.all(
      Object.entries(urls).map(
        async ([key, url]) => [key, await (await fetch(url)).text()] as const,
      ),
    );
    const sourceByKey = Object.fromEntries(sources);
    const resolveImport = (source: string, from: string, matcher: RegExp) => {
      const match = source.match(matcher);
      return match ? new URL(match[1]!, from).href : null;
    };
    const react = resolveImport(
      sourceByKey.select,
      urls.select,
      /from\s+["']([^"']*react(?:\.js)?[^"']*)["']/u,
    );
    const reactDomClient = resolveImport(
      sourceByKey.main,
      urls.main,
      /from\s+["']([^"']*react-dom[^"']*)["']/u,
    );
    const reactImports = [urls.dialog, urls.select, urls.locale].map((url) =>
      resolveImport(
        sourceByKey[url === urls.dialog ? 'dialog' : url === urls.select ? 'select' : 'locale'],
        url,
        /from\s+["']([^"']*react(?:\.js)?[^"']*)["']/u,
      ),
    );
    return { ...urls, react, reactDomClient, reactImports };
  });
  expect(moduleUrls.react, 'Select transformed source React dependency').toBeTruthy();
  expect(moduleUrls.reactDomClient, 'main transformed source ReactDOM dependency').toBeTruthy();
  expect(moduleUrls.reactImports).toEqual([moduleUrls.react, moduleUrls.react, moduleUrls.react]);
  return { ...moduleUrls, react: moduleUrls.react!, reactDomClient: moduleUrls.reactDomClient! };
}

test('proves real Vite-graph Dialog and Select touch cancellation, scroll, and focus boundaries', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  await page.goto('/login', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  const moduleUrls = await discoverPrimitiveModuleUrls(page);

  await page.evaluate(async (urls) => {
    const [reactModule, ReactDomClient, dialogModule, selectModule, localeModule] =
      await Promise.all([
        import(urls.react),
        import(urls.reactDomClient),
        import(urls.dialog),
        import(urls.select),
        import(urls.locale),
      ]);
    const host = document.createElement('div');
    host.dataset.testPrimitiveFixture = 'true';
    document.body.append(host);
    const changes: string[] = [];
    const Select = selectModule.Select;
    const Dialog = dialogModule.Dialog;
    const LocaleProvider = localeModule.LocaleProvider;
    const React = reactModule.default ?? reactModule;
    const createRoot = ReactDomClient.createRoot ?? ReactDomClient.default?.createRoot;
    if (
      typeof createRoot !== 'function' ||
      typeof React.createElement !== 'function' ||
      typeof React.useState !== 'function' ||
      React.Fragment === undefined
    ) {
      throw new Error(
        `Served React runtime lacks fixture APIs: ${Object.keys(reactModule).join(',')}; ReactDOM: ${Object.keys(ReactDomClient).join(',')}`,
      );
    }
    const Fixture = () => {
      const [outerOpen, setOuterOpen] = React.useState(false);
      const [innerOpen, setInnerOpen] = React.useState(false);
      const options = Array.from({ length: 36 }, (_, index) =>
        React.createElement(
          'option',
          { key: `option-${index}`, value: `option-${index}`, disabled: index === 2 },
          `Option ${index}`,
        ),
      );
      const longDialogContent = Array.from({ length: 24 }, (_, index) =>
        React.createElement(
          'p',
          { key: `long-dialog-content-${index}` },
          `Long dialog fixture content ${index + 1}.`,
        ),
      );
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          { type: 'button', onClick: () => setOuterOpen(true) },
          'Open outer primitive dialog',
        ),
        React.createElement(
          Dialog,
          { open: outerOpen, title: 'Outer primitive dialog', onClose: () => setOuterOpen(false) },
          React.createElement(
            'button',
            { type: 'button', onClick: () => setInnerOpen(true) },
            'Open inner primitive dialog',
          ),
          React.createElement(
            Dialog,
            {
              open: innerOpen,
              title: 'Inner primitive dialog',
              onClose: () => setInnerOpen(false),
            },
            ...longDialogContent,
            React.createElement(
              Select,
              {
                label: 'Fixture lesson type',
                defaultValue: 'option-0',
                onValueChange: (value: string) => changes.push(value),
              },
              options,
            ),
          ),
        ),
      );
    };
    const root = createRoot(host);
    root.render(
      React.createElement(LocaleProvider, { initialLocale: 'en' }, React.createElement(Fixture)),
    );
    Object.assign(window, {
      __fe014PrimitiveFixture: {
        changes,
        cleanup: () => {
          root.unmount();
          host.remove();
          delete (window as typeof window & { __fe014PrimitiveFixture?: unknown })
            .__fe014PrimitiveFixture;
        },
      },
    });
  }, moduleUrls);

  try {
    const outerInvoker = page.getByRole('button', { name: 'Open outer primitive dialog' });
    await outerInvoker.click();
    const outer = page.getByRole('dialog', { name: 'Outer primitive dialog' });
    await expect(outer).toBeVisible();
    const outerElement = await outer.elementHandle();
    if (!outerElement) throw new Error('Outer primitive dialog did not mount.');
    const innerInvoker = outer.getByRole('button', { name: 'Open inner primitive dialog' });
    await innerInvoker.click();
    const inner = page.getByRole('dialog', { name: 'Inner primitive dialog' });
    await expect(inner).toBeVisible();
    await expect.poll(() => outerElement.getAttribute('aria-hidden')).toBe('true');

    const trigger = inner.getByRole('combobox', { name: 'Fixture lesson type' });
    expect(
      await inner.evaluate((element) => element.scrollHeight > element.clientHeight),
      'inner primitive dialog must expose its long-content overflow',
    ).toBe(true);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const listbox = page.getByRole('listbox', { name: 'Fixture lesson type' });
    const initialScrollTop = await listbox.evaluate((element) => element.scrollTop);
    let box = await listbox.boundingBox();
    if (!box) throw new Error('Fixture listbox geometry is unavailable.');
    let scrollPoint = { x: box.x + box.width / 2, y: box.y + box.height - 12 };
    await expect
      .poll(() =>
        page.evaluate(({ x, y }) => {
          const listbox = document.querySelector('[role="listbox"]');
          const hit = document.elementFromPoint(x, y);
          return Boolean(listbox && hit && listbox.contains(hit));
        }, scrollPoint),
      )
      .toBe(true);
    const dialogScrollTop = await inner.evaluate((element) => element.scrollTop);
    expect(dialogScrollTop, 'long dialog must have an observable scroll position').toBeGreaterThan(
      0,
    );
    await inner.evaluate((element) => element.scrollBy({ top: -Math.min(element.scrollTop, 16) }));
    await expect
      .poll(() => inner.evaluate((element) => element.scrollTop))
      .toBeLessThan(dialogScrollTop);
    await expect(listbox).toBeVisible();
    box = await listbox.boundingBox();
    if (!box) throw new Error('Long-dialog fixture listbox geometry is unavailable.');
    scrollPoint = { x: box.x + box.width / 2, y: box.y + box.height - 12 };
    await expect(
      page.evaluate(({ x, y }) => {
        const listbox = document.querySelector('[role="listbox"]');
        const hit = document.elementFromPoint(x, y);
        return Boolean(listbox && hit && listbox.contains(hit));
      }, scrollPoint),
    ).resolves.toBe(true);
    await expect(inner).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(
      page.evaluate(
        () =>
          (window as typeof window & { __fe014PrimitiveFixture: { changes: string[] } })
            .__fe014PrimitiveFixture.changes,
      ),
    ).resolves.toEqual([]);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...scrollPoint, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + 12, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(() => listbox.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(initialScrollTop);
    await expect(listbox).toBeVisible();
    await expect(inner).toBeVisible();
    await expect(
      page.evaluate(
        () =>
          (window as typeof window & { __fe014PrimitiveFixture: { changes: string[] } })
            .__fe014PrimitiveFixture.changes,
      ),
    ).resolves.toEqual([]);

    await page.getByRole('option', { name: 'Option 0' }).scrollIntoViewIfNeeded();
    const option = page.getByRole('option', { name: 'Option 0' });
    const optionBox = await option.boundingBox();
    if (!optionBox) throw new Error('Fixture option geometry is unavailable.');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: optionBox.x + optionBox.width / 2, y: optionBox.y + optionBox.height / 2, id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(
      page.evaluate(
        () =>
          (window as typeof window & { __fe014PrimitiveFixture: { changes: string[] } })
            .__fe014PrimitiveFixture.changes,
      ),
    ).resolves.toEqual([]);
    await expect(listbox).toBeVisible();
    await expect(inner).toBeVisible();

    await page.getByRole('option', { name: 'Option 2', exact: true }).click({ force: true });
    await expect(
      page.evaluate(
        () =>
          (window as typeof window & { __fe014PrimitiveFixture: { changes: string[] } })
            .__fe014PrimitiveFixture.changes,
      ),
    ).resolves.toEqual([]);
    await expect(listbox).toBeVisible();

    await page.getByRole('option', { name: 'Option 1', exact: true }).click();
    await expect(
      page.evaluate(
        () =>
          (window as typeof window & { __fe014PrimitiveFixture: { changes: string[] } })
            .__fe014PrimitiveFixture.changes,
      ),
    ).resolves.toEqual(['option-1']);
    await expect(inner).toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(listbox).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(listbox).toHaveCount(0);
    await expect(inner).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(listbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(inner).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(inner).toHaveCount(0);
    await expect(innerInvoker).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(outer).toHaveCount(0);
    await expect(outerInvoker).toBeFocused();

    await outerInvoker.click();
    const resizedOuter = page.getByRole('dialog', {
      name: 'Outer primitive dialog',
      includeHidden: true,
    });
    await innerInvoker.click();
    await trigger.click();
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(listbox).toBeVisible();
    const resizedBox = await listbox.boundingBox();
    if (!resizedBox) throw new Error('Resized fixture listbox geometry is unavailable.');
    await expect(
      page.evaluate(
        ({ x, y }) => {
          const listbox = document.querySelector('[role="listbox"]');
          const hit = document.elementFromPoint(x, y);
          return Boolean(listbox && hit && listbox.contains(hit));
        },
        { x: resizedBox.x + resizedBox.width / 2, y: resizedBox.y + 12 },
      ),
    ).resolves.toBe(true);
    await expectNoHorizontalOverflow(page);
    await expect(resizedOuter).toHaveAttribute('aria-hidden', 'true');
  } finally {
    let cleanup:
      | {
          fixtureHosts: number;
          dialogs: number;
          loginAvailable: boolean;
          loginInert: boolean;
        }
      | undefined;
    try {
      cleanup = await page.evaluate(() => {
        (
          window as typeof window & { __fe014PrimitiveFixture?: { cleanup(): void } }
        ).__fe014PrimitiveFixture?.cleanup();
        const loginEmail = document.querySelector('input[name="email"]');
        return {
          fixtureHosts: document.querySelectorAll('[data-test-primitive-fixture="true"]').length,
          dialogs: document.querySelectorAll('[role="dialog"]').length,
          loginAvailable: loginEmail !== null,
          loginInert: loginEmail?.closest('[inert]') !== null,
        };
      });
    } finally {
      await cdp.detach();
    }
    expect(cleanup, 'primitive fixture cleanup').toEqual({
      fixtureHosts: 0,
      dialogs: 0,
      loginAvailable: true,
      loginInert: false,
    });
    const loginEmail = page.locator('input[name="email"]');
    await loginEmail.focus();
    await expect(loginEmail).toBeFocused();
  }
});
