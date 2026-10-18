import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 拥挤透明度的生产者（01 §5.9、05 §3.3）。
 *
 * 这三项只服务展示、生命周期与 CROWDING_SIGNAL，**不进入 W**。这里钉住定义：
 *   · verified_product_count = 映射到该机会、VERIFIED_OWNER、未归档的独立项目数；
 *   · top10_specialist_count = 最新主查询快照里 result_type=SPECIALIST 的前 10 条；
 *   · new_top10_entrants_30d = 当前 Top10 中，30 天前从未出现过的独立域名数。
 */
const harness = makeDisposableDb('emeradar_crowding_test');

const OPP = 'opp_crowding_test';
const QRY = 'qry_crowding_test';

async function seedBase() {
  const { query } = harness.db;
  await query(`INSERT INTO users (id, email, display_name, role, tier) VALUES ('usr_crowd', 'crowd@test', 'c', 'USER', 'PRO')`);
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, 'crowding-test', 'Crowding Test', 'TRACKED', CURRENT_DATE)`,
    [OPP]
  );
  await query(`INSERT INTO queries (id, query_text) VALUES ($1, 'crowding test query')`, [QRY]);
  await query(`INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`, [OPP, QRY]);

  // 60 天前的 Top10：keep.com 在；new1/new2 还不在。
  await query(
    `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio) VALUES ('srp_old', $1, CURRENT_DATE - 60, 0)`,
    [QRY]
  );
  await query(
    `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title) VALUES
       ('srp_old', 1, 'https://keep.com/', 'keep.com', 'keep'),
       ('srp_old', 2, 'https://old.com/', 'old.com', 'old')`
  );
  // 今天的 Top10：keep 还在；new1/new2 是新进入；两个 specialist。
  await query(
    `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio) VALUES ('srp_today', $1, CURRENT_DATE, 0)`,
    [QRY]
  );
  await query(
    `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, result_type) VALUES
       ('srp_today', 1, 'https://keep.com/', 'keep.com', 'keep', 'SPECIALIST'),
       ('srp_today', 2, 'https://new1.com/', 'new1.com', 'new1', 'SPECIALIST'),
       ('srp_today', 3, 'https://new2.com/', 'new2.com', 'new2', 'OFFICIAL')`
  );

  // 两个 VERIFIED_OWNER 项目 + 一个未核验项目；其中一个已归档，不该计入。
  for (const [id, status, credential] of [
    ['prj_crowd_1', 'IN_DEVELOPMENT', 'VERIFIED_OWNER'],
    ['prj_crowd_2', 'ARCHIVED', 'VERIFIED_OWNER'],
    ['prj_crowd_3', 'IN_DEVELOPMENT', 'UNVERIFIED'],
  ] as const) {
    await query(
      `INSERT INTO projects (id, user_id, opportunity_id, title, build_type, status, target_keywords, credential_status)
       VALUES ($1, 'usr_crowd', $2, $1, 'TOOL', $3, '{}', $4)`,
      [id, OPP, status, credential]
    );
  }
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seedBase();
});

after(async () => {
  await harness.teardown();
});

describe('拥挤透明度的生产者', () => {
  it('按定义计算三个计数，并把当日行写入 crowding_daily', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { computeCrowding, storeCrowding, loadCrowding } = harness.services;

    const today = (
      await harness.db.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`)
    ).rows[0].d;
    const snapshot = await computeCrowding(OPP);
    assert.deepStrictEqual(snapshot, {
      verifiedProductCount: 1, // 只有未归档的 VERIFIED_OWNER
      top10SpecialistCount: 2,
      newTop10Entrants30d: 2, // new1/new2；keep 在 60 天前就已出现
    });

    await storeCrowding(OPP, today, snapshot);
    const row = await loadCrowding(OPP, today);
    assert.ok(row);
    assert.strictEqual(row.verifiedProductCount, 1);
    assert.strictEqual(row.top10SpecialistCount, 2);
    assert.strictEqual(row.newTop10Entrants30d, 2);
  });

  it('没有主查询/SERP 快照时仍返回可算的 verified 计数，SERP 计数为 0', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { computeCrowding } = harness.services;

    await harness.db.query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ('opp_crowding_bare', 'crowding-bare', 'Bare', 'TRACKED', CURRENT_DATE)`
    );
    const snapshot = await computeCrowding('opp_crowding_bare');
    assert.deepStrictEqual(snapshot, {
      verifiedProductCount: 0,
      top10SpecialistCount: 0,
      newTop10Entrants30d: 0,
    });
  });
});
