import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { Input, VisuallyHidden } from '@shared/ui/primitives';

import { useCatalogHeaderSearchController } from './catalog-header-search-controller';
import type { CatalogHeaderSearchProps } from './catalog-header-search-types';
import styles from './AppShell.module.css';

export function CatalogHeaderSearch(props: CatalogHeaderSearchProps) {
  const { t } = useTranslation();
  const listboxId = `catalog-search-history-${useId()}`;
  const controller = useCatalogHeaderSearchController(props);

  return (
    <form
      className={styles.catalogSearch}
      role="search"
      aria-label={t('a11y:courseCatalogSearch')}
      onSubmit={controller.onSubmit}
    >
      <div ref={controller.wrapperRef} className={styles.catalogSearchField}>
        <Input
          ref={controller.inputRef}
          label={<VisuallyHidden>{t('a11y:searchCourses')}</VisuallyHidden>}
          fieldClassName={styles.catalogSearchPrimitiveField}
          className={[
            styles.catalogSearchInput,
            controller.draft ? styles.catalogSearchInputWithClear : null,
          ]
            .filter(Boolean)
            .join(' ')}
          name="search_query"
          type="search"
          value={controller.draft}
          placeholder={t('common:searchCoursesPlaceholder')}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={controller.listboxVisible ? listboxId : undefined}
          aria-expanded={controller.listboxVisible}
          aria-activedescendant={
            controller.activeTerm ? `${listboxId}-option-${controller.activeIndex}` : undefined
          }
          onBlur={controller.onBlur}
          onFocus={controller.onFocus}
          onClick={controller.onFocus}
          onChange={controller.onChange}
          onCompositionStart={controller.onCompositionStart}
          onCompositionEnd={controller.onCompositionEnd}
          onKeyDown={controller.onKeyDown}
        />
        <svg
          className={styles.catalogSearchIcon}
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
        >
          <path
            d="m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
        {controller.draft ? (
          <button
            className={styles.catalogSearchClear}
            type="button"
            aria-label={t('cart:clear')}
            onClick={controller.clear}
          >
            <X aria-hidden="true" focusable="false" size={20} strokeWidth={2} />
          </button>
        ) : null}
        {controller.listboxVisible ? (
          <div
            className={styles.catalogSearchListbox}
            id={listboxId}
            role="listbox"
            aria-label={t('a11y:recentSearches')}
          >
            {controller.matches.map((term, index) => (
              <div
                key={term.toLocaleLowerCase()}
                id={`${listboxId}-option-${index}`}
                className={styles.catalogSearchOption}
                role="option"
                aria-selected={controller.activeIndex === index}
                tabIndex={-1}
                onPointerDown={controller.onOptionPointerDown}
                onMouseEnter={() => controller.setActiveIndex(index)}
                onClick={() => controller.selectHistory(term)}
              >
                {term}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </form>
  );
}
