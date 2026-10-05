import {
  OpportunityReportData,
  OpportunityReportMetadata,
  Section1ExecutiveSummary,
  Section2DemandBreakdown,
  Section3CompetitiveWeakness,
  Section4CommercialValidation,
  Section5ExecutionBlueprint,
  Section6KillCriteria,
  SectionGoalSimulator,
  VeteranVerdict,
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

  // SERP Structural Analysis
  const top10 = input.top10Serp ?? [];
  const isHomepage = (url?: string): boolean => {
    if (!url) return true;
    try {
      const pathname = new URL(url).pathname.replace(/\/+$/, '');
      return pathname === '';
    } catch {
      return url.replace(/^\/+|\/+$/g, '').split('/').length <= 1;
    }
  };
  const homepageCount = top10.length ? top10.filter((item) => isHomepage(item.url)).length : 0;
  const innerCount = top10.length - homepageCount;
  const weakCount = top10.filter((item) => item.isWeak).length;

  let penetrationAngle: VeteranVerdict['penetrationAngle'] = 'HOMEPAGE_DIRECT';
  let headline = isZh
    ? `Top 10 中 ${innerCount} 席为大站无意内页（享 45% 折算），建议以独立专属首页单点穿透。`
    : `Top 10 has ${innerCount} generic inner pages (discounted at 45%); recommend single-purpose dedicated homepage penetration.`;

  const structuralReasons: string[] = [];
  if (innerCount >= 5) {
    structuralReasons.push(
      isZh
        ? `大站仅靠内页或博客顺路覆盖（${innerCount}/10），缺乏专属落地页正面阻击。`
        : `Authority sites cover via generic inner pages (${innerCount}/10), lacking focused landing page defense.`
    );
  }
  if (weakCount > 0) {
    structuralReasons.push(
      isZh
        ? `前十中已观测到 ${weakCount} 个可渗透薄弱结果，存在切实切入空隙。`
        : `Observed ${weakCount} vulnerable/weak listings in Top 10, providing actionable displacement gaps.`
    );
  }
  if (homepageCount >= 6) {
    structuralReasons.push(
      isZh
        ? `存在多个独立首页争夺，头部竞争较为正面，需重点强化落地页交互。`
        : `Multiple dedicated homepages present; recommend tight product UX and direct task completion.`
    );
  }

  if (top10.length > 0 && top10[0]?.resultType === 'OFFICIAL') {
    penetrationAngle = 'ALTERNATIVE_INTERCEPT';
    headline = isZh
      ? '头部排位为官方绝对垄断位，建议切换为 Alternative / Review 衍生截流打法。'
      : 'Official authority occupies top ranks; recommend Alternative / Review derivative intercept angle.';
    structuralReasons.unshift(
      isZh ? '头部官方占位难以正面替换，主攻“替代品/选型对比”搜索意图。' : 'Official listing hard to displace directly; target alternative and comparison queries.'
    );
  } else if (innerCount >= 5) {
    penetrationAngle = 'HOMEPAGE_DIRECT';
  } else if (weakCount >= 3) {
    penetrationAngle = 'LONGTAIL_CLUSTER';
    headline = isZh
      ? '竞争盘面较零散，建议以轻量工具矩阵与长尾聚合页联合切入。'
      : 'Decentralized competition; recommend lightweight tool matrix and long-tail cluster coverage.';
  }

  const veteranVerdict: VeteranVerdict = {
    headline,
    penetrationAngle,
    structuralReasons: structuralReasons.length
      ? structuralReasons
      : [
          isZh
            ? '窗口得分受控，新站凭借专业且轻量的落地页具备竞争机会。'
            : 'Competitive window viable; new focused landing pages have addressable headroom.',
        ],
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
    veteranVerdict,
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
  const section3: Section3CompetitiveWeakness = {
    serpWeaknessScore: input.scoring.wScore / 100,
    weakResultsRatio: top10.length > 0 ? weakCount / top10.length : 0,
    top10Results: top10,
    homepageRatio: top10.length ? homepageCount / top10.length : 0,
    innerPageRatio: top10.length ? innerCount / top10.length : 0,
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

  // 8. Goal & ROI Simulator Data
  const KD_DOMAINS_MAP: Record<number, number> = {
    0: 0, 10: 10, 20: 22, 30: 36, 40: 56, 50: 84, 60: 129, 70: 202, 80: 353, 90: 756, 100: 1200,
  };
  const estimatedKd = Math.max(5, Math.min(95, Math.round(100 - (input.scoring.wScore / 100))));
  const keys = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  let lo = 0, hi = 100;
  for (const k of keys) {
    if (k <= estimatedKd && k >= lo) lo = k;
    if (k >= estimatedKd && k <= hi) { hi = k; break; }
  }
  const valLo = KD_DOMAINS_MAP[lo] ?? 0;
  const valHi = KD_DOMAINS_MAP[hi] ?? 1200;
  const interp = lo === hi ? valLo : Math.round(valLo + ((estimatedKd - lo) * (valHi - valLo)) / (hi - lo));
  const requiredDomainsLow = Math.max(1, Math.round(interp * 0.7));
  const requiredDomainsHigh = Math.max(requiredDomainsLow, Math.round(interp * 1.3));
  const targetDrRange = estimatedKd < 20 ? 'DR 10 ~ 20' : (estimatedKd < 40 ? 'DR 20 ~ 35' : (estimatedKd < 60 ? 'DR 35 ~ 50' : 'DR 50+'));
  const monthlyVolumeEstimate = (input.clusterQueries?.length || 1) * 750 + (input.queryVelocity || 1) * 350;
  const kgrRatio = Math.round((0.18 + (input.scoring.wScore < 5000 ? 0.32 : 0.04)) * 100) / 100;
  const ekgrRatio = Math.round(kgrRatio * (1 + estimatedKd / 100) * 100) / 100;

  const goalSimulator: SectionGoalSimulator = {
    defaultMonthlyTargetUSD: 2000,
    estimatedKd,
    requiredDomainsLow,
    requiredDomainsHigh,
    targetDrRange,
    kgrRatio,
    ekgrRatio,
    clickValueUSD: 0.1,
    monthlyVolumeEstimate,
    assumptions: [
      isZh ? '阶梯外链成本：前 10 条约 $100/条，后续阶梯递增 1%~2%' : 'Tiered backlink cost: First 10 @ ~$100, then tiered +1%~2%',
      isZh ? '平均每次点击商业价值按 $0.10 折算' : 'Average commercial value per organic click modeled at $0.10',
      isZh ? '转化率按标准微型 SaaS / 工具落地页基准 1.5%~3% 预估' : 'Conversion modeled at 1.5%~3% standard tool landing page baseline',
    ],
  };

  return {
    metadata,
    section1,
    section2,
    section3,
    section4,
    section5,
    section6,
    goalSimulator,
  };
}
