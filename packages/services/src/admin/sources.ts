import { query } from '@emeradar/db';
import { AppError } from '@emeradar/core';
import { AuditService } from '../audit.service';
import type { AdminSourceItem } from './types';

export class AdminSourceService {
  /**
   * Lists all configured signal sources
   */
  static async listSources(): Promise<AdminSourceItem[]> {
    const res = await query<{
      id: string;
      type: string;
      name: string;
      config: Record<string, any>;
      is_active: boolean;
      tos_risk_level: string;
      created_at: string;
    }>(
      `SELECT id, type, name, config, is_active, tos_risk_level, created_at::text
       FROM sources
       ORDER BY created_at ASC`
    );

    return res.rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      config: r.config || {},
      isActive: r.is_active,
      tosRiskLevel: r.tos_risk_level,
      createdAt: r.created_at,
    }));
  }

  /**
   * Adds an RSS signal source
   */
  static async addRssSource(name: string, url: string, actorId: string | null = null): Promise<AdminSourceItem> {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      throw AppError.badRequest('Name and Feed URL are required.');
    }

    const sourceId = `src_rss_${Date.now()}`;
    await query(
      `INSERT INTO sources (id, type, name, config, tos_risk_level, is_active)
       VALUES ($1, 'DISCOVERY', $2, $3, 'LOW', true)`,
      [sourceId, trimmedName, JSON.stringify({ url: trimmedUrl, provider: 'RSS' })]
    );

    await AuditService.log({
      actorId,
      actorType: actorId ? 'ADMIN' : 'SYSTEM',
      action: 'source.add',
      targetType: 'source',
      targetId: sourceId,
      payload: { name: trimmedName, url: trimmedUrl },
    });

    const created = await query<any>(`SELECT * FROM sources WHERE id = $1`, [sourceId]);
    const r = created.rows[0];
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      config: r.config || {},
      isActive: r.is_active,
      tosRiskLevel: r.tos_risk_level,
      createdAt: r.created_at,
    };
  }

  /**
   * Toggles active state of a source
   */
  static async toggleSource(sourceId: string, isActive: boolean, actorId: string | null = null): Promise<void> {
    const res = await query(`UPDATE sources SET is_active = $1 WHERE id = $2`, [isActive, sourceId]);
    if ((res.rowCount ?? 0) === 0) {
      throw AppError.notFound('Source not found.');
    }
    await AuditService.log({
      actorId,
      actorType: actorId ? 'ADMIN' : 'SYSTEM',
      action: 'source.toggle',
      targetType: 'source',
      targetId: sourceId,
      payload: { isActive },
    });
  }
}
