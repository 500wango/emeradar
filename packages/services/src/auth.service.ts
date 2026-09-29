import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
  tier: 'FREE' | 'PRO' | 'TEAM';
  status: string;
  createdAt: Date;
}

export interface UserPreferencesData {
  uiLocale: 'zh-CN' | 'en-US';
  preferredBuildTypes: string[];
  preferredMarkets: string[];
  preferredTimeBudget?: string;
  topics: string[];
  onboardingCompleted: boolean;
}

export interface ApiKeyItem {
  id: string;
  label: string;
  scopes: string[];
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export class AuthService {
  /**
   * Hashes a password with salt using PBKDF2/scrypt
   */
  static hashPassword(password: string, salt = 'emeradar_salt_2026'): string {
    const key = scryptSync(password, salt, 32);
    return key.toString('hex');
  }

  /**
   * Registers a new user with email and password
   */
  static async register(input: {
    email: string;
    password: string;
    displayName?: string;
    tier?: 'FREE' | 'PRO' | 'TEAM';
  }): Promise<{ user: UserProfile; sessionToken: string }> {
    const email = input.email.trim().toLowerCase();

    // Check if user already exists
    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (existing.rows.length > 0) {
      throw new EmeradarError(
        ErrorCode.CONFLICT,
        'An account with this email address already exists.',
        409
      );
    }

    const userId = `usr_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    const passwordHash = this.hashPassword(input.password);
    const tier = input.tier || 'FREE';
    const displayName = input.displayName || email.split('@')[0];

    const sessionToken = `sess_${randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await transaction(async (client) => {
      // 1. Insert user
      await client.query(
        `INSERT INTO users (id, email, display_name, role, tier, status)
         VALUES ($1, $2, $3, 'USER', $4, 'ACTIVE')`,
        [userId, email, displayName, tier]
      );

      // 2. Insert credentials account
      await client.query(
        `INSERT INTO accounts (id, user_id, type, provider, provider_account_id, refresh_token)
         VALUES ($1, $2, 'credentials', 'credentials', $3, $4)`,
        [`acc_${userId}`, userId, email, passwordHash]
      );

      // 3. Insert default preferences
      await client.query(
        `INSERT INTO user_preferences (user_id, ui_locale, preferred_markets, preferred_build_types)
         VALUES ($1, 'zh-CN', '{"US"}', '{"LIGHTWEIGHT_TOOL","MICRO_SAAS"}')`,
        [userId]
      );

      // 4. Create active session
      await client.query(
        `INSERT INTO sessions (id, session_token, user_id, expires)
         VALUES ($1, $2, $3, $4)`,
        [`sess_id_${userId}`, sessionToken, userId, expiresAt]
      );
    });

    const user = (await this.getUserById(userId))!;
    return { user, sessionToken };
  }

  /** Logs in an active user after verifying credentials. */
  static async login(input: {
    email: string;
    password?: string;
  }): Promise<{ user: UserProfile; sessionToken: string }> {
    const email = input.email.trim().toLowerCase();

    const userRes = await query<any>(
      `SELECT id, email, display_name, avatar_url, role, tier, status, created_at
       FROM users WHERE email = $1 AND status = 'ACTIVE'`,
      [email]
    );

    if (userRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        'No active account found with this email address.',
        404
      );
    }

    const row = userRes.rows[0];

    const accRes = await query<{ refresh_token: string }>(
      `SELECT refresh_token FROM accounts
       WHERE user_id = $1 AND provider = 'credentials'`,
      [row.id]
    );

    if (accRes.rows.length === 0 || !accRes.rows[0].refresh_token) {
      throw new EmeradarError(ErrorCode.UNAUTHENTICATED, 'Incorrect credentials.', 401);
    }
    const expectedHash = accRes.rows[0].refresh_token;
    const inputHash = this.hashPassword(input.password || '');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    const inputBuf = Buffer.from(inputHash, 'hex');

    if (
      expectedBuf.length !== inputBuf.length ||
      !timingSafeEqual(expectedBuf, inputBuf)
    ) {
      throw new EmeradarError(
        ErrorCode.UNAUTHENTICATED,
        'Incorrect password. Please verify and try again.',
        401
      );
    }

    // Create session
    const sessionToken = `sess_${randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO sessions (id, session_token, user_id, expires)
       VALUES ($1, $2, $3, $4)`,
      [`sess_id_${Date.now()}_${randomBytes(3).toString('hex')}`, sessionToken, row.id, expiresAt]
    );

    const user: UserProfile = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      role: row.role,
      tier: row.tier,
      status: row.status,
      createdAt: row.created_at,
    };

    return { user, sessionToken };
  }

  /**
   * Retrieves active session user and preferences by session token
   */
  static async getSessionUser(sessionToken: string): Promise<{
    user: UserProfile;
    preferences: UserPreferencesData;
  } | null> {
    if (!sessionToken) return null;

    const res = await query<any>(
      `SELECT 
        u.id, u.email, u.display_name, u.avatar_url, u.role, u.tier, u.status, u.created_at,
        p.ui_locale, p.preferred_build_types, p.preferred_markets, p.preferred_time_budget,
        p.topics, p.onboarding_completed
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_preferences p ON p.user_id = u.id
       WHERE s.session_token = $1 AND s.expires > NOW() AND u.status = 'ACTIVE'`,
      [sessionToken]
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];

    return {
      user: {
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        role: r.role,
        tier: r.tier,
        status: r.status,
        createdAt: r.created_at,
      },
      preferences: {
        uiLocale: r.ui_locale || 'zh-CN',
        preferredBuildTypes: r.preferred_build_types || [],
        preferredMarkets: r.preferred_markets || ['US'],
        preferredTimeBudget: r.preferred_time_budget,
        topics: r.topics || [],
        onboardingCompleted: r.onboarding_completed ?? true,
      },
    };
  }

  /**
   * Deletes session on logout
   */
  static async logout(sessionToken: string): Promise<void> {
    await query(`DELETE FROM sessions WHERE session_token = $1`, [sessionToken]);
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId: string): Promise<UserProfile | null> {
    const res = await query<any>(
      `SELECT id, email, display_name, avatar_url, role, tier, status, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      role: r.role,
      tier: r.tier,
      status: r.status,
      createdAt: r.created_at,
    };
  }

  /**
   * Update user research preferences
   */
  static async updatePreferences(
    userId: string,
    prefs: Partial<UserPreferencesData>
  ): Promise<UserPreferencesData> {
    await query(
      `INSERT INTO user_preferences (
        user_id, ui_locale, preferred_markets, preferred_build_types, onboarding_completed
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         ui_locale = COALESCE($2, user_preferences.ui_locale),
         preferred_markets = COALESCE($3, user_preferences.preferred_markets),
         preferred_build_types = COALESCE($4, user_preferences.preferred_build_types),
         onboarding_completed = COALESCE($5, user_preferences.onboarding_completed)`,
      [
        userId,
        prefs.uiLocale ?? 'zh-CN',
        prefs.preferredMarkets ?? [],
        prefs.preferredBuildTypes ?? [],
        prefs.onboardingCompleted ?? false,
      ]
    );

    const updated = await query<any>(
      `SELECT ui_locale, preferred_build_types, preferred_markets, preferred_time_budget, topics, onboarding_completed
       FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    const r = updated.rows[0];
    return {
      uiLocale: r.ui_locale,
      preferredBuildTypes: r.preferred_build_types || [],
      preferredMarkets: r.preferred_markets || [],
      preferredTimeBudget: r.preferred_time_budget,
      topics: r.topics || [],
      onboardingCompleted: r.onboarding_completed,
    };
  }

  /**
   * List API Keys for a user
   */
  static async listApiKeys(userId: string): Promise<ApiKeyItem[]> {
    const res = await query<any>(
      `SELECT id, label, scopes, key_hash, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return res.rows.map((r) => ({
      id: r.id,
      label: r.label,
      scopes: r.scopes || ['opportunities:read'],
      keyPrefix: `emd_live_${r.id.slice(-4)}...`,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
    }));
  }

  /**
   * Creates a new API Key for developer API access
   */
  static async createApiKey(
    userId: string,
    label: string,
    scopes = ['opportunities:read']
  ): Promise<{ apiKey: ApiKeyItem; rawSecretKey: string }> {
    const keyId = `key_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
    const rawSecretKey = `emd_live_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawSecretKey).digest('hex');

    await query(
      `INSERT INTO api_keys (id, user_id, key_hash, label, scopes)
       VALUES ($1, $2, $3, $4, $5)`,
      [keyId, userId, keyHash, label, scopes]
    );

    return {
      apiKey: {
        id: keyId,
        label,
        scopes,
        keyPrefix: `emd_live_${keyId.slice(-4)}...`,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      },
      rawSecretKey,
    };
  }

  /**
   * Revoke an API Key
   */
  static async revokeApiKey(userId: string, keyId: string): Promise<void> {
    await query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2`,
      [keyId, userId]
    );
  }
}
