import { Component, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useSession } from '@features/auth-session';

import { RenderErrorState, type RenderErrorRecovery } from './RouteStates';
import { routeForPath } from './route-registry';

interface RenderBoundaryProps {
  children: ReactNode;
  resetKey: string;
  recovery: RenderErrorRecovery;
  onErrorStateChange?: (hasError: boolean) => void;
}

interface RenderBoundaryState {
  hasError: boolean;
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface ApplicationTitleBoundaryProps {
  children: ReactNode;
}

interface RenderErrorTitleState {
  readonly kind: 'render-error';
}
interface BootstrappingTitleState {
  readonly kind: 'bootstrapping';
}
interface SessionErrorTitleState {
  readonly kind: 'session-error';
}
interface RegisteredRouteTitleState {
  readonly kind: 'registered-route';
  readonly routeTitle: string;
}
interface NotFoundTitleState {
  readonly kind: 'not-found';
}

type ApplicationTitleState =
  | RenderErrorTitleState
  | BootstrappingTitleState
  | SessionErrorTitleState
  | RegisteredRouteTitleState
  | NotFoundTitleState;

export class RenderErrorBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  state: RenderBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RenderBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: RenderBoundaryProps, previousState: RenderBoundaryState) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
      return;
    }
    if (this.state.hasError !== previousState.hasError) {
      this.props.onErrorStateChange?.(this.state.hasError);
    }
  }

  componentDidCatch() {
    this.props.onErrorStateChange?.(true);
  }

  private readonly retry = () => {
    this.setState({ hasError: false }, () => this.props.onErrorStateChange?.(false));
  };

  render() {
    if (this.state.hasError) {
      return <RenderErrorState onRetry={this.retry} recovery={this.props.recovery} />;
    }
    return this.props.children;
  }
}

function renderErrorRecoveryForPath(pathname: string): RenderErrorRecovery {
  return routeForPath(pathname)?.access === 'instructor' ? 'instructor-courses' : 'catalog';
}

export function RouteErrorBoundary({ children }: RouteErrorBoundaryProps) {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}${location.hash}`;
  const recovery = renderErrorRecoveryForPath(location.pathname);
  return (
    <RenderErrorBoundary resetKey={resetKey} recovery={recovery}>
      {children}
    </RenderErrorBoundary>
  );
}

function resolveApplicationTitle(
  state: ApplicationTitleState,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  switch (state.kind) {
    case 'render-error':
      return t('routes:renderErrorDocumentTitle');
    case 'bootstrapping':
      return t('routes:bootstrapDocumentTitle');
    case 'session-error':
      return t('routes:sessionErrorDocumentTitle');
    case 'registered-route':
      return t('routes:pageDocumentTitle', { pageTitle: state.routeTitle });
    case 'not-found':
      return t('routes:notFoundDocumentTitle');
  }
}

export function ApplicationTitleBoundary({ children }: ApplicationTitleBoundaryProps) {
  const { t } = useTranslation();
  const { state: sessionState } = useSession();
  const location = useLocation();
  const [hasRenderError, setHasRenderError] = useState(false);
  const route = routeForPath(location.pathname);
  const titleState: ApplicationTitleState = hasRenderError
    ? { kind: 'render-error' }
    : sessionState.status === 'bootstrapping'
      ? { kind: 'bootstrapping' }
      : sessionState.status === 'error' &&
          (!route || (route.access !== 'public' && route.access !== 'guest'))
        ? { kind: 'session-error' }
        : route
          ? { kind: 'registered-route', routeTitle: t(route.titleKey) }
          : { kind: 'not-found' };
  const title = resolveApplicationTitle(titleState, t);
  const resetKey = `${location.pathname}${location.search}${location.hash}`;
  const recovery = renderErrorRecoveryForPath(location.pathname);

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <RenderErrorBoundary
      resetKey={resetKey}
      recovery={recovery}
      onErrorStateChange={setHasRenderError}
    >
      {children}
    </RenderErrorBoundary>
  );
}
