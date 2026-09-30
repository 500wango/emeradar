import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src';

describe('AuthService Integration Tests', () => {
  const testEmail = `builder_${Date.now()}@emeradar.test`;

  it('should register a new user and return active session', async () => {
    const res = await AuthService.register({
      email: testEmail,
      password: 'StrongPassword123!',
      displayName: 'Test Builder',
    });

    assert.ok(res.user.id.startsWith('usr_'));
    assert.equal(res.user.email, testEmail);
    assert.equal(res.user.displayName, 'Test Builder');
    assert.equal(res.user.tier, 'FREE');
    assert.ok(res.sessionToken.startsWith('sess_'));

    // Verify session retrieval
    const sessionData = await AuthService.getSessionUser(res.sessionToken);
    assert.ok(sessionData);
    assert.equal(sessionData?.user.id, res.user.id);
    assert.equal(sessionData?.preferences.uiLocale, 'zh-CN');
  });

  it('should reject duplicate registration with 409 conflict', async () => {
    await assert.rejects(
      async () => {
        await AuthService.register({
          email: testEmail,
          password: 'AnotherPassword456!',
        });
      },
      (err: any) => {
        assert.equal(err.code, 'CONFLICT');
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it('should login with correct credentials', async () => {
    const res = await AuthService.login({
      email: testEmail,
      password: 'StrongPassword123!',
    });

    assert.ok(res.user);
    assert.equal(res.user.email, testEmail);
    assert.ok(res.sessionToken);
  });

  it('should reject login with wrong password', async () => {
    await assert.rejects(
      async () => {
        await AuthService.login({
          email: testEmail,
          password: 'WrongPassword!',
        });
      },
      (err: any) => {
        assert.equal(err.code, 'UNAUTHENTICATED');
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('should create, list, and revoke developer API keys', async () => {
    const login = await AuthService.login({ email: testEmail, password: 'StrongPassword123!' });
    const userId = login.user.id;

    // Create API key
    const created = await AuthService.createApiKey(userId, 'Production Worker Key', [
      'opportunities:read',
      'reports:export',
    ]);

    assert.ok(created.rawSecretKey.startsWith('emd_live_'));
    assert.equal(created.apiKey.label, 'Production Worker Key');

    // List API keys
    const list = await AuthService.listApiKeys(userId);
    assert.ok(list.some((k) => k.id === created.apiKey.id && k.revokedAt === null));

    // Revoke key
    await AuthService.revokeApiKey(userId, created.apiKey.id);
    const updatedList = await AuthService.listApiKeys(userId);
    const revoked = updatedList.find((k) => k.id === created.apiKey.id);
    assert.ok(revoked?.revokedAt !== null);
  });

  it('should update user preferences', async () => {
    const login = await AuthService.login({ email: testEmail, password: 'StrongPassword123!' });
    const userId = login.user.id;

    const updated = await AuthService.updatePreferences(userId, {
      uiLocale: 'en-US',
      preferredMarkets: ['US', 'GLOBAL'],
      preferredBuildTypes: ['MICRO_SAAS', 'PSEO_SITE'],
    });

    assert.equal(updated.uiLocale, 'en-US');
    assert.deepEqual(updated.preferredMarkets, ['US', 'GLOBAL']);
    assert.deepEqual(updated.preferredBuildTypes, ['MICRO_SAAS', 'PSEO_SITE']);
  });
});
