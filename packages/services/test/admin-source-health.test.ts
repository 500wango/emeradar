import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Admin 源健康视图（04 §4「失败可见性」）。
 *
 * 列表页不能只显示“已激活/已暂停”；同一条源最近一次运行、24h 失败率、熔断状态
 * 才是运维需要的答案。
 */
const harness = makeDisposableDb('emeradar_admin_source_health_test');
const SOURCE = 'src_serp';

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(
    `INSERT INTO collector_runs (id, source_id, status, items_collected, error_message, started_at, finished_at)
     VALUES
       ('run_h1', $1, 'SUCCESS', 10, NULL, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours'),
       ('run_h2', $1, 'SUCCESS', 10, NULL, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),
       ('run_h3', $1, 'SUCCESS', 10, NULL, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'),
       ('run_h4', $1, 'FAILED', 0, 'AISA_SEARCH_ERROR: upstream 503', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes'),
       ('run_old', $1, 'FAILED', 0, 'old failure', NOW() - INTERVAL '30 hours', NOW() - INTERVAL '30 hours')`,
    [SOURCE]
  );
  await query(
    `INSERT INTO source_circuit_breakers (source_id, open_until, opened_at)
     VALUES ($1, NOW() + INTERVAL '10 minutes', NOW())`,
    [SOURCE]
  );
});

after(async () => {
  await harness.teardown();
});

describe('Admin 源健康视图', () => {
  it('返回最近一次运行、24h 失败计数/失败率、最近成功与熔断状态', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const sources = await harness.services.AdminService.listSources();
    const source = sources.find((s) => s.id === SOURCE);
    assert.ok(source, 'canonical src_serp 不在列表中');

    assert.strictEqual(source.health.runs24h, 4);
    assert.strictEqual(source.health.failures24h, 1);
    assert.strictEqual(source.health.failureRate24h, 0.25);
    assert.strictEqual(source.health.lastStatus, 'FAILED');
    assert.match(source.health.lastError ?? '', /upstream 503/);
    assert.strictEqual(source.health.circuitOpen, true);
    assert.ok(source.health.circuitOpenUntil);
    assert.ok(source.health.lastSuccessAt);
  });
});
