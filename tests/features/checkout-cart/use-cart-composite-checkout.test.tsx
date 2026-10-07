// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '../../../src/app/query';
import { queryKeys } from '../../../src/entities/api';
import type { CartCompositeSnapshotInput } from '../../../src/features/checkout-cart';
import { useCartCompositeCheckout } from '../../../src/features/checkout-cart';
import {
  SessionProvider,
  useSession,
  type AccessTokenStore,
  type SessionContextValue,
} from '../../../src/features/auth-session';
import { cartQueryKey } from '../../../src/features/cart-workflow';
import {
  ApiError,
  type ApiClient,
  type ApiRequestOptions,
  type SessionCacheEpoch,
} from '../../../src/shared/api';

const student = {
  email: 'student@example.test',
  name: 'Sam',
  surname: 'Student',
  role: 'student',
  birthday: null,
  phone_number: null,
  created_at: '2026-01-01T00:00:00Z',
};

const paidCourse: CartCompositeSnapshotInput = { courseId: 7, price: '19.99' };
const secondPaidCourse: CartCompositeSnapshotInput = { courseId: 8, price: '9.99' };
const thirdPaidCourse: CartCompositeSnapshotInput = { courseId: 9, price: '5.99' };

function tokenStore(): AccessTokenStore {
  let token: string | null = 'student-token';
  return {
    get: () => token,
    set: (next) => {
      token = next;
    },
    clear: () => {
      token = null;
    },
  };
}

function decode<TResponse, TBody>(
  options: ApiRequestOptions<TBody, TResponse>,
  value: unknown,
): TResponse {
  return options.decode ? options.decode(value) : (value as TResponse);
}

interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  resolve(value: TValue): void;
}

interface RecoveryDiscoveryReadCounts {
  readonly enrollments: number;
  readonly cart: number;
}

function expectOneRecoveryDiscoveryRead(counts: RecoveryDiscoveryReadCounts) {
  expect(counts).toEqual({ enrollments: 1, cart: 1 });
}

function deferred<TValue>(): Deferred<TValue> {
  let resolvePromise: ((value: TValue) => void) | undefined;
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

function enrollmentList(
  status: 'pending_payment' | 'active' | 'cancelled' = 'pending_payment',
  enrollmentId = 70,
) {
  return {
    items: [
      {
        id: enrollmentId,
        user_id: 1,
        course_id: 7,
        status,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        course: {
          id: 7,
          title: 'Composite course',
          description: null,
          price: '19.99',
          currency: 'USD',
        },
      },
    ],
    page: 1,
    page_size: 100,
    pages: 1,
    total: 1,
    has_next: false,
    has_previous: false,
  };
}

function emptyCart() {
  return { id: 1, items: [], total_price: '0', currency: 'USD', item_count: 0 };
}

function restoredCart() {
  return {
    id: 1,
    items: [
      {
        id: 10,
        course_id: 7,
        added_at: '2026-01-01T00:00:00Z',
        course: { id: 7, title: 'Composite course', price: '19.99', currency: 'USD' },
      },
    ],
    total_price: '19.99',
    currency: 'USD',
    item_count: 1,
  };
}

function mixedEnrollmentList() {
  return {
    items: [
      enrollmentList().items[0],
      {
        ...enrollmentList().items[0],
        id: 80,
        course_id: 8,
        course: {
          id: 8,
          title: 'Second composite course',
          description: null,
          price: '9.99',
          currency: 'USD',
        },
      },
    ],
    page: 1,
    page_size: 100,
    pages: 1,
    total: 2,
    has_next: false,
    has_previous: false,
  };
}

function createWrapper(request: ApiClient['request'], strictMode = false) {
  const queryClient = createAppQueryClient();
  function Wrapper({ children }: PropsWithChildren) {
    const content = strictMode ? <StrictMode>{children}</StrictMode> : children;
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider client={{ request }} tokenStore={tokenStore()}>
          {content}
        </SessionProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

interface SessionCaptureProps {
  onSession(session: SessionContextValue): void;
}

function SessionCapture({ onSession }: SessionCaptureProps) {
  onSession(useSession());
  return null;
}

function createSessionHarness(request: ApiClient['request']) {
  const queryClient = createAppQueryClient();
  let session: SessionContextValue | null = null;
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider client={{ request }} tokenStore={tokenStore()}>
          <SessionCapture
            onSession={(nextSession) => {
              session = nextSession;
            }}
          />
          {children}
        </SessionProvider>
      </QueryClientProvider>
    );
  }
  return {
    Wrapper,
    session: () => session,
    queryClient,
  };
}

function createOwnedSessionHarness(fetchImplementation: typeof fetch) {
  const queryClient = createAppQueryClient();
  let session: SessionContextValue | null = null;
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider
          apiBaseUrl="https://api.learnhub.test"
          fetchImplementation={fetchImplementation}
          tokenStore={tokenStore()}
        >
          <SessionCapture
            onSession={(nextSession) => {
              session = nextSession;
            }}
          />
          {children}
        </SessionProvider>
      </QueryClientProvider>
    );
  }
  return {
    Wrapper,
    session: () => session,
    queryClient,
  };
}

describe('useCartCompositeCheckout', () => {
  it('discovers one safely recoverable pending enrollment without checkout or payment writes', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/cart/checkout') counts.checkout += 1;
      if (options.path === '/payments/complete') counts.payment += 1;
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.discoverRecovery());
    await waitFor(() => expect(result.current.phase).toBe('recovery_candidates'));
    expect(result.current.recoveryCandidates).toEqual([
      {
        enrollmentId: 70,
        courseId: 7,
        course: {
          id: 7,
          title: 'Composite course',
          description: null,
          price: '19.99',
          currency: 'USD',
        },
      },
    ]);
    expect(counts).toEqual({ checkout: 0, enrollments: 1, cart: 1, payment: 0, restore: 0 });
  });

  it('coalesces duplicate recovery discovery while its paired reads are held', async () => {
    const counts = { enrollments: 0, cart: 0 };
    const enrollments = deferred<ReturnType<typeof enrollmentList>>();
    const cart = deferred<ReturnType<typeof emptyCart>>();
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, await enrollments.promise);
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, await cart.promise);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => {
      result.current.discoverRecovery();
      result.current.discoverRecovery();
    });
    await waitFor(() => expectOneRecoveryDiscoveryRead(counts));
    expect(result.current.phase).toBe('discovering_recovery');

    await act(async () => {
      enrollments.resolve(enrollmentList());
      cart.resolve(emptyCart());
    });
    await waitFor(() => expect(result.current.phase).toBe('recovery_candidates'));
    expectOneRecoveryDiscoveryRead(counts);
  });

  it('test-owned recovery guard rejects an injected duplicate discovery read', () => {
    expect(() => expectOneRecoveryDiscoveryRead({ enrollments: 2, cart: 1 })).toThrow();
    expect(() => expectOneRecoveryDiscoveryRead({ enrollments: 1, cart: 1 })).not.toThrow();
  });

  it('re-proves recovery state before resuming one selected completion without checkout', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      }
      if (options.path === '/cart/checkout') counts.checkout += 1;
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.discoverRecovery());
    await waitFor(() => expect(result.current.phase).toBe('recovery_candidates'));
    act(() => result.current.resumeRecovery());
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(counts).toEqual({ checkout: 0, enrollments: 2, cart: 3, payment: 1, restore: 0 });
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'active' }]);
  });

  it('fails closed when recovery drifts before resume without payment or restoration writes', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(
          options,
          enrollmentList(counts.enrollments === 1 ? 'pending_payment' : 'active'),
        );
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/cart/checkout') counts.checkout += 1;
      if (options.path === '/payments/complete') counts.payment += 1;
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.discoverRecovery());
    await waitFor(() => expect(result.current.phase).toBe('recovery_candidates'));
    act(() => result.current.resumeRecovery());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(counts).toEqual({ checkout: 0, enrollments: 2, cart: 2, payment: 0, restore: 0 });
  });

  it('fails closed when recovery replaces a discovered enrollment with another pending row for the same course', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(
          options,
          enrollmentList('pending_payment', counts.enrollments === 1 ? 70 : 71),
        );
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/cart/checkout') counts.checkout += 1;
      if (options.path === '/payments/complete') counts.payment += 1;
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.discoverRecovery());
    await waitFor(() => expect(result.current.phase).toBe('recovery_candidates'));
    act(() => result.current.resumeRecovery());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));

    expect(counts).toEqual({ checkout: 0, enrollments: 2, cart: 2, payment: 0, restore: 0 });
  });

  it('completes an admitted paid enrollment once and proves active access is absent from Cart', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, enrollment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      }
      if (options.path === '/enrollments/70') counts.enrollment += 1;
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.pending).toBe(false);
    expect(counts).toEqual({
      checkout: 1,
      enrollments: 1,
      cart: 2,
      payment: 1,
      enrollment: 0,
      restore: 0,
    });
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'active' }]);
  });

  it('keeps an admitted failed payment pending for exactly seven seconds before cancellation', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, counts.restore === 0 ? emptyCart() : restoredCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, { enrollment_id: 70, status: 'cancelled', message: 'cancelled' });
      }
      if (options.path === '/cart/items') {
        counts.restore += 1;
        return decode(options, restoredCart().items[0]);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    vi.useFakeTimers();
    try {
      act(() =>
        result.current.start([{ courseId: 7, outcome: 'failed' }], {
          completionDelayMs: 7_000,
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.phase).toBe('checkout_admitted');
      expect(counts.payment).toBe(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_999);
      });
      expect(result.current.phase).toBe('checkout_admitted');
      expect(counts.payment).toBe(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.phase).toBe('checkout_completed');
      expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'restored' }]);
      expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 2, payment: 1, restore: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks an enlarged server attempt before completion when a unique pending course is outside the snapshot', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, restore: 0 };
    let sessionLoaded = false;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') {
        sessionLoaded = true;
        return decode(options, student);
      }
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 2 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, mixedEnrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') counts.payment += 1;
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    await waitFor(() => expect(sessionLoaded).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(result.current.completionPlan).toEqual([]);
    expect(result.current.results).toEqual([]);
    expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 1, payment: 0, restore: 0 });

    const terminalCounts = { ...counts };
    act(() => result.current.start());
    expect(counts).toEqual(terminalCounts);
  });

  it('rejects an idle restored-course retry before it mutates Cart or payment state', async () => {
    const checkoutCourseSets: number[][] = [];
    const paymentBodies: Array<{ enrollment_id: number; status: 'success' | 'failed' }> = [];
    const removedCourseIds: number[] = [];
    const restoredCourseIds: number[] = [];
    let cartCourseIds = [7, 8];
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/items/8' && options.method === 'DELETE') {
        removedCourseIds.push(8);
        cartCourseIds = [7];
        return decode(options, undefined);
      }
      if (options.path === '/cart/checkout') {
        checkoutCourseSets.push([...cartCourseIds]);
        cartCourseIds = [];
        throw new ApiError({ kind: 'offline', status: 0, message: 'lost checkout response' });
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        const body = options.body as { course_id: number };
        restoredCourseIds.push(body.course_id);
        cartCourseIds = [...cartCourseIds, body.course_id];
        return decode(options, {
          id: 8,
          course_id: 8,
          added_at: '2026-01-01T00:00:00Z',
          course: { id: 8, title: 'Second composite course', price: '9.99', currency: 'USD' },
        });
      }
      if (options.path === '/enrollments/my') return decode(options, enrollmentList());
      if (options.path === '/cart' && options.method === 'GET') {
        return decode(options, {
          id: 1,
          items: cartCourseIds.map((courseId) => ({
            id: courseId,
            course_id: courseId,
            added_at: '2026-01-01T00:00:00Z',
            course:
              courseId === 7
                ? { id: 7, title: 'Composite course', price: '19.99', currency: 'USD' }
                : { id: 8, title: 'Second composite course', price: '9.99', currency: 'USD' },
          })),
          total_price: '0',
          currency: 'USD',
          item_count: cartCourseIds.length,
        });
      }
      if (options.path === '/payments/complete') {
        paymentBodies.push(options.body as { enrollment_id: number; status: 'success' | 'failed' });
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(
      ({ courses }: { courses: CartCompositeSnapshotInput[] }) => useCartCompositeCheckout(courses),
      { initialProps: { courses: [paidCourse] }, wrapper: createWrapper(request) },
    );

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.retryRestoredCourse(7));
    await Promise.resolve();

    expect(checkoutCourseSets).toEqual([]);
    expect(removedCourseIds).toEqual([]);
    expect(restoredCourseIds).toEqual([]);
    expect(paymentBodies).toEqual([]);
    expect(result.current.phase).toBe('idle');
    expect(result.current.results).toEqual([]);
  });

  it('isolates a verified restored-course retry so checkout and completion exclude another Cart course', async () => {
    const checkoutCourseSets: number[][] = [];
    const paymentBodies: Array<{ enrollment_id: number; status: 'success' | 'failed' }> = [];
    const removedCourseIds: number[] = [];
    const restoredCourseIds: number[] = [];
    let cartCourseIds = [7, 8];
    let enrollmentStatus: 'pending_payment' | 'active' | 'cancelled' = 'pending_payment';
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        checkoutCourseSets.push([...cartCourseIds]);
        cartCourseIds = [];
        enrollmentStatus = 'pending_payment';
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my')
        return decode(
          options,
          enrollmentList(enrollmentStatus === 'active' ? 'active' : 'pending_payment'),
        );
      if (options.path === '/cart') {
        return decode(options, {
          ...emptyCart(),
          items: cartCourseIds.map((courseId) => ({
            id: courseId,
            course_id: courseId,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: courseId, title: `Course ${courseId}`, price: '9.99', currency: 'USD' },
          })),
          item_count: cartCourseIds.length,
        });
      }
      if (options.path === '/payments/complete') {
        const body = options.body as { enrollment_id: number; status: 'success' | 'failed' };
        paymentBodies.push(body);
        enrollmentStatus = body.status === 'success' ? 'active' : 'cancelled';
        return decode(options, {
          enrollment_id: 70,
          status: enrollmentStatus,
          message: 'terminal',
        });
      }
      if (options.path.startsWith('/cart/items/')) {
        const pathSegments = options.path.split('/');
        const courseId = Number(pathSegments[pathSegments.length - 1]);
        removedCourseIds.push(courseId);
        cartCourseIds = cartCourseIds.filter((id) => id !== courseId);
        return decode(options, undefined);
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        const body = options.body as { course_id: number };
        restoredCourseIds.push(body.course_id);
        cartCourseIds = [...cartCourseIds, body.course_id];
        return decode(options, {
          id: body.course_id,
          course_id: body.course_id,
          added_at: '2026-01-01T00:00:00Z',
          course: {
            id: body.course_id,
            title: `Course ${body.course_id}`,
            price: '9.99',
            currency: 'USD',
          },
        });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const courses = [paidCourse];
    const { result } = renderHook(() => useCartCompositeCheckout(courses), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'restored' }]);

    courses.push(secondPaidCourse);
    checkoutCourseSets.length = 0;
    paymentBodies.length = 0;
    removedCourseIds.length = 0;
    restoredCourseIds.length = 0;
    cartCourseIds = [7, 8];
    act(() => result.current.retryRestoredCourse(7));
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));

    expect(checkoutCourseSets).toEqual([[7]]);
    expect(removedCourseIds).toEqual([8]);
    expect(restoredCourseIds).toEqual([8]);
    expect(paymentBodies).toEqual([{ enrollment_id: 70, status: 'success' }]);
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'active' }]);
  });

  it('compensates every possibly removed unrelated course before locking a failed verified retry', async () => {
    const removedCourseIds: number[] = [];
    const restoredCourseIds: number[] = [];
    const counts = { cart: 0, checkout: 0, enrollments: 0, payment: 0 };
    let cartCourseIds = [7, 8, 9];
    let enrollmentStatus: 'pending_payment' | 'cancelled' = 'pending_payment';
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        cartCourseIds = [];
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList('pending_payment'));
      }
      if (options.path === '/cart/items/8') {
        removedCourseIds.push(8);
        cartCourseIds = [7, 9];
        return decode(options, undefined);
      }
      if (options.path === '/cart/items/9') {
        removedCourseIds.push(9);
        cartCourseIds = [7];
        throw new ApiError({ kind: 'offline', status: 0, message: 'remove lost' });
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        const body = options.body as { course_id: number };
        restoredCourseIds.push(body.course_id);
        cartCourseIds = [...cartCourseIds, body.course_id];
        return decode(options, {
          id: body.course_id,
          course_id: body.course_id,
          added_at: '2026-01-01T00:00:00Z',
          course: { id: body.course_id, title: 'Retained course', price: '9.99', currency: 'USD' },
        });
      }
      if (options.path === '/cart' && options.method === 'GET') {
        counts.cart += 1;
        return decode(options, {
          ...emptyCart(),
          items: cartCourseIds.map((courseId) => ({
            id: courseId,
            course_id: courseId,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: courseId, title: 'Retained course', price: '9.99', currency: 'USD' },
          })),
          item_count: cartCourseIds.length,
        });
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        enrollmentStatus = 'cancelled';
        return decode(options, {
          enrollment_id: 70,
          status: enrollmentStatus,
          message: 'declined',
        });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const courses = [paidCourse];
    const { result } = renderHook(() => useCartCompositeCheckout(courses), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'restored' }]);

    courses.push(secondPaidCourse, thirdPaidCourse);
    removedCourseIds.length = 0;
    restoredCourseIds.length = 0;
    counts.cart = 0;
    counts.checkout = 0;
    counts.enrollments = 0;
    counts.payment = 0;
    cartCourseIds = [7, 8, 9];
    act(() => result.current.retryRestoredCourse(7));
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));

    expect(removedCourseIds).toEqual([8, 9]);
    expect(restoredCourseIds).toEqual([8, 9]);
    expect(cartCourseIds.sort()).toEqual([7, 8, 9]);
    expect(counts).toEqual({ cart: 1, checkout: 0, enrollments: 0, payment: 0 });
  });

  it('best-effort restores an unrelated course after unmount interrupts verified retry isolation proof', async () => {
    let resolveIsolatedCart: ((value: unknown) => void) | undefined;
    const isolatedCart = new Promise<unknown>((resolve) => {
      resolveIsolatedCart = resolve;
    });
    const counts = { removed: 0, restored: 0, checkout: 0, payment: 0 };
    let cartCourseIds = [7, 8];
    let retryProofPending = false;
    let enrollmentStatus: 'pending_payment' | 'cancelled' = 'pending_payment';
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        cartCourseIds = [];
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my')
        return decode(options, enrollmentList('pending_payment'));
      if (options.path === '/cart/items/8') {
        counts.removed += 1;
        cartCourseIds = [7];
        return decode(options, undefined);
      }
      if (options.path === '/cart' && options.method === 'GET') {
        if (retryProofPending) return decode(options, await isolatedCart);
        return decode(options, {
          ...emptyCart(),
          items: cartCourseIds.map((courseId) => ({
            id: courseId,
            course_id: courseId,
            added_at: '2026-01-01T00:00:00Z',
            course: {
              id: courseId,
              title: 'Second composite course',
              price: '9.99',
              currency: 'USD',
            },
          })),
          item_count: cartCourseIds.length,
        });
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        counts.restored += 1;
        const body = options.body as { course_id: number };
        cartCourseIds = [...cartCourseIds, body.course_id];
        return decode(options, {
          id: body.course_id,
          course_id: body.course_id,
          added_at: '2026-01-01T00:00:00Z',
          course: {
            id: body.course_id,
            title: 'Second composite course',
            price: '9.99',
            currency: 'USD',
          },
        });
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        enrollmentStatus = 'cancelled';
        return decode(options, {
          enrollment_id: 70,
          status: enrollmentStatus,
          message: 'declined',
        });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const courses = [paidCourse];
    const hook = renderHook(() => useCartCompositeCheckout(courses), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(hook.result.current.phase).toBe('checkout_completed'));
    expect(hook.result.current.results).toEqual([
      { enrollmentId: 70, courseId: 7, kind: 'restored' },
    ]);

    courses.push(secondPaidCourse);
    counts.removed = 0;
    counts.restored = 0;
    counts.checkout = 0;
    counts.payment = 0;
    cartCourseIds = [7, 8];
    retryProofPending = true;
    act(() => hook.result.current.retryRestoredCourse(7));
    await waitFor(() => expect(counts.removed).toBe(1));
    hook.unmount();
    await act(async () => {
      resolveIsolatedCart?.({
        ...emptyCart(),
        items: [
          {
            id: 7,
            course_id: 7,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: 7, title: 'Composite course', price: '19.99', currency: 'USD' },
          },
        ],
        item_count: 1,
      });
    });
    await waitFor(() => expect(counts.restored).toBe(1));
    expect(counts).toEqual({ removed: 1, restored: 1, checkout: 0, payment: 0 });
  });

  it('does not compensate a retained course after a deferred isolation response belongs to a replaced session', async () => {
    const isolatedCart = deferred<Response>();
    const requests: Array<{ path: string; method: string; authorization: string | null }> = [];
    let cartCourseIds = [7, 8];
    let isolateRetry = false;
    let enrollmentStatus: 'pending_payment' | 'cancelled' = 'pending_payment';
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      requests.push({
        path: url.pathname,
        method,
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.pathname === '/me') return json(student);
      if (url.pathname === '/cart/checkout') {
        cartCourseIds = [];
        return json({ message: 'acknowledged', enrolled_courses: 1 });
      }
      if (url.pathname === '/enrollments/my') return json(enrollmentList(enrollmentStatus));
      if (url.pathname === '/cart/items/8') {
        cartCourseIds = [7];
        return new Response(null, { status: 204 });
      }
      if (url.pathname === '/cart' && method === 'GET') {
        if (isolateRetry) return isolatedCart.promise;
        return json({
          ...emptyCart(),
          items: cartCourseIds.map((courseId) => ({
            id: courseId,
            course_id: courseId,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: courseId, title: `Course ${courseId}`, price: '9.99', currency: 'USD' },
          })),
          item_count: cartCourseIds.length,
        });
      }
      if (url.pathname === '/cart/items' && method === 'POST') {
        const courseId = (JSON.parse(String(init?.body)) as { course_id: number }).course_id;
        cartCourseIds = [...cartCourseIds, courseId];
        return json({
          id: courseId,
          course_id: courseId,
          added_at: '2026-01-01T00:00:00Z',
          course: { id: courseId, title: `Course ${courseId}`, price: '9.99', currency: 'USD' },
        });
      }
      if (url.pathname === '/payments/complete') {
        enrollmentStatus = 'cancelled';
        return json({ enrollment_id: 70, status: enrollmentStatus, message: 'declined' });
      }
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    };
    const harness = createOwnedSessionHarness(fetchImplementation);
    const courses = [paidCourse];
    const hook = renderHook(() => useCartCompositeCheckout(courses), { wrapper: harness.Wrapper });

    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(hook.result.current.phase).toBe('checkout_completed'));

    courses.push(secondPaidCourse);
    requests.length = 0;
    cartCourseIds = [7, 8];
    isolateRetry = true;
    act(() => hook.result.current.retryRestoredCourse(7));
    await waitFor(() =>
      expect(requests).toContainEqual({
        path: '/cart/items/8',
        method: 'DELETE',
        authorization: 'Bearer student-token',
      }),
    );
    const oldEpoch = harness.session()?.cacheEpoch;
    act(() => harness.session()?.acceptAccessToken('replacement-user-token'));
    await waitFor(() => {
      expect(harness.session()?.state.status).toBe('authenticated');
      expect(harness.session()?.cacheEpoch).not.toBe(oldEpoch);
      expect(requests).toContainEqual({
        path: '/me',
        method: 'GET',
        authorization: 'Bearer replacement-user-token',
      });
    });
    await act(async () => {
      isolatedCart.resolve(
        new Response(
          JSON.stringify({
            ...emptyCart(),
            items: [
              {
                id: 7,
                course_id: 7,
                added_at: '2026-01-01T00:00:00Z',
                course: { id: 7, title: 'Course 7', price: '19.99', currency: 'USD' },
              },
            ],
            item_count: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));

    expect(
      requests.filter((request) => request.path === '/cart/items' && request.method === 'POST'),
    ).toEqual([]);
    expect(requests).not.toContainEqual({
      path: '/cart/items',
      method: 'POST',
      authorization: 'Bearer replacement-user-token',
    });
  });

  it('guards every retained-course restore when logout happens between two compensation POSTs', async () => {
    const isolatedCart = deferred<unknown>();
    const firstRestore = deferred<unknown>();
    const removedCourseIds: number[] = [];
    const restoredCourseIds: number[] = [];
    let cartCourseIds = [7, 8, 9];
    let isolateRetry = false;
    let enrollmentStatus: 'pending_payment' | 'cancelled' = 'pending_payment';
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        cartCourseIds = [];
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my')
        return decode(options, enrollmentList(enrollmentStatus));
      if (options.path.startsWith('/cart/items/')) {
        const pathSegments = options.path.split('/');
        const courseId = Number(pathSegments[pathSegments.length - 1]);
        removedCourseIds.push(courseId);
        cartCourseIds = cartCourseIds.filter((id) => id !== courseId);
        return decode(options, undefined);
      }
      if (options.path === '/cart' && options.method === 'GET') {
        if (isolateRetry) return decode(options, await isolatedCart.promise);
        return decode(options, {
          ...emptyCart(),
          items: cartCourseIds.map((courseId) => ({
            id: courseId,
            course_id: courseId,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: courseId, title: `Course ${courseId}`, price: '9.99', currency: 'USD' },
          })),
          item_count: cartCourseIds.length,
        });
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        const courseId = (options.body as { course_id: number }).course_id;
        restoredCourseIds.push(courseId);
        cartCourseIds = [...cartCourseIds, courseId];
        if (courseId === 8) return decode(options, await firstRestore.promise);
        return decode(options, {
          id: courseId,
          course_id: courseId,
          added_at: '2026-01-01T00:00:00Z',
          course: { id: courseId, title: `Course ${courseId}`, price: '9.99', currency: 'USD' },
        });
      }
      if (options.path === '/payments/complete') {
        enrollmentStatus = 'cancelled';
        return decode(options, {
          enrollment_id: 70,
          status: enrollmentStatus,
          message: 'declined',
        });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const courses = [paidCourse];
    const hook = renderHook(() => useCartCompositeCheckout(courses), { wrapper: harness.Wrapper });

    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(hook.result.current.phase).toBe('checkout_completed'));

    courses.push(secondPaidCourse, thirdPaidCourse);
    removedCourseIds.length = 0;
    restoredCourseIds.length = 0;
    cartCourseIds = [7, 8, 9];
    isolateRetry = true;
    act(() => hook.result.current.retryRestoredCourse(7));
    await waitFor(() => expect(removedCourseIds).toEqual([8, 9]));
    await act(async () => {
      isolatedCart.resolve({
        ...emptyCart(),
        items: [
          {
            id: 7,
            course_id: 7,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: 7, title: 'Course 7', price: '19.99', currency: 'USD' },
          },
        ],
        item_count: 1,
      });
    });
    await waitFor(() => expect(restoredCourseIds).toEqual([8]));
    act(() => harness.session()?.clearSession());
    await waitFor(() => expect(harness.session()?.state.status).toBe('anonymous'));
    await act(async () => {
      firstRestore.resolve({
        id: 8,
        course_id: 8,
        added_at: '2026-01-01T00:00:00Z',
        course: { id: 8, title: 'Course 8', price: '9.99', currency: 'USD' },
      });
    });
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));

    expect(removedCourseIds).toEqual([8, 9]);
    expect(restoredCourseIds).toEqual([8]);
  });

  it('does not compensate after an expired session rejects a separate required request', async () => {
    const isolatedCart = deferred<unknown>();
    const counts = { removed: 0, restored: 0 };
    let cartCourseIds = [7, 8];
    let isolateRetry = false;
    let enrollmentStatus: 'pending_payment' | 'cancelled' = 'pending_payment';
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/session-expiry')
        throw new ApiError({ kind: 'http', status: 401, message: 'expired' });
      if (options.path === '/cart/checkout') {
        cartCourseIds = [];
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my')
        return decode(options, enrollmentList(enrollmentStatus));
      if (options.path === '/cart/items/8') {
        counts.removed += 1;
        cartCourseIds = [7];
        return decode(options, undefined);
      }
      if (options.path === '/cart' && options.method === 'GET') {
        if (isolateRetry) return decode(options, await isolatedCart.promise);
        return decode(options, {
          ...emptyCart(),
          items: cartCourseIds.map((courseId) => ({
            id: courseId,
            course_id: courseId,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: courseId, title: `Course ${courseId}`, price: '9.99', currency: 'USD' },
          })),
          item_count: cartCourseIds.length,
        });
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        counts.restored += 1;
        const courseId = (options.body as { course_id: number }).course_id;
        cartCourseIds = [...cartCourseIds, courseId];
        return decode(options, {
          id: courseId,
          course_id: courseId,
          added_at: '2026-01-01T00:00:00Z',
          course: { id: courseId, title: `Course ${courseId}`, price: '9.99', currency: 'USD' },
        });
      }
      if (options.path === '/payments/complete') {
        enrollmentStatus = 'cancelled';
        return decode(options, {
          enrollment_id: 70,
          status: enrollmentStatus,
          message: 'declined',
        });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const courses = [paidCourse];
    const hook = renderHook(() => useCartCompositeCheckout(courses), { wrapper: harness.Wrapper });

    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(hook.result.current.phase).toBe('checkout_completed'));
    courses.push(secondPaidCourse);
    counts.removed = 0;
    counts.restored = 0;
    cartCourseIds = [7, 8];
    isolateRetry = true;
    act(() => hook.result.current.retryRestoredCourse(7));
    await waitFor(() => expect(counts.removed).toBe(1));
    await act(async () => {
      await expect(
        harness.session()?.requestRequired({ method: 'GET', path: '/session-expiry' }),
      ).rejects.toMatchObject({ status: 401 });
    });
    await waitFor(() => expect(harness.session()?.state.status).toBe('anonymous'));
    await act(async () => {
      isolatedCart.resolve({
        ...emptyCart(),
        items: [
          {
            id: 7,
            course_id: 7,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: 7, title: 'Course 7', price: '19.99', currency: 'USD' },
          },
        ],
        item_count: 1,
      });
    });
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));

    expect(counts).toEqual({ removed: 1, restored: 0 });
  });

  it('reconciles a malformed completion once and persists unknown without another payment or restore write', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, enrollment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, {
          enrollment_id: 70,
          status: 'pending_payment',
          message: 'invalid',
        });
      }
      if (options.path === '/enrollments/70') {
        counts.enrollment += 1;
        return decode(options, { ...enrollmentList().items[0], status: 'pending_payment' });
      }
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(result.current.pending).toBe(false);
    expect(counts).toEqual({
      checkout: 1,
      enrollments: 1,
      cart: 1,
      payment: 1,
      enrollment: 1,
      restore: 0,
    });
    expect(result.current.results).toEqual([
      { enrollmentId: 70, courseId: 7, kind: 'integrity_unknown' },
    ]);
    act(() => {
      result.current.start();
      result.current.retryRestoredCourse(7);
    });
    expect(counts).toEqual({
      checkout: 1,
      enrollments: 1,
      cart: 1,
      payment: 1,
      enrollment: 1,
      restore: 0,
    });
  });

  it('proves restoration from a fresh Cart read after an uncertain API-005 response', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, enrollment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, counts.cart === 1 ? emptyCart() : restoredCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, { enrollment_id: 70, status: 'cancelled', message: 'declined' });
      }
      if (options.path === '/cart/items') {
        counts.restore += 1;
        throw new ApiError({ kind: 'offline', status: 0, message: 'lost restore response' });
      }
      if (options.path === '/enrollments/70') counts.enrollment += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(counts).toEqual({
      checkout: 1,
      enrollments: 1,
      cart: 2,
      payment: 1,
      enrollment: 0,
      restore: 1,
    });
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'restored' }]);
  });

  it('re-arms one explicit retry only for a server-proven restored course', async () => {
    const payments: Array<'success' | 'failed'> = [];
    let cartContainsCourse = true;
    let enrollmentStatus: 'active' | 'cancelled' | 'pending_payment' = 'pending_payment';
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        cartContainsCourse = false;
        enrollmentStatus = 'pending_payment';
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my')
        return decode(
          options,
          enrollmentList(enrollmentStatus === 'active' ? 'active' : 'pending_payment'),
        );
      if (options.path === '/cart')
        return decode(options, cartContainsCourse ? restoredCart() : emptyCart());
      if (options.path === '/payments/complete') {
        const body = options.body as { status: 'success' | 'failed' };
        payments.push(body.status);
        enrollmentStatus = body.status === 'success' ? 'active' : 'cancelled';
        return decode(options, {
          enrollment_id: 70,
          status: enrollmentStatus,
          message: 'terminal',
        });
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        cartContainsCourse = true;
        return decode(options, restoredCart().items[0]);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'restored' }]);

    act(() => {
      result.current.retryRestoredCourse(7);
      result.current.retryRestoredCourse(7);
    });
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));

    expect(payments).toEqual(['failed', 'success']);
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'active' }]);
  });

  it('dismisses only a verified restored result and releases its terminal write lock', async () => {
    let cartContainsCourse = true;
    let checkoutRequests = 0;
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        checkoutRequests += 1;
        cartContainsCourse = false;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') return decode(options, enrollmentList());
      if (options.path === '/cart')
        return decode(options, cartContainsCourse ? restoredCart() : emptyCart());
      if (options.path === '/payments/complete') {
        return decode(options, { enrollment_id: 70, status: 'cancelled', message: 'declined' });
      }
      if (options.path === '/cart/items' && options.method === 'POST') {
        cartContainsCourse = true;
        return decode(options, restoredCart().items[0]);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'restored' }]);

    act(() => result.current.dismissRestoredCourses([7]));
    expect(result.current.phase).toBe('idle');
    expect(result.current.results).toEqual([]);

    cartContainsCourse = true;
    act(() => result.current.start([{ courseId: 7, outcome: 'failed' }]));
    await waitFor(() => expect(checkoutRequests).toBe(2));
  });

  it('aggregates a verified active item with an independently restored cancelled item', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 2 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, mixedEnrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(
          options,
          counts.cart === 3
            ? {
                ...restoredCart(),
                items: [
                  {
                    ...restoredCart().items[0],
                    course_id: 8,
                    course: {
                      id: 8,
                      title: 'Second composite course',
                      price: '9.99',
                      currency: 'USD',
                    },
                  },
                ],
                total_price: '9.99',
              }
            : emptyCart(),
        );
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        const body = options.body as { enrollment_id: number; status: 'success' | 'failed' };
        return decode(options, {
          enrollment_id: body.enrollment_id,
          status: body.status === 'success' ? 'active' : 'cancelled',
          message: 'terminal',
        });
      }
      if (options.path === '/cart/items') {
        counts.restore += 1;
        return decode(options, undefined);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse, secondPaidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start([{ courseId: 8, outcome: 'failed' }]));
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 3, payment: 2, restore: 1 });
    expect(result.current.results).toEqual([
      { enrollmentId: 70, courseId: 7, kind: 'active' },
      { enrollmentId: 80, courseId: 8, kind: 'restored' },
    ]);
  });

  it('stops before every later write when the first correlated completion remains unknown', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, enrollment: 0, restore: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 2 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, mixedEnrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, {
          enrollment_id: 70,
          status: 'pending_payment',
          message: 'malformed terminal state',
        });
      }
      if (options.path === '/enrollments/70') {
        counts.enrollment += 1;
        return decode(options, { ...enrollmentList().items[0], status: 'pending_payment' });
      }
      if (options.path === '/cart/items') counts.restore += 1;
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse, secondPaidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(result.current.pending).toBe(false);
    expect(counts).toEqual({
      checkout: 1,
      enrollments: 1,
      cart: 1,
      payment: 1,
      enrollment: 1,
      restore: 0,
    });
    expect(result.current.results).toEqual([
      { enrollmentId: 70, courseId: 7, kind: 'integrity_unknown' },
    ]);
    const terminalCounts = { ...counts };
    act(() => result.current.start());
    expect(counts).toEqual(terminalCounts);
  });

  it('locks a completed snapshot against repeated checkout starts', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    const completedCounts = { ...counts };
    act(() => result.current.start());
    expect(counts).toEqual(completedCounts);
  });

  it('dismisses a proven successful result and returns the workflow to idle', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout')
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      if (options.path === '/enrollments/my') return decode(options, enrollmentList());
      if (options.path === '/cart') return decode(options, emptyCart());
      if (options.path === '/payments/complete')
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => expect(harness.session()?.state.status).toBe('authenticated'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'active' }]);

    act(() => result.current.dismissSuccessfulCourses([7]));

    expect(result.current.results).toEqual([]);
    expect(result.current.phase).toBe('idle');
  });

  it('invalidates only the terminal attempt subject Cart and enrollment cache identities once', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => expect(harness.session()?.state.status).toBe('authenticated'));
    const subject = harness.session()?.cacheEpoch;
    if (subject === null || subject === undefined)
      throw new Error('Expected authenticated cache epoch');
    const otherSubject = 'other-student' as SessionCacheEpoch;
    const cartKey = cartQueryKey(subject);
    const listKey = queryKeys.private.operation(subject, 'API-021', 'learning:list:1');
    const detailKey = queryKeys.private.operation(subject, 'API-022', 'learning:enrollment:70');
    const unrelatedPrivateKey = queryKeys.private.operation(
      otherSubject,
      'API-021',
      'learning:list:1',
    );
    const unrelatedPublicKey = queryKeys.public.operation('API-021', 'catalog');
    harness.queryClient.setQueryData(cartKey, { cart: true });
    harness.queryClient.setQueryData(listKey, { list: true });
    harness.queryClient.setQueryData(detailKey, { detail: true });
    harness.queryClient.setQueryData(unrelatedPrivateKey, { other: true });
    harness.queryClient.setQueryData(unrelatedPublicKey, { public: true });
    const invalidate = vi.spyOn(harness.queryClient, 'invalidateQueries');

    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual(
      expect.arrayContaining([
        { queryKey: cartKey, exact: true },
        { queryKey: queryKeys.private.operationPrefix(subject, 'API-021'), exact: false },
        { queryKey: queryKeys.private.operationPrefix(subject, 'API-022'), exact: false },
      ]),
    );
    expect(harness.queryClient.getQueryState(cartKey)?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(unrelatedPrivateKey)?.isInvalidated).toBe(false);
    expect(harness.queryClient.getQueryState(unrelatedPublicKey)?.isInvalidated).toBe(false);
    const terminalCounts = { ...counts };
    act(() => result.current.start());
    expect(counts).toEqual(terminalCounts);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('keeps pending true until terminal cache reconciliation settles', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout')
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      if (options.path === '/enrollments/my') return decode(options, enrollmentList());
      if (options.path === '/cart') return decode(options, emptyCart());
      if (options.path === '/payments/complete')
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: harness.Wrapper,
    });
    const resolvers: Array<() => void> = [];
    const invalidate = vi.spyOn(harness.queryClient, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
    expect(result.current.phase).toBe('completing_checkout');
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolvers.forEach((resolve) => resolve());
    });
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.pending).toBe(false);
  });

  it('reconciles cache once before exposing a proven-prefix unknown terminal', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0, enrollment: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, {
          enrollment_id: 70,
          status: 'pending_payment',
          message: 'invalid',
        });
      }
      if (options.path === '/enrollments/70') {
        counts.enrollment += 1;
        return decode(options, { ...enrollmentList().items[0], status: 'pending_payment' });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: harness.Wrapper,
    });
    const invalidate = vi.spyOn(harness.queryClient, 'invalidateQueries');

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(result.current.results).toEqual([
      { enrollmentId: 70, courseId: 7, kind: 'integrity_unknown' },
    ]);
    expect(invalidate).toHaveBeenCalledTimes(3);
    const terminalCounts = { ...counts };
    act(() => result.current.start());
    expect(counts).toEqual(terminalCounts);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('does not project a stale terminal phase after the subject changes during cache reconciliation', async () => {
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout')
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      if (options.path === '/enrollments/my') return decode(options, enrollmentList());
      if (options.path === '/cart') return decode(options, emptyCart());
      if (options.path === '/payments/complete')
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: harness.Wrapper,
    });
    const resolvers: Array<() => void> = [];
    const invalidate = vi.spyOn(harness.queryClient, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    await waitFor(() => expect(harness.session()?.state.status).toBe('authenticated'));
    act(() => result.current.start());
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
    expect(result.current.phase).toBe('completing_checkout');

    act(() => harness.session()?.acceptAccessToken('replacement-token'));
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    await act(async () => {
      resolvers.forEach((resolve) => resolve());
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.results).toEqual([]);
  });

  it('fails closed without replaying writes when terminal cache reconciliation rejects', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, { enrollment_id: 70, status: 'active', message: 'paid' });
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: harness.Wrapper,
    });
    const invalidate = vi
      .spyOn(harness.queryClient, 'invalidateQueries')
      .mockRejectedValue(new Error('cache reconciliation failed'));

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(result.current.pending).toBe(false);
    expect(result.current.results).toEqual([{ enrollmentId: 70, courseId: 7, kind: 'active' }]);
    expect(invalidate).toHaveBeenCalledTimes(3);
    const terminalCounts = { ...counts };
    act(() => result.current.start());
    expect(counts).toEqual(terminalCounts);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('keeps the public pending flag true until a deferred correlated completion reaches a terminal result', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0, payment: 0 };
    let resolvePayment: ((value: unknown) => void) | undefined;
    const payment = new Promise<unknown>((resolve) => {
      resolvePayment = resolve;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      if (options.path === '/payments/complete') {
        counts.payment += 1;
        return decode(options, await payment);
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('completing_checkout'));
    expect(result.current.pending).toBe(true);
    expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 1, payment: 1 });

    await act(async () => {
      resolvePayment?.({ enrollment_id: 70, status: 'active', message: 'paid' });
    });
    await waitFor(() => expect(result.current.phase).toBe('checkout_completed'));
    expect(result.current.pending).toBe(false);
    expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 2, payment: 1 });
  });

  it('admits one live attempt under React StrictMode', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0 };
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, { message: 'acknowledged', enrolled_courses: 1 });
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request, true),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 1 });
  });

  it('issues one checkout and one fresh dual-source read for a live duplicate start', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0 };
    let resolveCheckout: ((value: unknown) => void) | undefined;
    const checkout = new Promise<unknown>((resolve) => {
      resolveCheckout = resolve;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, await checkout);
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => {
      result.current.start();
      result.current.start();
    });
    expect(counts.checkout).toBe(1);

    await act(async () => {
      resolveCheckout?.({ message: 'acknowledged', enrolled_courses: 1 });
    });
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 1 });
    expect(result.current.completionPlan).toEqual([
      { enrollmentId: 70, courseId: 7, outcome: 'success' },
    ]);
  });

  it.each([
    {
      name: 'lost checkout response',
      checkout: () => Promise.reject(new ApiError({ kind: 'offline', status: 0, message: 'lost' })),
      cart: emptyCart(),
      expectedPhase: 'checkout_integrity_unknown',
      expectEmptyCompletionPlan: false,
    },
    {
      name: 'acknowledged checkout with a retained Cart course',
      checkout: () => Promise.resolve({ message: 'acknowledged', enrolled_courses: 1 }),
      cart: {
        id: 1,
        items: [
          {
            id: 10,
            course_id: 7,
            added_at: '2026-01-01T00:00:00Z',
            course: { id: 7, title: 'Composite course', price: '19.99', currency: 'USD' },
          },
        ],
        total_price: '19.99',
        currency: 'USD',
        item_count: 1,
      },
      expectedPhase: 'checkout_integrity_unknown',
      expectEmptyCompletionPlan: true,
    },
  ] as const)(
    'treats $name as non-authoritative before fresh admission',
    async ({ checkout, cart, expectedPhase, expectEmptyCompletionPlan }) => {
      const counts = { checkout: 0, enrollments: 0, cart: 0 };
      const request: ApiClient['request'] = async <TResponse, TBody>(
        options: ApiRequestOptions<TBody, TResponse>,
      ) => {
        if (options.path === '/me') return decode(options, student);
        if (options.path === '/cart/checkout') {
          counts.checkout += 1;
          return decode(options, await checkout());
        }
        if (options.path === '/enrollments/my') {
          counts.enrollments += 1;
          return decode(options, enrollmentList());
        }
        if (options.path === '/cart') {
          counts.cart += 1;
          return decode(options, cart);
        }
        throw new Error(`Unexpected request ${options.method} ${options.path}`);
      };
      const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
        wrapper: createWrapper(request),
      });

      await waitFor(() => expect(result.current.phase).toBe('idle'));
      act(() => result.current.start());
      await waitFor(() => expect(result.current.phase).toBe(expectedPhase));
      expect(counts).toEqual({ checkout: 1, enrollments: 1, cart: 1 });
      if (expectEmptyCompletionPlan) {
        expect(result.current.completionPlan).toEqual([]);
      }
    },
  );

  it('drops a late checkout response after unmount without starting fresh admission reads', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0 };
    let resolveCheckout: ((value: unknown) => void) | undefined;
    const checkout = new Promise<unknown>((resolve) => {
      resolveCheckout = resolve;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(options, await checkout);
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const hook = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: createWrapper(request),
    });

    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.start());
    expect(counts.checkout).toBe(1);
    hook.unmount();
    await act(async () => {
      resolveCheckout?.({ message: 'acknowledged', enrolled_courses: 1 });
    });

    expect(counts).toEqual({ checkout: 1, enrollments: 0, cart: 0 });
  });

  it('aborts a previous subject attempt and prevents its late admission from replacing the new subject', async () => {
    const counts = { checkout: 0, enrollments: 0, cart: 0 };
    let resolveFirstCheckout: ((value: unknown) => void) | undefined;
    const firstCheckout = new Promise<unknown>((resolve) => {
      resolveFirstCheckout = resolve;
    });
    const request: ApiClient['request'] = async <TResponse, TBody>(
      options: ApiRequestOptions<TBody, TResponse>,
    ) => {
      if (options.path === '/me') return decode(options, student);
      if (options.path === '/cart/checkout') {
        counts.checkout += 1;
        return decode(
          options,
          counts.checkout === 1
            ? await firstCheckout
            : { message: 'acknowledged', enrolled_courses: 1 },
        );
      }
      if (options.path === '/enrollments/my') {
        counts.enrollments += 1;
        return decode(options, enrollmentList());
      }
      if (options.path === '/cart') {
        counts.cart += 1;
        return decode(options, emptyCart());
      }
      throw new Error(`Unexpected request ${options.method} ${options.path}`);
    };
    const harness = createSessionHarness(request);
    const { result } = renderHook(() => useCartCompositeCheckout([paidCourse]), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => expect(harness.session()?.state.status).toBe('authenticated'));
    const firstSubject = harness.session()?.cacheEpoch;
    act(() => result.current.start());
    expect(counts.checkout).toBe(1);

    act(() => harness.session()?.acceptAccessToken('replacement-token'));
    await waitFor(() => {
      expect(harness.session()?.state.status).toBe('authenticated');
      expect(harness.session()?.cacheEpoch).not.toBe(firstSubject);
      expect(result.current.phase).toBe('idle');
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('checkout_integrity_unknown'));
    expect(counts).toEqual({ checkout: 2, enrollments: 1, cart: 1 });

    await act(async () => {
      resolveFirstCheckout?.({ message: 'late acknowledgement', enrolled_courses: 1 });
    });
    expect(result.current.phase).toBe('checkout_integrity_unknown');
    expect(counts).toEqual({ checkout: 2, enrollments: 1, cart: 1 });
  });
});
