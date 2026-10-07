import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';

import { queryKeys } from '@entities/api';
import type { CheckoutDto, MockPaymentCompleteDto, MockPaymentStatusDto } from '@entities/cart';
import type { EnrollmentStatus } from '@entities/enrollment';
import { useSession, type SessionContextValue } from '@features/auth-session';
import { cartQueryKey } from '@features/cart-workflow';
import { ApiError, type SessionCacheEpoch } from '@shared/api';

import { requestCheckout, requestMockPaymentCompletion } from './api';
import {
  type CartRecovery,
  type CheckoutActiveAttempt,
  type CheckoutAttempt,
  type CheckoutFeedback,
  type CheckoutRecoveryAttempt,
  type CheckoutScope,
  type CheckoutWorkflow,
  type EnrollmentStatusRefresh,
  type MockPaymentAttempt,
  type PaymentActionLock,
  type PaymentStatusAttempt,
} from './checkout-state';

type CheckoutAttemptKind = 'checkout' | 'checkout_recovery' | 'mock_payment' | 'payment_status';

function epochFor(session: SessionContextValue): SessionCacheEpoch | null {
  return session.state.status === 'authenticated' && session.state.user.role === 'student'
    ? (session.cacheEpoch ?? null)
    : null;
}

function checkoutFailure(error: unknown): CheckoutFeedback {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: 'unauthorized' };
    if (error.status === 403 || error.status === 404) return { kind: 'not_authorized' };
    if (error.status === 409) return { kind: 'conflict' };
    if (error.status === 400) return { kind: 'cart_changed' };
  }
  return { kind: 'recovery_required' };
}

function paymentFailure(error: unknown): CheckoutFeedback {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: 'unauthorized' };
    if (error.status === 403 || error.status === 404) return { kind: 'not_authorized' };
    if (error.status === 400) return { kind: 'payment_status_unknown' };
    if (error.kind === 'offline' || error.kind === 'invalid_response' || error.kind === 'aborted')
      return { kind: 'payment_status_unknown' };
  }
  return { kind: 'unavailable' };
}

export function useCheckoutCart(scope: CheckoutScope): CheckoutWorkflow {
  const session = useSession();
  const queryClient = useQueryClient();
  const subject = epochFor(session);
  const activeAttemptRef = useRef<CheckoutActiveAttempt | null>(null);
  const checkoutRecoveryRef = useRef<CartRecovery | null>(null);
  const paymentActionLockRef = useRef<PaymentActionLock | null>(null);
  const sequenceRef = useRef(0);
  const subjectRef = useRef(subject);
  const scopeRef = useRef(scope);
  const previousScopeRef = useRef(scope);
  const [activeAttempt, setActiveAttempt] = useState<CheckoutActiveAttempt | null>(null);
  const [feedback, setFeedback] = useState<CheckoutFeedback | null>(null);
  const [paymentActionLock, setPaymentActionLock] = useState<PaymentActionLock | null>(null);

  subjectRef.current = subject;
  scopeRef.current = scope;

  useLayoutEffect(() => {
    activeAttemptRef.current = null;
    checkoutRecoveryRef.current = null;
    paymentActionLockRef.current = null;
    setActiveAttempt(null);
    setPaymentActionLock(null);
    setFeedback((current) =>
      subject === null && current?.kind === 'unauthorized' && previousScopeRef.current === scope
        ? current
        : null,
    );
    previousScopeRef.current = scope;
  }, [scope, subject]);

  function identity(
    kind: CheckoutAttemptKind,
    attemptSubject: SessionCacheEpoch,
    attemptScope: CheckoutScope,
  ): string {
    sequenceRef.current += 1;
    return `${attemptSubject}:${attemptScope}:${kind}:${sequenceRef.current}`;
  }

  function isCurrent(attempt: CheckoutActiveAttempt): boolean {
    return (
      activeAttemptRef.current?.identity === attempt.identity &&
      subjectRef.current === attempt.subject &&
      scopeRef.current === attempt.scope
    );
  }

  function release(attempt: CheckoutActiveAttempt): void {
    if (!isCurrent(attempt)) return;
    activeAttemptRef.current = null;
    setActiveAttempt(null);
  }

  function lockPaymentActions(attempt: MockPaymentAttempt): void {
    if (!isCurrent(attempt)) return;
    const lock: PaymentActionLock = {
      identity: attempt.identity,
      subject: attempt.subject,
      scope: attempt.scope,
      enrollmentId: attempt.enrollmentId,
    };
    paymentActionLockRef.current = lock;
    setPaymentActionLock(lock);
  }

  function paymentActionsAreLocked(enrollmentId: number): boolean {
    const lock = paymentActionLockRef.current;
    return (
      lock !== null &&
      lock.subject === subject &&
      lock.scope === scope &&
      lock.enrollmentId === enrollmentId
    );
  }

  function clearPaymentActionLock(attempt: PaymentStatusAttempt | MockPaymentAttempt): void {
    const lock = paymentActionLockRef.current;
    if (!isCurrent(attempt) || lock === null) return;
    if (
      lock.subject !== attempt.subject ||
      lock.scope !== attempt.scope ||
      lock.enrollmentId !== attempt.enrollmentId
    )
      return;
    paymentActionLockRef.current = null;
    setPaymentActionLock(null);
  }

  function paymentFeedbackForStatus(status: EnrollmentStatus): CheckoutFeedback {
    if (status === 'active') return { kind: 'payment_completed' };
    if (status === 'cancelled') return { kind: 'payment_declined' };
    return { kind: 'payment_pending' };
  }

  async function invalidateForSubject(attemptSubject: SessionCacheEpoch): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: cartQueryKey(attemptSubject), exact: true }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.private.operationPrefix(attemptSubject, 'API-021'),
        exact: false,
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.private.operationPrefix(attemptSubject, 'API-022'),
        exact: false,
      }),
    ]);
  }

  const mutation = useMutation<
    CheckoutDto | MockPaymentCompleteDto,
    unknown,
    CheckoutAttempt | MockPaymentAttempt
  >({
    mutationFn: (attempt) =>
      attempt.kind === 'checkout'
        ? requestCheckout(session)
        : requestMockPaymentCompletion(session, attempt.enrollmentId, attempt.outcome),
    onSuccess: async (_result, attempt) => {
      try {
        await invalidateForSubject(attempt.subject);
        if (attempt.kind === 'checkout') {
          await attempt.recovery.refetchCart();
          if (isCurrent(attempt)) setFeedback({ kind: 'checkout_accepted' });
          return;
        }
        const status = await attempt.refresh.refetchEnrollment();
        if (!isCurrent(attempt)) return;
        if (status !== 'cancelled') clearPaymentActionLock(attempt);
        setFeedback(paymentFeedbackForStatus(status));
      } catch {
        if (isCurrent(attempt)) {
          setFeedback(
            attempt.kind === 'checkout'
              ? { kind: 'checkout_status_unknown' }
              : { kind: 'payment_status_unknown' },
          );
        }
      }
    },
    onError: async (error, attempt) => {
      await invalidateForSubject(attempt.subject).catch(() => undefined);
      if (!isCurrent(attempt)) return;
      if (attempt.kind === 'checkout') {
        const nextFeedback = checkoutFailure(error);
        setFeedback(nextFeedback);
        if (nextFeedback.kind === 'recovery_required')
          checkoutRecoveryRef.current = attempt.recovery;
        return;
      }
      const nextFeedback = paymentFailure(error);
      if (nextFeedback.kind === 'payment_status_unknown') lockPaymentActions(attempt);
      setFeedback(nextFeedback);
    },
    onSettled: (_result, _error, attempt) => release(attempt),
  });

  function start(attempt: CheckoutAttempt | MockPaymentAttempt): void {
    if (activeAttemptRef.current !== null) return;
    activeAttemptRef.current = attempt;
    setActiveAttempt(attempt);
    setFeedback(null);
    mutation.mutate(attempt);
  }

  function checkout(recovery: CartRecovery): void {
    if (
      subject === null ||
      scope !== 'cart' ||
      feedback?.kind === 'recovery_required' ||
      feedback?.kind === 'checkout_status_unknown'
    )
      return;
    const attempt: CheckoutAttempt = {
      identity: identity('checkout', subject, scope),
      kind: 'checkout',
      subject,
      scope,
      recovery,
    };
    checkoutRecoveryRef.current = recovery;
    start(attempt);
  }

  function recoverCheckout(): void {
    const activeFeedback = feedback;
    if (
      subject === null ||
      scope !== 'cart' ||
      activeAttemptRef.current !== null ||
      activeFeedback?.kind !== 'recovery_required'
    )
      return;
    const recovery = checkoutRecoveryRef.current;
    if (recovery === null) return;
    const attempt: CheckoutRecoveryAttempt = {
      identity: identity('checkout_recovery', subject, scope),
      kind: 'checkout_recovery',
      subject,
      scope,
      recovery,
    };
    activeAttemptRef.current = attempt;
    setActiveAttempt(attempt);
    void (async () => {
      try {
        await invalidateForSubject(attempt.subject);
        await attempt.recovery.refetchCart();
        if (isCurrent(attempt)) setFeedback({ kind: 'checkout_status_unknown' });
      } catch {
        if (isCurrent(attempt)) setFeedback({ kind: 'recovery_required' });
      } finally {
        release(attempt);
      }
    })();
  }

  function completeMockPayment(
    enrollmentId: number,
    outcome: MockPaymentStatusDto,
    refresh: EnrollmentStatusRefresh,
  ): void {
    if (
      subject === null ||
      activeAttemptRef.current !== null ||
      paymentActionsAreLocked(enrollmentId)
    )
      return;
    const attempt: MockPaymentAttempt = {
      identity: identity('mock_payment', subject, scope),
      kind: 'mock_payment',
      subject,
      scope,
      enrollmentId,
      outcome,
      refresh,
    };
    start(attempt);
    lockPaymentActions(attempt);
  }

  function checkPaymentStatus(enrollmentId: number, refresh: EnrollmentStatusRefresh): void {
    if (
      subject === null ||
      activeAttemptRef.current !== null ||
      !paymentActionsAreLocked(enrollmentId)
    )
      return;
    const attempt: PaymentStatusAttempt = {
      identity: identity('payment_status', subject, scope),
      kind: 'payment_status',
      subject,
      scope,
      enrollmentId,
      refresh,
    };
    activeAttemptRef.current = attempt;
    setActiveAttempt(attempt);
    void (async () => {
      try {
        await invalidateForSubject(attempt.subject);
        const status = await attempt.refresh.refetchEnrollment();
        if (!isCurrent(attempt)) return;
        if (status !== 'cancelled') clearPaymentActionLock(attempt);
        setFeedback(paymentFeedbackForStatus(status));
      } catch {
        if (isCurrent(attempt)) setFeedback({ kind: 'payment_status_unknown' });
      } finally {
        release(attempt);
      }
    })();
  }

  const checkoutBlocked =
    feedback?.kind === 'recovery_required' || feedback?.kind === 'checkout_status_unknown';
  return {
    pending: activeAttempt !== null,
    checkoutBlocked,
    paymentActionsLocked:
      paymentActionLock !== null &&
      paymentActionLock.subject === subject &&
      paymentActionLock.scope === scope,
    feedback,
    checkout,
    recoverCheckout,
    completeMockPayment,
    checkPaymentStatus,
  };
}
