import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FolderKanban, ExternalLink, Plus } from 'lucide-react';
import { AuthService, ProjectService } from '@emeradar/services';
import { formatDate } from '@/lib/format';
import { getServerI18n } from '@/lib/i18n/server';
import { Badge } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Stat } from '@/components/ui/Stat';

export default async function ProjectsPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login');
  if (session.user.role === 'ADMIN') redirect('/admin');
  const userId = session.user.id;
  const projects = await ProjectService.listUserProjects(userId);
  const { t } = await getServerI18n();

  return (
    <PageFrame width="full">
      <PageHeader
        eyebrow={t('projects.badge')}
        title={t('projects.title')}
        lede={t('projects.desc')}
        aside={
          <Link href="/feed" className={buttonVariants({ size: 'md' })}>
            <Plus className="h-4 w-4" />
            {t('projects.launchFromOpp')}
          </Link>
        }
      />

      {projects.length === 0 ? (
        <Panel className="mx-auto mt-12 max-w-lg p-12 text-center">
          <FolderKanban className="mx-auto mb-4 h-10 w-10 text-fg-subtle" />
          <h2 className="font-display text-base font-bold text-fg">{t('projects.noProjectsTitle')}</h2>
          <p className="mt-2 text-xs leading-relaxed text-fg-subtle">{t('projects.noProjectsDesc')}</p>
          <Link href="/feed" className={buttonVariants({ size: 'sm', className: 'mt-6' })}>
            {t('projects.browseOpportunities')}
          </Link>
        </Panel>
      ) : (
        <div className="mt-10 space-y-6">
          {projects.map((p) => (
            <Panel key={p.id} className="p-6 md:p-8">
              <div className="flex flex-col justify-between gap-6 border-b border-line pb-6 lg:flex-row lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={p.project_kind === 'EXPERIMENT' ? 'accent' : 'neutral'}>
                      {p.project_kind}
                    </Badge>
                    <Badge tone={p.status === 'LAUNCHED' ? 'signal' : 'warn'} dot>
                      {p.status}
                    </Badge>
                    <Badge tone="neutral">{p.build_type}</Badge>
                    {/* 凭证状态是**没有期限**的：v3.1 里 GO 之后随时可以提交，失败也
                        不回收任何东西。列表页只如实显示它走到哪一步。 */}
                    {p.project_kind !== 'EXPERIMENT' && p.credential_status === 'VERIFIED_OWNER' && (
                      <Badge tone="signal">CREDENTIAL VERIFIED</Badge>
                    )}
                    {p.project_kind !== 'EXPERIMENT' && p.credential_status === 'REJECTED' && (
                      <Badge tone="warn">VERIFICATION REJECTED</Badge>
                    )}
                    {p.project_kind !== 'EXPERIMENT' &&
                      p.credential_status !== 'VERIFIED_OWNER' &&
                      p.credential_status !== 'REJECTED' && (
                        <Badge tone="neutral">CREDENTIAL UNVERIFIED</Badge>
                      )}
                    <span className="text-xs text-fg-muted">
                      {p.launch_date
                        ? t('projects.launchedDate', { date: formatDate(p.launch_date) })
                        : t('projects.inDev')}
                    </span>
                  </div>

                  <h2 className="mt-3 font-display text-xl font-bold text-fg">
                    <Link href={`/projects/${p.id}`} className="transition-colors hover:text-accent">
                      {p.title}
                    </Link>
                  </h2>

                  {p.domain && (
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <a
                        href={`https://${p.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 font-mono text-accent transition-colors hover:brightness-110"
                      >
                        <span>{p.domain}</span>
                        <ExternalLink className="h-3 w-3 text-fg-subtle" />
                      </a>
                    </div>
                  )}

                  {p.opportunity_slug ? (
                    <div className="mt-2 text-xs text-fg-muted">
                      {t('projects.linkedOpp')}{' '}
                      <Link
                        href={`/opportunities/${p.opportunity_slug}`}
                        className="font-medium text-fg underline transition-colors hover:text-accent"
                      >
                        {p.opportunity_title}
                      </Link>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-fg-muted">{t('projects.earlyExpNote')}</div>
                  )}
                </div>

                {/* GSC traction readings */}
                <div className="flex shrink-0 gap-8 border-line lg:border-l lg:pl-8">
                  <Stat value={p.total_impressions.toLocaleString()} label={t('projects.gscImpressions')} size="sm" />
                  <Stat
                    value={p.total_clicks.toLocaleString()}
                    label={t('projects.organicClicks')}
                    tone="signal"
                    size="sm"
                  />
                </div>
              </div>

              {/* Target keywords */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-semibold text-fg-subtle">
                  {t('projects.targetKeywords')}
                </span>
                {p.target_keywords?.map((kw: string, i: number) => (
                  <span
                    key={i}
                    className="border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs text-fg-muted"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </PageFrame>
  );
}
