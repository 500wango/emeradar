'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { AuthError, AuthShell } from '@/components/ui/AuthShell';
import { buttonVariants } from '@/components/ui/Button';
import { Input, FieldLabel } from '@/components/ui/Field';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || t('auth.passwordResetFailed'));
      setSent(true);
    } catch (err: any) {
      setError(err.message || t('auth.passwordResetFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={t('auth.forgotPasswordTitle')}
      desc={t('auth.forgotPasswordDesc')}
      footnote={t('auth.uniformResultNote')}
    >
      {sent ? (
        <div className="text-center" role="status">
          <CheckCircle2 className="mx-auto h-7 w-7 text-signal" />
          <p className="mt-5 text-sm leading-relaxed text-fg-muted">{t('auth.resetLinkSent')}</p>
          <Link href="/login" className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'mt-7')}>
            {t('auth.backToLogin')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <AuthError message={error} />}

          <div>
            <FieldLabel htmlFor="forgot-password-email">{t('auth.emailLabel')}</FieldLabel>
            <div className="relative mt-2">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                id="forgot-password-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="pl-10"
              />
            </div>
          </div>

          <button type="submit" disabled={loading} className={cn(buttonVariants({ size: 'md' }), 'w-full')}>
            {loading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
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
