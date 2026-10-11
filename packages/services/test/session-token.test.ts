import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { query, closePool } from '@emeradar/db';
import { AuthService } from '../src';

/**
 * Session tokens are bearer credentials: whoever holds one is the user. They
 * must therefore be stored the way a password is — as a digest — so reading the
 * sessions table (a backup, a replica, a query log) yields nothing reusable.
 */
describe('Session token storage', () => {
  const email = 'session-hash@example.com';
  let rawToken = '';

  before(async () => {
    await query(`DELETE FROM users WHERE email = $1`, [email]);
  });

  after(async () => {
    await query(`DELETE FROM users WHERE email = $1`, [email]);
    await closePool();
  });

  it('registers a session whose stored value is a digest, not the token', async () => {
    const { user, sessionToken } = await AuthService.register({
      email,
      password: 'correct horse battery',
      displayName: 'Session Hash',
    });
    rawToken = sessionToken;

    const res = await query<{ session_token: string }>(
      `SELECT session_token FROM sessions WHERE user_id = $1`,
      [user.id]
    );
    const stored = res.rows[0].session_token;

    assert.notStrictEqual(stored, sessionToken, 'the raw token must never be stored');
    assert.match(stored, /^[0-9a-f]{64}$/, 'expected a SHA-256 hex digest');
    assert.strictEqual(stored, createHash('sha256').update(sessionToken).digest('hex'));
  });

  it('still resolves the session from the raw token', async () => {
    const session = await AuthService.getSessionUser(rawToken);
    assert.strictEqual(session?.user.email, email);
  });

  it('rejects a token that only matches the stored digest', async () => {
    const stored = createHash('sha256').update(rawToken).digest('hex');
    assert.strictEqual(await AuthService.getSessionUser(stored), null);
  });

  it('creates a fresh, independently hashed session on login', async () => {
    const { user, sessionToken } = await AuthService.login({
      email,
      password: 'correct horse battery',
    });
    assert.notStrictEqual(sessionToken, rawToken);

    const res = await query<{ session_token: string }>(
      `SELECT session_token FROM sessions WHERE user_id = $1`,
      [user.id]
    );
    assert.strictEqual(res.rows.length, 2);
    for (const row of res.rows) {
      assert.match(row.session_token, /^[0-9a-f]{64}$/);
    }
    assert.ok(!res.rows.some((row) => row.session_token === sessionToken));
  });

  it('revokes exactly the session presented to logout', async () => {
    const { sessionToken } = await AuthService.login({
      email,
      password: 'correct horse battery',
    });
    assert.ok(await AuthService.getSessionUser(sessionToken));

    await AuthService.logout(sessionToken);
    assert.strictEqual(await AuthService.getSessionUser(sessionToken), null);
    // The earlier sessions are untouched by logging out a different one.
    assert.ok(await AuthService.getSessionUser(rawToken));
  });
});
