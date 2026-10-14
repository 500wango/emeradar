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
 * 0007 是 Epic 1.14（处女地独占买断）的数据层。它值得单独验的只有两件事，但两件都
 * 是**索引语义**而不是建表语句：
 *
 *   1. `stealth_locks_one_active` 必须真的拒绝同一机会的第二把 `ACTIVE` 锁（I13）。
 *      不变量 I13 的"防多"全靠它——代码侧只有"先查后写"，而并发下两侧都会通过。
 *   2. `stealth_locks_one_pending_per_user` 必须**只**管待付占位（`ACTIVE` 且
 *      `provider_payment_id IS NULL`）。写宽一格，一个用户买了第二把锁就被挡；
 *      写窄一格，一笔待付占位就能对整网反复遮黑 45 分钟而不用花一分钱。
 *      另外两条索引的存在理由（作废扫描、期满扫描）是查询性能，不是正确性，
 *      所以这里只断言它们确实被建出来了，不去模拟执行计划。
 *
 * `plans.entitlements` 的补齐也在这里验：它是**加键**而不是改结构，而 `plans` 是
 * 运营会手改的表。若这条 UPDATE 写成覆盖整个 `entitlements`，一次部署就会把运维
 * 手工调过的配额悄悄抹掉。
 */
test('0007：买断的数据层不变量与索引语义', async () => {
  const name = `emeradar_stealth_0007_${randomUUID().replace(/-/g, '')}`;
  const maintenance = guardPoolErrors(new Pool({ connectionString: pool.options.connectionString }));
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  const target = guardPoolErrors(new Pool({ connectionString: url.toString() }));
  const source = path.resolve(__dirname, '../src/migrations');
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'emeradar-0006-'));
  let created = false;

  try {
    // 只带 0001-0006 的迁移目录：模拟"0007 发布之前的那个库"，这样 0007 是在一个
    // 已经有人用过的库上应用的，而不是在一张白纸上。
    for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.sql'))) {
      if (file.slice(0, 4) <= '0006') fs.copyFileSync(path.join(source, file), path.join(partial, file));
    }
    assert.ok(fs.readdirSync(partial).some((f) => f.startsWith('0006')));
    assert.ok(!fs.readdirSync(partial).some((f) => f.startsWith('0007')));

    await maintenance.query(`CREATE DATABASE "${name}"`);
    created = true;
    await runMigration({ pool: target, migrationsDir: partial });

    // 运维手工调过的配额：0007 之后必须还在。
    await target.query(
      `UPDATE plans SET entitlements = entitlements || '{"max_projects": 999}'::jsonb WHERE code = 'PRO'`
    );

    await target.query(`INSERT INTO users (id, email) VALUES
      ('usr_stl_a','stl-a@example.test'), ('usr_stl_b','stl-b@example.test')`);
    await target.query(`INSERT INTO opportunities (id, slug, title, status) VALUES
      ('opp_stl_1','stl-1','One','TRACKED'), ('opp_stl_2','stl-2','Two','TRACKED')`);

    await runMigration({ pool: target, migrationsDir: source });

    // --- plans.entitlements：加键，不覆盖 ---
    const ent = await target.query<{ entitlements: Record<string, unknown> }>(
      `SELECT entitlements FROM plans WHERE code = 'PRO'`
    );
    assert.equal(ent.rows[0].entitlements.stealth_buyout, true);
    assert.equal(ent.rows[0].entitlements.max_projects, 999, '0007 覆盖了运维手工调过的配额');
    const free = await target.query<{ entitlements: Record<string, unknown> }>(
      `SELECT entitlements FROM plans WHERE code = 'FREE'`
    );
    // 显式 false 而不是省略：省下的是一个"没写下来的默认值"，下次谁把读侧的兜底
    // 改成 `?? true`，免费层就悄悄获得了买断权。
    assert.equal(free.rows[0].entitlements.stealth_buyout, false);

    // --- I13：同一机会至多一把 ACTIVE ---
    const insert = (lockId: string, opportunityId: string, userId: string, paid: string | null) =>
      target.query(
        `INSERT INTO stealth_locks (id, opportunity_id, user_id, status, unlock_at, amount_usd, provider_payment_id)
         VALUES ($1, $2, $3, 'ACTIVE', NOW() + INTERVAL '60 days', 199.00, $4)`,
        [lockId, opportunityId, userId, paid]
      );
    await insert('slk_a1', 'opp_stl_1', 'usr_stl_a', 'pi_1');
    await assert.rejects(insert('slk_a2', 'opp_stl_1', 'usr_stl_b', 'pi_2'), (error: any) => {
      assert.equal(error.code, '23505');
      return true;
    });
    // 另一条机会不受影响。
    await insert('slk_a3', 'opp_stl_2', 'usr_stl_a', 'pi_3');

    // 期满之后同一机会可以再卖一次（第一笔 EXPIRED，Σclaimed 又回到 0）。
    await target.query(`UPDATE stealth_locks SET status = 'EXPIRED' WHERE id = 'slk_a1'`);
    await insert('slk_a4', 'opp_stl_1', 'usr_stl_b', 'pi_4');

    // --- 待付占位：每人至多一笔，且已付款的行不占这个名额 ---
    await target.query(`UPDATE stealth_locks SET status = 'VOID' WHERE id IN ('slk_a3','slk_a4')`);
    await insert('slk_p1', 'opp_stl_1', 'usr_stl_a', null);
    await assert.rejects(insert('slk_p2', 'opp_stl_2', 'usr_stl_a', null), (error: any) => {
      assert.equal(error.code, '23505', '同一用户的第二笔待付占位没有被挡住');
      return true;
    });
    // 换个人就行——这道闸是按人算的，不是全局限流。
    await insert('slk_p3', 'opp_stl_2', 'usr_stl_b', null);
    // 已付款的锁不占名额：A 有一笔待付，再买一把已付款的锁不该被拒。
    await assert.rejects(insert('slk_p4', 'opp_stl_2', 'usr_stl_a', 'pi_5'), (error: any) => {
      // opp_stl_2 上已被 slk_p3 占了 ACTIVE，所以这里撞的是 I13 那条索引 ——
      // 恰好证明两把索引各自管各自的事。
      assert.equal(error.code, '23505');
      return true;
    });
    await target.query(`UPDATE stealth_locks SET status = 'VOID' WHERE id = 'slk_p3'`);
    await insert('slk_p5', 'opp_stl_2', 'usr_stl_a', 'pi_5');

    // --- 索引确实建出来了 ---
    const indexes = await target.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('stealth_locks','stealth_lock_displays')`
    );
    const names = indexes.rows.map((row) => row.indexname);
    for (const expected of [
      'stealth_locks_one_active',
      'stealth_locks_one_pending_per_user',
      'idx_stealth_locks_void_scan',
      'idx_stealth_locks_expiry_scan',
      'idx_stealth_lock_displays_opportunity',
    ]) {
      assert.ok(names.includes(expected), `缺少索引 ${expected}`);
    }

    // --- 显示行的主键按锁而不是按机会 ---
    await target.query(
      `INSERT INTO stealth_lock_displays (stealth_lock_id, opportunity_id, masked_label, locale, unmasked_at)
       SELECT id, opportunity_id, '[Stealth Locked #' || RIGHT(id,6) || ']', 'en-US', unlock_at
         FROM stealth_locks WHERE id = 'slk_p5'`
    );
    // 同一机会的第二把锁（第一把刚被置 VOID，这里再走一遍）也要能写自己的显示行。
    // 主键若按 (opportunity_id, locale)，这一句会撞主键 —— 而唯一的出路是删掉第一把
    // 锁的显示行，于是那把锁永远失去"有且仅有一条显示行"的性质。
    await target.query(`UPDATE stealth_locks SET status = 'VOID' WHERE id = 'slk_p5'`);
    await insert('slk_p6', 'opp_stl_2', 'usr_stl_b', 'pi_6');
    await target.query(
      `INSERT INTO stealth_lock_displays (stealth_lock_id, opportunity_id, masked_label, locale, unmasked_at)
       SELECT id, opportunity_id, '[Stealth Locked #' || RIGHT(id,6) || ']', 'en-US', unlock_at
         FROM stealth_locks WHERE id = 'slk_p6'`
    );
    const displays = await target.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM stealth_lock_displays WHERE opportunity_id = 'opp_stl_2'`
    );
    assert.equal(displays.rows[0].count, '2');
  } finally {
    // `target` 必须先关：`DROP DATABASE ... WITH (FORCE)` 会**掐断**它的连接，
    // 而那条被掐断的连接会把 "terminating connection due to administrator command"
    // 抛成一个 uncaughtException，把一次成功的用例报成失败。
    await target.end();
    if (created) await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
    await pool.end();
    fs.rmSync(partial, { recursive: true, force: true });
  }
});
