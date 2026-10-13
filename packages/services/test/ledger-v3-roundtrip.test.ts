import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  generateDailyLedger,
  GENESIS_PREV_HASH,
  type DailyLedgerRecord,
  type PredictionSpec,
  type VerdictRowDataV1,
  type VerdictRowDataV2,
  type VerdictRowDataV3,
} from '@emeradar/ledger';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * v3 行（带预测规格）必须能被**公开验证端点那条路径**验过，同时不能让已经发布
 * 的 v1/v2 天失效。
 *
 * 这是 D2 的验收条件，也是它唯一有意义的形态：`row-hash.ts` 的纯函数级用例能证明
 * "换个字段集算不出同一个值"，但证明不了"写进库、再读回来、按 hash_version 分派"
 * 这一整条链是自洽的 —— 而恰恰是后者在上一轮里出过问题（`Number(hash_version) >= 2
 * ? 2 : 1` 把 3 读成 2，新版本上线当天整天的公开展示会报"账本不一致"）。
 *
 * 用一次性数据库的原因与 admin-ledger-integrity 相同：`verdicts` 与
 * `ledger_checkpoints` 只追加，夹具写进去的行永远删不掉，绝不能落到开发库上。
 */
const harness = makeDisposableDb('emeradar_ledger_v3');

const SPEC: PredictionSpec = {
  criteriaVersion: 'ev-1.0',
  horizons: [30, 60, 90],
  target: 'market_formed',
};

/** 第一天：同一日四种行并存 —— v1、v2、带规格的 v3、显式"没有预测"的 v3。 */
const DAY_MIXED = '2026-04-01';
/** 第二天：v3 行写入后被**出库改写**（模拟有人改了规格），重算必须抓住。 */
const DAY_TAMPERED = '2026-04-02';

const OPP_V1 = 'opp_v3_v1';
const OPP_V2 = 'opp_v3_v2';
const OPP_V3_SPEC = 'opp_v3_spec';
const OPP_V3_NULL = 'opp_v3_null';
const OPP_TAMPER = 'opp_v3_tamper';

function baseRow(opportunityId: string, obsDate: string): VerdictRowDataV1 {
  return {
    opportunityId,
    obsDate,
    scoringConfigVersion: 'sc-1.0.0',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBasisPoints: 8200,
    mBasisPoints: 7600,
    wBasisPoints: 8100,
    confidence: 'HIGH',
    inputSnapshotIds: [`snp_${opportunityId}_${obsDate}`],
    citedEvidenceIds: [],
  };
}

function v2Of(row: VerdictRowDataV1): VerdictRowDataV2 {
  return {
    ...row,
    rawVerdict: 'BUILD_NOW',
    flags: ['BASELINE_PERIOD'],
    explanation: {
      dReason: 'Demand growth is accelerating.',
      mReason: 'Two independent paid competitors observed.',
      wReason: 'SERP weakness above threshold.',
      verdictReason: 'All signals aligned.',
      rulesTriggered: ['RULE_BUILD_NOW'],
    },
    featuresHash: 'a'.repeat(64),
    dBand: 'HIGH',
    mBand: 'MEDIUM',
    wBand: 'HIGH',
  };
}

/** 把一天的行与检查点写进库，列集与 `pipeline.ts` 的写入逐列对应。 */
async function writeDay(records: DailyLedgerRecord[], prevRowHash: string, prevCheckpointHash: string) {
  const obsDate = records[0].data.obsDate;
  const compact = obsDate.replace(/-/g, '');
  const ledger = generateDailyLedger(obsDate, records, prevCheckpointHash, prevRowHash);

  for (const row of ledger.hashedRows) {
    const data = row.data;
    const v2 = 'rawVerdict' in data ? (data as VerdictRowDataV2) : null;
    const v3 = 'predictionSpec' in data ? (data as VerdictRowDataV3) : null;
    await harness.db.query(
      `INSERT INTO verdicts (
         id, opportunity_id, obs_date, scoring_config_version,
         verdict, raw_verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
         confidence, input_snapshot_ids, cited_evidence_ids,
         flags, explanation, features_hash, hash_version,
         d_band, m_band, w_band, prediction_spec,
         prev_hash, row_hash
       ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18,$19,$20,$21,$22,$23)`,
      [
        `vdt_${row.opportunityId}_${compact}`,
        row.opportunityId,
        obsDate,
        data.scoringConfigVersion,
        data.verdict,
        v2 ? v2.rawVerdict : null,
        data.lifecycle,
        data.dBasisPoints,
        data.mBasisPoints,
        data.wBasisPoints,
        data.confidence,
        data.inputSnapshotIds,
        data.citedEvidenceIds,
        v2 ? v2.flags : null,
        v2 ? JSON.stringify(v2.explanation) : null,
        v2 ? v2.featuresHash : null,
        row.hashVersion,
        v2 ? v2.dBand : null,
        v2 ? v2.mBand : null,
        v2 ? v2.wBand : null,
        v3 && v3.predictionSpec !== null ? JSON.stringify(v3.predictionSpec) : null,
        row.prevHash,
        row.rowHash,
      ]
    );
  }

  await harness.db.query(
    `INSERT INTO ledger_checkpoints (id, obs_date, total_records, merkle_root, final_row_hash, checkpoint_hash)
     VALUES ($1,$2::date,$3,$4,$5,$6)`,
    [
      `ckp_${compact}`,
      obsDate,
      ledger.summary.rowCount,
      ledger.summary.merkleRoot,
      ledger.summary.finalRowHash,
      ledger.summary.checkpointHash,
    ]
  );

  return ledger.summary;
}

describe('v3 行的公开验证往返（含已发布的 v1/v2 行）', () => {
  before(async () => {
    await harness.setup();
    if (!harness.available) return;
    for (const [id, slug] of [
      [OPP_V1, 'v3-v1'],
      [OPP_V2, 'v3-v2'],
      [OPP_V3_SPEC, 'v3-spec'],
      [OPP_V3_NULL, 'v3-null'],
      [OPP_TAMPER, 'v3-tamper'],
    ] as const) {
      await harness.db.query(
        `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
         VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
        [id, slug, slug]
      );
    }
  });

  after(async () => {
    await harness.teardown();
  });

  it('同一天里的 v1/v2/v3 行各自按自己的字段集复算，整天验证通过', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const b1 = baseRow(OPP_V1, DAY_MIXED);
    const b2 = baseRow(OPP_V2, DAY_MIXED);
    const b3 = baseRow(OPP_V3_SPEC, DAY_MIXED);
    const b4 = baseRow(OPP_V3_NULL, DAY_MIXED);

    const summary = await writeDay(
      [
        { opportunityId: OPP_V1, data: b1, hashVersion: 1 },
        { opportunityId: OPP_V2, data: v2Of(b2), hashVersion: 2 },
        { opportunityId: OPP_V3_SPEC, data: { ...v2Of(b3), predictionSpec: SPEC }, hashVersion: 3 },
        // 这一行明确"没有发布预测"，与"旧格式行"是两回事。
        { opportunityId: OPP_V3_NULL, data: { ...v2Of(b4), predictionSpec: null }, hashVersion: 3 },
      ],
      GENESIS_PREV_HASH,
      GENESIS_PREV_HASH
    );

    const stored = await harness.db.query<{
      opportunity_id: string;
      hash_version: number;
      prediction_spec: PredictionSpec | null;
    }>(
      `SELECT opportunity_id, hash_version, prediction_spec FROM verdicts
       WHERE obs_date = $1::date ORDER BY opportunity_id COLLATE "C" ASC`,
      [DAY_MIXED]
    );
    // 按机会 id 取，不按下标：行序是 COLLATE "C" 的字节序，与构造顺序无关。
    const versions = new Map(stored.rows.map((r) => [r.opportunity_id, Number(r.hash_version)]));
    assert.deepStrictEqual(
      Object.fromEntries(versions),
      { [OPP_V1]: 1, [OPP_V2]: 2, [OPP_V3_NULL]: 3, [OPP_V3_SPEC]: 3 },
      '写入的 hash_version 与构造时声明的不一致'
    );
    const specRow = stored.rows.find((r) => r.opportunity_id === OPP_V3_SPEC);
    assert.strictEqual(specRow?.prediction_spec?.criteriaVersion, SPEC.criteriaVersion);
    // "没有预测"（v3 + null）与"旧格式"（v1/v2）在库里都应该没有规格。
    const nullRow = stored.rows.find((r) => r.opportunity_id === OPP_V3_NULL);
    assert.strictEqual(nullRow?.prediction_spec, null);

    const verification = await harness.services.TrackRecordService.verifyCheckpoint(DAY_MIXED);
    assert.strictEqual(
      verification.verified,
      true,
      'v3 行上线后，包含了已发布的 v1/v2 行的这一天被判为验不过 —— 这正是版本塌缩的症状'
    );
    assert.strictEqual(verification.rowCount, 4);
    assert.strictEqual(verification.calculatedMerkleRoot, summary.merkleRoot);
  });

  it('出库改写 v3 行的预测规格会被重算抓住', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const day1 = await harness.db.query<{ final_row_hash: string; checkpoint_hash: string }>(
      `SELECT final_row_hash, checkpoint_hash FROM ledger_checkpoints WHERE obs_date = $1::date`,
      [DAY_MIXED]
    );
    const prevRowHash = day1.rows[0].final_row_hash;
    const prevCheckpointHash = day1.rows[0].checkpoint_hash;

    const row = baseRow(OPP_TAMPER, DAY_TAMPERED);
    await writeDay(
      [{ opportunityId: OPP_TAMPER, data: { ...v2Of(row), predictionSpec: SPEC }, hashVersion: 3 }],
      prevRowHash,
      prevCheckpointHash
    );

    // 先确认这一天本身是好的 —— 否则下面那条断言可能只是因为别的原因失败。
    const before = await harness.services.TrackRecordService.verifyCheckpoint(DAY_TAMPERED);
    assert.strictEqual(before.verified, true, '夹具写的这一天本身就没验过，说明构造有误');

    // 模拟有人把规格改成对自己有利的版本。只追加触发器是第一道防线（应用角色下
    // 的 UPDATE 会被拒），而**哈希覆盖**是第二道：把触发器关掉正是为了单独检验
    // 第二道防线 —— 一个有 ALTER 权限的人、或者一次备份恢复，都能绕过第一道。
    await harness.db.query(`ALTER TABLE verdicts DISABLE TRIGGER trg_verdicts_append_only`);
    const updated = await harness.db.query(
      `UPDATE verdicts SET prediction_spec = $2::jsonb WHERE opportunity_id = $1 AND obs_date = $3::date`,
      [OPP_TAMPER, JSON.stringify({ ...SPEC, criteriaVersion: 'ev-2.0', horizons: [90] }), DAY_TAMPERED]
    );
    await harness.db.query(`ALTER TABLE verdicts ENABLE TRIGGER trg_verdicts_append_only`);
    assert.strictEqual(updated.rowCount, 1, '改写没有生效，这条用例什么也没证明');

    const after = await harness.services.TrackRecordService.verifyCheckpoint(DAY_TAMPERED);
    assert.strictEqual(
      after.verified,
      false,
      '改了预测规格却仍然验过 —— 规格没有真正参与行哈希，"当时按什么判的"就是一句空话'
    );
    // row_hash 列本身没被动过：失败的只可能是"按存储的行复算"。默克尔根是从
    // row_hash 列搭出来的，所以这条断言把"规格参与哈希"与"根被改写"区分开。
    assert.strictEqual(after.storedMerkleRoot, before.storedMerkleRoot);
  });
});
