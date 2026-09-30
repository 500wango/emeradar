'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
  HelpCircle,
  Zap,
  Layers,
  Flame,
  Award,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { UserEntitlementsInfo } from '@emeradar/services';

interface PricingClientProps {
  entitlements?: UserEntitlementsInfo | null;
  isLoggedIn?: boolean;
}

export function PricingClient({ entitlements, isLoggedIn = false }: PricingClientProps) {
  const { t, dictionary, isZh } = useI18n();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const isPro = entitlements?.tier === 'PRO';
  const isTeam = entitlements?.tier === 'TEAM';
  const isFree = !isPro && !isTeam;

  const p = dictionary.pricing;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
      {/* Hero Section */}
      <div className="text-center max-w-4xl mx-auto mb-14">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/80 mb-5 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
          <span>{p.badge}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-[1.15]">
          {p.title}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
          {p.desc}
        </p>

        {/* Monthly / Yearly Billing Toggle */}
        <div className="mt-8 inline-flex items-center p-1.5 bg-slate-100 rounded-2xl border border-slate-200/80 shadow-inner">
          <button
            type="button"
            onClick={() => setBillingCycle('monthly')}
            className={`px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              billingCycle === 'monthly'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {p.monthly}
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle('yearly')}
            className={`px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 ${
              billingCycle === 'yearly'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>{p.yearly}</span>
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                billingCycle === 'yearly'
                  ? 'bg-blue-500/80 text-white'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
            >
              {p.save20}
            </span>
          </button>
        </div>

        {p.marketFocusNotice && (
          <div className="mt-6 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50/90 border border-amber-200/90 rounded-2xl text-xs text-amber-900 font-medium max-w-2xl text-center shadow-xs">
              <span>{p.marketFocusNotice}</span>
            </div>
          </div>
        )}
      </div>

      {/* Current Quota Gauges (Only shown when user is authenticated with quotas) */}
      {entitlements && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-sm mb-14">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 mb-6 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {p.currentPlan}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                  {entitlements.tier}
                </span>
              </div>
              <div className="text-lg font-bold text-slate-900 mt-1">
                {t('pricing.workspaceTier', { tier: entitlements.tier })}
              </div>
            </div>
            <Link
              href="/settings"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
            >
              <span>{t('settings.managePlan')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100">
              <span className="text-xs font-semibold text-slate-500">
                {p.monthlyReports}
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {entitlements.exportReportsUsed}{' '}
                <span className="text-xs text-slate-400 font-normal">
                  / {t('pricing.used', { used: entitlements.exportReportsUsed, limit: entitlements.exportReportsMonthlyLimit })}
                </span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (entitlements.exportReportsUsed / entitlements.exportReportsMonthlyLimit) * 100
                    )}%`,
                  }}
                ></div>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-medium">
                {t('pricing.remaining', { remaining: entitlements.remainingReports })}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100">
              <span className="text-xs font-semibold text-slate-500">
                {p.trackedProjects}
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {entitlements.currentProjectsCount}{' '}
                <span className="text-xs text-slate-400 font-normal">
                  / {t('pricing.active', { active: entitlements.currentProjectsCount, limit: entitlements.maxProjects })}
                </span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (entitlements.currentProjectsCount / entitlements.maxProjects) * 100
                    )}%`,
                  }}
                ></div>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-medium">
                {p.gscSyncIncluded}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100">
              <span className="text-xs font-semibold text-slate-500">
                {p.alertRules}
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {entitlements.currentAlertsCount}{' '}
                <span className="text-xs text-slate-400 font-normal">
                  / {t('pricing.alertsConfigured', { count: entitlements.currentAlertsCount, limit: entitlements.maxAlerts })}
                </span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (entitlements.currentAlertsCount / Math.max(1, entitlements.maxAlerts)) * 100
                    )}%`,
                  }}
                ></div>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-medium">
                {p.webhookDelivery}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pricing Comparison Cards */}
      <div className="grid lg:grid-cols-3 gap-8 items-stretch mb-20">
        {/* Tier 1: Free Starter */}
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
          <div>
            <div className="inline-block px-3 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 mb-3 uppercase tracking-wider">
              {p.planFreeTitle}
            </div>
            <h3 className="font-extrabold text-2xl text-slate-900">
              {p.planFreeTitle}
            </h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed min-h-[36px]">
              {p.planFreeDesc}
            </p>

            <div className="mt-5 pb-6 border-b border-slate-100">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-slate-900">{p.planFreePrice}</span>
                <span className="text-xs text-slate-400 font-medium">{isZh ? '永久免费' : '/ forever'}</span>
              </div>
            </div>

            <ul className="mt-6 space-y-3.5 text-xs text-slate-600 leading-relaxed">
              {p.freeFeatures.map((feat: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 pt-6">
            {isLoggedIn && isFree ? (
              <button
                disabled
                className="w-full py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-400 bg-slate-50 cursor-not-allowed text-center"
              >
                {p.includedBaseline}
              </button>
            ) : (
              <Link
                href="/register"
                className="block w-full py-3 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition-all text-center"
              >
                {p.getStartedFree}
              </Link>
            )}
          </div>
        </div>

        {/* Tier 2: Builder Pro (Hero Highlight Card) */}
        <div className="bg-white rounded-3xl border-2 border-blue-600 p-8 shadow-xl relative flex flex-col justify-between ring-4 ring-blue-600/10 scale-[1.02]">
          {/* Most popular glowing badge */}
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[11px] font-black uppercase tracking-wider px-4 py-1.5 rounded-full shadow-md flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-300" />
            <span>{p.popularBadge}</span>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 uppercase tracking-wider">
                {p.planProTitle}
              </span>
              {p.proEarlyBirdBadge && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                  {p.proEarlyBirdBadge}
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-2xl text-slate-900">
              {p.planProTitle}
            </h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed min-h-[36px]">
              {p.planProDesc}
            </p>

            <div className="mt-5 pb-6 border-b border-blue-100">
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl sm:text-5xl font-black text-blue-700">
                  {billingCycle === 'yearly' ? p.planProYearlyPrice : p.planProMonthlyPrice}
                </span>
                <span className="text-xs text-slate-500 font-medium">{isZh ? '/ 月' : '/ mo'}</span>
              </div>
              <p className="text-[11px] text-blue-600/90 font-medium mt-1">
                {billingCycle === 'yearly' ? p.planProBilledYearly : (isZh ? '按月自动续订' : 'Billed monthly')}
              </p>
            </div>

            <ul className="mt-6 space-y-3.5 text-xs text-slate-700 leading-relaxed font-medium">
              {p.proFeatures.map((feat: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 pt-6">
            {isLoggedIn && isPro ? (
              <button
                disabled
                className="w-full py-3.5 rounded-xl border border-blue-300 text-xs font-bold text-blue-700 bg-blue-50 cursor-default text-center"
              >
                {p.currentActive}
              </button>
            ) : (
              <Link
                href={isLoggedIn ? '/settings' : '/register?plan=pro'}
                className="block w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-lg shadow-blue-600/30 hover:shadow-blue-600/40 transition-all text-center"
              >
                {isLoggedIn ? p.upgradeNow : p.startTrial}
              </Link>
            )}
            <p className="text-center text-[10px] text-slate-400 mt-2">
              {isZh ? '随时一键取消 · 无任何绑约' : 'Cancel anytime · No lock-in contracts'}
            </p>
          </div>
        </div>

        {/* Tier 3: Team Scale */}
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 uppercase tracking-wider">
                {p.planTeamTitle}
              </span>
              {p.teamWaitlistBadge && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">
                  {p.teamWaitlistBadge}
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-2xl text-slate-900">
              {p.planTeamTitle}
            </h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed min-h-[36px]">
              {p.planTeamDesc}
            </p>

            <div className="mt-5 pb-6 border-b border-slate-100">
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-black text-slate-900">
                  {billingCycle === 'yearly' ? p.planTeamYearlyPrice : p.planTeamMonthlyPrice}
                </span>
                <span className="text-xs text-slate-500 font-medium">{isZh ? '/ 月' : '/ mo'}</span>
              </div>
              <p className="text-[11px] text-indigo-600 font-medium mt-1">
                {billingCycle === 'yearly' ? p.planTeamBilledYearly : (isZh ? '按月自动续订' : 'Billed monthly')}
              </p>
            </div>

            <ul className="mt-6 space-y-3.5 text-xs text-slate-600 leading-relaxed">
              {p.teamFeatures.map((feat: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 pt-6">
            {isLoggedIn && isTeam ? (
              <button
                disabled
                className="w-full py-3 rounded-xl border border-indigo-200 text-xs font-bold text-indigo-700 bg-indigo-50 cursor-default text-center"
              >
                {p.currentActive}
              </button>
            ) : (
              <a
                href="mailto:contact@emeradar.com?subject=Inquiry%20regarding%20Team%20Scale%20Plan"
                className="block w-full py-3 rounded-xl border-2 border-indigo-600 text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition-all text-center"
              >
                {p.contactSales}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Why Emeradar vs Traditional SEO Tools (Value Anchor & Stats) */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-8 sm:p-12 mb-20 shadow-xl overflow-hidden relative">
        <div className="max-w-3xl mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 mb-4">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>{isZh ? '投入产出与实证效果' : 'ROI & Performance'}</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
            {p.whyTitle}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-300 leading-relaxed">
            {p.whySubtitle}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 pt-6 border-t border-slate-700/80">
          <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700">
            <div className="text-3xl sm:text-4xl font-black text-amber-400">
              {p.stat1Number}
            </div>
            <h4 className="text-base font-bold text-white mt-1">
              {p.stat1Label}
            </h4>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {p.stat1Desc}
            </p>
          </div>

          <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700">
            <div className="text-3xl sm:text-4xl font-black text-blue-400">
              {p.stat2Number}
            </div>
            <h4 className="text-base font-bold text-white mt-1">
              {p.stat2Label}
            </h4>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {p.stat2Desc}
            </p>
          </div>

          <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700">
            <div className="text-3xl sm:text-4xl font-black text-emerald-400">
              {p.stat3Number}
            </div>
            <h4 className="text-base font-bold text-white mt-1">
              {p.stat3Label}
            </h4>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {p.stat3Desc}
            </p>
          </div>
        </div>
      </div>

      {/* Feature Comparison Matrix Table */}
      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm mb-20">
        <div className="p-6 sm:p-8 border-b border-slate-200">
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
            {p.matrixTitle}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {p.matrixSubtitle}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="py-4 px-6 w-2/5">{p.colFeature}</th>
                <th className="py-4 px-6 text-slate-600">{p.colFree}</th>
                <th className="py-4 px-6 text-blue-700 bg-blue-50/50">{p.colPro}</th>
                <th className="py-4 px-6 text-indigo-700">{p.colTeam}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.matrixRows.map((row: any, idx: number) => (
                <tr
                  key={idx}
                  className={idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'}
                >
                  <td className="py-3.5 px-6 font-semibold text-slate-900">
                    {row.feature}
                  </td>
                  <td className="py-3.5 px-6 text-slate-600">
                    {row.free}
                  </td>
                  <td className="py-3.5 px-6 font-semibold text-blue-800 bg-blue-50/30">
                    {row.pro}
                  </td>
                  <td className="py-3.5 px-6 text-slate-700">
                    {row.team}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Zero Risk Guarantee Badges */}
      <div className="bg-slate-50 rounded-3xl border border-slate-200/80 p-8 mb-20 text-center">
        <h3 className="text-lg font-bold text-slate-900">
          {p.guaranteeTitle}
        </h3>
        <p className="text-xs text-slate-500 mt-1 max-w-xl mx-auto">
          {p.guaranteeDesc}
        </p>

        <div className="grid sm:grid-cols-3 gap-4 mt-6">
          <div className="p-4 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-xs font-bold text-slate-800">{p.badgeCancel}</span>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center gap-2.5">
            <Award className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-xs font-bold text-slate-800">{p.badgeRefund}</span>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center gap-2.5">
            <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="text-xs font-bold text-slate-800">{p.badgeCrypto}</span>
          </div>
        </div>
      </div>

      {/* Interactive FAQ Accordion */}
      <div className="max-w-3xl mx-auto mb-20">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 mb-3">
            <HelpCircle className="w-3.5 h-3.5 text-blue-600" />
            <span>{isZh ? '常见问题' : 'Questions & Answers'}</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            {p.faqTitle}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {p.faqSubtitle}
          </p>
        </div>

        <div className="space-y-4">
          {p.faqs.map((faq: any, idx: number) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div
                key={idx}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                  className="w-full text-left p-5 flex items-center justify-between gap-4 font-bold text-sm text-slate-900 hover:text-blue-600 transition-colors"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-blue-600' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pt-1 text-xs text-slate-600 leading-relaxed border-t border-slate-100">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Conversion Banner */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 rounded-3xl p-8 sm:p-12 text-center text-white shadow-xl shadow-blue-500/20">
        <h2 className="text-2xl sm:text-4xl font-black tracking-tight">
          {p.bottomCtaTitle}
        </h2>
        <p className="mt-3 text-xs sm:text-base text-blue-100 max-w-xl mx-auto leading-relaxed">
          {p.bottomCtaDesc}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/register"
            className="px-6 py-3.5 rounded-xl bg-white text-blue-700 text-xs sm:text-sm font-black shadow-lg hover:bg-blue-50 transition-all"
          >
            {p.bottomCtaBtn}
          </Link>
          <Link
            href="/track-record"
            className="px-6 py-3.5 rounded-xl bg-blue-700/60 text-white text-xs sm:text-sm font-bold border border-blue-400/40 hover:bg-blue-700/80 transition-all"
          >
            {p.bottomCtaTrackRecord}
          </Link>
        </div>
      </div>
    </div>
  );
}
