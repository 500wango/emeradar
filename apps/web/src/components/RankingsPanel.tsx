'use client';

import { useState } from 'react';
import { TrendingUp, Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

/**
 * 无感排名追踪面板（PRD F10、04 §9.2、19 Epic 1.5）。
 *
 * 这块界面的存在理由与质押面板同源：后端每天在采、在写，但**没有入口用户就不知道
 * 它在写**。而"30 天进 Top 100"恰恰是这套产品对外承诺的核心指标——一个用户看不到
 * 自己曲线的产品，把这条承诺变成了只有我们自己知道的事。
 *
 * 只读，没有副作用：曲线在采集时顺带落库，这里刷新一次不会产生任何供应商调用，
 * 所以不需要像点火包那样防着"点一下生成一次"。
 */

export interface RankRow {
  date: string;
  rank: number | null;
  matchedUrl: string | null;
  matchedVia: string | null;
}

export interface QueryRankSeriesRow {
  queryId: string;
  queryText: string;
  rows: RankRow[];
  bestRankEver: number | null;
  firstRankedOn: string | null;
}

export interface RankingView {
  observedDays: number;
  firstRankedOn: string | null;
  daysToFirstRank: number | null;
  bestRankEver: number | null;
  series: QueryRankSeriesRow[];
}

/** 曲线上最多显示多少个观测点。再长的历史对"爬升"这件事没有新增信息。 */
const CURVE_POINTS = 10;

export function RankingsPanel({ projectId, initial }: { projectId: string; initial: RankingView }) {
  const { t } = useI18n();
  const [view, setView] = useState<RankingView>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/serp-rankings`);
      if (!res.ok) throw new Error(t('projects.rankingsFailed'));
      setView(await res.json());
    } catch (err: any) {
      setError(err.message || t('projects.rankingsFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 rounded-sm border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 text-fg-subtle" />
        <h3 className="text-sm font-semibold text-fg">{t('projects.rankingsTitle')}</h3>
        {/* 徽章放英文 token 与数字（同 CredentialPanel：Badge 的 uppercase 对中文是空操作）。 */}
        {view.bestRankEver !== null ? (
          <Badge tone="signal" size="sm">{`TOP 100 · #${view.bestRankEver}`}</Badge>
        ) : view.observedDays > 0 ? (
          <Badge tone="warn" size="sm">
            {`OBSERVED · ${view.observedDays}D`}
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            NOT TRACKED YET
          </Badge>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={refresh} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {pending ? t('projects.rankingsRefreshing') : t('projects.rankingsRefresh')}
        </Button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-fg-muted">{t('projects.rankingsDesc')}</p>

      {view.series.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-fg-subtle">{t('projects.rankingsEmpty')}</p>
      ) : (
        <>
          {/* 汇总行。`daysToFirstRank` 就是 Gate 1 判据的那个数：立项到首次入榜的自然日数，
              所以它必须显示出来，而不是只留在后台的统计里。 */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-fg-subtle">
            <span>{t('projects.rankingsObserved', { days: view.observedDays })}</span>
            {view.firstRankedOn ? (
              <span className="text-signal">
                {t('projects.rankingsFirstRanked', {
                  date: view.firstRankedOn,
                  days: view.daysToFirstRank ?? 0,
                })}
              </span>
            ) : (
              // 没入榜就直说。写"暂无数据"会把"我们看了 30 天，它一次都没进"这件事
              // 藏起来，而那正是用户需要知道的信息。
              <span className="text-fg-muted">{t('projects.rankingsNotRanked')}</span>
            )}
            {view.bestRankEver !== null && (
              <span>{t('projects.rankingsBest', { rank: view.bestRankEver })}</span>
            )}
          </div>

          <div className="mt-3 space-y-3 border-t border-line pt-3">
            {view.series.map((series) => {
              const shown = series.rows.slice(-CURVE_POINTS);
              const truncated = series.rows.length > shown.length;
              return (
                <div key={series.queryId}>
                  <p className="font-mono text-[11px] text-fg-muted">{series.queryText}</p>
                  <div
                    className="mt-1 flex flex-wrap items-center gap-1"
                    role="list"
                    aria-label={t('projects.rankingsCurveLabel')}
                  >
                    {truncated && <span className="text-[11px] text-fg-subtle">&hellip;</span>}
                    {shown.map((row, index) => (
                      <span key={row.date} role="listitem" className="flex items-center gap-1">
                        {index > 0 && <span className="text-[11px] text-fg-subtle">&rarr;</span>}
                        <span
                          title={
                            // 归因要说全：命中了哪条 URL、以及这个主机名是靠哪一类凭证认领的。
                            // `STORE_LISTING_URL` 只按主机名匹配，所以那种命中比自有域名弱。
                            row.matchedUrl
                              ? t('projects.rankingsMatchedAt', {
                                  url: row.matchedUrl,
                                  via: row.matchedVia ?? '',
                                })
                              : t('projects.rankingsNoRankYet')
                          }
                          className={[
                            'rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
                            row.rank === null
                              ? 'border-line bg-surface-2 text-fg-subtle'
                              : 'border-accent/50 bg-accent/10 text-accent',
                          ].join(' ')}
                        >
                          {row.date.slice(5)}
                          {' · '}
                          {row.rank === null ? '—' : `#${row.rank}`}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
