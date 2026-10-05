import { createHash } from 'node:crypto';
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
    // 0. Fetch opportunity and scoring context
    const oppRes = await query<any>(
      `SELECT o.id, o.title, o.slug, o.status, o.market_country, o.research_language,
              c.primary_query, c.verdict, c.lifecycle,
              c.d_basis_points, c.m_basis_points, c.w_basis_points,
              c.d_band, c.m_band, c.w_band, c.confidence,
              c.recommended_archetype, c.execution_class,
              c.search_intent, c.recommended_product_shape, c.site_strategy,
              c.intent_evidence,
              c.why_now_summary, c.top_idea, c.query_velocity
       FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE o.id = $1`,
      [opportunityId]
    );

    if (oppRes.rows.length === 0) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Opportunity not found: ${opportunityId}`, 404);
    }
    const opp = oppRes.rows[0];

    if (opp.status !== 'TRACKED' || !['BUILD_NOW', 'EARLY_BET'].includes(opp.verdict) || opp.confidence === 'LOW') {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'Reports require a published BUILD_NOW or EARLY_BET opportunity with verified evidence.',
        409
      );
    }

    // 1. Check for cached report matching current verdict
    const cachedRes = await query<{
      id: string;
      content: any;
      content_markdown: string;
      stale: boolean;
    }>(
      `SELECT r.id, r.content, r.content_markdown, r.stale
       FROM opportunity_reports r
       WHERE r.opportunity_id = $1 AND r.user_id = $2 AND r.locale = $3
         AND r.content->'metadata'->>'verdict' = $4
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [opportunityId, userId, locale, opp.verdict]
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

    // 2. Ensure snapshot exists
    const snapRes = await query<{ id: string; obs_date: string }>(
      `SELECT id, obs_date::text FROM opportunity_snapshots WHERE opportunity_id = $1 ORDER BY obs_date DESC LIMIT 1`,
      [opportunityId]
    );
    let snapshotId: string;
    let snapshotObsDate: string;
    if (snapRes.rows.length > 0) {
      snapshotId = snapRes.rows[0].id;
      snapshotObsDate = snapRes.rows[0].obs_date;
    } else {
      const today = new Date().toISOString().split('T')[0];
      snapshotId = `snp_${opp.id}_${today.replace(/-/g, '')}`;
      snapshotObsDate = today;
      await query(
        `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics, sealed_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (opportunity_id, obs_date) DO NOTHING`,
        [
          snapshotId,
          opp.id,
          today,
          JSON.stringify({
            d_score: opp.d_basis_points,
            m_score: opp.m_basis_points,
            w_score: opp.w_basis_points,
            d_band: opp.d_band,
            m_band: opp.m_band,
            w_band: opp.w_band,
            confidence: opp.confidence,
          }),
        ]
      );
    }

    // Ensure verdict exists
    const verdictRes = await query<{ id: string; obs_date: string }>(
      `SELECT id, obs_date::text FROM verdicts WHERE opportunity_id = $1 ORDER BY obs_date DESC LIMIT 1`,
      [opportunityId]
    );
    let verdictId: string;
    if (verdictRes.rows.length > 0) {
      verdictId = verdictRes.rows[0].id;
    } else {
      const today = new Date().toISOString().split('T')[0];
      verdictId = `vdt_${opp.id}_${today.replace(/-/g, '')}`;
      const rowHash = createHash('sha256')
        .update(`${opp.id}|${today}|${opp.verdict}|${opp.d_basis_points}|${opp.m_basis_points}|${opp.w_basis_points}`)
        .digest('hex');
      const prevHash = createHash('sha256').update(`genesis_${opp.id}`).digest('hex');
      await query(
        `INSERT INTO verdicts (
           id, opportunity_id, obs_date, scoring_config_version,
           verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
           confidence, input_snapshot_ids, cited_evidence_ids, prev_hash, row_hash
         ) VALUES ($1, $2, $3, 'sc-1.0.0', $4, $5, $6, $7, $8, $9, $10, '{}', $11, $12)
         ON CONFLICT (opportunity_id, obs_date) DO NOTHING`,
        [
          verdictId,
          opp.id,
          today,
          opp.verdict,
          opp.lifecycle || 'EARLY_WINDOW',
          opp.d_basis_points,
          opp.m_basis_points,
          opp.w_basis_points,
          opp.confidence,
          [snapshotId],
          prevHash,
          rowHash,
        ]
      );
    }

    // 3. Reserve quota via Hold & Release
    const reservation = await EntitlementService.reserveExportQuota(userId, opportunityId);

    try {
      const reportId = `rpt_${opportunityId}_${Date.now()}`;

      // Fetch SERP top 10
      const serpRes = await query<any>(
        `SELECT r.rank, r.url, r.domain, r.title, r.result_type, r.is_weak, r.weakness_type
         FROM serp_snapshots ss
         JOIN serp_results r ON r.serp_snapshot_id = ss.id
         JOIN opportunity_queries oq ON oq.query_id = ss.query_id AND oq.role = 'PRIMARY'
         WHERE oq.opportunity_id = $1
         ORDER BY ss.obs_date DESC, r.rank ASC LIMIT 10`,
        [opportunityId]
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
        obsDate: snapshotObsDate,
        locale,
        primaryQuery: opp.primary_query,
        searchIntent: opp.search_intent || undefined,
        recommendedProductShape: opp.recommended_product_shape || undefined,
        siteStrategy: opp.site_strategy || undefined,
        queryVelocity: parseFloat(opp.query_velocity || '1.0'),
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
