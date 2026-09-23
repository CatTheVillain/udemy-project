import { useEffect, useState } from 'react';

import type { HeaderViewportFacts } from './app-shell-types';

const STUDENT_MOBILE_QUERY = '(max-width: 767.98px)';
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)';

/** Owns the header's responsive media subscriptions and their cleanup. */
export function useAppShellHeaderViewport(
  onMobileViewportChange: (matches: boolean) => void,
): HeaderViewportFacts {
  const [isStudentMobileViewport, setIsStudentMobileViewport] = useState(false);
  const [isTabletViewport, setIsTabletViewport] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(STUDENT_MOBILE_QUERY);
    const updateViewport = () => {
      setIsStudentMobileViewport(mediaQuery.matches);
      onMobileViewportChange(mediaQuery.matches);
    };
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, [onMobileViewportChange]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(TABLET_QUERY);
    const updateViewport = () => setIsTabletViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  return { isStudentMobileViewport, isTabletViewport };
}
