import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { PgBoss } from 'pg-boss';
import { closePool } from '@emeradar/db';
import { TASKS } from '../src/tasks';
import * as queue from '../src/queue';

// Run only against a disposable database, never the application's default DB.
assert.match(process.env.DATABASE_URL || '', /\/emeradar_worker_test_[a-z0-9_]+(?:\?|$)/);
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schedule: false, supervise: false });
after(async () => { await boss.stop(); await closePool(); });

test('redeployment reconciles persisted queue defaults without rewriting existing jobs', async () => {
  await boss.start();
  await boss.createQueue('emeradar-dead-letter', {
    policy: 'standard', retryLimit: 7, retentionSeconds: 60, deleteAfterSeconds: 60,
  });
  const task = TASKS.find(t => t.command === 'run-daily')!;
  await boss.createQueue(task.command, {
    policy: 'singleton', retryLimit: 9, retryDelay: 1, retryBackoff: false,
    expireInSeconds: 60, notify: false,
  });
  // Reset mutable defaults explicitly: createQueue is a no-op on repeat runs.
  await boss.updateQueue(task.command, { retryLimit: 9, retryDelay: 1, retryBackoff: false, expireInSeconds: 60, notify: false, deadLetter: null });
  await boss.updateQueue('emeradar-dead-letter', { retryLimit: 7, retentionSeconds: 60, deleteAfterSeconds: 60 });
  const oldId = await boss.send(task.command);
  // Namespace lookup lets the pre-fix code fail as an assertion, not an import error.
  assert.equal(typeof queue.configureQueues, 'function', 'startup must reconcile existing queues');
  await queue.configureQueues(boss, [task]);
  await queue.configureQueues(boss, [task]);
  const actual = await boss.getQueue(task.command);
  assert.equal(actual?.policy, 'singleton');
  assert.equal(actual?.retryLimit, task.retryLimit);
  assert.equal(actual?.retryDelay, task.retryDelaySeconds);
  assert.equal(actual?.retryBackoff, true);
  assert.equal(actual?.expireInSeconds, task.expireInSeconds);
  assert.equal(actual?.deadLetter, 'emeradar-dead-letter');
  assert.equal(actual?.notify, true);
  const dlq = await boss.getQueue('emeradar-dead-letter');
  assert.equal(dlq?.retryLimit, 0);
  assert.equal(dlq?.retentionSeconds, 90 * 24 * 3600);
  assert.equal(dlq?.deleteAfterSeconds, 90 * 24 * 3600);
  const newId = await boss.send(task.command);
  assert.equal((await boss.getJobById(task.command, oldId!))?.retryLimit, 9);
  assert.equal((await boss.getJobById(task.command, newId!))?.retryLimit, task.retryLimit);
});
