import type { UserProfile } from '@entities/user';

import type { NavigationItem } from './app-shell-navigation';

export interface CartNavigationLinkProps {
  readonly itemCount: number | undefined;
}

export interface StudentMobileNavigationProps {
  readonly itemCount: number | undefined;
}

export type NavigationDestinationHandler = (to: string) => void;

export interface NavigationLinksProps {
  readonly items: readonly NavigationItem[];
  readonly onNavigate?: NavigationDestinationHandler;
  readonly showPrimaryNavigationIndicator?: boolean;
  readonly showTrailingChevron?: boolean;
}

export type DrawerAfterCloseAction = (() => void) | undefined;

export interface AuthenticatedTabletDrawerProps {
  readonly navigation: readonly NavigationItem[];
  readonly onClose: () => void;
  readonly onCreateCourse?: () => void;
  readonly onLogOut: () => void;
  readonly onNavigate: NavigationDestinationHandler;
  readonly open: boolean;
  readonly user: UserProfile;
}
