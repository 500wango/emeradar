import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { AuthService, ProjectService, StakeService, RankingService } from '@emeradar/services';
import SiteCheckButton from '@/components/SiteCheckButton';
import { ProjectLifecyclePanel } from '@/components/ProjectLifecyclePanel';
import { StakePanel } from '@/components/StakePanel';
import { LaunchKitPanel } from '@/components/LaunchKitPanel';
import { RankingsPanel } from '@/components/RankingsPanel';
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

  /**
   * 质押状态单独取，而不是从 `getProjectDetail` 的大对象里挑字段。
   *
   * 它是**有时限**的数据：7 天窗口一过，槽位由后台作业释放，这份 view 里的
   * `stakeStatus` 就成了用户唯一能看到的凭据。让它走 `StakeService` 的同一条读路径，
   * 前端面板与后台作业判的才是同一个 `stake_status`。
   */
  const stake = await StakeService.getStakeStatus(id, session.user.id);

  /**
   * 排名曲线与质押状态同样单独取：它就是 PRD P4 那句"以 30 天排名爬升衡量"的读数，
   * 而 `getProjectDetail` 的大对象里没有它（那是机会侧的快照，不是项目侧的时间序列）。
   * 只读、无副作用，所以放在服务端直取，省掉一次客户端往返与一次首屏闪烁。
   *
   * 实验项目根本不取：它不挂机会，因而不存在"这条机会的主词"，追踪在结构上无从谈起。
   * 取回来只会是一段永远为空的曲线，而把它画出来会让用户以为系统在看着、只是还没结果。
   */
  const rankings =
    data.project.project_kind === 'EXPERIMENT'
      ? null
      : await RankingService.getProjectRankings(id, session.user.id);

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
      <StakePanel
        projectId={id}
        projectKind={data.project.project_kind}
        initial={{
          stakeStatus: stake.stakeStatus,
          stakeDeadlineAt: stake.stakeDeadlineAt,
          credentials: stake.credentials,
        }}
      />
      {/* GO 的交付物就在这个页面上，而不是在别处：用户点完 GO 被跳到这里，
          如果这里没有它的入口，那次配额花掉换来的东西就找不到了。 */}
      <LaunchKitPanel projectId={id} projectKind={data.project.project_kind} />
      {rankings && (
        <RankingsPanel
          projectId={id}
          initial={{
            observedDays: rankings.observedDays,
            firstRankedOn: rankings.firstRankedOn,
            daysToFirstRank: rankings.daysToFirstRank,
            bestRankEver: rankings.bestRankEver,
            series: rankings.series,
          }}
        />
      )}

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
