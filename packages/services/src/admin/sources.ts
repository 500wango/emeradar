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
      last_run_at: string | null;
      last_status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
      last_error: string | null;
      last_items: number | null;
      runs_24h: number;
      failures_24h: number;
      last_success_at: string | null;
      circuit_open_until: string | null;
    }>(
      `SELECT s.id, s.type, s.name, s.config, s.is_active, s.tos_risk_level,
              s.created_at::text AS created_at,
              lr.started_at::text AS last_run_at,
              lr.status AS last_status,
              lr.error_message AS last_error,
              lr.items_collected AS last_items,
              stats.runs_24h,
              stats.failures_24h,
              ls.last_success_at::text AS last_success_at,
              scb.open_until::text AS circuit_open_until
         FROM sources s
         LEFT JOIN LATERAL (
           SELECT started_at, status, error_message, items_collected
             FROM collector_runs
            WHERE source_id = s.id
            ORDER BY started_at DESC
            LIMIT 1
         ) lr ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS runs_24h,
                  COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failures_24h
             FROM collector_runs
            WHERE source_id = s.id
              AND started_at > NOW() - INTERVAL '24 hours'
         ) stats ON true
         LEFT JOIN LATERAL (
           SELECT MAX(finished_at)::text AS last_success_at
             FROM collector_runs
            WHERE source_id = s.id AND status = 'SUCCESS'
         ) ls ON true
         LEFT JOIN source_circuit_breakers scb ON scb.source_id = s.id
        ORDER BY s.created_at ASC`
    );

    return res.rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      config: r.config || {},
      isActive: r.is_active,
      tosRiskLevel: r.tos_risk_level,
      createdAt: r.created_at,
      health: {
        lastRunAt: r.last_run_at,
        lastStatus: r.last_status,
        lastError: r.last_error,
        lastItems: r.last_items,
        runs24h: r.runs_24h,
        failures24h: r.failures_24h,
        failureRate24h: r.runs_24h > 0 ? r.failures_24h / r.runs_24h : 0,
        lastSuccessAt: r.last_success_at,
        circuitOpen:
          r.circuit_open_until !== null && new Date(r.circuit_open_until).getTime() > Date.now(),
        circuitOpenUntil: r.circuit_open_until,
      },
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
      health: {
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
        lastItems: null,
        runs24h: 0,
        failures24h: 0,
        failureRate24h: 0,
        lastSuccessAt: null,
        circuitOpen: false,
        circuitOpenUntil: null,
      },
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
