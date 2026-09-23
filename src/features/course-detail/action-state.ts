import type { SessionState } from '@features/auth-session';
import type { CourseActionReconciliationMessageKey } from '@features/course-action-reconciliation';
import { ApiError } from '@shared/api';

export interface CourseActionCandidate {
  id: number;
  price: string;
  publishedAt: string | null;
}

export type CoursePreflightState =
  | 'not-required'
  | 'loading'
  | 'eligible'
  | 'payment-pending'
  | 'already-enrolled'
  | 'already-in-cart'
  | 'unavailable';

export type CourseActionTranslationKey =
  | 'catalog:addToCart'
  | 'catalog:enrollFree'
  | 'catalog:paymentProcessingShort'
  | 'course:actionUnavailable'
  | 'course:alreadyEnrolled'
  | 'course:alreadyInCart'
  | 'course:checkingAvailability'
  | 'course:courseIsNotPublished'
  | 'course:enrollForFree'
  | 'course:signIn'
  | 'course:signInToAddCourseToCart'
  | 'course:signInToEnrollForFree'
  | 'course:unavailableForAccount';

interface CourseLoginActionState {
  kind: 'login';
  helper: CourseLoginHelper;
  labelKey: 'catalog:addToCart' | 'course:enrollForFree';
  to: string;
}

interface CourseEnrollActionState {
  readonly kind: 'enroll';
  readonly labelKey: 'catalog:enrollFree';
}
interface CourseCartActionState {
  readonly kind: 'cart';
  readonly labelKey: 'catalog:addToCart';
}
interface CourseDisabledActionState {
  readonly kind: 'disabled';
  readonly labelKey:
    | 'course:actionUnavailable'
    | 'course:alreadyEnrolled'
    | 'course:alreadyInCart'
    | 'catalog:paymentProcessingShort'
    | 'course:checkingAvailability'
    | 'course:courseIsNotPublished'
    | 'course:unavailableForAccount';
}

interface CourseLoginHelper {
  readonly linkTextKey: 'course:signIn';
  readonly guidanceKey: 'course:signInToEnrollForFree' | 'course:signInToAddCourseToCart';
}

export type CoursePrimaryActionState =
  | CourseLoginActionState
  | CourseEnrollActionState
  | CourseCartActionState
  | CourseDisabledActionState;

export interface CoursePrimaryActionInput {
  course: CourseActionCandidate;
  session: SessionState;
  preflight: CoursePreflightState;
}

export type CourseMutationRefresh = 'none' | 'detail' | 'cart' | 'enrollments' | 'preflight';

export type CourseMutationMessageKey =
  | 'actionFailedCheckConnection'
  | 'actionUnavailable'
  | 'actionCurrentlyUnavailable'
  | 'courseIsNotPublished'
  | 'logInAgainToContinue'
  | 'actionUnavailableForAccount'
  | 'courseNoLongerAvailable'
  | 'courseAlreadyInLearningList'
  | 'courseAlreadyInCart'
  | 'courseStateChangedAvailabilityRefreshed'
  | CourseActionReconciliationMessageKey;

export interface CourseMutationDisposition {
  kind: 'retryable' | 'terminal';
  preflight: CoursePreflightState | null;
  refresh: CourseMutationRefresh;
  messageKey: CourseMutationMessageKey;
}

function retryableDisposition(): CourseMutationDisposition {
  return {
    kind: 'retryable',
    preflight: null,
    refresh: 'none',
    messageKey: 'actionFailedCheckConnection',
  };
}

function unavailableDisposition(
  messageKey: CourseMutationMessageKey,
  refresh: CourseMutationRefresh = 'none',
): CourseMutationDisposition {
  return { kind: 'terminal', preflight: 'unavailable', refresh, messageKey };
}

function isRetryableApiError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.kind === 'offline' ||
      error.kind === 'server' ||
      (error.status !== null && error.status >= 500))
  );
}

function badRequestDisposition(error: ApiError): CourseMutationDisposition {
  if (error.status === 400 && error.message === 'Course is not published') {
    return unavailableDisposition('courseIsNotPublished', 'detail');
  }
  return unavailableDisposition('actionCurrentlyUnavailable');
}

function conflictDisposition(error: ApiError): CourseMutationDisposition {
  if (error.message === 'Already enrolled in this course') {
    return {
      kind: 'terminal',
      preflight: 'already-enrolled',
      refresh: 'enrollments',
      messageKey: 'courseAlreadyInLearningList',
    };
  }
  if (error.message === 'Course already in cart') {
    return {
      kind: 'terminal',
      preflight: 'already-in-cart',
      refresh: 'cart',
      messageKey: 'courseAlreadyInCart',
    };
  }
  return unavailableDisposition('courseStateChangedAvailabilityRefreshed', 'preflight');
}

export type CoursePriceKind = 'free' | 'paid' | 'invalid';

export function classifyCoursePrice(price: string): CoursePriceKind {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price)) return 'invalid';
  return /^0(?:\.0+)?$/.test(price) ? 'free' : 'paid';
}

export function coursePrimaryAction({
  course,
  session,
  preflight,
}: CoursePrimaryActionInput): CoursePrimaryActionState {
  if (course.publishedAt === null)
    return { kind: 'disabled', labelKey: 'course:courseIsNotPublished' };
  const price = classifyCoursePrice(course.price);
  if (price === 'invalid') return { kind: 'disabled', labelKey: 'course:actionUnavailable' };
  if (session.status !== 'authenticated') {
    return price === 'free'
      ? {
          kind: 'login',
          helper: {
            linkTextKey: 'course:signIn',
            guidanceKey: 'course:signInToEnrollForFree',
          },
          labelKey: 'course:enrollForFree',
          to: `/login?returnTo=${encodeURIComponent(`/courses/${course.id}`)}`,
        }
      : {
          kind: 'login',
          helper: {
            linkTextKey: 'course:signIn',
            guidanceKey: 'course:signInToAddCourseToCart',
          },
          labelKey: 'catalog:addToCart',
          to: `/login?returnTo=${encodeURIComponent(`/courses/${course.id}`)}`,
        };
  }
  if (session.user.role !== 'student')
    return { kind: 'disabled', labelKey: 'course:unavailableForAccount' };
  if (preflight === 'loading') return { kind: 'disabled', labelKey: 'course:checkingAvailability' };
  if (preflight === 'payment-pending')
    return { kind: 'disabled', labelKey: 'catalog:paymentProcessingShort' };
  if (preflight === 'already-enrolled')
    return { kind: 'disabled', labelKey: 'course:alreadyEnrolled' };
  if (preflight === 'already-in-cart')
    return { kind: 'disabled', labelKey: 'course:alreadyInCart' };
  if (preflight !== 'eligible') return { kind: 'disabled', labelKey: 'course:actionUnavailable' };
  return price === 'free'
    ? { kind: 'enroll', labelKey: 'catalog:enrollFree' }
    : { kind: 'cart', labelKey: 'catalog:addToCart' };
}

export function courseMutationDisposition(error: unknown): CourseMutationDisposition {
  if (isRetryableApiError(error)) return retryableDisposition();
  if (!(error instanceof ApiError)) return unavailableDisposition('actionCurrentlyUnavailable');
  if (error.status === 401) return unavailableDisposition('logInAgainToContinue');
  if (error.status === 403) return unavailableDisposition('actionUnavailableForAccount');
  if (error.status === 404) return unavailableDisposition('courseNoLongerAvailable', 'detail');
  if (error.status === 400) return badRequestDisposition(error);
  if (error.status === 409) return conflictDisposition(error);
  return unavailableDisposition('actionCurrentlyUnavailable');
}
