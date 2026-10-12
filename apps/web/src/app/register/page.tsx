'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { ArrowRight, Loader2, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AuthError, AuthShell } from '@/components/ui/AuthShell';
import { buttonVariants } from '@/components/ui/Button';
import { Input, FieldLabel } from '@/components/ui/Field';

function RegisterFormContent() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useI18n();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError(t('auth.emailPasswordRequired'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await register({
        email,
        password,
        displayName: displayName || undefined,
      });
      router.push('/verify-email?sent=1&next=%2Fonboarding');
    } catch (err: any) {
      setError(err.message || t('auth.registerFailedHint'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.registerTitle')}
      desc={t('auth.registerDesc')}
      width="lg"
      footnote={
        <>
          <ShieldCheck className="h-3.5 w-3.5 text-signal" />
          {t('auth.securityFootnote')}
        </>
      }
    >
      {error && <AuthError title={t('auth.registerFailed')} message={error} />}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <FieldLabel htmlFor="register-name">{t('auth.nameLabel')}</FieldLabel>
          <div className="relative mt-2">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="register-name"
              name="name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('auth.namePlaceholder')}
              className="pl-10"
            />
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="register-email">{t('auth.emailLabel')}</FieldLabel>
          <div className="relative mt-2">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="register-email"
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
          <FieldLabel htmlFor="register-password">{t('auth.passwordLabel')}</FieldLabel>
          <div className="relative mt-2">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordMinPlaceholder')}
              required
              minLength={8}
              className="pl-10"
            />
          </div>
        </div>

        <button type="submit" disabled={loading} className={cn(buttonVariants({ size: 'md' }), 'mt-1 w-full')}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('auth.signingUp')}
            </>
          ) : (
            <>
              {t('auth.signUpBtn')}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-xs text-fg-subtle">
        <span>{t('auth.alreadyHaveAccount')}</span>
        <Link href="/login" className="font-mono text-accent transition-colors hover:brightness-110">
          {t('auth.signInLink')}
        </Link>
      </div>
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </main>
      }
    >
      <RegisterFormContent />
    </Suspense>
  );
}
