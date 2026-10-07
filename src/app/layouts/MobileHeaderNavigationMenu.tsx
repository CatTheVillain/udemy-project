import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { VisuallyHidden } from '@shared/ui/primitives';

import { focusInstructorCourseTitle, scheduleAppShellFocus } from './app-shell-focus';
import type { NavigationItem } from './app-shell-navigation';
import { NavigationLinks } from './NavigationLinks';
import styles from './AppShell.module.css';

const INSTRUCTOR_COURSE_TITLE_ID = 'instructor-course-title';

interface MobileHeaderNavigationMenuProps {
  readonly currentLocation: string;
  readonly isInstructorCoursesRoute: boolean;
  readonly navigation: readonly NavigationItem[];
  readonly onCreateCourse: () => void;
  readonly onRequestMainFocus: (destination: string | undefined) => void;
  readonly routeFocusIdentity: string;
  readonly visible: boolean;
}

export function MobileHeaderNavigationMenu({
  currentLocation,
  isInstructorCoursesRoute,
  navigation,
  onCreateCourse,
  onRequestMainFocus,
  routeFocusIdentity,
  visible,
}: MobileHeaderNavigationMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  useEffect(() => {
    setOpen(false);
  }, [currentLocation]);

  if (!visible) return null;
  const closeForRoute = (to: string) => {
    setOpen(false);
    if (to === routeFocusIdentity) {
      scheduleAppShellFocus(() => triggerRef.current?.focus());
      return;
    }
    onRequestMainFocus(to);
  };
  const closeToTrigger = () => {
    setOpen(false);
    scheduleAppShellFocus(() => triggerRef.current?.focus());
  };
  const focusCourseTitle = () => {
    setOpen(false);
    if (document.getElementById(INSTRUCTOR_COURSE_TITLE_ID)) {
      focusInstructorCourseTitle(INSTRUCTOR_COURSE_TITLE_ID);
      return;
    }
    onCreateCourse();
  };

  return (
    <>
      <button
        ref={triggerRef}
        aria-controls="mobile-navigation"
        aria-expanded={open}
        className={styles.menuButton}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeToTrigger();
          }
        }}
      >
        <Menu aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
        <VisuallyHidden>
          {open ? t('a11y:closeNavigation') : t('a11y:openNavigation')}
        </VisuallyHidden>
      </button>
      {open ? (
        <nav
          id="mobile-navigation"
          className={styles.navMobile}
          aria-label={t('a11y:mobileNavigation')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeToTrigger();
            }
          }}
        >
          {isInstructorCoursesRoute ? (
            <div className={styles.instructorCourseActions} data-part="instructor-course-actions">
              <NavigationLinks items={navigation} onNavigate={closeForRoute} />
              <button
                className={[styles.navLink, styles.navLinkPrimary, styles.navAction].join(' ')}
                type="button"
                onClick={focusCourseTitle}
              >
                {t('instructor:coursesCreateCourse')}
              </button>
            </div>
          ) : (
            <NavigationLinks items={navigation} onNavigate={closeForRoute} />
          )}
        </nav>
      ) : null}
    </>
  );
}
