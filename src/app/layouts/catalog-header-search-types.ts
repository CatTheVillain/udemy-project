import type { CatalogQuery } from '@features/catalog-discovery';
import type { Location } from 'react-router-dom';

export interface CatalogSearchFocusIntent {
  readonly kind: 'catalog-search';
  /** The exact history entry that initiated this navigation, including Location.key. */
  readonly sourceLocationIdentity: string;
  /** The URL shape of the committed destination; Router allocates its key during navigation. */
  readonly destinationLocation: string;
}

export interface CatalogHeaderSearchProps {
  readonly catalogQuery: CatalogQuery;
  readonly focusIntent: CatalogSearchFocusIntent | null;
  readonly isCatalogRoute: boolean;
  readonly location: Location;
  readonly onFocusIntentChange: (intent: CatalogSearchFocusIntent | null) => void;
}

export interface CatalogSearchSubmitOptions {
  readonly preserveListOnCatalogQuerySync?: boolean;
  readonly rememberHistory?: boolean;
  readonly value?: string;
}
