import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  Bell,
  Clock,
} from 'lucide-react';
import { AlertService, AuthService } from '@emeradar/services';
import { formatDateTime } from '@/lib/format';
import { getServerI18n } from '@/lib/i18n/server';
import { AlertRuleList } from '@/components/AlertRuleList';

export default async function AlertsPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login');
  if (session.user.role === 'ADMIN') redirect('/admin');
  const userId = session.user.id;
  const rules = await AlertService.listAlertRules(userId);
  const notifications = await AlertService.listNotifications(userId);
  const { t } = await getServerI18n();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600">
              {t('alerts.badge')}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
            {t('alerts.title')}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {t('alerts.desc')}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column: Active Alert Rules */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900">
                {t('alerts.activeRulesTitle')}
              </h2>
              <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full font-medium">
                {t('alerts.activeRulesCount', { active: rules.length, max: 20 })}
              </span>
            </div>

            <AlertRuleList initialRules={rules} />
          </div>
        </div>

        {/* Right Column: Notification Log */}
        <div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>{t('alerts.recentEventsTitle')}</span>
            </h2>

            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500 italic">{t('alerts.noNotifications')}</p>
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
