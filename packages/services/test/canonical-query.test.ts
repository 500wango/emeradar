import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Phase 1：Canonical Opportunity。
 *
 * L1 词法指纹解决“写法不同但同义”；L2 SERP 交集只在 L1 无同伴、且有≥2 次快照
 * 且 URL/域名交集都达标时才合并。surface query 必须原样保留。
 */
const harness = makeDisposableDb('emeradar_canonical_query_test');

async function seedOpportunity(id: string, query: string, intent = 'COMMERCIAL') {
  const { query: run } = harness.db;
  await run(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date, market_country, research_language)
     VALUES ($1, $2, $3, 'CANDIDATE', CURRENT_DATE, 'US', 'en-US')`,
    [id, id.replace(/_/g, '-'), query]
  );
  await run(
    `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
     VALUES ($1, $2, 'US', 'en-US', CURRENT_DATE, 'A')`,
    [`qry_${id}`, query]
  );
  await run(
    `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`,
    [id, `qry_${id}`]
  );
  await run(
    `INSERT INTO opportunity_cards (opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band, confidence,
       recommended_archetype, execution_class, why_now_summary, top_idea, first_observed_at, search_intent)
     VALUES ($1, $2, $3, 'WATCH', 'FORMING', 5000, 5000, 5000, 'MEDIUM', 'MEDIUM', 'MEDIUM',
       'MEDIUM', 'TOOL', 'S', 'f', 'f', NOW(), $4)`,
    [id, id.replace(/_/g, '-'), query, intent]
  );
}

async function seedSerp(opportunityId: string, dayOffset: number, urls: string[]) {
  const { query: run } = harness.db;
  const snapshotId = `srp_${opportunityId}_${dayOffset}`;
  await run(
    `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider)
     VALUES ($1, $2, CURRENT_DATE - $3::int, 0.5, 10, $4, 'SERPAPI')`,
    [snapshotId, `qry_${opportunityId}`, dayOffset, urls.length]
  );
  for (const [index, url] of urls.entries()) {
    await run(
      `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, result_type)
       VALUES ($1, $2, $3, $4, 't', 'SPECIALIST')`,
      [snapshotId, index + 1, url, new URL(url).hostname.replace(/^www\./, '')]
    );
  }
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seedOpportunity('opp_can_a', 'template spreadsheet', 'COMMERCIAL');
  await seedOpportunity('opp_can_b', 'template for spreadsheet', 'INFORMATIONAL');
  // 生产里候选创建时就写指纹（seed pipeline + 0039 回填）；夹具必须一致，
  // 否则 L1 归并看起来“没生效”其实是数据没准备好。
  const { lexicalFingerprint } = harness.services;
  await harness.db.query(
    `UPDATE opportunities SET lexical_fingerprint = $2 WHERE id = $1`,
    ['opp_can_a', lexicalFingerprint('template spreadsheet')]
  );
  await harness.db.query(
    `UPDATE opportunities SET lexical_fingerprint = $2 WHERE id = $1`,
    ['opp_can_b', lexicalFingerprint('template for spreadsheet')]
  );
  await seedOpportunity('opp_can_serp_1', 'remove pdf password offline');
  await seedOpportunity('opp_can_serp_2', 'unlock pdf in browser');
  await seedOpportunity('opp_can_serp_3', 'pdf editor online');
  const { lexicalFingerprint: fp } = harness.services;
  for (const [id, surface] of [
    ['opp_can_serp_1', 'remove pdf password offline'],
    ['opp_can_serp_2', 'unlock pdf in browser'],
    ['opp_can_serp_3', 'pdf editor online'],
  ] as const) {
    await harness.db.query(`UPDATE opportunities SET lexical_fingerprint = $2 WHERE id = $1`, [id, fp(surface)]);
  }
  const shared = [
    'https://a1.example/x', 'https://a2.example/x', 'https://a3.example/x',
    'https://a4.example/x', 'https://a5.example/x',
    'https://b1.example/y', 'https://b2.example/y', 'https://b3.example/y',
    'https://b4.example/y', 'https://b5.example/y',
  ];
  const different = [
    'https://z1.example/x', 'https://z2.example/x', 'https://z3.example/x',
    'https://z4.example/x', 'https://z5.example/x',
    'https://y1.example/y', 'https://y2.example/y', 'https://y3.example/y',
    'https://y4.example/y', 'https://y5.example/y',
  ];
  // 两份快照都高度重叠 → 同意图
  await seedSerp('opp_can_serp_1', 0, shared);
  await seedSerp('opp_can_serp_1', 3, shared);
  await seedSerp('opp_can_serp_2', 0, [...shared.slice(0, 7), 'https://c1.example/z', 'https://c2.example/z', 'https://c3.example/z']);
  await seedSerp('opp_can_serp_2', 3, [...shared.slice(0, 7), 'https://c4.example/z', 'https://c5.example/z', 'https://c6.example/z']);
  // 只有 1 个 URL 重叠 → 不同意图
  await seedSerp('opp_can_serp_3', 0, [shared[0], ...different.slice(1)]);
  await seedSerp('opp_can_serp_3', 3, [shared[1], ...different.slice(1)]);
});

after(async () => {
  await harness.teardown();
});

describe('Phase 1 Canonical Opportunity', () => {
  it('词法指纹忽略停用词与词形，同义写法落到同一个键', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { lexicalFingerprint } = harness.services;
    assert.strictEqual(lexicalFingerprint('template spreadsheet'), lexicalFingerprint('template for spreadsheet'));
    assert.strictEqual(lexicalFingerprint('csv to excel conversion'), lexicalFingerprint('convert a csv file to excel'));
    assert.notStrictEqual(lexicalFingerprint('template spreadsheet'), lexicalFingerprint('template invoice'));
  });

  it('L1 把同指纹候选挂进同一簇，代表词优先商业意图，surface query 保留', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { canonicalizeOpportunity, clusterMembers } = harness.services;
    const result = await canonicalizeOpportunity('opp_can_a');
    assert.ok(result);
    assert.strictEqual(result!.representativeOpportunityId, 'opp_can_a', '商业意图应优先于信息性');

    const members = await clusterMembers(result!.clusterId);
    assert.strictEqual(members.length, 2);
    assert.deepStrictEqual(
      members.map((m) => m.surfaceQuery).sort(),
      ['template for spreadsheet', 'template spreadsheet']
    );
  });

  it('L2 只在两份快照都达标时合并，重叠不足不合并', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { canonicalizeOpportunity } = harness.services;
    const merged = await canonicalizeOpportunity('opp_can_serp_1', { trySerpMerge: true });
    assert.ok(merged);
    assert.ok(merged!.serpMerged.includes('opp_can_serp_2'), '两次快照均高度重叠必须合并');
    assert.ok(!merged!.serpMerged.includes('opp_can_serp_3'), '重叠不足不得合并');
  });

  it('只有一份快照时不合并（数据不足宁可分开）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { serpOverlapEvidence, isSameIntent } = harness.services;
    const evidence = await serpOverlapEvidence('opp_can_serp_1', 'opp_can_serp_2');
    assert.ok(evidence);
    assert.strictEqual(isSameIntent({ ...evidence!, snapshotsCompared: 1 }), false);
  });
});
