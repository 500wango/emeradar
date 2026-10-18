import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';

export const RADAR_WINDOW_DAYS = 7;

export interface CustomQueryRadar {
  id: string;
  opportunityId: string;
  query: string;
  startedAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED';
  confirmedAt: string | null;
}

/**
 * 自定义词 7 天脉冲雷达（PRD F3 第 2 阶段、12 §2 `CUSTOM_QUERY_PULSE_CONFIRMED`）。
 *
 * 即时初筛（`LiveScanService`）把词变成 CANDIDATE 机会；Pro 用户可以把这条机会加入
 * 雷达。雷达在 7 天内盯住它，一旦裁决晋升 `BUILD_NOW`（快车道脉冲确认）就推一条
 * 站内通知并落 `CONFIRMED`，而不是让用户自己每天来刷。
 *
 * 配额：入雷达本身不另扣额度——初筛那一步已经扣过 `live_scan_*`；这里只要求
 * `pulse_radar` 权益（Pro 起）。Free 没有雷达。
 */
export class CustomQueryRadarService {
  static async enroll(userId: string, opportunityId: string): Promise<CustomQueryRadar> {
    const ent = await EntitlementService.getUserEntitlements(userId);
    if (!ent.pulseRadar) {
      throw new EmeradarError(
        ErrorCode.PLAN_REQUIRED,
        'The 7-day custom-query radar is available on Builder Pro and Team plans.',
        403,
        { upgradeUrl: '/pricing', currentPlan: 'FREE' }
      );
    }

    const oppRes = await query<{ id: string; slug: string; title: string; status: string; verdict: string | null; primary_query: string | null }>(
      `SELECT o.id, o.slug, o.title, o.status, c.verdict, c.primary_query
         FROM opportunities o
         LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
        WHERE o.id = $1`,
      [opportunityId]
    );
    const opp = oppRes.rows[0];
    if (!opp) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Opportunity not found: ${opportunityId}`, 404);
    }
    if (opp.status !== 'CANDIDATE' && opp.status !== 'TRACKED') {
      throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Only a tracked or candidate opportunity can be put on the radar.', 409);
    }
    // 已经可行动的机会不需要雷达：它现在就值得看。雷达只服务"还没确认"的词。
    if (opp.verdict === 'BUILD_NOW' || opp.verdict === 'EARLY_BET') {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'This opportunity is already actionable; the radar is for candidates awaiting pulse confirmation.',
        409
      );
    }

    const row = await transaction(async (client) => {
      const res = await client.query<{
        id: string;
        opportunity_id: string;
        query: string;
        started_at: Date;
        expires_at: Date;
        status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED';
        confirmed_at: Date | null;
      }>(
        `INSERT INTO custom_query_radars (id, user_id, opportunity_id, query, started_at, expires_at, status)
         VALUES ($1, $2, $3, $4, NOW(), NOW() + ($5 || ' days')::interval, 'ACTIVE')
         ON CONFLICT (user_id, opportunity_id) DO UPDATE SET
           query = EXCLUDED.query,
           started_at = EXCLUDED.started_at,
           expires_at = EXCLUDED.expires_at,
           status = 'ACTIVE',
           confirmed_at = NULL
         RETURNING id, opportunity_id, query, started_at, expires_at, status, confirmed_at`,
        [
          `radar_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          userId,
          opp.id,
          opp.primary_query || opp.title,
          RADAR_WINDOW_DAYS,
        ]
      );
      return res.rows[0];
    });

    return {
      id: row.id,
      opportunityId: row.opportunity_id,
      query: row.query,
      startedAt: row.started_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      status: row.status,
      confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    };
  }

  static async list(userId: string): Promise<CustomQueryRadar[]> {
    const res = await query<any>(
      `SELECT id, opportunity_id, query, started_at, expires_at, status, confirmed_at
         FROM custom_query_radars
        WHERE user_id = $1
        ORDER BY started_at DESC`,
      [userId]
    );
    return res.rows.map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      query: row.query,
      startedAt: new Date(row.started_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      status: row.status,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    }));
  }

  /**
   * 每轮 S7 调用：过期清扫 + 对已经晋升 BUILD_NOW 的雷达推送并确认。
   *
   * 幂等：通知 id 带 obsDate 与雷达 id；雷达状态一旦 CONFIRMED 就不再进入候选集。
   */
  static async confirmDue(obsDate: string): Promise<{ confirmed: number; expired: number }> {
    return transaction(async (client) => {
      const expired = await client.query(
        `UPDATE custom_query_radars
            SET status = 'EXPIRED'
          WHERE status = 'ACTIVE' AND expires_at <= NOW()`
      );

      const due = await client.query<{
        id: string;
        user_id: string;
        opportunity_id: string;
        query: string;
      }>(
        `SELECT r.id, r.user_id, r.opportunity_id, r.query
           FROM custom_query_radars r
           JOIN opportunity_cards c ON c.opportunity_id = r.opportunity_id
           JOIN opportunities o ON o.id = r.opportunity_id
          WHERE r.status = 'ACTIVE'
            AND r.expires_at > NOW()
            AND c.verdict = 'BUILD_NOW'
            AND o.status = 'TRACKED'`
      );

      for (const row of due.rows) {
        await client.query(
          `INSERT INTO notifications (id, user_id, title, body, opportunity_id)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [
            `ntf_radar_${row.id}_${obsDate}`,
            row.user_id,
            `Custom query pulse confirmed: ${row.query}`,
            `${row.query}: your 7-day radar confirmed the demand pulse and the verdict is now BUILD_NOW. Move before the window closes.`,
            row.opportunity_id,
          ]
        );
        await client.query(
          `UPDATE custom_query_radars SET status = 'CONFIRMED', confirmed_at = NOW() WHERE id = $1`,
          [row.id]
        );
      }

      return { confirmed: due.rows.length, expired: expired.rowCount ?? 0 };
    });
  }
}
