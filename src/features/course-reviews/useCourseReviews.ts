import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { queryKeys } from '@entities/api';
import type { ReviewCreateDto, ReviewUpdateDto } from '@entities/review';
import { useSession } from '@features/auth-session';
import { ApiError, type SessionCacheEpoch } from '@shared/api';

import {
  createCourseReview,
  deleteCourseReview,
  normalizeReviewPage,
  requestCourseReviews,
  requestCurrentReview,
  updateCourseReview,
} from './api';
import { courseRatingSummaryQueryKey } from './useCourseRatingSummary';

function reviewListQueryKey(courseId: number, page: number) {
  return queryKeys.public.operation('API-037', `course:${courseId}:reviews:${page}`);
}
function currentReviewQueryKey(subject: SessionCacheEpoch, courseId: number) {
  return queryKeys.private.operation(subject, 'API-038', `course:${courseId}:review`);
}

interface ReviewMutationAttempt {
  readonly identity: string;
  readonly generation: number;
}

export function useCourseReviews(courseId: number) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const normalizedPage = normalizeReviewPage(page);
  const subject = session.state.status === 'authenticated' ? (session.cacheEpoch ?? null) : null;
  const identity = `${subject ?? 'anonymous'}:${courseId}`;
  const activeSessionRef = useRef({ identity, generation: 0 });
  if (activeSessionRef.current.identity !== identity) {
    activeSessionRef.current = {
      identity,
      generation: activeSessionRef.current.generation + 1,
    };
  }
  const generation = activeSessionRef.current.generation;
  const isCurrentAttempt = (attempt: ReviewMutationAttempt) =>
    activeSessionRef.current.identity === attempt.identity &&
    activeSessionRef.current.generation === attempt.generation;
  const current = useQuery({
    queryKey: subject
      ? currentReviewQueryKey(subject, courseId)
      : ['disabled', 'current-review', courseId],
    queryFn: ({ signal }) => requestCurrentReview(session, courseId, signal),
    enabled: subject !== null,
    retry: false,
  });
  const hasOwnedReview = current.isSuccess;
  const noOwnedReview = current.error instanceof ApiError && current.error.status === 404;
  const list = useQuery({
    queryKey: reviewListQueryKey(courseId, normalizedPage),
    queryFn: ({ signal }) => requestCourseReviews(session, courseId, normalizedPage, signal),
  });
  const invalidate = async (attempt: ReviewMutationAttempt) => {
    if (!isCurrentAttempt(attempt)) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.public.operation(
        'API-037',
        `course:${courseId}:reviews:${normalizedPage}`,
      ),
      exact: true,
    });
    if (!isCurrentAttempt(attempt)) return;
    if (subject)
      await queryClient.invalidateQueries({
        queryKey: currentReviewQueryKey(subject, courseId),
        exact: true,
      });
    if (!isCurrentAttempt(attempt)) return;
    await queryClient.invalidateQueries({
      queryKey: courseRatingSummaryQueryKey(courseId),
      exact: true,
    });
  };
  const create = useMutation({
    mutationKey: ['course-review', 'create', identity],
    mutationFn: (body: ReviewCreateDto) => createCourseReview(session, courseId, body),
    onMutate: (): ReviewMutationAttempt => ({ identity, generation }),
    onSuccess: async (_result, _variables, attempt) => {
      if (isCurrentAttempt(attempt)) await invalidate(attempt);
    },
  });
  const update = useMutation({
    mutationKey: ['course-review', 'update', identity],
    mutationFn: (body: ReviewUpdateDto) => updateCourseReview(session, courseId, body),
    onMutate: (): ReviewMutationAttempt => ({ identity, generation }),
    onSuccess: async (_result, _variables, attempt) => {
      if (isCurrentAttempt(attempt)) await invalidate(attempt);
    },
  });
  const remove = useMutation({
    mutationKey: ['course-review', 'remove', identity],
    mutationFn: () => deleteCourseReview(session, courseId),
    onMutate: (): ReviewMutationAttempt => ({ identity, generation }),
    onSuccess: async (_result, _variables, attempt) => {
      if (isCurrentAttempt(attempt)) await invalidate(attempt);
    },
  });
  return {
    list,
    current,
    page: normalizedPage,
    setPage,
    hasOwnedReview,
    noOwnedReview,
    ready: hasOwnedReview || noOwnedReview,
    identity,
    generation,
    create,
    update,
    remove,
  };
}
