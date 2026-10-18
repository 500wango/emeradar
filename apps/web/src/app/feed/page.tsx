import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService, OpportunityService, listFreeWeeklyFeed, type WeeklySelectedCase } from '@emeradar/services';
import { FeedClient } from '@/components/FeedClient';
import { TrackRequest } from '@/components/TrackRequest';
import { StartExperimentButton } from '@/components/StartExperimentButton';
import { getServerI18n } from '@/lib/i18n/server';
import { safeExternalUrl } from '@/lib/format';
import { AxisBadge, Badge } from '@/components/ui/Badge';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';

type FeedSearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams?: Promise<FeedSearchParams>;
}) {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=%2Ffeed');
  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  const planLabel = ent.planCode;
  // v3.1 没有「延迟 45 天」这个维度：Free 就是每周一条精选，付费层是实时 Feed。
  const realtime = !ent.feedSelectedWeekly;
  const params = searchParams ? await searchParams : {};
  const verdictParam = firstParam(params.verdict);
  const archetypeParam = firstParam(params.archetype);
  const executionClassParam = firstParam(params.execution_class);
  const searchParam = firstParam(params.search)?.trim() || undefined;
  const offsetParam = Number.parseInt(firstParam(params.offset) || '0', 10);
  const offset = Number.isFinite(offsetParam) ? Math.max(0, Math.floor(offsetParam / 10) * 10) : 0;
  const verdicts = ['BUILD_NOW', 'EARLY_BET', 'WATCH', 'WINDOW_CLOSING'];
  const archetypes = ['TOOL', 'MICRO_SAAS', 'PSEO_SITE', 'DIRECTORY', 'CONTENT_SITE'];
  const executionClasses = ['S', 'M', 'L'];
  const selectedVerdict = verdicts.includes(verdictParam || '') ? verdictParam : undefined;
  const selectedArchetype = archetypes.includes(archetypeParam || '') ? archetypeParam : undefined;
  const selectedExecutionClass = executionClasses.includes(executionClassParam || '') ? executionClassParam : undefined;
  const feedFilters = {
    verdict: selectedVerdict as any,
    archetype: selectedArchetype as any,
    executionClass: selectedExecutionClass as any,
    search: searchParam,
    limit: 10,
    offset,
  };
  // Free 层：每周 1 条精选，不再是延迟 N 天的整本 Feed（13 §3.2）。
  const feed = realtime
    ? await OpportunityService.listFeedCards({ ...feedFilters, minAgeDays: 0 })
    : await listFreeWeeklyFeed(feedFilters);
  const observations = realtime
    ? await OpportunityService.listLiveObservations({ limit: 20 })
    : [];
  const discoveries = realtime ? await OpportunityService.listDiscoveryItems(12) : [];
  const experiments = realtime ? await OpportunityService.listExperimentCards(8) : [];

  const { t, isZh } = await getServerI18n();

  const delayText = realtime
    ? t('feed.delayRealtime')
    : t('feed.delayDays');

  const steps = [
    ['1', t('feed.step1')],
    ['2', t('feed.step2')],
    ['3', t('feed.step3')],
    ['4', t('feed.step4')],
    ['5', t('feed.step5')],
  ];

  return (
    <PageFrame width="full">
      <PageHeader
        eyebrow={t('feed.badge')}
        title={t('feed.title')}
        lede={t('feed.desc', { planLabel, delayText })}
      />

      {!realtime && (() => {
        // Free 每周精选的三种状态（13 §3.2、16 §3.3）：本周新案例 / 回退的历史案例 / 没有合格案例。
        // 历史案例必须明示原入选日期，不得伪装成本周新案例（30 Q10）。
        const weekly: WeeklySelectedCase | null = 'weekly' in feed ? (feed.weekly as WeeklySelectedCase | null) : null;
        const since = weekly ? new Date(weekly.eligibleSince).toLocaleDateString(isZh ? 'zh-CN' : 'en-US') : '';
        const reason = weekly ? t(`feed.weeklyReason.${weekly.eligibleReason}`) : '';
        return (
          <Panel className="mt-8 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">{t('feed.weeklyBadge')}</p>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              {!weekly
                ? t('feed.weeklyNone')
                : weekly.historical
                  ? t('feed.weeklyHistorical', { date: since, reason })
                  : t('feed.weeklyFresh', { date: since, reason })}
            </p>
            <Link href="/pricing" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
              {t('feed.weeklyUpgrade')}
            </Link>
          </Panel>
        );
      })()}

      <Panel className="mt-8 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            {t('feed.scanTitle')}
          </p>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-fg-muted">{t('feed.scanDesc')}</p>
        </div>
        <Link
          href="/scan"
          className="shrink-0 self-start border border-accent/40 bg-accent/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent/15 sm:self-auto"
        >
          {t('feed.scanCta')} →
        </Link>
      </Panel>

      <div className="mt-8">
        <FeedClient
          initialItems={feed.items}
          suppressEmptyState={!realtime}
          total={feed.total}
          hasMore={feed.hasMore}
          offset={offset}
          pageSize={10}
          activeFilters={{
            verdict: selectedVerdict,
            archetype: selectedArchetype,
            executionClass: selectedExecutionClass,
            search: searchParam,
          }}
        />
      </div>

      <div className="mt-14 border-t border-line pt-8">
        <TrackRequest />
      </div>

      {realtime && (
        <section className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-fg">{t('feed.sourceDiscoveriesTitle')}</h2>
              <p className="mt-1 text-sm text-fg-muted">{t('feed.sourceDiscoveriesDesc')}</p>
            </div>
            <span className="font-mono text-xs text-fg-subtle">
              {t('feed.discoveriesCount', { count: discoveries.length })}
            </span>
          </div>
          {discoveries.length === 0 ? (
            <p className="mt-5 text-sm text-fg-muted">{t('feed.noDiscoveries')}</p>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {discoveries.map((item) => (
                <Panel key={item.id} className="p-5">
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-fg-subtle">
                    <span>{item.provider}</span>
                    <time dateTime={item.sourcePublishedAt || item.firstCollectedAt}>
                      {new Date(item.sourcePublishedAt || item.firstCollectedAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US')}
                    </time>
                  </div>
                  <a href={safeExternalUrl(item.sourceUrl) ?? '#'} target="_blank" rel="noreferrer" className="mt-2 block font-semibold text-fg transition-colors hover:text-accent">
                    {item.title}
                  </a>
                  {item.excerpt && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-fg-muted">{item.excerpt}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.intents.length === 0 ? (
                      <span className="text-[11px] text-fg-subtle">{t('feed.intentsPending')}</span>
                    ) : item.intents.map((intent) => (
                      <span key={`${item.id}-${intent.queryHypothesis}`} className="rounded-sm bg-surface-2 px-2 py-1 text-[11px] text-fg-muted">
                        {intent.queryHypothesis}
                      </span>
                    ))}
                  </div>
                  {item.validation && (
                    <div className="mt-4 rounded-sm border border-line bg-surface-2 p-3 text-[11px] text-fg-muted">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-semibold">
                        <span>{t('feed.autocompleteLabel')}: {item.validation.autocompleteStatus}</span>
                        <span>SERP: {item.validation.serpStatus}</span>
                        <span>{t('feed.supplyGapLabel')}: {item.validation.supplyGapStatus.replaceAll('_', ' ')}</span>
                      </div>
                      {item.validation.supplyGapNote && <p className="mt-1 leading-relaxed">{item.validation.supplyGapNote}</p>}
                    </div>
                  )}
                </Panel>
              ))}
            </div>
          )}
        </section>
      )}

      {realtime && experiments.length > 0 && (
        <section className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-fg">{t('feed.activeExperimentsTitle')}</h2>
              <p className="mt-1 text-sm text-fg-muted">{t('feed.activeExperimentsDesc')}</p>
            </div>
            <span className="font-mono text-xs text-fg-subtle">
              {t('feed.experimentsCount', { count: experiments.length })}
            </span>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {experiments.map((experiment) => (
              <Panel key={experiment.id} className="border-warn/40 bg-warn/10 p-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone="warn">PROPOSED EXPERIMENT</Badge>
                  <span className="truncate font-mono text-[11px] text-warn">{experiment.queryHypothesis}</span>
                </div>
                <h3 className="mt-2 font-semibold text-fg">{experiment.title}</h3>
                <dl className="mt-4 grid gap-3 text-xs text-fg-muted">
                  <div>
                    <dt className="font-semibold text-fg-subtle">{t('feed.coreJob')}</dt>
                    <dd>{experiment.coreJob}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-fg-subtle">{t('feed.pageShape')}</dt>
                    <dd>{experiment.recommendedPageShape}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-fg-subtle">{t('feed.minimumFeature')}</dt>
                    <dd>{experiment.minimumFeature}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-fg-subtle">{t('feed.successSignal')}</dt>
                    <dd>{experiment.successSignal}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-fg-subtle">{t('feed.abandonWhen')}</dt>
                    <dd>{experiment.abandonCondition}</dd>
                  </div>
                </dl>
                <a href={safeExternalUrl(experiment.sourceUrl) ?? '#'} target="_blank" rel="noreferrer" className="mt-4 inline-block text-[11px] text-accent transition-colors hover:brightness-110">
                  {t('feed.sourceLabel')} {experiment.sourceTitle}
                </a>
                <StartExperimentButton experimentCardId={experiment.id} title={experiment.title} />
              </Panel>
            ))}
          </div>
        </section>
      )}

      <section className="mt-14">
        <h2 className="text-xl font-bold text-fg">
          {t('feed.emergingTitle')}
        </h2>
        {realtime ? (
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            {t('feed.emergingDescRealtime')}
          </p>
        ) : (
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            {t('feed.emergingDescGated')}
          </p>
        )}
        {realtime && observations.length > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-fg-muted sm:grid-cols-5">
            {steps.map(([step, label], index) => (
              <div key={step} className="flex items-center gap-2 rounded-sm border border-line bg-surface-2 px-3 py-2">
                <span className="font-mono font-bold text-accent">{step}</span>
                <span>{label}</span>
                {index < 4 && <span className="hidden text-fg-subtle sm:inline">→</span>}
              </div>
            ))}
          </div>
        )}
        {realtime && observations.length === 0 && (
          <p className="mt-6 text-sm text-fg-muted">
            {t('feed.noEmerging')}
          </p>
        )}
        {realtime && observations.length > 0 && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {observations.map((item) => (
              <Link
                key={item.opportunityId}
                href={`/opportunities/${item.slug}`}
                className="block rounded-sm border border-line bg-surface p-5 transition-colors hover:border-accent"
              >
                <div className="text-xs font-semibold text-fg-muted">
                  {item.marketCountry} · {item.researchLanguage} · {item.confidence} {t('feed.confidenceLabel')}
                </div>
                <h3 className="mt-2 font-bold text-fg">{item.primaryQuery}</h3>
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-fg-muted">
                  {item.featuredEvidenceSnippet || t('feed.observedFallback', { query: item.primaryQuery, summary: item.whyNowSummary })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <AxisBadge axis="d" band={item.dBand} />
                  <AxisBadge axis="m" band={item.mBand} />
                  <AxisBadge axis="w" band={item.wBand} />
                </div>
                <div className="mt-3 font-mono text-[11px] text-fg-subtle">
                  {t('feed.observationCoverage', { auto: item.observationDays ?? 0, serp: item.serpObservationDays ?? 0 })}
                </div>
                <p className="mt-2 text-[11px] text-fg-subtle">
                  {item.discoverySource ? t('feed.discoverySource', { source: item.discoverySource }) : ''}
                  {item.candidateReason || t('feed.candidateDefault')}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PageFrame>
  );
}
