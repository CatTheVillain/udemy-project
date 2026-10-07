import type { ReviewCreateDto, ReviewDto, ReviewListDto, ReviewUpdateDto } from '@entities/review';
import { decodeReviewDto, decodeReviewListDto } from '@entities/review';
import type { DeleteMessageDto } from '@entities/course';
import { requestOperation, type SessionContextValue } from '@features/auth-session';
import { ApiError, collectPaginationPages } from '@shared/api';

export const REVIEW_PAGE_SIZE = 20 as const;
export const COURSE_RATING_SUMMARY_MAXIMUM_PAGES = 10 as const;

interface ReviewDeleteResponseCandidate {
  readonly message?: unknown;
}

export interface CourseRatingSummary {
  readonly reviewCount: number;
  readonly averageRating: number | null;
}

function invalidReviewResponse(cause: TypeError): ApiError {
  return new ApiError({
    kind: 'invalid_response',
    status: 200,
    message: 'Server returned an invalid review response',
    cause,
  });
}

function assertCourseRatingSummaryCourseBinding(
  reviews: readonly ReviewDto[],
  courseId: number,
): void {
  if (reviews.some((review) => review.course_id !== courseId))
    throw invalidReviewResponse(new TypeError('Invalid review course identity'));
}

export function normalizeReviewPage(page: number): number {
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export async function requestCourseReviews(
  session: SessionContextValue,
  courseId: number,
  page: number,
  signal: AbortSignal,
): Promise<ReviewListDto> {
  const normalizedPage = normalizeReviewPage(page);
  try {
    const result = await requestOperation<ReviewListDto>(session, 'API-037', {
      path: `/courses/${courseId}/reviews`,
      query: { page: normalizedPage, page_size: REVIEW_PAGE_SIZE },
      signal,
      decode: decodeReviewListDto,
    });
    return result;
  } catch (error) {
    if (error instanceof TypeError) throw invalidReviewResponse(error);
    throw error;
  }
}

export async function requestCourseRatingSummary(
  session: SessionContextValue,
  courseId: number,
  signal: AbortSignal,
): Promise<CourseRatingSummary> {
  const collection = await collectPaginationPages<ReviewDto>({
    context: 'course rating summary',
    signal,
    maximumPages: COURSE_RATING_SUMMARY_MAXIMUM_PAGES,
    identifyItem: (review) => review.id,
    fetchPage: async (page) => {
      const list = await requestCourseReviews(session, courseId, page, signal);
      return {
        items: list.items,
        page: list.page,
        pageSize: list.page_size,
        total: list.total,
        pages: list.pages,
        hasNext: list.has_next,
        hasPrevious: list.has_previous,
      };
    },
  });

  assertCourseRatingSummaryCourseBinding(collection.items, courseId);
  if (collection.total === 0) return { reviewCount: 0, averageRating: null };
  const ratingTotal = collection.items.reduce((total, review) => total + review.rating, 0);
  return {
    reviewCount: collection.total,
    averageRating: ratingTotal / collection.items.length,
  };
}

export function requestCurrentReview(
  session: SessionContextValue,
  courseId: number,
  signal: AbortSignal,
): Promise<ReviewDto> {
  return requestOperation(session, 'API-038', {
    path: `/courses/${courseId}/reviews/me`,
    signal,
    decode: decodeReviewDto,
  });
}

export function createCourseReview(
  session: SessionContextValue,
  courseId: number,
  body: ReviewCreateDto,
): Promise<ReviewDto> {
  return requestOperation(session, 'API-039', {
    path: `/courses/${courseId}/reviews`,
    body,
    dedupeKey: `course:${courseId}:review:create`,
    decode: decodeReviewDto,
  });
}

export function updateCourseReview(
  session: SessionContextValue,
  courseId: number,
  body: ReviewUpdateDto,
): Promise<ReviewDto> {
  return requestOperation(session, 'API-040', {
    path: `/courses/${courseId}/reviews`,
    body,
    dedupeKey: `course:${courseId}:review:update`,
    decode: decodeReviewDto,
  });
}

export function deleteCourseReview(
  session: SessionContextValue,
  courseId: number,
): Promise<DeleteMessageDto> {
  return requestOperation(session, 'API-041', {
    path: `/courses/${courseId}/reviews`,
    dedupeKey: `course:${courseId}:review:delete`,
    decode: (value) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        (value as ReviewDeleteResponseCandidate).message !== 'Review deleted'
      )
        throw new TypeError('Invalid review delete response');
      return { message: 'Review deleted' };
    },
  });
}
