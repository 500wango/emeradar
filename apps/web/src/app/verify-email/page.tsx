'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, AlertCircle, Loader2, Mail } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';

function VerifyEmailContent() {
  const params = useSearchParams();
  const { refreshUser } = useAuth();
  const { isZh } = useI18n();
  const token = params.get('token') || '';
  const sent = params.get('sent') === '1';
  const [state, setState] = useState<'loading' | 'success' | 'error' | 'pending'>(token ? 'loading' : sent ? 'pending' : 'error');

  useEffect(() => {
    if (!token) return;
    fetch('/api/v1/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      if (!response.ok) throw new Error('invalid');
      await refreshUser();
      setState('success');
    }).catch(() => setState('error'));
  }, [refreshUser, token]);

  return (
    <main className="min-h-[calc(100vh-4rem)] flex flex-col justify-center bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-md text-center">
        <Link href="/" className="inline-block mb-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Logo variant="header" className="h-10 w-auto mx-auto" idPrefix="verify" /></Link>
        <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          {state === 'loading' && <><Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" /><p className="mt-4 text-sm text-slate-600">{isZh ? '正在确认邮箱…' : 'Verifying your email…'}</p></>}
          {state === 'pending' && <><Mail className="mx-auto h-8 w-8 text-blue-600" /><h1 className="mt-4 text-xl font-bold text-slate-900">{isZh ? '验证邮件已发送' : 'Verification email sent'}</h1><p className="mt-2 text-sm text-slate-600">{isZh ? '请打开邮箱中的链接完成验证。链接 24 小时内有效。' : 'Open the link in your inbox to verify your account. The link is valid for 24 hours.'}</p><Link href="/settings" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{isZh ? '进入账户设置' : 'Open account settings'}<ArrowRight className="h-4 w-4" /></Link></>}
          {state === 'success' && <><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><h1 className="mt-4 text-xl font-bold text-slate-900">{isZh ? '邮箱已验证' : 'Email verified'}</h1><p className="mt-2 text-sm text-slate-600">{isZh ? '现在可以生成报告、创建项目并接收告警。' : 'You can now generate reports, create projects, and receive alerts.'}</p><Link href="/feed" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{isZh ? '进入机会流' : 'Open opportunity feed'}<ArrowRight className="h-4 w-4" /></Link></>}
          {state === 'error' && <><AlertCircle className="mx-auto h-8 w-8 text-rose-600" /><h1 className="mt-4 text-xl font-bold text-slate-900">{isZh ? '验证链接无效或已过期' : 'Verification link is invalid or expired'}</h1><p className="mt-2 text-sm text-slate-600">{isZh ? '请登录后从账户设置重新发送验证邮件。' : 'Sign in and resend the verification email from account settings.'}</p><Link href="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{isZh ? '返回登录' : 'Back to sign in'}<ArrowRight className="h-4 w-4" /></Link></>}
        </section>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><VerifyEmailContent /></Suspense>;
}
