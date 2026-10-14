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
 * 0008 是纯加索引，所以它值得验的只有两件事——但两件都不是"索引建出来了吗"：
 *
 *   1. **部分索引的谓词必须与查询的谓词逐字相容。** `idx_public_pages_published_indexable`
 *      带 `WHERE status = 'PUBLISHED' AND indexable = true`。规划器只有在能证明查询蕴含
 *      这个谓词时才会用它；谓词写歪（比如把 `indexable = true` 漏掉）不会报错，只会让
 *      索引永远不被选中——一个"建了但没用"的索引比没有索引更坏，因为它看起来像已经优化过。
 *   2. **索引必须真的被建出来**，否则蚕食防护与打码投影清理会退化成全表扫。
 *
 * 与 `stealth-locks-0007.test.ts` 同一手法：先在 `<= 0007` 的库上确认索引**不存在**
 * （证明夹具确实是"0008 之前"的世界），再应用 0008。
 */
test('0008：public_pages 的读路径索引', async () => {
  const name = `emeradar_pubpages_0008_${randomUUID().replace(/-/g, '')}`;
  const maintenance = guardPoolErrors(new Pool({ connectionString: pool.options.connectionString }));
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  const target = guardPoolErrors(new Pool({ connectionString: url.toString() }));
  const source = path.resolve(__dirname, '../src/migrations');
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'emeradar-0007-'));
  let created = false;

  const indexNames = async (): Promise<string[]> => {
    const res = await target.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'public_pages'`
    );
    return res.rows.map((row) => row.indexname);
  };

  try {
    for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.sql'))) {
      if (file.slice(0, 4) <= '0007') fs.copyFileSync(path.join(source, file), path.join(partial, file));
    }
    assert.ok(fs.readdirSync(partial).some((f) => f.startsWith('0007')));
    assert.ok(!fs.readdirSync(partial).some((f) => f.startsWith('0008')));

    await maintenance.query(`CREATE DATABASE "${name}"`);
    created = true;
    await runMigration({ pool: target, migrationsDir: partial });

    // 夹具正确性：0008 之前这两个索引不该存在。
    assert.deepEqual(
      (await indexNames()).filter((n) => n.startsWith('idx_public_pages_')),
      []
    );

    await runMigration({ pool: target, migrationsDir: source });

    const names = await indexNames();
    assert.ok(names.includes('idx_public_pages_opportunity'), '缺少按机会查页的索引');
    assert.ok(names.includes('idx_public_pages_published_indexable'), '缺少蚕食防护的参照索引');

    // 部分索引的谓词逐字核对 —— 见文件头的第 1 条。
    const predicate = await target.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'public_pages' AND indexname = 'idx_public_pages_published_indexable'`
    );
    const def = predicate.rows[0].indexdef;
    assert.match(def, /status = 'PUBLISHED'::text/);
    assert.match(def, /indexable = true/);
  } finally {
    // `target` 必须先关：`DROP DATABASE ... WITH (FORCE)` 会掐断它的连接，而那条被掐断
    // 的连接会把 "terminating connection due to administrator command" 抛成
    // uncaughtException，把一次成功的用例报成失败。
    await target.end();
    if (created) await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
    await pool.end();
    fs.rmSync(partial, { recursive: true, force: true });
  }
});
