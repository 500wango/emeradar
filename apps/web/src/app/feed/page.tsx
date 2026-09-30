import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService, OpportunityService } from '@emeradar/services';
import { FeedClient } from '@/components/FeedClient';
import { TrackRequest } from '@/components/TrackRequest';
import { StartExperimentButton } from '@/components/StartExperimentButton';
import { getServerI18n } from '@/lib/i18n/server';

export default async function FeedPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=%2Ffeed');
  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  const feedDelayDays = ent.feedDelayDays;
  const planLabel = ent.planCode;
  const realtime = feedDelayDays === 0;
  const feed = await OpportunityService.listFeedCards({ limit: 10, minAgeDays: feedDelayDays });
  const observations = realtime
    ? await OpportunityService.listLiveObservations({ limit: 20 })
    : [];
  const discoveries = realtime ? await OpportunityService.listDiscoveryItems(12) : [];
  const experiments = realtime ? await OpportunityService.listExperimentCards(8) : [];

  const { t, isZh } = await getServerI18n();

  const delayText = realtime
    ? t('feed.delayRealtime')
    : t('feed.delayDays', { days: feedDelayDays });

  const steps = isZh
    ? [
        ['1', '捕获信号'],
        ['2', '生成候选'],
        ['3', '周期观察'],
        ['4', '三维打分'],
        ['5', '发布战绩'],
      ]
    : [
        ['1', 'Signal found'],
        ['2', 'Candidate created'],
        ['3', 'Observation history'],
        ['4', 'D / M / W scoring'],
        ['5', 'Published track record'],
      ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
          {t('feed.badge')}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold text-slate-900 tracking-tight">
          {t('feed.title')}
        </h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          {t('feed.desc', { planLabel, delayText })}
        </p>
      </div>

      <div className="mb-8">
        <TrackRequest />
      </div>

      <FeedClient initialItems={feed.items} total={feed.total} />

      {realtime && (
        <section className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('feed.sourceDiscoveriesTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('feed.sourceDiscoveriesDesc')}</p>
            </div>
            <span className="text-xs text-slate-400">
              {isZh ? `${discoveries.length} 条近期信号` : `${discoveries.length} recent signals`}
            </span>
          </div>
          {discoveries.length === 0 ? (
            <p className="mt-5 text-sm text-slate-600">{t('feed.noDiscoveries')}</p>
          ) : (
            <div className="mt-5 grid md:grid-cols-2 gap-4">
              {discoveries.map((item) => (
                <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                    <span>{item.provider}</span>
                    <time dateTime={item.sourcePublishedAt || item.firstCollectedAt}>
                      {new Date(item.sourcePublishedAt || item.firstCollectedAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US')}
                    </time>
                  </div>
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block font-semibold text-slate-900 hover:text-blue-700">
                    {item.title}
                  </a>
                  {item.excerpt && <p className="mt-2 text-xs leading-relaxed text-slate-600 line-clamp-3">{item.excerpt}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.intents.length === 0 ? (
                      <span className="text-[11px] text-slate-400">{isZh ? '意图假设待生成' : 'Intent hypotheses pending'}</span>
                    ) : item.intents.map((intent) => (
                      <span key={`${item.id}-${intent.queryHypothesis}`} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                        {intent.queryHypothesis}
                      </span>
                    ))}
                  </div>
                  {item.validation && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-semibold">
                        <span>{isZh ? '自动补全' : 'Autocomplete'}: {item.validation.autocompleteStatus}</span>
                        <span>SERP: {item.validation.serpStatus}</span>
                        <span>{isZh ? '供给缺口' : 'Supply'}: {item.validation.supplyGapStatus.replaceAll('_', ' ')}</span>
                      </div>
                      {item.validation.supplyGapNote && <p className="mt-1 leading-relaxed">{item.validation.supplyGapNote}</p>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {realtime && experiments.length > 0 && (
        <section className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('feed.activeExperimentsTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('feed.activeExperimentsDesc')}</p>
            </div>
            <span className="text-xs text-slate-400">
              {isZh ? `${experiments.length} 项提议` : `${experiments.length} proposed`}
            </span>
          </div>
          <div className="mt-5 grid md:grid-cols-2 gap-4">
            {experiments.map((experiment) => (
              <article key={experiment.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
                <div className="flex items-center justify-between gap-3 text-[11px] text-amber-800">
                  <span className="font-semibold uppercase tracking-wide">
                    {isZh ? '实验 · 提议' : 'Experiment · proposed'}
                  </span>
                  <span>{experiment.queryHypothesis}</span>
                </div>
                <h3 className="mt-2 font-semibold text-slate-900">{experiment.title}</h3>
                <dl className="mt-4 grid gap-3 text-xs text-slate-700">
                  <div>
                    <dt className="font-semibold text-slate-500">{isZh ? '核心任务 (Core job)' : 'Core job'}</dt>
                    <dd>{experiment.coreJob}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">{isZh ? '页面形态 (Page shape)' : 'Page shape'}</dt>
                    <dd>{experiment.recommendedPageShape}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">{isZh ? '最小功能 (Minimum feature)' : 'Minimum feature'}</dt>
                    <dd>{experiment.minimumFeature}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">{isZh ? '成功信号 (Success signal)' : 'Success signal'}</dt>
                    <dd>{experiment.successSignal}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">{isZh ? '放弃红线 (Abandon when)' : 'Abandon when'}</dt>
                    <dd>{experiment.abandonCondition}</dd>
                  </div>
                </dl>
                <a href={experiment.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-[11px] text-blue-700 hover:underline">
                  {isZh ? '来源: ' : 'Source: '} {experiment.sourceTitle}
                </a>
                <StartExperimentButton experimentCardId={experiment.id} title={experiment.title} />
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="mt-14">
        <h2 className="text-xl font-bold text-slate-900">
          {isZh ? '正在监测的新兴市场候选词' : 'Emerging market candidates'}
        </h2>
        {realtime ? (
          <p className="mt-1 text-sm text-slate-500 max-w-3xl">
            {isZh
              ? '这些候选词来源于搜索信号，目前仍在持续观察期内。它们不是发布的裁决：单次观测不能得出市场结论。'
              : 'These candidates are discovered from search signals and are still being observed. They are not published verdicts: one observation is not a market conclusion.'}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            {isZh
              ? `实时监测属于 Pro 专享功能。免费版在初次观察后 ${feedDelayDays} 天展示已发布决策。`
              : `Realtime observations are part of Pro. Free shows published decisions after ${feedDelayDays} days.`}
          </p>
        )}
        {realtime && observations.length > 0 && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-slate-600">
            {steps.map(([step, label], index) => (
              <div key={step} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                <span className="font-mono font-bold text-blue-700">{step}</span>
                <span>{label}</span>
                {index < 4 && <span className="hidden sm:inline text-slate-300">→</span>}
              </div>
            ))}
          </div>
        )}
        {realtime && observations.length === 0 && (
          <p className="mt-6 text-sm text-slate-600">
            {isZh ? '暂无处于监测中的候选词。' : 'No emerging candidates stored yet.'}
          </p>
        )}
        {realtime && observations.length > 0 && (
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            {observations.map((item) => (
              <Link
                key={item.opportunityId}
                href={`/opportunities/${item.slug}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-300"
              >
                <div className="text-xs font-semibold text-slate-500">
                  {item.marketCountry} · {item.researchLanguage} · {item.confidence} {isZh ? '置信度' : 'confidence'}
                </div>
                <h3 className="mt-2 font-bold text-slate-900">{item.primaryQuery}</h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed line-clamp-3">
                  {item.featuredEvidenceSnippet || item.whyNowSummary}
                </p>
                <p className="mt-3 text-xs font-semibold text-slate-700">
                  D {item.dBand} · M {item.mBand} · W {item.wBand}
                </p>
                <div className="mt-3 text-[11px] text-slate-500">
                  {isZh
                    ? `观测覆盖天数: ${item.observationDays ?? 0} 天自动补全 · ${item.serpObservationDays ?? 0} 天 SERP`
                    : `Observation coverage: ${item.observationDays ?? 0} autocomplete days · ${item.serpObservationDays ?? 0} SERP days`}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {item.discoverySource ? (isZh ? `来源: ${item.discoverySource}。` : `Source: ${item.discoverySource}. `) : ''}
                  {item.candidateReason || (isZh ? '从近期搜索信号中发现；证据仍在持续采集。' : 'Discovered from recent search signals; evidence is still being collected.')}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
