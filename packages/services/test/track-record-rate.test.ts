import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';
import { rateIfTwoSided } from '../src';

/**
 * 公开战绩的比率口径。
 *
 * docs/16 §3.1a 禁止用单边样本打印准确率。「单边」有两种：只有命中没有未命中
 * （样本还没被证伪），以及只有未命中没有命中（样本量不足）；两者都不能支撑百分比。
 *
 * 这条规则原先只写在 `/track-record` 页面的 `accuracy()` 里，于是公开 API
 * `/api/v1/public/track-record`、首页遥测和任何第三方拿到的仍是 `1/1 = 100%`。
 * 下面的用例直接打服务层，就是为了钉住「这条规则不能只活在视图里」。
 */
describe('公开战绩的比率口径', () => {
  // 用一次性库自建 v2 裁决行：公开战绩只统计 hash_version >= 2 的账本行（06 §5、30 R3），
  // 开发库里最新的一行是 seed 的 v1 行，借用它会被纪元过滤正确排除。
  const harness = makeDisposableDb('emeradar_track_rate_test');
  const opportunityId = 'opp_trackrate_test';
  const verdictId = 'vdt_trackrate_test';

  /** 45 天公开延迟之外，才可能出现在公开战绩里。 */
  const visiblePredictedAt = '2026-01-01';

  async function seedEpisode(id: string, outcome30d: string | null, outcome90d: string | null = null) {
    await harness.db.query(
      `INSERT INTO prediction_episodes (
         id, verdict_id, opportunity_id, published_verdict, predicted_at, outcome_30d, outcome_90d
       ) VALUES ($1, $2, $3, 'BUILD_NOW', $4::date, $5, $6)`,
      [id, verdictId, opportunityId, visiblePredictedAt, outcome30d, outcome90d]
    );
  }

  async function clearEpisodes() {
    await harness.db.query(`DELETE FROM prediction_episodes WHERE opportunity_id = $1`, [opportunityId]);
  }

  before(async () => {
    await harness.setup();
    if (!harness.available) return;
    const { query } = harness.db;
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, 'trackrate-test', 'Track Rate Test', 'TRACKED', '2026-01-01')`,
      [opportunityId]
    );
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         raw_verdict, explanation, d_band, m_band, w_band, hash_version,
         prev_hash, row_hash)
       VALUES ($1, $2, '2026-01-01', 'sc-1.2.0', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH',
         'BUILD_NOW', '{}'::jsonb, 'HIGH', 'HIGH', 'HIGH', 2,
         $3, $4)`,
      [verdictId, opportunityId, '0'.repeat(64), verdictId.padEnd(64, '0')]
    );
  });

  after(async () => {
    await harness.teardown();
  });

  it('纯函数：单边样本一律返回 null', () => {
    // 空样本、全命中、全未命中都不足以支撑一个百分比。
    assert.strictEqual(rateIfTwoSided(0, 0), null);
    assert.strictEqual(rateIfTwoSided(0, 3), null);
    assert.strictEqual(rateIfTwoSided(3, 3), null);
    assert.strictEqual(rateIfTwoSided(1, 1), null, '单次命中不得输出 100%');
    // 样本两边都有才出比率。
    assert.strictEqual(rateIfTwoSided(3, 4), '75%');
    assert.strictEqual(rateIfTwoSided(1, 3), '33.3%');
    assert.strictEqual(rateIfTwoSided(2, 3), '66.7%');
  });

  it('只有命中时，服务层返回 null 而不是 100%', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seedEpisode('eps_trackrate_hit_only', 'HIT');

    const record = await harness.services.TrackRecordService.getPublicTrackRecord();
    assert.strictEqual(
      record.stats.evaluatedEpisodes,
      1,
      '夹具没有进入公开战绩：检查 45 天延迟、机会状态与 hash_version'
    );
    assert.strictEqual(record.stats.hitsCount, 1);
    // Q11：只有 T+30 结果、未满额、未关窗、无买断的 Episode 计入汇总，但逐行明细暂不披露。
    assert.strictEqual(record.stats.undisclosedEpisodes, 1);
    assert.strictEqual(record.episodes.length, 0, '抢跑窗口仍在的 Episode 不该出现在逐行明细里');
    assert.strictEqual(
      record.stats.hitRate30d,
      null,
      '单次命中仍然输出了比率 —— 公开 API 会把它当成 100% 战绩'
    );
  });

  it('只有未命中时同样不出比率', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await clearEpisodes();
    await seedEpisode('eps_trackrate_miss_only', 'MISS');

    const record = await harness.services.TrackRecordService.getPublicTrackRecord();
    assert.strictEqual(record.stats.evaluatedEpisodes, 1);
    assert.strictEqual(record.stats.hitRate30d, null);
  });

  it('两边都有样本时才给出比率', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seedEpisode('eps_trackrate_hit_2', 'HIT');

    const record = await harness.services.TrackRecordService.getPublicTrackRecord();
    assert.strictEqual(record.stats.evaluatedEpisodes, 2);
    assert.strictEqual(record.stats.hitsCount, 1);
    assert.strictEqual(record.stats.hitRate30d, '50%');
  });

  it('纪元过滤：锚定在 hash_version = 1 裁决行上的 Episode 不进任何统计（30 R3）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         prev_hash, row_hash)
       VALUES ('vdt_trackrate_v1', $1, '2025-12-01', 'sc-1.0.0', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', $2, $3)`,
      [opportunityId, '0'.repeat(64), 'vdt_trackrate_v1'.padEnd(64, '0')]
    );
    const before = (await harness.services.TrackRecordService.getPublicTrackRecord()).stats;
    await query(
      `INSERT INTO prediction_episodes (
         id, verdict_id, opportunity_id, published_verdict, predicted_at, outcome_30d
       ) VALUES ('eps_trackrate_seed_v1', 'vdt_trackrate_v1', $1, 'BUILD_NOW', '2025-12-01', 'HIT')`,
      [opportunityId]
    );
    const after = (await harness.services.TrackRecordService.getPublicTrackRecord()).stats;
    assert.strictEqual(after.totalPredictions, before.totalPredictions, 'seed 行进入了公开统计');
    assert.strictEqual(after.hitsCount, before.hitsCount);
  });

  it('逐行明细保留机会标题与 slug（C 阶段删除打码分支时误删）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await clearEpisodes();
    // T+90 有结果即披露，不依赖机会是否已失去抢跑价值。
    await seedEpisode('eps_trackrate_disclosed', 'HIT', 'HIT');

    const record = await harness.services.TrackRecordService.getPublicTrackRecord();
    assert.strictEqual(record.episodes.length, 1, '已披露的 Episode 没有出现在明细里');
    assert.strictEqual(
      record.episodes[0].opportunity_title,
      'Track Rate Test',
      '公开明细丢了机会标题 —— 页面上的机会列会是空白'
    );
    assert.strictEqual(
      record.episodes[0].opportunity_slug,
      'trackrate-test',
      '公开明细丢了 slug —— 页面链接会指向 /opportunities/undefined'
    );
  });
});
