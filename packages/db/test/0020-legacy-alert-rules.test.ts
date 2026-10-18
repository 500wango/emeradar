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
 * 0020 的存量数据前提（F1 第 9 条）。
 *
 * 旧 CHECK 放着 `SLOTS_LAST_ONE` / `NEW_ENTRANT` 两个值，而 0020 的新 CHECK 只有
 * 12 §2 的 6 条。只把存量行 `is_active = false` 是**不够**的：CHECK 会校验所有行，
 * 旧取值仍然存在时 `ADD CONSTRAINT` 会抛
 * `check constraint "alert_rules_rule_type_check" ... violated by some row`，
 * 整个 0020 事务回滚。这里把"0019 库里已经有这类行"固定成一条用例，防止有人
 * 再把 DELETE 改回 UPDATE。
 */
test('0020：先清掉旧类型 alert_rules，再重建 6 值 CHECK', async () => {
  const name = `emeradar_0020_legacy_rules_${randomUUID().replace(/-/g, '')}`;
  const maintenance = guardPoolErrors(new Pool({ connectionString: pool.options.connectionString }));
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  const target = guardPoolErrors(new Pool({ connectionString: url.toString() }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emeradar-0020-'));
  let created = false;
  try {
    await maintenance.query(`CREATE DATABASE "${name}"`);
    created = true;

    // 先把库推到 0019（旧 CHECK 仍在），再写两条"历史遗留"规则。
    const source = path.resolve(__dirname, '../src/migrations');
    for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.sql') && f.slice(0, 4) <= '0019')) {
      fs.copyFileSync(path.join(source, file), path.join(dir, file));
    }
    await runMigration({ pool: target, migrationsDir: dir });

    await target.query(`INSERT INTO users (id, email) VALUES ('u0020', 'u0020@example.test')`);
    await target.query(
      `INSERT INTO opportunities (id, slug, title, status) VALUES ('o0020', 'o0020', 'o0020', 'TRACKED')`
    );
    for (const [id, ruleType] of [
      ['r0020_slots', 'SLOTS_LAST_ONE'],
      ['r0020_entrant', 'NEW_ENTRANT'],
    ]) {
      await target.query(
        `INSERT INTO alert_rules (id, user_id, opportunity_id, rule_type, frequency, is_active)
         VALUES ($1, 'u0020', 'o0020', $2, 'DAILY', true)`,
        [id, ruleType]
      );
    }

    // 0020 从当前 migrations 目录应用（不复制进临时目录）。
    await runMigration({ pool: target });

    assert.equal(
      (await target.query(`SELECT version FROM schema_migrations WHERE version = '0020'`)).rowCount,
      1,
      '0020 没有应用成功'
    );
    assert.equal(
      (
        await target.query(
          `SELECT COUNT(*)::int AS n FROM alert_rules WHERE rule_type IN ('SLOTS_LAST_ONE','NEW_ENTRANT')`
        )
      ).rows[0].n,
      0,
      '旧类型规则还在：新 CHECK 本应让 0020 失败，或者这里应已被清掉'
    );
    // 新 CHECK 已经生效：再插旧类型必须被拒绝。
    await assert.rejects(
      target.query(
        `INSERT INTO alert_rules (id, user_id, opportunity_id, rule_type, frequency, is_active)
         VALUES ('r0020_after', 'u0020', 'o0020', 'SLOTS_LAST_ONE', 'DAILY', false)`
      ),
      /alert_rules_rule_type_check/
    );
  } finally {
    await target.end();
    if (created) await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
    await pool.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
