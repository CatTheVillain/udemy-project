import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { focusElement, focusFirst, getTabbableElements } from '../../accessibility/focus';
import styles from './Dialog.module.css';

interface DialogOwner {
  id: symbol;
  backdrop: HTMLElement;
  dialog: HTMLElement;
  invoker: HTMLElement | null;
}

interface InertSnapshot {
  element: HTMLElement;
  hadAttribute: boolean;
  value: string | null;
}

interface DialogLayerSnapshot {
  element: HTMLElement;
  inert: InertSnapshot;
  ariaHidden: string | null;
}

interface DialogUnregisterResult {
  readonly wasTopmost: boolean;
  readonly nextTopmost?: DialogOwner;
}

const dialogOwners: DialogOwner[] = [];
let bodyOverflowBeforeDialogs: string | undefined;
const inertSnapshots = new Map<HTMLElement, InertSnapshot>();
const dialogLayerSnapshots = new Map<symbol, DialogLayerSnapshot[]>();
let bodyChildObserver: MutationObserver | undefined;

function getDialogPortalRoot(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>('[data-dialog-portal-root]');
  if (existing) return existing;

  const root = document.createElement('div');
  root.dataset.dialogPortalRoot = 'true';
  document.body.append(root);
  return root;
}

function makeOutsideElementInert(element: HTMLElement, portalRoot: HTMLElement) {
  if (element === portalRoot || inertSnapshots.has(element)) return;

  inertSnapshots.set(element, {
    element,
    hadAttribute: element.hasAttribute('inert'),
    value: element.getAttribute('inert'),
  });
  element.setAttribute('inert', '');
}

function startModalEnvironment(portalRoot: HTMLElement) {
  Array.from(document.body.children).forEach((element) => {
    makeOutsideElementInert(element as HTMLElement, portalRoot);
  });

  bodyChildObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) makeOutsideElementInert(node, portalRoot);
      });
    });
  });
  bodyChildObserver.observe(document.body, { childList: true });
}

function stopModalEnvironment() {
  bodyChildObserver?.disconnect();
  bodyChildObserver = undefined;
  inertSnapshots.forEach(({ element, hadAttribute, value }) => {
    if (hadAttribute) element.setAttribute('inert', value ?? '');
    else element.removeAttribute('inert');
  });
  inertSnapshots.clear();
}

function hideDialogLayer(owner: DialogOwner) {
  if (dialogLayerSnapshots.has(owner.id)) return;

  const elements = [owner.backdrop, owner.dialog];
  dialogLayerSnapshots.set(
    owner.id,
    elements.map((element) => ({
      element,
      inert: {
        element,
        hadAttribute: element.hasAttribute('inert'),
        value: element.getAttribute('inert'),
      },
      ariaHidden: element.getAttribute('aria-hidden'),
    })),
  );
  elements.forEach((element) => {
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  });
}

function restoreDialogLayer(owner: DialogOwner) {
  const snapshots = dialogLayerSnapshots.get(owner.id);
  if (!snapshots) return;

  snapshots.forEach(({ element, inert, ariaHidden }) => {
    if (inert.hadAttribute) element.setAttribute('inert', inert.value ?? '');
    else element.removeAttribute('inert');
    if (ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', ariaHidden);
  });
  dialogLayerSnapshots.delete(owner.id);
}

function syncDialogLayers() {
  const topmost = dialogOwners[dialogOwners.length - 1];
  dialogOwners.forEach((owner) => {
    if (owner === topmost) restoreDialogLayer(owner);
    else hideDialogLayer(owner);
  });
}

function refocusTopmostDialog() {
  const topmost = dialogOwners[dialogOwners.length - 1];
  if (topmost?.dialog.isConnected) focusFirst(topmost.dialog);
}

function isInsideTopmostDialog(target: EventTarget | null): boolean {
  const topmost = dialogOwners[dialogOwners.length - 1];
  return target instanceof Node && Boolean(topmost?.backdrop.contains(target));
}

function containOutsideInteraction(event: Event) {
  if (!isInsideTopmostDialog(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    refocusTopmostDialog();
  }
}

function containOutsideFocus(event: FocusEvent) {
  if (!isInsideTopmostDialog(event.target)) refocusTopmostDialog();
}

function registerDialog(owner: DialogOwner, portalRoot: HTMLElement) {
  if (dialogOwners.some((candidate) => candidate.id === owner.id)) return;
  if (dialogOwners.length === 0) {
    bodyOverflowBeforeDialogs = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    startModalEnvironment(portalRoot);
    document.addEventListener('focusin', containOutsideFocus, true);
    document.addEventListener('mousedown', containOutsideInteraction, true);
    document.addEventListener('keydown', containOutsideInteraction, true);
  }
  dialogOwners.push(owner);
  syncDialogLayers();
}

function isTopmostDialog(id: symbol): boolean {
  return dialogOwners[dialogOwners.length - 1]?.id === id;
}

function unregisterDialog(id: symbol): DialogUnregisterResult {
  const ownerIndex = dialogOwners.findIndex((owner) => owner.id === id);
  const wasTopmost = ownerIndex >= 0 && ownerIndex === dialogOwners.length - 1;

  const [removedOwner] = ownerIndex >= 0 ? dialogOwners.splice(ownerIndex, 1) : [];
  if (removedOwner) restoreDialogLayer(removedOwner);
  syncDialogLayers();
  if (ownerIndex >= 0 && dialogOwners.length === 0) {
    document.body.style.overflow = bodyOverflowBeforeDialogs ?? '';
    bodyOverflowBeforeDialogs = undefined;
    stopModalEnvironment();
    document.removeEventListener('focusin', containOutsideFocus, true);
    document.removeEventListener('mousedown', containOutsideInteraction, true);
    document.removeEventListener('keydown', containOutsideInteraction, true);
  }

  return { wasTopmost, nextTopmost: dialogOwners[dialogOwners.length - 1] };
}

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  closeLabel?: string;
  closeContent?: ReactNode;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  busy?: boolean;
  className?: string;
}

interface DialogActionsProps {
  children: ReactNode;
}

export function DialogActions({ children }: DialogActionsProps) {
  return <div className={[styles.actions, 'ui-dialog__actions'].join(' ')}>{children}</div>;
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  initialFocusRef,
  closeLabel,
  closeContent,
  showCloseButton = true,
  closeOnBackdrop = true,
  busy = false,
  className,
}: DialogProps) {
  const { t } = useTranslation();
  const resolvedCloseLabel = closeLabel ?? t('a11y:closeDialog', { defaultValue: 'Close dialog' });
  const generatedId = useId();
  const titleId = `dialog-title-${generatedId}`;
  const descriptionId = description ? `dialog-description-${generatedId}` : undefined;
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const ownerIdRef = useRef(Symbol('dialog-owner'));
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setPortalRoot(getDialogPortalRoot());
  }, []);

  useLayoutEffect(() => {
    if (!open || !portalRoot) return undefined;

    const ownerId = ownerIdRef.current;
    invokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const backdrop = backdropRef.current;
    if (dialog && backdrop) {
      registerDialog(
        {
          id: ownerId,
          backdrop,
          dialog,
          invoker: invokerRef.current,
        },
        portalRoot,
      );
      const initial = initialFocusRef?.current;
      if (!initial || !dialog.contains(initial) || !focusElement(initial)) focusFirst(dialog);
    }

    return () => {
      const { wasTopmost, nextTopmost } = unregisterDialog(ownerId);
      if (!wasTopmost) return;

      if (invokerRef.current && focusElement(invokerRef.current)) return;
      if (nextTopmost?.dialog.isConnected) {
        focusFirst(nextTopmost.dialog);
      } else {
        document.body.focus();
      }
    };
  }, [initialFocusRef, open, portalRoot]);

  if (!open || !portalRoot) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isTopmostDialog(ownerIdRef.current)) return;

    if (event.key === 'Escape') {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = getTabbableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget &&
      isTopmostDialog(ownerIdRef.current) &&
      closeOnBackdrop &&
      !busy
    ) {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={backdropRef}
      className={[styles.backdrop, 'ui-dialog-backdrop'].join(' ')}
      data-part="backdrop"
      onMouseDown={handleBackdrop}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={[styles.dialog, 'ui-dialog', className].filter(Boolean).join(' ')}
      >
        <div className={[styles.header, 'ui-dialog__header'].join(' ')}>
          <h2 className={[styles.title, 'ui-dialog__title'].join(' ')} id={titleId}>
            {title}
          </h2>
          {showCloseButton ? (
            <button
              className={[styles.close, 'ui-dialog__close'].join(' ')}
              type="button"
              aria-label={resolvedCloseLabel}
              onClick={onClose}
              disabled={busy}
            >
              {closeContent ?? '×'}
            </button>
          ) : null}
        </div>
        {description ? (
          <div
            className={[styles.description, 'ui-dialog__description'].join(' ')}
            id={descriptionId}
          >
            {description}
          </div>
        ) : null}
        <div className={[styles.body, 'ui-dialog__body'].join(' ')}>{children}</div>
      </div>
    </div>,
    portalRoot,
  );
}
