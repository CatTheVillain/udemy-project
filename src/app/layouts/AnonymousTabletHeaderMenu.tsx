import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { VisuallyHidden } from '@shared/ui/primitives';

import { scheduleAppShellFocus } from './app-shell-focus';
import type { NavigationItem } from './app-shell-navigation';
import { NavigationLinks } from './NavigationLinks';
import styles from './AppShell.module.css';

interface AnonymousTabletHeaderMenuProps {
  readonly currentLocation: string;
  readonly navigation: readonly NavigationItem[];
  readonly onNavigate: (to: string) => void;
  readonly visible: boolean;
}

export function AnonymousTabletHeaderMenu({
  currentLocation,
  navigation,
  onNavigate,
  visible,
}: AnonymousTabletHeaderMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  useEffect(() => {
    setOpen(false);
  }, [currentLocation]);
  useEffect(() => {
    if (!open || !visible) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [open, visible]);

  if (!visible) return null;
  const closeForRoute = (to: string) => {
    setOpen(false);
    onNavigate(to);
  };
  const closeToTrigger = () => {
    setOpen(false);
    scheduleAppShellFocus(() => triggerRef.current?.focus());
  };

  return (
    <div
      ref={anchorRef}
      className={styles.tabletMenuAnchor}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          closeToTrigger();
        }
      }}
    >
      <button
        ref={triggerRef}
        aria-controls="tablet-navigation-menu"
        aria-expanded={open}
        className={styles.menuButton}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <Menu aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
        <VisuallyHidden>
          {open ? t('a11y:closeNavigation') : t('a11y:openNavigation')}
        </VisuallyHidden>
      </button>
      {open ? (
        <nav
          id="tablet-navigation-menu"
          className={styles.tabletMenuPopover}
          aria-label={t('a11y:mobileNavigation')}
        >
          <NavigationLinks items={navigation} onNavigate={closeForRoute} />
        </nav>
      ) : null}
    </div>
  );
}
