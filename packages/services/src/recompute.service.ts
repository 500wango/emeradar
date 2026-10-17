import { query } from '@emeradar/db';
import { calculateOpportunityScore, FullOpportunityScoreInput } from '@emeradar/scoring';
import { EmeradarError, ErrorCode } from '@emeradar/core';

export interface RecomputeDiff {
  field: string;
  ledger: unknown;
  recomputed: unknown;
}

export interface RecomputeResult {
  opportunityId: string;
  obsDate: string;
  /** 与账本逐字段一致。 */
  matches: boolean;
  diffs: RecomputeDiff[];
}

/**
 * 05 §8 `recompute`：用当日封存的完整评分输入重新调用同一个纯函数，与账本行逐字段比对。
 *
 * 只比对账本里确实存了的字段（裁决、原始裁决、生命周期、三轴基点与档位、置信度）。
 * 输入由 `opportunity_snapshots.scoring_input` 提供；没有它的快照（本能力上线前的存量）
 * 抛 PRECONDITION_FAILED，而不是用残缺输入算出一个伪差异。
 */
export class RecomputeService {
  static async recompute(opportunityId: string, obsDate: string): Promise<RecomputeResult> {
    const snap = await query<{ scoring_input: FullOpportunityScoreInput | null }>(
      `SELECT scoring_input FROM opportunity_snapshots WHERE opportunity_id = $1 AND obs_date = $2::date`,
      [opportunityId, obsDate]
    );
    const input = snap.rows[0]?.scoring_input;
    if (!input) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        `No sealed scoring input for ${opportunityId} on ${obsDate}; it predates input sealing and cannot be recomputed.`,
        409
      );
    }

    const ledger = await query<any>(
      `SELECT verdict, raw_verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
              d_band, m_band, w_band, confidence
         FROM verdicts WHERE opportunity_id = $1 AND obs_date = $2::date
         ORDER BY created_at DESC LIMIT 1`,
      [opportunityId, obsDate]
    );
    const row = ledger.rows[0];
    if (!row) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `No ledger row for ${opportunityId} on ${obsDate}.`, 404);
    }

    const out = calculateOpportunityScore(input);
    const pairs: Array<[string, unknown, unknown]> = [
      ['verdict', row.verdict, out.verdict],
      ['raw_verdict', row.raw_verdict, out.rawVerdict],
      ['lifecycle', row.lifecycle, out.lifecycle],
      ['d_basis_points', row.d_basis_points, out.dScore],
      ['m_basis_points', row.m_basis_points, out.mScore],
      ['w_basis_points', row.w_basis_points, out.wScore],
      ['d_band', row.d_band, out.dBand],
      ['m_band', row.m_band, out.mBand],
      ['w_band', row.w_band, out.wBand],
      ['confidence', row.confidence, out.confidence],
    ];
    const diffs = pairs
      .filter(([, a, b]) => a !== b)
      .map(([field, a, b]) => ({ field, ledger: a, recomputed: b }));
    return { opportunityId, obsDate, matches: diffs.length === 0, diffs };
  }

  /**
   * 05 §8：随机抽取历史 Verdict 重算并比对。按 `md5(id || 观测日)` 的哈希取模抽样，而不是
   * `random()`：同一天重跑抽到同一批，事后能复现「当晚到底查了哪几条」。
   * 只抽有封存输入的行（没有输入的存量不是不一致，是无法评估）。
   */
  static async sample(
    asOf: string,
    options: { percent?: number; limit?: number } = {}
  ): Promise<{ sampled: number; mismatches: RecomputeResult[] }> {
    const percent = options.percent ?? 1;
    const limit = options.limit ?? 200;
    const rows = await query<{ opportunity_id: string; obs_date: string }>(
      `SELECT v.opportunity_id, to_char(v.obs_date, 'YYYY-MM-DD') AS obs_date
         FROM verdicts v
         JOIN opportunity_snapshots s ON s.opportunity_id = v.opportunity_id AND s.obs_date = v.obs_date
        WHERE v.hash_version >= 2 AND s.scoring_input IS NOT NULL AND v.obs_date < $1::date
          AND (('x' || substr(md5(v.id || $1::text), 1, 8))::bit(32)::int & 2147483647) % 100 < $2
        ORDER BY v.obs_date DESC
        LIMIT $3`,
      [asOf, percent, limit]
    );
    const mismatches: RecomputeResult[] = [];
    for (const row of rows.rows) {
      const result = await RecomputeService.recompute(row.opportunity_id, row.obs_date);
      if (!result.matches) mismatches.push(result);
    }
    return { sampled: rows.rows.length, mismatches };
  }
}
