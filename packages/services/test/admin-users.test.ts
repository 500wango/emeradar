import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdminService, AuthService } from '../src';

describe('Admin User Management Integration Tests', () => {
  const adminEmail = `admin_tester_${Date.now()}@emeradar.test`;
  let adminUserId = '';
  let targetUserId = '';
  const targetEmail = `target_user_${Date.now()}@emeradar.test`;

  it('should create an admin user and a target test user', async () => {
    // 1. Create admin user
    const adminCreated = await AdminService.createUserByAdmin({
      email: adminEmail,
      displayName: 'System Admin Tester',
      role: 'ADMIN',
      tier: 'TEAM',
    });
    assert.ok(adminCreated.user.id);
    assert.equal(adminCreated.user.role, 'ADMIN');
    assert.equal(adminCreated.user.tier, 'TEAM');
    adminUserId = adminCreated.user.id;

    // 2. Create regular user
    const targetCreated = await AdminService.createUserByAdmin({
      email: targetEmail,
      displayName: 'Regular Target User',
      role: 'USER',
      tier: 'FREE',
    });
    assert.ok(targetCreated.user.id);
    assert.equal(targetCreated.user.role, 'USER');
    assert.equal(targetCreated.user.tier, 'FREE');
    targetUserId = targetCreated.user.id;
  });

  it('should list users with stats and filter by role and search', async () => {
    const res = await AdminService.listUsers({ search: targetEmail, limit: 10 });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].email, targetEmail);
    assert.ok(res.stats.totalUsers >= 2);
    assert.ok(res.stats.staffUsers >= 1);
  });

  it('should update user role and tier', async () => {
    const updated = await AdminService.updateUser(adminUserId, targetUserId, {
      role: 'ANALYST',
      tier: 'PRO',
    });
    assert.equal(updated.role, 'ANALYST');
    assert.equal(updated.tier, 'PRO');
  });

  it('should prevent admin from suspending self', async () => {
    await assert.rejects(
      async () => {
        await AdminService.updateUser(adminUserId, adminUserId, {
          status: 'SUSPENDED',
        });
      },
      (err: any) => {
        assert.match(err.message, /cannot suspend/i);
        return true;
      }
    );
  });

  it('should suspend and reactivate target user', async () => {
    const suspended = await AdminService.updateUser(adminUserId, targetUserId, {
      status: 'SUSPENDED',
    });
    assert.equal(suspended.status, 'SUSPENDED');

    const reactivated = await AdminService.updateUser(adminUserId, targetUserId, {
      status: 'ACTIVE',
    });
    assert.equal(reactivated.status, 'ACTIVE');
  });

  it('should reset user password and verify login with new password', async () => {
    const newPwd = 'BrandNewPassword2026!';
    const resetRes = await AdminService.resetUserPassword(targetUserId, newPwd);
    assert.equal(resetRes.temporaryPassword, newPwd);

    // Verify login works with new password
    const loginRes = await AuthService.login({
      email: targetEmail,
      password: newPwd,
    });
    assert.ok(loginRes.sessionToken);
    assert.equal(loginRes.user.id, targetUserId);
  });
});
