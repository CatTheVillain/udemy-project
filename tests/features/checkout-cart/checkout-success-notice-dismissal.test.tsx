// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useCheckoutSuccessNoticeDismissal,
  type CartCompositeCheckoutWorkflow,
} from '../../../src/features/checkout-cart';

const successfulResult = [{ enrollmentId: 70, courseId: 7, kind: 'active' }] as const;

afterEach(() => {
  vi.useRealTimers();
});

function checkout(
  phase: CartCompositeCheckoutWorkflow['phase'],
  pending: boolean,
  dismissSuccessfulCourses = vi.fn(),
): CartCompositeCheckoutWorkflow {
  return {
    phase,
    completionPlan: [],
    results: successfulResult,
    recoveryCandidates: [],
    pending,
    start() {},
    retryRestoredCourse() {},
    dismissRestoredCourses() {},
    dismissSuccessfulCourses,
    discoverRecovery() {},
    resumeRecovery() {},
  };
}

describe('checkout success notice dismissal', () => {
  it('waits for checkout completion before starting an eight-second success-notice lifetime', async () => {
    vi.useFakeTimers();
    const dismissSuccessfulCourses = vi.fn();
    const { rerender } = renderHook(({ value }) => useCheckoutSuccessNoticeDismissal(value), {
      initialProps: { value: checkout('completing_checkout', true, dismissSuccessfulCourses) },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_001);
    });
    expect(dismissSuccessfulCourses).not.toHaveBeenCalled();

    rerender({ value: checkout('checkout_completed', false, dismissSuccessfulCourses) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_999);
    });
    expect(dismissSuccessfulCourses).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(dismissSuccessfulCourses).toHaveBeenCalledOnce();
    expect(dismissSuccessfulCourses).toHaveBeenCalledWith([7]);
  });
});
