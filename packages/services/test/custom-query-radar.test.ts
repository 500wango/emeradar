import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 自定义词 7 天脉冲雷达（PRD F3 第 2 阶段、12 §2）。
 *
 * 即时初筛产出的 CANDIDATE 可以入雷达；雷达在 7 天内盯住它，一旦裁决晋升
 * BUILD_NOW 就推一条站内通知并落 CONFIRMED。Free 没有 `pulse_radar` 权益。
 */
const harness = makeDisposableDb('emeradar_custom_query_radar_test');

const PRO = 'usr_radar_pro';
const FREE = 'usr_radar_free';
const OPP = 'opp_radar_candidate';
const OPP_ACTIONABLE = 'opp_radar_actionable';
const OPP_EXPIRING = 'opp_radar_expiring';

async function seedOpportunity(id: string, verdict: string, status = 'CANDIDATE') {
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $2, $3, CURRENT_DATE)`,
    [id, id.replace(/_/g, '-'), status]
  );
  await query(
    `INSERT INTO opportunity_cards (
       opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
       confidence, recommended_archetype, execution_class, why_now_summary,
       top_idea, first_observed_at
     ) VALUES ($1, $2, $3, $4, 'FORMING',
       5000, 5000, 5000, 'MEDIUM', 'MEDIUM', 'MEDIUM',
       'MEDIUM', 'TOOL', 'S', 'radar fixture', 'radar fixture', NOW())`,
    [id, id.replace(/_/g, '-'), `${id} query`, verdict]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(`INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $1 || '@test', $1, 'USER', 'PRO')`, [PRO]);
  await query(
    `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start, current_period_end)
     VALUES ('sub_radar_pro', $1, 'PRO', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days')`,
    [PRO]
  );
  await query(`INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $1 || '@test', $1, 'USER', 'FREE')`, [FREE]);
  await seedOpportunity(OPP, 'WATCH');
  await seedOpportunity(OPP_ACTIONABLE, 'BUILD_NOW', 'TRACKED');
  await seedOpportunity(OPP_EXPIRING, 'WATCH');
});

after(async () => {
  await harness.teardown();
});

describe('自定义词 7 天雷达', () => {
  it('Pro 可以把候选词入雷达；重复入雷达是幂等的', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { CustomQueryRadarService } = harness.services;

    const first = await CustomQueryRadarService.enroll(PRO, OPP);
    assert.strictEqual(first.status, 'ACTIVE');
    const days = (new Date(first.expiresAt).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 6.5 && days < 7.5, `雷达窗口应为 7 天，实际 ${days.toFixed(1)}`);

    const again = await CustomQueryRadarService.enroll(PRO, OPP);
    assert.strictEqual(again.id, first.id, '重复入雷达建了第二条');
    assert.strictEqual((await CustomQueryRadarService.list(PRO)).length, 1);
  });

  it('已经可行动的机会不需要雷达；Free 没有雷达权益', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { CustomQueryRadarService } = harness.services;

    await assert.rejects(
      () => CustomQueryRadarService.enroll(PRO, OPP_ACTIONABLE),
      (error: any) => error?.code === 'PRECONDITION_FAILED'
    );
    await assert.rejects(
      () => CustomQueryRadarService.enroll(FREE, OPP),
      (error: any) => error?.code === 'PLAN_REQUIRED'
    );
  });

  it('晋升 BUILD_NOW 时推送并确认，重复调用不重复推', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { CustomQueryRadarService } = harness.services;

    await harness.db.query(`UPDATE opportunity_cards SET verdict = 'BUILD_NOW' WHERE opportunity_id = $1`, [OPP]);
    await harness.db.query(`UPDATE opportunities SET status = 'TRACKED' WHERE id = $1`, [OPP]);

    const first = await CustomQueryRadarService.confirmDue('2026-10-18');
    assert.strictEqual(first.confirmed, 1);
    const notifications = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND title LIKE 'Custom query pulse confirmed:%'`,
      [PRO]
    );
    assert.strictEqual(notifications.rows[0].count, 1);

    const radar = (await CustomQueryRadarService.list(PRO)).find((r) => r.opportunityId === OPP);
    assert.strictEqual(radar?.status, 'CONFIRMED');

    const second = await CustomQueryRadarService.confirmDue('2026-10-19');
    assert.strictEqual(second.confirmed, 0, '已确认的雷达又被推了一次');
  });

  it('过期的雷达被清扫为 EXPIRED', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { CustomQueryRadarService } = harness.services;

    await CustomQueryRadarService.enroll(PRO, OPP_EXPIRING);
    await harness.db.query(
      `UPDATE custom_query_radars SET expires_at = NOW() - INTERVAL '1 hour' WHERE opportunity_id = $1`,
      [OPP_EXPIRING]
    );

    const result = await CustomQueryRadarService.confirmDue('2026-10-18');
    assert.ok(result.expired >= 1);
    const radar = (await CustomQueryRadarService.list(PRO)).find((r) => r.opportunityId === OPP_EXPIRING);
    assert.strictEqual(radar?.status, 'EXPIRED');
  });
});
