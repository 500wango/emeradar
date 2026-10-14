import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

/**
 * 事务里那个客户端的类型。转出它，是为了让上层包（`@emeradar/services`）能写出
 * "这个函数必须在调用方的事务里执行"的签名，而不必自己依赖 `pg`——数据访问的
 * 边界只应该有一个，多一个包直接引 `pg` 就多一处可以绕过连接池配置的地方。
 */
export type { PoolClient } from 'pg';

// Load .env from project root if present
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.DATABASE_URL || 'postgres://michael:postgres@localhost:5432/emeradar';

/**
 * The connection the job queue and session-level locks must use.
 *
 * `pg-boss` holds a `LISTEN/NOTIFY` listener and takes session-scoped advisory
 * locks, both of which a transaction-mode pooler severs: the listener's
 * connection is handed to another client between statements, so notifications
 * never arrive and locks are released by a connection the caller does not own
 * (ADR-003, ADR-012). Where a pooler is in front of PostgreSQL, the queue has to
 * bypass it with `DATABASE_DIRECT_URL`.
 *
 * It falls back to `DATABASE_URL`, so an installation with one URL — every
 * developer machine, CI and the current single-VPS deployment — needs no second
 * variable to be correct. That fallback is also why the variable is introduced
 * now rather than when PgBouncer arrives: a queue that starts life on the direct
 * URL cannot later be discovered to have been relying on a pooler by accident.
 */
export const directConnectionString = process.env.DATABASE_DIRECT_URL || connectionString;

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Idle clients can emit errors (server restart, network reset, admin terminate).
// Without a listener Node treats the event as unhandled and kills the process,
// taking the whole web app down with it.
pool.on('error', (error) => {
  console.error('[db] Idle client error:', error);
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
