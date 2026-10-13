import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { pool, closePool } from './client';

export interface MigrationOptions {
  /** Explicit pool allows isolated test databases without touching the app DB. */
  pool?: Pool;
  migrationsDir?: string;
}

/** SQL files are immutable after release; corrections belong in a new version. */
export async function runMigration(options: MigrationOptions = {}): Promise<void> {
  const directory = options.migrationsDir ?? path.resolve(__dirname, 'migrations');
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  if (!names.length) throw new Error(`No SQL migrations found in ${directory}`);
  const versions = new Set<string>();
  const migrations = names.map(name => {
    const match = /^(\d{4})_[a-z0-9_-]+\.sql$/.exec(name);
    if (!match || versions.has(match[1])) throw new Error(`Invalid or duplicate migration version: ${name}`);
    versions.add(match[1]);
    const sql = fs.readFileSync(path.join(directory, name), 'utf8');
    return { version: match[1], name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
  const client = await (options.pool ?? pool).connect();
  try {
    await client.query('BEGIN');
    // Transaction-scoped lock serializes bootstrap, verification and application,
    // and is automatically released on rollback/disconnect (including poolers).
    await client.query(`SELECT pg_advisory_xact_lock(194827301, 1)`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const applied = await client.query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
    );
    for (const row of applied.rows) {
      const migration = migrations.find(item => item.version === row.version);
      if (!migration) throw new Error(`Applied migration ${row.version} is missing from this release`);
      if (migration.name !== row.name || migration.checksum !== row.checksum) {
        throw new Error(`Migration checksum/name mismatch: ${row.version}; restore the original SQL and add a new migration`);
      }
    }
    const appliedVersions = new Set(applied.rows.map(row => row.version));
    const latest = applied.rows.at(-1)?.version;
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      if (latest && migration.version < latest) throw new Error(`Out-of-order migration: ${migration.name}`);
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigration()
    .then(async () => { console.log('[migrate] Done.'); await closePool(); })
    .catch(async error => {
      console.error('[migrate] Execution error:', error);
      await closePool();
      process.exitCode = 1;
    });
}
