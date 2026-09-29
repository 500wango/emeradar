import {
  OpportunityReportData,
  OpportunityReportMetadata,
  Section1ExecutiveSummary,
  Section2DemandBreakdown,
  Section3CompetitiveWeakness,
  Section4CommercialValidation,
  Section5ExecutionBlueprint,
  Section6KillCriteria,
} from './types';
import { ScoringOutput } from '@emeradar/scoring';
import { Locale } from '@emeradar/core';

export interface ReportGenerationInput {
  reportId: string;
  opportunity: {
    id: string;
    title: string;
    slug: string;
    marketCountry: string;
    researchLanguage: string;
  };
  scoring: ScoringOutput;
  obsDate: string;
  locale?: Locale;
  primaryQuery: string;
  searchIntent?: Section2DemandBreakdown['searchIntent'];
  jobToBeDone?: string;
  recommendedProductShape?: string;
  siteStrategy?: Section2DemandBreakdown['siteStrategy'];
  clusterQueries?: {
    query: string;
    intent: 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL' | 'NAVIGATIONAL';
    volumeTier: 'HIGH' | 'MEDIUM' | 'EMERGING';
  }[];
  queryVelocity?: number;
  autocompleteSuggestions?: string[];
  top10Serp?: {
    rank: number;
    url?: string;
    domain: string;
    title: string;
    resultType: string;
    isWeak: boolean;
    weaknessReason?: string;
  }[];
  paidCompetitors?: {
    domain: string;
    pricingModel: string;
    priceRange: string;
    paymentGateways: string[];
  }[];
  evidenceCounts?: {
    total: number;
    observed: number;
    selfReported: number;
    estimated: number;
  };
  killCriteria?: {
    code: string;
    rule: string;
    rationale: string;
  }[];
  llmSummaryNarrative?: {
    thesis?: string;
    whyNow?: string;
    topIdea?: string;
  };
}

export function generateOpportunityReport(
  input: ReportGenerationInput
): OpportunityReportData {
  const locale = input.locale || 'en-US';
  const isZh = locale === 'zh-CN';

  // 1. Metadata
  const metadata: OpportunityReportMetadata = {
    reportId: input.reportId,
    opportunityId: input.opportunity.id,
    title: input.opportunity.title,
    slug: input.opportunity.slug,
    locale,
    generatedAt: new Date().toISOString(),
    obsDate: input.obsDate,
    verdict: input.scoring.verdict,
    lifecycle: input.scoring.lifecycle,
    recommendedArchetype: input.scoring.recommendedArchetype,
    executionClass: input.scoring.executionClass,
    scores: {
      dBasisPoints: input.scoring.dScore,
      mBasisPoints: input.scoring.mScore,
      wBasisPoints: input.scoring.wScore,
      confidence: input.scoring.confidence,
      confidenceScore: input.scoring.confidenceScore,
    },
  };

  // 2. Section 1: Executive Summary
  const section1: Section1ExecutiveSummary = {
    thesis:
      input.llmSummaryNarrative?.thesis ||
      (isZh
        ? `查询「${input.primaryQuery}」的库存裁决是 ${input.scoring.verdict}。需求 ${input.scoring.dScore} 基点，商业 ${input.scoring.mScore} 基点，窗口 ${input.scoring.wScore} 基点。`
        : `Stored verdict for "${input.primaryQuery}" is ${input.scoring.verdict}. Demand ${input.scoring.dScore} basis points, commercial ${input.scoring.mScore}, window ${input.scoring.wScore}.`),
    whyNow:
      input.llmSummaryNarrative?.whyNow ||
      input.scoring.explanation.wReason ||
      (isZh ? '没有存下来的 Why Now。' : 'No why-now statement is stored.'),
    topIdea:
      input.llmSummaryNarrative?.topIdea ||
      (isZh ? '没有存下来的产品形态。' : 'No build shape is stored.'),
    keyRisks: [],
    decisionRecommendation:
      input.scoring.verdict === 'BUILD_NOW'
        ? isZh
          ? '建议立即立项（GO）：在 14 天内完成 MVP 并上线测试 SEO 收录与直接转化。'
          : 'Recommendation: GO. Execute a 14-day sprint to launch an MVP and capture early organic search equity.'
        : isZh
        ? '建议先加入雷达关注（WATCH）：监控商业信号与竞品动态，待条件成熟再推进。'
        : 'Recommendation: WATCH. Monitor radar alerts for further commercial validation before committing build resources.',
  };

  // 3. Section 2: Demand Breakdown
  const section2: Section2DemandBreakdown = {
    primaryQuery: input.primaryQuery,
    searchIntent: input.searchIntent ?? (input.scoring.recommendedArchetype === 'LIGHTWEIGHT_TOOL' ? 'TRANSACTIONAL' : 'INFORMATIONAL'),
    jobToBeDone: input.jobToBeDone ?? (isZh ? `帮助用户完成“${input.primaryQuery}”对应的核心任务。` : `Help the user complete the core task behind "${input.primaryQuery}".`),
    recommendedProductShape: input.recommendedProductShape ?? (input.scoring.recommendedArchetype === 'LIGHTWEIGHT_TOOL' ? (isZh ? '免登录免费工具' : 'Free, no-login tool') : input.scoring.recommendedArchetype),
    siteStrategy: input.siteStrategy ?? (input.scoring.verdict === 'BUILD_NOW' ? 'INDEPENDENT_SITE' : 'WATCH'),
    clusterQueries: input.clusterQueries ?? [],
    queryVelocity: input.queryVelocity ?? 0,
    autocompleteSignals: input.autocompleteSuggestions ?? [],
    momentumAssessment: isZh
      ? '没有足够的重复观测，不能判断需求动量。'
      : 'Not enough repeated observations to assess momentum.',
  };

  // 4. Section 3: Competitive Landscape & SERP Weakness
  const top10 = input.top10Serp ?? [];
  const weakCount = top10.filter((item) => item.isWeak).length;
  const isHomepage = (url?: string): boolean => {
    if (!url) return true;
    try {
      const pathname = new URL(url).pathname.replace(/\/+$/, '');
      return pathname === '';
    } catch {
      return url.replace(/^\/+|\/+$/g, '').split('/').length <= 1;
    }
  };

  const section3: Section3CompetitiveWeakness = {
    serpWeaknessScore: input.scoring.wScore / 100,
    weakResultsRatio: top10.length > 0 ? weakCount / top10.length : 0,
    top10Results: top10,
    homepageRatio: top10.length ? top10.filter((item) => isHomepage(item.url)).length / top10.length : 0,
    innerPageRatio: top10.length ? top10.filter((item) => !isHomepage(item.url)).length / top10.length : 0,
    vulnerableGaps: [],
  };

  // 5. Section 4: Commercial Validation
  const section4: Section4CommercialValidation = {
    evidenceCount: input.evidenceCounts || {
      total: 0,
      observed: 0,
      selfReported: 0,
      estimated: 0,
    },
    paidCompetitors: input.paidCompetitors ?? [],
    monetizationHeadroom: isZh
      ? '没有存下来的定价或结账观测。'
      : 'No pricing or checkout observation is stored.',
    negativeSignalCheck: {
      passed: false,
      findings: [isZh ? '尚未做负面信号检查。' : 'Negative signals have not been checked.'],
    },
  };

  // 6. Section 5: Execution Blueprint
  const section5: Section5ExecutionBlueprint = {
    archetype: input.scoring.recommendedArchetype,
    executionClass: input.scoring.executionClass,
    targetTimeframeDays: input.scoring.executionClass === 'S' ? 14 : 30,
    mvpScope: {
      inScope: [],
      outOfScope: [],
    },
    recommendedStack: {
      frontend: '',
      backend: '',
      database: '',
      hosting: '',
    },
    sprintPlan14d: [],
    executionBrief: {
      primaryQuery: input.primaryQuery,
      searchIntent: input.searchIntent ?? 'TRANSACTIONAL',
      coreJob: input.jobToBeDone ?? `Help the user complete the core task behind "${input.primaryQuery}".`,
      mvpPageType: input.recommendedProductShape ?? 'Lightweight tool landing page',
      coreAction: input.scoring.recommendedArchetype === 'LIGHTWEIGHT_TOOL' ? 'Complete the core task without sign-up.' : 'Answer the primary search question with verifiable evidence.',
      requiredVariants: (input.clusterQueries ?? []).slice(0, 8).map((q) => q.query),
      initialPages: [
        { path: '/', purpose: 'Primary task and value proposition' },
        { path: '/how-it-works', purpose: 'Explain the result and establish trust' },
        { path: '/faq', purpose: 'Cover high-intent questions and objections' },
      ],
      internalLinkPlan: ['Home links to the primary task page and supporting pages.', 'Supporting pages link back to the primary task and the parent topic.', 'Every page links to one next-step action.'],
      launchChecklist: ['Verify server-rendered primary content.', 'Submit sitemap and connect GSC.', 'Publish only pages with distinct search intent.', 'Review impressions, queries and indexing at T+7 and T+14.'],
      nonGoals: ['No bulk page generation before indexing evidence.', 'No ranking or traffic guarantee.', 'No paid or low-quality link scheme.'],
    },
  };

  // 7. Section 6: Kill Criteria
  const section6: Section6KillCriteria = {
    activeRules: input.killCriteria ?? [],
    invalidationConditions: [],
    radarWatchGuidance: isZh
      ? '没有单独的失效条件。发布资格仍要求 14 天联想历史和一份单一来源的自然搜索快照。'
      : 'No extra invalidation rule is stored. Publication still requires 14 days of autocomplete history and one single-source organic SERP snapshot.',
  };

  return {
    metadata,
    section1,
    section2,
    section3,
    section4,
    section5,
    section6,
  };
}
