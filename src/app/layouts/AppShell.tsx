import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import type { Cart } from '@entities/cart';
import { useSession } from '@features/auth-session';
import { requestInstructorCourseCreateDisclosure } from '@features/instructor-courses';
import { cartQueryKey, requestCart } from '@features/cart-workflow';
import { parseCatalogQuery } from '@features/catalog-discovery';
import { useDensityMode } from '@shared/ui/theme';
import { CourseChatLauncher } from '@widgets/course-chat';

import { AppShellHeader } from './app-shell-header';
import type { CatalogSearchFocusIntent } from './catalog-header-search-types';
import { useAppShellRouteFocus } from './app-shell-route-focus';
import { useAppShellScrollRestoration } from './app-shell-scroll-restoration';
import { AnonymousMobileNavigation } from './AnonymousMobileNavigation';
import { StudentMobileNavigation } from './StudentMobileNavigation';
import { densityForPath, routeForPath } from '../router/route-registry';
import styles from './AppShell.module.css';

const INSTRUCTOR_COURSES_HEADING_ID = 'your-courses-heading';

export function AppShell() {
  const { t } = useTranslation();
  const session = useSession();
  const { cacheEpoch, clearSession, state } = session;
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const mainRef = useRef<HTMLElement>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [isStudentMobileViewport, setIsStudentMobileViewport] = useState(false);
  const [catalogSearchFocusIntent, setCatalogSearchFocusIntent] =
    useState<CatalogSearchFocusIntent | null>(null);
  const catalogQuery = useMemo(
    () => parseCatalogQuery(new URLSearchParams(location.search)),
    [location.search],
  );
  const route = routeForPath(location.pathname);
  const layout = route?.layout ?? 'public';
  const isCatalogRoute = route?.id === 'PAGE-001';
  const isInstructorCoursesRoute = route?.id === 'PAGE-010';
  const isStudentMobile =
    isStudentMobileViewport && state.status === 'authenticated' && state.user.role === 'student';
  const isAnonymousMobile = isStudentMobileViewport && state.status !== 'authenticated';
  const cartSubject =
    state.status === 'authenticated' && state.user.role === 'student' ? (cacheEpoch ?? null) : null;
  const cart = useQuery<Cart>({
    queryKey: cartSubject ? cartQueryKey(cartSubject) : ['disabled', 'app-shell-cart'],
    queryFn: ({ signal }) => requestCart(session, signal),
    enabled: cartSubject !== null,
  });
  const { densityMode, setDensityMode } = useDensityMode();
  const routeDensityMode = densityForPath(location.pathname);
  const currentLocation = `${location.pathname}${location.search}${location.hash}`;
  const catalogSearchLocationIdentity = `${location.key}:${currentLocation}`;
  const routeFocusIdentity = `${location.pathname}${location.search}`;
  const hasGlobalAssistant =
    route !== undefined && new Set(['PAGE-001', 'PAGE-002', 'PAGE-007', 'PAGE-008']).has(route.id);
  const globalAssistant =
    state.status === 'authenticated' && state.user.role === 'student'
      ? { context: { kind: 'general' as const } }
      : null;

  const requestLogout = useCallback(() => {
    setLogoutPending(true);
    navigate('/', { replace: true, flushSync: true });
  }, [navigate]);
  const requestInstructorCourseCreate = useCallback(
    () => requestInstructorCourseCreateDisclosure(),
    [],
  );

  useEffect(() => {
    if (!logoutPending || location.pathname !== '/') return;
    clearSession();
    setLogoutPending(false);
  }, [clearSession, location.pathname, logoutPending]);
  useLayoutEffect(() => {
    if (densityMode !== routeDensityMode) setDensityMode(routeDensityMode);
  }, [densityMode, routeDensityMode, setDensityMode]);
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const root = document.documentElement;
    const main = mainRef.current;
    const syncAuthScrollbarOffset = () => {
      const rootRect = root.getBoundingClientRect();
      const isRendered =
        Number.isFinite(rootRect.left) &&
        Number.isFinite(rootRect.right) &&
        Number.isFinite(rootRect.width) &&
        rootRect.width > 0;
      const signedOffset = isRendered
        ? window.innerWidth / 2 - (rootRect.left + rootRect.right) / 2
        : 0;
      main?.style.setProperty(
        '--auth-physical-scrollbar-offset',
        `${Number.isFinite(signedOffset) ? signedOffset : 0}px`,
      );
    };
    const directionObserver = new MutationObserver(syncAuthScrollbarOffset);
    directionObserver.observe(root, { attributes: true, attributeFilter: ['dir'] });
    window.addEventListener('resize', syncAuthScrollbarOffset);
    syncAuthScrollbarOffset();
    return () => {
      window.removeEventListener('resize', syncAuthScrollbarOffset);
      directionObserver.disconnect();
      main?.style.removeProperty('--auth-physical-scrollbar-offset');
    };
  }, []);

  useAppShellScrollRestoration({ location, navigationType });
  const requestMobileMenuMainFocus = useAppShellRouteFocus({
    catalogSearchFocusIntent,
    catalogSearchLocationIdentity,
    currentLocation,
    headingId: INSTRUCTOR_COURSES_HEADING_ID,
    initialPathname: location.pathname,
    mainRef,
    routeFocusIdentity,
  });

  return (
    <div className={styles.shell} data-layout={layout}>
      <a className={styles.skipLink} href="#main-content">
        {t('a11y:skipToMainContent')}
      </a>
      <AppShellHeader
        cartItemCount={cart.data?.itemCount}
        catalogQuery={catalogQuery}
        focusIntent={catalogSearchFocusIntent}
        location={location}
        mainRef={mainRef}
        onCatalogSearchFocusIntentChange={setCatalogSearchFocusIntent}
        onCreateCourse={requestInstructorCourseCreate}
        onLogOut={requestLogout}
        onMobileViewportChange={setIsStudentMobileViewport}
        onRequestMainFocus={requestMobileMenuMainFocus}
        routeFocusIdentity={routeFocusIdentity}
        state={state}
      />
      <main
        ref={mainRef}
        className={[
          styles.main,
          isCatalogRoute ? styles.mainCatalog : null,
          isInstructorCoursesRoute ? styles.mainInstructorCourses : null,
          layout === 'workspace' ? styles.mainWorkspace : null,
          layout === 'auth' ? styles.mainAuth : null,
        ]
          .filter(Boolean)
          .join(' ')}
        id="main-content"
        tabIndex={-1}
      >
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <span>{t('common:footerCopyright')}</span>
        <span>{t('common:footerTagline')}</span>
      </footer>
      {hasGlobalAssistant && globalAssistant !== null && !isStudentMobile ? (
        <CourseChatLauncher assistant={globalAssistant} />
      ) : null}
      {isStudentMobile ? <StudentMobileNavigation itemCount={cart.data?.itemCount} /> : null}
      {isAnonymousMobile ? <AnonymousMobileNavigation /> : null}
    </div>
  );
}
