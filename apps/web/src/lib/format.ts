/**
 * Returns a normalized external URL safe for use in an `href`, or `undefined`
 * when the input is missing or is not an absolute `http:`/`https:` URL.
 *
 * Crawled/third-party URLs are untrusted, so anything that is not plain web
 * content (e.g. `javascript:`, `data:` or relative garbage) is rejected instead
 * of being injected straight into the DOM.
 */
export function safeExternalUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function toValidDate(val: unknown): Date | null {
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === 'number') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Date-only strings ("2026-10-11") are parsed as UTC midnight by `new Date`,
    // which can render as the previous day in western timezones. Build them as
    // local dates so the calendar day is preserved.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnly) {
      const d = new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Format a date value for display.
 *
 * Callers should pass the user's active locale (the `locale` from `useI18n()`
 * or `getServerI18n()`); it defaults to `'zh-CN'` to preserve previous output.
 * Values that are present but not a valid date render as `'—'` instead of being
 * silently truncated.
 */
export function formatDate(val: unknown, locale: string = 'zh-CN'): string {
  if (val === null || val === undefined || val === '') return '';
  const date = toValidDate(val);
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Format a date-time value for display.
 *
 * Callers should pass the user's active locale (the `locale` from `useI18n()`
 * or `getServerI18n()`); it defaults to `'zh-CN'` to preserve previous output.
 * Values that are present but not a valid date render as `'—'` instead of being
 * silently truncated.
 */
export function formatDateTime(val: unknown, locale: string = 'zh-CN'): string {
  if (val === null || val === undefined || val === '') return '';
  const date = toValidDate(val);
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
