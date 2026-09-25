import {
  Verdict,
  Lifecycle,
  Band,
  Confidence,
  EvidenceClass,
  BuildArchetype,
  MonetizationRoute,
  RouteGrade,
  ExecutionClass,
  CommercialStage,
  Intent,
  Priority,
} from './enums';

export interface ScoresBasisPoints {
  d_basis_points: number; // 0..10000
  m_basis_points: number; // 0..10000
  w_basis_points: number; // 0..10000
  d_band: Band;
  m_band: Band;
  w_band: Band;
  confidence: Confidence;
}

export interface OpportunityCard {
  id: string; // opp_01J...
  slug: string;
  primary_query: string;
  verdict: Verdict;
  lifecycle: Lifecycle;
  scores: ScoresBasisPoints;
  recommended_archetype: BuildArchetype;
  execution_class: ExecutionClass;
  why_now_summary: string;
  top_idea: string;
  first_observed_at: string;
  query_velocity: number;
  featured_evidence_id: string;
  featured_evidence_snippet: string;
  stale: boolean;
}

export interface SERPResultAudit {
  rank: number;
  url: string;
  title: string;
  domain: string;
  is_weak: boolean;
  weakness_type?: 'UGC_FORUM' | 'STALE_CONTENT' | 'LOW_AUTHORITY' | 'IRRELEVANT' | 'OFFICIAL_ABSENT';
  published_at?: string;
  evidence_id?: string;
}

export interface CommercialEvidenceSnapshot {
  m_stage: CommercialStage;
  observed_median_price_usd?: number;
  price_range_str?: string;
  payment_infra: string[];
  recommended_routes: Array<{
    route: MonetizationRoute;
    grade: RouteGrade;
    rationale: string;
  }>;
  what_this_proves: string;
  what_this_does_not_prove: string;
  evidence_citations: Array<{
    id: string;
    domain: string;
    price?: string;
    classification: EvidenceClass;
  }>;
}

export interface KillCriteriaItem {
  id: string;
  rule_code: string;
  description: string;
  status: 'ACTIVE' | 'TRIGGERED' | 'DISMISSED';
  triggered_at?: string;
}

export interface OpportunityDetail extends OpportunityCard {
  market_country: string;
  research_language: string;
  momentum_signals: Array<{
    source: 'HACKER_NEWS' | 'GITHUB' | 'REDDIT' | 'PRODUCT_HUNT';
    title: string;
    url: string;
    observed_at: string;
    score?: number;
  }>;
  demand_formation: {
    total_cluster_queries: number;
    intent_distribution: Record<Intent, number>;
    accelerating_30d: boolean;
    cluster_keywords: Array<{
      query: string;
      intent: Intent;
      priority: Priority;
      volume_tier: 'HIGH' | 'MEDIUM' | 'LOW';
      first_observed: string;
    }>;
  };
  serp_intelligence: {
    weak_result_ratio: number;
    results: SERPResultAudit[];
    authoritative_competitors: string[];
  };
  commercial_proof: CommercialEvidenceSnapshot;
  kill_criteria: KillCriteriaItem[];
  pre_mortem: string[];
}

export interface OpportunityReportData {
  schema_version: string;
  report_id: string;
  opportunity_id: string;
  user_id: string;
  snapshot_id: string;
  obs_date: string;
  locale: string;
  market_country: string;
  research_language: string;
  verdict: Verdict;
  recommended_archetype: BuildArchetype;
  execution_class: ExecutionClass;
  scores: ScoresBasisPoints;
  sections: {
    executive_summary: {
      one_sentence_verdict: string;
      why_now: string;
      target_persona: {
        who: string;
        pain: string;
        urgency: string;
      };
      core_value_prop: string;
    };
    demand_intelligence: {
      primary_query: string;
      search_intent: Intent;
      demand_trajectory: string;
      cluster_keywords: Array<{
        query: string;
        intent: Intent;
        priority: Priority;
        volume_tier: string;
        first_observed: string;
      }>;
    };
    commercial_evidence: {
      m_score_grade: Band;
      monetization_stage: CommercialStage;
      observed_pricing: {
        median_monthly_usd?: number;
        price_range: string;
        free_tier_present: boolean;
        evidence_cite: string;
      };
      payment_infrastructure: string[];
      recommended_routes: Array<{
        route: MonetizationRoute;
        grade: RouteGrade;
        rationale: string;
      }>;
      what_this_proves: string;
      what_this_does_not_prove: string;
    };
    serp_weakness_audit: {
      w_score_grade: Band;
      weak_result_ratio: number;
      weaknesses_identified: Array<{
        rank: number;
        domain: string;
        weakness_type: string;
        title: string;
        published_at?: string;
        citation: string;
      }>;
    };
    strategic_archetype: {
      recommended_archetype: BuildArchetype;
      execution_class: ExecutionClass;
      estimated_mvp_days: string;
      core_differentiator: string;
      suggested_pages: Array<{
        path: string;
        purpose: string;
      }>;
    };
    risk_and_kill_criteria: {
      active_kill_rules: Array<{
        rule_code: string;
        threshold: string;
        action: string;
      }>;
      disclaimer: string;
    };
  };
  metadata: {
    generated_at: string;
    export_count: number;
    last_exported_at: string | null;
  };
}

export interface UserProject {
  id: string; // prj_01J...
  user_id: string;
  opportunity_id: string;
  report_id?: string;
  opportunity_title: string;
  domain?: string;
  build_type: BuildArchetype;
  status: 'IN_DEVELOPMENT' | 'LAUNCHED' | 'ARCHIVED';
  launch_date?: string;
  target_keywords: string[];
  gsc_connected: boolean;
  total_impressions_30d?: number;
  total_clicks_30d?: number;
  average_position_30d?: number;
  created_at: string;
}

export interface PredictionLedgerEpisode {
  id: string; // vdt_01J...
  obs_date: string;
  opportunity_id: string;
  opportunity_name: string;
  verdict: Verdict;
  d_band: Band;
  m_band: Band;
  w_band: Band;
  row_hash: string;
  prev_hash: string;
  outcome_30d?: 'HIT' | 'MISS' | 'PENDING';
  outcome_60d?: 'HIT' | 'MISS' | 'PENDING';
  outcome_90d?: 'HIT' | 'MISS' | 'PENDING';
  metrics?: {
    peak_serp_gain?: number;
    gsc_impressions_spike?: boolean;
    competitor_entered?: boolean;
  };
}
