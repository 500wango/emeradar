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

export class ProjectService {
  /**
   * Create a new tracking project linked to an opportunity decision
   */
  static async createProject(
    userId: string,
    input: CreateProjectInput
  ): Promise<any> {
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

    return {
      project,
      metrics: metricsRes.rows,
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
