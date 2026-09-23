import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { CatalogSearchFocusIntent } from './catalog-header-search-types';
import { claimInstructorCoursesNewTabFocus } from './instructor-courses-focus-marker';

function scheduleRouteFocus(focus: () => void): () => void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    const frameId = globalThis.requestAnimationFrame(focus);
    return () => globalThis.cancelAnimationFrame(frameId);
  }
  const timeoutId = globalThis.setTimeout(focus, 0);
  return () => globalThis.clearTimeout(timeoutId);
}

export function useAppShellRouteFocus({
  catalogSearchFocusIntent,
  catalogSearchLocationIdentity,
  currentLocation,
  headingId,
  initialPathname,
  mainRef,
  routeFocusIdentity,
}: {
  readonly catalogSearchFocusIntent: CatalogSearchFocusIntent | null;
  readonly catalogSearchLocationIdentity: string;
  readonly currentLocation: string;
  readonly headingId: string;
  readonly initialPathname: string;
  readonly mainRef: RefObject<HTMLElement>;
  readonly routeFocusIdentity: string;
}): (destination: string | undefined) => void {
  const previousLocationRef = useRef(currentLocation);
  const previousRouteFocusIdentityRef = useRef(routeFocusIdentity);
  const initialPathnameRef = useRef(initialPathname);
  const newTabFocusClaimedRef = useRef(false);
  const newTabFocusLocationIdentityRef = useRef<string | null>(null);
  const pendingMobileMenuMainFocusRouteRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const hasCurrentNewTabFocusClaim =
      newTabFocusClaimedRef.current &&
      newTabFocusLocationIdentityRef.current === catalogSearchLocationIdentity;
    if (newTabFocusClaimedRef.current && !hasCurrentNewTabFocusClaim) {
      newTabFocusClaimedRef.current = false;
      newTabFocusLocationIdentityRef.current = null;
    }
    const hasClaimedNewTabFocus =
      hasCurrentNewTabFocusClaim || claimInstructorCoursesNewTabFocus(initialPathnameRef.current);
    if (!hasClaimedNewTabFocus) return undefined;

    newTabFocusClaimedRef.current = true;
    newTabFocusLocationIdentityRef.current = catalogSearchLocationIdentity;
    let cancelled = false;
    let cancelScheduledFocus: (() => void) | undefined;
    const focusHeading = (heading: HTMLElement) => {
      cancelScheduledFocus = scheduleRouteFocus(() => {
        if (cancelled) return;
        heading.focus({ preventScroll: true });
        newTabFocusClaimedRef.current = false;
        newTabFocusLocationIdentityRef.current = null;
      });
    };
    const heading = document.getElementById(headingId);
    if (heading instanceof HTMLElement) {
      focusHeading(heading);
      return () => {
        cancelled = true;
        cancelScheduledFocus?.();
      };
    }

    const observer = new MutationObserver(() => {
      const renderedHeading = document.getElementById(headingId);
      if (!(renderedHeading instanceof HTMLElement)) return;
      observer.disconnect();
      focusHeading(renderedHeading);
    });
    observer.observe(mainRef.current ?? document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      cancelScheduledFocus?.();
      observer.disconnect();
    };
  }, [catalogSearchLocationIdentity, headingId, mainRef]);

  useEffect(() => {
    if (previousLocationRef.current === currentLocation) return undefined;

    const restoresCatalogSearchFocus =
      catalogSearchFocusIntent?.sourceLocationIdentity !== catalogSearchLocationIdentity &&
      catalogSearchFocusIntent?.destinationLocation === currentLocation;
    const routeChanged = previousRouteFocusIdentityRef.current !== routeFocusIdentity;
    previousLocationRef.current = currentLocation;
    previousRouteFocusIdentityRef.current = routeFocusIdentity;
    if (restoresCatalogSearchFocus || !routeChanged) return undefined;
    return scheduleRouteFocus(() => mainRef.current?.focus({ preventScroll: true }));
  }, [
    catalogSearchFocusIntent,
    catalogSearchLocationIdentity,
    currentLocation,
    mainRef,
    routeFocusIdentity,
  ]);

  useLayoutEffect(() => {
    if (pendingMobileMenuMainFocusRouteRef.current !== routeFocusIdentity) return;
    pendingMobileMenuMainFocusRouteRef.current = null;
    mainRef.current?.focus({ preventScroll: true });
  }, [mainRef, routeFocusIdentity]);

  return (destination) => {
    pendingMobileMenuMainFocusRouteRef.current = destination ?? null;
  };
}
