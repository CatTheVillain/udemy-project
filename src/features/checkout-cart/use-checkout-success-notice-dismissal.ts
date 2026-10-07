import { useEffect, useRef } from 'react';

import type { CartCompositeCheckoutWorkflow } from './use-cart-composite-checkout';

const successfulPaymentNoticeLifetimeMs = 8_000;

export function useCheckoutSuccessNoticeDismissal(checkout: CartCompositeCheckoutWorkflow): void {
  const successfulCourseIdsRef = useRef<readonly number[]>([]);
  const dismissSuccessfulCoursesRef = useRef(checkout.dismissSuccessfulCourses);
  const pendingExitDismissalTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null,
  );
  const successfulCourseIds = checkout.results
    .filter((result) => result.kind === 'active')
    .map((result) => result.courseId);

  useEffect(() => {
    successfulCourseIdsRef.current = successfulCourseIds;
    dismissSuccessfulCoursesRef.current = checkout.dismissSuccessfulCourses;
  }, [checkout.dismissSuccessfulCourses, successfulCourseIds]);

  useEffect(() => {
    if (checkout.phase !== 'checkout_completed') return undefined;
    const courseIds = checkout.results
      .filter((result) => result.kind === 'active')
      .map((result) => result.courseId);
    if (courseIds.length === 0) return undefined;
    const timeoutId = globalThis.setTimeout(
      () => dismissSuccessfulCoursesRef.current(courseIds),
      successfulPaymentNoticeLifetimeMs,
    );
    return () => globalThis.clearTimeout(timeoutId);
  }, [checkout.phase, checkout.results]);

  useEffect(() => {
    const pendingExitDismissalTimeout = pendingExitDismissalTimeoutRef.current;
    if (pendingExitDismissalTimeout !== null) {
      globalThis.clearTimeout(pendingExitDismissalTimeout);
      pendingExitDismissalTimeoutRef.current = null;
    }

    return () => {
      const courseIds = successfulCourseIdsRef.current;
      if (courseIds.length === 0) return;
      const timeoutId = globalThis.setTimeout(() => {
        if (pendingExitDismissalTimeoutRef.current !== timeoutId) return;
        pendingExitDismissalTimeoutRef.current = null;
        dismissSuccessfulCoursesRef.current(courseIds);
      }, 0);
      pendingExitDismissalTimeoutRef.current = timeoutId;
    };
  }, []);
}
