import {
  Verdict,
  Lifecycle,
  Confidence,
  Band,
  BuildArchetype,
  ExecutionClass,
} from '@emeradar/core';

export type AxisBand = Band;

export type ResultType =
  | 'SPECIALIST'
  | 'OFFICIAL'
  | 'EDITORIAL_MEDIA'
  | 'LISTICLE_AFFILIATE'
  | 'DIRECTORY'
  | 'VIDEO'
  | 'DOC'
  | 'UGC_THREAD'
  | 'QA'
  | 'THIN_PAGE'
  | 'OFF_TOPIC'
  | 'UNCLASSIFIED';

export interface SerpItemInput {
  rank: number; // 1 - 20
  url: string;
  domain: string;
  title: string;
  snippet?: string;
  resultType: ResultType;
  ageDays?: number;
  relevance?: number; // 0.0 - 1.0
  isHomepage?: boolean;
  isDedicatedLandingPage?: boolean;
  domainDr?: number;
}

export interface SerpItemWeaknessOutput {
  rank: number;
  url: string;
  domain: string;
  title: string;
  resultType: ResultType;
  baseWeakness: number;
  ageAdj: number;
  relevanceAdj: number;
  pageDiscount: number; // 0.45 for inner page, 0.65 for dedicated, 1.0 for homepage
  totalWeakness: number; // 0.0 - 1.0
  isWeak: boolean;
  weaknessType?: string;
  isHomepage: boolean;
  domainDr?: number;
}

export interface SerpWeaknessResult {
  score: number; // 0 - 100
  items: SerpItemWeaknessOutput[];
  weakCount: number;
  weakSitesCount: number; // sites with DR < 25 or ageDays < 540
  innerPagesCount: number;
  homepageCount: number;
  structuralPenetrationReasons: string[];
  penetrationAngle: 'HOMEPAGE_DIRECT' | 'ALTERNATIVE_INTERCEPT' | 'AGGREGATOR_PAGE' | 'LONGTAIL_CLUSTER';
}

export interface DemandFeatures {
  clusterSize: number;
  newQueries7d: number;
  clusterGrowth30d: number; // e.g. 0.5 for +50%
  expansionSlope30d: number;
  attentionSourcesActive14d: number; // 0 - 4
  attentionGrowth14d: number;
  trendsSlope90d?: number;
  historyDays: number;
}

export interface WindowFeatures {
  serpWeakness: number; // 0 - 100
  eSpecialist30d: number;
  eAuthoritative30d: number;
  volatility30d: number;
  crowdingIndex: number;
  serpHistoryDays: number;
  recentSerpSnapshotAvailable: boolean;
}

export interface CommercialSummary {
  independentDomainsCount: number;
  hasSubscriptionPlans: boolean;
  hasOneTimePlans: boolean;
  hasStrongNegative: boolean;
  negativeReasons?: string[];
  totalScore: number; // for ranking
  band: AxisBand;
}

export interface EvidenceConfidenceInput {
  nIndependentSources: number;
  totalEvidenceCount: number;
  observedEvidenceCount: number;
  medianEvidenceAgeDays: number;
  historyDays: number;
}

export interface PrevScoringState {
  verdict: Verdict;
  rawVerdict: Verdict;
  lifecycle: Lifecycle;
  daysInCurrentVerdict: number;
  daysInCurrentLifecycle: number;
  wBandHistory: AxisBand[]; // recent W bands
}

export interface ScoringOutput {
  verdict: Verdict;
  rawVerdict: Verdict;
  lifecycle: Lifecycle;
  confidence: Confidence;
  confidenceScore: number; // 0.0 - 1.0
  dScore: number; // 0 - 10000 basis points
  mScore: number; // 0 - 10000 basis points
  wScore: number; // 0 - 10000 basis points
  dBand: AxisBand;
  mBand: AxisBand;
  wBand: AxisBand;
  flags: string[];
  explanation: {
    dReason: string;
    mReason: string;
    wReason: string;
    verdictReason: string;
    rulesTriggered: string[];
  };
  recommendedArchetype: BuildArchetype;
  executionClass: ExecutionClass;
}
