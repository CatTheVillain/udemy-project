import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Location } from 'react-router-dom';

import type { SessionState } from '@features/auth-session';
import type { CatalogQuery } from '@features/catalog-discovery';
import type { ExclusiveDisclosureControl } from '@shared/types';

import type { CatalogSearchFocusIntent } from './catalog-header-search-types';
import type { NavigationItem } from './app-shell-navigation';

export type HeaderDisclosure = 'account' | 'language';
export type HeaderNavigationFocusTarget = 'trigger' | 'main';

export interface AppShellHeaderProps {
  readonly cartItemCount: number | undefined;
  readonly catalogQuery: CatalogQuery;
  readonly focusIntent: CatalogSearchFocusIntent | null;
  readonly location: Location;
  readonly mainRef: RefObject<HTMLElement>;
  readonly onCatalogSearchFocusIntentChange: Dispatch<
    SetStateAction<CatalogSearchFocusIntent | null>
  >;
  readonly onCreateCourse: () => void;
  readonly onLogOut: () => void;
  readonly onMobileViewportChange: (matches: boolean) => void;
  readonly onRequestMainFocus: (destination: string | undefined) => void;
  readonly routeFocusIdentity: string;
  readonly state: SessionState;
}

export interface HeaderViewportFacts {
  readonly isStudentMobileViewport: boolean;
  readonly isTabletViewport: boolean;
}

export interface HeaderPresentation {
  readonly currentLocation: string;
  readonly desktopAuthActions: readonly NavigationItem[];
  readonly desktopPrimaryNavigation: readonly NavigationItem[];
  readonly hasCatalogSearch: boolean;
  readonly hasDesktopAuthActions: boolean;
  readonly isAnonymous: boolean;
  readonly isAnonymousMobile: boolean;
  readonly isAnonymousTablet: boolean;
  readonly isAuthenticatedDrawerViewport: boolean;
  readonly isAuthenticatedMobile: boolean;
  readonly isAuthenticatedTablet: boolean;
  readonly isCatalogRoute: boolean;
  readonly isCourseDetailRoute: boolean;
  readonly isInstructor: boolean;
  readonly isInstructorCompactDrawer: boolean;
  readonly isInstructorCoursesRoute: boolean;
  readonly isStudentMobile: boolean;
  readonly layout: string;
  readonly navigation: readonly NavigationItem[];
  readonly showHeaderCart: boolean;
}

export interface HeaderDisclosureProps {
  readonly account: ExclusiveDisclosureControl;
  readonly language: ExclusiveDisclosureControl;
}
