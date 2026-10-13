import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PgBoss } from 'pg-boss';
import { AuditService } from '@emeradar/services';
import { TASKS } from '../src/tasks';
import { configureQueues, startScheduler } from '../src/queue';

assert.match(process.env.DATABASE_URL || '', /\/emeradar_worker_test_[a-z0-9_]+(?:\?|$)/);

function health(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--filter', '@emeradar/worker', 'health'], { env: process.env, stdio: 'pipe' });
    child.stdout.on('data', d => process.stdout.write(d));
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('error', reject);
    child.on('exit', resolve);
  });
}

test('immutable queue mismatch fails without deleting jobs', async () => {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schedule: false, supervise: false });
  await boss.start();
  try {
    await boss.createQueue('test-policy-mismatch', { policy: 'standard' });
    const id = await boss.send('test-policy-mismatch');
    await assert.rejects(configureQueues(boss, [{ ...TASKS[0], command: 'test-policy-mismatch' }]), /immutable/);
    assert.ok(await boss.getJobById('test-policy-mismatch', id!));
  } finally { await boss.stop(); }
});

test('real scheduler drains synthetic work; exact Compose health command passes up and fails down', async (t) => {
  // Do not execute any production task or install production cron schedules.
  const saved = TASKS.splice(0);
  let begin!: () => void;
  const started = new Promise<void>(r => { begin = r; });
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let finished = false;
  TASKS.push({ ...saved[0], command: 'test-runtime-drain', cron: null, async run() {
    begin(); await gate; finished = true;
  } });
  t.mock.method(AuditService, 'log', async () => {});
  const scheduler = await startScheduler();
  try {
    assert.equal(await health(), 0);
    await scheduler.boss.send('test-runtime-drain');
    await Promise.race([started, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('synthetic job never started')), 10000);
      timer.unref();
    })]);
    let stopped = false;
    const stop = scheduler.stop().then(() => { stopped = true; });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(stopped, false, 'stop must wait for active handler');
    release();
    await stop;
    assert.equal(finished, true);
    assert.equal(await health(), 1);
    const source = readFileSync(new URL('../src/queue.ts', import.meta.url), 'utf8');
    const compose = readFileSync(new URL('../../../docker-compose.prod.yml', import.meta.url), 'utf8');
    assert.match(source, /timeout: 120_000/);
    assert.match(compose, /stop_grace_period: 150s/);
  } finally {
    release();
    await scheduler.boss.stop();
    TASKS.splice(0, TASKS.length, ...saved);
  }
});
