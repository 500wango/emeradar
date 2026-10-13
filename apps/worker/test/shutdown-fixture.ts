// Container-only fixture: replace every task before loading the real resident CLI.
import assert from 'node:assert/strict';
import { TASKS } from '../src/tasks';
assert.match(process.env.DATABASE_URL || '', /\/emeradar_worker_test_[a-z0-9_]+$/);
const mode = process.env.SHUTDOWN_MODE;
assert.ok(mode === 'timeout' || mode === 'drain');
TASKS.splice(0, TASKS.length, {
  ...TASKS[0], command: 'test-container-shutdown', cron: null,
  async run() {
    console.log('SYNTHETIC_STARTED');
    await new Promise(resolve => setTimeout(resolve, mode === 'timeout' ? 180_000 : 3_000));
    console.log('SYNTHETIC_FINISHED');
  },
});
void import('../src/cli');
