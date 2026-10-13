import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closePool, query } from '@emeradar/db';
import { randomUUID } from 'node:crypto';
import * as queue from '../src/queue';
import { TASKS } from '../src/tasks';

assert.match(process.env.DATABASE_URL || '', /\/emeradar_worker_test_[a-z0-9_]+(?:\?|$)/);
after(closePool);

test('a completed job replay skips handler side effects but a failed job can retry', async () => {
  assert.equal(typeof queue.execute, 'function', 'queue execution must be testable with synthetic handlers');
  const id = randomUUID();
  let effects = 0;
  const task = { ...TASKS[0], command: 'test-idempotent', alertAfterFailures: 99, async run() { effects++; } };
  await queue.execute(task, id, 0, new Date('2026-01-01T23:59:00Z'));
  await queue.execute(task, id, 1, new Date('2026-01-01T23:59:00Z'));
  assert.equal(effects, 1, 'acknowledgement loss must not repeat a completed handler');
  const rows = await query(`SELECT id FROM audit_log WHERE action = 'job.succeeded' AND payload->>'jobId' = $1`, [id]);
  assert.equal(rows.rowCount, 1);
  const failedId = randomUUID();
  let attempts = 0;
  const retry = { ...task, async run() { if (++attempts === 1) throw new Error('synthetic transient'); } };
  await assert.rejects(queue.execute(retry, failedId, 0, new Date()), /synthetic transient/);
  await queue.execute(retry, failedId, 1, new Date());
  assert.equal(attempts, 2);
});
