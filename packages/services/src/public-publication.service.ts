import { query } from '@emeradar/db';

export interface PublicationDecision {
  eligible: boolean;
  indexable: boolean;
  eligibility: Record<string, unknown>;
  qualityReport: Record<string, unknown>;
}

export class PublicPublicationService {
  static async evaluateOpportunity(opportunityId: string, now = new Date()): Promise<PublicationDecision> {
    const res = await query<any>(
      `SELECT o.id, o.slug, o.title, o.first_observed_date, c.verdict, c.lifecycle, c.w_band, c.m_band,
              c.why_now_summary, c.top_idea,
              (SELECT MIN(v.obs_date) FROM verdicts v WHERE v.opportunity_id = o.id) AS first_verdict_date,
              (SELECT COUNT(*)::int FROM evidence e WHERE e.opportunity_id = o.id) AS evidence_count,
              (SELECT COUNT(*)::int FROM serp_results sr JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
               JOIN opportunity_queries oq ON oq.query_id = ss.query_id
               WHERE oq.opportunity_id = o.id AND oq.role = 'PRIMARY' AND sr.is_weak = true) AS weak_result_count
       FROM opportunities o JOIN opportunity_cards c ON c.opportunity_id = o.id WHERE o.id = $1`,
      [opportunityId]
    );
    if (!res.rows[0]) return { eligible: false, indexable: false, eligibility: { reason: 'NOT_FOUND' }, qualityReport: {} };
    const row = res.rows[0];
    const firstVerdictDate = row.first_verdict_date || row.first_observed_date;
    const ageDays = Math.floor((now.getTime() - new Date(firstVerdictDate).getTime()) / 86400000);
    const eligible = Boolean(row.verdict) && ageDays >= 45 && ['MEDIUM', 'LOW', 'INSUFFICIENT'].includes(row.w_band) && row.m_band !== 'INSUFFICIENT';
    const bodyText = `${row.title || ''} ${row.why_now_summary || ''} ${row.top_idea || ''}`;
    const qualityReport = {
      evidenceCount: Number(row.evidence_count),
      weakResultCount: Number(row.weak_result_count),
      hasCommercialProof: row.m_band !== 'INSUFFICIENT',
      hasSerpWeakness: Number(row.weak_result_count) > 0,
      hasDistinctiveContent: Boolean(row.top_idea && row.why_now_summary),
      wordCount: bodyText.trim().split(/\s+/).filter(Boolean).length,
      hasProofAndLimits: Boolean(row.why_now_summary && row.top_idea),
    };
    const indexable = eligible && qualityReport.evidenceCount >= 3 && qualityReport.hasSerpWeakness && qualityReport.hasDistinctiveContent && qualityReport.hasProofAndLimits && qualityReport.wordCount >= 40;
    return {
      eligible,
      indexable,
      eligibility: { ageDays, delayDays: 45, windowBand: row.w_band, commercialBand: row.m_band },
      qualityReport,
    };
  }

  static async publishOpportunity(opportunityId: string, locale = 'en-US'): Promise<PublicationDecision> {
    const decision = await this.evaluateOpportunity(opportunityId);
    const row = await query<any>(`SELECT slug, title, primary_query, why_now_summary, top_idea FROM opportunity_cards WHERE opportunity_id = $1`, [opportunityId]);
    if (!row.rows[0]) return decision;
    const card = row.rows[0];
    await query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable, content, eligibility, quality_report, published_at)
       VALUES ($1,$2,$3,'OPPORTUNITY',$4,'PUBLISHED',$5,$6,$7,$8,NOW())
       ON CONFLICT (slug, locale) DO UPDATE SET indexable = EXCLUDED.indexable, content = EXCLUDED.content,
         eligibility = EXCLUDED.eligibility, quality_report = EXCLUDED.quality_report, published_at = NOW()`,
      [`pgm_${opportunityId}_${locale}`, card.slug, locale, opportunityId, decision.indexable,
        JSON.stringify({ title: card.title, primaryQuery: card.primary_query, whyNow: card.why_now_summary, topIdea: card.top_idea }),
        JSON.stringify(decision.eligibility), JSON.stringify(decision.qualityReport)]
    );
    return decision;
  }
}
