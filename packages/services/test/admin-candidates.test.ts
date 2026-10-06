import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '@emeradar/db';
import { AdminService, OpportunityService, ReportService } from '../src';

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

  it('promotes candidate to TRACKED with calibrated non-zero scores, SERP evidence, and snapshots', async () => {
    const res = await AdminService.moderateCandidate(testCandidateId, 'PROMOTE_TO_TRACKED');
    assert.equal(res.success, true);
    assert.equal(res.newStatus, 'TRACKED');

    // 1. Verify card in database
    const cardRes = await query<any>(
      `SELECT * FROM opportunity_cards WHERE opportunity_id = $1`,
      [testCandidateId]
    );
    const card = cardRes.rows[0];
    assert.equal(card.verdict, 'BUILD_NOW');
    assert.equal(card.d_band, 'HIGH');
    assert.equal(card.m_band, 'MEDIUM');
    assert.equal(card.w_band, 'HIGH');
    assert.equal(card.confidence, 'HIGH');
    assert.ok(card.d_basis_points >= 7000);
    assert.ok(card.m_basis_points >= 6000);
    assert.ok(card.w_basis_points >= 7000);

    // 2. Verify SERP results
    const serpRes = await query<any>(
      `SELECT r.rank, r.domain, r.is_weak
       FROM serp_results r
       JOIN serp_snapshots s ON s.id = r.serp_snapshot_id
       JOIN opportunity_queries oq ON oq.query_id = s.query_id
       WHERE oq.opportunity_id = $1
       ORDER BY r.rank ASC`,
      [testCandidateId]
    );
    assert.ok(serpRes.rows.length >= 5);
    assert.ok(serpRes.rows.some((r) => r.is_weak));

    // 3. Verify detail service
    const detail = await OpportunityService.getOpportunityDetail(testSlug);
    assert.equal(detail.opportunity.status, 'TRACKED');
    assert.equal(detail.opportunity.verdict, 'BUILD_NOW');
    assert.equal(detail.opportunity.d_band, 'HIGH');
    assert.ok(detail.serpResults.length >= 5);
    assert.ok(detail.evidence.length >= 1);

    // 4. Verify report generation
    const report = await ReportService.getOrGenerateReport(testCandidateId, 'usr_demo_admin', 'zh-CN');
    assert.ok(report.reportId);
    assert.equal(report.data.metadata.verdict, 'BUILD_NOW');
    assert.equal(report.data.metadata.scores.dBasisPoints, card.d_basis_points);

    // Clean up test card to avoid leaking test records into feeds
    await query(`DELETE FROM opportunity_cards WHERE opportunity_id = $1`, [testCandidateId]);
    await query(`UPDATE opportunities SET status = 'ARCHIVED' WHERE id = $1`, [testCandidateId]);
  });
});
