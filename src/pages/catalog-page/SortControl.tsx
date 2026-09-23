import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowDownUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CATALOG_SORT_VALUES, type CatalogSort } from '@features/catalog-discovery';
import type { ExclusiveDisclosureControl } from '@shared/types';

import styles from './SortControl.module.css';

interface SortLabel {
  readonly key: string;
  readonly defaultValue: string;
}

const SORT_LABEL: Readonly<Record<CatalogSort, SortLabel>> = {
  created_at: { key: 'catalog:oldest', defaultValue: 'Oldest' },
  '-created_at': { key: 'catalog:newest', defaultValue: 'Newest' },
  price: { key: 'catalog:lowToHigh', defaultValue: 'Low to High' },
  '-price': { key: 'catalog:highToLow', defaultValue: 'High to Low' },
  title: { key: 'catalog:aToZ', defaultValue: 'A to Z' },
  '-title': { key: 'catalog:zToA', defaultValue: 'Z to A' },
};

interface SortControlProps {
  value: CatalogSort;
  onChange: (sort: CatalogSort) => void;
  onPointerOptionCommit(clientX: number, clientY: number): void;
  readonly exclusiveDisclosure?: ExclusiveDisclosureControl;
}

export function SortControl({
  value,
  onChange,
  onPointerOptionCommit,
  exclusiveDisclosure,
}: SortControlProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusListboxRef = useRef(false);
  const finePointerHoverRef = useRef(false);
  const activeIndexRef = useRef<number | null>(null);
  const listboxId = `catalog-sort-options-${useId()}`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const selectedIndex = Math.max(0, CATALOG_SORT_VALUES.indexOf(value));
  const labelFor = (sort: CatalogSort) => {
    const label = SORT_LABEL[sort];
    return t(label.key, { defaultValue: label.defaultValue });
  };
  const optionLabels = CATALOG_SORT_VALUES.map(labelFor);
  const selectedLabel = optionLabels[selectedIndex] ?? labelFor(value);
  const mobileTriggerLabel = t('catalog:sort', { defaultValue: 'Sort:' }).replace(/:\s*$/u, '');
  const activeOptionId = activeIndex === null ? undefined : `${listboxId}-option-${activeIndex}`;

  const setActive = useCallback((index: number | null) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
  }, []);
  const close = useCallback(
    (restoreFocus = false) => {
      focusListboxRef.current = false;
      setOpen(false);
      setActive(null);
      if (restoreFocus) {
        requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
      }
    },
    [setActive],
  );
  const openList = useCallback(
    (index = selectedIndex, focusListbox = false) => {
      focusListboxRef.current = focusListbox;
      setActive(index);
      exclusiveDisclosure?.requestOpen();
      setOpen(true);
    },
    [exclusiveDisclosure, selectedIndex, setActive],
  );

  useEffect(() => {
    close();
  }, [close, value]);
  useEffect(() => {
    if (exclusiveDisclosure?.closeRequested) close();
  }, [close, exclusiveDisclosure?.closeRequested]);
  const setListboxRef = useCallback((element: HTMLDivElement | null) => {
    if (element && focusListboxRef.current) {
      focusListboxRef.current = false;
      element.focus({ preventScroll: true });
    }
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [close, open]);
  const select = useCallback(
    (index: number, pointerOriginated = false, clientX = 0, clientY = 0) => {
      const sort = CATALOG_SORT_VALUES[index];
      if (!sort) return;
      if (pointerOriginated) onPointerOptionCommit?.(clientX, clientY);
      if (sort === value) {
        close(true);
        return;
      }
      close();
      onChange(sort);
    },
    [close, onChange, onPointerOptionCommit, value],
  );
  const supportsFinePointerHover = (pointerType: string) =>
    pointerType === 'mouse' &&
    (typeof window.matchMedia !== 'function' ||
      window.matchMedia('(hover: hover) and (pointer: fine)').matches);

  return (
    <div
      ref={rootRef}
      className={[styles.control, open && styles.controlOpen].filter(Boolean).join(' ')}
      data-part="catalog-sort-control"
      onPointerEnter={(event) => {
        finePointerHoverRef.current = supportsFinePointerHover(event.pointerType);
        if (finePointerHoverRef.current) openList(selectedIndex);
      }}
      onPointerLeave={() => {
        if (finePointerHoverRef.current) close();
        finePointerHoverRef.current = false;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={triggerRef}
        className={styles.trigger}
        data-part="catalog-sort-trigger"
        type="button"
        aria-label={t('catalog:sortBy', {
          defaultValue: `Sort by: ${selectedLabel}`,
          sortLabel: selectedLabel,
        })}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (finePointerHoverRef.current) {
            if (!open) openList(selectedIndex);
            return;
          }
          if (open) close();
          else openList(selectedIndex, true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openList(selectedIndex, true);
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openList(Math.min(selectedIndex + 1, CATALOG_SORT_VALUES.length - 1), true);
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            openList(Math.max(selectedIndex - 1, 0), true);
          }
        }}
      >
        <ArrowDownUp className={styles.sortIcon} aria-hidden="true" focusable="false" />
        <span className={styles.mobileTriggerLabel}>{mobileTriggerLabel}</span>
        <span className={styles.triggerLabel}>
          <span className={styles.triggerLabelCurrent}>{selectedLabel}</span>
          <span className={styles.triggerLabelSizer} aria-hidden="true">
            {CATALOG_SORT_VALUES.map((sort, index) => (
              <span key={sort}>{optionLabels[index]}</span>
            ))}
          </span>
        </span>
        <ChevronDown
          className={styles.chevron}
          data-part="catalog-sort-chevron"
          aria-hidden="true"
          focusable="false"
          size={16}
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <div
          ref={setListboxRef}
          className={styles.listbox}
          data-part="catalog-sort-listbox"
          id={listboxId}
          role="listbox"
          aria-label={t('catalog:sortByOptions', { defaultValue: 'Sort by options' })}
          tabIndex={-1}
          aria-activedescendant={activeOptionId}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive(
                Math.min(
                  (activeIndexRef.current ?? selectedIndex) + 1,
                  CATALOG_SORT_VALUES.length - 1,
                ),
              );
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max((activeIndexRef.current ?? selectedIndex) - 1, 0));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActive(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActive(CATALOG_SORT_VALUES.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (activeIndexRef.current !== null) select(activeIndexRef.current);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close(true);
            } else if (event.key === 'Tab') {
              close();
            }
          }}
        >
          {CATALOG_SORT_VALUES.map((sort, index) => (
            <div
              key={sort}
              id={`${listboxId}-option-${index}`}
              className={[styles.option, activeIndex === index && styles.optionActive]
                .filter(Boolean)
                .join(' ')}
              role="option"
              aria-selected={value === sort}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={(event) => select(index, event.detail !== 0, event.clientX, event.clientY)}
            >
              <span className={styles.radio} data-part="catalog-sort-radio" aria-hidden="true" />
              {optionLabels[index]}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
