'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Logo } from './Logo';
import { useI18n } from '@/lib/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="bg-white border-t border-slate-200 mt-20">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo variant="header" className="h-7 w-auto" idPrefix="footer" />
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">
              {t('footer.tagline')}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-500">
            <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>{t('footer.merkleProof')}</span>
            </div>
            <Link href="/track-record" className="hover:text-blue-600 transition-colors">
              {t('footer.trackRecord')}
            </Link>
            <Link href="/feed" className="hover:text-blue-600 transition-colors">
              {t('footer.liveFeed')}
            </Link>
            <Link href="/billing" className="hover:text-blue-600 transition-colors">
              {t('footer.pricing')}
            </Link>
            <LanguageSwitcher variant="toggle" />
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <p>{t('footer.builtFor')}</p>
        </div>
      </div>
    </footer>
  );
}
