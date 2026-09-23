import { Bot, GraduationCap, LibraryBig, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';

import { assistantNavigationTarget, cartNavigationState } from './app-shell-navigation';
import { presentCart } from './navigation-presentation';
import type { StudentMobileNavigationProps } from './navigation-types';
import styles from './AppShell.module.css';

export function StudentMobileNavigation({ itemCount }: StudentMobileNavigationProps) {
  const location = useLocation();
  const assistantTarget = assistantNavigationTarget(location);
  const cartState = cartNavigationState(location);
  const cartPresentation = presentCart(itemCount);
  const { t } = useTranslation();
  return (
    <nav className={styles.studentMobileNavigation} aria-label={t('a11y:studentNavigation')}>
      <NavLink className={styles.studentMobileNavigationLink} end to="/">
        <LibraryBig aria-hidden="true" focusable="false" size={20} />
        <span>{t('navigation:catalog')}</span>
      </NavLink>
      <NavLink className={styles.studentMobileNavigationLink} end to="/learning">
        <GraduationCap aria-hidden="true" focusable="false" size={20} />
        <span>{t('navigation:myLearning')}</span>
      </NavLink>
      <NavLink
        className={styles.studentMobileNavigationLink}
        end
        state={assistantTarget.state}
        to={assistantTarget.to}
      >
        <Bot aria-hidden="true" focusable="false" size={20} />
        <span>{t('common:aiChat')}</span>
      </NavLink>
      <NavLink
        aria-label={
          cartPresentation.badge
            ? t('a11y:cart', { cartCount: cartPresentation.badge })
            : t('common:cart')
        }
        className={styles.studentMobileNavigationLink}
        end
        state={cartState}
        to="/cart"
      >
        <span className={styles.studentMobileCartIcon}>
          <ShoppingCart aria-hidden="true" focusable="false" size={20} />
          {cartPresentation.badge ? (
            <span className={styles.studentMobileCartBadge}>{cartPresentation.badge}</span>
          ) : null}
        </span>
        <span>{t('common:cart')}</span>
      </NavLink>
    </nav>
  );
}
