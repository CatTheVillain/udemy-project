import { describe, expect, it } from 'vitest';

import { decodeCartItemDto, mapCartDto } from '../../../src/entities/cart';
import {
  decodeCourseListDto,
  decodeLessonDto,
  mapCourseListDto,
  mapCourseDto,
  mapLessonDto,
  mapLessonTypeDto,
  type LessonType,
} from '../../../src/entities/course';
import {
  decodeEnrollmentDto,
  decodeEnrollmentListDto,
  mapEnrollmentDto,
  mapEnrollmentStatusDto,
  type EnrollmentStatus,
} from '../../../src/entities/enrollment';
import {
  decodeLoginResponseDto,
  decodeMessageResponseDto,
  decodeRegisterResponseDto,
  decodeUserProfileDto,
  mapUserProfileDto,
  mapUserRoleDto,
  type UserRole,
} from '../../../src/entities/user';

function enrollmentDto(id: number) {
  return {
    id,
    user_id: 9,
    course_id: id,
    status: 'active',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    course: {
      id,
      title: `Course ${id}`,
      description: null,
      price: '0.00',
      currency: 'USD',
    },
  };
}

describe('wire DTO to domain mappers', () => {
  it('decodes complete cart-item and enrollment mutation responses at runtime', () => {
    expect(
      decodeCartItemDto({
        id: 5,
        course_id: 7,
        added_at: '2026-07-01T00:00:00Z',
        course: { id: 7, title: 'React', price: '19.99', currency: 'USD' },
      }),
    ).toMatchObject({ id: 5, course_id: 7, course: { id: 7 } });
    expect(
      decodeEnrollmentDto({
        id: 4,
        user_id: 9,
        course_id: 7,
        status: 'active',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        course: { id: 7, title: 'React', description: null, price: '0.00', currency: 'USD' },
      }),
    ).toMatchObject({ id: 4, user_id: 9, status: 'active', course: { id: 7 } });
  });

  it.each([
    ['cart null', () => decodeCartItemDto(null)],
    ['cart missing field', () => decodeCartItemDto({ id: 5 })],
    [
      'cart wrong type',
      () =>
        decodeCartItemDto({
          id: '5',
          course_id: 7,
          added_at: 'now',
          course: { id: 7, title: 'React', price: '19.99', currency: 'USD' },
        }),
    ],
    [
      'cart nested identity',
      () =>
        decodeCartItemDto({
          id: 5,
          course_id: 7,
          added_at: 'now',
          course: { id: 8, title: 'React', price: '19.99', currency: 'USD' },
        }),
    ],
    ['enrollment null', () => decodeEnrollmentDto(null)],
    ['enrollment missing field', () => decodeEnrollmentDto({ id: 4 })],
    [
      'enrollment wrong type',
      () =>
        decodeEnrollmentDto({
          id: 4,
          user_id: '9',
          course_id: 7,
          status: 'active',
          created_at: 'now',
          updated_at: 'now',
          course: { id: 7, title: 'React', description: null, price: '0.00', currency: 'USD' },
        }),
    ],
    [
      'enrollment enum',
      () =>
        decodeEnrollmentDto({
          id: 4,
          user_id: 9,
          course_id: 7,
          status: 'expired',
          created_at: 'now',
          updated_at: 'now',
          course: { id: 7, title: 'React', description: null, price: '0.00', currency: 'USD' },
        }),
    ],
    [
      'enrollment nested identity',
      () =>
        decodeEnrollmentDto({
          id: 4,
          user_id: 9,
          course_id: 7,
          status: 'active',
          created_at: 'now',
          updated_at: 'now',
          course: { id: 8, title: 'React', description: null, price: '0.00', currency: 'USD' },
        }),
    ],
  ])('rejects malformed protected mutation payload: %s', (_caseName, decode) => {
    expect(decode).toThrow();
  });

  it('rejects enrollment items beyond the mathematically remaining page total', () => {
    expect(() =>
      decodeEnrollmentListDto({
        items: [enrollmentDto(101), enrollmentDto(102)],
        page: 2,
        page_size: 100,
        total: 101,
        pages: 2,
        has_next: false,
        has_previous: true,
      }),
    ).toThrow('Invalid enrollment pagination');
  });

  it('decodes API-008 populated and empty pagination without accepting malformed metadata', () => {
    const populated = decodeCourseListDto({
      items: [
        {
          id: 1,
          title: 'React',
          description: null,
          price: '9.99',
          currency: 'USD',
          published_at: null,
          instructor: { id: 2, name: 'Ada', surname: 'Lovelace' },
          lessons: [{ id: 3, title: 'Intro' }],
        },
      ],
      page: 1,
      page_size: 20,
      total: 1,
      pages: 1,
      has_next: false,
      has_previous: false,
    });
    expect(mapCourseListDto(populated).items[0]).toMatchObject({
      description: null,
      instructorName: 'Ada Lovelace',
      totalLessonCount: 1,
      isPublished: false,
    });
    expect(
      mapCourseListDto(
        decodeCourseListDto({
          items: [
            {
              id: 2,
              title: 'TypeScript',
              description: 'Build safer user interfaces.',
              price: '94.99',
              currency: 'USD',
              published_at: '2026-07-01T00:00:00Z',
              instructor: { id: 3, name: 'Grace', surname: 'Hopper' },
              lessons: [],
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          pages: 1,
          has_next: false,
          has_previous: false,
        }),
      ).items[0],
    ).toMatchObject({
      description: 'Build safer user interfaces.',
      price: '94.99',
      currency: 'USD',
      isPublished: true,
    });
    expect(
      decodeCourseListDto({
        items: [],
        page: 1,
        page_size: 20,
        total: 0,
        pages: 0,
        has_next: false,
        has_previous: false,
      }).pages,
    ).toBe(0);
    expect(() =>
      decodeCourseListDto({
        items: [],
        page: 1,
        page_size: 20,
        total: 0,
        pages: 1,
        has_next: false,
        has_previous: false,
      }),
    ).toThrow('pagination consistency');
  });

  it.each([
    [
      'page count',
      {
        page: 1,
        page_size: 2,
        total: 3,
        pages: 1,
        has_next: false,
        has_previous: false,
      },
    ],
    [
      'next-page flag',
      {
        page: 1,
        page_size: 2,
        total: 3,
        pages: 2,
        has_next: false,
        has_previous: false,
      },
    ],
    [
      'page bounds',
      {
        page: 3,
        page_size: 2,
        total: 3,
        pages: 2,
        has_next: false,
        has_previous: true,
      },
    ],
  ])('rejects contradictory non-empty course-list %s metadata', (_caseName, metadata) => {
    expect(() =>
      decodeCourseListDto({
        items: [
          {
            id: 1,
            title: 'React',
            description: null,
            price: '9.99',
            currency: 'USD',
            published_at: null,
            instructor: { id: 2, name: 'Ada', surname: 'Lovelace' },
            lessons: [],
          },
        ],
        ...metadata,
      }),
    ).toThrow('Invalid course list pagination consistency');
  });

  it('maps course and lesson snake_case fields while preserving decimals and nullable values', () => {
    expect(
      mapCourseDto({
        id: 1,
        instructor_id: 2,
        title: 'React',
        description: null,
        price: '9.99',
        currency: 'USD',
        published_at: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-02T00:00:00Z',
      }),
    ).toEqual({
      id: 1,
      instructorId: 2,
      title: 'React',
      description: null,
      price: '9.99',
      currency: 'USD',
      publishedAt: null,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
    });

    expect(
      mapLessonDto({
        id: 3,
        course_id: 1,
        title: 'Types',
        lesson_type: 'pdf',
        download_url: null,
        description: null,
        is_published: false,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      }),
    ).toMatchObject({ courseId: 1, lessonType: 'pdf', downloadUrl: null, isPublished: false });
  });

  it('maps cart totals and nested item fields without numeric coercion', () => {
    const cart = mapCartDto({
      id: 1,
      items: [
        {
          id: 2,
          course_id: 3,
          added_at: '2026-07-01T00:00:00Z',
          course: { id: 3, title: 'React', price: '29.99', currency: 'USD' },
        },
      ],
      total_price: '29.99',
      currency: 'USD',
      item_count: 1,
    });

    expect(cart.totalPrice).toBe('29.99');
    expect(cart.items[0]).toMatchObject({ courseId: 3, addedAt: '2026-07-01T00:00:00Z' });
    expect(cart.items[0].course.price).toBe('29.99');
  });

  it('maps enrollment status and user profile nullable fields', () => {
    expect(
      mapEnrollmentDto({
        id: 1,
        user_id: 2,
        course_id: 3,
        status: 'pending_payment',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        course: { id: 3, title: 'React', description: null, price: '10.00', currency: 'USD' },
      }),
    ).toMatchObject({ userId: 2, courseId: 3, status: 'pending_payment' });

    expect(
      mapEnrollmentDto({
        id: 4,
        user_id: 2,
        course_id: 3,
        status: 'cancelled',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        course: { id: 3, title: 'React', description: null, price: '10.00', currency: 'USD' },
      }),
    ).toMatchObject({ status: 'cancelled' });

    expect(
      mapUserProfileDto({
        email: 'learner@example.test',
        name: 'Ada',
        surname: 'Lovelace',
        role: 'student',
        birthday: null,
        phone_number: null,
        created_at: '2026-07-01T00:00:00Z',
      }),
    ).toMatchObject({ phoneNumber: null, createdAt: '2026-07-01T00:00:00Z' });
  });

  it('maps every wire enum value to its independently owned domain value', () => {
    const lessonTypes: readonly LessonType[] = ['video', 'text', 'pdf'];
    const enrollmentStatuses: readonly EnrollmentStatus[] = [
      'pending_payment',
      'active',
      'cancelled',
    ];
    const userRoles: readonly UserRole[] = ['student', 'instructor', 'admin'];

    expect(lessonTypes.map(mapLessonTypeDto)).toEqual(lessonTypes);
    expect(enrollmentStatuses.map(mapEnrollmentStatusDto)).toEqual(enrollmentStatuses);
    expect(userRoles.map(mapUserRoleDto)).toEqual(userRoles);
  });

  it.each(['video', 'text', 'pdf'] as const)(
    'decodes the shared lesson DTO enum: %s',
    (lessonType) => {
      expect(
        decodeLessonDto({
          id: 3,
          course_id: 1,
          title: 'Types',
          lesson_type: lessonType,
          download_url: null,
          description: null,
          is_published: false,
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-01T00:00:00Z',
        }),
      ).toMatchObject({ course_id: 1, lesson_type: lessonType, download_url: null });
    },
  );

  it.each([
    ['download_url', 42],
    ['description', false],
  ])('rejects a malformed nullable lesson DTO %s primitive', (field, value) => {
    expect(() =>
      decodeLessonDto({
        id: 3,
        course_id: 1,
        title: 'Types',
        lesson_type: 'video',
        download_url: null,
        description: null,
        is_published: false,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        [field]: value,
      }),
    ).toThrow();
  });

  it('rejects unknown runtime enum values deterministically', () => {
    expect(() => mapLessonTypeDto('audio')).toThrow('Unsupported lesson type: audio');
    expect(() => mapEnrollmentStatusDto('expired')).toThrow(
      'Unsupported enrollment status: expired',
    );
    expect(() => mapUserRoleDto('owner')).toThrow('Unsupported user role: owner');
  });

  it('decodes every current auth/session success shape before mapping', () => {
    expect(
      decodeUserProfileDto({
        email: 'learner@example.test',
        name: 'Ada',
        surname: 'Lovelace',
        role: 'student',
        birthday: null,
        phone_number: '+10000000000',
        created_at: '2026-07-01T00:00:00Z',
        ignored: true,
      }),
    ).toMatchObject({ role: 'student', birthday: null, phone_number: '+10000000000' });
    expect(decodeLoginResponseDto({ access_token: 'login-token' })).toEqual({
      access_token: 'login-token',
    });
    expect(
      decodeRegisterResponseDto({
        user: { id: 1, email: 'learner@example.test' },
        access_token: 'signup-token',
        token_type: 'bearer',
      }),
    ).toMatchObject({ user: { id: 1 }, token_type: 'bearer' });
    expect(decodeMessageResponseDto({ message: 'ok' })).toEqual({ message: 'ok' });
  });

  it.each([
    ['profile record', {}],
    [
      'email',
      {
        email: 1,
        name: 'Ada',
        surname: 'Lovelace',
        role: 'student',
        birthday: null,
        phone_number: null,
        created_at: 'now',
      },
    ],
    [
      'name',
      {
        email: 'a',
        name: 1,
        surname: 'Lovelace',
        role: 'student',
        birthday: null,
        phone_number: null,
        created_at: 'now',
      },
    ],
    [
      'surname',
      {
        email: 'a',
        name: 'Ada',
        surname: 1,
        role: 'student',
        birthday: null,
        phone_number: null,
        created_at: 'now',
      },
    ],
    [
      'role',
      {
        email: 'a',
        name: 'Ada',
        surname: 'Lovelace',
        role: 'owner',
        birthday: null,
        phone_number: null,
        created_at: 'now',
      },
    ],
    [
      'birthday',
      {
        email: 'a',
        name: 'Ada',
        surname: 'Lovelace',
        role: 'student',
        birthday: 1,
        phone_number: null,
        created_at: 'now',
      },
    ],
    [
      'phone_number',
      {
        email: 'a',
        name: 'Ada',
        surname: 'Lovelace',
        role: 'student',
        birthday: null,
        phone_number: 1,
        created_at: 'now',
      },
    ],
    [
      'created_at',
      {
        email: 'a',
        name: 'Ada',
        surname: 'Lovelace',
        role: 'student',
        birthday: null,
        phone_number: null,
        created_at: 1,
      },
    ],
  ])('rejects a malformed user profile at %s', (_field, value) => {
    expect(() => decodeUserProfileDto(value)).toThrow();
  });

  it.each([
    ['login access token', () => decodeLoginResponseDto({})],
    [
      'register user',
      () => decodeRegisterResponseDto({ access_token: 'token', token_type: 'bearer', user: null }),
    ],
    [
      'register id',
      () =>
        decodeRegisterResponseDto({
          access_token: 'token',
          token_type: 'bearer',
          user: { id: Number.NaN, email: 'a' },
        }),
    ],
    [
      'register email',
      () =>
        decodeRegisterResponseDto({
          access_token: 'token',
          token_type: 'bearer',
          user: { id: 1, email: 2 },
        }),
    ],
    [
      'register token',
      () =>
        decodeRegisterResponseDto({
          access_token: 2,
          token_type: 'bearer',
          user: { id: 1, email: 'a' },
        }),
    ],
    [
      'register token type',
      () =>
        decodeRegisterResponseDto({
          access_token: 'token',
          token_type: 2,
          user: { id: 1, email: 'a' },
        }),
    ],
    ['message', () => decodeMessageResponseDto({ message: 1 })],
  ])('rejects malformed auth/message payloads: %s', (_caseName, decode) => {
    expect(decode).toThrow();
  });
});
