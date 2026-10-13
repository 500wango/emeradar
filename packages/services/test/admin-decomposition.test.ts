import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('admin facade delegates to focused modules while retaining all public entry points', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/admin.service.ts'), 'utf8');
  assert.ok(source.split('\n').length < 100, 'admin facade must not retain domain implementations');
  const { AdminService } = await import('../src/admin.service');
  for (const method of ['getPipelineOverview','listCandidates','moderateCandidate','listSources','addRssSource',
    'toggleSource','triggerTask','getUserStats','listUsers','getUserById','updateUser','resetUserPassword','createUserByAdmin']) {
    assert.equal(typeof (AdminService as any)[method], 'function', method);
  }
});
