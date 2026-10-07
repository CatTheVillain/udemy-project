/**
 * ThemeProvider
 *
 * Singleton React context provider for the application's global density mode.
 * Applies the density-mode data attribute to the document root before paint
 * and exposes `useDensityMode()` to consumers of the one app shell.
 *
 * Usage:
 *   // Marketplace pages
 *   <ThemeProvider initialDensityMode="marketplace">
 *     <AppRouter />
 *   </ThemeProvider>
 *
 *   // Inside any component:
 *   const { densityMode } = useDensityMode();
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';

import type { ThemeContextValue, DensityMode } from './types';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const ThemeContext = createContext<ThemeContextValue | null>(null);
const DOCUMENT_DENSITY_OWNER_KEY = Symbol.for('learnhub.document-density-owner');

interface DocumentDensityOwnerRegistration {
  readonly densityBeforeProvider: string | null;
  readonly owner: symbol;
}

type DocumentDensityOwnerRegistry = Partial<
  Record<typeof DOCUMENT_DENSITY_OWNER_KEY, DocumentDensityOwnerRegistration>
>;

type DensityOwnedDocument = Document & DocumentDensityOwnerRegistry;

ThemeContext.displayName = 'ThemeContext';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
interface ThemeProviderProps {
  /** Initial density mode. Defaults to 'marketplace'. */
  initialDensityMode?: DensityMode;
  children: ReactNode;
}

export function ThemeProvider({
  initialDensityMode = 'marketplace',
  children,
}: ThemeProviderProps) {
  const parentTheme = useContext(ThemeContext);
  if (parentTheme !== null) {
    throw new Error('ThemeProvider is a singleton global density owner and cannot be nested.');
  }
  const ownerRef = useRef(Symbol('ThemeProvider density owner'));
  const [densityMode, setDensityModeState] = useState<DensityMode>(initialDensityMode);

  const setDensityMode = useCallback((mode: DensityMode) => {
    setDensityModeState(mode);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      densityMode,
      setDensityMode,
    }),
    [densityMode, setDensityMode],
  );

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const ownedDocument = document as DensityOwnedDocument;
    const owner = ownerRef.current;
    const currentOwner = ownedDocument[DOCUMENT_DENSITY_OWNER_KEY];
    if (currentOwner && currentOwner.owner !== owner) {
      throw new Error(
        'ThemeProvider is a singleton global density owner and cannot span multiple React roots.',
      );
    }
    if (!currentOwner) {
      ownedDocument[DOCUMENT_DENSITY_OWNER_KEY] = {
        densityBeforeProvider: ownedDocument.documentElement.getAttribute('data-density'),
        owner,
      };
    }
    return () => {
      const registration = ownedDocument[DOCUMENT_DENSITY_OWNER_KEY];
      if (registration?.owner !== owner) return;
      if (registration.densityBeforeProvider === null)
        ownedDocument.documentElement.removeAttribute('data-density');
      else
        ownedDocument.documentElement.setAttribute(
          'data-density',
          registration.densityBeforeProvider,
        );
      delete ownedDocument[DOCUMENT_DENSITY_OWNER_KEY];
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const ownedDocument = document as DensityOwnedDocument;
    if (ownedDocument[DOCUMENT_DENSITY_OWNER_KEY]?.owner === ownerRef.current) {
      ownedDocument.documentElement.setAttribute('data-density', densityMode);
    }
  }, [densityMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
/**
 * Access the current density mode and setter from any component inside ThemeProvider.
 *
 * @throws If used outside of a ThemeProvider.
 */
export function useDensityMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error(
      'useDensityMode must be used within a <ThemeProvider>. ' +
        'Wrap the application shell with its one <ThemeProvider initialDensityMode="marketplace|workspace">.',
    );
  }
  return ctx;
}
