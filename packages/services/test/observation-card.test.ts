import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 观测卡：扫码当天即可交付真实事实，但**永远不是裁决**。
 *
 * 两条不能模糊的线：
 *   - “没观测到”必须是 available=false / BLOCKED，不能渲染成“没有竞争/没有定价”；
 *   - verdictEta 说明裁决还缺多少天，避免用户把观测读成建议。
 */
const harness = makeDisposableDb('emeradar_observation_card_test');
const OPP = 'opp_obs_test';
const QRY = 'qry_obs_test';

async function seedStoredObservation() {
  const { query } = harness.db;
  await query(
    `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider, weakness_score)
     VALUES ('srp_obs_1', $1, CURRENT_DATE, 0.4, 10, 3, 'AISA_DATAFORSEO', 61.5)`,
    [QRY]
  );
  const rows: Array<[number, string, string, boolean]> = [
    [1, 'https://reddit.com/r/x', 'reddit.com', true],
    [2, 'https://smallpdf.example/pricing', 'smallpdf.example', false],
    [3, 'https://forum.example/thread', 'forum.example', true],
  ];
  for (const [rank, url, domain, weak] of rows) {
    await query(
      `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, snippet, result_type, domain_authority_class, is_weak)
       VALUES ('srp_obs_1',$1,$2,$3,'t','s','ORGANIC','SPECIALIST',$4)`,
      [rank, url, domain, weak]
    );
  }
  await query(
    `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth, provider)
     VALUES ($1, CURRENT_DATE, ARRAY['pdf unlock free','pdf unlock offline'], 1, 'AISA_DATAFORSEO')`,
    [QRY]
  );
  await query(
    `INSERT INTO commercial_targets (id, domain, target_url) VALUES ('cmt_obs_priced','smallpdf.example','https://smallpdf.example/pricing')`
  );
  await query(
    `INSERT INTO commercial_target_opportunities (commercial_target_id, opportunity_id) VALUES ('cmt_obs_priced',$1)`,
    [OPP]
  );
  await query(
    `INSERT INTO commercial_snapshots (commercial_target_id, obs_date, pricing_plans, payment_gateways, commercial_stage, fetch_status, fetch_tier)
     VALUES ('cmt_obs_priced', CURRENT_DATE, '[{"name":"Pro","currency":"$","priceMonthly":9}]'::jsonb,
             ARRAY['Stripe'], 'PRICED', 'OK', 'STATIC')`
  );
  await query(
    `INSERT INTO commercial_targets (id, domain, target_url) VALUES ('cmt_obs_blocked','waf.example','https://waf.example/pricing')`
  );
  await query(
    `INSERT INTO commercial_target_opportunities (commercial_target_id, opportunity_id) VALUES ('cmt_obs_blocked',$1)`,
    [OPP]
  );
  await query(
    `INSERT INTO commercial_snapshots (commercial_target_id, obs_date, pricing_plans, payment_gateways, commercial_stage, fetch_status, fetch_tier)
     VALUES ('cmt_obs_blocked', CURRENT_DATE, '[]'::jsonb, '{}', 'NONE', 'FAILED', 'STATIC')`
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date, market_country, research_language)
     VALUES ($1, 'obs-test', 'Obs Test', 'CANDIDATE', CURRENT_DATE, 'US', 'en-US')`,
    [OPP]
  );
  await query(
    `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
     VALUES ($1, 'unlock pdf', 'US', 'en-US', CURRENT_DATE, 'A')`,
    [QRY]
  );
  await query(
    `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`,
    [OPP, QRY]
  );
  await seedStoredObservation();
});

after(async () => {
  await harness.teardown();
});

describe('观测卡', () => {
  it('返回已存观测：联想词、Top10 弱点、定价三态', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const card = await harness.services.loadObservationCard(OPP, QRY, 'unlock pdf', 'US', 'en-US');
    assert.strictEqual(card.kind, 'OBSERVATION');
    assert.strictEqual(card.serp.available, true);
    assert.strictEqual(card.serp.items.length, 3);
    assert.strictEqual(card.serp.weakCount, 2);
    assert.strictEqual(card.serp.provider, 'AISA_DATAFORSEO');
    assert.strictEqual(card.autocomplete.suggestions.length, 2);

    const priced = card.pricing.domains.find((row) => row.domain === 'smallpdf.example');
    assert.strictEqual(priced?.status, 'OK');
    assert.strictEqual(priced?.plans.length, 1);

    // WAF/失败必须标成 BLOCKED，不能算成“没有定价”。
    const blocked = card.pricing.domains.find((row) => row.domain === 'waf.example');
    assert.strictEqual(blocked?.status, 'BLOCKED');
    assert.strictEqual(blocked?.plans.length, 0);
  });

  it('裁决说明仍然要求 14 天，观测不被当成建议', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const card = await harness.services.loadObservationCard(OPP, QRY, 'unlock pdf', 'US', 'en-US');
    assert.strictEqual(card.verdictEta.needsAutocompleteDays, 14);
    assert.strictEqual(card.verdictEta.needsSerpDays, 14);
    assert.match(card.verdictEta.reason, /14 days/);
  });

  it('没有观测时 available=false，而不是“没有竞争”', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date, market_country, research_language)
       VALUES ('opp_obs_empty', 'obs-empty', 'Empty', 'CANDIDATE', CURRENT_DATE, 'US', 'en-US')`
    );
    const card = await harness.services.loadObservationCard('opp_obs_empty', null, 'nothing here', 'US', 'en-US');
    assert.strictEqual(card.serp.available, false);
    assert.strictEqual(card.serp.items.length, 0);
    assert.match(card.serp.note, /unknown, not weak/i);
  });

  it('内容指纹随事实变化而变', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { observationFingerprint } = harness.services;
    const card = await harness.services.loadObservationCard(OPP, QRY, 'unlock pdf', 'US', 'en-US');
    const changed = { ...card, serp: { ...card.serp, items: [...card.serp.items, { rank: 11 } as any] } };
    assert.notStrictEqual(observationFingerprint(card), observationFingerprint(changed as any));
  });
});
