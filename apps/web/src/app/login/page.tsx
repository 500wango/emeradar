'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import {
  ShieldCheck,
  ArrowRight,
  Lock,
  Mail,
  AlertCircle,
  Loader2,
} from 'lucide-react';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { login } = useAuth();
  const { t, isZh } = useI18n();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError(isZh ? '请输入您的邮箱地址' : 'Please enter your email address');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const loggedUser = await login(email, password);
      const explicitNext = searchParams.get('next');
      // Only allow same-origin relative paths to prevent open-redirect attacks
      // (e.g. //evil.com, https://evil.com, javascript:...). Filter out
      // role-inappropriate landing pages for ADMINs.
      const isSafeNext =
        !!explicitNext &&
        explicitNext.startsWith('/') &&
        !explicitNext.startsWith('//') &&
        !explicitNext.includes('://') &&
        !/^javascript:/i.test(explicitNext);
      if (loggedUser.role === 'ADMIN') {
        const adminFallback = isSafeNext && !['/projects', '/billing', '/alerts'].includes(explicitNext!)
          ? explicitNext!
          : '/admin';
        router.push(adminFallback);
      } else {
        router.push(isSafeNext ? explicitNext! : '/feed');
      }
    } catch (err: any) {
      setError(err.message || (isZh ? '登录失败，请核对您的邮箱和密码。' : 'Failed to sign in. Please verify your email and password.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link href="/" className="inline-block mb-6">
          <Logo variant="header" className="h-10 w-auto mx-auto" idPrefix="login" />
        </Link>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {t('auth.loginTitle')}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {t('auth.loginDesc')}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-2xl border border-slate-200/80">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">{t('auth.loginFailed')}</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 text-slate-400 font-medium tracking-wider">
                {t('auth.orEmail')}
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t('auth.emailLabel')}
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  required
                  className="block w-full pl-10 pr-3 py-2.5 bg-slate-50/50 border border-slate-300 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  {t('auth.passwordLabel')}
                </label>
              </div>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  className="block w-full pl-10 pr-3 py-2.5 bg-slate-50/50 border border-slate-300 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-sm shadow-blue-500/20 disabled:opacity-60 transition"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('auth.signingIn')}</span>
                </>
              ) : (
                <>
                  <span>{t('auth.signInBtn')}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer inside card */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{t('auth.newToPlatform')}</span>
            <Link
              href="/register"
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              {t('auth.createAccountLink')}
            </Link>
          </div>
        </div>

        {/* Security badge */}
        <div className="mt-6 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>{t('auth.securityFootnote')}</span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
