import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';

export const PASS_REASONS = [
  'DEMAND_TOO_THIN',
  'WINDOW_ALREADY_CLOSED',
  'NO_COMMERCIAL_PROOF',
  'OUTSIDE_TIME_BUDGET',
  'NOT_MY_SKILL',
  'OTHER',
] as const;

export type PassReason = (typeof PASS_REASONS)[number];

export class DecisionService {
  /**
   * Record a PASS against the latest sealed verdict. A reason is required.
   */
  static async pass(
    userId: string,
    opportunityId: string,
    reasons: string[]
  ): Promise<{ id: string; verdictId: string }> {
    const cleaned = reasons.filter((reason) =>
      (PASS_REASONS as readonly string[]).includes(reason)
    );
    if (cleaned.length === 0) {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        'Choose at least one reason to pass on this opportunity.',
        400
      );
    }

    const opportunityRes = await query<{ id: string }>(
      `SELECT o.id
       FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE o.id = $1 AND o.status = 'TRACKED'`,
      [opportunityId]
    );
    if (opportunityRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Published opportunity not found: ${opportunityId}`,
        404
      );
    }

    const verdictRes = await query<{ id: string }>(
      `SELECT id FROM verdicts WHERE opportunity_id = $1 ORDER BY obs_date DESC LIMIT 1`,
      [opportunityId]
    );
    const verdictId = verdictRes.rows[0]?.id;
    if (!verdictId) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'This opportunity has no sealed verdict to pass on.',
        409
      );
    }

    const decisionId = `dcs_${Date.now()}`;
    await query(
      `INSERT INTO decisions (id, opportunity_id, user_id, decision, verdict_id, reasons, channel)
       VALUES ($1, $2, $3, 'PASS', $4, $5, 'WEB')`,
      [decisionId, opportunityId, userId, verdictId, cleaned]
    );

    return { id: decisionId, verdictId };
  }
}
