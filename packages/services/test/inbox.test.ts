import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Opportunity Inbox：早期信号层，不能冒充已发布裁决。
 *
 * Free 3 条、付费 20 条；负面反馈后不再重复出现。
 */
const harness = makeDisposableDb('emeradar_inbox_test');
const USER = 'usr_inbox_test';

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(
    `INSERT INTO users (id, email, role, tier, status) VALUES ($1, 'inbox@test.local', 'USER', 'PRO', 'ACTIVE')`,
    [USER]
  );
  for (let i = 1; i <= 5; i++) {
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date, candidate_reason, discovery_source,
        market_country, research_language, recommended_archetype, execution_class)
       VALUES ($1, $2, $3, 'CANDIDATE', CURRENT_DATE - $4::int, $5, 'TEST', 'US', 'en',
        'TOOL', 'S')`,
      [`opp_inbox_${i}`, `inbox-${i}`, `Inbox Opp ${i}`, i, `candidate reason ${i}`]
    );
  }
});

after(async () => {
  await harness.teardown();
});

describe('Opportunity Inbox', () => {
  it('Free 只返回 3 条，付费返回全部候选', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const free = await harness.services.InboxService.list(USER, false);
    assert.strictEqual(free.items.length, 3);
    assert.strictEqual(free.freeQuota, 3);
    assert.strictEqual(free.isPaid, false);
    assert.ok(free.items.every((item) => item.stage === 'EARLY_SIGNAL'));

    const paid = await harness.services.InboxService.list(USER, true);
    assert.strictEqual(paid.items.length, 5);
    assert.strictEqual(paid.freeQuota, null);
    assert.strictEqual(paid.isPaid, true);
  });

  it('负面反馈的候选不再出现，正面反馈保留', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const before = await harness.services.InboxService.list(USER, true);
    const dismissed = before.items[0];
    const saved = before.items[1];

    await harness.services.InboxService.recordFeedback(USER, dismissed.opportunityId, 'NOT_OPPORTUNITY');
    await harness.services.InboxService.recordFeedback(USER, saved.opportunityId, 'SAVED');

    const after = await harness.services.InboxService.list(USER, true);
    assert.ok(!after.items.some((item) => item.opportunityId === dismissed.opportunityId));
    assert.ok(after.items.some((item) => item.opportunityId === saved.opportunityId));
    assert.strictEqual(after.total, 4);
  });
});
