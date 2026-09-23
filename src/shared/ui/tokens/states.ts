/**
 * Component state tokens
 *
 * Covers all 8 required component state variants:
 *   initial | loading | empty | success | error | disabled | focus | selected
 *
 * These tokens define the logical state names used across all components.
 * CSS custom property equivalents live in tokens.css.
 */

// ---------------------------------------------------------------------------
// Component state type
// ---------------------------------------------------------------------------
export type ComponentState =
  'initial' | 'loading' | 'empty' | 'success' | 'error' | 'disabled' | 'focus' | 'selected';

export interface StateTokenDefinition {
  /** Background color CSS variable */
  readonly bg: string;
  /** Foreground/text color CSS variable */
  readonly fg: string;
  /** Border color CSS variable */
  readonly border: string;
}

// ---------------------------------------------------------------------------
// State token map — maps each state to its semantic CSS variable names
// These CSS variable names are defined in tokens.css.
// ---------------------------------------------------------------------------
export const stateTokenMap: Readonly<Record<ComponentState, StateTokenDefinition>> = {
  initial: {
    bg: 'var(--color-surface)',
    fg: 'var(--text-primary)',
    border: 'var(--border-default)',
  },
  loading: {
    bg: 'var(--color-surface)',
    fg: 'var(--text-muted)',
    border: 'var(--border-default)',
  },
  empty: {
    bg: 'var(--color-canvas)',
    fg: 'var(--text-muted)',
    border: 'var(--border-default)',
  },
  success: {
    bg: 'var(--feedback-success-bg)',
    fg: 'var(--feedback-success)',
    border: 'var(--feedback-success)',
  },
  error: {
    bg: 'var(--feedback-error-bg)',
    fg: 'var(--feedback-error)',
    border: 'var(--feedback-error)',
  },
  disabled: {
    bg: 'var(--state-disabled-bg)',
    fg: 'var(--state-disabled-text)',
    border: 'var(--border-default)',
  },
  focus: {
    bg: 'var(--color-surface)',
    fg: 'var(--text-primary)',
    border: 'var(--focus-ring)',
  },
  selected: {
    bg: 'var(--state-selected)',
    fg: 'var(--text-primary)',
    border: 'var(--action-primary-bg)',
  },
} as const;

// ---------------------------------------------------------------------------
// All valid component states (runtime tuple for iteration / validation)
// ---------------------------------------------------------------------------
export const ALL_COMPONENT_STATES: readonly ComponentState[] = [
  'initial',
  'loading',
  'empty',
  'success',
  'error',
  'disabled',
  'focus',
  'selected',
] as const;

// Concrete state custom properties that are declared in tokens.css. States
// that directly reuse a semantic token remain represented by stateTokenMap.
export const stateTokens = {
  '--state-loading-bg': 'var(--color-surface)',
  '--state-loading-fg': 'var(--text-muted)',
  '--state-empty-bg': 'var(--color-canvas)',
  '--state-empty-fg': 'var(--text-muted)',
  '--state-success-bg': 'var(--feedback-success-bg)',
  '--state-success-fg': 'var(--feedback-success)',
  '--state-success-border': 'var(--feedback-success)',
  '--state-error-bg': 'var(--feedback-error-bg)',
  '--state-error-fg': 'var(--feedback-error)',
  '--state-error-border': 'var(--feedback-error)',
} as const;

export type StateTokenKey = keyof typeof stateTokens;

// ---------------------------------------------------------------------------
// State-specific CSS classes (BEM modifier pattern for each state)
// ---------------------------------------------------------------------------
export const stateClassMap: Readonly<Record<ComponentState, string>> = {
  initial: '',
  loading: 'is-loading',
  empty: 'is-empty',
  success: 'is-success',
  error: 'is-error',
  disabled: 'is-disabled',
  focus: 'is-focus',
  selected: 'is-selected',
} as const;
