import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  draftFromCatalogQuery,
  validateCatalogDraft,
  type CatalogFilterValidationErrors,
  type CatalogPriceField,
  type CatalogPriceRange,
  type CatalogPriceRangeDraft,
  type CatalogQuery,
} from '@features/catalog-discovery';
import type { ExclusiveDisclosureControl } from '@shared/types';
import { Button, Input, VisuallyHidden } from '@shared/ui/primitives';

import styles from './CatalogFilterBar.module.css';

interface CatalogFilterBarProps {
  query: CatalogQuery;
  onApply: (next: CatalogQuery) => void;
  readonly exclusiveDisclosure?: ExclusiveDisclosureControl;
  readonly minimumPricePlaceholder?: string;
  readonly maximumPricePlaceholder?: string;
}

type HoverCloseTimer = number;
type PriceDisclosureOpenMode = 'hover' | 'persistent' | null;
type DismissDraft = (restoreFocus?: boolean) => void;

const FINE_HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const HOVER_CLOSE_DELAY_MS = 240;

function priceDraftFromCatalogQuery(query: CatalogQuery): CatalogPriceRangeDraft {
  const draft = draftFromCatalogQuery(query);
  return { min_price: draft.min_price, max_price: draft.max_price };
}

function priceRangeMatches(left: CatalogPriceRange, right: CatalogPriceRange): boolean {
  return left.min_price === right.min_price && left.max_price === right.max_price;
}

function hasInvertedPriceRange(draft: CatalogPriceRangeDraft): boolean {
  if (draft.min_price.trim() === '' || draft.max_price.trim() === '') return false;
  const minimum = Number(draft.min_price);
  const maximum = Number(draft.max_price);
  return (
    Number.isFinite(minimum) &&
    Number.isFinite(maximum) &&
    minimum >= 0 &&
    maximum >= 0 &&
    maximum < minimum
  );
}

export function CatalogFilterBar({
  query,
  onApply,
  exclusiveDisclosure,
  minimumPricePlaceholder,
  maximumPricePlaceholder,
}: CatalogFilterBarProps) {
  const { t } = useTranslation();
  const rangeDescriptionId = `catalog-price-range-description-${useId()}`;
  const [draft, setDraft] = useState<CatalogPriceRangeDraft>(() =>
    priceDraftFromCatalogQuery(query),
  );
  const [appliedRange, setAppliedRange] = useState<CatalogPriceRange>(() => ({
    min_price: query.min_price,
    max_price: query.max_price,
  }));
  const [errors, setErrors] = useState<CatalogFilterValidationErrors>({});
  const [open, setOpen] = useState(false);
  const draftRef = useRef(draft);
  const queryRef = useRef(query);
  const rootRef = useRef<HTMLFormElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hoverCloseTimerRef = useRef<HoverCloseTimer | null>(null);
  const openModeRef = useRef<PriceDisclosureOpenMode>(null);
  const dismissDraftRef = useRef<DismissDraft>(() => {});
  const lastAppliedRangeRef = useRef<CatalogPriceRange>({
    min_price: query.min_price,
    max_price: query.max_price,
  });

  draftRef.current = draft;
  queryRef.current = query;

  useEffect(() => {
    setDraft(priceDraftFromCatalogQuery(query));
    setAppliedRange({ min_price: query.min_price, max_price: query.max_price });
    setErrors({});
    lastAppliedRangeRef.current = { min_price: query.min_price, max_price: query.max_price };
  }, [query]);

  const update = (key: CatalogPriceField, value: string) => {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
  };

  const applyDraft = (draftToApply = draftRef.current): boolean => {
    if (hasInvertedPriceRange(draftToApply)) {
      setErrors({ max_price: 'maximumPriceMustBeAtLeast' });
      return false;
    }
    const currentQuery = queryRef.current;
    const validation = validateCatalogDraft({
      search_query: currentQuery.search_query ?? '',
      min_price: draftToApply.min_price,
      max_price: draftToApply.max_price,
      sort: currentQuery.sort,
    });
    setErrors(validation.errors);
    if (!validation.value) return false;

    const nextRange: CatalogPriceRange = {
      min_price: validation.value.min_price,
      max_price: validation.value.max_price,
    };
    const currentRange: CatalogPriceRange = {
      min_price: currentQuery.min_price,
      max_price: currentQuery.max_price,
    };
    if (
      priceRangeMatches(nextRange, currentRange) ||
      priceRangeMatches(nextRange, lastAppliedRangeRef.current)
    )
      return true;

    lastAppliedRangeRef.current = nextRange;
    setAppliedRange(nextRange);
    onApply({
      ...validation.value,
      search_query: currentQuery.search_query,
      sort: currentQuery.sort,
    });
    return true;
  };
  const cancelHoverClose = () => {
    if (hoverCloseTimerRef.current === null) return;
    window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  };
  const close = (restoreApplied = false, restoreFocus = true) => {
    cancelHoverClose();
    openModeRef.current = null;
    if (restoreApplied) {
      const restored = priceDraftFromCatalogQuery(queryRef.current);
      draftRef.current = restored;
      setDraft(restored);
      setErrors({});
    }
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const supportsFinePointerHover = (pointerType: string) =>
    pointerType === 'mouse' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(FINE_HOVER_QUERY).matches;
  const openFromHover = (pointerType: string) => {
    if (!supportsFinePointerHover(pointerType)) return;
    cancelHoverClose();
    if (openModeRef.current !== 'persistent') openModeRef.current = 'hover';
    exclusiveDisclosure?.requestOpen();
    setOpen(true);
  };
  const dismissDraft = (restoreFocus = true) => close(true, restoreFocus);
  dismissDraftRef.current = dismissDraft;
  const closeAfterHover = (pointerType: string) => {
    if (!supportsFinePointerHover(pointerType) || openModeRef.current === null) return;
    cancelHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      dismissDraft(false);
    }, HOVER_CLOSE_DELAY_MS);
  };
  const toggleFromClick = () => {
    cancelHoverClose();
    const shouldClose = open && openModeRef.current === 'persistent';
    if (shouldClose) {
      dismissDraft();
      return;
    }
    openModeRef.current = 'persistent';
    exclusiveDisclosure?.requestOpen();
    setOpen(true);
  };
  useEffect(
    () => () => {
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (exclusiveDisclosure?.closeRequested) dismissDraftRef.current(false);
  }, [exclusiveDisclosure?.closeRequested]);
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) dismissDraftRef.current(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  const minimumError =
    errors.min_price === 'nonNegativePrice' ? t('catalog:nonNegativePrice') : undefined;
  const maximumError =
    errors.max_price === 'nonNegativePrice'
      ? t('catalog:nonNegativePrice')
      : errors.max_price === 'maximumPriceMustBeAtLeast'
        ? t('catalog:maximumPriceMustBeAtLeast')
        : undefined;
  const appliedRangeDescription = [
    appliedRange.min_price === undefined
      ? null
      : `${t('catalog:priceFrom', { defaultValue: 'From' })}: ${appliedRange.min_price}`,
    appliedRange.max_price === undefined
      ? null
      : `${t('catalog:priceTo', { defaultValue: 'To' })}: ${appliedRange.max_price}`,
  ]
    .filter((description): description is string => description !== null)
    .join(', ');
  const hasAppliedPriceRange = query.min_price !== undefined || query.max_price !== undefined;
  const resetPriceRange = () => {
    const currentQuery = queryRef.current;
    const clearedDraft: CatalogPriceRangeDraft = { min_price: '', max_price: '' };
    draftRef.current = clearedDraft;
    setDraft(clearedDraft);
    setErrors({});
    lastAppliedRangeRef.current = { min_price: undefined, max_price: undefined };
    setAppliedRange({ min_price: undefined, max_price: undefined });
    onApply({
      ...currentQuery,
      min_price: undefined,
      max_price: undefined,
      page: 1,
    });
    close();
  };

  return (
    <form
      ref={rootRef}
      className={styles.root}
      data-part="catalog-filter-form"
      aria-label={t('catalog:courseFilters', { defaultValue: 'Course filters' })}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (applyDraft()) close();
      }}
    >
      <button
        ref={triggerRef}
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        data-part="catalog-price-trigger"
        type="button"
        aria-describedby={appliedRangeDescription ? rangeDescriptionId : undefined}
        aria-expanded={open}
        aria-controls={open ? 'catalog-price-disclosure' : undefined}
        onPointerEnter={(event) => openFromHover(event.pointerType)}
        onPointerMove={(event) => {
          if (supportsFinePointerHover(event.pointerType)) cancelHoverClose();
        }}
        onPointerLeave={(event) => closeAfterHover(event.pointerType)}
        onClick={toggleFromClick}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
          }
        }}
      >
        <span>{t('catalog:priceTrigger', { defaultValue: 'Price' })}</span>
        <ChevronDown
          className={styles.chevron}
          data-part="catalog-price-chevron"
          aria-hidden="true"
          focusable="false"
          size={16}
          strokeWidth={1.75}
        />
      </button>
      {appliedRangeDescription ? (
        <VisuallyHidden id={rangeDescriptionId}>{appliedRangeDescription}</VisuallyHidden>
      ) : null}
      {open ? (
        <fieldset
          id="catalog-price-disclosure"
          className={styles.priceRange}
          onPointerEnter={(event) => {
            if (supportsFinePointerHover(event.pointerType)) cancelHoverClose();
          }}
          onPointerLeave={(event) => closeAfterHover(event.pointerType)}
          onPointerDownCapture={(event) => {
            if (supportsFinePointerHover(event.pointerType)) {
              cancelHoverClose();
              openModeRef.current = 'persistent';
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close(true);
            }
          }}
        >
          <VisuallyHidden as="legend">
            {t('catalog:priceRange', { defaultValue: 'Price range' })}
          </VisuallyHidden>
          <Input
            label={t('catalog:priceFrom', { defaultValue: 'From' })}
            name="min_price"
            type="number"
            inputMode="decimal"
            min="0"
            fieldClassName={styles.field}
            placeholder={minimumPricePlaceholder}
            value={draft.min_price}
            error={minimumError}
            onChange={(event) => update('min_price', event.target.value)}
          />
          <Input
            label={t('catalog:priceTo', { defaultValue: 'To' })}
            name="max_price"
            type="number"
            inputMode="decimal"
            min="0"
            fieldClassName={styles.field}
            placeholder={maximumPricePlaceholder}
            value={draft.max_price}
            error={maximumError}
            onChange={(event) => update('max_price', event.target.value)}
          />
          <div
            className={[styles.actions, !hasAppliedPriceRange && styles.actionsSingle]
              .filter(Boolean)
              .join(' ')}
          >
            {hasAppliedPriceRange ? (
              <Button type="button" variant="secondary" fullWidth onClick={resetPriceRange}>
                {t('catalog:priceReset', { defaultValue: 'Reset' })}
              </Button>
            ) : null}
            <Button type="submit" fullWidth>
              {t('catalog:priceDone', { defaultValue: 'Done' })}
            </Button>
          </div>
        </fieldset>
      ) : null}
    </form>
  );
}
