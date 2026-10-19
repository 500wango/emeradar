import { query } from '@emeradar/db';

/**
 * 分层轮询（Phase 4）。
 *
 * 背景：如果每个候选/追踪机会每天全量抓 Autocomplete + SERP + 竞品 HTML，成本会随
 * 池子线性爆炸。但**不能简单砍频率**：`serpHistoryDays >= 14` 是发布门的一部分，
 * 直接改成每周抓一次会让任何机会都攒不够基线，把成本问题变成“永远发不出去”。
 *
 * 所以策略是**基线期全量、之后抽稀**：
 *   - 基线期（SERP 观测天数 < 14）：每天抓，`BASELINE_DAILY`；
 *   - 基线之后：每 7 天抓一次，`WEEKLY`；
 *   - 事件触发（Autocomplete 顺位跳变）：额外抓一次，`EVENT_AUTOCOMPLETE_JUMP`。
 *
 * 每次决策都写进 `serp_snapshots.sampling_reason`，回测才能区分“没抓”和“抓失败”。
 * 事件触发本身带选择偏差，所以基线期始终保留全量随机样本（即每天抓）。
 */
export const SAMPLING_POLICY_VERSION = 'sampling-v1';
export const BASELINE_SERP_DAYS = 14;
export const THINNED_INTERVAL_DAYS = 7;

export type SamplingReason =
  | 'BASELINE_DAILY'
  | 'WEEKLY'
  | 'EVENT_AUTOCOMPLETE_JUMP'
  | 'BACKFILL';

export interface SerpSamplingDecision {
  collect: boolean;
  reason: SamplingReason;
  serpHistoryDays: number;
  daysSinceLast: number | null;
}

const TOP_RANK_TOLERANCE = 3;
/** 建议集合重叠率低于此值视为结构变化（换了一批相关词）。 */
const SET_OVERLAP_FLOOR = 0.6;

/**
 * Autocomplete 顺位是否发生“跳变”：
 * 相关词排名中位数相比上一次观测移动超过容忍度，或建议集合大幅变化。
 * 只读已入库观测，不发请求。
 */
export async function autocompleteJumped(queryId: string): Promise<boolean> {
  const res = await query<{ observed_date: string; suggestions: string[] }>(
    `SELECT observed_date::text, suggestions
       FROM autocomplete_observations
      WHERE query_id = $1
      ORDER BY observed_date DESC
      LIMIT 2`,
    [queryId]
  );
  if (res.rows.length < 2) return false;
  const [latest, previous] = res.rows;
  const prevIndex = new Map(previous.suggestions.map((s, index) => [s, index]));
  const movements: number[] = [];
  latest.suggestions.forEach((suggestion, index) => {
    const before = prevIndex.get(suggestion);
    if (before === undefined) return;
    movements.push(Math.abs(before - index));
  });
  if (movements.length === 0) return latest.suggestions.length > 0;

  // 只用中位位移会漏掉“整表反转”：5 条反转的中位数只有 2，看起来像没动。
  // 所以同时看前三名换血与集合重叠率。
  const prevTop3 = new Set(previous.suggestions.slice(0, 3));
  const top3Changed = latest.suggestions.slice(0, 3).filter((s) => !prevTop3.has(s)).length;
  const prevSet = new Set(previous.suggestions);
  const latestSet = new Set(latest.suggestions);
  const union = new Set([...prevSet, ...latestSet]).size;
  const overlap = union === 0 ? 1 : [...latestSet].filter((s) => prevSet.has(s)).length / union;

  movements.sort((a, b) => a - b);
  const median = movements[Math.floor(movements.length / 2)];
  return (
    median >= TOP_RANK_TOLERANCE ||
    top3Changed >= 2 ||
    overlap < SET_OVERLAP_FLOOR
  );
}

export async function decideSerpSampling(
  queryId: string,
  obsDate: string
): Promise<SerpSamplingDecision> {
  const res = await query<{ days: number; last: string | null }>(
    `SELECT COUNT(DISTINCT obs_date)::int AS days,
            MAX(obs_date)::text AS last
       FROM serp_snapshots
      WHERE query_id = $1 AND obs_date < $2::date`,
    [queryId, obsDate]
  );
  const serpHistoryDays = res.rows[0]?.days ?? 0;
  const lastDate = res.rows[0]?.last ?? null;
  const daysSinceLast = lastDate
    ? Math.round(
        (Date.parse(`${obsDate}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86_400_000
      )
    : null;

  // 基线期不抽稀：否则任何机会都攒不够 14 天，门槛变成永动机。
  if (serpHistoryDays < BASELINE_SERP_DAYS) {
    return { collect: true, reason: 'BASELINE_DAILY', serpHistoryDays, daysSinceLast };
  }
  if (daysSinceLast !== null && daysSinceLast < THINNED_INTERVAL_DAYS) {
    const jumped = await autocompleteJumped(queryId).catch(() => false);
    if (jumped) {
      return { collect: true, reason: 'EVENT_AUTOCOMPLETE_JUMP', serpHistoryDays, daysSinceLast };
    }
    return { collect: false, reason: 'WEEKLY', serpHistoryDays, daysSinceLast };
  }
  return { collect: true, reason: 'WEEKLY', serpHistoryDays, daysSinceLast };
}

export interface CommercialSamplingDecision {
  collect: boolean;
  reason: 'DOMAIN_CACHE_HIT' | 'DOMAIN_CACHE_EXPIRED' | 'CONFIRMED_404';
}

/**
 * 竞品定价按**域名**缓存，而不是按关键词抓取。
 *
 * 50 个 PDF 相关长尾词可能共享同几个竞品域名；逐词抓取等于把同一份 HTML 抓 50 次。
 * 域名级缓存让每个域名每 14 天只穿透一次；7 天内确认 404 的域名直接跳过。
 */
export async function decideCommercialSampling(
  domain: string,
  obsDate: string,
  withinDays = 14
): Promise<CommercialSamplingDecision> {
  const res = await query<{ fetch_status: string; obs_date: string }>(
    `SELECT cs.fetch_status, cs.obs_date::text
       FROM commercial_snapshots cs
       JOIN commercial_targets ct ON ct.id = cs.commercial_target_id
      WHERE lower(ct.domain) = lower($1)
        AND cs.obs_date <= $2::date
      ORDER BY cs.obs_date DESC
      LIMIT 1`,
    [domain, obsDate]
  );
  const row = res.rows[0];
  if (!row) return { collect: true, reason: 'DOMAIN_CACHE_EXPIRED' };
  if (row.fetch_status === 'BLOCKED_404') return { collect: false, reason: 'CONFIRMED_404' };

  const age = Math.round(
    (Date.parse(`${obsDate}T00:00:00Z`) - Date.parse(`${row.obs_date}T00:00:00Z`)) / 86_400_000
  );
  if (row.fetch_status === 'OK' && age < withinDays) {
    return { collect: false, reason: 'DOMAIN_CACHE_HIT' };
  }
  return { collect: true, reason: 'DOMAIN_CACHE_EXPIRED' };
}
