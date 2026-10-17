import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectRankJump } from '../src/ranking.service';

describe('detectRankJump', () => {
  it('never fires when the project is not ranked today', () => {
    assert.strictEqual(detectRankJump(null, 40, 12), null);
  });

  it('fires on the first ever entry into the ranking', () => {
    assert.deepStrictEqual(detectRankJump(88, null, null), { kind: 'FIRST_ENTRY', tier: 100, rank: 88, previousRank: null });
  });

  it('fires when the project first reaches a better tier than it ever had', () => {
    const jump = detectRankJump(25, 60, 55);
    assert.strictEqual(jump?.kind, 'TIER_ENTRY');
    assert.strictEqual(jump?.tier, 30);
    // Re-entering a tier it already reached is not a TIER_ENTRY; only a big enough move counts.
    assert.strictEqual(detectRankJump(25, 28, 20), null);
    assert.strictEqual(detectRankJump(25, 60, 20)?.kind, 'JUMP');
  });

  it('fires on a jump of at least the threshold within the same tier', () => {
    const jump = detectRankJump(45, 80, 45);
    assert.strictEqual(jump?.kind, 'JUMP');
    assert.strictEqual(detectRankJump(45, 50, 45), null);
  });
});
