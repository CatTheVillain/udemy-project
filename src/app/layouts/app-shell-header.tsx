import { useEffect, useMemo, useState } from 'react';

import { CatalogHeaderSearch } from './CatalogHeaderSearch';
import { AppShellHeaderEndSection } from './AppShellHeaderEndSection';
import { AppShellHeaderStartSection } from './AppShellHeaderStartSection';
import { useHeaderDisclosureControls } from './app-shell-disclosure';
import { presentAppShellHeader } from './app-shell-header-presentation';
import { useAppShellHeaderViewport } from './app-shell-header-viewport';
import type { AppShellHeaderProps } from './app-shell-types';
import styles from './AppShell.module.css';

/** Coordinates header sections; the root scroll-class seam remains local to this element. */
export function AppShellHeader(header: AppShellHeaderProps) {
  const viewport = useAppShellHeaderViewport(header.onMobileViewportChange);
  const presentation = useMemo(
    () => presentAppShellHeader(header.state, header.location, viewport),
    [header.location, header.state, viewport],
  );
  const disclosures = useHeaderDisclosureControls();
  const [isMobileCatalogScrolled, setIsMobileCatalogScrolled] = useState(false);

  useEffect(() => {
    if (!presentation.isCatalogRoute || !viewport.isStudentMobileViewport) {
      setIsMobileCatalogScrolled(false);
      return undefined;
    }
    const updateScrollState = () => setIsMobileCatalogScrolled(window.scrollY > 0);
    updateScrollState();
    window.addEventListener('scroll', updateScrollState, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollState);
  }, [presentation.isCatalogRoute, viewport.isStudentMobileViewport]);

  return (
    <header
      className={[
        styles.header,
        presentation.isCatalogRoute ? styles.headerCatalog : null,
        presentation.isAnonymous ? styles.headerAnonymous : null,
        presentation.hasCatalogSearch
          ? styles.headerWithCatalogSearch
          : styles.headerWithoutCatalogSearch,
        presentation.isCatalogRoute && presentation.isAnonymous
          ? styles.headerAnonymousCatalog
          : null,
        presentation.isInstructor ? styles.headerInstructorCourses : null,
        presentation.isAuthenticatedMobile ? styles.headerAuthenticatedMobile : null,
        presentation.isStudentMobile ? styles.headerStudentMobile : null,
        presentation.isAnonymousMobile ? styles.headerAnonymousMobile : null,
        presentation.isCatalogRoute && viewport.isStudentMobileViewport && isMobileCatalogScrolled
          ? styles.headerMobileSearchDetached
          : null,
      ]
        .filter(Boolean)
        .join(' ')}
      data-app-shell-header
    >
      <div className={styles.headerInner}>
        <AppShellHeaderStartSection header={header} presentation={presentation} />
        {presentation.hasCatalogSearch ? (
          <CatalogHeaderSearch
            catalogQuery={header.catalogQuery}
            focusIntent={header.focusIntent}
            isCatalogRoute={presentation.isCatalogRoute}
            location={header.location}
            onFocusIntentChange={header.onCatalogSearchFocusIntentChange}
          />
        ) : null}
        <AppShellHeaderEndSection
          disclosures={disclosures}
          header={header}
          presentation={presentation}
        />
      </div>
    </header>
  );
}
