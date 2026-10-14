'use client';

import Link from 'next/link';
import { Logo } from './Logo';
import { useI18n } from '@/lib/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Footer() {
  const { t } = useI18n();

  const linkClasses = 'text-xs text-fg-subtle transition-colors hover:text-accent';

  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-3">
            <Logo variant="header" className="h-7 w-auto" idPrefix="footer" />
            <span aria-hidden="true" className="text-xs text-fg-subtle">|</span>
            <span className="text-xs text-fg-subtle">{t('footer.tagline')}</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <Link href="/track-record" className={linkClasses}>
              {t('footer.trackRecord')}
            </Link>
            <Link href="/methodology" className={linkClasses}>
              {t('footer.methodology')}
            </Link>
            <Link href="/pricing" className={linkClasses}>
              {t('footer.pricing')}
            </Link>
            <Link href="/about" className={linkClasses}>
              {t('footer.about')}
            </Link>
            <Link href="/contact" className={linkClasses}>
              {t('footer.contact')}
            </Link>
            <Link href="/privacy" className={linkClasses}>
              {t('footer.privacy')}
            </Link>
            <Link href="/terms" className={linkClasses}>
              {t('footer.terms')}
            </Link>
            <LanguageSwitcher variant="toggle" />
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-line pt-6 text-xs text-fg-subtle sm:flex-row">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <p>{t('footer.builtFor')}</p>
        </div>
      </div>
    </footer>
  );
}
