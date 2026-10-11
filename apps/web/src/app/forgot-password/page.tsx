'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const { t, isZh } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || t('auth.passwordResetFailed'));
      setSent(true);
    } catch (err: any) {
      setError(err.message || t('auth.passwordResetFailed'));
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] flex flex-col justify-center bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-md text-center">
        <Link href="/login" className="inline-block mb-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Logo variant="header" className="h-10 w-auto mx-auto" idPrefix="forgot" /></Link>
        <h1 className="text-2xl font-extrabold text-slate-900">{t('auth.forgotPasswordTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('auth.forgotPasswordDesc')}</p>
      </div>
      <section className="mx-auto mt-8 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {sent ? (
          <div className="text-center" role="status">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-4 text-sm leading-relaxed text-slate-700">{t('auth.resetLinkSent')}</p>
            <Link href="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              {t('auth.backToLogin')}<ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
            <label htmlFor="forgot-password-email" className="block text-sm font-semibold text-slate-700">
              {t('auth.emailLabel')}
              <span className="relative mt-1.5 block">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="forgot-password-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('auth.emailPlaceholder')} className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
              </span>
            </label>
            <button type="submit" disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              {loading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}<ArrowRight className="h-4 w-4" />
            </button>
            <Link href="/login" className="block text-center text-sm font-semibold text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{t('auth.backToLogin')}</Link>
          </form>
        )}
      </section>
      <p className="mx-auto mt-6 max-w-md text-center text-xs text-slate-500">{isZh ? '出于安全考虑，无论邮箱是否存在都会显示相同结果。' : 'For security, the same result is shown whether or not the address exists.'}</p>
    </main>
  );
}
