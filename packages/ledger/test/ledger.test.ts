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
