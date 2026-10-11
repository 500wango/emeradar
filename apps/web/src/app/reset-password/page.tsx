'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, Lock, AlertCircle } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/lib/i18n';

function ResetPasswordForm() {
  const params = useSearchParams();
  const { t } = useI18n();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t('auth.invalidResetToken'));
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) return setError(t('auth.passwordTooShort'));
    if (password !== confirmation) return setError(t('auth.passwordMismatch'));
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/v1/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || t('auth.passwordResetFailed'));
      setDone(true);
    } catch (err: any) {
      setError(err.message || t('auth.passwordResetFailed'));
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] flex flex-col justify-center bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-md text-center">
        <Link href="/login" className="inline-block mb-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Logo variant="header" className="h-10 w-auto mx-auto" idPrefix="reset" /></Link>
        <h1 className="text-2xl font-extrabold text-slate-900">{t('auth.resetPasswordTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('auth.resetPasswordDesc')}</p>
      </div>
      <section className="mx-auto mt-8 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {done ? (
          <div className="text-center" role="status">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-4 text-sm text-slate-700">{t('auth.passwordResetSuccess')}</p>
            <Link href="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{t('auth.backToLogin')}<ArrowRight className="h-4 w-4" /></Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
            <p id="reset-password-requirements" className="sr-only">{t('auth.passwordTooShort')}</p>
            <label htmlFor="reset-password" className="block text-sm font-semibold text-slate-700">{t('auth.newPasswordLabel')}<span className="relative mt-1.5 block"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-describedby="reset-password-requirements" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" /></span></label>
            <label htmlFor="reset-password-confirmation" className="block text-sm font-semibold text-slate-700">{t('auth.confirmPasswordLabel')}<span className="relative mt-1.5 block"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input id="reset-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} aria-describedby="reset-password-requirements" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" /></span></label>
            <button type="submit" disabled={loading || !token} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{loading ? t('auth.resettingPassword') : t('auth.resetPasswordBtn')}<ArrowRight className="h-4 w-4" /></button>
            <Link href="/login" className="block text-center text-sm font-semibold text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{t('auth.backToLogin')}</Link>
          </form>
        )}
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><ResetPasswordForm /></Suspense>;
}
