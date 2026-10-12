import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * 一次性数据库夹具。
 *
 * 账本类表（`verdicts`、`ledger_checkpoints`）挂着只追加触发器，夹具写进去的行
 * **永远删不掉**。所以这类用例不能复用 `pnpm db:migrate` 那个库：往开发库里塞假
 * 裁决，等于往产品对外可信度本身里掺东西。每个用到它的用例文件自建一个库，跑完
 * 连同库一起丢掉。
 *
 * 每个测试文件在独立进程里跑（`tsx --test` 的行为），因此每个文件都持有自己的
 * `@emeradar/db` 模块实例，改写它的连接串不会波及别的文件。
 *
 * 连接串从**连接池自己**取，而不是读 `process.env`：`dotenv` 只有 `@emeradar/db`
 * 声明了，而且 turbo 默认不把 `DATABASE_URL` 透传进测试进程（`pnpm test` 根命令下
 * 它是空的）。池在构造时就固定了连接串，所以必须在它建立任何连接之前改写 options ——
 * 这也是 setup 里那两条 `totalCount` / `idleCount` 断言的意义：一旦池已经连过，
 * 改写就是无效的，而无效的改写会让夹具悄悄落到开发库上。
 */

export interface DisposableDb {
  /** setup 之后才可用。 */
  db: typeof import('@emeradar/db');
  services: typeof import('../../src');
  /** setup 跑完才为真；为假时用例应当 `t.skip(skipReason)`。 */
  available: boolean;
  skipReason: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  /** 连到维护库执行建库/删库一类的语句。 */
  withMaintenance(sql: string): Promise<{ ok: boolean; code?: string }>;
}

const SCHEMA_PATH = path.resolve(__dirname, '../../../db/src/schema.sql');

export function makeDisposableDb(namePrefix: string): DisposableDb {
  // 带上 pid：并行跑多个用例文件时名字不会撞。
  const dbName = `${namePrefix}_${process.pid}`;
  const harness: Partial<DisposableDb> = { available: false, skipReason: '' };
  let baseUrl = '';

  async function withMaintenance(sql: string): Promise<{ ok: boolean; code?: string }> {
    const client = new Client({ connectionString: baseUrl });
    await client.connect();
    try {
      await client.query(sql);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, code: error?.code };
    } finally {
      await client.end();
    }
  }
  harness.withMaintenance = withMaintenance;

  harness.setup = async () => {
    const db = await import('@emeradar/db');
    harness.db = db;

    const resolved = db.pool.options.connectionString;
    if (!resolved) {
      harness.skipReason = '连接池没有配置连接串';
      return;
    }
    if (db.pool.totalCount !== 0 || db.pool.idleCount !== 0) {
      throw new Error('连接池已经建立过连接，无法再指向一次性数据库');
    }
    baseUrl = resolved;

    const verifyUrl = `${resolved.replace(/\/[^/]*$/, '')}/${dbName}`;
    const created = await withMaintenance(`CREATE DATABASE "${dbName}"`);
    if (!created.ok) {
      // 没有建库权限时跳过，而不是让整套用例红掉 —— 但跳过的原因必须显式写出来。
      harness.skipReason = `无法创建一次性数据库（SQLSTATE ${created.code}）`;
      return;
    }

    const client = new Client({ connectionString: verifyUrl });
    await client.connect();
    try {
      await client.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    } finally {
      await client.end();
    }

    db.pool.options.connectionString = verifyUrl;
    process.env.DATABASE_URL = verifyUrl;
    harness.services = await import('../../src');

    // 若上面的改写没有生效，这里立刻发现 —— 绝不能让夹具悄悄落到开发库上。
    const actual = (await db.query<{ name: string }>(`SELECT current_database() AS name`)).rows[0]?.name;
    if (actual !== dbName) {
      throw new Error(`连接池没有指向一次性数据库（当前为 ${actual}）；本套用例拒绝在别的库上运行`);
    }

    harness.available = true;
  };

  harness.teardown = async () => {
    // 池的销毁必须先于删库，否则连接还挂着，DROP DATABASE 拿不到独占锁。
    if (harness.available) await harness.db!.closePool();
    if (baseUrl) await withMaintenance(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  };

  return harness as DisposableDb;
}
