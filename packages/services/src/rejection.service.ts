import { query } from '@emeradar/db';

/**
 * 拒绝分类（Phase 0）。
 *
 * `WATCH` 只说明“这一期没有发布”，不说明为什么。没有死因，就无法回答：
 *   - 哪条 Gate 过严？
 *   - 多少机会因为 M_BLOCKED（WAF）被错杀？
 *   - 被拒的词后来有没有变成机会？
 *
 * 所以每次不发布都写一条 rejection：轴 + 原因码 + 证据 + 规则版本。
 * 只追加，不覆盖：同一机会同一天同一原因只落一行（唯一约束），
 * 但不同原因各自留痕。
 */
export type RejectionAxis = 'D' | 'M' | 'W' | 'DATA' | 'PUBLICATION';

export type RejectionReasonCode =
  // DATA：数据不足，不是市场结论
  | 'DATA_BASELINE_PERIOD'
  | 'DATA_CRITICAL_SOURCE_FAILURE'
  // D 轴
  | 'D_INSUFFICIENT'
  | 'D_HISTORY_BELOW_BASELINE'
  // W 轴
  | 'W_INSUFFICIENT'
  | 'W_SERP_HISTORY_BELOW_BASELINE'
  | 'W_NO_RECENT_SERP'
  | 'W_UNSTABLE'
  // M 轴
  | 'M_INSUFFICIENT'
  | 'M_NO_PRICING'
  | 'M_INFRA_ONLY'
  | 'M_BLOCKED_WAF'
  | 'M_TIMEOUT'
  | 'M_PARSE_EMPTY'
  // 置信度
  | 'CONFIDENCE_LOW';

export interface RejectionInput {
  opportunityId: string;
  obsDate: string;
  axis: RejectionAxis;
  reasonCode: RejectionReasonCode;
  evidence?: Record<string, unknown>;
  ruleVersion?: string | null;
}

export async function recordRejections(rows: RejectionInput[]): Promise<number> {
  let written = 0;
  for (const row of rows) {
    const res = await query(
      `INSERT INTO opportunity_rejections
         (opportunity_id, obs_date, axis, reason_code, evidence, rule_version)
       VALUES ($1, $2::date, $3, $4, $5, $6)
       ON CONFLICT (opportunity_id, obs_date, axis, reason_code) DO NOTHING`,
      [
        row.opportunityId,
        row.obsDate,
        row.axis,
        row.reasonCode,
        JSON.stringify(row.evidence ?? {}),
        row.ruleVersion ?? null,
      ]
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

/** 按 05 §5.0 的 flags 推出拒绝原因；未知 flag 忽略，不猜。 */
export function rejectionsFromFlags(
  opportunityId: string,
  obsDate: string,
  flags: string[],
  ruleVersion: string,
  metrics: Record<string, unknown> = {}
): RejectionInput[] {
  const rows: RejectionInput[] = [];
  const push = (axis: RejectionAxis, reasonCode: RejectionReasonCode) => {
    rows.push({ opportunityId, obsDate, axis, reasonCode, evidence: metrics, ruleVersion });
  };

  for (const flag of flags) {
    switch (flag) {
      case 'BASELINE_PERIOD':
        push('DATA', 'DATA_BASELINE_PERIOD');
        break;
      case 'CRITICAL_SOURCE_FAILURE':
        push('DATA', 'DATA_CRITICAL_SOURCE_FAILURE');
        break;
      case 'D_INSUFFICIENT':
        push('D', 'D_INSUFFICIENT');
        break;
      case 'SERP_HISTORY_BELOW_BASELINE':
        push('W', 'W_SERP_HISTORY_BELOW_BASELINE');
        break;
      case 'NO_RECENT_ORGANIC_SERP':
        push('W', 'W_NO_RECENT_SERP');
        break;
      case 'M_INSUFFICIENT':
        push('M', 'M_INSUFFICIENT');
        break;
      case 'LOW_CONFIDENCE':
        push('PUBLICATION', 'CONFIDENCE_LOW');
        break;
      case 'W_DROPPING':
        push('W', 'W_UNSTABLE');
        break;
      default:
        break;
    }
  }
  return rows;
}

export interface RejectionSummary {
  reasonCode: string;
  axis: string;
  count: number;
}

export async function rejectionSummary(obsDate: string): Promise<RejectionSummary[]> {
  const res = await query<RejectionSummary>(
    `SELECT reason_code AS "reasonCode", axis, COUNT(*)::int AS count
       FROM opportunity_rejections
      WHERE obs_date = $1::date
      GROUP BY 1, 2
      ORDER BY count DESC`,
    [obsDate]
  );
  return res.rows;
}
