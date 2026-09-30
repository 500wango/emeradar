'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Locale,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  TranslationDictionary,
} from './types';
import { zh } from './locales/zh';
import { en } from './locales/en';
import { useAuth } from '@/lib/auth-context';

const dictionaries: Record<Locale, TranslationDictionary> = {
  'zh-CN': zh,
  'en-US': en,
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  isZh: boolean;
  isEn: boolean;
  locales: Locale[];
  localeLabels: Record<Locale, string>;
  localeShortLabels: Record<Locale, string>;
  dict: TranslationDictionary;
  dictionary: TranslationDictionary;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key] !== undefined ? String(params[key]) : match;
  });
}

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { preferences, updatePreferences } = useAuth();

  const [locale, setLocaleState] = useState<Locale>(() => {
    if (initialLocale && (initialLocale === 'zh-CN' || initialLocale === 'en-US')) {
      return initialLocale;
    }
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('emeradar_locale') as Locale | null;
      if (stored && (stored === 'zh-CN' || stored === 'en-US')) return stored;
      // Check browser language
      if (navigator.language?.startsWith('zh')) return 'zh-CN';
      if (navigator.language?.startsWith('en')) return 'en-US';
    }
    return DEFAULT_LOCALE;
  });

  // Sync with user preferences if available
  useEffect(() => {
    if (preferences?.uiLocale && (preferences.uiLocale === 'zh-CN' || preferences.uiLocale === 'en-US')) {
      if (preferences.uiLocale !== locale) {
        setLocaleState(preferences.uiLocale);
        document.cookie = `emeradar_locale=${preferences.uiLocale}; path=/; max-age=31536000; SameSite=Lax`;
        localStorage.setItem('emeradar_locale', preferences.uiLocale);
      }
    }
  }, [preferences?.uiLocale]);

  // Sync document lang attribute
  useEffect(() => {
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback(
    (newLocale: Locale) => {
      if (newLocale === locale) return;
      setLocaleState(newLocale);
      // Persist in cookie and localStorage
      document.cookie = `emeradar_locale=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
      localStorage.setItem('emeradar_locale', newLocale);
      document.documentElement.lang = newLocale === 'zh-CN' ? 'zh-CN' : 'en';

      // Update backend user preference if logged in
      if (preferences) {
        updatePreferences({ uiLocale: newLocale }).catch((err) => {
          console.warn('Failed to persist user uiLocale preference:', err);
        });
      }

      // Re-render server components
      router.refresh();
    },
    [locale, preferences, updatePreferences, router]
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const activeDict = dictionaries[locale] || dictionaries[DEFAULT_LOCALE];
      const val = getNestedValue(activeDict, key);
      if (val !== undefined) {
        return interpolate(val, params);
      }
      // Fallback to English dictionary
      const fallbackVal = getNestedValue(dictionaries['en-US'], key);
      if (fallbackVal !== undefined) {
        return interpolate(fallbackVal, params);
      }
      // Return key itself if not found
      return key;
    },
    [locale]
  );

  const contextValue = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      isZh: locale === 'zh-CN',
      isEn: locale === 'en-US',
      locales: LOCALES,
      localeLabels: LOCALE_LABELS,
      localeShortLabels: LOCALE_SHORT_LABELS,
      dict: dictionaries[locale] || dictionaries[DEFAULT_LOCALE],
      dictionary: dictionaries[locale] || dictionaries[DEFAULT_LOCALE],
    }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

export const useTranslation = useI18n;
