// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppShellRouteFocus } from '../../src/app/layouts/app-shell-route-focus';

import {
  claimInstructorCoursesNewTabFocus,
  requestInstructorCoursesNewTabFocus,
} from '../../src/app/layouts/instructor-courses-focus-marker';

const MARKER_KEY = 'learnhub.instructor-courses.new-tab-focus';
const DESTINATION = '/instructor/courses';
const SOURCE_PATH = '/instructor/courses/42/edit';
const referrer = `${window.location.origin}${SOURCE_PATH}`;
const documentReferrerDescriptor = Object.getOwnPropertyDescriptor(document, 'referrer');

function storeMarker(marker: unknown): void {
  localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (documentReferrerDescriptor)
    Object.defineProperty(document, 'referrer', documentReferrerDescriptor);
  localStorage.clear();
});

function prepareEligibleNewTabFocusMarker() {
  Object.defineProperty(document, 'referrer', { configurable: true, value: referrer });
  storeMarker({ destination: DESTINATION, requestedAt: Date.now(), sourcePath: SOURCE_PATH });
}

function RouteFocusLifecycleHarness({
  locationIdentity,
  rendersHeading,
}: {
  readonly locationIdentity: string;
  readonly rendersHeading: boolean;
}) {
  const mainRef = useRef<HTMLElement>(null);

  useAppShellRouteFocus({
    catalogSearchFocusIntent: null,
    catalogSearchLocationIdentity: locationIdentity,
    currentLocation: locationIdentity === 'instructor-entry' ? DESTINATION : '/login',
    headingId: 'your-courses-heading',
    initialPathname: DESTINATION,
    mainRef,
    routeFocusIdentity: locationIdentity,
  });

  return (
    <main ref={mainRef}>
      {rendersHeading ? (
        <h1 id="your-courses-heading" tabIndex={-1}>
          Your courses
        </h1>
      ) : null}
    </main>
  );
}

describe('instructor courses new-tab focus marker adapter', () => {
  it('claims an eligible marker once and retires it before any later receiver can focus', () => {
    const now = 1_000_000;
    storeMarker({ destination: DESTINATION, requestedAt: now, sourcePath: SOURCE_PATH });

    expect(claimInstructorCoursesNewTabFocus(DESTINATION, referrer, now)).toBe(true);
    expect(localStorage.getItem(MARKER_KEY)).toBeNull();
    expect(claimInstructorCoursesNewTabFocus(DESTINATION, referrer, now)).toBe(false);
  });

  it.each([
    ['missing timestamp', { destination: DESTINATION, sourcePath: SOURCE_PATH }],
    ['non-object payload', []],
    [
      'unsafe timestamp',
      { destination: DESTINATION, requestedAt: Number.MAX_VALUE, sourcePath: SOURCE_PATH },
    ],
  ])('rejects and retires a malformed marker: %s', (_caseName, marker) => {
    const now = 1_000_000;
    storeMarker(marker);

    expect(claimInstructorCoursesNewTabFocus(DESTINATION, referrer, now)).toBe(false);
    expect(localStorage.getItem(MARKER_KEY)).toBeNull();
  });

  it.each([
    ['future', 1_000_001],
    ['expired', 969_999],
  ])('rejects and retires a %s marker timestamp', (_caseName, requestedAt) => {
    const now = 1_000_000;
    storeMarker({ destination: DESTINATION, requestedAt, sourcePath: SOURCE_PATH });

    expect(claimInstructorCoursesNewTabFocus(DESTINATION, referrer, now)).toBe(false);
    expect(localStorage.getItem(MARKER_KEY)).toBeNull();
  });

  it('accepts the inclusive 30-second TTL boundary only for the same origin and source path', () => {
    const now = 1_000_000;
    storeMarker({ destination: DESTINATION, requestedAt: now - 30_000, sourcePath: SOURCE_PATH });
    expect(claimInstructorCoursesNewTabFocus(DESTINATION, referrer, now)).toBe(true);

    storeMarker({ destination: DESTINATION, requestedAt: now, sourcePath: SOURCE_PATH });
    expect(
      claimInstructorCoursesNewTabFocus(
        DESTINATION,
        'https://untrusted.example/instructor/courses/42/edit',
        now,
      ),
    ).toBe(false);
    expect(localStorage.getItem(MARKER_KEY)).toBeNull();

    storeMarker({ destination: DESTINATION, requestedAt: now, sourcePath: SOURCE_PATH });
    expect(
      claimInstructorCoursesNewTabFocus(
        DESTINATION,
        `${window.location.origin}/instructor/courses/43/edit`,
        now,
      ),
    ).toBe(false);
    expect(localStorage.getItem(MARKER_KEY)).toBeNull();
  });

  it.each(['', 'not a URL'])(
    'retires a marker when the referrer is invalid: %s',
    (invalidReferrer) => {
      const now = 1_000_000;
      storeMarker({ destination: DESTINATION, requestedAt: now, sourcePath: SOURCE_PATH });

      expect(claimInstructorCoursesNewTabFocus(DESTINATION, invalidReferrer, now)).toBe(false);
      expect(localStorage.getItem(MARKER_KEY)).toBeNull();
    },
  );

  it('treats unavailable marker storage as progressive enhancement without a throw', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(claimInstructorCoursesNewTabFocus(DESTINATION, referrer, 1_000_000)).toBe(false);
    expect(getItem).toHaveBeenCalledWith(MARKER_KEY);

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() =>
      requestInstructorCoursesNewTabFocus({
        destination: DESTINATION,
        sourcePath: SOURCE_PATH,
        requestedAt: 1_000_000,
      }),
    ).not.toThrow();
    expect(setItem).toHaveBeenCalledWith(MARKER_KEY, expect.any(String));
    const [, serializedMarker] = setItem.mock.calls[0] ?? [];
    expect(JSON.parse(String(serializedMarker))).toEqual({
      destination: DESTINATION,
      requestedAt: 1_000_000,
      sourcePath: SOURCE_PATH,
    });
  });

  it('keeps marker JSON and storage policy outside AppShell and the adapter free of UI imports', () => {
    const appShellSource = readFileSync(
      pathToFileURL(resolve(process.cwd(), 'src/app/layouts/AppShell.tsx')),
      'utf8',
    );
    const markerAdapterSource = readFileSync(
      pathToFileURL(resolve(process.cwd(), 'src/app/layouts/instructor-courses-focus-marker.ts')),
      'utf8',
    );

    expect(appShellSource).not.toMatch(/(?:localStorage|JSON\.parse|new Map\()/);
    expect(markerAdapterSource).not.toMatch(
      /from ['"](?:react|\.\/AppShell|\.\/NavigationLinks)['"]/,
    );
  });
});

describe('new-tab heading route-focus lifecycle', () => {
  it('cancels a pending heading observer on replacement navigation so a later heading cannot steal focus', async () => {
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const observers: Array<{
      readonly disconnect: ReturnType<typeof vi.fn>;
      trigger(): void;
    }> = [];
    class TestMutationObserver {
      readonly disconnect = vi.fn();
      readonly observe = vi.fn();

      constructor(private readonly callback: MutationCallback) {
        observers.push(this);
      }

      trigger() {
        this.callback([], this as unknown as MutationObserver);
      }
    }
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      scheduledFrames.set(frameId, callback);
      return frameId;
    });
    const cancelAnimationFrame = vi.fn((frameId: number) => {
      scheduledFrames.delete(frameId);
    });
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    prepareEligibleNewTabFocusMarker();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    const { rerender } = render(
      <RouteFocusLifecycleHarness locationIdentity="instructor-entry" rendersHeading={false} />,
    );
    expect(localStorage.getItem(MARKER_KEY)).toBeNull();
    expect(observers).toHaveLength(1);
    requestAnimationFrame.mockClear();

    rerender(
      <RouteFocusLifecycleHarness locationIdentity="login-replacement" rendersHeading={false} />,
    );
    rerender(<RouteFocusLifecycleHarness locationIdentity="login-replacement" rendersHeading />);

    expect(observers).toHaveLength(1);
    expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
    const scheduledBeforeStaleObserverDelivery = new Set(scheduledFrames.keys());
    observers[0]?.trigger();
    const staleObserverFrames = [...scheduledFrames.entries()].filter(
      ([frameId]) => !scheduledBeforeStaleObserverDelivery.has(frameId),
    );
    await act(async () => {
      for (const [, callback] of staleObserverFrames) callback(0);
    });

    const heading = screen.getByRole('heading', { name: 'Your courses' });
    expect(document.activeElement).not.toBe(heading);
    expect(focus.mock.instances).not.toContain(heading);
  });

  it('focuses the heading when the claimed new-tab route identity remains current', async () => {
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const observers: Array<{ trigger(): void }> = [];
    class TestMutationObserver {
      readonly disconnect = vi.fn();
      readonly observe = vi.fn();

      constructor(private readonly callback: MutationCallback) {
        observers.push(this);
      }

      trigger() {
        this.callback([], this as unknown as MutationObserver);
      }
    }
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      scheduledFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frameId: number) => scheduledFrames.delete(frameId)),
    );
    prepareEligibleNewTabFocusMarker();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    const { rerender } = render(
      <RouteFocusLifecycleHarness locationIdentity="instructor-entry" rendersHeading={false} />,
    );
    requestAnimationFrame.mockClear();
    rerender(<RouteFocusLifecycleHarness locationIdentity="instructor-entry" rendersHeading />);

    expect(observers).toHaveLength(1);
    observers[0]?.trigger();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const callback of scheduledFrames.values()) callback(0);
    });

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your courses' }));
  });
});
