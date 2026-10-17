import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/** query 意图入库冻结（31 T3.2、ADR-020）：同一个词任何时候重算都得到同一个意图。 */
const harness = makeDisposableDb('emeradar_query_intent_test');

before(async () => {
  await harness.setup();
});
after(async () => {
  await harness.teardown();
});

describe('query 意图', () => {
  it('规则分类是确定性的', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { classifyQueryIntent } = harness.services;
    assert.strictEqual(classifyQueryIntent('invoice generator price'), 'TRANSACTIONAL');
    assert.strictEqual(classifyQueryIntent('how to make an invoice'), 'INFORMATIONAL');
    assert.strictEqual(classifyQueryIntent('invoice generator'), 'COMMERCIAL');
    assert.strictEqual(classifyQueryIntent('acme login'), 'NAVIGATIONAL');
  });

  it('存量行首次读取时补写一次，之后不可改写', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { frozenIntentFor } = harness.services;
    const { query } = harness.db;
    await query(`INSERT INTO queries (id, query_text) VALUES ('qry_intent_1', 'pdf invoice template')`);

    assert.strictEqual(await frozenIntentFor('qry_intent_1', 'pdf invoice template'), 'COMMERCIAL');
    // 之后即使调用方传入的文本会被分成别的意图，读到的仍是冻结值。
    assert.strictEqual(await frozenIntentFor('qry_intent_1', 'how to buy'), 'COMMERCIAL');

    await assert.rejects(
      () => query(`UPDATE queries SET intent = 'INFORMATIONAL' WHERE id = 'qry_intent_1'`),
      /frozen|0A000/
    );
  });
});
