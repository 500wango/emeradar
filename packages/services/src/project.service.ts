import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode, BuildArchetype } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';

export interface CreateProjectInput {
  opportunityId: string;
  decisionId?: string;
  reportId?: string;
  title: string;
  domain?: string;
  buildType?: BuildArchetype;
  targetKeywords?: string[];
}

export interface GscWeeklyDetailInput {
  weekStartDate: string;
  pageUrl?: string;
  query?: string;
  impressions: number;
  clicks: number;
  averagePosition?: number;
  source?: 'GSC' | 'SELF_REPORTED';
}

export interface GscSearchAnalyticsRow {
  date: string;
  page?: string;
  query?: string;
  impressions: number;
  clicks: number;
  position?: number;
}

export class ProjectService {
  static async syncGscSearchAnalytics(
    projectId: string,
    userId: string,
    rows: GscSearchAnalyticsRow[]
  ): Promise<{ count: number; weekStartDates: string[] }> {
    const grouped = new Map<string, Map<string, GscWeeklyDetailInput>>();
    for (const row of rows) {
      const date = new Date(`${row.date}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      const week = date.toISOString().slice(0, 10);
      const byKey = grouped.get(week) || new Map<string, GscWeeklyDetailInput>();
      const pageUrl = row.page || '';
      const queryText = row.query || '';
      const key = `${pageUrl}\u0000${queryText}`;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, { weekStartDate: week, pageUrl, query: queryText, impressions: row.impressions, clicks: row.clicks, averagePosition: row.position, source: 'GSC' });
      } else {
        const totalImpressions = current.impressions + row.impressions;
        current.averagePosition = totalImpressions > 0
          ? ((current.averagePosition || 0) * current.impressions + (row.position || 0) * row.impressions) / totalImpressions
          : 0;
        current.impressions = totalImpressions;
        current.clicks += row.clicks;
      }
      grouped.set(week, byKey);
    }
    let count = 0;
    for (const [week, byKey] of grouped.entries()) {
      const list = [...byKey.values()];
      count += (await this.upsertGscWeeklyDetails(projectId, userId, list)).count;
      const impressions = list.reduce((sum, row) => sum + row.impressions, 0);
      const clicks = list.reduce((sum, row) => sum + row.clicks, 0);
      const averagePosition = impressions > 0
        ? list.reduce((sum, row) => sum + (row.averagePosition || 0) * row.impressions, 0) / impressions
        : 0;
      await query(
        `INSERT INTO gsc_metrics_weekly (project_id, week_start_date, impressions, clicks, average_position)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, week_start_date) DO UPDATE SET
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, average_position = EXCLUDED.average_position`,
        [projectId, week, impressions, clicks, averagePosition]
      );
    }
    return { count, weekStartDates: [...grouped.keys()] };
  }
  static async upsertGscWeeklyDetails(
    projectId: string,
    userId: string,
    rows: GscWeeklyDetailInput[]
  ): Promise<{ count: number }> {
    const owned = await query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
    if (owned.rows.length === 0) throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    for (const row of rows) {
      await query(
        `INSERT INTO gsc_metrics_weekly_detail
          (project_id, week_start_date, page_url, query, impressions, clicks, average_position, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (project_id, week_start_date, page_url, query) DO UPDATE SET
           impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks,
           average_position = EXCLUDED.average_position,
           source = EXCLUDED.source`,
        [projectId, row.weekStartDate, row.pageUrl || '', row.query || '', row.impressions, row.clicks, row.averagePosition || 0, row.source || 'GSC']
      );
    }
    return { count: rows.length };
  }

  /**
   * Create a new tracking project linked to an opportunity decision
   */
  static async createProject(
    userId: string,
    input: CreateProjectInput
  ): Promise<any> {
    const cardRes = await query<{ verdict: string; confidence: string; status: string }>(
      `SELECT c.verdict, c.confidence, o.status
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE c.opportunity_id = $1`,
      [input.opportunityId]
    );
    const card = cardRes.rows[0];
    const publishable =
      card &&
      card.status === 'TRACKED' &&
      (card.verdict === 'BUILD_NOW' || card.verdict === 'EARLY_BET') &&
      card.confidence !== 'LOW';
    if (!publishable) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'A project can only be created from a published BUILD NOW or EARLY BET. This opportunity is still under observation.',
        409
      );
    }

    const ent = await EntitlementService.getUserEntitlements(userId);
    if (ent.currentProjectsCount >= ent.maxProjects) {
      throw new EmeradarError(
        ErrorCode.QUOTA_EXCEEDED,
        `You have reached the maximum allowed projects (${ent.maxProjects}) for your plan. Please upgrade to create more projects.`,
        403,
        { currentProjects: ent.currentProjectsCount, maxProjects: ent.maxProjects }
      );
    }

    // Ensure decision exists or create GO decision
    let decisionId = input.decisionId;
    if (!decisionId) {
      const verdictRes = await query<{ id: string }>(
        `SELECT id FROM verdicts WHERE opportunity_id = $1 ORDER BY obs_date DESC LIMIT 1`,
        [input.opportunityId]
      );
      const verdictId = verdictRes.rows[0]?.id || `vdt_${input.opportunityId}_today`;

      const dcsId = `dcs_${Date.now()}`;
      await query(
        `INSERT INTO decisions (id, opportunity_id, user_id, decision, verdict_id, reasons, channel)
         VALUES ($1, $2, $3, 'GO', $4, '{"Direct project initiation"}', 'WEB')`,
        [dcsId, input.opportunityId, userId, verdictId]
      );
      decisionId = dcsId;
    } else {
      const decisionRes = await query<{ id: string }>(
        `SELECT id FROM decisions WHERE id = $1 AND user_id = $2 AND opportunity_id = $3 AND decision = 'GO'`,
        [decisionId, userId, input.opportunityId]
      );
      if (decisionRes.rows.length === 0) {
        throw new EmeradarError(ErrorCode.FORBIDDEN, 'Decision does not belong to this user and opportunity.', 403);
      }
    }

    if (input.reportId) {
      const reportRes = await query<{ id: string }>(
        `SELECT id
         FROM opportunity_reports
         WHERE id = $1 AND user_id = $2 AND opportunity_id = $3`,
        [input.reportId, userId, input.opportunityId]
      );
      if (reportRes.rows.length === 0) {
        throw new EmeradarError(ErrorCode.FORBIDDEN, 'Report does not belong to this user and opportunity.', 403);
      }
    }

    const projectId = `prj_${Date.now()}`;
    const res = await query<any>(
      `INSERT INTO projects (
        id, user_id, opportunity_id, decision_id, report_id,
        title, domain, build_type, status, launch_date, target_keywords
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, 'IN_DEVELOPMENT', NULL, $9
      ) RETURNING *;`,
      [
        projectId,
        userId,
        input.opportunityId,
        decisionId,
        input.reportId || null,
        input.title,
        input.domain || null,
        input.buildType || 'LIGHTWEIGHT_TOOL',
        input.targetKeywords || [],
      ]
    );

    return res.rows[0];
  }

  /**
   * List all projects for a user with aggregated GSC metrics
   */
  static async listUserProjects(userId: string): Promise<any[]> {
    const res = await query<any>(
      `SELECT 
        p.*,
        o.title as opportunity_title,
        o.slug as opportunity_slug,
        c.verdict as current_verdict,
        COALESCE(SUM(g.impressions), 0)::integer as total_impressions,
        COALESCE(SUM(g.clicks), 0)::integer as total_clicks
       FROM projects p
       JOIN opportunities o ON o.id = p.opportunity_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
       LEFT JOIN gsc_metrics_weekly g ON g.project_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id, o.title, o.slug, c.verdict
       ORDER BY p.created_at DESC`,
      [userId]
    );

    return res.rows;
  }

  /**
   * Get detailed project stats and GSC weekly trajectory
   */
  static async getProjectDetail(projectId: string, userId: string): Promise<any> {
    const projRes = await query<any>(
      `SELECT p.*, o.title as opportunity_title, o.slug as opportunity_slug,
              c.verdict as current_verdict, c.primary_query
       FROM projects p
       JOIN opportunities o ON o.id = p.opportunity_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE p.id = $1 AND p.user_id = $2`,
      [projectId, userId]
    );

    if (projRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Project not found: ${projectId}`,
        404
      );
    }

    const project = projRes.rows[0];

    // Weekly metrics
    const metricsRes = await query<any>(
      `SELECT week_start_date, impressions, clicks, average_position
       FROM gsc_metrics_weekly
       WHERE project_id = $1
       ORDER BY week_start_date ASC`,
      [projectId]
    );

    const detailRes = await query<any>(
      `SELECT week_start_date, page_url, query, impressions, clicks, average_position, source
       FROM gsc_metrics_weekly_detail WHERE project_id = $1 ORDER BY week_start_date ASC, page_url, query`,
      [projectId]
    );
    const launchDate = project.launch_date ? new Date(project.launch_date) : null;
    const outcomes = [7, 14, 30].map((day) => {
      if (!launchDate) return { day, status: 'PENDING', impressions: null, clicks: null, queries: null, pages: null, averagePosition: null };
      const cutoff = new Date(launchDate);
      cutoff.setDate(cutoff.getDate() + day);
      if (new Date() < cutoff) return { day, status: 'PENDING', impressions: null, clicks: null, queries: null, pages: null, averagePosition: null };
      const rows = detailRes.rows.filter((r) => {
        const week = new Date(r.week_start_date);
        return week >= launchDate && week <= cutoff;
      });
      if (rows.length === 0) return { day, status: 'PENDING', impressions: null, clicks: null, queries: null, pages: null, averagePosition: null };
      const impressions = rows.reduce((sum, r) => sum + Number(r.impressions || 0), 0);
      const clicks = rows.reduce((sum, r) => sum + Number(r.clicks || 0), 0);
      const weightedPosition = rows.reduce((sum, r) => sum + Number(r.average_position || 0) * Number(r.impressions || 0), 0);
      return { day, status: 'OBSERVED', impressions, clicks, queries: new Set(rows.map((r) => r.query).filter(Boolean)).size, pages: new Set(rows.map((r) => r.page_url).filter(Boolean)).size, averagePosition: impressions ? weightedPosition / impressions : null };
    });

    return {
      project,
      metrics: metricsRes.rows,
      metricDetails: detailRes.rows,
      outcomes,
    };
  }

  /**
   * Update status of project
   */
  static async updateProjectStatus(
    projectId: string,
    userId: string,
    status: 'IN_DEVELOPMENT' | 'LAUNCHED' | 'ARCHIVED',
    domain?: string
  ): Promise<any> {
    const res = await query<any>(
      `UPDATE projects
       SET status = $1,
           domain = COALESCE($2, domain),
           launch_date = CASE WHEN $1 = 'LAUNCHED' AND launch_date IS NULL THEN CURRENT_DATE ELSE launch_date END,
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [status, domain || null, projectId, userId]
    );

    if (res.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Project not found: ${projectId}`,
        404
      );
    }

    return res.rows[0];
  }
}
