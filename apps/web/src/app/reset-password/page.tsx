'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { AuthError, AuthShell } from '@/components/ui/AuthShell';
import { buttonVariants } from '@/components/ui/Button';
import { Input, FieldHint, FieldLabel } from '@/components/ui/Field';

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
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || t('auth.passwordResetFailed'));
      setDone(true);
    } catch (err: any) {
      setError(err.message || t('auth.passwordResetFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t('auth.resetPasswordTitle')} desc={t('auth.resetPasswordDesc')}>
      {done ? (
        <div className="text-center" role="status">
          <CheckCircle2 className="mx-auto h-7 w-7 text-signal" />
          <p className="mt-5 text-sm leading-relaxed text-fg-muted">{t('auth.passwordResetSuccess')}</p>
          <Link href="/login" className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'mt-7')}>
            {t('auth.backToLogin')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <AuthError message={error} />}

          <div>
            <FieldLabel htmlFor="reset-password">{t('auth.newPasswordLabel')}</FieldLabel>
            <div className="relative mt-2">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                id="reset-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                aria-describedby="reset-password-requirements"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="reset-password-confirmation">{t('auth.confirmPasswordLabel')}</FieldLabel>
            <div className="relative mt-2">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                id="reset-password-confirmation"
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                aria-describedby="reset-password-requirements"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="pl-10"
              />
            </div>
            <FieldHint className="mt-2">
              <span id="reset-password-requirements">{t('auth.passwordTooShort')}</span>
            </FieldHint>
          </div>

          <button
            type="submit"
            disabled={loading || !token}
            className={cn(buttonVariants({ size: 'md' }), 'w-full')}
          >
            {loading ? t('auth.resettingPassword') : t('auth.resetPasswordBtn')}
            <ArrowRight className="h-4 w-4" />
          </button>

          <Link
            href="/login"
            className="block text-center font-mono text-xs text-fg-subtle transition-colors hover:text-fg"
          >
            {t('auth.backToLogin')}
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
