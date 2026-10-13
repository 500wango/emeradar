import {
  Verdict,
  Lifecycle,
  Band,
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
    /**
     * 三轴档位。产品内与导出物一律只出档位（01-PRD.md F4），基点仅作为
     * 账本里的原始计量，不得渲染成百分制。可选是因为早于档位留存功能的
     * 存量报告没有它们，而不是因为可以省略。
     */
    dBand?: Band;
    mBand?: Band;
    wBand?: Band;
    confidence: Confidence;
    confidenceScore: number;
  };
  /** 以下三项来自账本；早于依据留存功能的存量报告没有它们。 */
  rawVerdict?: Verdict;
  hashVersion?: number;
  featuresHash?: string | null;
}

export interface VeteranVerdict {
  headline: string;
  penetrationAngle: 'HOMEPAGE_DIRECT' | 'ALTERNATIVE_INTERCEPT' | 'AGGREGATOR_PAGE' | 'LONGTAIL_CLUSTER';
  structuralReasons: string[];
}

/**
 * 判定依据的留存状态。
 * - RECORDED：账本封存了完整的规则轨迹。
 * - FLAGS_ONLY：只有标志、没有轨迹（防御性分支）。
 * - NOT_RETAINED：早于依据留存功能的存量记录 —— 界面必须如实说明，不能留空或补造。
 */
export type BasisState = 'RECORDED' | 'FLAGS_ONLY' | 'NOT_RETAINED';

export interface VerdictBasis {
  state: BasisState;
  publishedVerdict: Verdict;
  /** 去抖前的原始裁决。与 publishedVerdict 不同即说明本期发布值被去抖压住。 */
  rawVerdict?: Verdict;
  /**
   * 由特征补偿规则（RULE_BUILD_NOW_COMPENSATED）产生的 BUILD_NOW：需求爆发 +
   * 窗口全开补偿了"商业验证仅中等"的证据，门槛低于标准 BUILD_NOW。
   * 界面必须能区分二者，否则用户看到「M=中 却立即构建」无从理解。
   */
  isCompensated: boolean;
  rulesTriggered: string[];
  flags: string[];
  reasons?: {
    dReason: string;
    mReason: string;
    wReason: string;
    verdictReason: string;
  };
  hashVersion?: number;
  /** Sealed v3 spec; null means no prediction, absent means not retained. */
  predictionSpec?: { criteriaVersion: string; horizons: number[]; target: string } | null;
}

export interface Section1ExecutiveSummary {
  thesis: string;
  whyNow: string;
  topIdea: string;
  keyRisks: string[];
  decisionRecommendation: string;
  veteranVerdict: VeteranVerdict;
  decisionBasis: VerdictBasis;
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

export interface IndieCompetitionAudit {
  barrierToEntry: 'LOW' | 'MEDIUM' | 'HIGH';
  barrierReason: string;
  indieEntrantDensity: 'LOW' | 'MODERATE' | 'HIGH';
  densityWarning?: string;
  shadowChannels: {
    channel: 'CHROME_EXTENSION' | 'GITHUB_OPENSOURCE' | 'SERP_PAGES_2_3' | 'COMMUNITY_MICROS';
    presence: 'DETECTED' | 'MODERATE' | 'MINIMAL';
    observation: string;
  }[];
  defensiveMoatAdvice: string;
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
  indieCompetitionAudit?: IndieCompetitionAudit;
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
    /** 本期命中的评分标志；人类可读文案由渲染层本地化。 */
    flags?: string[];
    state?: BasisState;
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

export interface SectionGoalSimulator {
  defaultMonthlyTargetUSD: number;
  estimatedKd: number;
  requiredDomainsLow: number;
  requiredDomainsHigh: number;
  targetDrRange: string;
  kgrRatio: number;
  ekgrRatio: number;
  clickValueUSD: number;
  monthlyVolumeEstimate: number;
  assumptions: string[];
}

export interface OpportunityReportData {
  metadata: OpportunityReportMetadata;
  section1: Section1ExecutiveSummary;
  section2: Section2DemandBreakdown;
  section3: Section3CompetitiveWeakness;
  section4: Section4CommercialValidation;
  section5: Section5ExecutionBlueprint;
  section6: Section6KillCriteria;
  goalSimulator: SectionGoalSimulator;
}
