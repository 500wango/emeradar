import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { AuthService, ProjectService } from '@emeradar/services';
import SiteCheckButton from '@/components/SiteCheckButton';
import { ProjectLifecyclePanel } from '@/components/ProjectLifecyclePanel';
import { getServerI18n } from '@/lib/i18n/server';
import { PageFrame } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login');
  const { id } = await params;
  let data: any;
  try { data = await ProjectService.getProjectDetail(id, session.user.id); } catch { notFound(); }
  const { t } = await getServerI18n();
  const gscStatus = await ProjectService.getGscConnectionStatus(id, session.user.id);

  return (
    <PageFrame width="wide">
      <Link
        href="/projects"
        className="font-mono text-xs text-fg-subtle transition-colors hover:text-fg"
      >
        &larr; {t('projects.backToProjects')}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-bold text-fg">{data.project.title}</h1>
      <p className="mt-1 text-sm text-fg-muted">{data.project.domain || t('projects.noDomain')}</p>
      {data.project.domain && <SiteCheckButton projectId={id} />}
      <ProjectLifecyclePanel
        projectId={id}
        initialStatus={gscStatus}
        initialProjectStatus={data.project.status}
        domain={data.project.domain}
      />

      <h2 className="mt-10 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
        {t('projects.colOutcomes')}
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {data.outcomes.map((outcome: any) => (
          <Panel key={outcome.day} className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
              T+{outcome.day}
            </div>
            <div className="mt-2 font-mono text-lg font-bold tabular-nums text-fg">
              {outcome.status === 'PENDING' ? t('projects.pending') : outcome.clicks.toLocaleString()}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
              {outcome.status === 'PENDING'
                ? t('projects.awaitingGsc')
                : t('projects.impressionsQueries', {
                    impressions: outcome.impressions.toLocaleString(),
                    queries: outcome.queries,
                  })}
            </p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-10 font-display text-base font-semibold text-fg">{t('projects.weeklyData')}</h2>
      <Panel className="mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                <th className="p-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">{t('projects.colWeek')}</th>
                <th className="p-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">{t('projects.colImpressions')}</th>
                <th className="p-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">{t('projects.colClicks')}</th>
                <th className="p-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">{t('projects.colPosition')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.metrics.map((row: any) => (
                <tr key={row.week_start_date}>
                  <td className="p-3 font-mono text-fg-muted">{row.week_start_date}</td>
                  <td className="p-3 font-mono tabular-nums text-fg-muted">{row.impressions}</td>
                  <td className="p-3 font-mono tabular-nums text-fg-muted">{row.clicks}</td>
                  <td className="p-3 font-mono tabular-nums text-fg-muted">{row.average_position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </PageFrame>
  );
}
