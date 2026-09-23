// @vitest-environment jsdom

import { act, type PropsWithChildren, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, Input, Select, Textarea, VisuallyHidden } from '../../../src/shared/ui/primitives';
import { LocaleProvider } from '../../../src/shared/locale';

afterEach(cleanup);

function LocaleTestProvider({ children }: PropsWithChildren) {
  return <LocaleProvider initialLocale="en">{children}</LocaleProvider>;
}

function renderWithLocale(ui: ReactNode) {
  return render(ui, { wrapper: LocaleTestProvider });
}

describe('Button', () => {
  it('keeps native keyboard activation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithLocale(<Button onClick={onClick}>Save course</Button>);

    const button = screen.getByRole('button', { name: 'Save course' });
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(button.closest('[data-part="button-wrapper"]')).toBeTruthy();
  });

  it('exposes and announces loading state while preventing duplicate activation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithLocale(
      <Button state="loading" statusMessage="Saving course" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement;
    const statusId = button.getAttribute('aria-describedby');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(statusId).toBeTruthy();
    expect(document.getElementById(statusId ?? '')?.textContent).toBe('Saving course');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('retains explicit busy state without disabling an ordinary button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithLocale(
      <>
        <Button aria-busy onClick={onClick}>
          Load media
        </Button>
        <Button aria-busy={false}>Idle media</Button>
      </>,
    );

    const button = screen.getByRole('button', { name: 'Load media' }) as HTMLButtonElement;
    button.focus();
    await user.keyboard('{Enter}');

    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Idle media' }).getAttribute('aria-busy')).toBe(
      'false',
    );
    expect(document.activeElement).toBe(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('distinguishes success and error without relying on color and keeps status accessible', () => {
    renderWithLocale(
      <>
        <Button state="success" statusMessage="Changes saved">
          Save
        </Button>
        <Button state="error" statusMessage="Save failed">
          Retry
        </Button>
      </>,
    );

    const success = screen.getByRole('button', { name: 'Save' });
    const error = screen.getByRole('button', { name: 'Retry' });
    const successStatus = document.getElementById(success.getAttribute('aria-describedby') ?? '');
    const errorStatus = document.getElementById(error.getAttribute('aria-describedby') ?? '');

    expect(success.querySelector('[data-state-indicator="success"]')?.textContent).toBe('✓');
    expect(error.querySelector('[data-state-indicator="error"]')?.textContent).toBe('!');
    expect(success.querySelector('[data-state-indicator]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(error.querySelector('[data-state-indicator]')?.getAttribute('aria-hidden')).toBe('true');
    expect(successStatus?.textContent).toBe('Changes saved');
    expect(errorStatus?.textContent).toBe('Save failed');
  });
});

describe('form primitives', () => {
  it('links Input label, help and error text programmatically', () => {
    renderWithLocale(
      <Input label="Email" required helpText="Use your work email" error="Email is invalid" />,
    );

    const input = screen.getByRole('textbox', { name: 'Email' });
    const descriptions = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(descriptions).toContain('Use your work email');
    expect(descriptions).toContain('Email is invalid');
    expect(input.getAttribute('data-part')).toBe('control');
    expect(input.closest('[data-part="field"]')?.querySelector('[data-part="label"]')).toBeTruthy();
  });

  it('provides visible labels for Select and Textarea', () => {
    renderWithLocale(
      <>
        <Select label="Sort courses" defaultValue="new">
          <option value="new">Newest</option>
        </Select>
        <Textarea label="Description" helpText="Describe the course" />
      </>,
    );

    expect(screen.getByRole('combobox', { name: 'Sort courses' })).toBeTruthy();
    const textarea = screen.getByRole('textbox', { name: 'Description' });
    const helpId = textarea.getAttribute('aria-describedby');
    expect(document.getElementById(helpId ?? '')?.textContent).toBe('Describe the course');
  });

  it('renders Select as the shared listbox pattern with a selected radio option', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithLocale(
      <Select label="Lesson type" defaultValue="video" onValueChange={onValueChange}>
        <option value="video">Video</option>
        <option value="text">Text</option>
        <option value="pdf">PDF</option>
      </Select>,
    );

    const trigger = screen.getByRole('combobox', { name: 'Lesson type' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.querySelector('[data-part="select-chevron"]')).toBeTruthy();
    const listbox = screen.getByRole('listbox', { name: 'Lesson type' });
    expect(listbox.getAttribute('data-placement')).toBe('bottom');
    expect(screen.getByRole('option', { name: 'Video' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(
      screen.getByRole('option', { name: 'Video' }).querySelector('[data-part="select-radio"]'),
    ).toBeTruthy();

    await user.click(screen.getByRole('option', { name: 'Text' }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('text');
    expect(trigger.textContent).toContain('Text');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not commit a cancelled touch gesture or a disabled option', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithLocale(
      <Select label="Lesson type" defaultValue="video" onValueChange={onValueChange}>
        <option value="video">Video</option>
        <option value="text">Text</option>
        <option value="pdf" disabled>
          PDF
        </option>
      </Select>,
    );

    const trigger = screen.getByRole('combobox', { name: 'Lesson type' });
    await user.click(trigger);
    const textOption = screen.getByRole('option', { name: 'Text' });

    act(() => {
      fireEvent.pointerDown(textOption, { button: 0, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerLeave(textOption, { pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerCancel(textOption, { pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerUp(document.body, { button: 0, pointerId: 1, pointerType: 'touch' });
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain('Video');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.click(screen.getByRole('option', { name: 'PDF' }));

    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain('Video');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('supports keyboard selection and restores focus after Escape', async () => {
    const onValueChange = vi.fn();
    renderWithLocale(
      <Select label="Lesson type" defaultValue="video" onValueChange={onValueChange}>
        <option value="video">Video</option>
        <option value="text">Text</option>
        <option value="pdf">PDF</option>
      </Select>,
    );

    const trigger = screen.getByRole('combobox', { name: 'Lesson type' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });

    expect(onValueChange).toHaveBeenCalledWith('text');
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('preserves caller aria-invalid values unless an error forces invalid state', () => {
    renderWithLocale(
      <>
        <Input label="Input caller state" aria-invalid="grammar" />
        <Select label="Select caller state" aria-invalid="spelling">
          <option>One</option>
        </Select>
        <Textarea label="Textarea caller state" aria-invalid={false} />
        <Input label="Input error state" aria-invalid={false} error="Invalid input" />
        <Select label="Select error state" aria-invalid={false} error="Invalid selection">
          <option>One</option>
        </Select>
        <Textarea label="Textarea error state" aria-invalid={false} error="Invalid text" />
      </>,
    );

    expect(
      screen.getByRole('textbox', { name: 'Input caller state' }).getAttribute('aria-invalid'),
    ).toBe('grammar');
    expect(
      screen.getByRole('combobox', { name: 'Select caller state' }).getAttribute('aria-invalid'),
    ).toBe('spelling');
    expect(
      screen.getByRole('textbox', { name: 'Textarea caller state' }).getAttribute('aria-invalid'),
    ).toBe('false');
    expect(
      screen.getByRole('textbox', { name: 'Input error state' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByRole('combobox', { name: 'Select error state' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByRole('textbox', { name: 'Textarea error state' }).getAttribute('aria-invalid'),
    ).toBe('true');
  });
});

describe('VisuallyHidden', () => {
  it('preserves the requested semantic element', () => {
    renderWithLocale(
      <fieldset>
        <VisuallyHidden as="legend">Price range</VisuallyHidden>
      </fieldset>,
    );

    const legend = screen.getByText('Price range');
    expect(legend.tagName).toBe('LEGEND');
  });
});
