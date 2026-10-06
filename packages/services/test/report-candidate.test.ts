import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { query, closePool } from '@emeradar/db';
import { ReportService } from '../src/report.service';
import { EmeradarError } from '@emeradar/core';

describe('Report Generation for Opportunities Across User Tiers', () => {
  const oppId = 'opp_test_rep_cand_01';
  const oppSlug = 'test-candidate-report-niche';
  const teamUserId = 'usr_test_team_rep';
  const freeUserId = 'usr_test_free_rep';

  before(async () => {
    // 1. Create a candidate opportunity with INSUFFICIENT / 0 scores
    await query(
      `INSERT INTO opportunities (
        id, slug, title, status, market_country, research_language,
        first_observed_date, recommended_archetype, execution_class,
        discovery_source, discovered_at, candidate_reason
      ) VALUES ($1, $2, $3, 'CANDIDATE', 'US', 'en-US', CURRENT_DATE, 'LIGHTWEIGHT_TOOL', 'S',
                'AUTOCOMPLETE', NOW(), 'Initial test signal')
      ON CONFLICT (id) DO UPDATE SET status = 'CANDIDATE'`,
      [oppId, oppSlug, 'Test Candidate Report Niche']
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
                 NOW(), 0)
       ON CONFLICT (opportunity_id) DO UPDATE SET d_band = 'INSUFFICIENT', confidence = 'LOW', verdict = 'WATCH'`,
      [oppId, oppSlug, 'candidate report test tool']
    );

    // 2. Create Team user & subscription
    await query(
      `INSERT INTO users (id, email, display_name, role, tier)
       VALUES ($1, $2, 'Test Team User', 'USER', 'TEAM')
       ON CONFLICT (id) DO UPDATE SET tier = 'TEAM'`,
      [teamUserId, 'test-team@emeradar.test']
    );
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, 'TEAM', 'ACTIVE', NOW() + INTERVAL '30 days')
       ON CONFLICT (id) DO UPDATE SET plan_code = 'TEAM', status = 'ACTIVE'`,
      [`sub_${teamUserId}`, teamUserId]
    );

    // 3. Create Free user & subscription
    await query(
      `INSERT INTO users (id, email, display_name, role, tier)
       VALUES ($1, $2, 'Test Free User', 'USER', 'FREE')
       ON CONFLICT (id) DO UPDATE SET tier = 'FREE'`,
      [freeUserId, 'test-free@emeradar.test']
    );
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, 'FREE', 'ACTIVE', NOW() + INTERVAL '30 days')
       ON CONFLICT (id) DO UPDATE SET plan_code = 'FREE', status = 'ACTIVE'`,
      [`sub_${freeUserId}`, freeUserId]
    );
  });

  after(async () => {
    await query('DELETE FROM opportunity_reports WHERE opportunity_id = $1', [oppId]);
    await query('DELETE FROM opportunity_cards WHERE opportunity_id = $1', [oppId]);
    await query('UPDATE opportunities SET status = \'ARCHIVED\' WHERE id = $1', [oppId]);
    await query('DELETE FROM users WHERE id IN ($1, $2)', [teamUserId, freeUserId]);
    await closePool();
  });

  it('rejects free user for unverified candidate opportunity with upgrade instructions', async () => {
    try {
      await ReportService.getOrGenerateReport(oppId, freeUserId, 'zh-CN');
      assert.fail('Should have thrown PRECONDITION_FAILED');
    } catch (err: any) {
      assert.strictEqual(err instanceof EmeradarError, true);
      assert.strictEqual(err.status, 409);
      assert.ok(err.message.includes('免费体验版'));
    }
  });

  it('allows Team user to generate and export full 6-chapter report for candidate opportunity', async () => {
    const result = await ReportService.getOrGenerateReport(oppId, teamUserId, 'zh-CN');

    assert.ok(result.reportId);
    assert.ok(result.data);
    assert.strictEqual(result.data.metadata.opportunityId, oppId);
    assert.ok(result.data.section1.decisionRecommendation);
    assert.ok(result.data.section2.primaryQuery);
    assert.ok(result.data.section3.top10Results.length >= 0);
    assert.ok(result.data.section5.archetype);
    assert.ok(result.markdown.includes('商业机会深度研究报告'));
  });
});
