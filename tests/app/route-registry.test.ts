import { describe, expect, it } from 'vitest';
import { matchPath, matchRoutes } from 'react-router-dom';

import registry from '../../localization/corpus/registry.json';
import {
  APP_ROUTE_BY_ID,
  APP_ROUTES,
  densityForPath,
  homeForRole,
  routeForPath,
} from '../../src/app/router';
import {
  hasEveryRouteId,
  type AppRouteDefinition,
  type PageId,
} from '../../src/app/router/route-registry';

interface ExpectedRouteTitleBinding {
  readonly id: (typeof APP_ROUTES)[number]['id'];
  readonly titleKey: (typeof APP_ROUTES)[number]['titleKey'];
}

const MLUX_003_EXPECTED_ROUTE_TITLE_BINDINGS: readonly ExpectedRouteTitleBinding[] = [
  { id: 'PAGE-001', titleKey: 'routes:courseCatalogTitle' },
  { id: 'PAGE-002', titleKey: 'routes:courseDetailsTitle' },
  { id: 'PAGE-003', titleKey: 'routes:createAccountTitle' },
  { id: 'PAGE-004', titleKey: 'navigation:logIn' },
  { id: 'PAGE-005', titleKey: 'routes:forgotPasswordTitle' },
  { id: 'PAGE-006', titleKey: 'routes:resetPasswordTitle' },
  { id: 'PAGE-007', titleKey: 'common:cart' },
  { id: 'PAGE-008', titleKey: 'navigation:myLearning' },
  { id: 'PAGE-009', titleKey: 'routes:learningDetailsTitle' },
  { id: 'PAGE-014', titleKey: 'routes:courseAssistantTitle' },
  { id: 'PAGE-015', titleKey: 'routes:aiAssistantTitle' },
  { id: 'PAGE-010', titleKey: 'navigation:instructorCourses' },
  { id: 'PAGE-011', titleKey: 'routes:editCourseTitle' },
  { id: 'PAGE-012', titleKey: 'routes:courseEnrollmentsTitle' },
  { id: 'PAGE-013', titleKey: 'routes:editLessonTitle' },
];

const INSTALLED_ROUTER_ROUTES = APP_ROUTES.map(({ id, path }) => ({ id, path }));

function installedRouterRouteId(location: URL): string | undefined {
  const matches = matchRoutes(INSTALLED_ROUTER_ROUTES, {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
  });

  return matches?.[matches.length - 1]?.route.id;
}

function routeBindingViolations(bindings: readonly ExpectedRouteTitleBinding[]): readonly string[] {
  const expectedById = new Map(
    MLUX_003_EXPECTED_ROUTE_TITLE_BINDINGS.map(({ id, titleKey }) => [id, titleKey]),
  );
  const violations: string[] = [];

  for (const { id, titleKey } of bindings) {
    if (expectedById.get(id) !== titleKey) {
      violations.push(`${id} must use ${expectedById.get(id)}`);
    }
  }

  return violations;
}

describe('application route registry', () => {
  it('matches every installed PAGE-to-path/access/layout row', () => {
    expect(
      APP_ROUTES.map(({ id, path, access, layout }) => ({ id, path, access, layout })),
    ).toEqual([
      { id: 'PAGE-001', path: '/', access: 'public', layout: 'public' },
      { id: 'PAGE-002', path: '/courses/:courseId', access: 'public', layout: 'public' },
      { id: 'PAGE-003', path: '/signup', access: 'guest', layout: 'auth' },
      { id: 'PAGE-004', path: '/login', access: 'guest', layout: 'auth' },
      { id: 'PAGE-005', path: '/forgot-password', access: 'guest', layout: 'auth' },
      { id: 'PAGE-006', path: '/reset-password', access: 'guest', layout: 'auth' },
      { id: 'PAGE-007', path: '/cart', access: 'student', layout: 'workspace' },
      { id: 'PAGE-008', path: '/learning', access: 'student', layout: 'workspace' },
      {
        id: 'PAGE-009',
        path: '/learning/enrollments/:enrollmentId',
        access: 'student',
        layout: 'workspace',
      },
      {
        id: 'PAGE-014',
        path: '/learning/enrollments/:enrollmentId/ai-chat',
        access: 'student',
        layout: 'workspace',
      },
      { id: 'PAGE-015', path: '/ai-chat', access: 'student', layout: 'workspace' },
      { id: 'PAGE-010', path: '/instructor/courses', access: 'instructor', layout: 'workspace' },
      {
        id: 'PAGE-011',
        path: '/instructor/courses/:courseId/edit',
        access: 'instructor',
        layout: 'workspace',
      },
      {
        id: 'PAGE-012',
        path: '/instructor/courses/:courseId/enrollments',
        access: 'instructor',
        layout: 'workspace',
      },
      {
        id: 'PAGE-013',
        path: '/instructor/lessons/:lessonId/edit',
        access: 'instructor',
        layout: 'workspace',
      },
    ]);
    expect(new Set(APP_ROUTES.map((route) => route.path)).size).toBe(15);
    expect(APP_ROUTES.map((route) => String(route.path))).not.toContain('/admin');
    expect(Object.keys(APP_ROUTE_BY_ID)).toHaveLength(15);
    expect('PAGE-014' in APP_ROUTE_BY_ID).toBe(true);
    expect('PAGE-015' in APP_ROUTE_BY_ID).toBe(true);
  });

  it('rejects a same-cardinality route map that replaces a registered PageId', () => {
    const missingPageId: PageId = 'PAGE-015';
    const routeById: Partial<Record<PageId, AppRouteDefinition>> = {};

    for (const route of APP_ROUTES) {
      if (route.id !== missingPageId) routeById[route.id] = route;
    }
    Object.defineProperty(routeById, 'PAGE-999', {
      enumerable: true,
      value: APP_ROUTES[0],
    });

    expect(Object.keys(routeById)).toHaveLength(APP_ROUTES.length);
    expect(hasEveryRouteId(routeById)).toBe(false);
    expect(hasEveryRouteId(APP_ROUTE_BY_ID)).toBe(true);
  });

  it('keeps every registered page bound to an independently enumerated canonical title key', () => {
    const bindings = APP_ROUTES.map(({ id, titleKey }) => ({ id, titleKey }));
    const mappedLocaleKeys = new Set(
      registry.units
        .filter(({ unitLifecycle }) => unitLifecycle === 'active')
        .map(({ namespace, key }) => `${namespace}:${key}`),
    );

    expect(bindings).toEqual(MLUX_003_EXPECTED_ROUTE_TITLE_BINDINGS);
    expect(routeBindingViolations(bindings)).toEqual([]);
    for (const { titleKey } of MLUX_003_EXPECTED_ROUTE_TITLE_BINDINGS) {
      expect(mappedLocaleKeys).toContain(titleKey);
    }
  });

  it('rejects a wrong registered route title binding', () => {
    const mutatedBindings = APP_ROUTES.map(({ id, titleKey }) =>
      id === 'PAGE-001' ? { id, titleKey: 'routes:courseDetailsTitle' as const } : { id, titleKey },
    );

    expect(routeBindingViolations(mutatedBindings)).toEqual([
      'PAGE-001 must use routes:courseCatalogTitle',
    ]);
  });

  it('uses role-correct homes without inventing an admin workspace', () => {
    expect(homeForRole('student')).toBe('/learning');
    expect(homeForRole('instructor')).toBe('/instructor/courses');
    expect(homeForRole('admin')).toBe('/');
  });

  it('derives density from the matched route metadata', () => {
    expect(routeForPath('/courses/course-42')?.id).toBe('PAGE-002');
    expect(routeForPath('/instructor/courses/course-42/edit')?.id).toBe('PAGE-011');
    expect(densityForPath('/')).toBe('marketplace');
    expect(densityForPath('/login')).toBe('marketplace');
    expect(densityForPath('/learning')).toBe('workspace');
    expect(densityForPath('/instructor/courses/course-42/enrollments')).toBe('workspace');
    expect(densityForPath('/unknown')).toBe('marketplace');
  });

  it.each([
    ['/LOGIN', 'PAGE-004'],
    ['/login/', 'PAGE-004'],
    ['/Learning/', 'PAGE-008'],
    ['/instructor/COURSES', 'PAGE-010'],
    ['/instructor/courses/ABC/edit/', 'PAGE-011'],
    ['/instructor/courses/a%2Fb/enrollments', 'PAGE-012'],
  ] as const)('matches installed Router semantics for %s', (pathname, expectedId) => {
    expect(routeForPath(pathname)?.id).toBe(expectedId);
  });

  it.each([
    '/LOGIN',
    '/login/',
    '/courses/%E2%9C%93',
    '/courses/%E0%A4%A',
    '/instructor/courses',
    '/instructor/courses/course%2F42/edit',
    '/instructor/courses/course%2F42/enrollments',
    '/instructor/courses/42',
    '/login?returnTo=%2Fcart#recovery',
    '/instructor/courses?tab=drafts#overview',
    '/does-not-exist?returnTo=%2Flearning#missing',
  ] as const)(
    'keeps registry metadata in parity with installed Router matching for %s',
    (target) => {
      const location = new URL(target, 'https://learnhub.test');

      expect(routeForPath(location.pathname)?.id).toBe(installedRouterRouteId(location));
    },
  );

  it('keeps encoded login recovery and instructor workspace metadata distinct', () => {
    expect(routeForPath('/l%6Fgin')).toMatchObject({
      id: 'PAGE-004',
      access: 'guest',
      layout: 'auth',
    });
    expect(densityForPath('/l%6Fgin')).toBe('marketplace');
    expect(routeForPath('/instruct%6Fr/courses')).toMatchObject({
      id: 'PAGE-010',
      access: 'instructor',
      layout: 'workspace',
    });
    expect(densityForPath('/instruct%6Fr/courses')).toBe('workspace');
  });

  it.each(['/login/help', '/learning/enrollments/42/extra', '/instructor/courses/42'])(
    'keeps exact-ended nonmatches for %s',
    (pathname) => {
      expect(routeForPath(pathname)).toBeUndefined();
    },
  );

  it('uses React Router semantics for canonical, case, trailing-slash, and parameter variants', () => {
    for (const route of APP_ROUTES) {
      const canonical = route.path.replace(/:[^/]+/g, 'Example-42');
      const variants =
        canonical === '/'
          ? ['/']
          : [canonical, canonical.toUpperCase(), `${canonical}/`, `${canonical}//`];

      for (const pathname of variants) {
        expect(
          matchPath({ path: route.path, end: true }, pathname),
          `${route.id}: ${pathname}`,
        ).not.toBe(null);
        expect(routeForPath(pathname)?.id, pathname).toBe(route.id);
      }
    }

    expect(routeForPath('/learning/enrollments/42/extra')).toBeUndefined();
    expect(routeForPath('/instructor/courses//edit')).toBeUndefined();
  });
});
