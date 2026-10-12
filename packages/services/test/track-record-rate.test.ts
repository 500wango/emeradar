import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { query, closePool } from '@emeradar/db';
import { TrackRecordService, rateIfTwoSided } from '../src';

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
  const opportunityId = 'opp_trackrate_test';
  const ownerUserId = 'usr_trackrate_test';
  let verdictId = '';

  /**
   * `prediction_episodes.verdict_id` 外键指向只追加的 `verdicts`，所以夹具借用
   * 一条已有账本行，而不是插一条自己永远删不掉的行。
   */
  async function borrowVerdictId(): Promise<string | null> {
    const res = await query<{ id: string }>(`SELECT id FROM verdicts ORDER BY obs_date DESC LIMIT 1`);
    return res.rows[0]?.id ?? null;
  }

  /** 45 天公开延迟之外，才可能出现在公开战绩里。 */
  const visiblePredictedAt = '2026-01-01';

  async function resetFixture() {
    await query(`DELETE FROM prediction_episodes WHERE opportunity_id = $1`, [opportunityId]);
    await query(`DELETE FROM opportunities WHERE id = $1`, [opportunityId]);
    await query(`DELETE FROM users WHERE id = $1`, [ownerUserId]);
  }

  async function seedEpisode(id: string, outcome30d: string | null) {
    await query(
      `INSERT INTO prediction_episodes (
         id, verdict_id, opportunity_id, published_verdict, predicted_at, outcome_30d
       ) VALUES ($1, $2, $3, 'BUILD_NOW', $4::date, $5)`,
      [id, verdictId, opportunityId, visiblePredictedAt, outcome30d]
    );
  }

  before(async () => {
    verdictId = (await borrowVerdictId()) ?? '';
    if (!verdictId) return;
    await resetFixture();
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, 'trackrate-test', 'Track Rate Test', 'TRACKED', '2026-01-01')`,
      [opportunityId]
    );
  });

  after(async () => {
    if (verdictId) await resetFixture();
    await closePool();
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
    if (!verdictId) return t.skip('库里没有可借用的账本行');
    await seedEpisode('eps_trackrate_hit_only', 'HIT');

    const record = await TrackRecordService.getPublicTrackRecord();
    assert.strictEqual(
      record.stats.evaluatedEpisodes,
      1,
      '夹具没有进入公开战绩：检查 45 天延迟与机会状态'
    );
    assert.strictEqual(record.stats.hitsCount, 1);
    assert.strictEqual(
      record.stats.hitRate30d,
      null,
      '单次命中仍然输出了比率 —— 公开 API 会把它当成 100% 战绩'
    );
  });

  it('只有未命中时同样不出比率', async (t) => {
    if (!verdictId) return t.skip('库里没有可借用的账本行');
    await resetFixture();
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, 'trackrate-test', 'Track Rate Test', 'TRACKED', '2026-01-01')`,
      [opportunityId]
    );
    await seedEpisode('eps_trackrate_miss_only', 'MISS');

    const record = await TrackRecordService.getPublicTrackRecord();
    assert.strictEqual(record.stats.evaluatedEpisodes, 1);
    assert.strictEqual(record.stats.hitRate30d, null);
  });

  it('两边都有样本时才给出比率', async (t) => {
    if (!verdictId) return t.skip('库里没有可借用的账本行');
    await seedEpisode('eps_trackrate_hit_2', 'HIT');

    const record = await TrackRecordService.getPublicTrackRecord();
    assert.strictEqual(record.stats.evaluatedEpisodes, 2);
    assert.strictEqual(record.stats.hitsCount, 1);
    assert.strictEqual(record.stats.hitRate30d, '50%');
  });
});
