import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/client';
import { runMigration } from '../src/migrate';
import { guardPoolErrors } from './pool-guard';

/**
 * 0004 是一次带数据回填的迁移，而它最难验证的部分恰恰在**空库上看不见**：
 * 一条已经有项目的旧库跑完 0004 之后，`opportunity_slots.claimed` 必须与实际占用
 * 一致，否则"槽位已满"会从 0 重新开始，把存量占用一次性清空。
 *
 * 所以这里先把库升到 0003（槽位表已存在、但还没有配额键与回填），灌入按旧规则
 * 产生的数据，再应用 0004，最后核对折算结果。
 */
test('0004 回填：存量项目折算成认领，且不伪造核验', async () => {
  const name = `emeradar_slot_backfill_${randomUUID().replace(/-/g, '')}`;
  const maintenance = guardPoolErrors(new Pool({ connectionString: pool.options.connectionString }));
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  const target = guardPoolErrors(new Pool({ connectionString: url.toString() }));
  const source = path.resolve(__dirname, '../src/migrations');
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'emeradar-0003-'));
  let created = false;

  try {
    // 只带 0001-0003 的迁移目录：模拟"0004 发布之前的那个库"。
    for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.sql'))) {
      if (file.slice(0, 4) <= '0003') fs.copyFileSync(path.join(source, file), path.join(partial, file));
    }
    assert.ok(
      fs.readdirSync(partial).some((f) => f.startsWith('0003')),
      '夹具必须包含 0003，否则槽位表不存在'
    );
    assert.ok(
      !fs.readdirSync(partial).some((f) => f.startsWith('0004')),
      '夹具不得包含 0004，否则回填会被重复执行'
    );

    await maintenance.query(`CREATE DATABASE "${name}"`);
    created = true;
    await runMigration({ pool: target, migrationsDir: partial });

    // 旧库的数据：两个用户、一条已追踪机会。A 有两个项目（一个归档），B 有一个。
    await target.query(`INSERT INTO users (id, email) VALUES
      ('usr_old_a','old-a@example.test'), ('usr_old_b','old-b@example.test')`);
    await target.query(`INSERT INTO opportunities (id, slug, title, status, recommended_archetype)
      VALUES ('opp_old','old-opp','Old Opportunity','TRACKED','TOOL')`);
    // A：10 天前建 —— 早就越过 7 天窗口，质押从未成立。
    await target.query(`INSERT INTO projects
      (id, user_id, opportunity_id, title, build_type, status, created_at, stake_deadline_at)
      VALUES ('prj_old_a','usr_old_a','opp_old','A stale project','TOOL','IN_DEVELOPMENT',
              NOW() - INTERVAL '10 days', NOW() - INTERVAL '3 days')`);
    // A 的归档项目：不得产生槽位行，也不得产生认领。
    await target.query(`INSERT INTO projects
      (id, user_id, opportunity_id, title, build_type, status, created_at, stake_deadline_at)
      VALUES ('prj_old_archived','usr_old_a','opp_old','A archived project','DIRECTORY','ARCHIVED',
              NOW() - INTERVAL '20 days', NOW() - INTERVAL '13 days')`);
    // B：2 天前建 —— 窗口未走完，属于正常的新规则状态。
    await target.query(`INSERT INTO projects
      (id, user_id, opportunity_id, title, build_type, status, created_at, stake_deadline_at)
      VALUES ('prj_old_b','usr_old_b','opp_old','B fresh project','PSEO_SITE','IN_DEVELOPMENT',
              NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days')`);

    await runMigration({ pool: target, migrationsDir: source });

    // --- 配额键 ---
    const pro = await target.query<{ atomic_go: string | null; slots_max: string | null }>(
      `SELECT entitlements->>'atomic_go_export_monthly' AS atomic_go,
              entitlements->>'active_go_slots_max' AS slots_max
         FROM plans WHERE code = 'PRO'`
    );
    assert.equal(pro.rows[0].atomic_go, '5');
    assert.equal(pro.rows[0].slots_max, '2');

    const free = await target.query<{ atomic_go: string | null; slots_max: string | null }>(
      `SELECT entitlements->>'atomic_go_export_monthly' AS atomic_go,
              entitlements->>'active_go_slots_max' AS slots_max
         FROM plans WHERE code = 'FREE'`
    );
    // 免费层没有 GO 权限：键要么不存在要么是 0，读侧不能靠 ?? 去猜。
    assert.equal(free.rows[0].slots_max, '0');
    assert.equal(free.rows[0].atomic_go, null);

    // --- 质押归属 ---
    const statuses = await target.query<{ id: string; stake_status: string }>(
      `SELECT id, stake_status FROM projects ORDER BY id`
    );
    const byId = Object.fromEntries(statuses.rows.map((r) => [r.id, r.stake_status]));
    // 窗口早已走完的存量项目：质押从未成立，诚实的状态是"没有活跃质押"，
    // 而不是替他宣称"已核验上线"。
    assert.equal(byId.prj_old_a, 'EXPIRED_RELEASED');
    assert.equal(byId.prj_old_b, 'PENDING');

    // --- 槽位与认领 ---
    const slots = await target.query<{ archetype: string; capacity: number; claimed: number }>(
      `SELECT archetype, capacity, claimed FROM opportunity_slots
        WHERE opportunity_id = 'opp_old' ORDER BY archetype`
    );
    assert.deepEqual(
      slots.rows.map((r) => ({ ...r, capacity: Number(r.capacity), claimed: Number(r.claimed) })),
      [
        { archetype: 'PSEO_SITE', capacity: 2, claimed: 1 },
        { archetype: 'TOOL', capacity: 2, claimed: 0 },
      ]
    );
    assert.equal(
      slots.rows.some((r) => r.archetype === 'DIRECTORY'),
      false,
      '归档项目不应产生槽位行'
    );

    const claims = await target.query<{ project_id: string; state: string }>(
      `SELECT project_id, state FROM slot_claims ORDER BY project_id`
    );
    assert.deepEqual(claims.rows, [{ project_id: 'prj_old_b', state: 'CLAIMED' }]);

    // I11：汇总缓存必须与认领行数一致。
    const drift = await target.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM opportunity_slots s
        WHERE s.claimed <> (SELECT COUNT(*) FROM slot_claims sc
                             WHERE sc.opportunity_id = s.opportunity_id
                               AND sc.archetype = s.archetype AND sc.state = 'CLAIMED')`
    );
    assert.equal(drift.rows[0].n, '0');
  } finally {
    await target.end();
    if (created) await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
    await pool.end();
    fs.rmSync(partial, { recursive: true, force: true });
  }
});
