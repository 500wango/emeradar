import {
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService } from '@emeradar/services';
import { getServerI18n } from '@/lib/i18n/server';

export default async function BillingPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login');
  const userId = session.user.id;
  const ent = await EntitlementService.getUserEntitlements(userId);
  const { t, dictionary } = await getServerI18n();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200 mb-4">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>{t('pricing.badge')}</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          {t('pricing.title')}
        </h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          {t('pricing.desc')}
        </p>
      </div>

      {/* Current Quota Gauges */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-12">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {t('pricing.currentPlan')}
            </span>
            <div className="text-xl font-bold text-slate-900 mt-0.5">
              {t('pricing.workspaceTier', { tier: ent.tier })}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-xs font-semibold text-slate-500">
              {t('pricing.monthlyReports')}
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {ent.exportReportsUsed}{' '}
              <span className="text-xs text-slate-400 font-normal">
                / {t('pricing.used', { used: ent.exportReportsUsed, limit: ent.exportReportsMonthlyLimit })}
              </span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full"
                style={{
                  width: `${Math.min(
                    100,
                    (ent.exportReportsUsed / ent.exportReportsMonthlyLimit) * 100
                  )}%`,
                }}
              ></div>
            </div>
            <span className="text-[11px] text-slate-500 mt-2 block">
              {t('pricing.remaining', { remaining: ent.remainingReports })}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-xs font-semibold text-slate-500">
              {t('pricing.trackedProjects')}
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {ent.currentProjectsCount}{' '}
              <span className="text-xs text-slate-400 font-normal">
                / {t('pricing.active', { active: ent.currentProjectsCount, limit: ent.maxProjects })}
              </span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className="bg-indigo-600 h-full rounded-full"
                style={{
                  width: `${Math.min(
                    100,
                    (ent.currentProjectsCount / ent.maxProjects) * 100
                  )}%`,
                }}
              ></div>
            </div>
            <span className="text-[11px] text-slate-500 mt-2 block">
              {t('pricing.gscSyncIncluded')}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-xs font-semibold text-slate-500">
              {t('pricing.alertRules')}
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {ent.currentAlertsCount}{' '}
              <span className="text-xs text-slate-400 font-normal">
                / {t('pricing.alertsConfigured', { count: ent.currentAlertsCount, limit: ent.maxAlerts })}
              </span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className="bg-amber-500 h-full rounded-full"
                style={{
                  width: `${Math.min(
                    100,
                    (ent.currentAlertsCount / Math.max(1, ent.maxAlerts)) * 100
                  )}%`,
                }}
              ></div>
            </div>
            <span className="text-[11px] text-slate-500 mt-2 block">
              {t('pricing.webhookDelivery')}
            </span>
          </div>
        </div>
      </div>

      {/* Pricing Comparison Cards */}
      <div className="grid md:grid-cols-3 gap-8 items-stretch">
        {/* Free Starter */}
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-lg text-slate-900">Free</h3>
            <p className="text-xs text-slate-500 mt-1">{t('pricing.planFreeDesc')}</p>
            <div className="text-3xl font-extrabold text-slate-900 mt-4">$0</div>

            <ul className="mt-6 space-y-3 text-xs text-slate-600">
              {dictionary.pricing.freeFeatures.map((item, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            disabled
            className="w-full mt-8 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-400 cursor-not-allowed"
          >
            {t('pricing.includedBaseline')}
          </button>
        </div>

        {/* Builder Pro (Active) */}
        <div className="bg-white rounded-2xl border-2 border-blue-600 p-8 shadow-lg relative flex flex-col justify-between">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm">
            {t('pricing.designPartners')}
          </div>

          <div>
            <h3 className="font-bold text-lg text-slate-900">Pro</h3>
            <p className="text-xs text-slate-500 mt-1">{t('pricing.planProDesc')}</p>
            <div className="text-3xl font-extrabold text-slate-900 mt-4">
              {t('pricing.pricingInInterviews')}
            </div>

            <ul className="mt-6 space-y-3 text-xs text-slate-700">
              {dictionary.pricing.proFeatures.map((item, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <a
            href="/register"
            className="w-full mt-8 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors text-center"
          >
            {t('pricing.joinDesignPartners')}
          </a>
        </div>

        {/* Scale Team */}
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-lg text-slate-900">{t('pricing.notInRelease')}</h3>
            <p className="text-xs text-slate-500 mt-1">{t('pricing.notInReleaseDesc')}</p>
            <ul className="mt-6 space-y-3 text-xs text-slate-500">
              {dictionary.pricing.notInReleaseItems.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
