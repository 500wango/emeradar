import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 采集重试与熔断（04 §4）。
 *
 * 失败判定看 collector 的 outcome，不看异常；重试只对 `retryable` 生效。
 * 熔断按 5 分钟窗口的失败率计算，状态落库以便多进程共享。
 */
const harness = makeDisposableDb('emeradar_collector_run_test');
const SOURCE = 'src_serp';

before(async () => {
  await harness.setup();
  if (!harness.available) return;
});

after(async () => {
  await harness.teardown();
});

describe('collector run：重试与熔断', () => {
  it('retryable 失败按 3 次退避重试，最终成功只留一条 SUCCESS 运行', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { runCollector } = harness.services;
    let calls = 0;
    const outcome = await runCollector(
      SOURCE,
      'q_retry',
      async () => {
        calls++;
        if (calls < 3) {
          return { status: 'FAILED' as const, retryable: true, errorCode: 'TEMP', message: 'temporary' };
        }
        return { status: 'OK' as const, snapshots: [{}] };
      },
      { attempts: 3, retryBaseMs: 0 }
    );
    assert.strictEqual(outcome.status, 'OK');
    assert.strictEqual(calls, 3);

    const run = await harness.db.query<{ status: string; items_collected: number }>(
      `SELECT status, items_collected FROM collector_runs WHERE source_id=$1 ORDER BY started_at DESC LIMIT 1`,
      [SOURCE]
    );
    assert.strictEqual(run.rows[0].status, 'SUCCESS');
    assert.strictEqual(run.rows[0].items_collected, 1);
  });

  it('5 分钟窗口失败率 >50% 时打开熔断，后续调用不再触发采集', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { runCollector } = harness.services;
    // 20 条失败（阈值边界），下一条失败把比例推过 50%。
    for (let i = 0; i < 20; i++) {
      await harness.db.query(
        `INSERT INTO collector_runs (id, source_id, status, started_at, finished_at)
         VALUES ($1, $2, 'FAILED', NOW(), NOW())`,
        [`run_seed_${i}`, SOURCE]
      );
    }

    let called = 0;
    const first = await runCollector(
      SOURCE,
      'q_open',
      async () => {
        called++;
        return { status: 'FAILED' as const, retryable: false, errorCode: 'DOWN', message: 'down' };
      },
      { attempts: 1, retryBaseMs: 0 }
    );
    assert.strictEqual(first.status, 'FAILED');
    assert.strictEqual(called, 1);

    const circuit = await harness.db.query<{ open_until: Date | null }>(
      `SELECT open_until FROM source_circuit_breakers WHERE source_id=$1`,
      [SOURCE]
    );
    assert.ok(circuit.rows[0]?.open_until, '熔断没有被打开');

    const second = await runCollector(
      SOURCE,
      'q_open_2',
      async () => {
        called++;
        return { status: 'OK' as const, snapshots: [{}] };
      },
      { attempts: 1, retryBaseMs: 0 }
    );
    assert.strictEqual(second.status, 'FAILED');
    assert.strictEqual((second as any).errorCode, 'CIRCUIT_OPEN');
    assert.strictEqual(called, 1, '熔断期间仍然调用了采集器');
  });

  it('半开探测成功会关闭已到期的熔断', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { runCollector } = harness.services;
    await harness.db.query(
      `UPDATE source_circuit_breakers SET open_until = NOW() - INTERVAL '1 minute' WHERE source_id=$1`,
      [SOURCE]
    );
    const outcome = await runCollector(
      SOURCE,
      'q_half_open',
      async () => ({ status: 'OK' as const, snapshots: [{}] }),
      { attempts: 1, retryBaseMs: 0 }
    );
    assert.strictEqual(outcome.status, 'OK');
    const circuit = await harness.db.query<{ open_until: Date | null }>(
      `SELECT open_until FROM source_circuit_breakers WHERE source_id=$1`,
      [SOURCE]
    );
    assert.strictEqual(circuit.rows[0]?.open_until, null, '半开成功后熔断没有关闭');
  });
});
