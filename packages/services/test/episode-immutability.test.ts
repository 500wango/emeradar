import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * `prediction_episodes` 的可改写边界。
 *
 * 这张表**不是** append-only 的 —— outcome 评估器就是靠原地 UPDATE 逐 horizon
 * 回填 T+30/60/90（prediction-episode.service.ts:205-227）。所以它的约束不能照抄
 * verdicts 那种"UPDATE 一律抛错"，只能按真正的不变式逐条收：
 *
 *   1. 预测本身不可改写：引用哪条裁决、哪个机会、预测日、当时发布的裁决类别；
 *   2. 已判定的 horizon 不可重判。
 *
 * 第 2 条尤其要落到数据库层：服务层的守卫是 `outcome_Xd IS NULL OR = 'PENDING'`，
 * 它只在服务层自己那条路径上成立。而战绩页对外承诺的是"命中与失误都公开" ——
 * 一句直接 SQL 就能把 MISS 改成 HIT，承诺与实现之间就只剩那句守卫。
 *
 * 用一次性库而不是 `pnpm db:migrate` 那个库：这里必须真的插入裁决行才能满足外键，
 * 而 verdicts 是只追加的，塞进开发库就永远删不掉。
 */
const harness = makeDisposableDb('emeradar_episode_immutability_test');

const OPP = 'opp_episode_immut';
const OPP_OTHER = 'opp_episode_immut_other';
const VERDICT = 'vdt_episode_immut';
const VERDICT_OTHER = 'vdt_episode_immut_other';
const EPISODE = 'eps_episode_immut';

async function seedFixture() {
  const { query } = harness.db;

  for (const [opportunityId, slug] of [
    [OPP, 'episode-immut'],
    [OPP_OTHER, 'episode-immut-other'],
  ] as const) {
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, $2, $2, 'TRACKED', '2026-01-01')`,
      [opportunityId, slug]
    );
  }

  for (const [verdictId, opportunityId] of [
    [VERDICT, OPP],
    [VERDICT_OTHER, OPP_OTHER],
  ] as const) {
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         d_band, m_band, w_band, prev_hash, row_hash)
       VALUES ($1, $2, '2026-01-01', 'sc-1.1.0', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', 'HIGH', 'HIGH', 'HIGH', $3, $4)`,
      [verdictId, opportunityId, '0'.repeat(64), verdictId.padEnd(64, '0')]
    );
  }

  await query(
    `INSERT INTO prediction_episodes (id, verdict_id, opportunity_id, published_verdict, predicted_at, outcome_30d)
     VALUES ($1, $2, $3, 'BUILD_NOW', '2026-01-01', 'PENDING')`,
    [EPISODE, VERDICT, OPP]
  );
}

/** 断言调用以 SQLSTATE 0A000 被拒（append-only 触发器用的错误码）。 */
async function expectRejected(fn: () => Promise<unknown>, what: string) {
  let caught: any = null;
  try {
    await fn();
  } catch (error: any) {
    caught = error;
  }
  assert.ok(caught, `${what}: 期望被拒绝，但调用成功了`);
  assert.strictEqual(caught.code, '0A000', `${what}: 期望 0A000，实得 ${caught.code}（${caught.message}）`);
}

/** 把 T+30 判定为 MISS。重复调用是空操作（WHERE 不匹配则触发器不触发）。 */
async function grade30AsMiss() {
  await harness.db.query(
    `UPDATE prediction_episodes SET outcome_30d = 'MISS', evaluated_30d_at = '2026-01-31'
      WHERE id = $1 AND (outcome_30d IS NULL OR outcome_30d = 'PENDING')`,
    [EPISODE]
  );
}

describe('prediction_episodes 的可改写边界', () => {
  before(async () => {
    await harness.setup();
    if (harness.available) await seedFixture();
  });

  after(async () => {
    await harness.teardown();
  });

  it('未判定的 horizon 可以回填（评估器的正常路径）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const res = await harness.db.query(
      `UPDATE prediction_episodes SET outcome_30d = 'MISS', evaluated_30d_at = '2026-01-31'
        WHERE id = $1 AND (outcome_30d IS NULL OR outcome_30d = 'PENDING')`,
      [EPISODE]
    );
    assert.strictEqual(res.rowCount, 1, 'PENDING 的 horizon 拒绝被回填 —— 评估器会整条死掉');
  });

  it('已判定的 horizon 不可重判：MISS 不能悄悄变成 HIT', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await grade30AsMiss();

    await expectRejected(
      () => harness.db.query(`UPDATE prediction_episodes SET outcome_30d = 'HIT' WHERE id = $1`, [EPISODE]),
      '重判已判定的 T+30'
    );
    await expectRejected(
      () =>
        harness.db.query(
          `UPDATE prediction_episodes SET outcome_30d = NULL, evaluated_30d_at = NULL WHERE id = $1`,
          [EPISODE]
        ),
      '把已判定的 T+30 抹回未判定'
    );

    const row = (
      await harness.db.query<{ outcome_30d: string }>(`SELECT outcome_30d FROM prediction_episodes WHERE id = $1`, [
        EPISODE,
      ])
    ).rows[0];
    assert.strictEqual(row.outcome_30d, 'MISS', '结果被改动了');
  });

  it('预测本身不可改写：预测日、所引裁决、当时发布的类别', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await expectRejected(
      () => harness.db.query(`UPDATE prediction_episodes SET predicted_at = '2026-06-01' WHERE id = $1`, [EPISODE]),
      '改写预测日（等于把预言挪到事后更好的时点）'
    );
    await expectRejected(
      () => harness.db.query(`UPDATE prediction_episodes SET verdict_id = $2 WHERE id = $1`, [EPISODE, VERDICT_OTHER]),
      '改掉所引裁决'
    );
    await expectRejected(
      () => harness.db.query(`UPDATE prediction_episodes SET opportunity_id = $2 WHERE id = $1`, [EPISODE, OPP_OTHER]),
      '改掉所属机会'
    );
    await expectRejected(
      () => harness.db.query(`UPDATE prediction_episodes SET published_verdict = 'WATCH' WHERE id = $1`, [EPISODE]),
      '改掉当时发布的裁决类别'
    );
  });

  it('metrics 仍按 horizon 逐次合并（这是设计，不是漏网）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    for (const patch of [{ evalSpecVersion: 'ev-1.0', h60: { marketFormed: true } }, { h90: { marketFormed: false } }]) {
      await harness.db.query(
        `UPDATE prediction_episodes SET metrics = COALESCE(metrics, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [EPISODE, JSON.stringify(patch)]
      );
    }

    const { metrics } = (
      await harness.db.query<{ metrics: any }>(`SELECT metrics FROM prediction_episodes WHERE id = $1`, [EPISODE])
    ).rows[0];
    assert.strictEqual(metrics.h60.marketFormed, true, '先前写入的 horizon 明细被后一次合并覆盖了');
    assert.strictEqual(metrics.h90.marketFormed, false);
    assert.strictEqual(metrics.evalSpecVersion, 'ev-1.0');
  });

  it('DELETE 放行：ON DELETE CASCADE 与夹具清理依赖它', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    // 与 decisions 同一个取舍：挡 UPDATE 是因为改写能伪造"当时说了什么"，
    // 而挡 DELETE 会连带堵死 opportunity/verdict 的级联与测试清理路径。
    await harness.db.query(`DELETE FROM prediction_episodes WHERE id = $1`, [EPISODE]);
    const remaining = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM prediction_episodes WHERE id = $1`,
      [EPISODE]
    );
    assert.strictEqual(remaining.rows[0].count, 0, 'episode 行删不掉');
  });
});
