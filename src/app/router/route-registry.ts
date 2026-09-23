import { matchRoutes } from 'react-router-dom';

import type { UserRole } from '../../entities/user';
import type { DensityMode } from '../../shared/ui/theme';

export type PageId =
  | 'PAGE-001'
  | 'PAGE-002'
  | 'PAGE-003'
  | 'PAGE-004'
  | 'PAGE-005'
  | 'PAGE-006'
  | 'PAGE-007'
  | 'PAGE-008'
  | 'PAGE-009'
  | 'PAGE-010'
  | 'PAGE-011'
  | 'PAGE-012'
  | 'PAGE-013'
  | 'PAGE-014'
  | 'PAGE-015';

const PAGE_IDS = [
  'PAGE-001',
  'PAGE-002',
  'PAGE-003',
  'PAGE-004',
  'PAGE-005',
  'PAGE-006',
  'PAGE-007',
  'PAGE-008',
  'PAGE-009',
  'PAGE-010',
  'PAGE-011',
  'PAGE-012',
  'PAGE-013',
  'PAGE-014',
  'PAGE-015',
] as const satisfies readonly PageId[];

export type RouteAccess = 'public' | 'guest' | Extract<UserRole, 'student' | 'instructor'>;
export type RouteLayout = 'public' | 'auth' | 'workspace';
export type RouteTitleKey = `common:${string}` | `navigation:${string}` | `routes:${string}`;

export interface AppRouteDefinition {
  id: PageId;
  path: string;
  title: string;
  description: string;
  titleKey: RouteTitleKey;
  access: RouteAccess;
  layout: RouteLayout;
}

export const APP_ROUTES = [
  {
    id: 'PAGE-001',
    path: '/',
    title: 'Course catalog',
    description: 'Browse and discover available courses.',
    titleKey: 'routes:courseCatalogTitle',
    access: 'public',
    layout: 'public',
  },
  {
    id: 'PAGE-002',
    path: '/courses/:courseId',
    title: 'Course details',
    description: 'Review course information and lessons.',
    titleKey: 'routes:courseDetailsTitle',
    access: 'public',
    layout: 'public',
  },
  {
    id: 'PAGE-003',
    path: '/signup',
    title: 'Create account',
    description: 'Create a LearnHub account to start learning or teaching.',
    titleKey: 'routes:createAccountTitle',
    access: 'guest',
    layout: 'auth',
  },
  {
    id: 'PAGE-004',
    path: '/login',
    title: 'Log in',
    description: 'Access your learning or instructor workspace.',
    titleKey: 'navigation:logIn',
    access: 'guest',
    layout: 'auth',
  },
  {
    id: 'PAGE-005',
    path: '/forgot-password',
    title: 'Forgot password',
    description: 'Request help signing back in to your account.',
    titleKey: 'routes:forgotPasswordTitle',
    access: 'guest',
    layout: 'auth',
  },
  {
    id: 'PAGE-006',
    path: '/reset-password',
    title: 'Reset password',
    description: 'Choose a new password for your account.',
    titleKey: 'routes:resetPasswordTitle',
    access: 'guest',
    layout: 'auth',
  },
  {
    id: 'PAGE-007',
    path: '/cart',
    title: 'Cart',
    description: 'Your selected courses will appear here.',
    titleKey: 'common:cart',
    access: 'student',
    layout: 'workspace',
  },
  {
    id: 'PAGE-008',
    path: '/learning',
    title: 'My learning',
    description: 'Your course enrollments will appear here.',
    titleKey: 'navigation:myLearning',
    access: 'student',
    layout: 'workspace',
  },
  {
    id: 'PAGE-009',
    path: '/learning/enrollments/:enrollmentId',
    title: 'Learning details',
    description: 'Course progress and lessons will appear here.',
    titleKey: 'routes:learningDetailsTitle',
    access: 'student',
    layout: 'workspace',
  },
  {
    id: 'PAGE-014',
    path: '/learning/enrollments/:enrollmentId/ai-chat',
    title: 'Course assistant',
    description: 'Ask questions about an active course.',
    titleKey: 'routes:courseAssistantTitle',
    access: 'student',
    layout: 'workspace',
  },
  {
    id: 'PAGE-015',
    path: '/ai-chat',
    title: 'AI assistant',
    description: 'Ask general learning questions.',
    titleKey: 'routes:aiAssistantTitle',
    access: 'student',
    layout: 'workspace',
  },
  {
    id: 'PAGE-010',
    path: '/instructor/courses',
    title: 'Instructor courses',
    description: 'Your authored courses will appear here.',
    titleKey: 'navigation:instructorCourses',
    access: 'instructor',
    layout: 'workspace',
  },
  {
    id: 'PAGE-011',
    path: '/instructor/courses/:courseId/edit',
    title: 'Edit course',
    description: 'Course and lesson editing will appear here.',
    titleKey: 'routes:editCourseTitle',
    access: 'instructor',
    layout: 'workspace',
  },
  {
    id: 'PAGE-012',
    path: '/instructor/courses/:courseId/enrollments',
    title: 'Course enrollments',
    description: 'The selected course roster will appear here.',
    titleKey: 'routes:courseEnrollmentsTitle',
    access: 'instructor',
    layout: 'workspace',
  },
  {
    id: 'PAGE-013',
    path: '/instructor/lessons/:lessonId/edit',
    title: 'Edit lesson',
    description: 'Lesson metadata and upload tools will appear here.',
    titleKey: 'routes:editLessonTitle',
    access: 'instructor',
    layout: 'workspace',
  },
] as const satisfies readonly AppRouteDefinition[];

export function hasEveryRouteId(
  routeById: Partial<Record<PageId, AppRouteDefinition>>,
): routeById is Record<PageId, AppRouteDefinition> {
  return PAGE_IDS.every((pageId) => routeById[pageId] !== undefined);
}

const mutableRouteById = APP_ROUTES.reduce<Partial<Record<PageId, AppRouteDefinition>>>(
  (routeById, route) => {
    routeById[route.id] = route;
    return routeById;
  },
  {},
);

if (!hasEveryRouteId(mutableRouteById)) throw new Error('Route ID registry is incomplete.');

export const APP_ROUTE_BY_ID = Object.freeze(mutableRouteById);

export function routeForPath(pathname: string): AppRouteDefinition | undefined {
  // Keep metadata lookup aligned with the rendered router's ranking and path-decoding semantics.
  return matchRoutes([...APP_ROUTES], pathname)?.[0]?.route;
}

export function densityForPath(pathname: string): DensityMode {
  return routeForPath(pathname)?.layout === 'workspace' ? 'workspace' : 'marketplace';
}

export function homeForRole(role: UserRole): string {
  if (role === 'student') return APP_ROUTE_BY_ID['PAGE-008'].path;
  if (role === 'instructor') return APP_ROUTE_BY_ID['PAGE-010'].path;
  return APP_ROUTE_BY_ID['PAGE-001'].path;
}
