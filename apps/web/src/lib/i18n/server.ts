import { cookies } from 'next/headers';
import { Locale, DEFAULT_LOCALE, TranslationDictionary } from './types';
import { zh } from './locales/zh';
import { en } from './locales/en';

const dictionaries: Record<Locale, TranslationDictionary> = {
  'zh-CN': zh,
  'en-US': en,
};

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

export async function getServerLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const c = cookieStore.get('emeradar_locale')?.value;
    if (c === 'zh-CN' || c === 'en-US') return c;
  } catch {
    // If called in an environment without cookies
  }
  return DEFAULT_LOCALE;
}

export async function getServerI18n() {
  const locale = await getServerLocale();
  const activeDict = dictionaries[locale] || dictionaries[DEFAULT_LOCALE];

  const t = (key: string, params?: Record<string, string | number>): string => {
    const val = getNestedValue(activeDict, key);
    if (val !== undefined) return interpolate(val, params);
    const fallbackVal = getNestedValue(dictionaries['en-US'], key);
    if (fallbackVal !== undefined) return interpolate(fallbackVal, params);
    return key;
  };

  return {
    locale,
    isZh: locale === 'zh-CN',
    isEn: locale === 'en-US',
    t,
    dict: activeDict,
    dictionary: activeDict,
  };
}
