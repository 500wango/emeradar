import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  generateDailyLedger,
  MerkleTree,
  GENESIS_PREV_HASH,
  type DailyLedgerRecord,
  type DailyLedgerSummary,
} from '@emeradar/ledger';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 后台"账本完整性"面板说的到底是不是真的。
 *
 * 那块面板原先只读 `ledger_checkpoints.merkle_root`，下面配一行写死的绿字
 * "默克尔树 SHA-256 存证完整" —— 连一个检查点都没有时也亮。那是断言，不是验证：
 * 任何一行被改写、任何一天的行残缺，绿勾照样亮。现在它显示服务端按**库里存的
 * 行**重算出来的结论，下面的用例钉住这个结论确实是重算出来的，而不是把库里的
 * 根原样回显。
 *
 * 用一次性数据库的原因：`ledger_checkpoints` 与 `verdicts` 都是只追加的，夹具
 * 写进去的行永远删不掉。往开发库里塞一个假检查点，会把后台面板指向一个不存在
 * 的观测日。
 *
 * 三个用例**顺序执行且不可换序**：检查点是只追加的，所以"无检查点"只能在任何
 * 检查点写入之前观察，"根对不上"只能在"根正确"之后另起一天观察。
 */

const harness = makeDisposableDb('emeradar_admin_ckp_test');

const OPP_A = 'opp_admin_ckp_a';
const OPP_B = 'opp_admin_ckp_b';
/** 链根正确的一天。 */
const DAY_GOOD = '2026-03-01';
/** 链正确、只有存储的默克尔根被改写的一天。 */
const DAY_TAINTED = '2026-03-02';

function record(opportunityId: string, obsDate: string, dBasisPoints: number): DailyLedgerRecord {
  return {
    opportunityId,
    data: {
      opportunityId,
      obsDate,
      scoringConfigVersion: '1.0',
      verdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      dBasisPoints,
      mBasisPoints: 6000,
      wBasisPoints: 5000,
      confidence: 'HIGH',
      inputSnapshotIds: [],
      citedEvidenceIds: [],
    },
  };
}

/** 造出并写入一天：裁决行 + 检查点。`merkleRoot` 传值即改写存储的根。 */
async function writeDay(
  summary: DailyLedgerSummary,
  hashedRows: ReturnType<typeof generateDailyLedger>['hashedRows'],
  overrides: { merkleRoot?: string; checkpointHash?: string | null } = {}
) {
  const compact = summary.obsDate.replace(/-/g, '');
  for (const row of hashedRows) {
    await harness.db.query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         input_snapshot_ids, cited_evidence_ids, prev_hash, row_hash, hash_version)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)`,
      [
        `vdt_${row.opportunityId}_${compact}`,
        row.opportunityId,
        summary.obsDate,
        row.data.scoringConfigVersion,
        row.data.verdict,
        row.data.lifecycle,
        row.data.dBasisPoints,
        row.data.mBasisPoints,
        row.data.wBasisPoints,
        row.data.confidence,
        row.data.inputSnapshotIds,
        row.data.citedEvidenceIds,
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
      summary.obsDate,
      summary.rowCount,
      overrides.merkleRoot ?? summary.merkleRoot,
      summary.finalRowHash,
      overrides.checkpointHash === undefined ? summary.checkpointHash : overrides.checkpointHash,
    ]
  );
}

/** 独立重算：从库里读回那天各行的 row_hash，自己搭一棵树。 */
async function rootFromStoredRows(obsDate: string): Promise<string> {
  const res = await harness.db.query<{ row_hash: string }>(
    `SELECT row_hash FROM verdicts WHERE obs_date = $1::date ORDER BY opportunity_id COLLATE "C" ASC`,
    [obsDate]
  );
  return new MerkleTree(res.rows.map((r) => r.row_hash)).getRoot();
}

describe('后台账本完整性面板的校验结论', () => {
  before(async () => {
    await harness.setup();
    if (!harness.available) return;
    const { query } = harness.db;
    for (const [id, slug] of [
      [OPP_A, 'admin-ckp-a'],
      [OPP_B, 'admin-ckp-b'],
    ] as const) {
      await query(
        `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
         VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
        [id, slug, slug]
      );
    }
  });

  after(async () => {
    await harness.teardown();
  });

  it('没有检查点时如实说"没有"，而不是报"存证完整"', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const overview = await harness.services.AdminService.getPipelineOverview();
    assert.strictEqual(
      overview.latestCheckpoint,
      null,
      '库里没有任何检查点，却报出了检查点 —— 面板会据此显示一个不存在的存证'
    );
  });

  it('链完好时重算通过，且结论来自库里的行而不是回显存储的根', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const ledger = generateDailyLedger(
      DAY_GOOD,
      [record(OPP_A, DAY_GOOD, 7000), record(OPP_B, DAY_GOOD, 6500)],
      GENESIS_PREV_HASH,
      GENESIS_PREV_HASH
    );
    await writeDay(ledger.summary, ledger.hashedRows);

    const overview = await harness.services.AdminService.getPipelineOverview();
    const ckp = overview.latestCheckpoint;
    assert.ok(ckp, '刚写入的检查点没有被读到');
    assert.ok(ckp.recomputed, '重算没有跑起来 —— 面板只能回落到一句无从证实的断言');

    // 用**从库里读回的行**独立搭树，再与结论比对：这一步才能区分"真的重算了"
    // 与"把 merkle_root 列原样搬过来"。
    assert.strictEqual(
      ckp.recomputed.calculatedMerkleRoot,
      await rootFromStoredRows(DAY_GOOD),
      '重算出的根与库里各行算出的根不一致，说明它不是从存储的行重算的'
    );
    assert.strictEqual(ckp.recomputed.verified, true, '一天完好的账本被判为验不过');
    assert.strictEqual(ckp.recomputed.rowCount, 2);
    assert.strictEqual(ckp.totalRecords, 2, 'totalRecords 与实际行数不符');
  });

  it('存储的根被改写时重算报不一致，并把两个根都交出来', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    // 第二天沿用第一天的链尾与检查点哈希，因此 prev_hash 链本身是好的；
    // checkpoint_hash 置空使该子项恒为通过 —— 于是 verified 只可能因为
    // **存储的默克尔根对不上**而为假。这就是"一行被改写会被抓住"的等价物。
    const ledger = generateDailyLedger(
      DAY_TAINTED,
      [record(OPP_A, DAY_TAINTED, 7000), record(OPP_B, DAY_TAINTED, 6500)],
      GENESIS_PREV_HASH,
      GENESIS_PREV_HASH
    );
    const taintedRoot = 'f'.repeat(64);
    await writeDay(ledger.summary, ledger.hashedRows, {
      merkleRoot: taintedRoot,
      checkpointHash: null,
    });

    const overview = await harness.services.AdminService.getPipelineOverview();
    const ckp = overview.latestCheckpoint;
    assert.ok(ckp?.recomputed, '重算没有跑起来');

    assert.strictEqual(ckp.merkleRoot, taintedRoot, '存储的根不是夹具写入的那个');
    assert.notStrictEqual(
      ckp.recomputed.calculatedMerkleRoot,
      ckp.merkleRoot,
      '重算结果等于存储的根 —— 面板在回显，没有校验'
    );
    assert.strictEqual(
      ckp.recomputed.calculatedMerkleRoot,
      await rootFromStoredRows(DAY_TAINTED),
      '重算出的根与库里各行算出的根不一致'
    );
    assert.strictEqual(
      ckp.recomputed.verified,
      false,
      '默克尔根被改写却报"验证通过" —— 这正是这块面板原先的样子'
    );
  });
});
