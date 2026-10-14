import { pool, closePool, runMigration } from '@emeradar/db';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Never run queue or fixture writes against the configured application database.
const requireDb = createRequire(path.resolve(__dirname, '../../../packages/db/package.json'));
const { Pool } = requireDb('pg');
async function main() {
  const name = `emeradar_worker_test_suite_${process.pid}`;
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  let created = false;
  try {
    await pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    // Build the fixture from the migration chain, not from `schema.sql`. That file is a
    // frozen copy of the 0001 baseline and starts drifting the moment a new migration
    // lands; production and CI both run the worker against a *migrated* database, so the
    // fixture has to be built the same way or the suite silently tests a schema that no
    // longer exists.
    const fixturePool = new Pool({ connectionString: url.toString() });
    try {
      await runMigration({ pool: fixturePool });
    } finally {
      await fixturePool.end();
    }
    const files = readdirSync(__dirname).filter(name => name.endsWith('.test.ts')).sort();
    const result = spawnSync('pnpm', ['exec', 'tsx', '--test', '--test-concurrency=1', ...files.map(name => `test/${name}`)], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: url.toString(), DATABASE_DIRECT_URL: url.toString() },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    if (created) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await closePool();
  }
}
main().catch(error => {
  console.error('Worker test harness failed:', error.message);
  process.exitCode = 1;
});
