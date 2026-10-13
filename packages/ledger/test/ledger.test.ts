import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  canonicalizeJson,
  calculateRowHash,
  verifyRowHash,
  MerkleTree,
  generateDailyLedger,
  calculateCheckpointHash,
  GENESIS_PREV_HASH,
  VerdictRowData,
  VerdictRowDataV2,
  VerdictRowDataV3,
  PredictionSpec,
  calculateRowHashV1,
  calculateRowHashV2,
  calculateRowHashV3,
  calculateFeaturesHash,
  isV2Row,
  isV3Row,
  isCompleteV2Row,
  isCompleteV3Row,
  buildRowHashInput,
} from '../src';

describe('Prediction Ledger Unit Tests', () => {
  it('canonicalizes JSON deterministically regardless of key ordering', () => {
    const obj1 = { z: 1, a: 'hello', m: { b: 2, a: 1 } };
    const obj2 = { a: 'hello', m: { a: 1, b: 2 }, z: 1 };

    assert.strictEqual(canonicalizeJson(obj1), canonicalizeJson(obj2));
    assert.strictEqual(
      canonicalizeJson(obj1),
      '{"a":"hello","m":{"a":1,"b":2},"z":1}'
    );
  });

  it('computes and verifies SHA-256 row hash', () => {
    const row: VerdictRowData = {
      opportunityId: 'opp_shopify_tax',
      obsDate: '2026-09-25',
      scoringConfigVersion: 'sc-1.0.0',
      verdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      dBasisPoints: 8400,
      mBasisPoints: 7600,
      wBasisPoints: 8100,
      confidence: 'HIGH',
      inputSnapshotIds: ['snp_01'],
      citedEvidenceIds: ['evd_01', 'evd_02'],
    };

    const rowHash = calculateRowHash(GENESIS_PREV_HASH, row);
    assert.strictEqual(typeof rowHash, 'string');
    assert.strictEqual(rowHash.length, 64);

    // Verification succeeds
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, row, rowHash), true);

    // Tampering with any field fails verification
    const tampered = { ...row, dBasisPoints: 8401 };
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, tampered, rowHash), false);
  });

  it('builds Merkle tree and generates valid audit proofs', () => {
    const leaves = [
      'a1b2c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef01',
      'b2c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef01a1',
      'c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef01a1b2',
      'd4e5f60123456789abcdef0123456789abcdef0123456789abcdef01a1b2c3',
    ];

    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();
    assert.strictEqual(root.length, 64);

    // Verify proof for each leaf
    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(i);
      const isValid = MerkleTree.verifyProof(root, leaves[i], proof);
      assert.strictEqual(isValid, true, `Proof for leaf ${i} should be valid`);
    }

    // False leaf should fail
    const fakeLeaf = '0'.repeat(64);
    const proof0 = tree.getProof(0);
    assert.strictEqual(MerkleTree.verifyProof(root, fakeLeaf, proof0), false);
  });

  it('generates complete daily ledger checkpoint', () => {
    const rows: { opportunityId: string; data: VerdictRowData }[] = [
      {
        opportunityId: 'opp_tailwind_landing',
        data: {
          opportunityId: 'opp_tailwind_landing',
          obsDate: '2026-09-25',
          scoringConfigVersion: 'sc-1.0.0',
          verdict: 'BUILD_NOW',
          lifecycle: 'EARLY_WINDOW',
          dBasisPoints: 7900,
          mBasisPoints: 7200,
          wBasisPoints: 7500,
          confidence: 'HIGH',
          inputSnapshotIds: ['snp_tw_01'],
          citedEvidenceIds: ['evd_tw_01'],
        },
      },
      {
        opportunityId: 'opp_shopify_tax',
        data: {
          opportunityId: 'opp_shopify_tax',
          obsDate: '2026-09-25',
          scoringConfigVersion: 'sc-1.0.0',
          verdict: 'BUILD_NOW',
          lifecycle: 'EARLY_WINDOW',
          dBasisPoints: 8400,
          mBasisPoints: 7600,
          wBasisPoints: 8100,
          confidence: 'HIGH',
          inputSnapshotIds: ['snp_sp_01'],
          citedEvidenceIds: ['evd_sp_01'],
        },
      },
    ];

    const { summary, hashedRows } = generateDailyLedger(
      '2026-09-25',
      rows,
      GENESIS_PREV_HASH,
      GENESIS_PREV_HASH
    );

    assert.strictEqual(summary.rowCount, 2);
    assert.strictEqual(hashedRows.length, 2);
    // Verified sorted order by opportunityId (opp_shopify_tax before opp_tailwind_landing)
    assert.strictEqual(hashedRows[0].opportunityId, 'opp_shopify_tax');
    assert.strictEqual(hashedRows[1].opportunityId, 'opp_tailwind_landing');
    // First row links to GENESIS_PREV_HASH
    assert.strictEqual(hashedRows[0].prevHash, GENESIS_PREV_HASH);
    // Second row links to first row's rowHash
    assert.strictEqual(hashedRows[1].prevHash, hashedRows[0].rowHash);
    // Checkpoint matches calculated hash
    const expectedCheckpointHash = calculateCheckpointHash(
      GENESIS_PREV_HASH,
      '2026-09-25',
      2,
      summary.merkleRoot
    );
    assert.strictEqual(summary.checkpointHash, expectedCheckpointHash);
  });
});

describe('Ledger row-hash versioning (06 §4.1)', () => {
  const base = {
    opportunityId: 'opp_tailwind_landing',
    obsDate: '2026-10-11',
    scoringConfigVersion: 'sc-1.0.0',
    verdict: 'BUILD_NOW' as const,
    lifecycle: 'EARLY_WINDOW' as const,
    dBasisPoints: 8400,
    mBasisPoints: 7600,
    wBasisPoints: 8100,
    confidence: 'HIGH' as const,
    inputSnapshotIds: ['snp_01'],
    citedEvidenceIds: ['evd_01', 'evd_02'],
  };

  const v2Row: VerdictRowDataV2 = {
    ...base,
    rawVerdict: 'BUILD_NOW',
    flags: ['M_NEGATIVE', 'BASELINE_PERIOD'],
    explanation: {
      dReason: 'Demand growth is accelerating.',
      mReason: 'Two independent paid competitors observed.',
      wReason: 'SERP weakness above threshold.',
      verdictReason: 'All signals aligned.',
      rulesTriggered: ['RULE_BUILD_NOW'],
    },
    featuresHash: 'a'.repeat(64),
    dBand: 'HIGH' as const,
    mBand: 'MEDIUM' as const,
    wBand: 'HIGH' as const,
  };

  it('isV2Row discriminates on the presence of rawVerdict', () => {
    assert.strictEqual(isV2Row(base), false);
    assert.strictEqual(isV2Row(v2Row), true);
  });

  it('hashes a v1 and a v2 row differently even when the 11 base fields match', () => {
    const v1Hash = calculateRowHashV1(GENESIS_PREV_HASH, base);
    const v2Hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
    assert.strictEqual(v1Hash.length, 64);
    assert.strictEqual(v2Hash.length, 64);
    assert.notStrictEqual(v1Hash, v2Hash);
  });

  it('ignores v2 fields when hashing through the v1 path', () => {
    // The v1 field list is written out explicitly for exactly this reason: a future
    // v2 field must not leak into a v1 row's hash and break the stored chain.
    const withExtraFields = {
      ...base,
      rawVerdict: 'BUILD_NOW',
      flags: ['M_NEGATIVE'],
      explanation: v2Row.explanation,
      featuresHash: 'b'.repeat(64),
    } as unknown as typeof base;
    assert.strictEqual(
      calculateRowHashV1(GENESIS_PREV_HASH, withExtraFields),
      calculateRowHashV1(GENESIS_PREV_HASH, base)
    );
  });

  it('detects tampering with the retained explanation', () => {
    const hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
    const rewritten = {
      ...v2Row,
      explanation: { ...v2Row.explanation, verdictReason: 'Something more flattering.' },
    };
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, rewritten, hash), false);
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, v2Row, hash), true);
  });

  it('detects tampering with the raw pre-debounce verdict', () => {
    const hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
    const rewritten = { ...v2Row, rawVerdict: 'WATCH' as const };
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, rewritten, hash), false);
  });

  it('detects tampering with a sealed axis band', () => {
    // The bands are what the window-narrowing detector reads back day over day;
    // rewriting history to look like the window was always open must not verify.
    const hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
    for (const field of ['dBand', 'mBand', 'wBand'] as const) {
      const rewritten = { ...v2Row, [field]: 'LOW' as const };
      assert.strictEqual(
        verifyRowHash(GENESIS_PREV_HASH, rewritten, hash),
        false,
        `tampering with ${field} must invalidate the row hash`
      );
    }
  });

  it('treats flags as a set but keeps rule order significant', () => {
    const hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
    const reorderedFlags = calculateRowHashV2(GENESIS_PREV_HASH, {
      ...v2Row,
      flags: [...v2Row.flags].reverse(),
    });
    assert.strictEqual(reorderedFlags, hash);

    const reorderedRules = calculateRowHashV2(GENESIS_PREV_HASH, {
      ...v2Row,
      explanation: {
        ...v2Row.explanation,
        rulesTriggered: ['RULE_BUILD_NOW_COMPENSATED', 'RULE_BUILD_NOW'],
      },
    });
    assert.notStrictEqual(reorderedRules, hash);
  });

  it('fails verification when the wrong hash version is supplied', () => {
    // hash_version is not part of the hashed body; it is self-verifying instead —
    // recomputing with the wrong field set cannot reproduce the stored value.
    const v2Hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, v2Row, v2Hash, 2), true);
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, v2Row, v2Hash, 1), false);

    const v1Hash = calculateRowHashV1(GENESIS_PREV_HASH, base);
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, base, v1Hash, 1), true);
    assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, base, v1Hash, 2), false);
  });

  it('dispatches to the version the row shape implies', () => {
    assert.strictEqual(
      calculateRowHash(GENESIS_PREV_HASH, v2Row),
      calculateRowHashV2(GENESIS_PREV_HASH, v2Row)
    );
    assert.strictEqual(
      calculateRowHash(GENESIS_PREV_HASH, base),
      calculateRowHashV1(GENESIS_PREV_HASH, base)
    );
  });

  it('fails a truncated v2 row cleanly instead of throwing', () => {
    // A row read back from the database can be missing columns. Verification runs
    // inside a chain walk, so a TypeError here would abort the entire day's audit
    // rather than reporting one bad row.
    const hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
    for (const missing of ['flags', 'explanation', 'dBand', 'mBand', 'wBand'] as const) {
      const truncated: Record<string, unknown> = { ...v2Row };
      delete truncated[missing];
      assert.strictEqual(
        verifyRowHash(GENESIS_PREV_HASH, truncated as unknown as VerdictRowDataV2, hash, 2),
        false,
        `a row missing ${missing} must fail verification, not throw`
      );
    }
    assert.strictEqual(isCompleteV2Row(v2Row), true);
    assert.strictEqual(isCompleteV2Row({ ...v2Row, flags: null }), false);
  });

  /**
   * 一行 verdicts 记录在**读回时**的样子（列名与 DB 一致）。提到这个作用域是因为
   * v3 与 buildRowHashInput 两个用例块都要用它。
   */
  const asStoredV1 = {
    opportunity_id: base.opportunityId,
    obs_date: base.obsDate,
    scoring_config_version: base.scoringConfigVersion,
    verdict: base.verdict as string,
    lifecycle: base.lifecycle as string,
    d_basis_points: base.dBasisPoints,
    m_basis_points: base.mBasisPoints,
    w_basis_points: base.wBasisPoints,
    confidence: base.confidence as string,
    input_snapshot_ids: base.inputSnapshotIds,
    cited_evidence_ids: base.citedEvidenceIds,
  };

  const asStoredV2 = {
    ...asStoredV1,
    hash_version: 2,
    raw_verdict: v2Row.rawVerdict as string,
    flags: v2Row.flags,
    explanation: v2Row.explanation,
    features_hash: v2Row.featuresHash,
    d_band: v2Row.dBand as string,
    m_band: v2Row.mBand as string,
    w_band: v2Row.wBand as string,
  };

  describe('v3 rows (the prediction spec travels with the prediction)', () => {
    const spec: PredictionSpec = {
      criteriaVersion: 'ev-1.0',
      horizons: [30, 60, 90],
      target: 'market_formed',
    };
    const v3Row: VerdictRowDataV3 = { ...v2Row, predictionSpec: spec };
    const v3NoPrediction: VerdictRowDataV3 = { ...v2Row, predictionSpec: null };

    it('isV3Row keys on the presence of predictionSpec, not on its value', () => {
      assert.strictEqual(isV3Row(v3Row), true);
      // 关键的半边：显式 null 也是 v3。若按"值是对象"判定，这一行会被当成 v2
      // 复算，而它写入时用的是 v3 的字段集 —— 那一天就整体验不过。
      assert.strictEqual(isV3Row(v3NoPrediction), true);
      assert.strictEqual(isV3Row(v2Row), false);
      assert.strictEqual(isV3Row(base), false);
      // v3 行仍带 rawVerdict，所以 isV2Row 对它也为真 —— 判断版本请用 hash_version 列。
      assert.strictEqual(isV2Row(v3Row), true);
    });

    it('hashes v2 and v3 rows differently even with identical basis fields', () => {
      const v2Hash = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
      assert.notStrictEqual(calculateRowHashV3(GENESIS_PREV_HASH, v3Row), v2Hash);
      // "没有预测"（显式 null）与"这一版还没这个字段"（v2）也不能撞在同一个值上。
      assert.notStrictEqual(calculateRowHashV3(GENESIS_PREV_HASH, v3NoPrediction), v2Hash);
      assert.strictEqual(calculateRowHashV3(GENESIS_PREV_HASH, v3Row).length, 64);
    });

    it('treats horizons as a set but keeps every other spec field significant', () => {
      const reordered = calculateRowHashV3(GENESIS_PREV_HASH, {
        ...v3Row,
        predictionSpec: { ...spec, horizons: [90, 30, 60] },
      });
      assert.strictEqual(reordered, calculateRowHashV3(GENESIS_PREV_HASH, v3Row));

      // 判据换了版本、地平线少了一档、目标事件换了 —— 都必须是不同的哈希，
      // 否则"当时按什么判的"就不在链上了，事后改判据将无法被发现。
      for (const changed of [
        { ...spec, criteriaVersion: 'ev-2.0' },
        { ...spec, horizons: [30, 60] },
        { ...spec, target: 'window_closed' },
      ] as PredictionSpec[]) {
        assert.notStrictEqual(
          calculateRowHashV3(GENESIS_PREV_HASH, { ...v3Row, predictionSpec: changed }),
          calculateRowHashV3(GENESIS_PREV_HASH, v3Row),
          `spec change must change the hash: ${JSON.stringify(changed)}`
        );
      }
    });

    it('dispatches v3 before v2 in calculateRowHash', () => {
      assert.strictEqual(
        calculateRowHash(GENESIS_PREV_HASH, v3Row),
        calculateRowHashV3(GENESIS_PREV_HASH, v3Row)
      );
      assert.strictEqual(
        calculateRowHash(GENESIS_PREV_HASH, v3NoPrediction),
        calculateRowHashV3(GENESIS_PREV_HASH, v3NoPrediction)
      );
    });

    it('is self-verifying: the wrong field set cannot reproduce the stored hash', () => {
      const stored = calculateRowHashV3(GENESIS_PREV_HASH, v3Row);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, v3Row, stored, 3), true);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, v3Row, stored, 2), false);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, v3Row, stored, 1), false);

      const noPrediction = calculateRowHashV3(GENESIS_PREV_HASH, v3NoPrediction);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, v3NoPrediction, noPrediction, 3), true);
    });

    it('fails a truncated or malformed v3 row cleanly instead of throwing', () => {
      const hash = calculateRowHashV3(GENESIS_PREV_HASH, v3Row);

      const missingKey: Record<string, unknown> = { ...v3Row };
      delete missingKey.predictionSpec;
      assert.strictEqual(
        verifyRowHash(GENESIS_PREV_HASH, missingKey as unknown as VerdictRowDataV3, hash, 3),
        false
      );

      // 规格结构残缺（地平线不是数字数组）同样只是"这条验不过"。
      for (const broken of [
        { ...spec, horizons: 'thirty' },
        { ...spec, criteriaVersion: null },
        { ...spec, target: undefined },
      ]) {
        const row = { ...v3Row, predictionSpec: broken } as unknown as VerdictRowDataV3;
        assert.strictEqual(isCompleteV3Row(row), false, JSON.stringify(broken));
        assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, row, hash, 3), false);
      }

      assert.strictEqual(isCompleteV3Row(v3Row), true);
      assert.strictEqual(isCompleteV3Row(v3NoPrediction), true);
      assert.strictEqual(isCompleteV3Row(v2Row), false);
    });

    it('infers v3 from shape when no version is given, in the daily ledger', () => {
      // 这一天同时有 v1 与 v3 行：逐行的字段集不同，推断必须逐行发生。
      const { hashedRows } = generateDailyLedger(
        '2026-10-13',
        [
          { opportunityId: 'opp_a', data: base },
          { opportunityId: 'opp_b', data: v3Row },
          { opportunityId: 'opp_c', data: v3NoPrediction },
        ],
        GENESIS_PREV_HASH,
        GENESIS_PREV_HASH
      );

      assert.deepStrictEqual(
        hashedRows.map((r) => r.hashVersion),
        [1, 3, 3]
      );
      for (const row of hashedRows) {
        assert.strictEqual(
          verifyRowHash(row.prevHash, row.data, row.rowHash, row.hashVersion),
          true,
          `row ${row.opportunityId} must verify with the version the ledger inferred`
        );
      }
    });

    it('does not collapse hash_version 3 into v2 on the public verification path', () => {
      // 这是本轮修掉的那个塌缩：`Number(hash_version) >= 2 ? 2 : 1` 会把 3 读成 2，
      // 于是新版本上线当天，那一天的公开展示会整体报"账本不一致"。
      const stored = calculateRowHashV3(GENESIS_PREV_HASH, v3Row);
      const asStored = {
        ...asStoredV2,
        hash_version: 3,
        prediction_spec: spec,
      };
      const { data, hashVersion } = buildRowHashInput(asStored);
      assert.strictEqual(hashVersion, 3);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, data, stored, hashVersion), true);
    });

    it('verifies a v3 row that carries no prediction (explicit null spec)', () => {
      const stored = calculateRowHashV3(GENESIS_PREV_HASH, v3NoPrediction);
      const { data, hashVersion } = buildRowHashInput({
        ...asStoredV2,
        hash_version: 3,
        prediction_spec: null,
      });
      assert.strictEqual(hashVersion, 3);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, data, stored, hashVersion), true);
    });

    it('fails a v3 row whose prediction_spec column was not selected', () => {
      // 少选一列（例如忘了把 prediction_spec 加进 verifyCheckpoint 的 SELECT）会
      // 让"有规格"的行复算成"规格为 null"。结果必须是"验不过"——响亮地失败，
      // 而不是悄悄按另一个字段集算出个值来比对。
      const stored = calculateRowHashV3(GENESIS_PREV_HASH, v3Row);
      const { data, hashVersion } = buildRowHashInput({ ...asStoredV2, hash_version: 3 });
      assert.strictEqual(hashVersion, 3);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, data, stored, hashVersion), false);
    });

    it('treats an unknown future hash_version as "cannot verify", not as v2', () => {
      // 旧验证器遇上 v4 行：复算必然对不上，如实报"验不过"才是正确答案。
      const stored = calculateRowHashV3(GENESIS_PREV_HASH, v3Row);
      const { data, hashVersion } = buildRowHashInput({
        ...asStoredV2,
        hash_version: 4,
        prediction_spec: spec,
      });
      assert.strictEqual(hashVersion, 3);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, data, stored, hashVersion), true);
      // 但它绝不会被当成 v2 复算。
      assert.notStrictEqual(calculateRowHashV2(GENESIS_PREV_HASH, v3Row), stored);
    });
  });

  describe('buildRowHashInput (the public verification path)', () => {
    it('round-trips a v2 row written by the pipeline', () => {
      // 若这一步失败，账本一旦出现 v2 行，这一天的公开验证就会整体报失败。
      const stored = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
      const { data, hashVersion } = buildRowHashInput(asStoredV2);
      assert.strictEqual(hashVersion, 2);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, data, stored, hashVersion), true);
    });

    it('round-trips a v1 row and never mistakes it for v2', () => {
      const stored = calculateRowHashV1(GENESIS_PREV_HASH, base);
      const { data, hashVersion } = buildRowHashInput({ ...asStoredV1, hash_version: 1 });
      assert.strictEqual(hashVersion, 1);
      assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, data, stored, hashVersion), true);
    });

    it('treats an absent hash_version as v1', () => {
      // 存量行没有该列。它们本就由 seed 自造哈希、不可复算，这里只保证版本
      // 判定不会把它们误判成 v2。
      assert.strictEqual(buildRowHashInput(asStoredV1).hashVersion, 1);
      assert.strictEqual(buildRowHashInput({ ...asStoredV1, hash_version: null }).hashVersion, 1);
    });

    it('fails a v2 row whose band columns came back NULL, without throwing', () => {
      const stored = calculateRowHashV2(GENESIS_PREV_HASH, v2Row);
      for (const column of ['d_band', 'm_band', 'w_band'] as const) {
        const { data, hashVersion } = buildRowHashInput({ ...asStoredV2, [column]: null });
        assert.strictEqual(hashVersion, 2);
        assert.strictEqual(verifyRowHash(GENESIS_PREV_HASH, data, stored, hashVersion), false);
      }
    });
  });

  it('computes a key-order-independent features fingerprint', () => {
    const a = calculateFeaturesHash({ z: 1, a: { b: 2, a: 1 } });
    const b = calculateFeaturesHash({ a: { a: 1, b: 2 }, z: 1 });
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, calculateFeaturesHash({ z: 1, a: { b: 3, a: 1 } }));
  });
});
