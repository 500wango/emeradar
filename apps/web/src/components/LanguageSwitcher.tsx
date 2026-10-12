'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

interface LanguageSwitcherProps {
  variant?: 'dropdown' | 'toggle' | 'minimal';
  className?: string;
}

export function LanguageSwitcher({
  variant = 'dropdown',
  className = '',
}: LanguageSwitcherProps) {
  const { locale, setLocale, locales, localeLabels } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (variant === 'toggle') {
    return (
      <div
        className={cn(
          'inline-flex items-center rounded-sm border border-line bg-surface-2 p-0.5 text-xs font-semibold',
          className
        )}
      >
        <button
          type="button"
          onClick={() => setLocale('zh-CN')}
          className={cn(
            'rounded-sm px-2.5 py-1 transition-colors',
            locale === 'zh-CN' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
          )}
        >
          中文
        </button>
        <button
          type="button"
          onClick={() => setLocale('en-US')}
          className={cn(
            'rounded-sm px-2.5 py-1 transition-colors',
            locale === 'en-US' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
          )}
        >
          EN
        </button>
      </div>
    );
  }

  if (variant === 'minimal') {
    return (
      <button
        type="button"
        onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
        className={cn(
          'inline-flex items-center gap-1.5 font-mono text-xs tracking-wider text-fg-subtle transition-colors hover:text-fg',
          className
        )}
        title={locale === 'zh-CN' ? 'Switch to English' : '切换至简体中文'}
      >
        <Globe className="h-3.5 w-3.5" />
        <span>{locale === 'zh-CN' ? 'EN' : '中文'}</span>
      </button>
    );
  }

  return (
    <div className={cn('relative inline-block text-left', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line-control bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:border-accent hover:bg-surface-2"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Globe className="h-3.5 w-3.5 text-accent" />
        <span>{localeLabels[locale]}</span>
        <ChevronDown className="h-3 w-3 text-fg-subtle" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-36 rounded-sm border border-line bg-surface py-1 shadow-lg">
          {locales.map((loc) => {
            const active = locale === loc;
            return (
              <button
                key={loc}
                type="button"
                onClick={() => {
                  setLocale(loc);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium transition-colors',
                  active
                    ? 'bg-accent/10 font-semibold text-accent'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                )}
              >
                <span>{localeLabels[loc]}</span>
                {active && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
