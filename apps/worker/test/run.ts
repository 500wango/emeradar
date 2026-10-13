import { pool, closePool } from '@emeradar/db';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Never run queue or fixture writes against the configured application database.
const requireDb = createRequire(path.resolve(__dirname, '../../../packages/db/package.json'));
const { Client } = requireDb('pg');
async function main() {
  const name = `emeradar_worker_test_suite_${process.pid}`;
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  let created = false;
  try {
    await pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await client.query(readFileSync(path.resolve(__dirname, '../../../packages/db/src/schema.sql'), 'utf8'));
    } finally {
      await client.end();
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
