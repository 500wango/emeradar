import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledDate } from '../src/tasks';

test('queue retries use the job creation date, never the retry wall clock', () => {
  assert.equal(scheduledDate([], { trigger: 'queue', scheduledAt: new Date('2026-01-31T23:59:00Z') }), '2026-01-31');
});
test('explicit CLI observation date is preserved', () => {
  assert.equal(scheduledDate(['2026-01-02'], { trigger: 'cli' }), '2026-01-02');
});
