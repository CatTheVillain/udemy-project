import { Bot, ChevronRight, LogOut, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';

import { AccountIdentity } from './AccountMenu';
import { assistantNavigationTarget, isCurrentTabNavigation } from './app-shell-navigation';
import { scheduleAppShellFocus } from './app-shell-focus';
import { NavigationLinks } from './NavigationLinks';
import type { AuthenticatedTabletDrawerProps, DrawerAfterCloseAction } from './navigation-types';
import { Dialog, VisuallyHidden } from '@shared/ui/primitives';
import styles from './AppShell.module.css';

const AUTHENTICATED_TABLET_DRAWER_EXIT_DURATION_MS = 180;

export function AuthenticatedTabletDrawer({
  navigation,
  onClose,
  onCreateCourse,
  onLogOut,
  onNavigate,
  open,
  user,
}: AuthenticatedTabletDrawerProps) {
  const { t } = useTranslation();
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);
  const afterCloseActionRef = useRef<DrawerAfterCloseAction>(undefined);
  const roleLabel =
    user.role === 'student'
      ? t('auth:student')
      : user.role === 'instructor'
        ? t('course:instructor')
        : t('auth:admin');
  const location = useLocation();
  const assistantTarget = assistantNavigationTarget(location);

  const runAfterCloseAction = useCallback(() => {
    const action = afterCloseActionRef.current;
    afterCloseActionRef.current = undefined;
    if (action) scheduleAppShellFocus(action);
  }, []);

  const closeForNavigation = useCallback(
    (to: string) => {
      afterCloseActionRef.current = () => onNavigate(to);
      onClose();
    },
    [onClose, onNavigate],
  );

  useEffect(() => {
    if (open) {
      afterCloseActionRef.current = undefined;
      setPresent(true);
      setClosing(false);
      return undefined;
    }
    if (!present) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(false);
      setClosing(false);
      runAfterCloseAction();
      return undefined;
    }

    setClosing(true);
    const timeoutId = window.setTimeout(() => {
      setPresent(false);
      setClosing(false);
      runAfterCloseAction();
    }, AUTHENTICATED_TABLET_DRAWER_EXIT_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open, present, runAfterCloseAction]);

  return (
    <Dialog
      className={[
        styles.authenticatedTabletDrawer,
        closing ? styles.authenticatedTabletDrawerClosing : null,
      ]
        .filter(Boolean)
        .join(' ')}
      closeContent={<X aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />}
      closeLabel={t('a11y:closeNavigation')}
      onClose={onClose}
      open={present}
      title={
        <>
          <VisuallyHidden>{t('common:menu')}</VisuallyHidden>
          <span aria-hidden="true">
            <AccountIdentity user={user} roleLabel={roleLabel} variant="drawerHeader" />
          </span>
        </>
      }
    >
      <nav
        aria-label={t('a11y:mobileNavigation')}
        className={styles.authenticatedTabletDrawerNavigation}
        id="authenticated-tablet-navigation"
      >
        <NavigationLinks items={navigation} onNavigate={closeForNavigation} showTrailingChevron />
        {user.role === 'student' ? (
          <NavLink
            className={({ isActive }) =>
              [styles.authenticatedTabletDrawerLink, isActive ? styles.navLinkActive : null]
                .filter(Boolean)
                .join(' ')
            }
            onClick={(event) => {
              if (isCurrentTabNavigation(event)) closeForNavigation(assistantTarget.to);
            }}
            state={assistantTarget.state}
            to={assistantTarget.to}
          >
            <span className={styles.authenticatedTabletDrawerLinkLabel}>
              <Bot aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
              {t('common:aiChat')}
            </span>
            <ChevronRight aria-hidden="true" focusable="false" size={16} />
          </NavLink>
        ) : null}
        {onCreateCourse ? (
          <button
            className={styles.authenticatedTabletDrawerAction}
            type="button"
            onClick={() => {
              afterCloseActionRef.current = onCreateCourse;
              onClose();
            }}
          >
            <span>{t('instructor:coursesCreateCourse')}</span>
            <ChevronRight aria-hidden="true" focusable="false" size={16} />
          </button>
        ) : null}
      </nav>
      <div className={styles.authenticatedTabletDrawerFooter}>
        <button className={styles.authenticatedTabletDrawerLogout} type="button" onClick={onLogOut}>
          <LogOut aria-hidden="true" focusable="false" size={18} />
          <span>{t('auth:logOut')}</span>
        </button>
      </div>
    </Dialog>
  );
}
