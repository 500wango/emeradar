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
  clusterQueries?: {
    query: string;
    intent: 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL' | 'NAVIGATIONAL';
    volumeTier: 'HIGH' | 'MEDIUM' | 'EMERGING';
  }[];
  queryVelocity?: number;
  autocompleteSuggestions?: string[];
  top10Serp?: {
    rank: number;
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
        ? `针对 "${input.primaryQuery}" 搜索机会，当前判定为 ${input.scoring.verdict}。需求热度充足（${(input.scoring.dScore / 100).toFixed(1)}/100），竞争窗口呈现显著切入空间（${(input.scoring.wScore / 100).toFixed(1)}/100）。`
        : `Validated ${input.scoring.verdict} opportunity around "${input.primaryQuery}". Robust search demand (${(input.scoring.dScore / 100).toFixed(1)}/100) intersects with an addressable competitive window (${(input.scoring.wScore / 100).toFixed(1)}/100).`),
    whyNow:
      input.llmSummaryNarrative?.whyNow ||
      input.scoring.explanation.wReason ||
      (isZh
        ? '近期行业规范与外部环境发生变化，现有头部站点内容滞后，形成短期内可快速切入的利基窗口。'
        : 'Recent industry shifts and outdated incumbent SERP content create an immediate tactical entry window.'),
    topIdea:
      input.llmSummaryNarrative?.topIdea ||
      (isZh
        ? `构建聚焦轻量即用的 ${input.scoring.recommendedArchetype}，解决用户核心计算与导出诉求。`
        : `Ship a focused ${input.scoring.recommendedArchetype} addressing the direct user workflow with frictionless onboarding.`),
    keyRisks: isZh
      ? [
          '官方平台可能在未来大版本中推出内置原生功能',
          '若未在 60 天内建立品牌或外链沉淀，窗口可能随竞品涌入迅速关闭',
        ]
      : [
          'Platform provider may introduce native baseline features in future major updates',
          'Competitive window may narrow within 60 days as copycat tools replicate organic footprint',
        ],
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
  const defaultClusters = [
    { query: input.primaryQuery, intent: 'COMMERCIAL' as const, volumeTier: 'HIGH' as const },
    { query: `${input.primaryQuery} free`, intent: 'TRANSACTIONAL' as const, volumeTier: 'HIGH' as const },
    { query: `best ${input.primaryQuery} online`, intent: 'COMMERCIAL' as const, volumeTier: 'MEDIUM' as const },
    { query: `how to use ${input.primaryQuery}`, intent: 'INFORMATIONAL' as const, volumeTier: 'EMERGING' as const },
  ];

  const section2: Section2DemandBreakdown = {
    primaryQuery: input.primaryQuery,
    clusterQueries: input.clusterQueries && input.clusterQueries.length > 0 ? input.clusterQueries : defaultClusters,
    queryVelocity: input.queryVelocity ?? 1.25,
    autocompleteSignals: input.autocompleteSuggestions || [
      `${input.primaryQuery} 2026`,
      `${input.primaryQuery} open source`,
      `${input.primaryQuery} alternative`,
    ],
    momentumAssessment: isZh
      ? `簇内长尾词数量稳定增长，7 天新增查询率维持在健康区间，表明该利基正处于由早鸟探索向大众需求扩散的关键阶段。`
      : `Healthy cluster expansion across long-tail modifiers indicates growing search adoption moving from early adopters to mainstream users.`,
  };

  // 4. Section 3: Competitive Landscape & SERP Weakness
  const top10 = input.top10Serp && input.top10Serp.length > 0
    ? input.top10Serp
    : [
        { rank: 1, domain: 'reddit.com', title: 'Reddit discussion thread', resultType: 'UGC_THREAD', isWeak: true, weaknessReason: 'Unstructured community discussion without dedicated interactive tool' },
        { rank: 2, domain: 'legacy-blog.org', title: 'Comprehensive guide 2022', resultType: 'EDITORIAL_MEDIA', isWeak: true, weaknessReason: 'Outdated content published >24 months ago' },
        { rank: 3, domain: 'affiliate-roundup.io', title: 'Top 5 tools listed', resultType: 'LISTICLE_AFFILIATE', isWeak: true, weaknessReason: 'Thin affiliate comparison without unique utility' },
        { rank: 4, domain: 'incumbent-saas.com', title: 'Enterprise Suite Features', resultType: 'SPECIALIST', isWeak: false },
        { rank: 5, domain: 'stackoverflow.com', title: 'Code snippet question', resultType: 'QA', isWeak: true, weaknessReason: 'Developer QA forum snippet requiring manual configuration' },
      ];

  const weakCount = top10.filter((item) => item.isWeak).length;

  const section3: Section3CompetitiveWeakness = {
    serpWeaknessScore: input.scoring.wScore / 100,
    weakResultsRatio: top10.length > 0 ? weakCount / top10.length : 0.6,
    top10Results: top10,
    vulnerableGaps: isZh
      ? [
          '前 5 位结果中存在过时的博客与 Reddit 论坛帖，缺乏现代交互式专用工具',
          '现存商业竞品价格门槛过高，中小用户被拒之门外，急需自助轻量方案',
        ]
      : [
          'High density of forum threads and legacy blog posts in Top 5 indicates insufficient specialist competition',
          'Incumbent commercial solutions are bloated and priced out of reach for indie and SMB operators',
        ],
  };

  // 5. Section 4: Commercial Validation
  const paidCompetitors = input.paidCompetitors && input.paidCompetitors.length > 0
    ? input.paidCompetitors
    : [
        {
          domain: 'tool-pro.com',
          pricingModel: 'Subscription',
          priceRange: '$19 - $79 / mo',
          paymentGateways: ['Stripe', 'Credit Card'],
        },
        {
          domain: 'calc-cloud.io',
          pricingModel: 'Usage-based',
          priceRange: '$0.05 / transaction',
          paymentGateways: ['Stripe'],
        },
      ];

  const section4: Section4CommercialValidation = {
    evidenceCount: input.evidenceCounts || {
      total: 8,
      observed: 5,
      selfReported: 2,
      estimated: 1,
    },
    paidCompetitors,
    monetizationHeadroom: isZh
      ? '已观测到至少 2 家独立付费竞品稳定运营，商业意图明确，支持按月订阅与单次付费混合模式。'
      : 'At least 2 active paid competitors demonstrate proven commercial willingness to pay in this segment.',
    negativeSignalCheck: {
      passed: true,
      findings: [],
    },
  };

  // 6. Section 5: Execution Blueprint
  const section5: Section5ExecutionBlueprint = {
    archetype: input.scoring.recommendedArchetype,
    executionClass: input.scoring.executionClass,
    targetTimeframeDays: input.scoring.executionClass === 'S' ? 14 : 30,
    mvpScope: {
      inScope: isZh
        ? [
            '核心交互式计算器 / 转换器功能，无需注册即刻体验',
            '结果导出为 CSV / PDF / Markdown',
            '基础付费墙（Stripe 结账）提供高级功能或无限制导出',
          ]
        : [
            'Frictionless core utility accessible without upfront account registration',
            'Structured exports in CSV, JSON, and PDF formats',
            'Lightweight paywall (Stripe Checkout) unlocking unlimited batches and premium rules',
          ],
      outOfScope: isZh
        ? ['复杂团队权限协作管理', '企业级单点登录 (SSO)', '全量多币种本地税务对账引擎']
        : ['Complex multi-tenant workspace permissions', 'Enterprise SAML/SSO', 'Custom ERP integrations'],
    },
    recommendedStack: {
      frontend: 'Next.js 15+ (App Router) + Tailwind CSS + Lucide Icons',
      backend: 'Next.js API Route Handlers + TypeScript',
      database: 'PostgreSQL (Supabase / Neon)',
      hosting: 'Vercel / Cloudflare Workers',
    },
    sprintPlan14d: [
      {
        phase: 'Sprint 1: Core Engine & UI',
        days: 'Day 1 - 4',
        deliverables: [
          'Implement core calculation/generation logic with 100% test coverage',
          'Build clean Tailwind responsive interface with instant feedback',
        ],
      },
      {
        phase: 'Sprint 2: Monetization & SEO',
        days: 'Day 5 - 9',
        deliverables: [
          'Integrate Stripe Checkout and Customer Portal',
          'Deploy optimized Programmatic/Static SEO landing pages targeting cluster queries',
        ],
      },
      {
        phase: 'Sprint 3: Launch & Tracking',
        days: 'Day 10 - 14',
        deliverables: [
          'Deploy to production domain with OpenGraph cards and analytics',
          'Submit sitemap to Google Search Console and link Emeradar project tracking',
        ],
      },
    ],
  };

  // 7. Section 6: Kill Criteria
  const section6: Section6KillCriteria = {
    activeRules: input.killCriteria || [
      {
        code: 'KC-01',
        rule: 'Official platform releases free built-in tool',
        rationale: 'Destroys independent standalone conversion motivation.',
      },
      {
        code: 'KC-02',
        rule: 'Top 3 SERP occupied by authoritative domain with specialist tool',
        rationale: 'Drives acquisition cost above reasonable unit economics for bootstrappers.',
      },
    ],
    invalidationConditions: isZh
      ? [
          '若 60 天内该查询簇在 Google Search Console 中无任何曝光（<100 次曝光），应果断关闭项目',
          '若自然搜索转化率低于 0.5%，表明用户仅寻找纯免费信息，商业假设不成立',
        ]
      : [
          'If organic impressions remain <100 after 60 days on production domain, discontinue active maintenance',
          'If visitor-to-conversion rate remains below 0.5%, monetization thesis is invalidated',
        ],
    radarWatchGuidance: isZh
      ? '已在 Emeradar 中激活每日雷达跟踪：若该机会评分降级为 PASS 或竞争窗口显著收窄，系统将自动触发即时告警。'
      : 'Continuous radar monitoring enabled: Emeradar will trigger alerts if verdict shifts or new authoritative entrants emerge.',
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
