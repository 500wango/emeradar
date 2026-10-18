import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { TrackRecordService } from '@emeradar/services';
import { formatDate } from '@/lib/format';
import { getServerI18n } from '@/lib/i18n/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbJsonLd, datasetJsonLd, pageMetadata } from '@/lib/seo/site';
import { Badge, type BadgeTone, VerdictBadge, type Verdict } from '@/components/ui/Badge';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Stat } from '@/components/ui/Stat';

export const dynamic = 'force-dynamic';

/**
 * The public ledger view.
 *
 * The one rule this page exists to honour: a rate is only printed when the
 * sample behind it contains both hits and misses.
 *
 * The service now owns that rule — `TrackRecordService` returns `null` rather
 * than a rate for an empty or one-sided sample, so the public API and the
 * homepage telemetry are covered too, not just this page. `accuracy()` stays as
 * the second line of defence: it never trusts a rate string, and falls back to
 * the raw `hits/total` counts, which can never be mistaken for a track record.
 */
function accuracy(hits: number | undefined, evaluated: number | undefined, rate: string | null | undefined) {
  const total = evaluated ?? 0;
  const hit = hits ?? 0;
  if (total === 0) return '—';
  if (hit === 0 || hit === total) return `${hit}/${total}`;
  return rate ?? `${hit}/${total}`;
}

const statusTones: Record<string, BadgeTone> = {
  MATURED: 'signal',
  EVALUATING: 'info',
  ACCUMULATING: 'neutral',
};

const outcomeTones: Record<string, BadgeTone> = {
  HIT: 'signal',
  MISS: 'danger',
  PENDING: 'neutral',
};

const TH = 'py-3 px-5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle';
const TD = 'py-4 px-5 align-middle';

export async function generateMetadata() {
  const { locale, t } = await getServerI18n();
  return pageMetadata({
    title: t('seo.trackRecord.title'),
    description: t('seo.trackRecord.description'),
    path: '/track-record',
    locale,
  });
}

export default async function TrackRecordPage() {
  const data = await TrackRecordService.getPublicTrackRecord();
  const { stats, episodes, cohorts = [], checkpoints = [], builderOutcomes } = data;
  const { t, isZh } = await getServerI18n();

  const checkpoint = checkpoints[0];
  const overallRate = accuracy(stats.hitsCount, stats.evaluatedEpisodes, stats.hitRate30d);

  const breadcrumbs = breadcrumbJsonLd([
    { name: isZh ? '首页' : 'Home', path: '/' },
    { name: isZh ? '可验证战绩' : 'Track Record', path: '/track-record' },
  ]);

  const datasetSchema = datasetJsonLd({
    name: 'Emeradar Search Opportunity Decision Outcomes & Accuracy Ledger',
    description: t('seo.trackRecord.description'),
    path: '/track-record',
  });

  return (
    <>
      <JsonLd data={[breadcrumbs, datasetSchema]} />
      <PageFrame width="full">
        <PageHeader
          eyebrow="TRACK RECORD"
          title={t('trackRecord.title')}
          lede={t('trackRecord.desc')}
          aside={
            <Badge tone="signal" size="sm" dot>
              {t('trackRecord.badge')}
            </Badge>
          }
        />

      {/* Headline readings. The hit rate is blanked rather than guessed whenever
          the evaluated set is one-sided — see `accuracy()`. */}
      <section className="grid grid-cols-1 gap-px border-b border-line sm:grid-cols-3">
        <div className="border-line py-8 sm:border-r sm:pr-8">
          <Stat
            value={overallRate}
            label={t('trackRecord.hitRate30d')}
            tone={overallRate === '—' ? 'default' : 'signal'}
            size="lg"
          />
          <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
            {stats.evaluatedEpisodes > 0 ? t('trackRecord.hitRateDesc') : t('trackRecord.hitRateEmpty')}
          </p>
        </div>
        <div className="border-line py-8 sm:border-r sm:px-8">
          <Stat value={stats.evaluatedEpisodes} label={t('trackRecord.evaluatedEpisodes')} size="lg" />
          <p className="mt-2 text-xs leading-relaxed text-fg-subtle">{t('trackRecord.evaluatedDesc')}</p>
        </div>
        <div className="py-8 sm:pl-8">
          <Stat value={stats.totalPredictions} label={t('trackRecord.totalPredictions')} tone="accent" size="lg" />
          <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
            {t('trackRecord.totalPredictionsDesc')}
          </p>
        </div>
      </section>

      {/* Cohort matrix */}
      <Panel className="mt-12 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <h2 className="font-display text-base font-bold text-fg">{t('trackRecord.cohortTitle')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{t('trackRecord.cohortDesc')}</p>
          </div>
          <Badge tone="signal">{t('trackRecord.cohortBadge')}</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line">
              <tr>
                <th scope="col" className={TH}>{t('trackRecord.colCohortMonth')}</th>
                <th scope="col" className={TH}>{t('trackRecord.colSampleSize')}</th>
                <th scope="col" className={TH}>{t('trackRecord.colT30')}</th>
                <th scope="col" className={TH}>{t('trackRecord.colT60')}</th>
                <th scope="col" className={TH}>{t('trackRecord.colT90')}</th>
                <th scope="col" className={TH}>{t('trackRecord.colMaturity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cohorts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-xs text-fg-subtle">
                    {t('trackRecord.noCohortData')}
                  </td>
                </tr>
              ) : (
                cohorts.map((c: any) => (
                  <tr key={c.month}>
                    <td className={`${TD} font-mono text-xs font-bold text-fg`}>{c.month}</td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>{c.total}</td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>
                      {accuracy(c.hits30, c.eval30, c.hitRate30d)}
                    </td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>
                      {accuracy(c.hits60, c.eval60, c.hitRate60d)}
                    </td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>
                      {accuracy(c.hits90, c.eval90, c.hitRate90d)}
                    </td>
                    <td className={TD}>
                      <Badge tone={statusTones[c.status] ?? 'neutral'}>{c.status}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Builder outcomes */}
      <Panel className="mt-8 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <h2 className="font-display text-base font-bold text-fg">
              {isZh ? '项目结果（Builder Outcomes）' : 'Builder Outcomes'}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
              {isZh
                ? '用户真正做出来之后的结果，按当初的裁决分组；样本不足 30 时不展示比例。'
                : 'What happened after builders shipped, grouped by the original verdict. Rates are withheld below 30 projects.'}
            </p>
          </div>
          <Badge tone="neutral">
            {builderOutcomes?.sampleSize ?? 0} / {builderOutcomes?.minSample ?? 30}
          </Badge>
        </div>

        {!builderOutcomes?.groups ? (
          <p className="px-6 py-8 text-sm leading-relaxed text-fg-muted">
            {isZh
              ? `目前有 ${builderOutcomes?.sampleSize ?? 0} 个项目完成回访，达到 30 个后才公开分组结果。`
              : `${builderOutcomes?.sampleSize ?? 0} projects have check-ins; grouped results are published at 30.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th className={TH}>{isZh ? '原始裁决' : 'Verdict'}</th>
                  <th className={TH}>{isZh ? '项目' : 'Projects'}</th>
                  <th className={TH}>{isZh ? '已上线' : 'Launched'}</th>
                  <th className={TH}>{isZh ? '有起色' : 'Traction'}</th>
                  <th className={TH}>{isZh ? '已放弃' : 'Abandoned'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {builderOutcomes.groups.map((row: any) => (
                  <tr key={row.verdict}>
                    <td className={`${TD} font-mono text-xs font-bold text-fg`}>{row.verdict}</td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>{row.total}</td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>{row.launched}</td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>{row.traction}</td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>{row.abandoned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Evaluated episodes */}
      <Panel className="mt-8 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <h2 className="font-display text-base font-bold text-fg">{t('trackRecord.episodesTitle')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{t('trackRecord.episodesDesc')}</p>
          </div>
          <Badge tone="neutral">{t('trackRecord.evaluationProtocol')}</Badge>
        </div>

        {episodes.length === 0 ? (
          <p className="px-6 py-8 text-sm leading-relaxed text-fg-muted">{t('trackRecord.noEpisodes')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th scope="col" className={TH}>{t('trackRecord.colOpportunity')}</th>
                  <th scope="col" className={TH}>{t('trackRecord.colVerdict')}</th>
                  <th scope="col" className={TH}>{t('trackRecord.colObsDate')}</th>
                  <th scope="col" className={TH}>{t('trackRecord.outcome30d')}</th>
                  <th scope="col" className={TH}>{t('trackRecord.outcome60d')}</th>
                  <th scope="col" className={TH}>{t('trackRecord.observedMetric')}</th>
                  <th scope="col" className={`${TH} text-right`}>{t('common.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {episodes.map((ep: any) => (
                  <tr key={ep.id}>
                    <td className={TD}>
                      <Link
                        href={`/opportunities/${ep.opportunity_slug}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-fg transition-colors hover:text-accent"
                      >
                        {ep.opportunity_title}
                        <ArrowUpRight className="h-3.5 w-3.5 text-fg-subtle" />
                      </Link>
                    </td>
                    <td className={TD}>
                      <VerdictBadge verdict={ep.published_verdict as Verdict} />
                    </td>
                    <td className={`${TD} font-mono text-xs text-fg-subtle`}>{formatDate(ep.predicted_at)}</td>
                    <td className={TD}>
                      <Badge tone={outcomeTones[ep.outcome_30d] ?? 'neutral'}>{ep.outcome_30d}</Badge>
                    </td>
                    <td className={TD}>
                      <Badge tone={outcomeTones[ep.outcome_60d] ?? 'neutral'}>{ep.outcome_60d || 'PENDING'}</Badge>
                    </td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>{observedMetric(ep, t)}</td>
                    <td className={`${TD} text-right`}>
                      <Link
                        href={`/opportunities/${ep.opportunity_slug}`}
                        className="font-mono text-xs text-accent transition-colors hover:brightness-110"
                      >
                        {t('trackRecord.inspect')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Ledger checkpoints. These rows are already fetched to compute the
          stats; publishing them is what makes the record checkable rather than
          merely asserted. */}
      <Panel tone="sunken" className="mt-8 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
            {t('trackRecord.ledgerTitle')}
          </h2>
          {checkpoint && <Badge tone="signal">{t('trackRecord.ledgerSealed')}</Badge>}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-fg-subtle">{t('trackRecord.ledgerDesc')}</p>
        {checkpoint ? (
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-line pt-4 font-mono text-[11px] text-fg-muted">
            <span>
              <span className="text-fg-subtle">OBS DATE </span>
              {String(checkpoint.obs_date).slice(0, 10)}
            </span>
            <span>
              <span className="text-fg-subtle">ROWS </span>
              {Number(checkpoint.total_records).toLocaleString('en-US')}
            </span>
            <span className="min-w-0">
              <span className="text-fg-subtle">MERKLE </span>
              <span className="break-all">{String(checkpoint.merkle_root).slice(0, 24)}…</span>
            </span>
          </div>
        ) : (
          <p className="mt-5 border-t border-line pt-4 font-mono text-[11px] text-fg-subtle">
            {t('trackRecord.ledgerEmpty')}
          </p>
        )}
      </Panel>
    </PageFrame>
    </>
  );
}

/**
 * The `metrics` column is keyed by horizon (`h30` / `h60` / `h90`, see
 * `PredictionEpisodeService.evaluateEpisodeAtHorizon`). The previous version of
 * this page read `metrics.cluster_expansion`, which never existed — so the
 * column silently printed its fallback for every row, and that fallback
 * hard-coded a count of new entrants ("closed by 3 entrants") that no query had
 * ever returned.
 */
function observedMetric(ep: any, t: (key: string) => string): string {
  const horizon = ep.metrics?.h30 ?? ep.metrics?.h60 ?? ep.metrics?.h90;
  const expansion = horizon?.clusterExpansion;
  if (typeof expansion === 'number' && expansion > 1) {
    return `+${Math.round((expansion - 1) * 100)}% cluster expansion`;
  }
  if (horizon?.windowClosed) return t('trackRecord.metricWindowClosed');
  return t('trackRecord.metricAccumulating');
}
