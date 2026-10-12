'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { AuthShell } from '@/components/ui/AuthShell';
import { buttonVariants } from '@/components/ui/Button';

/**
 * Three ways in: a token to redeem, a "we just sent it" landing from sign-up,
 * and everything else (a link that arrived damaged). The state machine is
 * derived from the query string on first render, then updated by the request.
 */
function VerifyEmailContent() {
  const params = useSearchParams();
  const { refreshUser } = useAuth();
  const { t } = useI18n();
  const token = params.get('token') || '';
  const sent = params.get('sent') === '1';
  const [state, setState] = useState<'loading' | 'success' | 'error' | 'pending'>(
    token ? 'loading' : sent ? 'pending' : 'error'
  );

  useEffect(() => {
    if (!token) return;
    fetch('/api/v1/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('invalid');
        await refreshUser();
        setState('success');
      })
      .catch(() => setState('error'));
  }, [refreshUser, token]);

  const copy = {
    loading: { icon: null, title: t('auth.verifyingEmail'), desc: null, cta: null, href: '/' },
    pending: {
      icon: <Mail className="mx-auto h-7 w-7 text-accent" />,
      title: t('auth.verificationSentTitle'),
      desc: t('auth.verificationSentDesc'),
      cta: t('auth.openSettings'),
      href: '/settings',
    },
    success: {
      icon: <CheckCircle2 className="mx-auto h-7 w-7 text-signal" />,
      title: t('auth.emailVerifiedTitle'),
      desc: t('auth.emailVerifiedDesc'),
      cta: t('auth.openFeed'),
      href: '/feed',
    },
    error: {
      icon: <AlertCircle className="mx-auto h-7 w-7 text-danger" />,
      title: t('auth.invalidLinkTitle'),
      desc: t('auth.invalidLinkDesc'),
      cta: t('auth.backToLogin'),
      href: '/login',
    },
  }[state];

  return (
    <AuthShell title={copy.title} desc={copy.desc}>
      <div className="text-center" role={state === 'loading' ? undefined : 'status'}>
        {state === 'loading' ? (
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-accent" />
        ) : (
          copy.icon
        )}
        {copy.cta && (
          <Link href={copy.href} className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'mt-7')}>
            {copy.cta}
          </Link>
        )}
      </div>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
