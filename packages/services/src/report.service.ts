import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode, Locale } from '@emeradar/core';
import {
  generateOpportunityReport,
  renderReportToMarkdown,
  renderReportToHtml,
  OpportunityReportData,
} from '@emeradar/report';
import { EntitlementService } from './entitlement.service';

export class ReportService {
  /**
   * Get an existing report or generate a new one with Hold & Release quota protection
   */
  static async getOrGenerateReport(
    opportunityId: string,
    userId: string,
    locale: Locale = 'en-US'
  ): Promise<{
    reportId: string;
    data: OpportunityReportData;
    markdown: string;
    cached: boolean;
  }> {
    const gate = await query<{ status: string; verdict: string; confidence: string }>(
      `SELECT o.status, c.verdict, c.confidence FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id WHERE o.id = $1`, [opportunityId]);
    if (gate.rows.length === 0) throw new EmeradarError(ErrorCode.NOT_FOUND, `Opportunity not found: ${opportunityId}`, 404);
    if (gate.rows[0].status !== 'TRACKED' || !['BUILD_NOW', 'EARLY_BET'].includes(gate.rows[0].verdict) || gate.rows[0].confidence === 'LOW') {
      throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Reports require a published BUILD_NOW or EARLY_BET opportunity.', 409);
    }
    // 1. Check for cached report matching latest snapshot
    const cachedRes = await query<{
      id: string;
      content: any;
      content_markdown: string;
      stale: boolean;
    }>(
      `SELECT r.id, r.content, r.content_markdown, r.stale
       FROM opportunity_reports r
       JOIN opportunity_cards c ON c.opportunity_id = r.opportunity_id
       JOIN opportunity_snapshots os ON os.opportunity_id = r.opportunity_id AND os.obs_date = CURRENT_DATE
       WHERE r.opportunity_id = $1 AND r.user_id = $2 AND r.locale = $3
         AND r.snapshot_id = os.id
         AND r.content->'metadata'->>'verdict' = c.verdict
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [opportunityId, userId, locale]
    );

    if (cachedRes.rows.length > 0 && !cachedRes.rows[0].stale) {
      const cached = cachedRes.rows[0];
      return {
        reportId: cached.id,
        data: cached.content,
        markdown: cached.content_markdown,
        cached: true,
      };
    }

    // 2. Reserve quota via Hold & Release
    const reservation = await EntitlementService.reserveExportQuota(userId, opportunityId);

    try {
      // 3. Fetch opportunity and scoring context
      const oppRes = await query<any>(
        `SELECT o.id, o.title, o.slug, o.market_country, o.research_language,
                c.primary_query, c.verdict, c.lifecycle,
                c.d_basis_points, c.m_basis_points, c.w_basis_points,
                c.d_band, c.m_band, c.w_band, c.confidence,
                c.recommended_archetype, c.execution_class,
                c.search_intent, c.recommended_product_shape, c.site_strategy,
                c.intent_evidence,
                c.why_now_summary, c.top_idea, c.query_velocity,
                s.id as snapshot_id, s.obs_date as snapshot_obs_date, v.id as verdict_id
         FROM opportunities o
         JOIN opportunity_cards c ON c.opportunity_id = o.id
         LEFT JOIN opportunity_snapshots s ON s.opportunity_id = o.id AND s.obs_date = CURRENT_DATE
         LEFT JOIN verdicts v ON v.opportunity_id = o.id AND v.obs_date = CURRENT_DATE
         WHERE o.id = $1`,
        [opportunityId]
      );

      if (oppRes.rows.length === 0) {
        throw new EmeradarError(
          ErrorCode.NOT_FOUND,
          `Opportunity not found: ${opportunityId}`,
          404
        );
      }

      const opp = oppRes.rows[0];
      const reportId = `rpt_${opportunityId}_${Date.now()}`;
      if (!opp.snapshot_id || !opp.verdict_id) {
        throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'A sealed snapshot and verdict are required before generating a report.', 409);
      }
      const snapshotId = opp.snapshot_id;
      const verdictId = opp.verdict_id;

      // Fetch SERP top 10
      const serpRes = await query<any>(
        `SELECT r.rank, r.url, r.domain, r.title, r.result_type, r.is_weak, r.weakness_type
         FROM serp_snapshots ss
         JOIN serp_results r ON r.serp_snapshot_id = ss.id
         JOIN opportunity_queries oq ON oq.query_id = ss.query_id AND oq.role = 'PRIMARY'
         JOIN opportunity_snapshots os ON os.opportunity_id = $1 AND os.id = $2 AND os.obs_date = ss.obs_date
         WHERE oq.opportunity_id = $1
         ORDER BY r.rank ASC LIMIT 10`,
        [opportunityId, snapshotId]
      );

      // Fetch Kill Criteria
      const kcRes = await query<any>(
        `SELECT rule_code as code, description as rule, 'Automated threshold trigger' as rationale
         FROM kill_criteria
         WHERE opportunity_id = $1`,
        [opportunityId]
      );

      // 4. Assemble report data deterministically
      const reportData = generateOpportunityReport({
        reportId,
        opportunity: {
          id: opp.id,
          title: opp.title,
          slug: opp.slug,
          marketCountry: opp.market_country,
          researchLanguage: opp.research_language,
        },
        scoring: {
          verdict: opp.verdict,
          rawVerdict: opp.verdict,
          lifecycle: opp.lifecycle,
          confidence: opp.confidence,
          confidenceScore: 0,
          dScore: opp.d_basis_points,
          mScore: opp.m_basis_points,
          wScore: opp.w_basis_points,
          dBand: opp.d_band,
          mBand: opp.m_band,
          wBand: opp.w_band,
          flags: [],
          explanation: {
            dReason: `Demand band on file: ${opp.d_band}.`,
            mReason:
              Number(opp.m_basis_points) > 0
                ? `Commercial band on file: ${opp.m_band}.`
                : 'No pricing or checkout observation is stored.',
            wReason: `Window band on file: ${opp.w_band}. ${opp.why_now_summary}`,
            verdictReason: opp.why_now_summary,
            rulesTriggered: [],
          },
          recommendedArchetype: opp.recommended_archetype,
          executionClass: opp.execution_class,
        },
        obsDate: opp.snapshot_obs_date,
        locale,
        primaryQuery: opp.primary_query,
        searchIntent: opp.search_intent || undefined,
        recommendedProductShape: opp.recommended_product_shape || undefined,
        siteStrategy: opp.site_strategy || undefined,
        queryVelocity: parseFloat(opp.query_velocity),
        top10Serp: serpRes.rows.map((r) => ({
          rank: r.rank,
          url: r.url,
          domain: r.domain,
          title: r.title,
          resultType: r.result_type,
          isWeak: r.is_weak,
          weaknessReason: r.weakness_type,
        })),
        killCriteria: kcRes.rows,
        llmSummaryNarrative: {
          whyNow: opp.why_now_summary,
          topIdea: opp.top_idea,
        },
      });

      // 5. Render Markdown
      const markdown = renderReportToMarkdown(reportData);

      // 6. Save in DB
      await query(
        `INSERT INTO opportunity_reports (
          id, opportunity_id, user_id, verdict_id, snapshot_id,
          locale, status, verdict, recommended_archetype,
          scores, content, content_markdown, export_count
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, 'READY', $7, $8,
          $9, $10, $11, 1
        )
        ON CONFLICT (opportunity_id, user_id, snapshot_id, locale)
        DO UPDATE SET
          content = EXCLUDED.content,
          content_markdown = EXCLUDED.content_markdown,
          export_count = opportunity_reports.export_count + 1,
          last_exported_at = NOW(),
          updated_at = NOW();`,
        [
          reportId,
          opportunityId,
          userId,
          verdictId,
          snapshotId,
          locale,
          opp.verdict,
          opp.recommended_archetype,
          JSON.stringify(reportData.metadata.scores),
          JSON.stringify(reportData),
          markdown,
        ]
      );

      // 7. Confirm quota
      await EntitlementService.confirmExportQuota(
        userId,
        reservation.reservationToken,
        reportId
      );

      return {
        reportId,
        data: reportData,
        markdown,
        cached: false,
      };
    } catch (err) {
      // 8. Release quota on error
      await EntitlementService.releaseExportQuota(
        userId,
        reservation.reservationToken
      );
      throw err;
    }
  }

  /**
   * Export report by format
   */
  static async exportReportFormat(
    reportId: string,
    format: 'markdown' | 'json' | 'html',
    userId: string
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const ent = await EntitlementService.getUserEntitlements(userId);
    if (!ent.deepReportExport) {
      throw new EmeradarError(
        ErrorCode.FORBIDDEN,
        'Report export is available on Builder Pro and Team plans.',
        403,
        { upgradeUrl: '/pricing' }
      );
    }
    const res = await query<{
      id: string;
      opportunity_id: string;
      content: any;
      content_markdown: string;
    }>(
      `SELECT id, opportunity_id, content, content_markdown
       FROM opportunity_reports
       WHERE id = $1 AND user_id = $2`,
      [reportId, userId]
    );

    if (res.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Report not found: ${reportId}`,
        404
      );
    }

    const row = res.rows[0];

    // Increment export count
    await query(
      `UPDATE opportunity_reports 
       SET export_count = export_count + 1, last_exported_at = NOW() 
       WHERE id = $1`,
      [reportId]
    );

    if (format === 'markdown') {
      return {
        content: row.content_markdown,
        contentType: 'text/markdown; charset=utf-8',
        filename: `${row.opportunity_id}-report.md`,
      };
    } else if (format === 'html') {
      const html = renderReportToHtml(row.content);
      return {
        content: html,
        contentType: 'text/html; charset=utf-8',
        filename: `${row.opportunity_id}-report.html`,
      };
    } else {
      return {
        content: JSON.stringify(row.content, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `${row.opportunity_id}-report.json`,
      };
    }
  }
}
