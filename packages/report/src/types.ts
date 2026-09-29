import {
  Verdict,
  Lifecycle,
  Confidence,
  BuildArchetype,
  ExecutionClass,
  Locale,
} from '@emeradar/core';

export interface OpportunityReportMetadata {
  reportId: string;
  opportunityId: string;
  title: string;
  slug: string;
  locale: Locale;
  generatedAt: string; // ISO 8601
  obsDate: string;
  verdict: Verdict;
  lifecycle: Lifecycle;
  recommendedArchetype: BuildArchetype;
  executionClass: ExecutionClass;
  scores: {
    dBasisPoints: number;
    mBasisPoints: number;
    wBasisPoints: number;
    confidence: Confidence;
    confidenceScore: number;
  };
}

export interface Section1ExecutiveSummary {
  thesis: string;
  whyNow: string;
  topIdea: string;
  keyRisks: string[];
  decisionRecommendation: string;
}

export interface Section2DemandBreakdown {
  primaryQuery: string;
  searchIntent: 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL' | 'NAVIGATIONAL';
  jobToBeDone: string;
  recommendedProductShape: string;
  siteStrategy: 'INDEPENDENT_SITE' | 'EXISTING_SITE_PAGE' | 'WATCH';
  clusterQueries: {
    query: string;
    intent: 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL' | 'NAVIGATIONAL';
    volumeTier: 'HIGH' | 'MEDIUM' | 'EMERGING';
  }[];
  queryVelocity: number;
  autocompleteSignals: string[];
  momentumAssessment: string;
}

export interface Section3CompetitiveWeakness {
  serpWeaknessScore: number;
  weakResultsRatio: number;
  top10Results: {
    rank: number;
    url?: string;
    domain: string;
    title: string;
    resultType: string;
    isWeak: boolean;
    weaknessReason?: string;
  }[];
  homepageRatio: number;
  innerPageRatio: number;
  vulnerableGaps: string[];
}

export interface Section4CommercialValidation {
  evidenceCount: {
    total: number;
    observed: number;
    selfReported: number;
    estimated: number;
  };
  paidCompetitors: {
    domain: string;
    pricingModel: string;
    priceRange: string;
    paymentGateways: string[];
  }[];
  monetizationHeadroom: string;
  negativeSignalCheck: {
    passed: boolean;
    findings?: string[];
  };
}

export interface Section5ExecutionBlueprint {
  archetype: BuildArchetype;
  executionClass: ExecutionClass;
  targetTimeframeDays: number;
  mvpScope: {
    inScope: string[];
    outOfScope: string[];
  };
  recommendedStack: {
    frontend: string;
    backend: string;
    database: string;
    hosting: string;
  };
  sprintPlan14d: {
    phase: string;
    days: string;
    deliverables: string[];
  }[];
  executionBrief: {
    primaryQuery: string;
    searchIntent: string;
    coreJob: string;
    mvpPageType: string;
    coreAction: string;
    requiredVariants: string[];
    initialPages: { path: string; purpose: string }[];
    internalLinkPlan: string[];
    launchChecklist: string[];
    nonGoals: string[];
  };
}

export interface Section6KillCriteria {
  activeRules: {
    code: string;
    rule: string;
    rationale: string;
  }[];
  invalidationConditions: string[];
  radarWatchGuidance: string;
}

export interface OpportunityReportData {
  metadata: OpportunityReportMetadata;
  section1: Section1ExecutiveSummary;
  section2: Section2DemandBreakdown;
  section3: Section3CompetitiveWeakness;
  section4: Section4CommercialValidation;
  section5: Section5ExecutionBlueprint;
  section6: Section6KillCriteria;
}
