import { query } from '@emeradar/db';

/**
 * 72h `STALE_DATA` 降级（04 §2、ADR-021）。
 *
 * 采集失败时，若最近一次成功快照在 72 小时内，就用它继续评分，并在账本上打
 * `STALE_DATA`；超过 72h 才让该轴真正 `INSUFFICIENT`。这里只负责取旧事实，
 * 判定与标记由调用方完成。
 */
export const STALE_WINDOW_HOURS = 72;

export interface StaleAutocomplete {
  observedDate: string;
  suggestions: string[];
  depth: number;
}

export interface StaleSerp {
  snapshotId: string;
  observedDate: string;
  weakResultRatio: number;
  weaknessScore: number;
  depth: number;
  resultCount: number;
  items: Array<{ rank: number; url: string; domain: string; resultType: string }>;
}

export async function loadStaleAutocomplete(
  queryId: string,
  obsDate: string
): Promise<StaleAutocomplete | null> {
  const res = await query<{ observed_date: string; suggestions: string[]; depth: number }>(
    `SELECT observed_date::text AS observed_date, suggestions, depth
       FROM autocomplete_observations
      WHERE query_id = $1
        AND observed_date < $2::date
        AND created_at >= NOW() - ($3 || ' hours')::interval
      ORDER BY observed_date DESC
      LIMIT 1`,
    [queryId, obsDate, String(STALE_WINDOW_HOURS)]
  );
  const row = res.rows[0];
  if (!row) return null;
  return { observedDate: row.observed_date, suggestions: row.suggestions ?? [], depth: row.depth };
}

/**
 * 取最近一次成功 SERP 快照。
 *
 * `windowHours` 默认 72（故障降级）；**分层轮询的“计划复用”传更长的窗口**——
 * 那是主动不抓，不是采集失败，两者必须能区分，否则抽样会被记成一次故障。
 */
export async function loadStaleSerp(
  queryId: string,
  obsDate: string,
  windowHours = STALE_WINDOW_HOURS
): Promise<StaleSerp | null> {
  const res = await query<{
    id: string;
    observed_date: string;
    weak_result_ratio: number;
    weakness_score: number | null;
    depth: number;
    result_count: number;
  }>(
    `SELECT id, obs_date::text AS observed_date, weak_result_ratio::float8 AS weak_result_ratio,
            weakness_score::float8 AS weakness_score, depth, result_count
       FROM serp_snapshots
      WHERE query_id = $1
        AND obs_date < $2::date
        AND created_at >= NOW() - ($3 || ' hours')::interval
      ORDER BY obs_date DESC
      LIMIT 1`,
    [queryId, obsDate, String(windowHours)]
  );
  const row = res.rows[0];
  if (!row) return null;

  const itemsRes = await query<{ rank: number; url: string; domain: string; result_type: string }>(
    `SELECT rank, url, domain, result_type FROM serp_results
      WHERE serp_snapshot_id = $1 ORDER BY rank`,
    [row.id]
  );
  const ratio = Number(row.weak_result_ratio) || 0;
  return {
    snapshotId: row.id,
    observedDate: row.observed_date,
    weakResultRatio: ratio,
    // 老快照没有分数，用比率近似；新快照一定写入真实分数。
    weaknessScore: row.weakness_score !== null ? Number(row.weakness_score) : Math.round(ratio * 100 * 100) / 100,
    depth: row.depth,
    resultCount: row.result_count,
    items: itemsRes.rows.map((item) => ({
      rank: item.rank,
      url: item.url,
      domain: item.domain,
      resultType: item.result_type,
    })),
  };
}

export interface StaleCommercialEvidence {
  evidenceId: string;
  observedAt: string;
}

/** 某域名在 72h 内最近一条可复用的商业证据；crawl 失败时用它登记降级来源。 */
export async function loadStaleCommercialEvidence(
  opportunityId: string,
  domain: string
): Promise<StaleCommercialEvidence | null> {
  const res = await query<{ id: string; observed_at: string }>(
    `SELECT id::text AS id, observed_at::text AS observed_at FROM evidence
      WHERE opportunity_id = $1
        AND lower(coalesce(domain, '')) = lower($2)
        AND evidence_class = 'OBSERVED'
        AND observed_at >= NOW() - ($3 || ' hours')::interval
        AND source_type IN ('PAID_TIER_OBSERVED','PAYMENT_INFRA_DETECTED')
      ORDER BY observed_at DESC
      LIMIT 1`,
    [opportunityId, domain, String(STALE_WINDOW_HOURS)]
  );
  const row = res.rows[0];
  return row ? { evidenceId: row.id, observedAt: row.observed_at } : null;
}

export async function hasStaleCommercialEvidence(opportunityId: string, domain: string): Promise<boolean> {
  return (await loadStaleCommercialEvidence(opportunityId, domain)) !== null;
}

export interface StaleDataEventInput {
  obsDate: string;
  opportunityId: string;
  source: 'AUTOCOMPLETE' | 'SERP' | 'COMMERCIAL';
  domain?: string;
  referenceId?: string | null;
  observedAt?: Date | null;
}

/** 记录一次降级实际引用的旧快照/证据；同一 obs_date+source+domain 只记一次。 */
export async function recordStaleDataEvent(input: StaleDataEventInput): Promise<void> {
  await query(
    `INSERT INTO stale_data_events
       (obs_date, opportunity_id, source, domain, reference_id, observed_at)
     VALUES ($1::date, $2, $3, $4, $5, $6)
     ON CONFLICT (obs_date, opportunity_id, source, domain) DO NOTHING`,
    [
      input.obsDate,
      input.opportunityId,
      input.source,
      input.domain ?? '',
      input.referenceId ?? null,
      input.observedAt ?? null,
    ]
  );
}
