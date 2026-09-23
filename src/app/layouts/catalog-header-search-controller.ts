import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';

import {
  addCatalogSearchHistory,
  persistCatalogSearchHistory,
  readCatalogSearchHistory,
  serializeCatalogQuery,
} from '@features/catalog-discovery';

import type {
  CatalogHeaderSearchProps,
  CatalogSearchFocusIntent,
  CatalogSearchSubmitOptions,
} from './catalog-header-search-types';

const CATALOG_SEARCH_DEBOUNCE_MS = 500;

function locationPathIdentity(location: CatalogHeaderSearchProps['location']): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function locationIdentity(location: CatalogHeaderSearchProps['location']): string {
  return `${location.key}:${locationPathIdentity(location)}`;
}

export function useCatalogHeaderSearchController({
  catalogQuery,
  focusIntent,
  isCatalogRoute,
  location,
  onFocusIntentChange,
}: CatalogHeaderSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const listExplicitlyDismissedRef = useRef(false);
  const locationRef = useRef(locationIdentity(location));
  const preserveListOnQuerySyncRef = useRef(false);
  const [draft, setDraft] = useState(catalogQuery.search_query ?? '');
  const [history, setHistory] = useState(() => readCatalogSearchHistory());
  // The URL query is the submitted value, while the history filter belongs to an in-progress edit.
  // A committed history selection must therefore retain the complete recent-search menu when focus
  // is restored, instead of treating the selected URL query as a new filter.
  const [historyFilter, setHistoryFilter] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current === null) return;
    window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
  }, []);

  const matches = useMemo(() => {
    const normalizedDraft = historyFilter.trim().toLocaleLowerCase();
    return normalizedDraft
      ? history.filter((term) => term.toLocaleLowerCase().includes(normalizedDraft))
      : history;
  }, [history, historyFilter]);
  const activeTerm = activeIndex === null ? undefined : matches[activeIndex];
  const listboxVisible = isOpen && matches.length > 0;
  const currentLocationIdentity = locationIdentity(location);
  const currentLocationPathIdentity = locationPathIdentity(location);

  const closeList = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(null);
  }, []);

  const rememberSearch = useCallback(
    (term: string) => {
      const nextHistory = addCatalogSearchHistory(history, term);
      if (nextHistory.length === 0) return;
      setHistory(nextHistory);
      persistCatalogSearchHistory(nextHistory);
    },
    [history],
  );

  const submit = useCallback(
    ({
      value = draft,
      rememberHistory = true,
      preserveListOnCatalogQuerySync = false,
    }: CatalogSearchSubmitOptions = {}) => {
      clearDebounce();
      const submittedSearch = value.trim();
      const next = { ...catalogQuery, search_query: submittedSearch || undefined, page: 1 };
      const nextSearch = serializeCatalogQuery(next);
      const currentCanonicalSearch = serializeCatalogQuery(catalogQuery);
      const destinationPathname = isCatalogRoute ? location.pathname : '/';
      const preserveList =
        preserveListOnCatalogQuerySync &&
        destinationPathname === location.pathname &&
        !listExplicitlyDismissedRef.current;
      const destination = `${destinationPathname}${nextSearch ? `?${nextSearch}` : ''}${
        isCatalogRoute ? location.hash : ''
      }`;

      setDraft(next.search_query ?? '');
      if (submittedSearch && rememberHistory) rememberSearch(submittedSearch);
      if (preserveList) setActiveIndex(null);
      else closeList();
      if (
        destinationPathname === location.pathname &&
        nextSearch === currentCanonicalSearch &&
        location.search === (nextSearch ? `?${nextSearch}` : '')
      )
        return;

      const intent: CatalogSearchFocusIntent = {
        kind: 'catalog-search',
        sourceLocationIdentity: currentLocationIdentity,
        destinationLocation: destination,
      };
      onFocusIntentChange(intent);
      preserveListOnQuerySyncRef.current = preserveList;
      navigate({
        pathname: destinationPathname,
        search: nextSearch ? `?${nextSearch}` : '',
        hash: isCatalogRoute ? location.hash : '',
      });
    },
    [
      catalogQuery,
      clearDebounce,
      closeList,
      currentLocationIdentity,
      draft,
      isCatalogRoute,
      location.hash,
      location.pathname,
      location.search,
      navigate,
      onFocusIntentChange,
      rememberSearch,
    ],
  );

  const scheduleSearch = useCallback(
    (value: string) => {
      clearDebounce();
      const scheduledLocation = currentLocationIdentity;
      const timeoutId = window.setTimeout(() => {
        if (debounceTimerRef.current !== timeoutId || locationRef.current !== scheduledLocation)
          return;
        debounceTimerRef.current = null;
        submit({ value, rememberHistory: false, preserveListOnCatalogQuerySync: true });
      }, CATALOG_SEARCH_DEBOUNCE_MS);
      debounceTimerRef.current = timeoutId;
    },
    [clearDebounce, currentLocationIdentity, submit],
  );

  useLayoutEffect(() => {
    locationRef.current = currentLocationIdentity;
    clearDebounce();
    if (
      focusIntent !== null &&
      focusIntent.sourceLocationIdentity !== currentLocationIdentity &&
      focusIntent.destinationLocation !== currentLocationPathIdentity
    ) {
      onFocusIntentChange(null);
    }
  }, [
    clearDebounce,
    currentLocationIdentity,
    currentLocationPathIdentity,
    focusIntent,
    onFocusIntentChange,
  ]);

  useEffect(() => {
    if (!isCatalogRoute) return;
    const preserveList =
      preserveListOnQuerySyncRef.current && document.activeElement === inputRef.current;
    preserveListOnQuerySyncRef.current = false;
    clearDebounce();
    setDraft(catalogQuery.search_query ?? '');
    setIsOpen(preserveList);
    setActiveIndex(null);
  }, [catalogQuery.search_query, clearDebounce, isCatalogRoute]);

  useEffect(() => clearDebounce, [clearDebounce]);

  useEffect(() => {
    if (isCatalogRoute) setHistory(readCatalogSearchHistory());
  }, [isCatalogRoute]);

  useEffect(() => {
    if (
      focusIntent === null ||
      focusIntent.sourceLocationIdentity === currentLocationIdentity ||
      focusIntent.destinationLocation !== currentLocationPathIdentity
    )
      return;
    inputRef.current?.focus();
    if (!listExplicitlyDismissedRef.current) {
      setIsOpen(true);
      setActiveIndex(null);
    }
    onFocusIntentChange(null);
  }, [currentLocationIdentity, currentLocationPathIdentity, focusIntent, onFocusIntentChange]);

  useEffect(() => {
    if (!listboxVisible) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) closeList();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [closeList, listboxVisible]);

  const selectHistory = (term: string) => {
    // A history selection commits a URL query; it is no longer an in-progress edit filter.
    // Reset before navigation so a preserved, focus-restored list exposes all retained history.
    setHistoryFilter('');
    submit({ value: term });
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isComposingRef.current) return;
    if (activeTerm !== undefined) selectHistory(activeTerm);
    else submit();
  };
  const onFocus = () => {
    listExplicitlyDismissedRef.current = false;
    setIsOpen(matches.length > 0);
    setActiveIndex(null);
  };
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (!wrapperRef.current?.contains(event.relatedTarget)) closeList();
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextDraft = event.target.value;
    listExplicitlyDismissedRef.current = false;
    setDraft(nextDraft);
    setHistoryFilter(nextDraft);
    setIsOpen(history.length > 0);
    setActiveIndex(null);
    if (!isComposingRef.current) scheduleSearch(nextDraft);
  };
  const onCompositionStart = () => {
    isComposingRef.current = true;
    clearDebounce();
  };
  const onCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false;
    scheduleSearch(event.currentTarget.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingRef.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      listExplicitlyDismissedRef.current = true;
      closeList();
      return;
    }
    if (matches.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      listExplicitlyDismissedRef.current = false;
      setIsOpen(true);
      setActiveIndex((index) => (index === null ? 0 : Math.min(index + 1, matches.length - 1)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      listExplicitlyDismissedRef.current = false;
      setIsOpen(true);
      setActiveIndex((index) => (index === null ? matches.length - 1 : Math.max(index - 1, 0)));
    }
  };
  const clear = () => {
    clearDebounce();
    listExplicitlyDismissedRef.current = false;
    setDraft('');
    setHistoryFilter('');
    submit({ value: '', rememberHistory: false, preserveListOnCatalogQuerySync: true });
    inputRef.current?.focus();
  };
  const onOptionPointerDown = (event: MouseEvent<HTMLElement>) => event.preventDefault();

  return {
    activeIndex,
    activeTerm,
    clear,
    draft,
    inputRef,
    listboxVisible,
    matches,
    onBlur,
    onChange,
    onCompositionEnd,
    onCompositionStart,
    onFocus,
    onKeyDown,
    onOptionPointerDown,
    onSubmit,
    selectHistory,
    setActiveIndex,
    wrapperRef,
  };
}
