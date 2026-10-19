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

  it('读时按当前分类器重算标签：LinkedIn 是 UGC，wix 是泛平台', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date, market_country, research_language)
       VALUES ('opp_obs_reclass', 'obs-reclass', 'Reclass', 'CANDIDATE', CURRENT_DATE, 'US', 'en-US')`
    );
    await query(
      `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
       VALUES ('qry_obs_reclass', 'podcast transcript seo', 'US', 'en-US', CURRENT_DATE, 'A')`
    );
    await query(
      `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ('opp_obs_reclass','qry_obs_reclass','PRIMARY')`
    );
    await query(
      `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider)
       VALUES ('srp_obs_reclass','qry_obs_reclass', CURRENT_DATE, 0.3, 10, 4, 'AISA_DATAFORSEO')`
    );
    const rows: Array<[number, string, string, string]> = [
      [1, 'https://www.linkedin.com/posts/x', 'linkedin.com', 'SPECIALIST'],
      [2, 'https://www.wix.com/', 'wix.com', 'SPECIALIST'],
      [3, 'https://rss.com/podcasts/', 'rss.com', 'SPECIALIST'],
      [4, 'https://www.quora.com/What-is-podcast-seo', 'quora.com', 'UGC_THREAD'],
    ];
    for (const [rank, url, domain, resultType] of rows) {
      await query(
        `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, snippet, result_type, domain_authority_class, is_weak)
         VALUES ('srp_obs_reclass',$1,$2,$3,'t','s',$4,'SPECIALIST',false)`,
        [rank, url, domain, resultType]
      );
    }

    const card = await harness.services.loadObservationCard(
      'opp_obs_reclass',
      'qry_obs_reclass',
      'podcast transcript seo',
      'US',
      'en-US'
    );
    const byDomain = Object.fromEntries(card.serp.items.map((item) => [item.domain, item.pageKind]));
    assert.strictEqual(byDomain['linkedin.com'], 'UGC');
    assert.strictEqual(byDomain['wix.com'], 'GENERIC_PLATFORM');
    assert.strictEqual(byDomain['rss.com'], 'HOSTING_SERVICE');
    assert.strictEqual(byDomain['quora.com'], 'UGC');
    assert.strictEqual(card.serp.dedicatedToolPages, 0);
    // 没有工具页、也一次都没探测定价 → 只能说“证据不足”，不能说“信息型”。
    assert.strictEqual(card.intent.intentFit, 'INSUFFICIENT');
    assert.strictEqual(card.serp.distinctDomains, 4);
  });

  it('同一域名占多个位置时，竞争面按域名去重', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date, market_country, research_language)
       VALUES ('opp_obs_dupe', 'obs-dupe', 'Dupe', 'CANDIDATE', CURRENT_DATE, 'US', 'en-US')`
    );
    await query(
      `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
       VALUES ('qry_obs_dupe', 'podcast transcript seo dupe', 'US', 'en-US', CURRENT_DATE, 'A')`
    );
    await query(
      `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ('opp_obs_dupe','qry_obs_dupe','PRIMARY')`
    );
    await query(
      `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider)
       VALUES ('srp_obs_dupe','qry_obs_dupe', CURRENT_DATE, 0.4, 10, 5, 'AISA_DATAFORSEO')`
    );
    // podsqeeze 占两格；quora 占两格；rss 一格。
    const rows: Array<[number, string, string, boolean]> = [
      [1, 'https://www.linkedin.com/posts/x', 'linkedin.com', true],
      [2, 'https://podsqueeze.com/', 'podsqueeze.com', false],
      [3, 'https://www.quora.com/a', 'quora.com', true],
      [4, 'https://podsqueeze.com/features', 'podsqueeze.com', false],
      [5, 'https://www.quora.com/b', 'quora.com', true],
    ];
    for (const [rank, url, domain, weak] of rows) {
      await query(
        `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, snippet, result_type, domain_authority_class, is_weak)
         VALUES ('srp_obs_dupe',$1,$2,$3,'t','s','SPECIALIST','SPECIALIST',$4)`,
        [rank, url, domain, weak]
      );
    }

    const card = await harness.services.loadObservationCard(
      'opp_obs_dupe',
      'qry_obs_dupe',
      'podcast transcript seo dupe',
      'US',
      'en-US'
    );
    assert.strictEqual(card.serp.positions, 5);
    assert.strictEqual(card.serp.distinctDomains, 3, '三个域名，不是五个位置');
    assert.strictEqual(card.serp.duplicatePositions, 2);
    assert.strictEqual(card.serp.competitors.length, 3);

    const podsqueeze = card.serp.competitors.find((c) => c.domain === 'podsqueeze.com');
    assert.strictEqual(podsqueeze?.bestRank, 2, '去重后保留最好名次');
    assert.deepStrictEqual(podsqueeze?.ranks, [2, 4]);
    assert.strictEqual(card.serp.weakDomains, 2, 'LinkedIn + Quora 各算一个弱站');
  });

  it('内容指纹随事实变化而变', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { observationFingerprint } = harness.services;
    const card = await harness.services.loadObservationCard(OPP, QRY, 'unlock pdf', 'US', 'en-US');
    const changed = { ...card, serp: { ...card.serp, items: [...card.serp.items, { rank: 11 } as any] } };
    assert.notStrictEqual(observationFingerprint(card), observationFingerprint(changed as any));
  });
});
