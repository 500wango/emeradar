import { query } from '@emeradar/db';
import {
  KeywordSeedCollector,
  type KeywordSeedCredentials,
  volumeBand,
} from '@emeradar/collectors';

/**
 * 需求补全：词量、CPC、供应商意图、12 个月趋势。
 *
 * **这些都不进评分。** D 轴若读第三方词量，就会与 `external_demand_formed`
 * 的事件判据自证（06 §7.1a）。它们只服务三件事：
 *   1. 入口排序（同样的观测成本，先看需求大的）；
 *   2. 展示（让“这个词多大”可回答）；
 *   3. 研报叙述（趋势）。
 */
export const DEMAND_RULE_VERSION = 'demand-v1';

/** 趋势判据：近 3 个月均值 vs 之前 3 个月均值，±15% 为界。 */
export const TREND_THRESHOLD = 0.15;
/** 至少要有 6 个月数据才判趋势，否则 FLAT 都不给（返回 null）。 */
export const TREND_MIN_MONTHS = 6;
/** 一次补全最多处理多少个机会。 */
export const DEMAND_BATCH_SIZE = 50;

export type DemandTrend = 'GROWING' | 'FLAT' | 'DECLINING';

export interface DemandEnrichResult {
  scanned: number;
  updated: number;
  failed: number;
  skipped: boolean;
  reason?: string;
}

function credentialsFromEnv(env = process.env): KeywordSeedCredentials | null {
  if (env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) {
    return { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD };
  }
  return env.AISA_API_KEY ? { aisaApiKey: env.AISA_API_KEY } : null;
}

/**
 * 从逐月序列推趋势。
 *
 * 按 `(year, month)` 排序，取最后 6 个月：后 3 个月均值 / 前 3 个月均值 - 1。
 * 数据不足 6 个月返回 null——宁可说“不知道”，也不把噪声叫趋势。
 */
export function deriveTrend(
  monthly: Array<{ year: number; month: number; searchVolume: number }>
): DemandTrend | null {
  const sorted = [...monthly].sort((a, b) => a.year - b.year || a.month - b.month);
  if (sorted.length < TREND_MIN_MONTHS) return null;
  const tail = sorted.slice(-6);
  const recent = tail.slice(-3);
  const prior = tail.slice(0, 3);
  const avg = (rows: typeof tail) => rows.reduce((sum, row) => sum + row.searchVolume, 0) / rows.length;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  if (priorAvg <= 0) return null;
  const delta = (recentAvg - priorAvg) / priorAvg;
  if (delta >= TREND_THRESHOLD) return 'GROWING';
  if (delta <= -TREND_THRESHOLD) return 'DECLINING';
  return 'FLAT';
}

/**
 * 补全一批机会的需求数据。
 *
 * 只挑 CANDIDATE / TRACKED 且超过 30 天没查过的——词量月度更新，天天查是浪费。
 */
export async function enrichDemand(
  limit = DEMAND_BATCH_SIZE,
  collector: KeywordSeedCollector | null = (() => {
    const creds = credentialsFromEnv();
    return creds ? new KeywordSeedCollector(creds) : null;
  })()
): Promise<DemandEnrichResult> {
  if (!collector) {
    return { scanned: 0, updated: 0, failed: 0, skipped: true, reason: 'no DataForSEO / AISA credentials' };
  }

  const rows = await query<{ id: string; title: string; market_country: string; research_language: string }>(
    `SELECT o.id, o.title, o.market_country, o.research_language
       FROM opportunities o
      WHERE o.status IN ('CANDIDATE','TRACKED')
        AND (o.demand_checked_at IS NULL OR o.demand_checked_at < NOW() - INTERVAL '30 days')
      ORDER BY o.entry_search_volume DESC NULLS LAST, o.created_at DESC
      LIMIT $1`,
    [limit]
  );

  const result: DemandEnrichResult = { scanned: rows.rows.length, updated: 0, failed: 0, skipped: false };
  if (rows.rows.length === 0) return result;

  // 按市场分批：不同市场的 location/language 不能混在一次请求里。
  const byMarket = new Map<string, typeof rows.rows>();
  for (const row of rows.rows) {
    const key = `${row.market_country}|${row.research_language}`;
    byMarket.set(key, [...(byMarket.get(key) ?? []), row]);
  }

  for (const [key, group] of byMarket) {
    const [country, language] = key.split('|');
    const market = {
      locationCode: ({ US: 2840, GB: 2826, CA: 2124, AU: 2036 } as Record<string, number>)[country?.toUpperCase() ?? 'US'],
      languageCode: (language || 'en-US').slice(0, 2).toLowerCase(),
    };
    const keywords = group.map((row) => row.title);

    const [overview, intent, history] = await Promise.all([
      collector.overview(keywords, market).catch(() => null),
      collector.intent(keywords).catch(() => null),
      collector.history(keywords, market).catch(() => null),
    ]);

    if (!overview && !intent && !history) {
      result.failed += group.length;
      continue;
    }

    const overviewByKeyword = new Map((overview ?? []).map((row) => [row.keyword.toLowerCase(), row]));
    const intentByKeyword = new Map((intent ?? []).map((row) => [row.keyword.toLowerCase(), row]));
    const historyByKeyword = new Map((history ?? []).map((row) => [row.keyword.toLowerCase(), row]));

    for (const row of group) {
      const keyword = row.title.toLowerCase();
      const detail = overviewByKeyword.get(keyword) ?? historyByKeyword.get(keyword) ?? null;
      const vendorIntent = intentByKeyword.get(keyword)?.label ?? null;
      const monthly = historyByKeyword.get(keyword)?.monthlySearches ?? [];
      const trend = deriveTrend(monthly);

      const volume = detail?.searchVolume ?? null;
      try {
        await query(
          `UPDATE opportunities
              SET entry_search_volume = COALESCE($2, entry_search_volume),
                  entry_keyword_difficulty = COALESCE($3, entry_keyword_difficulty),
                  entry_cpc = COALESCE($4, entry_cpc),
                  volume_band = COALESCE($5, volume_band),
                  vendor_intent = COALESCE($6, vendor_intent),
                  demand_trend = COALESCE($7, demand_trend),
                  demand_checked_at = NOW()
            WHERE id = $1`,
          [
            row.id,
            volume,
            detail?.keywordDifficulty ?? null,
            detail?.cpc ?? null,
            volume === null ? null : volumeBand(volume),
            vendorIntent,
            trend,
          ]
        );

        if (monthly.length > 0) {
          await query(
            `INSERT INTO opportunity_demand_history
               (opportunity_id, provider, monthly, trend, rule_version)
             VALUES ($1, $2, $3, $4, $5)`,
            [row.id, 'dataforseo_labs', JSON.stringify(monthly), trend, DEMAND_RULE_VERSION]
          );
        }
        result.updated++;
      } catch (error) {
        result.failed++;
        console.warn(
          `[demand] update failed for ${row.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  return result;
}
