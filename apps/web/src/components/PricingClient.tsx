'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Award,
  Check,
  ChevronDown,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { planLabelKey, resolvePlanCode } from '@/lib/plan-display';
import { Badge } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';
import { Meter } from '@/components/ui/Meter';
import { PageFrame } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';
import type { UserEntitlementsInfo } from '@emeradar/services';

interface PricingClientProps {
  entitlements?: UserEntitlementsInfo | null;
  isLoggedIn?: boolean;
}

/** Zero-padded section marker, the same one the methodology page uses. */
function SectionMark({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
      <span className="text-accent">{index}</span> · {children}
    </h2>
  );
}

export function PricingClient({ entitlements, isLoggedIn = false }: PricingClientProps) {
  const { t, dictionary, isZh } = useI18n();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null);

  // The plan named here must be the one the quotas below were computed from.
  const planCode = resolvePlanCode(entitlements);
  const isPro = planCode === 'PRO';
  const isFree = !isPro;

  const p = dictionary.pricing;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const isSuccess = params.get('success') === 'true' || params.get('status') === 'success';
    const reason = params.get('reason');
    const feature = params.get('feature');

    if (sessionId && isSuccess) {
      setSuccessBanner(
        isZh
          ? '方案已激活，您的工作区配额已即时更新。'
          : 'Your plan is active and your quota has been upgraded.'
      );
      fetch('/api/v1/billing/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(console.error);
    } else if (reason === 'quota_exceeded') {
      setNoticeBanner(
        isZh
          ? '您当前的免费体验版包含每月 1 份商业机会深度研报额度（已体验 1/1）。升级套餐即可即时解锁全量研报、代码脚手架与自动化监控。'
          : 'You have reached your 1 free monthly report limit. Upgrade to Builder Pro to unlock 30 full opportunity reports per month.'
      );
    } else if (feature === 'opportunity-detail') {
      setNoticeBanner(
        isZh
          ? '商业机会决策工作台（包含需求分析、弱站穿透分析与真实结账证据）仅向 Builder Pro 会员开放。'
          : 'Full opportunity decision workspace is available for Builder Pro members.'
      );
    }
  }, [isZh]);

  const handleUpgrade = async (
    planCode: 'PRO',
    cycle: 'monthly' | 'yearly' | 'lifetime' = billingCycle,
  ) => {
    if (!isLoggedIn) {
      window.location.href = `/register?plan=${planCode.toLowerCase()}`;
      return;
    }
    const checkoutKey = cycle === 'lifetime' ? 'PRO_LIFETIME' : planCode;
    setLoadingPlan(checkoutKey);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode, billingCycle: cycle }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        console.error('Failed to start Stripe checkout session:', data);
        alert(t('pricing.checkoutFailed'));
      }
    } catch (err: any) {
      console.error('Error connecting to checkout service:', err);
      alert(t('pricing.checkoutError'));
    } finally {
      setLoadingPlan(null);
    }
  };

  const quotas = entitlements
    ? [
        {
          key: 'reports',
          label: p.monthlyReports,
          used: entitlements.reportGenerationUsed,
          limit: entitlements.reportGenerationMonthlyLimit,
          detail: t('pricing.used', {
            used: entitlements.reportGenerationUsed,
            limit: entitlements.reportGenerationMonthlyLimit,
          }),
          note: t('pricing.remaining', { remaining: entitlements.remainingReportGenerations }),
          tone: 'accent' as const,
        },
        {
          key: 'exports',
          label: p.reportExports,
          used: entitlements.exportReportsUsed,
          limit: entitlements.exportReportsMonthlyLimit,
          detail: t('pricing.used', {
            used: entitlements.exportReportsUsed,
            limit: entitlements.exportReportsMonthlyLimit,
          }),
          note: t('pricing.remaining', { remaining: entitlements.remainingReports }),
          tone: 'neutral' as const,
        },
        {
          key: 'projects',
          label: p.trackedProjects,
          used: entitlements.currentProjectsCount,
          limit: entitlements.maxProjects,
          detail: t('pricing.active', {
            active: entitlements.currentProjectsCount,
            limit: entitlements.maxProjects,
          }),
          note: p.gscSyncIncluded,
          tone: 'signal' as const,
        },
        {
          key: 'alerts',
          label: p.alertRules,
          used: entitlements.currentAlertsCount,
          limit: entitlements.maxAlerts,
          detail: t('pricing.alertsConfigured', {
            count: entitlements.currentAlertsCount,
            limit: entitlements.maxAlerts,
          }),
          note: p.webhookDelivery,
          tone: 'warn' as const,
        },
      ]
    : [];

  return (
    <PageFrame width="full">
      {successBanner && (
        <Panel tone="raised" className="mb-8 flex items-center gap-3 border-signal/40 p-4">
          <Badge tone="signal">ACTIVE</Badge>
          <span className="text-sm text-fg-muted">{successBanner}</span>
        </Panel>
      )}
      {noticeBanner && (
        <Panel tone="raised" className="mb-8 flex items-start gap-3 border-warn/40 p-4 sm:p-5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <span className="text-sm leading-relaxed text-fg-muted">{noticeBanner}</span>
        </Panel>
      )}

      {/* Hero */}
      <header className="mx-auto max-w-3xl text-center">
        <Badge tone="accent" size="sm">
          {p.badge}
        </Badge>
        <h1 className="mt-6 font-display text-3xl font-extrabold leading-[1.15] tracking-tight text-fg sm:text-5xl sm:leading-[1.15]">
          {p.title}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base sm:leading-relaxed">
          {p.desc}
        </p>

        <div className="mt-9 inline-flex items-center gap-1 border border-line bg-surface-2 p-1">
          {(['monthly', 'yearly'] as const).map((cycle) => (
            <button
              key={cycle}
              type="button"
              onClick={() => setBillingCycle(cycle)}
              aria-pressed={billingCycle === cycle}
              className={cn(
                'inline-flex items-center gap-2 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors',
                billingCycle === cycle
                  ? 'bg-surface text-fg'
                  : 'text-fg-subtle hover:text-fg'
              )}
            >
              {cycle === 'monthly' ? p.monthly : p.yearly}
              {cycle === 'yearly' && (
                <span className={cn('text-[10px]', billingCycle === 'yearly' ? 'text-signal' : 'text-fg-subtle')}>
                  {p.save20Short}
                </span>
              )}
            </button>
          ))}
        </div>

        {p.marketFocusNotice && (
          <p className="mx-auto mt-6 max-w-2xl border-l border-warn/60 pl-4 text-left text-xs leading-relaxed text-fg-muted">
            {p.marketFocusNotice}
          </p>
        )}
      </header>

      {/* Current quotas — only for a signed-in visitor. */}
      {entitlements && (
        <Panel brackets className="mt-14 p-6 sm:p-8">
          <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                  {p.currentPlan}
                </span>
                <Badge tone="accent">{t(planLabelKey(planCode))}</Badge>
              </div>
              <p className="mt-2 font-display text-lg font-bold text-fg">
                {t('pricing.workspaceTier', { tier: t(planLabelKey(planCode)) })}
              </p>
            </div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-accent transition-colors hover:brightness-110"
            >
              {t('settings.managePlan')}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-7 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {quotas.map((quota) => (
              <div key={quota.key}>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                  {quota.label}
                </span>
                <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-fg">
                  {quota.used}
                  <span className="ml-1.5 text-xs font-normal text-fg-subtle">{quota.detail}</span>
                </div>
                <Meter
                  className="mt-3"
                  value={quota.used}
                  max={quota.limit}
                  tone={quota.tone}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">{quota.note}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Plans */}
      <section className="mt-16">
        <h2 className="sr-only">{p.plansHeading}</h2>
        <div className="grid items-stretch gap-6 lg:grid-cols-3">
        {/* Free */}
        <Panel brackets className="flex flex-col p-8">
          <div className="flex-1">
            <Badge tone="neutral">FREE</Badge>
            <h3 className="mt-5 font-display text-2xl font-extrabold text-fg">{p.planFreeTitle}</h3>
            <p className="mt-2 min-h-[36px] text-xs leading-relaxed text-fg-subtle">{p.planFreeDesc}</p>

            <div className="mt-6 flex items-baseline gap-2 border-b border-line pb-6">
              <span className="font-mono text-4xl font-bold tabular-nums text-fg">{p.planFreePrice}</span>
              <span className="font-mono text-xs text-fg-subtle">{p.perForever}</span>
            </div>

            <ul className="mt-6 space-y-3.5 text-xs leading-relaxed text-fg-muted">
              {p.freeFeatures.map((feat: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 border-t border-line pt-6">
            {isLoggedIn && isFree ? (
              <button
                disabled
                className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'w-full cursor-not-allowed')}
              >
                {p.includedBaseline}
              </button>
            ) : (
              <Link
                href="/register"
                className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'w-full')}
              >
                {p.getStartedFree}
              </Link>
            )}
          </div>
        </Panel>

        {/* Builder Pro — the highlighted tier. Highlight is a hairline weight
            difference plus a corner tag, not a gradient or a drop shadow. */}
        <Panel brackets className="relative flex flex-col border-accent/60 p-8">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge tone="accent" size="sm">
              {p.popularBadge}
            </Badge>
          </div>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">PRO</Badge>
              {p.proEarlyBirdBadge && <Badge tone="warn">{p.proEarlyBirdBadge}</Badge>}
            </div>
            <h3 className="mt-5 font-display text-2xl font-extrabold text-fg">{p.planProTitle}</h3>
            <p className="mt-2 min-h-[36px] text-xs leading-relaxed text-fg-subtle">{p.planProDesc}</p>

            <div className="mt-6 border-b border-line pb-6">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-4xl font-bold tabular-nums text-accent sm:text-5xl">
                  {billingCycle === 'yearly' ? p.planProYearlyPrice : p.planProMonthlyPrice}
                </span>
                <span className="font-mono text-xs text-fg-subtle">{p.perMonth}</span>
              </div>
              <p className="mt-2 font-mono text-[11px] text-fg-subtle">
                {billingCycle === 'yearly' ? p.planProBilledYearly : p.billedMonthly}
              </p>
            </div>

            <ul className="mt-6 space-y-3.5 text-xs font-medium leading-relaxed text-fg-muted">
              {p.proFeatures.map((feat: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 border-t border-line pt-6">
            {isLoggedIn && isPro ? (
              <button disabled className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'w-full')}>
                {p.currentActive}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleUpgrade('PRO')}
                disabled={loadingPlan === 'PRO'}
                className={cn(buttonVariants({ size: 'md' }), 'w-full')}
              >
                {loadingPlan === 'PRO'
                  ? p.connectingStripe
                  : isLoggedIn
                    ? p.upgradeNow
                    : p.startTrial}
              </button>
            )}
            <p className="mt-3 text-center font-mono text-[10px] text-fg-subtle">{p.cancelAnytime}</p>
          </div>
        </Panel>

        {/* Founding lifetime */}
        <Panel brackets tone="raised" className="flex flex-col p-8">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">LIFETIME</Badge>
              <Badge tone="neutral">{p.proEarlyBirdBadge}</Badge>
            </div>
            <h3 className="mt-5 font-display text-2xl font-extrabold text-fg">
              {p.lifetimeEarlyBirdTitle}
            </h3>
            <p className="mt-2 min-h-[36px] text-xs leading-relaxed text-fg-subtle">
              {p.lifetimeEarlyBirdDesc}
            </p>

            <div className="mt-6 border-b border-line pb-6">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-4xl font-bold tabular-nums text-warn sm:text-5xl">
                  {p.lifetimePrice}
                </span>
                <span className="font-mono text-xs text-fg-subtle">{p.oneTime}</span>
              </div>
              <p className="mt-2 font-mono text-[11px] text-fg-subtle">{p.lifetimeFinePrint}</p>
            </div>

            <ul className="mt-6 space-y-3.5 text-xs font-medium leading-relaxed text-fg-muted">
              {p.proFeatures.map((feat: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 border-t border-line pt-6">
            <button
              type="button"
              onClick={() => handleUpgrade('PRO', 'lifetime')}
              disabled={loadingPlan === 'PRO_LIFETIME' || (isLoggedIn && isPro)}
              className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'w-full')}
            >
              {loadingPlan === 'PRO_LIFETIME' ? p.lifetimeCheckoutLoading : isPro ? p.currentActive : p.lifetimeCta}
            </button>
            <p className="mt-3 text-center font-mono text-[10px] text-fg-subtle">{p.lifetimeNote}</p>
          </div>
        </Panel>
        </div>
      </section>

      {/* Value anchor. `inverse` is the paired surface: a dark slab in the light
          theme, a raised panel in the Observatory theme — so the same block
          differentiates itself in both. */}
      <Panel tone="inverse" className="mt-20 p-8 sm:p-12">
        <SectionMark index="01">{p.roiBadge}</SectionMark>
        <h2 className="mt-4 max-w-2xl font-display text-2xl font-extrabold tracking-tight text-inverse-fg sm:text-3xl">
          {p.whyTitle}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-inverse-fg-muted">{p.whySubtitle}</p>

        <div className="mt-10 grid gap-8 border-t border-inverse-line pt-8 md:grid-cols-3">
          <div>
            <div className="font-mono text-3xl font-bold tabular-nums text-warn sm:text-4xl">
              {p.stat1Number}
            </div>
            <h3 className="mt-2 text-sm font-bold text-inverse-fg">{p.stat1Label}</h3>
            <p className="mt-2 text-xs leading-relaxed text-inverse-fg-subtle">{p.stat1Desc}</p>
          </div>
          <div>
            <div className="font-mono text-3xl font-bold tabular-nums text-axis-m sm:text-4xl">
              {p.stat2Number}
            </div>
            <h3 className="mt-2 text-sm font-bold text-inverse-fg">{p.stat2Label}</h3>
            <p className="mt-2 text-xs leading-relaxed text-inverse-fg-subtle">{p.stat2Desc}</p>
          </div>
          <div>
            <div className="font-mono text-3xl font-bold tabular-nums text-signal sm:text-4xl">
              {p.stat3Number}
            </div>
            <h3 className="mt-2 text-sm font-bold text-inverse-fg">{p.stat3Label}</h3>
            <p className="mt-2 text-xs leading-relaxed text-inverse-fg-subtle">{p.stat3Desc}</p>
          </div>
        </div>
      </Panel>

      {/* Feature matrix */}
      <Panel className="mt-20 overflow-hidden">
        <div className="border-b border-line p-6 sm:p-8">
          <SectionMark index="02">{p.matrixTitle}</SectionMark>
          <p className="mt-3 text-xs leading-relaxed text-fg-muted sm:text-sm sm:leading-relaxed">{p.matrixSubtitle}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className="w-2/5 px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  {p.colFeature}
                </th>
                <th className="px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  {p.colFree}
                </th>
                <th className="bg-accent/5 px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-accent">
                  {p.colPro}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.matrixRows.map((row: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-5 py-4 text-sm font-medium text-fg">{row.feature}</td>
                  <td className="px-5 py-4 text-sm text-fg-muted">{row.free}</td>
                  <td className="bg-accent/5 px-5 py-4 font-mono text-xs text-accent">{row.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Guarantees */}
      <Panel tone="sunken" className="mt-8 p-8">
        <SectionMark index="03">{p.guaranteeTitle}</SectionMark>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-fg-muted sm:text-sm sm:leading-relaxed">{p.guaranteeDesc}</p>
        <div className="mt-7 grid gap-px sm:grid-cols-3">
          {[
            { icon: ShieldCheck, label: p.badgeCancel, tone: 'text-signal' },
            { icon: Award, label: p.badgeLifetime, tone: 'text-accent' },
            { icon: Layers, label: p.badgeCrypto, tone: 'text-info' },
          ].map(({ icon: Icon, label, tone }) => (
            <div key={label} className="flex items-center gap-3 border-l border-line py-3 pl-4">
              <Icon className={cn('h-4 w-4 shrink-0', tone)} />
              <span className="text-xs leading-relaxed text-fg-muted">{label}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* FAQ */}
      <section className="mx-auto mt-20 max-w-3xl">
        <div className="text-center">
          <Badge tone="neutral" size="sm">
            {p.faqBadge}
          </Badge>
          <h2 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-fg sm:text-3xl">
            {p.faqTitle}
          </h2>
          <p className="mt-3 text-xs leading-relaxed text-fg-subtle sm:text-sm sm:leading-relaxed">{p.faqSubtitle}</p>
        </div>

        <div className="mt-10 divide-y divide-line border-y border-line">
          {p.faqs.map((faq: any, idx: number) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div key={idx}>
                <button
                  type="button"
                  onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-semibold text-fg transition-colors hover:text-accent"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-200',
                      isOpen && 'rotate-180 text-accent'
                    )}
                  />
                </button>
                {isOpen && (
                  <p className="pb-5 text-xs leading-relaxed text-fg-muted sm:text-sm sm:leading-relaxed">{faq.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Closing CTA */}
      <Panel brackets className="mt-20 p-8 text-center sm:p-12">
        <h2 className="mx-auto max-w-2xl font-display text-2xl font-extrabold tracking-tight text-fg sm:text-4xl">
          {p.bottomCtaTitle}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-xs leading-relaxed text-fg-muted sm:text-sm sm:leading-relaxed">
          {p.bottomCtaDesc}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
          <Link href="/register" className={buttonVariants({ size: 'lg' })}>
            {p.bottomCtaBtn}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/track-record"
            className="border-b border-line-strong pb-1 font-mono text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
          >
            {p.bottomCtaTrackRecord}
          </Link>
        </div>
      </Panel>
    </PageFrame>
  );
}
