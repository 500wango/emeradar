'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

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
      <div className={`inline-flex items-center rounded-xl bg-slate-100 p-0.5 border border-slate-200 text-xs font-semibold ${className}`}>
        <button
          type="button"
          onClick={() => setLocale('zh-CN')}
          className={`px-2.5 py-1 rounded-lg transition-all ${
            locale === 'zh-CN'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          中文
        </button>
        <button
          type="button"
          onClick={() => setLocale('en-US')}
          className={`px-2.5 py-1 rounded-lg transition-all ${
            locale === 'en-US'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
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
        className={`inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition ${className}`}
        title={locale === 'zh-CN' ? 'Switch to English' : '切换至简体中文'}
      >
        <Globe className="w-3.5 h-3.5 text-slate-400" />
        <span>{locale === 'zh-CN' ? 'EN' : '中文'}</span>
      </button>
    );
  }

  return (
    <div className={`relative inline-block text-left ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm hover:border-slate-300 transition"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Globe className="w-3.5 h-3.5 text-blue-600" />
        <span>{localeLabels[locale]}</span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-36 rounded-xl bg-white border border-slate-200 shadow-lg shadow-slate-200/50 py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
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
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-left transition ${
                  active
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span>{localeLabels[loc]}</span>
                {active && <Check className="w-3.5 h-3.5 text-blue-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
