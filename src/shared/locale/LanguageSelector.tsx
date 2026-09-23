import { ChevronDown, Globe2 } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { ExclusiveDisclosureControl } from '@shared/types';

import { NATIVE_LOCALE_METADATA } from './metadata';
import { SUPPORTED_LOCALES } from './types';
import { useLocale } from './LocaleProvider';

export interface LanguageSelectorProps {
  readonly className: string;
  readonly menuClassName: string;
  readonly optionClassName: string;
  readonly selectedOptionClassName: string;
  readonly selectionIndicatorClassName: string;
  readonly mobile?: boolean;
  readonly exclusiveDisclosure?: ExclusiveDisclosureControl;
}

type HoverCloseTimer = number;
type LanguageSelectorOpenMode = 'hover' | 'persistent' | null;

const FINE_HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const HOVER_CLOSE_DELAY_MS = 240;

export function LanguageSelector({
  className,
  menuClassName,
  optionClassName,
  selectedOptionClassName,
  selectionIndicatorClassName,
  mobile = false,
  exclusiveDisclosure,
}: LanguageSelectorProps) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverCloseTimerRef = useRef<HoverCloseTimer | null>(null);
  const openModeRef = useRef<LanguageSelectorOpenMode>(null);
  const menuId = `language-menu-${useId()}`;

  function cancelHoverClose() {
    if (hoverCloseTimerRef.current === null) return;
    window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  }

  function supportsHover(event: ReactPointerEvent<HTMLDivElement>) {
    return (
      !mobile &&
      event.pointerType === 'mouse' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(FINE_HOVER_QUERY).matches
    );
  }

  function openFromHover(event: ReactPointerEvent<HTMLDivElement>) {
    if (!supportsHover(event)) return;
    cancelHoverClose();
    if (openModeRef.current !== 'persistent') openModeRef.current = 'hover';
    exclusiveDisclosure?.requestOpen();
    setOpen(true);
  }

  function retainHover(event: ReactPointerEvent<HTMLDivElement>) {
    if (!supportsHover(event)) return;
    cancelHoverClose();
  }

  function closeAfterHover(event: ReactPointerEvent<HTMLDivElement>) {
    if (!supportsHover(event) || openModeRef.current !== 'hover') return;
    cancelHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      openModeRef.current = null;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }

  function toggleFromClick() {
    cancelHoverClose();
    const shouldClose = open && openModeRef.current === 'persistent';
    openModeRef.current = shouldClose ? null : 'persistent';
    if (!shouldClose) exclusiveDisclosure?.requestOpen();
    setOpen(!shouldClose);
  }

  useEffect(
    () => () => {
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!exclusiveDisclosure?.closeRequested) return;
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    openModeRef.current = null;
    setOpen(false);
  }, [exclusiveDisclosure?.closeRequested]);

  useEffect(() => {
    if (!open) return undefined;
    function dismiss(event: Event) {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && ref.current?.contains(event.target as Node)) return;
      openModeRef.current = null;
      const activeElement = document.activeElement;
      const restoreTriggerFocus =
        activeElement instanceof HTMLElement && ref.current?.contains(activeElement);
      setOpen(false);
      if (restoreTriggerFocus) triggerRef.current?.focus({ preventScroll: true });
    }
    function dismissOnOutsideFocus(event: FocusEvent) {
      if (ref.current?.contains(event.target as Node)) return;
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
      openModeRef.current = null;
      setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    document.addEventListener('focusin', dismissOnOutsideFocus);
    window.addEventListener('scroll', dismiss, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('focusin', dismissOnOutsideFocus);
      window.removeEventListener('scroll', dismiss);
    };
  }, [open]);

  function openFromKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Space') return;
    event.preventDefault();
    cancelHoverClose();
    if (open) {
      openModeRef.current = 'persistent';
      return;
    }
    openModeRef.current = 'persistent';
    exclusiveDisclosure?.requestOpen();
    setOpen(true);
  }

  return (
    <div
      className={className}
      ref={ref}
      onPointerEnter={openFromHover}
      onPointerLeave={closeAfterHover}
      onPointerMove={retainHover}
    >
      <button
        ref={triggerRef}
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={t('navigation:changeLanguage')}
        type="button"
        onClick={toggleFromClick}
        onKeyDown={openFromKeyboard}
      >
        {mobile ? (
          <Globe2 aria-hidden="true" size={20} strokeWidth={1.75} />
        ) : (
          <>
            <span>{NATIVE_LOCALE_METADATA[locale].code}</span>
            <ChevronDown
              aria-hidden="true"
              data-language-selector-chevron
              size={16}
              strokeWidth={1.75}
            />
          </>
        )}
      </button>
      {open ? (
        <div className={menuClassName} id={menuId} aria-label={t('navigation:languageMenu')}>
          {SUPPORTED_LOCALES.map((candidate) => {
            const selected = candidate === locale;
            const label = NATIVE_LOCALE_METADATA[candidate].nativeLabel;
            return (
              <button
                key={candidate}
                aria-pressed={selected}
                className={[optionClassName, selected ? selectedOptionClassName : null]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                onClick={() => {
                  openModeRef.current = null;
                  setLocale(candidate);
                  setOpen(false);
                  triggerRef.current?.focus({ preventScroll: true });
                }}
              >
                <span className={selectionIndicatorClassName} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
