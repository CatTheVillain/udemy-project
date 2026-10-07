import { matchPath, type To } from 'react-router-dom';

import { sanitizeInternalReturnTo } from '@features/auth-session';

interface CartNavigationState {
  readonly returnTo?: unknown;
}

export interface CartReturnTarget {
  readonly label: string;
  readonly labelKey: string;
  readonly to: To;
}

interface CartReturnRoute {
  readonly label: string;
  readonly labelKey: string;
  readonly path: string;
}

const cartReturnFallback: CartReturnTarget = {
  label: 'Catalog',
  labelKey: 'navigation:catalog',
  to: '/',
};

const cartReturnRoutes: readonly CartReturnRoute[] = [
  { path: '/courses/:courseId', label: 'Course details', labelKey: 'routes:courseDetailsTitle' },
  { path: '/signup', label: 'Create account', labelKey: 'routes:createAccountTitle' },
  { path: '/login', label: 'Log in', labelKey: 'navigation:logIn' },
  { path: '/forgot-password', label: 'Forgot password', labelKey: 'routes:forgotPasswordTitle' },
  { path: '/reset-password', label: 'Reset password', labelKey: 'routes:resetPasswordTitle' },
  { path: '/learning', label: 'My learning', labelKey: 'navigation:myLearning' },
  {
    path: '/learning/enrollments/:enrollmentId',
    label: 'Learning details',
    labelKey: 'routes:learningDetailsTitle',
  },
  {
    path: '/learning/enrollments/:enrollmentId/ai-chat',
    label: 'Course assistant',
    labelKey: 'routes:courseAssistantTitle',
  },
  { path: '/ai-chat', label: 'AI assistant', labelKey: 'routes:aiAssistantTitle' },
  {
    path: '/instructor/courses',
    label: 'Instructor courses',
    labelKey: 'navigation:instructorCourses',
  },
  {
    path: '/instructor/courses/:courseId/edit',
    label: 'Edit course',
    labelKey: 'routes:editCourseTitle',
  },
  {
    path: '/instructor/courses/:courseId/enrollments',
    label: 'Course enrollments',
    labelKey: 'routes:courseEnrollmentsTitle',
  },
  {
    path: '/instructor/lessons/:lessonId/edit',
    label: 'Edit lesson',
    labelKey: 'routes:editLessonTitle',
  },
];

export function cartReturnTarget(state: unknown): CartReturnTarget {
  const candidate = (state as CartNavigationState | null)?.returnTo;
  const returnTo =
    typeof candidate === 'string'
      ? sanitizeInternalReturnTo(candidate, globalThis.location?.origin)
      : null;
  if (!returnTo) return cartReturnFallback;

  const url = new URL(returnTo, globalThis.location?.origin ?? 'http://localhost');
  if (url.pathname === '/cart') return cartReturnFallback;
  if (url.pathname === '/') {
    return {
      label: 'Catalog',
      labelKey: 'navigation:catalog',
      to: { pathname: url.pathname, search: url.search, hash: url.hash },
    };
  }

  const route = cartReturnRoutes.find(({ path }) => matchPath({ path, end: true }, url.pathname));
  if (!route) return cartReturnFallback;
  return {
    label: route.label,
    labelKey: route.labelKey,
    to: { pathname: url.pathname, search: url.search, hash: url.hash },
  };
}
