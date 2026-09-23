// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogHeaderSearch } from '../../src/app/layouts/CatalogHeaderSearch';
import type { CatalogSearchFocusIntent } from '../../src/app/layouts/catalog-header-search-types';
import { parseCatalogQuery } from '../../src/features/catalog-discovery';
import { LocaleProvider } from '../../src/shared/locale';

function locationIdentity(location: ReturnType<typeof useLocation>) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function CatalogHeaderSearchHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const [focusIntent, setFocusIntent] = useState<CatalogSearchFocusIntent | null>(null);
  const [locations, setLocations] = useState<string[]>([]);
  const [locationKeys, setLocationKeys] = useState<string[]>([]);
  const identity = locationIdentity(location);

  useEffect(() => {
    setLocations((current) => [...current, identity]);
  }, [identity]);

  useEffect(() => {
    setLocationKeys((current) => [...current, location.key]);
  }, [location.key]);

  return (
    <>
      <CatalogHeaderSearch
        catalogQuery={parseCatalogQuery(new URLSearchParams(location.search))}
        focusIntent={focusIntent}
        isCatalogRoute={location.pathname === '/'}
        location={location}
        onFocusIntentChange={setFocusIntent}
      />
      <button type="button" onClick={() => navigate('/courses/7')}>
        Replace location
      </button>
      <button type="button" onClick={() => navigate(identity)}>
        Push identical location
      </button>
      <button type="button">Outside focus</button>
      <output aria-label="catalog search location">{identity}</output>
      <output aria-label="catalog search locations">{JSON.stringify(locations)}</output>
      <output aria-label="catalog search location keys">{JSON.stringify(locationKeys)}</output>
    </>
  );
}

function renderSearch(initialEntry = '/') {
  render(
    <LocaleProvider initialLocale="en">
      <MemoryRouter initialEntries={[initialEntry]}>
        <CatalogHeaderSearchHarness />
      </MemoryRouter>
    </LocaleProvider>,
  );
  const search = screen.getByRole('combobox', { name: 'Search courses' });
  if (!(search instanceof HTMLInputElement))
    throw new Error('Catalog search must render an input element');
  return search;
}

function currentLocation() {
  return screen.getByLabelText('catalog search location').textContent;
}

describe('CatalogHeaderSearch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('debounces one canonical search for 500 ms, resets page, and keeps a catalog hash', async () => {
    const input = renderSearch('/?min_price=10&page=3#catalog');

    fireEvent.change(input, { target: { value: ' React ' } });
    act(() => screen.getByRole('button', { name: 'Outside focus' }).focus());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside focus' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(currentLocation()).toBe('/?min_price=10&page=3#catalog');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(currentLocation()).toBe('/?search_query=React&min_price=10#catalog');
    expect(input.value).toBe('React');
    expect(document.activeElement).toBe(input);
  });

  it('does not let an already scheduled debounce navigate after location replacement', async () => {
    const input = renderSearch('/?page=2');

    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace location' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(currentLocation()).toBe('/courses/7');
    expect(screen.getByLabelText('catalog search locations').textContent).toBe(
      '["/?page=2","/courses/7"]',
    );
  });

  it('cancels a queued search when Router pushes the same visible URL with a new location identity', async () => {
    const input = renderSearch('/?page=2');

    fireEvent.change(input, { target: { value: 'React' } });
    const identicalLocationTrigger = screen.getByRole('button', {
      name: 'Push identical location',
    });
    act(() => identicalLocationTrigger.focus());
    fireEvent.click(identicalLocationTrigger);

    const keysBeforeTimeout = JSON.parse(
      screen.getByLabelText('catalog search location keys').textContent ?? '[]',
    ) as string[];
    expect(keysBeforeTimeout).toHaveLength(2);
    expect(keysBeforeTimeout[0]).not.toBe(keysBeforeTimeout[1]);
    expect(currentLocation()).toBe('/?page=2');
    expect(document.activeElement).toBe(identicalLocationTrigger);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(currentLocation()).toBe('/?page=2');
    expect(screen.getByLabelText('catalog search locations').textContent).toBe('["/?page=2"]');
    expect(document.activeElement).toBe(identicalLocationTrigger);
  });

  it('leaves IME Arrow and Escape defaults untouched, then performs exactly one current search', async () => {
    localStorage.setItem('learnhub.catalog-search-history', JSON.stringify(['React', 'Redux']));
    const input = renderSearch('/?page=2');

    fireEvent.focus(input);
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).not.toBeNull();
    fireEvent.compositionStart(input);
    const arrow = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowDown',
    });
    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
    expect(input.dispatchEvent(arrow)).toBe(true);
    expect(input.dispatchEvent(escape)).toBe(true);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).not.toBeNull();

    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.compositionEnd(input, { currentTarget: { value: 'React' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(currentLocation()).toBe('/?search_query=React');
    expect(screen.getByLabelText('catalog search locations').textContent).toBe(
      '["/?page=2","/?search_query=React"]',
    );
  });

  it('keeps input focus while Enter, pointer, and touch history selections navigate', async () => {
    localStorage.setItem('learnhub.catalog-search-history', JSON.stringify(['React', 'Redux']));
    const input = renderSearch('/?sort=-price&page=2');

    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'rea' } });
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).not.toBeNull();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['React']);
    expect(screen.queryByRole('option', { name: 'Redux' })).toBeNull();

    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false);
    const firstOption = screen.getByRole('option', { name: 'React' });
    expect(input.getAttribute('aria-activedescendant')).toBe(firstOption.id);
    expect(firstOption.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(input);

    // jsdom does not perform the browser's implicit form submission after an Enter keydown.
    // Assert the default remains available, then deliver that native submit boundary explicitly.
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    const searchForm = input.closest('form');
    if (searchForm === null) throw new Error('Catalog search input must remain in its search form');
    await act(async () => {
      fireEvent.submit(searchForm);
    });
    expect(currentLocation()).toBe('/?search_query=React&sort=-price');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).not.toBeNull();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'React',
      'Redux',
    ]);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    const secondOption = screen.getByRole('option', { name: 'Redux' });
    expect(fireEvent.pointerDown(secondOption, { pointerType: 'touch' })).toBe(false);
    expect(document.activeElement).toBe(input);
    await act(async () => {
      fireEvent.click(secondOption);
    });
    expect(currentLocation()).toBe('/?search_query=Redux&sort=-price');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).not.toBeNull();
  });

  it('clears, dismisses, and outside-pointer closes the eligible history list without losing input focus', async () => {
    localStorage.setItem('learnhub.catalog-search-history', JSON.stringify(['React']));
    const input = renderSearch('/?search_query=React');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    });
    expect(currentLocation()).toBe('/');
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).not.toBeNull();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside focus' }));
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull();
  });
});
