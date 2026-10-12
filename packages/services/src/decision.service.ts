import { createHash } from 'node:crypto';
import { query } from '@emeradar/db';
import { canonicalizeJson } from '@emeradar/ledger';
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

export type DecisionKind = 'GO' | 'PASS';

export interface RecordDecisionInput {
  opportunityId: string;
  /** The exact verdict row the user was looking at. Required. */
  verdictId: string;
  decision: DecisionKind;
  reasons?: string[];
}

export interface RecordedDecision {
  id: string;
  verdictId: string;
}

/**
 * Content fingerprint of a decision row.
 *
 * It covers *what* was recorded, not *when* relative to other decisions — there
 * is deliberately no `prev_hash` chain here, because decisions are concurrent
 * acts by different users with no natural global order. Paired with the
 * append-only trigger in schema.sql, this makes a decision's justification
 * verifiable after the fact: rewrite the row and the fingerprint stops matching.
 *
 * `verdictRowHash` is included on purpose. It is the fingerprint of the cited
 * verdict's *content*, so a decision is bound to the reasoning the user actually
 * read rather than merely to a row id that could later be re-pointed.
 */
export function calculateDecisionRowHash(row: {
  id: string;
  opportunityId: string;
  userId: string;
  decision: string;
  verdictId: string;
  verdictRowHash: string | null;
  reasons: string[];
  channel: string;
}): string {
  const hash = createHash('sha256');
  hash.update(
    canonicalizeJson({
      id: row.id,
      opportunityId: row.opportunityId,
      userId: row.userId,
      decision: row.decision,
      verdictId: row.verdictId,
      verdictRowHash: row.verdictRowHash,
      // Reasons keep their recorded order: the array as stored is the array
      // that gets hashed, so a verifier can recompute from the row itself.
      reasons: row.reasons,
      channel: row.channel,
    }),
    'utf8'
  );
  return hash.digest('hex');
}

export class DecisionService {
  /**
   * Record the user's GO or PASS, bound to the verdict they were shown.
   *
   * `verdictId` comes from the caller. It is verified to belong to this
   * opportunity, but it is deliberately *not* required to be the newest verdict:
   * pinning the row the user actually read is the whole point, and refusing a
   * slightly older verdict would push the caller back into guessing.
   */
  static async record(userId: string, input: RecordDecisionInput): Promise<RecordedDecision> {
    const reasons = input.decision === 'PASS' ? cleanPassReasons(input.reasons ?? []) : [];
    if (input.decision === 'PASS' && reasons.length === 0) {
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
      [input.opportunityId]
    );
    if (opportunityRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Published opportunity not found: ${input.opportunityId}`,
        404
      );
    }

    const verdictRes = await query<{ id: string; row_hash: string | null }>(
      `SELECT id, row_hash FROM verdicts WHERE id = $1 AND opportunity_id = $2`,
      [input.verdictId, input.opportunityId]
    );
    const verdict = verdictRes.rows[0];
    if (!verdict) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'The cited verdict does not belong to this opportunity. Reload the page — the verdict you were shown is no longer current.',
        409
      );
    }

    const id = `dcs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const channel = 'WEB';

    /**
     * GO is idempotent per (user, opportunity, verdict).
     *
     * A GO is a commitment, so re-committing to the same verdict is the same act
     * rather than a new one — and the client makes two calls (decision, then
     * project), so a failure between them would otherwise leave a stray GO
     * behind on every retry. PASS is deliberately *not* deduplicated: reasons
     * are a judgement that can legitimately change.
     */
    if (input.decision === 'GO') {
      const existingRes = await query<{ id: string; verdict_id: string }>(
        `SELECT id, verdict_id FROM decisions
         WHERE user_id = $1 AND opportunity_id = $2 AND verdict_id = $3 AND decision = 'GO'
         LIMIT 1`,
        [userId, input.opportunityId, verdict.id]
      );
      const existing = existingRes.rows[0];
      if (existing) return { id: existing.id, verdictId: existing.verdict_id };
    }

    const rowHash = calculateDecisionRowHash({
      id,
      opportunityId: input.opportunityId,
      userId,
      decision: input.decision,
      verdictId: verdict.id,
      verdictRowHash: verdict.row_hash,
      reasons,
      channel,
    });

    await query(
      `INSERT INTO decisions (
         id, opportunity_id, user_id, decision, verdict_id, verdict_row_hash,
         reasons, channel, row_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        input.opportunityId,
        userId,
        input.decision,
        verdict.id,
        verdict.row_hash,
        reasons,
        channel,
        rowHash,
      ]
    );

    return { id, verdictId: verdict.id };
  }
}

function cleanPassReasons(reasons: string[]): string[] {
  return reasons.filter((reason) => (PASS_REASONS as readonly string[]).includes(reason));
}
