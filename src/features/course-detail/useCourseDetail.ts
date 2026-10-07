import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { queryKeys } from '@entities/api';
import { enrollmentCourseActionPreflight } from '@entities/enrollment';
import { ApiError, type SessionCacheEpoch } from '@shared/api';
import { useSession, type SessionContextValue } from '@features/auth-session';
import { cartQueryKey, requestCart } from '@features/cart-workflow';
import { isCurrentCourseActionReconciliationAttempt } from '@features/course-action-reconciliation';

import {
  courseMutationDisposition,
  coursePrimaryAction,
  type CourseMutationDisposition,
  type CourseMutationRefresh,
  type CoursePreflightState,
} from './action-state';
import {
  addCourseToCart,
  enrollFree,
  requestCourseDetail,
  requestEnrollments,
  requestLessonOutline,
} from './api';

export interface CourseDetailFailure {
  readonly titleKey: CourseDetailFailureTitleKey;
  readonly messageKey: CourseDetailFailureMessageKey;
  readonly notFound: boolean;
}

export type CourseDetailFailureTitleKey =
  | 'common:youAppearOffline'
  | 'course:courseDataUnavailable'
  | 'course:courseLoadFailed'
  | 'course:courseNotFound';

export type CourseDetailFailureMessageKey =
  | 'common:checkConnectionAndTryAgain'
  | 'common:pleaseTryAgain'
  | 'common:serverReturnedAnInvalidResponseTryAgain'
  | 'course:thisCourseDoesNotExistOr';

export type CourseMutationKind = 'enroll' | 'cart';

export type CourseActionIdentity = string;

interface IdleCourseMutationViewState {
  readonly status: 'idle';
}
interface PendingCourseMutationViewState {
  readonly status: 'pending';
}
interface SuccessfulCourseMutationViewState {
  readonly status: 'success';
  readonly action: CourseMutationKind;
}
interface FailedCourseMutationViewState {
  readonly status: 'error';
  readonly disposition: CourseMutationDisposition;
}

export type CourseMutationViewState =
  | IdleCourseMutationViewState
  | PendingCourseMutationViewState
  | SuccessfulCourseMutationViewState
  | FailedCourseMutationViewState;

interface CourseMutationAttempt {
  identity: CourseActionIdentity;
  subject: SessionCacheEpoch;
  courseId: number;
  action: CourseMutationKind;
}

interface ScopedServerDisposition {
  identity: CourseActionIdentity;
  preflight: CoursePreflightState;
  reconcileWithPreflight: boolean;
  retainUntilAuthoritativeMatch: boolean;
  authoritativeMatchSeen: boolean;
}

interface ScopedMutationFeedback {
  identity: CourseActionIdentity;
  state: SuccessfulCourseMutationViewState | FailedCourseMutationViewState;
}

function mutationViewState(
  identity: CourseActionIdentity | null,
  pending: boolean,
  attempt: CourseMutationAttempt | undefined,
  feedback: ScopedMutationFeedback | null,
): CourseMutationViewState {
  if (identity && pending && attempt?.identity === identity) return { status: 'pending' };
  if (feedback?.identity === identity) return feedback.state;
  return { status: 'idle' };
}

function epochForSession(session: SessionContextValue): SessionCacheEpoch | null {
  return session.state.status === 'authenticated' ? (session.cacheEpoch ?? null) : null;
}

function actionIdentity(
  subject: string | null,
  courseId: number | null,
): CourseActionIdentity | null {
  return subject && courseId !== null ? JSON.stringify([subject, courseId]) : null;
}

export function courseDetailQueryKey(subject: SessionCacheEpoch | null, courseId: number) {
  const resource = `course:${courseId}`;
  return subject
    ? queryKeys.private.operation(subject, 'API-010', resource)
    : queryKeys.public.operation('API-010', resource);
}

export function lessonOutlineQueryKey(subject: SessionCacheEpoch | null, courseId: number) {
  const resource = `course:${courseId}:outline`;
  return subject
    ? queryKeys.private.operation(subject, 'API-014', resource)
    : queryKeys.public.operation('API-014', resource);
}

export function enrollmentQueryKey(subject: SessionCacheEpoch) {
  return queryKeys.private.operation(subject, 'API-021', 'enrollments');
}

export function courseDetailFailure(error: unknown): CourseDetailFailure {
  if (error instanceof ApiError && error.status === 404)
    return {
      titleKey: 'course:courseNotFound',
      messageKey: 'course:thisCourseDoesNotExistOr',
      notFound: true,
    };
  if (error instanceof ApiError && error.kind === 'invalid_response')
    return {
      titleKey: 'course:courseDataUnavailable',
      messageKey: 'common:serverReturnedAnInvalidResponseTryAgain',
      notFound: false,
    };
  if (error instanceof ApiError && error.kind === 'offline')
    return {
      titleKey: 'common:youAppearOffline',
      messageKey: 'common:checkConnectionAndTryAgain',
      notFound: false,
    };
  return {
    titleKey: 'course:courseLoadFailed',
    messageKey: 'common:pleaseTryAgain',
    notFound: false,
  };
}

export function useCourseDetail(courseId: number | null) {
  const session = useSession();
  const queryClient = useQueryClient();
  const subject = epochForSession(session);
  const identity = actionIdentity(subject, courseId);
  const student = session.state.status === 'authenticated' && session.state.user.role === 'student';
  const [serverDisposition, setServerDisposition] = useState<ScopedServerDisposition | null>(null);
  const [mutationFeedback, setMutationFeedback] = useState<ScopedMutationFeedback | null>(null);
  const lockedIdentities = useRef(new Set<CourseActionIdentity>());
  const currentIdentityRef = useRef<CourseActionIdentity | null>(identity);
  currentIdentityRef.current = identity;

  useEffect(() => {
    setServerDisposition(null);
    setMutationFeedback(null);
  }, [identity]);

  const detail = useQuery({
    queryKey: courseDetailQueryKey(subject, courseId ?? 0),
    queryFn: ({ signal }) => requestCourseDetail(session, courseId as number, signal),
    enabled: courseId !== null,
  });
  const outline = useQuery({
    queryKey: lessonOutlineQueryKey(subject, courseId ?? 0),
    queryFn: ({ signal }) => requestLessonOutline(session, courseId as number, signal),
    enabled: courseId !== null && detail.isSuccess,
  });
  const preflightEnabled = Boolean(
    student && subject && detail.data && detail.data.publishedAt !== null,
  );
  const cart = useQuery({
    queryKey: subject ? cartQueryKey(subject) : ['disabled', 'course-detail-cart'],
    queryFn: ({ signal }) => requestCart(session, signal),
    enabled: preflightEnabled,
  });
  const enrollments = useQuery({
    queryKey: subject ? enrollmentQueryKey(subject) : ['disabled', 'course-detail-enrollments'],
    queryFn: ({ signal }) => requestEnrollments(session, signal),
    enabled: preflightEnabled,
  });

  const queryPreflight = useMemo<CoursePreflightState>(() => {
    if (!student) return 'not-required';
    // An authenticated state becomes actionable only after its cache epoch is
    // available. Until then submitAction cannot construct its identity, so
    // exposing an eligible action would present a no-op control.
    if (!subject) return 'loading';
    if (!preflightEnabled) return 'not-required';
    if (cart.isPending || enrollments.isPending) return 'loading';
    if (cart.isError || enrollments.isError) return 'unavailable';
    const enrollmentPreflight = enrollmentCourseActionPreflight(
      enrollments.data?.items ?? [],
      courseId ?? 0,
    );
    if (enrollmentPreflight === 'active-entitlement') return 'already-enrolled';
    if (enrollmentPreflight === 'pending-protected') return 'unavailable';
    if (cart.data?.items.some((item) => item.courseId === courseId)) return 'already-in-cart';
    if (
      enrollmentPreflight === 'cancelled-recovery' &&
      detail.data !== undefined &&
      /^0(?:\.0+)?$/.test(detail.data.price)
    )
      return 'unavailable';
    return 'eligible';
  }, [
    cart.data,
    cart.isError,
    cart.isPending,
    courseId,
    detail.data,
    enrollments.data,
    enrollments.isError,
    enrollments.isPending,
    preflightEnabled,
    student,
    subject,
  ]);
  const preflightIsConverging =
    cart.isPending || cart.isFetching || enrollments.isPending || enrollments.isFetching;
  const preflightHasAuthoritativeResult =
    preflightEnabled && !preflightIsConverging && !cart.isError && !enrollments.isError;
  const hasCurrentServerDisposition = serverDisposition?.identity === identity;
  const authoritativePreflightMatchesDisposition =
    hasCurrentServerDisposition && queryPreflight === serverDisposition.preflight;
  const shouldRetainServerDisposition =
    hasCurrentServerDisposition &&
    (!serverDisposition.reconcileWithPreflight ||
      !preflightHasAuthoritativeResult ||
      (serverDisposition.retainUntilAuthoritativeMatch &&
        (!serverDisposition.authoritativeMatchSeen || authoritativePreflightMatchesDisposition)));
  const hasPairedReconciliationFeedback =
    hasCurrentServerDisposition &&
    mutationFeedback?.identity === identity &&
    serverDisposition.reconcileWithPreflight;
  // Keep the action disposition and its paired feedback together for the
  // reconciliation render. The passive effect below then clears both pieces
  // of transient state, so an eligible action is never committed beside a
  // superseded success or conflict notice.
  const shouldPresentServerDisposition =
    shouldRetainServerDisposition || hasPairedReconciliationFeedback;
  const preflight = shouldPresentServerDisposition ? serverDisposition.preflight : queryPreflight;

  useEffect(() => {
    if (
      !hasCurrentServerDisposition ||
      !serverDisposition.reconcileWithPreflight ||
      !preflightHasAuthoritativeResult
    )
      return;
    if (
      serverDisposition.retainUntilAuthoritativeMatch &&
      !serverDisposition.authoritativeMatchSeen &&
      authoritativePreflightMatchesDisposition
    ) {
      setServerDisposition((currentDisposition) =>
        currentDisposition?.identity === serverDisposition.identity
          ? { ...currentDisposition, authoritativeMatchSeen: true }
          : currentDisposition,
      );
      return;
    }
    if (serverDisposition.retainUntilAuthoritativeMatch && authoritativePreflightMatchesDisposition)
      return;
    if (
      serverDisposition.retainUntilAuthoritativeMatch &&
      !serverDisposition.authoritativeMatchSeen
    )
      return;
    setServerDisposition(null);
    setMutationFeedback((currentFeedback) =>
      currentFeedback?.identity === serverDisposition.identity ? null : currentFeedback,
    );
  }, [
    authoritativePreflightMatchesDisposition,
    hasCurrentServerDisposition,
    preflightHasAuthoritativeResult,
    serverDisposition,
  ]);

  const action = detail.data
    ? coursePrimaryAction({ course: detail.data, session: session.state, preflight })
    : null;
  const refreshMutationOutcome = async (
    refresh: CourseMutationRefresh,
    attempt: CourseMutationAttempt,
  ) => {
    if (refresh === 'detail') {
      await queryClient.invalidateQueries({
        queryKey: courseDetailQueryKey(attempt.subject, attempt.courseId),
        exact: true,
      });
    } else if (refresh === 'cart') {
      await queryClient.invalidateQueries({ queryKey: cartQueryKey(attempt.subject), exact: true });
    } else if (refresh === 'enrollments') {
      await queryClient.invalidateQueries({
        queryKey: enrollmentQueryKey(attempt.subject),
        exact: true,
      });
    } else if (refresh === 'preflight') {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cartQueryKey(attempt.subject), exact: true }),
        queryClient.invalidateQueries({
          queryKey: enrollmentQueryKey(attempt.subject),
          exact: true,
        }),
      ]);
    }
  };
  const reconcileSuccessfulAttempt = async (attempt: CourseMutationAttempt) => {
    if (attempt.action === 'enroll') {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: enrollmentQueryKey(attempt.subject),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: courseDetailQueryKey(attempt.subject, attempt.courseId),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: lessonOutlineQueryKey(attempt.subject, attempt.courseId),
          exact: true,
        }),
      ]);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: cartQueryKey(attempt.subject), exact: true });
  };

  const mutation = useMutation<void, unknown, CourseMutationAttempt>({
    mutationFn: (attempt) =>
      attempt.action === 'enroll'
        ? enrollFree(session, attempt.courseId)
        : addCourseToCart(session, attempt.courseId),
    onSuccess: async (_data, attempt) => {
      await reconcileSuccessfulAttempt(attempt);
      if (
        !isCurrentCourseActionReconciliationAttempt({
          attemptIdentity: attempt.identity,
          currentIdentity: currentIdentityRef.current,
        })
      )
        return;
      setServerDisposition({
        identity: attempt.identity,
        preflight: attempt.action === 'enroll' ? 'already-enrolled' : 'already-in-cart',
        reconcileWithPreflight: true,
        retainUntilAuthoritativeMatch: true,
        authoritativeMatchSeen: false,
      });
      setMutationFeedback({
        identity: attempt.identity,
        state: { status: 'success', action: attempt.action },
      });
    },
    onError: async (error, attempt) => {
      const disposition = courseMutationDisposition(error);
      await refreshMutationOutcome(disposition.refresh, attempt);
      if (
        !isCurrentCourseActionReconciliationAttempt({
          attemptIdentity: attempt.identity,
          currentIdentity: currentIdentityRef.current,
        })
      )
        return;
      setMutationFeedback({ identity: attempt.identity, state: { status: 'error', disposition } });
      if (disposition.kind === 'terminal' && disposition.preflight) {
        setServerDisposition({
          identity: attempt.identity,
          preflight: disposition.preflight,
          reconcileWithPreflight:
            disposition.refresh === 'cart' ||
            disposition.refresh === 'enrollments' ||
            disposition.refresh === 'preflight',
          retainUntilAuthoritativeMatch: false,
          authoritativeMatchSeen: false,
        });
      }
    },
    onSettled: (_data, _error, attempt) => {
      lockedIdentities.current.delete(attempt.identity);
    },
  });

  const submitAction = (kind: CourseMutationKind) => {
    if (!identity || !subject || courseId === null || lockedIdentities.current.has(identity))
      return;
    lockedIdentities.current.add(identity);
    setMutationFeedback(null);
    mutation.mutate({ identity, subject, courseId, action: kind });
  };

  const mutationState = mutationViewState(
    identity,
    mutation.isPending,
    mutation.variables,
    mutationFeedback,
  );

  return {
    action,
    detail,
    outline,
    preflight,
    retryPreflight: () => Promise.all([cart.refetch(), enrollments.refetch()]),
    mutationState,
    submitAction,
  };
}
