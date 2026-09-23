import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import learnHubBookMark from './assets/learnhub-book-ui018.png';
import { AnonymousTabletHeaderMenu } from './AnonymousTabletHeaderMenu';
import { AuthenticatedHeaderDrawerMenu } from './AuthenticatedHeaderDrawerMenu';
import type { HeaderPresentation } from './app-shell-types';
import { NavigationLinks } from './NavigationLinks';
import type { AppShellHeaderProps } from './app-shell-types';
import styles from './AppShell.module.css';

interface AppShellHeaderStartSectionProps {
  readonly header: AppShellHeaderProps;
  readonly presentation: HeaderPresentation;
}

export function AppShellHeaderStartSection({
  header,
  presentation,
}: AppShellHeaderStartSectionProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.headerCatalogStart}>
      <Link
        className={styles.brand}
        to={presentation.isInstructor ? '/instructor/courses' : '/'}
        aria-label={t('a11y:learnHubHome')}
      >
        <img alt="" aria-hidden="true" className={styles.brandMark} src={learnHubBookMark} />
        <span className={styles.brandWordmark}>LearnHub</span>
      </Link>
      {!presentation.isStudentMobile ? (
        <nav
          className={
            presentation.hasDesktopAuthActions && !presentation.isAnonymous
              ? [styles.navDesktop, styles.navDesktopSplit].join(' ')
              : styles.navDesktop
          }
          aria-label={t('a11y:primaryNavigation')}
        >
          <NavigationLinks
            items={presentation.desktopPrimaryNavigation}
            showPrimaryNavigationIndicator
          />
          {presentation.hasDesktopAuthActions && !presentation.isAnonymous ? (
            <div className={styles.navAuthActions}>
              <NavigationLinks items={presentation.desktopAuthActions} />
            </div>
          ) : null}
        </nav>
      ) : null}
      <AuthenticatedHeaderDrawerMenu
        currentLocation={presentation.currentLocation}
        isInstructorCoursesRoute={presentation.isInstructorCoursesRoute}
        mainRef={header.mainRef}
        navigation={presentation.navigation}
        onCreateCourse={header.onCreateCourse}
        onLogOut={header.onLogOut}
        routeFocusIdentity={header.routeFocusIdentity}
        state={header.state}
        visible={presentation.isAuthenticatedTablet}
      />
      <AnonymousTabletHeaderMenu
        currentLocation={presentation.currentLocation}
        navigation={presentation.navigation}
        onNavigate={header.onRequestMainFocus}
        visible={presentation.isAnonymousTablet}
      />
    </div>
  );
}
