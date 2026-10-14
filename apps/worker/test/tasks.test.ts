import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closePool, query } from '@emeradar/db';
import { ProjectService } from '@emeradar/services';
import { findTask } from '../src/tasks';

assert.match(process.env.DATABASE_URL || '', /\/emeradar_worker_test_[a-z0-9_]+(?:\?|$)/);
after(async () => { await closePool(); });

test('GSC sync reports failed projects to the queue rather than completing successfully', async () => {
  await query(`INSERT INTO users (id, email) VALUES ('test_owner', 'worker-test@emeradar.test') ON CONFLICT DO NOTHING`);
  await query(`INSERT INTO projects (id, user_id, project_kind, title, status, stake_status, stake_deadline_at)
    VALUES ('test_gsc_one', 'test_owner', 'FORMAL', 'GSC test', 'LAUNCHED', 'VERIFIED', NOW())
    ON CONFLICT DO NOTHING`);
  await query(`INSERT INTO gsc_connections (id, project_id, property_url, token_encrypted)
    VALUES ('test_gsc_connection', 'test_gsc_one', 'example.com', 'unused-test-value') ON CONFLICT DO NOTHING`);
  const original = ProjectService.syncGscProject;
  ProjectService.syncGscProject = async () => { throw new Error('GSC refused sync'); };
  try {
    await assert.rejects(findTask('sync-gsc')!.run([], { trigger: 'queue' }), /GSC refused sync|failed/i);
  } finally {
    ProjectService.syncGscProject = original;
  }
});
