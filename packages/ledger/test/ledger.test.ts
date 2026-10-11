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
  calculateRowHashV1,
  calculateRowHashV2,
  calculateFeaturesHash,
  isV2Row,
  isCompleteV2Row,
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

  describe('buildRowHashInput (the public verification path)', () => {
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
