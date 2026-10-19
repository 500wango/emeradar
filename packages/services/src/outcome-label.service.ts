import { query } from '@emeradar/db';

/**
 * 分层标签（Phase 3）。
 *
 * **这不是 ground truth。** 我们没有“用户做了这个产品赚了多少钱”的标签，只能用
 * 市场演进结果做代理，而代理至少有三处偏差：
 *
 *   1. 供给进入可能是因为品类自然升温，与我们的判定无关；
 *   2. 我们自己发布了 BUILD_NOW，别人跟进，这些新进入者被我们影响过（treatment leakage）；
 *   3. T+90 还活着的站本身就更强，用它反推“当初判对了”会高估（存活偏差）。
 *
 * 所以标签必须分层：`MARKET_FORMED_PROXY` 用于大规模预筛，`MANUAL_AUDIT` 才是
 * 回测的金标准，`NO_LABEL` 明确区别于“负样本”——被 WAF 拦住不等于没市场。
 */
export const LABEL_RULE_VERSION = 'label-v1';

export type LabelType = 'MARKET_FORMED_PROXY' | 'MANUAL_AUDIT' | 'NO_LABEL';
export type LabelValue = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';

export interface OutcomeLabelRow {
  opportunityId: string;
  horizonDays: number;
  labelType: LabelType;
  label: LabelValue;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: Record<string, unknown>;
}

export async function upsertLabel(row: OutcomeLabelRow): Promise<void> {
  await query(
    `INSERT INTO outcome_labels
       (opportunity_id, horizon_days, label_type, label, confidence, evidence, label_rule_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (opportunity_id, horizon_days, label_type) DO UPDATE SET
       label = EXCLUDED.label,
       confidence = EXCLUDED.confidence,
       evidence = EXCLUDED.evidence,
       label_rule_version = EXCLUDED.label_rule_version`,
    [
      row.opportunityId,
      row.horizonDays,
      row.labelType,
      row.label,
      row.confidence,
      JSON.stringify(row.evidence),
      LABEL_RULE_VERSION,
    ]
  );
}

/**
 * 自动代理标签。
 *
 * POSITIVE 需要同时满足**需求持续**与**供给进入**：
 *   - T+h 时主词仍在 Autocomplete 观测里（不是脉冲式归零）；
 *   - 且出现至少 2 个 PAID_TIER_OBSERVED 独立域名，或裁决已升到 BUILD_NOW/EARLY_BET。
 *
 * 任一条件不成立就是 NEGATIVE；数据缺失（没有观测日）是 NO_LABEL，不是负样本。
 */
export async function deriveProxyLabel(
  opportunityId: string,
  horizonDays: 30 | 60 | 90,
  obsDate: string
): Promise<OutcomeLabelRow> {
  const res = await query<{
    recent_days: number;
    priced_domains: number;
    verdict: string | null;
  }>(
    `SELECT
       COALESCE((SELECT COUNT(DISTINCT ao.observed_date)
                   FROM autocomplete_observations ao
                   JOIN opportunity_queries oq ON oq.query_id = ao.query_id AND oq.role = 'PRIMARY'
                  WHERE oq.opportunity_id = $1
                    AND ao.observed_date > $2::date - 7
                    AND ao.observed_date <= $2::date), 0)::int AS recent_days,
       COALESCE((SELECT COUNT(DISTINCT e.domain) FROM evidence e
                  WHERE e.opportunity_id = $1
                    AND e.source_type = 'PAID_TIER_OBSERVED'
                    AND e.domain IS NOT NULL), 0)::int AS priced_domains,
       (SELECT c.verdict FROM opportunity_cards c WHERE c.opportunity_id = $1) AS verdict`,
    [opportunityId, obsDate]
  );
  const row = res.rows[0];

  const evidence = {
    recentAutocompleteDays: row?.recent_days ?? 0,
    pricedDomains: row?.priced_domains ?? 0,
    verdict: row?.verdict ?? null,
    horizonDays,
    observedOn: obsDate,
  };

  // 完全没有需求侧观测 → 不是“负样本”，而是“没有数据”。
  if ((row?.recent_days ?? 0) === 0 && (row?.priced_domains ?? 0) === 0) {
    return {
      opportunityId,
      horizonDays,
      labelType: 'NO_LABEL',
      label: 'UNKNOWN',
      confidence: 'LOW',
      evidence,
    };
  }

  const demandPersists = (row?.recent_days ?? 0) >= 3;
  const supplyEntered =
    (row?.priced_domains ?? 0) >= 2 ||
    row?.verdict === 'BUILD_NOW' ||
    row?.verdict === 'EARLY_BET';

  return {
    opportunityId,
    horizonDays,
    labelType: 'MARKET_FORMED_PROXY',
    label: demandPersists && supplyEntered ? 'POSITIVE' : 'NEGATIVE',
    // 代理标签永远不是 HIGH：它不知道有没有人真的付费。
    confidence: 'MEDIUM',
    evidence: { ...evidence, demandPersists, supplyEntered },
  };
}

export interface LabelDatasetRow {
  opportunityId: string;
  horizonDays: number;
  label: LabelValue;
  labelType: LabelType;
  obsDate: string;
  /** T+0 的截面特征（来自 opportunity_snapshots.metrics）。 */
  features: Record<string, unknown>;
}

/**
 * 导出回测数据集：**只读**标签与当时封存的特征快照。
 *
 * `onlyManualAudit` 默认为 false（先做大规模预筛）；真正的金标准回测应传 true。
 */
export async function labelDataset(options: {
  horizonDays: 30 | 60 | 90;
  onlyManualAudit?: boolean;
  limit?: number;
}): Promise<LabelDatasetRow[]> {
  const res = await query<{
    opportunity_id: string;
    horizon_days: number;
    label: LabelValue;
    label_type: LabelType;
    obs_date: string;
    metrics: Record<string, unknown> | null;
  }>(
    `SELECT l.opportunity_id, l.horizon_days, l.label, l.label_type,
            s.obs_date::text AS obs_date, s.metrics
       FROM outcome_labels l
       LEFT JOIN opportunity_snapshots s
         ON s.opportunity_id = l.opportunity_id
      WHERE l.horizon_days = $1
        AND l.label <> 'UNKNOWN'
        AND ($2::boolean IS NOT TRUE OR l.label_type = 'MANUAL_AUDIT')
      ORDER BY s.obs_date ASC NULLS LAST
      LIMIT $3`,
    [options.horizonDays, options.onlyManualAudit ?? false, options.limit ?? 5000]
  );

  return res.rows.map((row) => ({
    opportunityId: row.opportunity_id,
    horizonDays: row.horizon_days,
    label: row.label,
    labelType: row.label_type,
    obsDate: row.obs_date,
    features: row.metrics ?? {},
  }));
}
