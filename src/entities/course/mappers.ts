import type {
  CourseDetailDto,
  CourseDto,
  CourseListDto,
  CourseListItemDto,
  LessonBriefDto,
  LessonDetailDto,
  LessonDto,
  LessonListDto,
  LessonTypeDto,
} from './dto';
import type {
  CatalogCourse,
  CatalogCourseList,
  Course,
  CourseDetail,
  Lesson,
  LessonOutline,
  LessonMediaLocator,
  LessonOutlineItem,
  LessonSubtitleLocator,
  LessonType,
} from './model';
import {
  decodePaginationEnvelope,
  readBoolean,
  readNullableString,
  readPositiveInteger,
  readRecord,
  readString,
} from '@shared/api';

const PAGINATION_FIELDS = {
  items: 'items',
  page: 'page',
  pageSize: 'page_size',
  total: 'total',
  pages: 'pages',
  hasNext: 'has_next',
  hasPrevious: 'has_previous',
} as const;

const LESSON_TYPE_BY_DTO = {
  video: 'video',
  text: 'text',
  pdf: 'pdf',
} as const satisfies Readonly<Record<LessonTypeDto, LessonType>>;

export function mapLessonTypeDto(value: unknown): LessonType {
  switch (value) {
    case 'video':
      return LESSON_TYPE_BY_DTO.video;
    case 'text':
      return LESSON_TYPE_BY_DTO.text;
    case 'pdf':
      return LESSON_TYPE_BY_DTO.pdf;
    default:
      throw new TypeError(`Unsupported lesson type: ${String(value)}`);
  }
}

export function decodeLessonDto(value: unknown): LessonDto {
  const item = readRecord(value, 'lesson');
  return {
    id: readPositiveInteger(item.id, 'lesson id'),
    course_id: readPositiveInteger(item.course_id, 'lesson course id'),
    title: readString(item.title, 'lesson title'),
    lesson_type: mapLessonTypeDto(item.lesson_type),
    download_url: readNullableString(item.download_url, 'lesson download_url'),
    subtitle_status:
      item.subtitle_status === undefined
        ? false
        : readBoolean(item.subtitle_status, 'lesson subtitle_status'),
    description: readNullableString(item.description, 'lesson description'),
    is_published: readBoolean(item.is_published, 'lesson is_published'),
    created_at: readString(item.created_at, 'lesson created_at'),
    updated_at: readString(item.updated_at, 'lesson updated_at'),
  };
}

export function mapCourseDto(dto: CourseDto): Course {
  return {
    id: dto.id,
    instructorId: dto.instructor_id,
    title: dto.title,
    description: dto.description,
    price: dto.price,
    currency: dto.currency,
    publishedAt: dto.published_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapLessonDto(dto: LessonDto): Lesson {
  return {
    id: dto.id,
    courseId: dto.course_id,
    title: dto.title,
    lessonType: mapLessonTypeDto(dto.lesson_type),
    downloadUrl: dto.download_url,
    description: dto.description,
    isPublished: dto.is_published,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

function decodeLessonBrief(value: unknown): LessonBriefDto {
  const item = readRecord(value, 'lesson');
  return {
    id: readPositiveInteger(item.id, 'lesson id'),
    title: readString(item.title, 'lesson title'),
  };
}

function decodeCourseListItem(value: unknown): CourseListItemDto {
  const item = readRecord(value, 'item');
  const instructor = readRecord(item.instructor, 'instructor');
  if (!Array.isArray(item.lessons)) throw new TypeError('Invalid course list lessons');
  return {
    id: readPositiveInteger(item.id, 'item id'),
    title: readString(item.title, 'item title'),
    description: readNullableString(item.description, 'item description'),
    price: readString(item.price, 'item price'),
    currency: readString(item.currency, 'item currency'),
    published_at: readNullableString(item.published_at, 'item published_at'),
    instructor: {
      id: readPositiveInteger(instructor.id, 'instructor id'),
      name: readString(instructor.name, 'instructor name'),
      surname: readString(instructor.surname, 'instructor surname'),
    },
    lessons: item.lessons.map(decodeLessonBrief),
  };
}

function decodeLessonDetail(value: unknown): LessonDetailDto {
  const item = readRecord(value, 'lesson detail');
  return {
    id: readPositiveInteger(item.id, 'lesson id'),
    title: readString(item.title, 'lesson title'),
    lesson_type: mapLessonTypeDto(item.lesson_type),
    download_url: readNullableString(item.download_url, 'lesson download_url'),
    subtitle_status:
      item.subtitle_status === undefined
        ? false
        : readBoolean(item.subtitle_status, 'lesson subtitle_status'),
    description: readNullableString(item.description, 'lesson description'),
    is_published: readBoolean(item.is_published, 'lesson is_published'),
    created_at: readString(item.created_at, 'lesson created_at'),
    updated_at: readString(item.updated_at, 'lesson updated_at'),
  };
}

export function decodeCourseDetailDto(value: unknown): CourseDetailDto {
  const response = readRecord(value, 'detail response');
  const instructor = readRecord(response.instructor, 'detail instructor');
  if (!Array.isArray(response.lessons)) throw new TypeError('Invalid course detail lessons');
  return {
    id: readPositiveInteger(response.id, 'detail id'),
    title: readString(response.title, 'detail title'),
    description: readNullableString(response.description, 'detail description'),
    price: readString(response.price, 'detail price'),
    currency: readString(response.currency, 'detail currency'),
    published_at: readNullableString(response.published_at, 'detail published_at'),
    created_at: readString(response.created_at, 'detail created_at'),
    updated_at: readString(response.updated_at, 'detail updated_at'),
    instructor: {
      id: readPositiveInteger(instructor.id, 'instructor id'),
      name: readString(instructor.name, 'instructor name'),
      surname: readString(instructor.surname, 'instructor surname'),
    },
    lessons: response.lessons.map(decodeLessonDetail),
  };
}

export function decodeLessonListDto(value: unknown): LessonListDto {
  const response = decodePaginationEnvelope(value, {
    context: 'lesson list',
    decodeItem: decodeLessonDetail,
    fields: PAGINATION_FIELDS,
  });
  return {
    items: [...response.items],
    page: response.page,
    page_size: response.pageSize,
    total: response.total,
    pages: response.pages,
    has_next: response.hasNext,
    has_previous: response.hasPrevious,
  };
}

function hasFilenameControlCharacter(filename: string): boolean {
  return Array.from(filename).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function mapLessonMediaLocator(downloadUrl: string | null): LessonMediaLocator | null {
  if (downloadUrl === null) return null;
  const match = /^\/media\/lessons\/([^/?#]+)$/u.exec(downloadUrl);
  if (!match) return null;
  const encodedFilename = match[1];
  let filename: string;
  try {
    filename = decodeURIComponent(encodedFilename);
  } catch {
    return null;
  }
  if (
    filename === '' ||
    filename === '.' ||
    filename === '..' ||
    filename.includes('/') ||
    filename.includes('\\') ||
    hasFilenameControlCharacter(filename) ||
    encodeURIComponent(filename) !== encodedFilename
  ) {
    return null;
  }
  return { filename };
}

function mapLessonSubtitleLocator(
  dto: LessonDetailDto,
  courseId: number,
): LessonSubtitleLocator | null {
  return dto.subtitle_status ? { courseId, lessonId: dto.id } : null;
}

function mapLessonOutlineItem(dto: LessonDetailDto, courseId: number): LessonOutlineItem {
  return {
    id: dto.id,
    title: dto.title,
    lessonType: mapLessonTypeDto(dto.lesson_type),
    mediaLocator: mapLessonMediaLocator(dto.download_url),
    subtitleLocator: mapLessonSubtitleLocator(dto, courseId),
    description: dto.description,
    isPublished: dto.is_published,
  };
}

export function mapCourseDetailDto(dto: CourseDetailDto): CourseDetail {
  return {
    id: dto.id,
    instructorId: dto.instructor.id,
    instructorName: `${dto.instructor.name} ${dto.instructor.surname}`.trim(),
    title: dto.title,
    description: dto.description,
    price: dto.price,
    currency: dto.currency,
    publishedAt: dto.published_at,
    lessons: dto.lessons.map((lesson) => mapLessonOutlineItem(lesson, dto.id)),
  };
}

export function mapLessonListDto(dto: LessonListDto, courseId: number): LessonOutline {
  return {
    items: dto.items.map((lesson) => mapLessonOutlineItem(lesson, courseId)),
    total: dto.total,
  };
}

export function decodeCourseListDto(value: unknown): CourseListDto {
  let response;
  try {
    response = decodePaginationEnvelope(value, {
      context: 'course list',
      decodeItem: decodeCourseListItem,
      fields: PAGINATION_FIELDS,
    });
  } catch {
    throw new TypeError('Invalid course list pagination consistency');
  }
  return {
    items: [...response.items],
    page: response.page,
    page_size: response.pageSize,
    total: response.total,
    pages: response.pages,
    has_next: response.hasNext,
    has_previous: response.hasPrevious,
  };
}

export function mapCourseListDto(dto: CourseListDto): CatalogCourseList {
  return {
    items: dto.items.map((item): CatalogCourse => ({
      id: item.id,
      title: item.title,
      description: item.description,
      instructorName: `${item.instructor.name} ${item.instructor.surname}`.trim(),
      price: item.price,
      currency: item.currency,
      totalLessonCount: item.lessons.length,
      isPublished: item.published_at !== null,
    })),
    page: dto.page,
    pageSize: dto.page_size,
    total: dto.total,
    pages: dto.pages,
    hasNext: dto.has_next,
    hasPrevious: dto.has_previous,
  };
}
