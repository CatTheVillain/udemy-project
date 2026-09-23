import type { Location } from 'react-router-dom';

import type { SessionState } from '@features/auth-session';

import { navigationForSession } from './app-shell-navigation';
import type { HeaderPresentation, HeaderViewportFacts } from './app-shell-types';
import { routeForPath } from '../router/route-registry';

/** Maps established route, session and viewport facts without retaining UI state. */
export function presentAppShellHeader(
  state: SessionState,
  location: Location,
  viewport: HeaderViewportFacts,
): HeaderPresentation {
  const route = routeForPath(location.pathname);
  const layout = route?.layout ?? 'public';
  const isCatalogRoute = route?.id === 'PAGE-001';
  const isCourseDetailRoute = route?.id === 'PAGE-002';
  const isInstructorCoursesRoute = route?.id === 'PAGE-010';
  const isAnonymous = state.status !== 'authenticated';
  const isInstructor = state.status === 'authenticated' && state.user.role === 'instructor';
  const navigation = navigationForSession(state);
  const desktopPrimaryNavigation = navigation.filter(
    (item) => item.desktopGroup !== 'auth-actions',
  );
  const desktopAuthActions = navigation.filter((item) => item.desktopGroup === 'auth-actions');
  const isStudentMobile =
    viewport.isStudentMobileViewport &&
    state.status === 'authenticated' &&
    state.user.role === 'student';
  const isAuthenticatedMobile =
    viewport.isStudentMobileViewport && state.status === 'authenticated';
  const isAnonymousMobile = viewport.isStudentMobileViewport && isAnonymous;
  const isAnonymousTablet = viewport.isTabletViewport && isAnonymous;
  const isAuthenticatedTablet = viewport.isTabletViewport && state.status === 'authenticated';
  const isInstructorCompactDrawer =
    isInstructor && (viewport.isStudentMobileViewport || viewport.isTabletViewport);
  const isAuthenticatedDrawerViewport =
    isAuthenticatedTablet || (isInstructor && isAuthenticatedMobile);
  const hasCatalogSearch =
    isCatalogRoute ||
    (isCourseDetailRoute && !isInstructor) ||
    (state.status === 'authenticated' && state.user.role === 'student' && layout === 'workspace');
  const showHeaderCart =
    (state.status === 'anonymous' ||
      (state.status === 'authenticated' && state.user.role === 'student')) &&
    !(isAnonymous && viewport.isStudentMobileViewport);

  return {
    currentLocation: `${location.pathname}${location.search}${location.hash}`,
    desktopAuthActions,
    desktopPrimaryNavigation,
    hasCatalogSearch,
    hasDesktopAuthActions: desktopAuthActions.length > 0,
    isAnonymous,
    isAnonymousMobile,
    isAnonymousTablet,
    isAuthenticatedDrawerViewport,
    isAuthenticatedMobile,
    isAuthenticatedTablet,
    isCatalogRoute,
    isCourseDetailRoute,
    isInstructor,
    isInstructorCompactDrawer,
    isInstructorCoursesRoute,
    isStudentMobile,
    layout,
    navigation,
    showHeaderCart,
  };
}
