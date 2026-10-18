import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 项目结果回访：T+30/60/90 到期提示 + 用户记录。
 *
 * 不改写机会的历史裁决；只更新项目的当前状态并保留每次回访。
 */
const harness = makeDisposableDb('emeradar_project_outcome_test');
const USER = 'usr_outcome_test';
const PROJECT = 'prj_outcome_test';

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(
    `INSERT INTO users (id, email, role, tier, status) VALUES ($1, 'outcome@test.local', 'USER', 'PRO', 'ACTIVE')`,
    [USER]
  );
  await query(
    `INSERT INTO projects (id, user_id, title, status, build_type, created_at)
     VALUES ($1, $2, 'Outcome Test', 'IN_DEVELOPMENT', 'TOOL', NOW() - INTERVAL '40 days')`,
    [PROJECT, USER]
  );
});

after(async () => {
  await harness.teardown();
});

describe('项目结果回访', () => {
  it('超过 30 天未回访时提示 T+30 到期', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const state = await harness.services.ProjectOutcomeService.getState(PROJECT, USER);
    assert.ok(state.nextCheckin);
    assert.strictEqual(state.nextCheckin?.horizonDays, 30);
  });

  it('记录上线后更新项目状态并保留历史', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { ProjectOutcomeService } = harness.services;
    const checkin = await ProjectOutcomeService.record(PROJECT, USER, 'LAUNCHED', 'first users');
    assert.strictEqual(checkin.status, 'LAUNCHED');

    const project = await harness.db.query<{ status: string; launch_date: string | null }>(
      `SELECT status, launch_date::text FROM projects WHERE id = $1`,
      [PROJECT]
    );
    assert.strictEqual(project.rows[0].status, 'LAUNCHED');
    assert.ok(project.rows[0].launch_date);

    const state = await ProjectOutcomeService.getState(PROJECT, USER);
    assert.strictEqual(state.checkins[0].note, 'first users');
    assert.strictEqual(state.nextCheckin, null, '刚回访后不应再提示同一档');
  });

  it('放弃会把项目归档并标 NO_TRACTION', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await harness.services.ProjectOutcomeService.record(PROJECT, USER, 'ABANDONED', 'no demand');
    const project = await harness.db.query<{ status: string; outcome_status: string }>(
      `SELECT status, outcome_status FROM projects WHERE id = $1`,
      [PROJECT]
    );
    assert.strictEqual(project.rows[0].status, 'ARCHIVED');
    assert.strictEqual(project.rows[0].outcome_status, 'NO_TRACTION');
  });
});
