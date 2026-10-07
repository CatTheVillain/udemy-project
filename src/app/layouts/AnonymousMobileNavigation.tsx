import { LibraryBig, LogIn, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import styles from './AppShell.module.css';

export function AnonymousMobileNavigation() {
  const { t } = useTranslation();
  return (
    <nav className={styles.anonymousMobileNavigation} aria-label={t('a11y:anonymousNavigation')}>
      <NavLink className={styles.anonymousMobileNavigationLink} end to="/">
        <LibraryBig aria-hidden="true" focusable="false" size={20} />
        <span>{t('navigation:catalog')}</span>
      </NavLink>
      <NavLink className={styles.anonymousMobileNavigationLink} end to="/login">
        <LogIn aria-hidden="true" focusable="false" size={20} />
        <span>{t('navigation:logIn')}</span>
      </NavLink>
      <NavLink className={styles.anonymousMobileNavigationLink} end to="/signup">
        <UserPlus aria-hidden="true" focusable="false" size={20} />
        <span>{t('navigation:signUp')}</span>
      </NavLink>
    </nav>
  );
}
