import type { ReactNode } from 'react';

export const SUPPORTED_LOCALES = ['en', 'ru', 'uz'] as const;

export type Locale = 'en' | 'ru' | 'uz';

export type TranslatedLocale = Exclude<Locale, 'en'>;

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocaleResolverInput {
  readonly storedLocale?: unknown;
  readonly browserLocales?: readonly unknown[];
}

export interface LocaleStore {
  get(): Locale | null;
  set(locale: Locale): boolean;
  remove(): boolean;
}

export interface LocaleLookup<TKey extends string> {
  get(key: TKey, locale: Locale): string;
}

export type EnglishLocaleCatalog<TKey extends string> = Readonly<Record<TKey, string>>;

export type LocaleTranslations<TKey extends string> = Readonly<
  Partial<Record<TranslatedLocale, Partial<Record<TKey, string>>>>
>;

export interface LocaleContextValue {
  readonly locale: Locale;
  setLocale(locale: Locale): void;
  clearStoredLocale(): void;
}

export interface LocaleProviderProps {
  readonly children: ReactNode;
  readonly initialLocale?: Locale;
  readonly store?: LocaleStore;
}
