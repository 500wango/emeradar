import { randomUUID } from 'node:crypto';
import { query } from '@emeradar/db';

export type AuditActorType = 'USER' | 'ADMIN' | 'SYSTEM';

export interface AuditEntry {
  actorId: string | null;
  actorType: AuditActorType;
  /** Stable, greppable verb, e.g. `user.update`, `user.password_reset`. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Writes the security audit trail consumed by `audit_log`.
 *
 * Auditing is best-effort by design: a failure here must never roll back or
 * mask the privileged operation it describes, but it is logged loudly so the
 * gap is visible in operations.
 */
export class AuditService {
  static async log(entry: AuditEntry): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_log (id, actor_id, actor_type, action, target_type, target_id, payload, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `aud_${randomUUID()}`,
          entry.actorId,
          entry.actorType,
          entry.action,
          entry.targetType ?? null,
          entry.targetId ?? null,
          JSON.stringify(entry.payload ?? {}),
          sanitizeIp(entry.ip),
        ]
      );
    } catch (err) {
      console.error('[audit] Failed to record audit entry', entry.action, err);
    }
  }
}

/** `ip` is INET; anything that is not a bare address would abort the insert. */
function sanitizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const value = ip.trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(value) ? value : null;
}
