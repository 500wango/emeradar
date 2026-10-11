import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '@emeradar/db';
import { AdminService } from '../src';

describe('Admin Candidate Promotion & Moderation Tests', () => {
  const testCandidateId = `opp_test_cand_${Date.now()}`;
  const testSlug = `test-niche-pipeline-${Date.now()}`;
  const testTitle = 'Test Automated Pipeline Niche';

  it('creates an unverified candidate with INSUFFICIENT scores', async () => {
    await query(
      `INSERT INTO opportunities (
         id, slug, title, status, market_country, research_language,
         first_observed_date, recommended_archetype, execution_class,
         discovery_source, discovered_at, candidate_reason
       ) VALUES ($1, $2, $3, 'CANDIDATE', 'US', 'en-US', CURRENT_DATE, 'LIGHTWEIGHT_TOOL', 'S',
                 'AUTOCOMPLETE', NOW(), 'Initial test signal')`,
      [testCandidateId, testSlug, testTitle]
    );

    await query(
      `INSERT INTO opportunity_cards (
         opportunity_id, slug, primary_query, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points,
         d_band, m_band, w_band, confidence,
         recommended_archetype, execution_class, why_now_summary, top_idea,
         first_observed_at, query_velocity
       ) VALUES ($1, $2, $3, 'WATCH', 'FORMING', 0, 0, 0,
                 'INSUFFICIENT', 'INSUFFICIENT', 'INSUFFICIENT', 'LOW',
                 'LIGHTWEIGHT_TOOL', 'S', 'Pending observation', 'No shape yet',
                 NOW(), 0)`,
      [testCandidateId, testSlug, testTitle]
    );

    const check = await query<any>(
      `SELECT d_band, m_band, w_band, verdict FROM opportunity_cards WHERE opportunity_id = $1`,
      [testCandidateId]
    );
    assert.equal(check.rows[0].d_band, 'INSUFFICIENT');
    assert.equal(check.rows[0].m_band, 'INSUFFICIENT');
    assert.equal(check.rows[0].w_band, 'INSUFFICIENT');
    assert.equal(check.rows[0].verdict, 'WATCH');
  });

  it('does not promote a candidate before real observations produce a publishable verdict', async () => {
    await assert.rejects(
      () => AdminService.moderateCandidate(testCandidateId, 'PROMOTE_TO_TRACKED'),
      (error: any) => error.code === 'VALIDATION_ERROR'
    );

    const status = await query<any>(`SELECT status FROM opportunities WHERE id = $1`, [testCandidateId]);
    assert.equal(status.rows[0].status, 'CANDIDATE');
    const evidence = await query<any>(`SELECT COUNT(*)::int AS count FROM evidence WHERE opportunity_id = $1`, [testCandidateId]);
    assert.equal(evidence.rows[0].count, 0);

    await query(`DELETE FROM opportunity_cards WHERE opportunity_id = $1`, [testCandidateId]);
    await query(`UPDATE opportunities SET status = 'ARCHIVED' WHERE id = $1`, [testCandidateId]);
  });
});
