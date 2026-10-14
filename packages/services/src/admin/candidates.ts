import { query, transaction } from '@emeradar/db';
import { AppError } from '@emeradar/core';
import { AuditService } from '../audit.service';
import { SlotService } from '../slot.service';
import type { AdminCandidateItem } from './types';

export class AdminCandidateService {
  /**
   * Lists candidate opportunities with filtering and observation depth
   */
  static async listCandidates(options?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdminCandidateItem[]; total: number }> {
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = Math.max(0, options?.offset || 0);
    const search = options?.search?.trim();

    let whereClause = `WHERE o.status = 'CANDIDATE'`;
    const params: any[] = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      whereClause += ` AND (LOWER(o.title) LIKE $${params.length} OR LOWER(COALESCE(q.query_text, '')) LIKE $${params.length})`;
    }

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM opportunities o
       LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
       LEFT JOIN queries q ON q.id = oq.query_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listParams = [...params, limit, offset];
    const itemsRes = await query<{
      id: string;
      slug: string;
      title: string;
      primary_query: string | null;
      status: string;
      market_country: string;
      research_language: string;
      first_observed_date: string | null;
      observation_days: string;
      discovery_source: string | null;
      candidate_reason: string | null;
      recommended_archetype: string;
      execution_class: string;
    }>(
      `SELECT o.id, o.slug, o.title, q.query_text AS primary_query, o.status,
              o.market_country, o.research_language, o.first_observed_date::text,
              COALESCE(obs.days_count, 0)::text AS observation_days,
              o.discovery_source, o.candidate_reason,
              o.recommended_archetype, o.execution_class
       FROM opportunities o
       LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
       LEFT JOIN queries q ON q.id = oq.query_id
       LEFT JOIN (
         SELECT query_id, COUNT(DISTINCT observed_date) AS days_count
         FROM autocomplete_observations
         GROUP BY query_id
       ) obs ON obs.query_id = q.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return {
      total,
      items: itemsRes.rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        primaryQuery: r.primary_query || r.title,
        status: r.status,
        marketCountry: r.market_country,
        researchLanguage: r.research_language,
        firstObservedDate: r.first_observed_date || 'N/A',
        observationDays: parseInt(r.observation_days, 10) || 0,
        discoverySource: r.discovery_source,
        candidateReason: r.candidate_reason,
        recommendedArchetype: r.recommended_archetype,
        executionClass: r.execution_class,
      })),
    };
  }

  /**
   * Moderates a candidate opportunity (e.g. discard as ARCHIVED or promote to TRACKED)
   */
  static async moderateCandidate(
    opportunityId: string,
    action: 'ARCHIVE' | 'PROMOTE_TO_TRACKED',
    actorId: string | null = null
  ): Promise<{ success: boolean; newStatus: string }> {
    if (action === 'ARCHIVE') {
      const res = await query(
        `UPDATE opportunities SET status = 'ARCHIVED' WHERE id = $1`,
        [opportunityId]
      );
      if ((res.rowCount ?? 0) === 0) {
        throw AppError.notFound('Opportunity not found.');
      }
      await AuditService.log({
        actorId,
        actorType: actorId ? 'ADMIN' : 'SYSTEM',
        action: 'candidate.archive',
        targetType: 'opportunity',
        targetId: opportunityId,
      });
      return { success: true, newStatus: 'ARCHIVED' };
    }

    if (action === 'PROMOTE_TO_TRACKED') {
      const candidate = await query<{
        status: string;
        verdict: string;
        confidence: string;
        m_band: string;
        recommended_archetype: string;
      }>(
        `SELECT o.status, c.verdict, c.confidence, c.m_band, c.recommended_archetype
         FROM opportunities o JOIN opportunity_cards c ON c.opportunity_id = o.id
         WHERE o.id = $1`,
        [opportunityId]
      );
      const row = candidate.rows[0];
      if (!row) throw AppError.notFound('Opportunity not found.');
      if (row.status !== 'CANDIDATE') throw AppError.badRequest('Only candidates can be promoted.');
      if (!['BUILD_NOW', 'EARLY_BET'].includes(row.verdict) || row.confidence === 'LOW' || row.m_band === 'INSUFFICIENT') {
        throw AppError.badRequest('Candidate cannot be promoted before the real observation pipeline produces a publishable verdict.');
      }
      await query(`UPDATE opportunities SET status = 'TRACKED', updated_at = NOW() WHERE id = $1`, [opportunityId]);
      // 人工提升同样要物化槽位，否则这条机会会带着"零槽位"上线：任何人点 GO 都会
      // 拿到 400（这个形态没开放），而前端的槽位面板会是一片空白。这里只能拿到推荐
      // 形态（推荐层的前三名没有落库），所以是单形态的一条队——补不出历史就不假装
      // 补得出，与 0004 的回填口径一致。
      await transaction(async (client) => {
        await SlotService.materialize(client, opportunityId, [row.recommended_archetype]);
      });
      await AuditService.log({
        actorId,
        actorType: actorId ? 'ADMIN' : 'SYSTEM',
        action: 'candidate.promote',
        targetType: 'opportunity',
        targetId: opportunityId,
        payload: { verdict: row.verdict, confidence: row.confidence },
      });
      // Promotion never manufactures scores, SERP rows, or commercial evidence.
      // A candidate that has not cleared the observation pipeline cannot be
      // promoted, and there is deliberately no legacy fallback that would.
      return { success: true, newStatus: 'TRACKED' };
    }

    throw AppError.badRequest('Invalid action.');
  }
}
