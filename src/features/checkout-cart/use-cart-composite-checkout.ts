import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { queryKeys } from '@entities/api';
import type { Enrollment, EnrollmentCourseSummary, EnrollmentStatus } from '@entities/enrollment';
import { useSession, type SessionContextValue, type SessionIdentity } from '@features/auth-session';
import { cartQueryKey, removeCartItem, requestCart } from '@features/cart-workflow';
import { addCourseToCart, requestEnrollments } from '@features/course-detail';
import { requestLearningEnrollment } from '@features/learning-progress';
import type { SessionCacheEpoch } from '@shared/api';

import { requestCheckout, requestMockPaymentCompletion } from './api';
import {
  admitCartComposite,
  createCartCompositeSnapshot,
  type CartCompositeAdmission,
  type CartCompositeCompletionPlanItem,
  type CartCompositeEnrollment,
  type CartCompositeEnrollmentIdentity,
  type CartCompositeOutcomeSelection,
  type CartCompositeSnapshot,
  type CartCompositeSnapshotInput,
  type ReadyCartCompositeSnapshot,
} from './cart-composite-state';

export type CartCompositeCheckoutPhase =
  | 'idle'
  | 'checking_checkout'
  | 'checkout_admitted'
  | 'completing_checkout'
  | 'discovering_recovery'
  | 'recovery_candidates'
  | 'recovery_empty'
  | 'checkout_completed'
  | 'checkout_integrity_unknown';

export type CartCompositeCourseResultKind = 'active' | 'restored' | 'integrity_unknown';

type CartCompositeTerminalPhase = 'checkout_completed' | 'checkout_integrity_unknown';

type CheckoutSessionIdentityOwner = Required<
  Pick<SessionContextValue, 'captureSessionIdentity' | 'isSessionIdentityCurrent'>
>;

type CartCompositeSessionIdentity = SessionIdentity;

export interface CartCompositeCourseResult {
  readonly enrollmentId: number;
  readonly courseId: number;
  readonly kind: CartCompositeCourseResultKind;
}

export interface CartCompositeRecoveryCandidate {
  readonly enrollmentId: number;
  readonly courseId: number;
  readonly course: EnrollmentCourseSummary;
}

interface CartCompositeRecoveryContext {
  readonly subject: SessionCacheEpoch;
  readonly sessionIdentity: CartCompositeSessionIdentity;
  readonly snapshotInputs: readonly CartCompositeSnapshotInput[];
  readonly discoveredEnrollmentIdentities: readonly CartCompositeEnrollmentIdentity[];
  readonly candidates: readonly CartCompositeRecoveryCandidate[];
}

interface CartCompositeRecoveryDiscoveryAttempt {
  readonly identity: number;
  readonly subject: SessionCacheEpoch;
  readonly sessionIdentity: CartCompositeSessionIdentity;
  readonly controller: AbortController;
}

export interface CartCompositeCheckoutWorkflow {
  readonly phase: CartCompositeCheckoutPhase;
  readonly completionPlan: readonly CartCompositeCompletionPlanItem[];
  readonly results: readonly CartCompositeCourseResult[];
  readonly recoveryCandidates: readonly CartCompositeRecoveryCandidate[];
  readonly pending: boolean;
  start(
    selections?: readonly CartCompositeOutcomeSelection[],
    options?: CartCompositeCheckoutStartOptions,
  ): void;
  retryRestoredCourse(courseId: number): void;
  dismissRestoredCourses(courseIds: readonly number[]): void;
  dismissSuccessfulCourses(courseIds: readonly number[]): void;
  discoverRecovery(): void;
  resumeRecovery(selections?: readonly CartCompositeOutcomeSelection[]): void;
}

export interface CartCompositeCheckoutStartOptions {
  readonly completionDelayMs?: number;
}

interface CartCompositeLiveAttempt {
  readonly identity: number;
  readonly subject: SessionCacheEpoch;
  readonly sessionIdentity: CartCompositeSessionIdentity;
  readonly snapshot: ReadyCartCompositeSnapshot;
  readonly controller: AbortController;
  readonly completionDelayMs: number;
  mayHaveMutated: boolean;
}

function waitForCompletionDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);
    function handleAbort(): void {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException('Checkout completion delay aborted', 'AbortError'));
    }
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function subjectFor(session: SessionContextValue): SessionCacheEpoch | null {
  return session.state.status === 'authenticated' && session.state.user.role === 'student'
    ? (session.cacheEpoch ?? null)
    : null;
}

function enrollmentForAdmission(enrollment: Enrollment): CartCompositeEnrollment {
  return { id: enrollment.id, courseId: enrollment.courseId, status: enrollment.status };
}

function emptyPlan(): readonly CartCompositeCompletionPlanItem[] {
  return [];
}

function emptyResults(): readonly CartCompositeCourseResult[] {
  return [];
}

function emptyRecoveryCandidates(): readonly CartCompositeRecoveryCandidate[] {
  return [];
}

function isCartCompositePending(phase: CartCompositeCheckoutPhase): boolean {
  return (
    phase === 'checking_checkout' ||
    phase === 'checkout_admitted' ||
    phase === 'completing_checkout' ||
    phase === 'discovering_recovery'
  );
}

export function useCartCompositeCheckout(
  courses: readonly CartCompositeSnapshotInput[],
): CartCompositeCheckoutWorkflow {
  const session = useSession() as SessionContextValue & CheckoutSessionIdentityOwner;
  const queryClient = useQueryClient();
  const subject = subjectFor(session);
  const mountedRef = useRef(true);
  const subjectRef = useRef(subject);
  const activeAttemptRef = useRef<CartCompositeLiveAttempt | null>(null);
  const recoveryDiscoveryRef = useRef<CartCompositeRecoveryDiscoveryAttempt | null>(null);
  const recoveryRef = useRef<CartCompositeRecoveryContext | null>(null);
  const writeLockedRef = useRef(false);
  const attemptSequenceRef = useRef(0);
  const [phase, setPhase] = useState<CartCompositeCheckoutPhase>('idle');
  const [completionPlan, setCompletionPlan] =
    useState<readonly CartCompositeCompletionPlanItem[]>(emptyPlan);
  const [results, setResults] = useState<readonly CartCompositeCourseResult[]>(emptyResults);
  const [recoveryCandidates, setRecoveryCandidates] =
    useState<readonly CartCompositeRecoveryCandidate[]>(emptyRecoveryCandidates);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A retry may have already removed retained courses. Keep that attempt alive so it can
      // compensate during an ordinary unmount, but only while its captured session stays live.
      recoveryDiscoveryRef.current?.controller.abort();
      recoveryDiscoveryRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    subjectRef.current = subject;
    activeAttemptRef.current?.controller.abort();
    activeAttemptRef.current = null;
    recoveryDiscoveryRef.current?.controller.abort();
    recoveryDiscoveryRef.current = null;
    recoveryRef.current = null;
    writeLockedRef.current = false;
    if (mountedRef.current) {
      setPhase('idle');
      setCompletionPlan(emptyPlan());
      setResults(emptyResults());
      setRecoveryCandidates(emptyRecoveryCandidates());
    }
  }, [subject]);

  function isCurrent(attempt: CartCompositeLiveAttempt): boolean {
    return (
      mountedRef.current &&
      activeAttemptRef.current?.identity === attempt.identity &&
      subjectRef.current === attempt.subject &&
      session.isSessionIdentityCurrent(attempt.sessionIdentity) &&
      !attempt.controller.signal.aborted
    );
  }

  function isCurrentDiscovery(attempt: CartCompositeRecoveryDiscoveryAttempt): boolean {
    return (
      mountedRef.current &&
      recoveryDiscoveryRef.current?.identity === attempt.identity &&
      subjectRef.current === attempt.subject &&
      session.isSessionIdentityCurrent(attempt.sessionIdentity) &&
      !attempt.controller.signal.aborted
    );
  }

  function recoveryContextFrom(
    attempt: CartCompositeRecoveryDiscoveryAttempt,
    enrollments: readonly Enrollment[],
    freshCartCourseIds: readonly number[],
  ): CartCompositeRecoveryContext | null {
    const cartCourseIds = new Set(freshCartCourseIds);
    const candidates: CartCompositeRecoveryCandidate[] = [];
    const snapshotInputs: CartCompositeSnapshotInput[] = [];
    const discoveredEnrollmentIdentities: CartCompositeEnrollmentIdentity[] = [];
    for (const enrollment of enrollments) {
      if (enrollment.status !== 'pending_payment') continue;
      if (cartCourseIds.has(enrollment.courseId)) return null;
      const snapshot = createCartCompositeSnapshot([
        { courseId: enrollment.courseId, price: enrollment.course.price },
      ]);
      if (snapshot.kind !== 'ready' || snapshot.courses[0]?.priceKind !== 'paid') return null;
      candidates.push({
        enrollmentId: enrollment.id,
        courseId: enrollment.courseId,
        course: enrollment.course,
      });
      discoveredEnrollmentIdentities.push({
        enrollmentId: enrollment.id,
        courseId: enrollment.courseId,
      });
      snapshotInputs.push({ courseId: enrollment.courseId, price: enrollment.course.price });
    }
    return {
      subject: attempt.subject,
      sessionIdentity: attempt.sessionIdentity,
      snapshotInputs,
      discoveredEnrollmentIdentities,
      candidates,
    };
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

  async function settleTerminal(
    attempt: CartCompositeLiveAttempt,
    terminalPhase: CartCompositeTerminalPhase,
  ): Promise<void> {
    if (!isCurrent(attempt)) return;
    writeLockedRef.current = true;
    if (attempt.mayHaveMutated) {
      try {
        await invalidateForSubject(attempt.subject);
      } catch {
        if (!isCurrent(attempt)) return;
        activeAttemptRef.current = null;
        setPhase('checkout_integrity_unknown');
        return;
      }
    }
    if (!isCurrent(attempt)) return;
    activeAttemptRef.current = null;
    setPhase(terminalPhase);
  }

  async function settleUnknown(attempt: CartCompositeLiveAttempt): Promise<void> {
    if (!isCurrent(attempt)) return;
    setCompletionPlan(emptyPlan());
    setResults(emptyResults());
    await settleTerminal(attempt, 'checkout_integrity_unknown');
  }

  async function restoreRetainedCourses(
    attempt: CartCompositeLiveAttempt,
    removedCourses: readonly CartCompositeSnapshotInput[],
  ): Promise<boolean> {
    for (const removedCourse of removedCourses) {
      if (!session.isSessionIdentityCurrent(attempt.sessionIdentity)) return false;
      try {
        await addCourseToCart(session, removedCourse.courseId);
      } catch {
        // The final Cart read below is the only proof that a lost add response restored the course.
      }
    }
    if (!session.isSessionIdentityCurrent(attempt.sessionIdentity)) return false;
    try {
      const cart = await requestCart(session, attempt.controller.signal);
      return removedCourses.every((removedCourse) =>
        cart.items.some((item) => item.courseId === removedCourse.courseId),
      );
    } catch {
      return false;
    }
  }

  async function completeItem(
    attempt: CartCompositeLiveAttempt,
    item: CartCompositeCompletionPlanItem,
  ): Promise<CartCompositeCourseResult | null> {
    let status: EnrollmentStatus | null = null;
    try {
      if (!isCurrent(attempt)) return null;
      attempt.mayHaveMutated = true;
      const completion = await requestMockPaymentCompletion(
        session,
        item.enrollmentId,
        item.outcome,
      );
      const expectedStatus = item.outcome === 'success' ? 'active' : 'cancelled';
      if (completion.enrollment_id === item.enrollmentId && completion.status === expectedStatus) {
        status = completion.status;
      }
    } catch {
      // A transport or decode failure is reconciled exactly once below.
    }
    if (!isCurrent(attempt)) return null;
    if (status === null) {
      try {
        const reconciled = await requestLearningEnrollment(
          session,
          item.enrollmentId,
          attempt.controller.signal,
        );
        if (reconciled.courseId === item.courseId) status = reconciled.status;
      } catch {
        return {
          enrollmentId: item.enrollmentId,
          courseId: item.courseId,
          kind: 'integrity_unknown',
        };
      }
    }
    if (!isCurrent(attempt)) return null;
    if (status === 'active') {
      try {
        const cart = await requestCart(session, attempt.controller.signal);
        return {
          enrollmentId: item.enrollmentId,
          courseId: item.courseId,
          kind: cart.items.some((cartItem) => cartItem.courseId === item.courseId)
            ? 'integrity_unknown'
            : 'active',
        };
      } catch {
        return {
          enrollmentId: item.enrollmentId,
          courseId: item.courseId,
          kind: 'integrity_unknown',
        };
      }
    }
    if (status !== 'cancelled') {
      return {
        enrollmentId: item.enrollmentId,
        courseId: item.courseId,
        kind: 'integrity_unknown',
      };
    }
    if (!isCurrent(attempt)) return null;
    try {
      await addCourseToCart(session, item.courseId);
    } catch {
      // A lost API-005 response may still have restored the exact course.
    }
    if (!isCurrent(attempt)) return null;
    try {
      const cart = await requestCart(session, attempt.controller.signal);
      return {
        enrollmentId: item.enrollmentId,
        courseId: item.courseId,
        kind: cart.items.some((cartItem) => cartItem.courseId === item.courseId)
          ? 'restored'
          : 'integrity_unknown',
      };
    } catch {
      return {
        enrollmentId: item.enrollmentId,
        courseId: item.courseId,
        kind: 'integrity_unknown',
      };
    }
  }

  async function settleAdmission(
    attempt: CartCompositeLiveAttempt,
    admission: CartCompositeAdmission,
  ): Promise<void> {
    if (!isCurrent(attempt)) return;
    if (admission.kind === 'checkout_integrity_unknown') {
      setCompletionPlan(emptyPlan());
      setResults(emptyResults());
      await settleTerminal(attempt, 'checkout_integrity_unknown');
      return;
    }
    setCompletionPlan(admission.completionPlan);
    setPhase('checkout_admitted');
    await waitForCompletionDelay(attempt.completionDelayMs, attempt.controller.signal);
    if (!isCurrent(attempt)) return;
    const terminalResults: CartCompositeCourseResult[] = [];
    for (const item of admission.completionPlan) {
      if (!isCurrent(attempt)) return;
      setPhase('completing_checkout');
      const result = await completeItem(attempt, item);
      if (result === null || !isCurrent(attempt)) return;
      terminalResults.push(result);
      setResults([...terminalResults]);
      if (result.kind === 'integrity_unknown') {
        writeLockedRef.current = true;
        break;
      }
    }
    if (!isCurrent(attempt)) return;
    await settleTerminal(
      attempt,
      terminalResults.some((result) => result.kind === 'integrity_unknown')
        ? 'checkout_integrity_unknown'
        : 'checkout_completed',
    );
  }

  function start(
    selections: readonly CartCompositeOutcomeSelection[] = [],
    options: CartCompositeCheckoutStartOptions = {},
  ): void {
    if (
      subject === null ||
      activeAttemptRef.current !== null ||
      recoveryDiscoveryRef.current !== null ||
      writeLockedRef.current
    )
      return;
    recoveryRef.current = null;
    setRecoveryCandidates(emptyRecoveryCandidates());
    const snapshot: CartCompositeSnapshot = createCartCompositeSnapshot(courses, selections);
    if (snapshot.kind !== 'ready') {
      writeLockedRef.current = true;
      setCompletionPlan(emptyPlan());
      setPhase('checkout_integrity_unknown');
      return;
    }
    attemptSequenceRef.current += 1;
    const attempt: CartCompositeLiveAttempt = {
      identity: attemptSequenceRef.current,
      subject,
      sessionIdentity: session.captureSessionIdentity(),
      snapshot,
      controller: new AbortController(),
      completionDelayMs:
        Number.isFinite(options.completionDelayMs) && (options.completionDelayMs ?? 0) > 0
          ? Math.floor(options.completionDelayMs ?? 0)
          : 0,
      mayHaveMutated: true,
    };
    activeAttemptRef.current = attempt;
    setCompletionPlan(emptyPlan());
    setResults(emptyResults());
    setPhase('checking_checkout');
    void (async () => {
      try {
        if (!isCurrent(attempt)) return;
        await requestCheckout(session).catch(() => undefined);
        if (!isCurrent(attempt)) return;
        const [enrollments, freshCart] = await Promise.all([
          requestEnrollments(session, attempt.controller.signal),
          requestCart(session, attempt.controller.signal),
        ]);
        await settleAdmission(
          attempt,
          admitCartComposite({
            snapshot: attempt.snapshot,
            association: isCurrent(attempt) ? 'current' : 'stale',
            enrollmentItems: enrollments.items.map(enrollmentForAdmission),
            freshCartCourseIds: freshCart.items.map((item) => item.courseId),
          }),
        );
      } catch {
        await settleUnknown(attempt);
      }
    })();
  }

  function retryRestoredCourse(courseId: number): void {
    const isVerifiedRestoredRetry =
      phase === 'checkout_completed' &&
      results.some((result) => result.courseId === courseId && result.kind === 'restored');
    if (
      !isVerifiedRestoredRetry ||
      subject === null ||
      activeAttemptRef.current !== null ||
      recoveryDiscoveryRef.current !== null
    )
      return;
    const retryCourse = courses.find((course) => course.courseId === courseId);
    if (retryCourse === undefined) {
      writeLockedRef.current = true;
      setCompletionPlan(emptyPlan());
      setPhase('checkout_integrity_unknown');
      return;
    }
    const snapshot = createCartCompositeSnapshot([retryCourse]);
    if (snapshot.kind !== 'ready') {
      writeLockedRef.current = true;
      setCompletionPlan(emptyPlan());
      setPhase('checkout_integrity_unknown');
      return;
    }
    // A verified cancelled result restored this exact course to Cart. This explicit,
    // per-course action is the only terminal boundary allowed to re-arm a write.
    // Unknown outcomes and all other terminal states retain their fail-closed lock.
    writeLockedRef.current = false;
    const retainedCourses = courses.filter((course) => course.courseId !== courseId);
    attemptSequenceRef.current += 1;
    const attempt: CartCompositeLiveAttempt = {
      identity: attemptSequenceRef.current,
      subject,
      sessionIdentity: session.captureSessionIdentity(),
      snapshot,
      controller: new AbortController(),
      completionDelayMs: 0,
      mayHaveMutated: true,
    };
    activeAttemptRef.current = attempt;
    recoveryRef.current = null;
    setRecoveryCandidates(emptyRecoveryCandidates());
    setCompletionPlan(emptyPlan());
    setResults(emptyResults());
    setPhase('checking_checkout');
    void (async () => {
      const possiblyRemovedCourses = new Map<number, CartCompositeSnapshotInput>();
      let compensationAttempted = false;
      const compensateRemovedCourses = async (): Promise<boolean> => {
        if (compensationAttempted) return false;
        compensationAttempted = true;
        const coursesToCompensate = [...possiblyRemovedCourses.values()];
        if (coursesToCompensate.length === 0) return true;
        return restoreRetainedCourses(attempt, coursesToCompensate);
      };
      try {
        for (const retainedCourse of retainedCourses) {
          possiblyRemovedCourses.set(retainedCourse.courseId, retainedCourse);
          if (!isCurrent(attempt)) {
            await compensateRemovedCourses();
            return;
          }
          await removeCartItem(session, retainedCourse.courseId);
          if (!isCurrent(attempt)) {
            await compensateRemovedCourses();
            return;
          }
        }
        if (!isCurrent(attempt)) {
          await compensateRemovedCourses();
          return;
        }
        const isolatedCart = await requestCart(session, attempt.controller.signal);
        if (!isCurrent(attempt)) {
          await compensateRemovedCourses();
          return;
        }
        if (isolatedCart.items.length !== 1 || isolatedCart.items[0]?.courseId !== courseId) {
          await compensateRemovedCourses();
          await settleUnknown(attempt);
          return;
        }
        if (!isCurrent(attempt)) {
          await compensateRemovedCourses();
          return;
        }
        await requestCheckout(session).catch(() => undefined);
        if (!isCurrent(attempt)) {
          await compensateRemovedCourses();
          return;
        }
        const restored = await compensateRemovedCourses();
        if (!restored) {
          await settleUnknown(attempt);
          return;
        }
        const [enrollments, freshCart] = await Promise.all([
          requestEnrollments(session, attempt.controller.signal),
          requestCart(session, attempt.controller.signal),
        ]);
        if (
          !isCurrent(attempt) ||
          retainedCourses.some(
            (retainedCourse) =>
              !freshCart.items.some((item) => item.courseId === retainedCourse.courseId),
          )
        ) {
          await settleUnknown(attempt);
          return;
        }
        await settleAdmission(
          attempt,
          admitCartComposite({
            snapshot: attempt.snapshot,
            association: isCurrent(attempt) ? 'current' : 'stale',
            enrollmentItems: enrollments.items.map(enrollmentForAdmission),
            freshCartCourseIds: freshCart.items.map((item) => item.courseId),
          }),
        );
      } catch {
        await compensateRemovedCourses();
        await settleUnknown(attempt);
      }
    })();
  }

  function dismissRestoredCourses(courseIds: readonly number[]): void {
    const dismissedCourseIds = new Set(courseIds);
    if (
      phase !== 'checkout_completed' ||
      activeAttemptRef.current !== null ||
      recoveryDiscoveryRef.current !== null ||
      !results.some(
        (result) => dismissedCourseIds.has(result.courseId) && result.kind === 'restored',
      )
    )
      return;

    const retainedResults = results.filter(
      (result) => !dismissedCourseIds.has(result.courseId) || result.kind !== 'restored',
    );
    setResults(retainedResults);
    setCompletionPlan((current) =>
      current.filter((item) => !dismissedCourseIds.has(item.courseId)),
    );
    writeLockedRef.current = retainedResults.some((result) => result.kind === 'restored');
    if (retainedResults.length === 0) setPhase('idle');
  }

  function dismissSuccessfulCourses(courseIds: readonly number[]): void {
    const dismissedCourseIds = new Set(courseIds);
    if (
      phase !== 'checkout_completed' ||
      activeAttemptRef.current !== null ||
      recoveryDiscoveryRef.current !== null ||
      !results.some((result) => dismissedCourseIds.has(result.courseId) && result.kind === 'active')
    )
      return;

    const retainedResults = results.filter(
      (result) => !dismissedCourseIds.has(result.courseId) || result.kind !== 'active',
    );
    setResults(retainedResults);
    setCompletionPlan((current) =>
      current.filter((item) => !dismissedCourseIds.has(item.courseId)),
    );
    writeLockedRef.current = retainedResults.length > 0;
    if (retainedResults.length === 0) setPhase('idle');
  }

  function discoverRecovery(): void {
    if (
      subject === null ||
      activeAttemptRef.current !== null ||
      recoveryDiscoveryRef.current !== null ||
      writeLockedRef.current
    )
      return;
    attemptSequenceRef.current += 1;
    const attempt: CartCompositeRecoveryDiscoveryAttempt = {
      identity: attemptSequenceRef.current,
      subject,
      sessionIdentity: session.captureSessionIdentity(),
      controller: new AbortController(),
    };
    recoveryDiscoveryRef.current = attempt;
    recoveryRef.current = null;
    setRecoveryCandidates(emptyRecoveryCandidates());
    setPhase('discovering_recovery');
    void (async () => {
      try {
        const [enrollments, freshCart] = await Promise.all([
          requestEnrollments(session, attempt.controller.signal),
          queryClient.fetchQuery({
            queryKey: cartQueryKey(attempt.subject),
            queryFn: ({ signal }) => requestCart(session, signal),
            staleTime: 0,
          }),
        ]);
        if (!isCurrentDiscovery(attempt)) return;
        const recovery = recoveryContextFrom(
          attempt,
          enrollments.items,
          freshCart.items.map((item) => item.courseId),
        );
        recoveryDiscoveryRef.current = null;
        if (recovery === null) {
          writeLockedRef.current = true;
          setPhase('checkout_integrity_unknown');
          return;
        }
        recoveryRef.current = recovery;
        setRecoveryCandidates(recovery.candidates);
        setPhase(recovery.candidates.length === 0 ? 'recovery_empty' : 'recovery_candidates');
      } catch {
        if (!isCurrentDiscovery(attempt)) return;
        recoveryDiscoveryRef.current = null;
        writeLockedRef.current = true;
        setRecoveryCandidates(emptyRecoveryCandidates());
        setPhase('checkout_integrity_unknown');
      }
    })();
  }

  function resumeRecovery(selections: readonly CartCompositeOutcomeSelection[] = []): void {
    const recovery = recoveryRef.current;
    if (
      subject === null ||
      recovery === null ||
      recovery.subject !== subject ||
      !session.isSessionIdentityCurrent(recovery.sessionIdentity) ||
      phase !== 'recovery_candidates' ||
      activeAttemptRef.current !== null ||
      recoveryDiscoveryRef.current !== null ||
      writeLockedRef.current
    )
      return;
    const snapshot = createCartCompositeSnapshot(recovery.snapshotInputs, selections);
    if (snapshot.kind !== 'ready') {
      writeLockedRef.current = true;
      setRecoveryCandidates(emptyRecoveryCandidates());
      setPhase('checkout_integrity_unknown');
      return;
    }
    attemptSequenceRef.current += 1;
    const attempt: CartCompositeLiveAttempt = {
      identity: attemptSequenceRef.current,
      subject,
      sessionIdentity: session.captureSessionIdentity(),
      snapshot,
      controller: new AbortController(),
      completionDelayMs: 0,
      mayHaveMutated: false,
    };
    activeAttemptRef.current = attempt;
    recoveryRef.current = null;
    setRecoveryCandidates(emptyRecoveryCandidates());
    setCompletionPlan(emptyPlan());
    setResults(emptyResults());
    setPhase('checking_checkout');
    void (async () => {
      try {
        const [enrollments, freshCart] = await Promise.all([
          requestEnrollments(session, attempt.controller.signal),
          requestCart(session, attempt.controller.signal),
        ]);
        await settleAdmission(
          attempt,
          admitCartComposite({
            snapshot: attempt.snapshot,
            association: isCurrent(attempt) ? 'current' : 'stale',
            enrollmentItems: enrollments.items.map(enrollmentForAdmission),
            freshCartCourseIds: freshCart.items.map((item) => item.courseId),
            discoveredEnrollmentIdentities: recovery.discoveredEnrollmentIdentities,
          }),
        );
      } catch {
        await settleUnknown(attempt);
      }
    })();
  }

  return {
    phase,
    completionPlan,
    results,
    recoveryCandidates,
    pending: isCartCompositePending(phase),
    start,
    retryRestoredCourse,
    dismissRestoredCourses,
    dismissSuccessfulCourses,
    discoverRecovery,
    resumeRecovery,
  };
}
