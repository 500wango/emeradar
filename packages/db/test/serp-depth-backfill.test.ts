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
 * 0006 把 SERP 采集深度从 10 提到 100，并给快照补上 `depth` / `result_count`。
 *
 * 这条迁移最容易错的地方在**存量行**，而空库上一点都看不出来：两列的建列默认值刻意
 * 是 10 与 0（0006 之前的采集请求的就是 num=10），回填之后才把默认值改成 100。顺序
 * 或默认值搞反，一段"当时只采了 10 条"的历史会被一次性谎报成"当时也采了 100 条"——
 * 而那正是这条迁移要修掉的那种沉默：`best_rank IS NULL` 到底是没入榜，还是我们没看
 * 那么深，从此无法区分。
 *
 * 所以这里先把库升到 0005（采集深度还是 10 的那个世界），灌入按旧规则产生的行，再
 * 应用 0006，最后核对折算结果。
 */
test('0006 回填：存量快照保留 10 的深度，新默认值是 100', async () => {
  const name = `emeradar_serp_depth_${randomUUID().replace(/-/g, '')}`;
  const maintenance = guardPoolErrors(new Pool({ connectionString: pool.options.connectionString }));
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  const target = guardPoolErrors(new Pool({ connectionString: url.toString() }));
  const source = path.resolve(__dirname, '../src/migrations');
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'emeradar-0005-'));
  let created = false;

  try {
    // 只带 0001-0005 的迁移目录：模拟"0006 发布之前的那个库"。
    for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.sql'))) {
      if (file.slice(0, 4) <= '0005') fs.copyFileSync(path.join(source, file), path.join(partial, file));
    }
    assert.ok(
      fs.readdirSync(partial).some((f) => f.startsWith('0005')),
      '夹具必须包含 0005，否则这不是"0006 之前"的库'
    );
    assert.ok(
      !fs.readdirSync(partial).some((f) => f.startsWith('0006')),
      '夹具不得包含 0006，否则回填会被重复执行'
    );

    await maintenance.query(`CREATE DATABASE "${name}"`);
    created = true;
    await runMigration({ pool: target, migrationsDir: partial });

    // --- 旧世界的数据 ---
    await target.query(`INSERT INTO users (id, email) VALUES
      ('usr_depth','depth@example.test')`);
    await target.query(`INSERT INTO opportunities (id, slug, title, status, recommended_archetype)
      VALUES ('opp_depth','depth-opp','Depth Opportunity','TRACKED','TOOL')`);
    await target.query(`INSERT INTO projects
      (id, user_id, opportunity_id, title, build_type, status, stake_deadline_at)
      VALUES ('prj_depth','usr_depth','opp_depth','Depth project','TOOL','IN_DEVELOPMENT',
              NOW() + INTERVAL '7 days')`);
    await target.query(`INSERT INTO queries (id, query_text) VALUES ('qry_depth','legacy query')`);

    // 老快照 A：只存了 3 条（1–10 全存，所以 3 条意味着当时至少拿到 3 条）。
    await target.query(`INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio)
      VALUES ('srp_depth_a','qry_depth','2026-08-01', 0.3333)`);
    for (const rank of [1, 2, 3]) {
      await target.query(
        `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title)
         VALUES ('srp_depth_a', $1, $2, $3, $4)`,
        [rank, `https://legacy-${rank}.example/`, `legacy-${rank}.example`, `Legacy ${rank}`]
      );
    }
    // 老快照 B：一条结果都没有存下来。它的条数下界是 0。
    await target.query(`INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio)
      VALUES ('srp_depth_b','qry_depth','2026-08-02', 0.0)`);

    // 凭证：大写 + 显式端口 + www 前缀的那条，回填后必须与运行期归一化得到同一个键。
    // 另外两条只能是非 VERIFIED（`project_credentials_one_verified` 是每项目一条的
    // 部分唯一索引），而回填本身与校验状态无关——一条曾被拒的凭证日后被重新核验时，
    // 它的 host 早就该在那儿了。
    await target.query(`INSERT INTO project_credentials
      (id, project_id, credential_type, url, host, verification_state)
      VALUES ('crd_depth_a','prj_depth','DOMAIN_URL','HTTPS://WWW.Example.com:443/pricing', NULL, 'VERIFIED')`);
    await target.query(`INSERT INTO project_credentials
      (id, project_id, credential_type, url, host, verification_state)
      VALUES ('crd_depth_b','prj_depth','DOMAIN_URL','https://app.example.com/', NULL, 'REJECTED')`);
    // 非 http(s) 的 URL：解析不出来就保持 NULL，不猜。
    await target.query(`INSERT INTO project_credentials
      (id, project_id, credential_type, url, host, verification_state)
      VALUES ('crd_depth_c','prj_depth','PUBLIC_PAGE_URL','chrome-extension://abc/options', NULL, 'REJECTED')`);

    await runMigration({ pool: target, migrationsDir: source });

    // --- 深度与条数 ---
    const snaps = await target.query<{ id: string; depth: number; result_count: number }>(
      `SELECT id, depth, result_count FROM serp_snapshots ORDER BY id`
    );
    assert.deepEqual(
      snaps.rows.map((row) => ({ id: row.id, depth: Number(row.depth), result_count: Number(row.result_count) })),
      [
        // 存量行是 10，不是 100 —— 那天的采集确实只有 10 条深。
        { id: 'srp_depth_a', depth: 10, result_count: 3 },
        { id: 'srp_depth_b', depth: 10, result_count: 0 },
      ]
    );

    const defaults = await target.query<{ column_name: string; column_default: string }>(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_name = 'serp_snapshots' AND column_name IN ('depth','result_count')
        ORDER BY column_name`
    );
    // 存量修完之后，新行才按一鱼多吃的深度发起。
    assert.equal(defaults.rows.find((r) => r.column_name === 'depth')?.column_default, '100');
    assert.equal(defaults.rows.find((r) => r.column_name === 'result_count')?.column_default, '0');

    // --- 凭证主机的回填 ---
    const creds = await target.query<{ id: string; host: string | null }>(
      `SELECT id, host FROM project_credentials ORDER BY id`
    );
    assert.deepEqual(
      creds.rows.map((row) => [row.id, row.host]),
      [
        // 大写、显式端口、www 前缀统统归一：与运行期 `normalizeCredentialHost` 同一个键。
        ['crd_depth_a', 'example.com'],
        // 子域保留：`app.example.com` 与 `example.com` 是两个站点，折成后者等于让
        // 一个第三方子域替别人领走排名。
        ['crd_depth_b', 'app.example.com'],
        // 非 http(s) 的 URL 解析不出来，保持 NULL —— 不猜。
        ['crd_depth_c', null],
      ]
    );

    // --- 读路径索引 ---
    const index = await target.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'project_serp_rankings' AND indexname = 'idx_project_serp_rankings_recent'`
    );
    assert.equal(index.rows.length, 1);
  } finally {
    await target.end();
    if (created) await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
    await pool.end();
    fs.rmSync(partial, { recursive: true, force: true });
  }
});
