import { useTranslation } from 'react-i18next';

import { LanguageSelector } from '@shared/locale';

import { AccountMenu } from './AccountMenu';
import { AiAssistantNavigationLink } from './AiAssistantNavigationLink';
import { AuthenticatedHeaderDrawerMenu } from './AuthenticatedHeaderDrawerMenu';
import { CartNavigationLink } from './CartNavigationLink';
import { focusInstructorCourseTitle } from './app-shell-focus';
import { MobileHeaderNavigationMenu } from './MobileHeaderNavigationMenu';
import { NavigationLinks } from './NavigationLinks';
import type {
  AppShellHeaderProps,
  HeaderDisclosureProps,
  HeaderPresentation,
} from './app-shell-types';
import styles from './AppShell.module.css';

const INSTRUCTOR_COURSE_TITLE_ID = 'instructor-course-title';

interface AppShellHeaderEndSectionProps {
  readonly disclosures: HeaderDisclosureProps;
  readonly header: AppShellHeaderProps;
  readonly presentation: HeaderPresentation;
}

export function AppShellHeaderEndSection({
  disclosures,
  header,
  presentation,
}: AppShellHeaderEndSectionProps) {
  const { t } = useTranslation();
  const focusCourseTitle = () => {
    if (document.getElementById(INSTRUCTOR_COURSE_TITLE_ID)) {
      focusInstructorCourseTitle(INSTRUCTOR_COURSE_TITLE_ID);
      return;
    }
    header.onCreateCourse();
  };
  const languageSelector = (
    <LanguageSelector
      className={[
        styles.languageSelector,
        presentation.isAnonymousMobile ? styles.languageSelectorMobile : null,
      ]
        .filter(Boolean)
        .join(' ')}
      menuClassName={styles.languageMenu}
      optionClassName={styles.languageOption}
      selectedOptionClassName={styles.languageOptionSelected}
      selectionIndicatorClassName={styles.languageRadio}
      mobile={presentation.isAnonymousMobile}
      exclusiveDisclosure={disclosures.language}
    />
  );
  const showMobileMenu =
    !presentation.isInstructor &&
    !presentation.isAnonymousMobile &&
    !presentation.isAnonymousTablet &&
    !presentation.isAuthenticatedTablet;

  return (
    <div className={styles.headerCatalogEnd}>
      {presentation.isInstructorCoursesRoute &&
      !presentation.isStudentMobile &&
      !presentation.isInstructorCompactDrawer &&
      !presentation.isAuthenticatedTablet ? (
        <button
          className={[styles.navLink, styles.navLinkPrimary, styles.navAction].join(' ')}
          type="button"
          onClick={focusCourseTitle}
        >
          {t('instructor:coursesCreateCourse')}
        </button>
      ) : null}
      {presentation.isStudentMobile && header.state.status === 'authenticated' ? (
        <>
          <AccountMenu
            user={header.state.user}
            onLogOut={header.onLogOut}
            exclusiveDisclosure={disclosures.account}
          />
          {languageSelector}
        </>
      ) : null}
      {!presentation.isStudentMobile &&
      header.state.status === 'authenticated' &&
      header.state.user.role === 'student' ? (
        <div className={styles.headerCartAccountGroup}>
          {!presentation.isAuthenticatedTablet ? <AiAssistantNavigationLink /> : null}
          <CartNavigationLink itemCount={header.cartItemCount} />
          {!presentation.isAuthenticatedTablet ? (
            <div className={styles.account}>
              <AccountMenu
                user={header.state.user}
                onLogOut={header.onLogOut}
                exclusiveDisclosure={disclosures.account}
              />
              <MobileHeaderNavigationMenu
                currentLocation={presentation.currentLocation}
                isInstructorCoursesRoute={presentation.isInstructorCoursesRoute}
                navigation={presentation.navigation}
                onCreateCourse={header.onCreateCourse}
                onRequestMainFocus={header.onRequestMainFocus}
                routeFocusIdentity={header.routeFocusIdentity}
                visible={showMobileMenu}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {!presentation.isStudentMobile &&
      !(header.state.status === 'authenticated' && header.state.user.role === 'student') ? (
        <>
          {presentation.showHeaderCart ? (
            <CartNavigationLink itemCount={header.cartItemCount} />
          ) : null}
          {presentation.isAnonymous ? (
            <nav
              className={[styles.navDesktop, styles.navCatalogAccount].join(' ')}
              aria-label={t('a11y:accountNavigation')}
            >
              <NavigationLinks items={presentation.desktopAuthActions} />
            </nav>
          ) : null}
          {presentation.isInstructor && presentation.isAuthenticatedMobile ? (
            <AuthenticatedHeaderDrawerMenu
              currentLocation={presentation.currentLocation}
              isInstructorCoursesRoute={presentation.isInstructorCoursesRoute}
              mainRef={header.mainRef}
              navigation={presentation.navigation}
              onCreateCourse={header.onCreateCourse}
              onLogOut={header.onLogOut}
              routeFocusIdentity={header.routeFocusIdentity}
              state={header.state}
              visible
            />
          ) : null}
          <div
            className={
              header.state.status === 'authenticated'
                ? header.state.user.role === 'instructor'
                  ? [styles.account, styles.accountInstructor].join(' ')
                  : styles.account
                : [styles.account, styles.accountAnonymous].join(' ')
            }
          >
            {header.state.status === 'authenticated' &&
            (!presentation.isAuthenticatedTablet || presentation.isInstructor) ? (
              <AccountMenu
                user={header.state.user}
                onLogOut={header.onLogOut}
                exclusiveDisclosure={disclosures.account}
              />
            ) : null}
            {presentation.isAuthenticatedMobile ||
            (presentation.isInstructor && presentation.isAuthenticatedTablet)
              ? languageSelector
              : null}
            <MobileHeaderNavigationMenu
              currentLocation={presentation.currentLocation}
              isInstructorCoursesRoute={presentation.isInstructorCoursesRoute}
              navigation={presentation.navigation}
              onCreateCourse={header.onCreateCourse}
              onRequestMainFocus={header.onRequestMainFocus}
              routeFocusIdentity={header.routeFocusIdentity}
              visible={showMobileMenu}
            />
          </div>
        </>
      ) : null}
      {!presentation.isAuthenticatedMobile &&
      !(presentation.isInstructor && presentation.isAuthenticatedTablet)
        ? languageSelector
        : null}
    </div>
  );
}
