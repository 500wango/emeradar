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

// Never migrate the configured application database: create an isolated database.
test('versioned migrations: fresh, replay, adoption, checksum and rollback', async () => {
  const name = `emeradar_migrations_test_${randomUUID().replace(/-/g, '')}`;
  const maintenance = guardPoolErrors(new Pool({ connectionString: pool.options.connectionString }));
  const url = new URL(pool.options.connectionString!);
  url.pathname = `/${name}`;
  const target = guardPoolErrors(new Pool({ connectionString: url.toString() }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emeradar-migrations-'));
  let created = false;
  try {
    await maintenance.query(`CREATE DATABASE "${name}"`);
    created = true;
    assert.match(runMigration.toString(), /options/, 'runner must support an explicit isolated pool');
    await runMigration({ pool: target });
    const history = await target.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    assert.ok(history.rows.length > 0);
    assert.match(history.rows[0].checksum, /^[a-f0-9]{64}$/);
    await target.query(`UPDATE plans SET price_usd_monthly = 77 WHERE code = 'PRO'`);
    await runMigration({ pool: target });
    assert.deepEqual((await target.query('SELECT version, checksum FROM schema_migrations ORDER BY version')).rows, history.rows);
    assert.equal((await target.query(`SELECT price_usd_monthly FROM plans WHERE code = 'PRO'`)).rows[0].price_usd_monthly, '77.00');

    // Legacy installations have schema but no version ledger; retain their data.
    await target.query('DROP TABLE schema_migrations');
    await target.query(`INSERT INTO users (id,email) VALUES ('legacy-user','legacy@example.test')`);
    await runMigration({ pool: target });
    assert.equal((await target.query(`SELECT id FROM users WHERE id = 'legacy-user'`)).rowCount, 1);
    assert.equal((await target.query('SELECT * FROM schema_migrations')).rowCount, history.rows.length);

    // Changed applied SQL must be rejected before any pending migration executes.
    const source = path.resolve(__dirname, '../src/migrations');
    for (const file of fs.readdirSync(source).filter(f => f.endsWith('.sql'))) {
      fs.copyFileSync(path.join(source, file), path.join(dir, file));
    }
    const first = fs.readdirSync(dir).sort()[0];
    fs.appendFileSync(path.join(dir, first), '\n-- changed\n');
    await assert.rejects(runMigration({ pool: target, migrationsDir: dir }), /checksum/i);
    fs.copyFileSync(path.join(source, first), path.join(dir, first));
    fs.writeFileSync(path.join(dir, '9999_broken.sql'), 'CREATE TABLE migration_partial(id int); SELECT missing_migration_function();');
    await assert.rejects(runMigration({ pool: target, migrationsDir: dir }), /missing_migration_function/);
    assert.equal((await target.query(`SELECT to_regclass('migration_partial') AS name`)).rows[0].name, null);
    assert.equal((await target.query('SELECT * FROM schema_migrations')).rowCount, history.rows.length);
    fs.writeFileSync(path.join(dir, '9999_broken.sql'), 'CREATE TABLE migration_partial(id int);');
    const concurrent = await Promise.allSettled([
      runMigration({ pool: target, migrationsDir: dir }),
      runMigration({ pool: target, migrationsDir: dir }),
    ]);
    for (const result of concurrent) {
      if (result.status === 'rejected') throw result.reason;
    }
    assert.equal((await target.query(`SELECT * FROM schema_migrations WHERE version = '9999'`)).rowCount, 1);

    // Upgrade an actual pre-versioning schema, not merely today's schema without its ledger.
    await target.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await target.query(fs.readFileSync(path.resolve(__dirname, 'fixtures/legacy-schema.sql'), 'utf8'));
    await target.query(`INSERT INTO users (id,email,tier) VALUES ('old-paid','old-paid@example.test','PRO')`);
    await runMigration({ pool: target });
    assert.equal((await target.query(`SELECT tier FROM users WHERE id = 'old-paid'`)).rows[0].tier, 'FREE');
    assert.equal((await target.query(`SELECT * FROM audit_log WHERE action = 'TIER_MIRROR_NORMALIZED'`)).rowCount, 1);
    await target.query('SELECT prediction_spec FROM verdicts LIMIT 0');
    await target.query('SELECT criteria_snapshot FROM prediction_episodes LIMIT 0');
    await target.query('SELECT past_due_since, stripe_payment_intent_id FROM subscriptions LIMIT 0');
    await runMigration({ pool: target });
    assert.equal((await target.query(`SELECT * FROM audit_log WHERE action = 'TIER_MIRROR_NORMALIZED'`)).rowCount, 1);
  } finally {
    await target.end();
    if (created) await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
    await pool.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
