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
import { Badge } from '@/components/ui/Badge';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';

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
    <PageFrame width="full">
      <PageHeader
        eyebrow={t('alerts.badge')}
        title={t('alerts.title')}
        lede={t('alerts.desc')}
        aside={<Bell className="h-5 w-5 text-warn" />}
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-3">
        {/* Left Column: Active Alert Rules */}
        <div className="space-y-6 lg:col-span-2">
          <Panel className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-fg">
                {t('alerts.activeRulesTitle')}
              </h2>
              <Badge tone="neutral">{t('alerts.activeRulesCount', { active: rules.length, max: 20 })}</Badge>
            </div>

            <AlertRuleList initialRules={rules} />
          </Panel>
        </div>

        {/* Right Column: Notification Log */}
        <div>
          <Panel className="p-6">
            <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-fg">
              <Clock className="h-4 w-4 text-accent" />
              <span>{t('alerts.recentEventsTitle')}</span>
            </h2>

            {notifications.length === 0 ? (
              <p className="text-xs italic text-fg-subtle">{t('alerts.noNotifications')}</p>
            ) : (
              <div className="space-y-3">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-sm border border-line bg-surface-2 p-3.5 text-xs"
                  >
                    <div className="mb-0.5 font-semibold text-fg">{n.title}</div>
                    <div className="leading-relaxed text-fg-muted">{n.body}</div>
                    <div className="mt-2 font-mono text-[10px] text-fg-subtle">
                      {formatDateTime(n.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
