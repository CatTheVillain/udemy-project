import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Location, NavigationType } from 'react-router-dom';

import { catalogPageForLocation } from './app-shell-navigation';

const POP_SCROLL_RESTORE_MAX_DURATION_MS = 1_000;

interface ScrollPosition {
  left: number;
  top: number;
}

interface PendingPopScrollRestore {
  readonly locationKey: string;
  readonly startedAt: number;
  frameId: number | null;
}

interface FailedPopScrollRestore {
  readonly locationKey: string;
  readonly position: ScrollPosition;
}

function readCurrentHistoryEntryKey(fallbackKey: string): string {
  const historyState = window.history.state;
  if (
    typeof historyState === 'object' &&
    historyState !== null &&
    'key' in historyState &&
    typeof historyState.key === 'string'
  ) {
    return historyState.key;
  }
  return fallbackKey;
}

export function useAppShellScrollRestoration({
  location,
  navigationType,
}: {
  readonly location: Location;
  readonly navigationType: NavigationType;
}): void {
  const previousLocationRef = useRef(location);
  const initialHistoryEntryKeyRef = useRef(location.key);
  const activeScrollLocationKeyRef = useRef(location.key);
  const entryScrollPositionsRef = useRef(new Map<string, ScrollPosition>());
  const pendingPopScrollRestoreRef = useRef<PendingPopScrollRestore | null>(null);
  const failedPopScrollRestoreRef = useRef<FailedPopScrollRestore | null>(null);

  const cancelPendingPopScrollRestore = useCallback(() => {
    const pendingRestore = pendingPopScrollRestoreRef.current;
    if (pendingRestore?.frameId !== null && pendingRestore?.frameId !== undefined) {
      window.cancelAnimationFrame(pendingRestore.frameId);
    }
    pendingPopScrollRestoreRef.current = null;
  }, []);

  const restorePopScrollPosition = useCallback(
    (locationKey: string, position: ScrollPosition) => {
      cancelPendingPopScrollRestore();
      failedPopScrollRestoreRef.current = null;
      const pendingRestore: PendingPopScrollRestore = {
        locationKey,
        startedAt: window.performance.now(),
        frameId: null,
      };
      pendingPopScrollRestoreRef.current = pendingRestore;

      const settlePendingRestore = () => {
        queueMicrotask(() => {
          if (pendingPopScrollRestoreRef.current === pendingRestore) {
            pendingPopScrollRestoreRef.current = null;
          }
        });
      };

      const applyRestore = () => {
        pendingRestore.frameId = null;
        if (activeScrollLocationKeyRef.current !== locationKey) {
          cancelPendingPopScrollRestore();
          return;
        }

        window.scrollTo(position.left, position.top);
        const restored =
          Math.abs(window.scrollX - position.left) <= 1 &&
          Math.abs(window.scrollY - position.top) <= 1;
        if (restored) {
          entryScrollPositionsRef.current.set(locationKey, {
            left: window.scrollX,
            top: window.scrollY,
          });
          settlePendingRestore();
          return;
        }

        if (
          window.performance.now() - pendingRestore.startedAt >=
          POP_SCROLL_RESTORE_MAX_DURATION_MS
        ) {
          failedPopScrollRestoreRef.current = {
            locationKey,
            position: { left: window.scrollX, top: window.scrollY },
          };
          settlePendingRestore();
          return;
        }

        pendingRestore.frameId = window.requestAnimationFrame(applyRestore);
      };

      applyRestore();
    },
    [cancelPendingPopScrollRestore],
  );

  useEffect(() => cancelPendingPopScrollRestore, [cancelPendingPopScrollRestore]);

  useLayoutEffect(() => {
    const trackedLocationKey = location.key;
    const rememberCurrentPosition = () => {
      const failedRestore = failedPopScrollRestoreRef.current;
      if (failedRestore?.locationKey === trackedLocationKey) {
        const stillAtFailedPosition =
          Math.abs(window.scrollX - failedRestore.position.left) <= 1 &&
          Math.abs(window.scrollY - failedRestore.position.top) <= 1;
        if (stillAtFailedPosition) return;
        failedPopScrollRestoreRef.current = null;
      }
      if (pendingPopScrollRestoreRef.current?.locationKey === trackedLocationKey) return;
      const historyEntryKey = readCurrentHistoryEntryKey(initialHistoryEntryKeyRef.current);
      if (activeScrollLocationKeyRef.current !== trackedLocationKey) return;
      if (historyEntryKey !== trackedLocationKey) return;
      entryScrollPositionsRef.current.set(trackedLocationKey, {
        left: window.scrollX,
        top: window.scrollY,
      });
    };

    window.addEventListener('scroll', rememberCurrentPosition, { passive: true });
    document.addEventListener('click', rememberCurrentPosition, true);
    return () => {
      window.removeEventListener('scroll', rememberCurrentPosition);
      document.removeEventListener('click', rememberCurrentPosition, true);
    };
  }, [location.key]);

  useLayoutEffect(() => {
    activeScrollLocationKeyRef.current = location.key;
    cancelPendingPopScrollRestore();
    if (failedPopScrollRestoreRef.current?.locationKey !== location.key) {
      failedPopScrollRestoreRef.current = null;
    }
    const previousLocation = previousLocationRef.current;
    if (previousLocation.key === location.key) return;

    if (navigationType !== 'POP' && !entryScrollPositionsRef.current.has(previousLocation.key)) {
      entryScrollPositionsRef.current.set(previousLocation.key, {
        left: window.scrollX,
        top: window.scrollY,
      });
    }

    const pathnameChanged = previousLocation.pathname !== location.pathname;
    const previousCatalogPage = catalogPageForLocation(
      previousLocation.pathname,
      previousLocation.search,
    );
    const currentCatalogPage = catalogPageForLocation(location.pathname, location.search);
    const catalogPageChanged =
      previousCatalogPage !== null &&
      currentCatalogPage !== null &&
      previousCatalogPage !== currentCatalogPage;
    if (location.hash) {
      let targetId = location.hash.slice(1);
      try {
        targetId = decodeURIComponent(targetId);
      } catch {
        // Preserve malformed fragment navigation without interrupting route restoration.
      }
      document.getElementById(targetId)?.scrollIntoView?.();
    } else if ((pathnameChanged || catalogPageChanged) && navigationType === 'POP') {
      restorePopScrollPosition(
        location.key,
        entryScrollPositionsRef.current.get(location.key) ?? { left: 0, top: 0 },
      );
    } else if (pathnameChanged || catalogPageChanged) {
      window.scrollTo(0, 0);
    }

    previousLocationRef.current = location;
  }, [cancelPendingPopScrollRestore, location, navigationType, restorePopScrollPosition]);
}
