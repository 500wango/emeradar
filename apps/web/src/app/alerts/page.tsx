import Link from 'next/link';
import {
  Bell,
  ShieldAlert,
  ArrowUpRight,
  Clock,
} from 'lucide-react';
import { AlertService } from '@emeradar/services';
import { formatDateTime } from '@/lib/format';

export default async function AlertsPage() {
  const userId = 'usr_demo_pro';
  const rules = await AlertService.listAlertRules(userId);
  const notifications = await AlertService.listNotifications(userId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600">
              Opportunity Watchlist
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
            Radar Alert Rules & Notifications
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated alerts trigger when an opportunity changes verdict, when new incumbents enter Top 10, or when Kill criteria trigger.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column: Active Alert Rules */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900">
                Active Radar Watchlist Rules
              </h2>
              <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full font-medium">
                {rules.length} / 20 Active Rules
              </span>
            </div>

            {rules.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-100">
                <ShieldAlert className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs text-slate-600">
                  No active alert rules. Navigate to any opportunity workspace to add it to your radar watchlist.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {rules.map((rule) => (
                  <div key={rule.id} className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <Link
                        href={`/opportunities/${rule.opportunity_slug}`}
                        className="font-bold text-sm text-slate-900 hover:text-blue-600 flex items-center gap-1.5"
                      >
                        <span>{rule.opportunity_title}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                          {rule.rule_type}
                        </span>
                        <span>&bull;</span>
                        <span>Frequency: {rule.frequency}</span>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Active
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Notification Log */}
        <div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Recent Radar Events</span>
            </h2>

            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No unread notifications.</p>
            ) : (
              <div className="space-y-3">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs"
                  >
                    <div className="font-semibold text-slate-900 mb-0.5">{n.title}</div>
                    <div className="text-slate-600 leading-relaxed">{n.body}</div>
                    <div className="mt-2 text-[10px] text-slate-400">
                      {formatDateTime(n.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
