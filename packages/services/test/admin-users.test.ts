import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '@emeradar/db';
import { AdminService, AuthService } from '../src';

describe('Admin User Management Integration Tests', () => {
  const adminEmail = `admin_tester_${Date.now()}@emeradar.test`;
  let adminUserId = '';
  let targetUserId = '';
  const targetEmail = `target_user_${Date.now()}@emeradar.test`;

  it('should create an admin user and a target test user', async () => {
    // 1. Seed the first administrator directly (bootstrap bypasses the
    //    admin-caller guard, which otherwise requires an existing ADMIN).
    const seededAdminId = `usr_seed_${Date.now().toString(36)}`;
    await query(
      `INSERT INTO users (id, email, display_name, role, tier, status)
       VALUES ($1, $2, $3, 'ADMIN', 'TEAM', 'ACTIVE')`,
      [seededAdminId, adminEmail, 'System Admin Tester']
    );
    adminUserId = seededAdminId;
    const adminCheck = await AdminService.getUserById(seededAdminId);
    assert.ok(adminCheck?.id);
    assert.equal(adminCheck?.role, 'ADMIN');
    assert.equal(adminCheck?.tier, 'TEAM');

    // 2. Create regular user through the guarded method (caller must be ADMIN)
    const targetCreated = await AdminService.createUserByAdmin(adminUserId, {
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

  it('should reject non-admin callers for privileged operations', async () => {
    // Create an ANALYST via a real ADMIN...
    const analystCreated = await AdminService.createUserByAdmin(adminUserId, {
      email: `analyst_${Date.now()}@emeradar.test`,
      displayName: 'Analyst Staff',
      role: 'ANALYST',
    });
    const analystId = analystCreated.user.id;

    // ...then assert the ANALYST cannot create admin users, change roles or reset passwords.
    await assert.rejects(
      () => AdminService.createUserByAdmin(analystId, { email: `evil_${Date.now()}@emeradar.test`, role: 'ADMIN' }),
      /Only an active Administrator/i
    );
    await assert.rejects(
      () => AdminService.updateUser(analystId, targetUserId, { role: 'ADMIN' }),
      /Only an active Administrator/i
    );
    await assert.rejects(
      () => AdminService.resetUserPassword(analystId, targetUserId, 'Whatever123!'),
      /Only an active Administrator/i
    );
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
    const resetRes = await AdminService.resetUserPassword(adminUserId, targetUserId, newPwd);
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
