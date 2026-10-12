'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { ArrowRight, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AuthError, AuthShell } from '@/components/ui/AuthShell';
import { buttonVariants } from '@/components/ui/Button';
import { Input, FieldLabel } from '@/components/ui/Field';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { login } = useAuth();
  const { t } = useI18n();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError(t('auth.emailRequired'));
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
      setError(err.message || t('auth.loginFailedHint'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.loginTitle')}
      desc={t('auth.loginDesc')}
      footnote={
        <>
          <ShieldCheck className="h-3.5 w-3.5 text-signal" />
          {t('auth.securityFootnote')}
        </>
      }
    >
      {error && <AuthError title={t('auth.loginFailed')} message={error} />}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <FieldLabel htmlFor="login-email">{t('auth.emailLabel')}</FieldLabel>
          <div className="relative mt-2">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              required
              className="pl-10"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="login-password">{t('auth.passwordLabel')}</FieldLabel>
            <Link href="/forgot-password" className="font-mono text-[11px] text-accent transition-colors hover:brightness-110">
              {t('auth.forgotPasswordLink')}
            </Link>
          </div>
          <div className="relative mt-2">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              className="pl-10"
            />
          </div>
        </div>

        <button type="submit" disabled={loading} className={cn(buttonVariants({ size: 'md' }), 'mt-1 w-full')}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('auth.signingIn')}
            </>
          ) : (
            <>
              {t('auth.signInBtn')}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-xs text-fg-subtle">
        <span>{t('auth.newToPlatform')}</span>
        <Link href="/register" className="font-mono text-accent transition-colors hover:brightness-110">
          {t('auth.createAccountLink')}
        </Link>
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </main>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
