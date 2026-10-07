import type { MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { isCurrentTabNavigation, type NavigationItemVariant } from './app-shell-navigation';
import { requestInstructorCoursesNewTabFocus as writeInstructorCoursesNewTabFocus } from './instructor-courses-focus-marker';
import type { NavigationLinksProps } from './navigation-types';
import { routeForPath } from '../router/route-registry';
import styles from './AppShell.module.css';

const INSTRUCTOR_COURSES_PATH = '/instructor/courses';

const NAVIGATION_VARIANT_CLASS: Record<NavigationItemVariant, string> = {
  'browse-link': styles.navLinkBrowse,
  'login-secondary': styles.navLinkLogin,
  'signup-primary': styles.navLinkSignup,
};

function isExplicitNewTabNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (event.defaultPrevented) return false;
  if (event.type === 'auxclick') return event.button === 1;
  const target = event.currentTarget.getAttribute('target');
  return (
    event.button === 0 &&
    (event.metaKey || event.ctrlKey || event.shiftKey || target?.toLowerCase() === '_blank') &&
    !event.currentTarget.hasAttribute('download')
  );
}

function requestInstructorCoursesNewTabFocus(
  event: MouseEvent<HTMLAnchorElement>,
  destination: string,
): void {
  if (destination !== INSTRUCTOR_COURSES_PATH || !isExplicitNewTabNavigation(event)) return;
  writeInstructorCoursesNewTabFocus({ destination, sourcePath: window.location.pathname });
}

export function NavigationLinks({
  items,
  onNavigate,
  showPrimaryNavigationIndicator = false,
  showTrailingChevron = false,
}: NavigationLinksProps) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <ul className={styles.navList}>
      {items.map((item) => {
        const isCatalogSection =
          item.to === '/' && routeForPath(location.pathname)?.id === 'PAGE-002';
        const className = (isActive: boolean) =>
          [
            styles.navLink,
            isActive || isCatalogSection ? styles.navLinkActive : null,
            showPrimaryNavigationIndicator && item.primaryNavigationIndicator
              ? styles.navLinkPrimary
              : null,
            item.to === '/' || item.to === '/learning' ? styles.navLinkPrimaryInteractive : null,
            item.variant ? NAVIGATION_VARIANT_CLASS[item.variant] : null,
          ]
            .filter(Boolean)
            .join(' ');
        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          requestInstructorCoursesNewTabFocus(event, item.to);
          if (isCurrentTabNavigation(event)) onNavigate?.(item.to);
        };
        const content = (
          <>
            {t(item.labelKey)}
            {showTrailingChevron ? (
              <ChevronRight aria-hidden="true" focusable="false" size={16} />
            ) : null}
          </>
        );
        return (
          <li key={item.to}>
            {isCatalogSection ? (
              <Link
                aria-current="location"
                className={className(true)}
                onAuxClick={(event) => requestInstructorCoursesNewTabFocus(event, item.to)}
                onClick={handleClick}
                to={item.to}
              >
                {content}
              </Link>
            ) : (
              <NavLink
                end={item.end}
                className={({ isActive }) => className(isActive)}
                onAuxClick={(event) => requestInstructorCoursesNewTabFocus(event, item.to)}
                onClick={handleClick}
                to={item.to}
              >
                {content}
              </NavLink>
            )}
          </li>
        );
      })}
    </ul>
  );
}
