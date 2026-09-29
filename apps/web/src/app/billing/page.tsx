import {
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService } from '@emeradar/services';

export default async function BillingPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login');
  const userId = session.user.id;
  const ent = await EntitlementService.getUserEntitlements(userId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200 mb-4">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>Transparent Builder Pricing</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Free and Pro
        </h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Pro is the realtime decision feed, the full evidence, report export, alerts, and projects.
          Price is set with design partners. This page does not invent a rate.
        </p>
      </div>

      {/* Current Quota Gauges */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-12">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Current Plan
            </span>
            <div className="text-xl font-bold text-slate-900 mt-0.5">
              Workspace tier: {ent.tier}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-xs font-semibold text-slate-500">
              Monthly Research Reports
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {ent.exportReportsUsed}{' '}
              <span className="text-xs text-slate-400 font-normal">
                / {ent.exportReportsMonthlyLimit} exports used
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
              {ent.remainingReports} exports remaining this billing cycle
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-xs font-semibold text-slate-500">
              Tracked Builder Projects
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {ent.currentProjectsCount}{' '}
              <span className="text-xs text-slate-400 font-normal">
                / {ent.maxProjects} projects active
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
              GSC automated synchronization included
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-xs font-semibold text-slate-500">
              Active Radar Alert Rules
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {ent.currentAlertsCount}{' '}
              <span className="text-xs text-slate-400 font-normal">
                / {ent.maxAlerts} alerts configured
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
              Immediate webhook & in-app delivery
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
            <p className="text-xs text-slate-500 mt-1">Track record and delayed decisions</p>
            <div className="text-3xl font-extrabold text-slate-900 mt-4">$0</div>

            <ul className="mt-6 space-y-3 text-xs text-slate-600">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Public track record, hits and misses
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Opportunities delayed 45 days
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                1 report preview / month, no export
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                1 project
              </li>
            </ul>
          </div>

          <button
            disabled
            className="w-full mt-8 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-400 cursor-not-allowed"
          >
            Included Baseline
          </button>
        </div>

        {/* Builder Pro (Active) */}
        <div className="bg-white rounded-2xl border-2 border-blue-600 p-8 shadow-lg relative flex flex-col justify-between">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm">
            Design partners
          </div>

          <div>
            <h3 className="font-bold text-lg text-slate-900">Pro</h3>
            <p className="text-xs text-slate-500 mt-1">The paid decision loop</p>
            <div className="text-3xl font-extrabold text-slate-900 mt-4">
              Pricing in interviews
            </div>

            <ul className="mt-6 space-y-3 text-xs text-slate-700">
              <li className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                Realtime feed, up to 10 published decisions a day
              </li>
              <li className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                Full detail and 30 report exports / month
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                Watch, email alerts, up to 50 projects
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                GO binds the project to that verdict
              </li>
            </ul>
          </div>

          <a
            href="/register"
            className="w-full mt-8 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors text-center"
          >
            Join the design partners
          </a>
        </div>

        {/* Scale Team */}
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-lg text-slate-900">Not in this release</h3>
            <p className="text-xs text-slate-500 mt-1">Team seats and a public API wait until the decision loop is paid for.</p>
            <ul className="mt-6 space-y-3 text-xs text-slate-500">
              <li>Team plans</li>
              <li>Open API as a product</li>
              <li>Multiple research markets</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
