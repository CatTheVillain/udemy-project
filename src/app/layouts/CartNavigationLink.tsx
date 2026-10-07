import { ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';

import { cartNavigationState } from './app-shell-navigation';
import { presentCart } from './navigation-presentation';
import type { CartNavigationLinkProps } from './navigation-types';
import styles from './AppShell.module.css';

export function CartNavigationLink({ itemCount }: CartNavigationLinkProps) {
  const presentation = presentCart(itemCount);
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <NavLink
      aria-label={
        presentation.badge ? t('a11y:cart', { cartCount: presentation.badge }) : t('common:cart')
      }
      className={({ isActive }) =>
        [styles.cartLink, isActive ? styles.cartLinkActive : null].filter(Boolean).join(' ')
      }
      end
      state={cartNavigationState(location)}
      to="/cart"
    >
      <ShoppingCart aria-hidden="true" focusable="false" size={25} strokeWidth={1.75} />
      {presentation.badge ? <span className={styles.cartBadge}>{presentation.badge}</span> : null}
    </NavLink>
  );
}
