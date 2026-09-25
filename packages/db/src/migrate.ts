import fs from 'fs';
import path from 'path';
import { pool, closePool } from './client';

export async function runMigration(): Promise<void> {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  console.log(`[migrate] Reading schema from: ${schemaPath}`);
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log('[migrate] Executing DDL statements...');
    await client.query(sql);

    const res = await client.query<{ table_name: string }>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log(`[migrate] Successfully migrated. Found ${res.rows.length} public tables:`);
    for (const row of res.rows) {
      console.log(`  - ${row.table_name}`);
    }
  } catch (err) {
    console.error('[migrate] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('[migrate] Done.');
      return closePool();
    })
    .catch(async (err) => {
      console.error('[migrate] Execution error:', err);
      await closePool();
      process.exit(1);
    });
}
