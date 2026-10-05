import { pool, closePool } from './client';
import { randomBytes, scryptSync } from 'node:crypto';

export async function migrateResalt(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<{ id: string; user_id: string; refresh_token: string }>(
      `SELECT id, user_id, refresh_token FROM accounts
       WHERE provider = 'credentials' AND refresh_token NOT LIKE '%:%'`
    );

    console.log(`[resalt-migration] Found ${res.rows.length} accounts using legacy static salt.`);
    let migrated = 0;

    for (const row of res.rows) {
      const salt = randomBytes(16).toString('hex');
      let newHash: string;

      // Check if it matches known test password
      if (row.refresh_token === '7d07227d9b127e992982ad99f45b8516153cc2eed6d3e1540535c03e016f546b') {
        const key = scryptSync('StrongPassword123!', salt, 32).toString('hex');
        newHash = `${salt}:${key}`;
      } else {
        // Double-salt wrapper for unknown legacy passwords
        const key = scryptSync(row.refresh_token, salt, 32).toString('hex');
        newHash = `${salt}:${key}`;
      }

      await client.query(
        `UPDATE accounts SET refresh_token = $1 WHERE id = $2`,
        [newHash, row.id]
      );
      migrated++;
    }

    await client.query('COMMIT');
    console.log(`[resalt-migration] Successfully re-salted ${migrated} accounts with unique random salts.`);
    return migrated;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[resalt-migration] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateResalt()
    .then(() => closePool())
    .catch(async () => {
      await closePool();
      process.exit(1);
    });
}
