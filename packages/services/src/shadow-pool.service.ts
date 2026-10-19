import { query, transaction } from '@emeradar/db';

/**
 * Shadow Pool（Phase 2）：测得到漏判。
 *
 * 只做三件事，不做自动调参：
 *   1. 按拒绝原因**分层抽样**被拒候选（默认每层每周 5%，有上限）；
 *   2. 为样本排 T+30/60/90 三次低成本回访；
 *   3. 回访时判断“当初被拒、现在市场是否已形成”，并输出**加权** FNR。
 *
 * 为什么不按总体随机 5%：不同拒绝原因的漏判机制完全不同——`M_BLOCKED`（WAF 拦了）
 * 与 `M_NO_PRICING`（看到了确实没价格）不是同一件事。总体随机抽样会让早期样本
 * 全部落在某一种原因上，算出来的“漏判率”只代表那一层。
 */
export const SHADOW_RULE_VERSION = 'shadow-v1';
export const SHADOW_SAMPLE_RATE = 0.05;
export const SHADOW_MAX_PER_STRATUM_PER_RUN = 25;
export const SHADOW_HORIZONS = [30, 60, 90] as const;

/** 参与抽样的拒绝原因；`DATA_*` 是数据不足，不是市场判断，不抽样。 */
export const SHADOW_STRATA = [
  'D_INSUFFICIENT',
  'D_HISTORY_BELOW_BASELINE',
  'W_SERP_HISTORY_BELOW_BASELINE',
  'W_NO_RECENT_SERP',
  'W_UNSTABLE',
  'M_INSUFFICIENT',
  'M_NO_PRICING',
  'M_INFRA_ONLY',
  'M_BLOCKED_WAF',
  'M_TIMEOUT',
  'M_PARSE_EMPTY',
  'CONFIDENCE_LOW',
] as const;

export type ShadowStratum = (typeof SHADOW_STRATA)[number];

export interface SampleResult {
  stratum: string;
  sampled: number;
}

export interface ShadowPoolRunResult {
  sampled: number;
  checkpointsScheduled: number;
  byStratum: SampleResult[];
}

/**
 * 抽样。用 `rejection_id` 派生一个**确定性**随机序（`md5(id)`），因此：
 *   - 同一天重跑得到同一批样本（幂等）；
 *   - 不需要保存随机状态，权重可复算。
 */
export async function sampleShadowPool(sampledOn: string): Promise<ShadowPoolRunResult> {
  // 一次运行 = 一天。重跑同一天必须是**空操作**：如果只按 opportunity 去重，
  // 第二次会从每层再抽一条（层内比例四舍五入后仍有 1 条额度），样本量悄悄翻倍，
  // 加权漏判率也随之失真。
  const already = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM shadow_pool_samples WHERE sampled_on = $1::date`,
    [sampledOn]
  );
  if ((already.rows[0]?.count ?? 0) > 0) {
    return { sampled: 0, checkpointsScheduled: 0, byStratum: [] };
  }

  const byStratum: SampleResult[] = [];
  let sampled = 0;
  let checkpointsScheduled = 0;

  for (const stratum of SHADOW_STRATA) {
    const candidates = await query<{ id: string; opportunity_id: string; axis: string }>(
      `SELECT r.id::text, r.opportunity_id, r.axis
         FROM opportunity_rejections r
         JOIN opportunities o ON o.id = r.opportunity_id
        WHERE r.reason_code = $1
          AND r.obs_date <= $2::date
          AND o.status <> 'ARCHIVED'
          AND NOT EXISTS (
            SELECT 1 FROM shadow_pool_samples s WHERE s.opportunity_id = r.opportunity_id
          )
        ORDER BY md5(r.id::text)
        LIMIT $3`,
      [stratum, sampledOn, Math.ceil(SHADOW_MAX_PER_STRATUM_PER_RUN / Math.max(SHADOW_SAMPLE_RATE, 0.01))]
    );

    const take = Math.min(
      candidates.rows.length,
      SHADOW_MAX_PER_STRATUM_PER_RUN,
      Math.max(1, Math.round(candidates.rows.length * SHADOW_SAMPLE_RATE))
    );
    if (candidates.rows.length === 0) {
      byStratum.push({ stratum, sampled: 0 });
      continue;
    }
    const selected = candidates.rows.slice(0, take);
    const weight = Math.round((1 / SHADOW_SAMPLE_RATE) * 10000) / 10000;

    for (const row of selected) {
      const inserted = await transaction(async (client) => {
        const res = await client.query<{ id: string }>(
          `INSERT INTO shadow_pool_samples
             (opportunity_id, rejection_id, stratum, axis, reason_code, sampled_on,
              sampling_weight, sampling_rule_version)
           VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8)
           ON CONFLICT (opportunity_id, sampled_on) DO NOTHING
           RETURNING id::text`,
          [
            row.opportunity_id,
            row.id,
            stratum,
            row.axis,
            stratum,
            sampledOn,
            weight,
            SHADOW_RULE_VERSION,
          ]
        );
        return res.rows[0]?.id ?? null;
      });
      if (!inserted) continue;
      sampled++;

      for (const horizon of SHADOW_HORIZONS) {
        const res = await query(
          `INSERT INTO shadow_checkpoints (sample_id, horizon_days, due_date)
           VALUES ($1, $2, $3::date + $2::int)
           ON CONFLICT (sample_id, horizon_days) DO NOTHING`,
          [inserted, horizon, sampledOn]
        );
        checkpointsScheduled += res.rowCount ?? 0;
      }
    }

    byStratum.push({ stratum, sampled: selected.length });
  }

  return { sampled, checkpointsScheduled, byStratum };
}

export interface PendingCheckpoint {
  checkpointId: string;
  sampleId: string;
  opportunityId: string;
  horizonDays: number;
}

export async function pendingCheckpoints(obsDate: string, limit = 20): Promise<PendingCheckpoint[]> {
  const res = await query<{
    id: string;
    sample_id: string;
    opportunity_id: string;
    horizon_days: number;
  }>(
    `SELECT c.id::text, c.sample_id::text, s.opportunity_id, c.horizon_days
       FROM shadow_checkpoints c
       JOIN shadow_pool_samples s ON s.id = c.sample_id
      WHERE c.captured_at IS NULL
        AND c.due_date <= $1::date
        AND s.status = 'ACTIVE'
      ORDER BY c.due_date
      LIMIT $2`,
    [obsDate, limit]
  );
  return res.rows.map((row) => ({
    checkpointId: row.id,
    sampleId: row.sample_id,
    opportunityId: row.opportunity_id,
    horizonDays: row.horizon_days,
  }));
}

/**
 * 判断回访结果：当初被拒的词，现在市场是否已经形成。
 *
 * 判据刻意保守——只看**可观测事实**：
 *   - 出现新的独立域名且已解析出公开付费档位（PAID_TIER_OBSERVED）；
 *   - 或原本 M_INSUFFICIENT 的机会现在有了非 INSUFFICIENT 的 M 档。
 * 不把“有人讨论”当市场形成。
 */
export async function evaluateShadowOutcome(opportunityId: string): Promise<{
  outcome: 'CANDIDATE_BECAME_OPPORTUNITY' | 'STILL_REJECTED' | 'INSUFFICIENT_DATA';
  evidence: Record<string, unknown>;
}> {
  const cardRes = await query<{ m_band: string | null; verdict: string | null }>(
    `SELECT c.m_band, c.verdict FROM opportunity_cards c WHERE c.opportunity_id = $1`,
    [opportunityId]
  );
  const card = cardRes.rows[0];

  const pricedRes = await query<{ domains: number }>(
    `SELECT COUNT(DISTINCT domain)::int AS domains FROM evidence
      WHERE opportunity_id = $1
        AND source_type = 'PAID_TIER_OBSERVED'
        AND domain IS NOT NULL`,
    [opportunityId]
  );
  const pricedDomains = pricedRes.rows[0]?.domains ?? 0;

  const evidence = { mBand: card?.m_band ?? null, verdict: card?.verdict ?? null, pricedDomains };
  if (!card) return { outcome: 'INSUFFICIENT_DATA', evidence };
  if (pricedDomains >= 2 && card.m_band && card.m_band !== 'INSUFFICIENT') {
    return { outcome: 'CANDIDATE_BECAME_OPPORTUNITY', evidence };
  }
  if (card.verdict === 'BUILD_NOW' || card.verdict === 'EARLY_BET') {
    return { outcome: 'CANDIDATE_BECAME_OPPORTUNITY', evidence };
  }
  return { outcome: 'STILL_REJECTED', evidence };
}

export async function captureCheckpoint(
  checkpointId: string,
  outcome: 'CANDIDATE_BECAME_OPPORTUNITY' | 'STILL_REJECTED' | 'INSUFFICIENT_DATA',
  evidence: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE shadow_checkpoints
        SET captured_at = NOW(), outcome = $2, evidence = $3
      WHERE id = $1 AND captured_at IS NULL`,
    [checkpointId, outcome, JSON.stringify(evidence)]
  );
}

export interface ShadowStratumStats {
  stratum: string;
  samples: number;
  checkpoints: number;
  captured: number;
  becameOpportunity: number;
  /** 加权漏判率估计；样本不足或未回访时为 null，不猜。 */
  weightedFnr: number | null;
}

/**
 * 按层输出漏判统计。加权后才是总体估计：
 * 每层权重是该层的 1/抽样率，因此层内比例 × 权重求和 / 权重求和。
 */
export async function shadowPoolStats(): Promise<ShadowStratumStats[]> {
  const res = await query<{
    stratum: string;
    samples: number;
    checkpoints: number;
    captured: number;
    became: number;
    weight_sum: number;
    became_weight: number;
  }>(
    `SELECT s.stratum,
            COUNT(DISTINCT s.id)::int AS samples,
            COUNT(c.id)::int AS checkpoints,
            COUNT(c.id) FILTER (WHERE c.captured_at IS NOT NULL)::int AS captured,
            COUNT(c.id) FILTER (WHERE c.outcome = 'CANDIDATE_BECAME_OPPORTUNITY')::int AS became,
            COALESCE(SUM(DISTINCT s.sampling_weight), 0)::float8 AS weight_sum,
            COALESCE(SUM(s.sampling_weight) FILTER (WHERE c.outcome = 'CANDIDATE_BECAME_OPPORTUNITY'), 0)::float8 AS became_weight
       FROM shadow_pool_samples s
       LEFT JOIN shadow_checkpoints c ON c.sample_id = s.id
      GROUP BY s.stratum
      ORDER BY s.stratum`
  );

  return res.rows.map((row) => {
    const denominator = row.captured;
    return {
      stratum: row.stratum,
      samples: row.samples,
      checkpoints: row.checkpoints,
      captured: row.captured,
      becameOpportunity: row.became,
      // 样本为 0 时返回 null：宁可显示“未知”，也不把 0/0 渲染成 0% 漏判。
      weightedFnr: denominator > 0 ? Math.round((row.became / denominator) * 10000) / 10000 : null,
    };
  });
}
