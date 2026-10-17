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
}
