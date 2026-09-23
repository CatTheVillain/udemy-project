import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionState } from '@features/auth-session';
import { VisuallyHidden } from '@shared/ui/primitives';

import { AuthenticatedTabletDrawer } from './AuthenticatedTabletDrawer';
import { focusInstructorCourseTitle } from './app-shell-focus';
import type { NavigationItem } from './app-shell-navigation';
import styles from './AppShell.module.css';

const INSTRUCTOR_COURSE_TITLE_ID = 'instructor-course-title';

interface AuthenticatedHeaderDrawerMenuProps {
  readonly currentLocation: string;
  readonly isInstructorCoursesRoute: boolean;
  readonly mainRef: React.RefObject<HTMLElement>;
  readonly navigation: readonly NavigationItem[];
  readonly onCreateCourse: () => void;
  readonly onLogOut: () => void;
  readonly routeFocusIdentity: string;
  readonly state: SessionState;
  readonly visible: boolean;
}

export function AuthenticatedHeaderDrawerMenu({
  currentLocation,
  isInstructorCoursesRoute,
  mainRef,
  navigation,
  onCreateCourse,
  onLogOut,
  routeFocusIdentity,
  state,
  visible,
}: AuthenticatedHeaderDrawerMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  useEffect(() => {
    setOpen(false);
  }, [currentLocation]);

  if (!visible || state.status !== 'authenticated') return null;
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
        aria-controls={open ? 'authenticated-tablet-navigation' : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={styles.menuButton}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <Menu aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
        <VisuallyHidden>
          {open ? t('a11y:closeNavigation') : t('a11y:openNavigation')}
        </VisuallyHidden>
      </button>
      <AuthenticatedTabletDrawer
        navigation={navigation}
        onClose={() => setOpen(false)}
        onCreateCourse={isInstructorCoursesRoute ? focusCourseTitle : undefined}
        onLogOut={onLogOut}
        onNavigate={(to) => {
          if (to === routeFocusIdentity) triggerRef.current?.focus();
          else mainRef.current?.focus({ preventScroll: true });
        }}
        open={open}
        user={state.user}
      />
    </>
  );
}
