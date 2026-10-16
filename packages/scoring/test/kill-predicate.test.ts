import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateKillPredicate, parseKillPredicate } from '../src';

describe('evaluateKillPredicate', () => {
  const predicate = { metric: 'weak_result_ratio', op: '<', threshold: 0.2 };

  it('fires when the metric crosses the threshold', () => {
    assert.strictEqual(evaluateKillPredicate(predicate, { weak_result_ratio: 0.1 }), true);
  });

  it('does not fire when the metric is on the safe side', () => {
    assert.strictEqual(evaluateKillPredicate(predicate, { weak_result_ratio: 0.3 }), false);
    assert.strictEqual(evaluateKillPredicate(predicate, { weak_result_ratio: 0.2 }), false);
  });

  it('returns null when the metric has no value today, not false', () => {
    assert.strictEqual(evaluateKillPredicate(predicate, {}), null);
    assert.strictEqual(evaluateKillPredicate(predicate, { weak_result_ratio: null }), null);
  });

  it('returns null for malformed or unknown predicates', () => {
    assert.strictEqual(evaluateKillPredicate({ metric: 'nope', op: '<', threshold: 1 }, { nope: 0 }), null);
    assert.strictEqual(evaluateKillPredicate({ metric: 'd_basis_points', op: 'LIKE', threshold: 1 }, { d_basis_points: 0 }), null);
    assert.strictEqual(evaluateKillPredicate('x', {}), null);
    assert.strictEqual(parseKillPredicate({ metric: 'd_basis_points', op: '<', threshold: '4000' }), null);
  });

  it('evaluates the seeded d_basis_points predicate', () => {
    const decay = { metric: 'd_basis_points', op: '<', threshold: 4000 };
    assert.strictEqual(evaluateKillPredicate(decay, { d_basis_points: 3500 }), true);
    assert.strictEqual(evaluateKillPredicate(decay, { d_basis_points: 7000 }), false);
  });
});
