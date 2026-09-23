import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';

import { FieldShell, useFieldA11y } from './Field';
import styles from './Select.module.css';

interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled: boolean;
}

type NativeOptionElement = ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;

export interface SelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'defaultValue' | 'onChange' | 'value'
> {
  label: ReactNode;
  helpText?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  children: ReactNode;
  value?: string;
  defaultValue?: string;
  name?: string;
  required?: boolean;
  onValueChange?(value: string): void;
}

function optionValue(option: NativeOptionElement): string {
  const value = option.props.value;
  if (value !== undefined) return String(value);
  return typeof option.props.children === 'string' ? option.props.children : '';
}

function enabledIndex(options: readonly SelectOption[], start: number, step: 1 | -1): number {
  if (options.length === 0) return -1;
  let index = Math.min(Math.max(start, 0), options.length - 1);
  while (index >= 0 && index < options.length) {
    if (!options[index]?.disabled) return index;
    index += step;
  }
  if (step === 1) return options.findIndex((option) => !option.disabled);
  for (let fallback = options.length - 1; fallback >= 0; fallback -= 1) {
    if (!options[fallback]?.disabled) return fallback;
  }
  return -1;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    id,
    label,
    helpText,
    error,
    fieldClassName,
    className,
    required,
    disabled,
    children,
    value,
    defaultValue,
    name,
    onValueChange,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    ...props
  },
  forwardedRef,
) {
  const options = useMemo<readonly SelectOption[]>(
    () =>
      Children.toArray(children).flatMap((child) => {
        if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return [];
        return [
          {
            value: optionValue(child),
            label: child.props.children,
            disabled: Boolean(child.props.disabled),
          },
        ];
      }),
    [children],
  );
  const ids = useFieldA11y({
    id,
    describedBy: ariaDescribedBy,
    hasHelp: Boolean(helpText),
    hasError: Boolean(error),
  });
  const listboxId = `${ids.controlId}-options-${useId()}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? options.find((option) => !option.disabled)?.value ?? '',
  );
  const selectedValue = value ?? uncontrolledValue;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selectedValue),
  );
  const selectedOption = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeOptionId = activeIndex === null ? undefined : `${listboxId}-option-${activeIndex}`;

  const setTriggerRef = useCallback(
    (element: HTMLButtonElement | null) => {
      triggerRef.current = element;
      if (typeof forwardedRef === 'function') forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    },
    [forwardedRef],
  );
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setActiveIndex(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const openListbox = useCallback(
    (index = selectedIndex) => {
      if (disabled || options.length === 0) return;
      setActiveIndex(enabledIndex(options, index, 1));
      setOpen(true);
    },
    [disabled, options, selectedIndex],
  );
  const select = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      if (value === undefined) setUncontrolledValue(option.value);
      onValueChange?.(option.value);
      close(true);
    },
    [close, onValueChange, options, value],
  );

  useEffect(() => {
    if (!open) return undefined;
    listboxRef.current?.focus({ preventScroll: true });
    listboxRef.current?.scrollIntoView?.({ block: 'nearest' });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [close, open]);

  const moveActive = (step: 1 | -1) => {
    const current = activeIndex ?? selectedIndex;
    const next = enabledIndex(options, current + step, step);
    if (next >= 0) setActiveIndex(next);
  };

  return (
    <FieldShell
      {...ids}
      label={label}
      required={required}
      helpText={helpText}
      error={error}
      className={fieldClassName}
    >
      <div
        ref={rootRef}
        className={[styles.root, open && styles.rootOpen].filter(Boolean).join(' ')}
      >
        <button
          {...props}
          ref={setTriggerRef}
          id={ids.controlId}
          type="button"
          role="combobox"
          aria-controls={open ? listboxId : undefined}
          aria-describedby={ids.describedBy}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={error ? true : ariaInvalid}
          aria-required={required || undefined}
          className={[styles.control, 'ui-control', 'ui-select', className]
            .filter(Boolean)
            .join(' ')}
          data-part="control"
          disabled={disabled}
          onClick={() => {
            if (open) close();
            else openListbox();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (open && activeIndex !== null) select(activeIndex);
              else openListbox();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (open) moveActive(1);
              else openListbox(enabledIndex(options, selectedIndex + 1, 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (open) moveActive(-1);
              else openListbox(enabledIndex(options, selectedIndex - 1, -1));
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              close(true);
            }
          }}
        >
          <span className={styles.value}>{selectedOption?.label}</span>
          <ChevronDown
            className={styles.chevron}
            data-part="select-chevron"
            aria-hidden="true"
            focusable="false"
            size={20}
            strokeWidth={1.75}
          />
        </button>
        {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
        {open ? (
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={typeof label === 'string' ? label : undefined}
            aria-activedescendant={activeOptionId}
            className={styles.listbox}
            data-placement="bottom"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveActive(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveActive(-1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                setActiveIndex(enabledIndex(options, 0, 1));
              } else if (event.key === 'End') {
                event.preventDefault();
                setActiveIndex(enabledIndex(options, options.length - 1, -1));
              } else if ((event.key === 'Enter' || event.key === ' ') && activeIndex !== null) {
                event.preventDefault();
                select(activeIndex);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
              } else if (event.key === 'Tab') {
                close();
              }
            }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-disabled={option.disabled || undefined}
                aria-selected={option.value === selectedValue}
                className={[
                  styles.option,
                  activeIndex === index && styles.optionActive,
                  option.disabled && styles.optionDisabled,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={(event) => {
                  if (event.button !== 0) return;
                  select(index);
                }}
              >
                <span className={styles.radio} data-part="select-radio" aria-hidden="true" />
                <span>{option.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </FieldShell>
  );
});
