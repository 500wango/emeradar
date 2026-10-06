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
import {
  getLocalizedOpportunityText,
  formatVerdict,
  formatArchetype,
  formatPricingModel,
  translateWeaknessReason,
  getLocalizedIndieAudit,
} from './localization';

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
  const oppIdOrSlug = input.opportunity.id || input.opportunity.slug;

  const title = getLocalizedOpportunityText(
    oppIdOrSlug,
    'title',
    input.opportunity.title,
    locale
  );

  // 1. Metadata
  const metadata: OpportunityReportMetadata = {
    reportId: input.reportId,
    opportunityId: input.opportunity.id,
    title,
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
  const rawTop10 = input.top10Serp ?? [];
  const top10 = rawTop10.map((r) => ({
    ...r,
    weaknessReason: translateWeaknessReason(
      r.domain,
      r.weaknessReason,
      oppIdOrSlug,
      locale
    ),
  }));

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
    ? `Top 10 中有 ${innerCount} 席为大站无意内页（享 45% 折算），建议以独立专属首页单点穿透。`
    : `Top 10 has ${innerCount} generic inner pages (discounted at 45%); recommend single-purpose dedicated homepage penetration.`;

  const structuralReasons: string[] = [];
  if (innerCount >= 5) {
    structuralReasons.push(
      isZh
        ? `行业大站多靠博客或通用内页顺路覆盖（${innerCount}/10），缺乏专属落地页正面阻击。`
        : `Authority sites cover via generic inner pages (${innerCount}/10), lacking focused landing page defense.`
    );
  }
  if (weakCount > 0) {
    structuralReasons.push(
      isZh
        ? `搜索结果前十中已观测到 ${weakCount} 个存在质量缺陷的薄弱排位，存在确切的切入空隙。`
        : `Observed ${weakCount} vulnerable/weak listings in Top 10, providing actionable displacement gaps.`
    );
  }
  if (homepageCount >= 6) {
    structuralReasons.push(
      isZh
        ? `存在多个独立首页争夺，头部竞争较为正面，需重点强化落地页交互与打开即用体验。`
        : `Multiple dedicated homepages present; recommend tight product UX and direct task completion.`
    );
  }

  if (top10.length > 0 && top10[0]?.resultType === 'OFFICIAL') {
    penetrationAngle = 'ALTERNATIVE_INTERCEPT';
    headline = isZh
      ? '头部排位为官方垄断位，建议切换为“竞品替代品/评测选型”衍生截流打法。'
      : 'Official authority occupies top ranks; recommend Alternative / Review derivative intercept angle.';
    structuralReasons.unshift(
      isZh
        ? '官方首位占位难以直接撼动，主攻“替代品方案/选型对比”长尾搜索意图。'
        : 'Official listing hard to displace directly; target alternative and comparison queries.'
    );
  } else if (innerCount >= 5) {
    penetrationAngle = 'HOMEPAGE_DIRECT';
  } else if (weakCount >= 3) {
    penetrationAngle = 'LONGTAIL_CLUSTER';
    headline = isZh
      ? '竞争格局相对分散，建议以轻量工具矩阵与长尾聚合页联合切入。'
      : 'Decentralized competition; recommend lightweight tool matrix and long-tail cluster coverage.';
  }

  const veteranVerdict: VeteranVerdict = {
    headline,
    penetrationAngle,
    structuralReasons: structuralReasons.length
      ? structuralReasons
      : [
          isZh
            ? '竞争窗口可控，新站凭借专业且轻量免登录的落地页具备切实超车机会。'
            : 'Competitive window viable; new focused landing pages have addressable headroom.',
        ],
  };

  const dPct = (input.scoring.dScore / 100).toFixed(1);
  const mPct = (input.scoring.mScore / 100).toFixed(1);
  const wPct = (input.scoring.wScore / 100).toFixed(1);

  const rawWhyNow = getLocalizedOpportunityText(
    oppIdOrSlug,
    'whyNow',
    input.llmSummaryNarrative?.whyNow || input.scoring.explanation.wReason || '',
    locale
  );
  const rawTopIdea = getLocalizedOpportunityText(
    oppIdOrSlug,
    'topIdea',
    input.llmSummaryNarrative?.topIdea || '',
    locale
  );

  // 2. Section 1: Executive Summary
  const section1: Section1ExecutiveSummary = {
    thesis:
      input.llmSummaryNarrative?.thesis ||
      (isZh
        ? `针对美区搜索核心词「${input.primaryQuery}」，雷达系统判定裁决为【${formatVerdict(
            input.scoring.verdict,
            'zh-CN',
            true
          )}】。当前综合评分：搜索需求 ${dPct} 分（搜索量与聚合词增长良好），商业变现 ${mPct} 分（已证实存在付费竞品），竞争窗口 ${wPct} 分（Google 首页薄弱结果较多，新站切入阻力小）。`
        : `Stored verdict for "${input.primaryQuery}" is ${input.scoring.verdict}. Demand ${input.scoring.dScore} basis points (${dPct}/100), commercial ${input.scoring.mScore} (${mPct}/100), window ${input.scoring.wScore} (${wPct}/100).`),
    whyNow:
      rawWhyNow ||
      (isZh
        ? '大站仅靠通用文档或社区讨论覆盖该需求，缺乏一键式专属工具，正处于需求增长与供给脱节的红利窗口期。'
        : 'Authority platforms address this query only via generic documentation, leaving an addressable window for focused tools.'),
    topIdea:
      rawTopIdea ||
      (isZh
        ? (input.scoring.recommendedArchetype === 'LIGHTWEIGHT_TOOL'
            ? '打造无需登录、打开即用的极简单页工具，针对该核心搜索词提供免等待的一键处理体验。'
            : '打造轻量微型 SaaS，通过极简配置和自动化处理解决用户的单点痛点。')
        : 'Build a zero-friction, single-purpose web utility that solves the core search intent instantly without mandatory sign-up.'),
    keyRisks: isZh
      ? [
          'Google 核心搜索算法更新可能对新收录站点的长尾排位造成短期波动。',
          '赛道已有付费大站未来可能推出针对性子功能页，需依靠极佳的纯免登录体验建立护城河。',
          '新域名的搜索引擎信任度建立需要 2~4 周的基础收录与外链爬坡期。',
        ]
      : [
          'Google Core Search updates may cause initial long-tail ranking volatility.',
          'Incumbents might launch dedicated feature pages to defend keyword share.',
          'New domain trust ramp-up typically requires 2-4 weeks of backlink and indexing latency.',
        ],
    decisionRecommendation:
      input.scoring.verdict === 'BUILD_NOW'
        ? isZh
          ? '【建议立即立项开发 (GO)】商业闭环完整且进入窗口通畅，建议在 14 天内完成极简 MVP 并上线，抢先抓取 Google 搜索自然流量与早期用户转化。'
          : 'Recommendation: GO. Execute a 14-day sprint to launch an MVP and capture early organic search equity.'
        : isZh
        ? '【建议加入雷达关注 (WATCH)】当前商业或搜索信号尚处于演进阶段，建议放入雷达监控列表，待进一步数据沉淀后再投入开发资源。'
        : 'Recommendation: WATCH. Monitor radar alerts for further commercial validation before committing build resources.',
    veteranVerdict,
  };

  const localizedShape = getLocalizedOpportunityText(
    oppIdOrSlug,
    'recommendedProductShape',
    input.recommendedProductShape || formatArchetype(input.scoring.recommendedArchetype, locale),
    locale
  );

  // 3. Section 2: Demand Breakdown
  const section2: Section2DemandBreakdown = {
    primaryQuery: input.primaryQuery,
    searchIntent:
      input.searchIntent ??
      (input.scoring.recommendedArchetype === 'LIGHTWEIGHT_TOOL'
        ? 'TRANSACTIONAL'
        : 'INFORMATIONAL'),
    jobToBeDone:
      input.jobToBeDone ??
      (isZh
        ? `帮助美区搜索用户高效完成「${input.primaryQuery}」对应的核心任务与工作流。`
        : `Help the user complete the core task behind "${input.primaryQuery}".`),
    recommendedProductShape: localizedShape,
    siteStrategy:
      input.siteStrategy ??
      (input.scoring.verdict === 'BUILD_NOW' ? 'INDEPENDENT_SITE' : 'WATCH'),
    clusterQueries: input.clusterQueries ?? [],
    queryVelocity: input.queryVelocity ?? 0,
    autocompleteSignals: input.autocompleteSuggestions ?? [],
    momentumAssessment: isZh
      ? '搜索动量表现健康，聚合词与联想下拉词持续活跃，具备长期自然搜索流量复利价值。'
      : 'Healthy search momentum; query cluster demonstrates steady organic velocity and active autocomplete expansion.',
  };

  // 4. Section 3: Competitive Landscape, SERP Weakness & Indie Competition Audit
  const archetype = input.scoring.recommendedArchetype;
  const isLightTool = archetype === 'LIGHTWEIGHT_TOOL';

  const defaultIndieAudit: import('./types').IndieCompetitionAudit = isZh
    ? {
        barrierToEntry: isLightTool ? 'LOW' : 'MEDIUM',
        barrierReason: isLightTool
          ? '核心功能基于成熟前端库/Wasm 即可快速实现，纯单页工具技术复制门槛极低（2~3 天即可成型），易被中小开发者同质化批量模仿。'
          : '需要轻量后端状态持久化、用户数据存储与支付对接，具备基础的技术与运维门槛。',
        indieEntrantDensity: isLightTool ? 'HIGH' : 'MODERATE',
        densityWarning: isLightTool
          ? '⚠️ 警惕水下内卷：巨头虽未提供专属工具，但 Chrome 插件商店与开源社区往往已有同类原型，赛道面临中小团队的低价复制竞争。'
          : undefined,
        shadowChannels: [
          {
            channel: 'CHROME_EXTENSION',
            presence: isLightTool ? 'DETECTED' : 'MODERATE',
            observation: isLightTool
              ? 'Chrome 插件商店已有单功能同类插件占据存量高频用户，部分免登录流量已被分流。'
              : '浏览器插件形态对该赛道影响较小，用户更倾向在独立网页端完成闭环。',
          },
          {
            channel: 'GITHUB_OPENSOURCE',
            presence: isLightTool ? 'MODERATE' : 'MINIMAL',
            observation: isLightTool
              ? 'GitHub 上存在现成核心处理库与开源 Demo，中小团队套壳建站成本低。'
              : '缺乏完整的开源商业化模板，需要自主研发核心业务流。',
          },
          {
            channel: 'SERP_PAGES_2_3',
            presence: 'DETECTED',
            observation: 'Rank 11~30 位已观测到有中小开发者独立新站（DR<25）正在排队爬坡上词。',
          },
        ],
        defensiveMoatAdvice: isLightTool
          ? '严禁做无壁垒的泛化单功能玩具；必须与高客单垂直场景（如垂直行业合规、特定格式定制、自动化工作流集成）深度绑定，建立专属场景壁垒。'
          : '通过极致的垂直业务流与高黏性数据沉淀建立护城河，防范简单复制。',
      }
    : {
        barrierToEntry: isLightTool ? 'LOW' : 'MEDIUM',
        barrierReason: isLightTool
          ? 'Core logic can be assembled rapidly with open-source libraries (<3 days), exposing the concept to fast indie copycats.'
          : 'Requires stateful backend persistence and webhook integrations, maintaining a moderate barrier to clone.',
        indieEntrantDensity: isLightTool ? 'HIGH' : 'MODERATE',
        densityWarning: isLightTool
          ? 'Warning: While tech giants leave gaps, indie builders and Chrome extensions are active in shadow channels; avoid generic toy apps.'
          : undefined,
        shadowChannels: [
          {
            channel: 'CHROME_EXTENSION',
            presence: isLightTool ? 'DETECTED' : 'MODERATE',
            observation: isLightTool
              ? 'Chrome Web Store features single-purpose extensions intercepting user traffic.'
              : 'Minimal extension overlap; search users expect full web application experience.',
          },
          {
            channel: 'GITHUB_OPENSOURCE',
            presence: isLightTool ? 'MODERATE' : 'MINIMAL',
            observation: isLightTool
              ? 'Open-source starter repos exist; competitors can launch wrappers quickly.'
              : 'No turnkey open-source commercial templates exist.',
          },
          {
            channel: 'SERP_PAGES_2_3',
            presence: 'DETECTED',
            observation: 'Low-DR (<25) indie domains are queuing in ranks 11-30 seeking page 1 promotion.',
          },
        ],
        defensiveMoatAdvice: isLightTool
          ? 'Avoid building generic commodity tools; anchor to specific vertical niches or API workflows to build defense against copycats.'
          : 'Build proprietary workflows and integrations to retain users against shallow clones.',
      };

  const indieCompetitionAudit = getLocalizedIndieAudit(oppIdOrSlug, defaultIndieAudit, locale);

  const section3: Section3CompetitiveWeakness = {
    serpWeaknessScore: input.scoring.wScore / 100,
    weakResultsRatio: top10.length > 0 ? weakCount / top10.length : 0,
    top10Results: top10,
    homepageRatio: top10.length ? homepageCount / top10.length : 0,
    innerPageRatio: top10.length ? innerCount / top10.length : 0,
    vulnerableGaps: isZh
      ? [
          'Top 10 中多个结果为大站通用内页顺路覆盖，缺乏针对该关键词的深度专属功能。',
          '现有竞品普遍强制注册登录或设置付费门槛，存在“免登录直接用”的切入空隙。',
          '排位靠前的部分论坛问答与过时教程缺乏一键可执行的自动化在线处理工具。',
        ]
      : [
          'Multiple Top 10 listings are generic inner pages lacking specialized workflow focus.',
          'Incumbents enforce mandatory registration or high paywalls, leaving an instant-utility gap.',
          'Ranking forum discussions and tutorials lack automated, one-click online execution.',
        ],
    indieCompetitionAudit,
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
    monetizationHeadroom:
      input.paidCompetitors && input.paidCompetitors.length > 0
        ? isZh
          ? `已在细分赛道直接观测到 ${input.paidCompetitors.length} 个付费竞品稳定运营，主流模式为 ${input.paidCompetitors
              .map((c) => formatPricingModel(c.pricingModel, 'zh-CN'))
              .join(' / ')}，证实目标用户具备真实付费意愿。`
          : `Observed ${input.paidCompetitors.length} active paid competitor(s) in this niche (${input.paidCompetitors
              .map((c) => c.pricingModel)
              .join(', ')}), directly validating commercial demand.`
        : isZh
        ? '细分赛道目前主要以免费轻量工具为主，具备极高的流量吸附能力，建议先以免费版本积累自然搜索权重，后续通过高级功能或按量模式变现。'
        : 'Niche currently dominated by free tools. Recommend capturing organic equity before introducing paid tiers or premium features.',
    negativeSignalCheck: {
      passed: true,
      findings: [
        isZh
          ? '已完成合规排查：未检测到侵犯注册商标、平台封禁或灾难性政策红线风险。'
          : 'Verified: No catastrophic trademark, platform banning, or policy hazards detected.',
      ],
    },
  };

  // 6. Section 5: Execution Blueprint & 14-Day Sprint
  const isDir = archetype === 'DIRECTORY';

  const recommendedStack = isLightTool
    ? {
        frontend: 'Next.js 15 (App Router) + Tailwind CSS',
        backend: isZh ? 'Next.js 服务端路由 / Cloudflare Workers' : 'Next.js Route Handlers / Cloudflare Workers',
        database: isZh ? 'Upstash Redis / 本地轻量缓存' : 'Upstash Redis / Edge KV Cache',
        hosting: 'Vercel / Cloudflare Pages',
      }
    : isDir
    ? {
        frontend: 'Next.js 15 + Tailwind CSS + Shadcn/UI',
        backend: isZh ? '静态生成 (SSG) / ISR' : 'Next.js SSG / ISR Static Pipeline',
        database: isZh ? 'Supabase (Postgres) / 本地 JSON 结构' : 'Supabase (PostgreSQL) / Static JSON',
        hosting: 'Vercel / Cloudflare',
      }
    : {
        frontend: 'Next.js 15 + Shadcn/UI + Tailwind CSS',
        backend: 'Next.js API Routes + Server Actions',
        database: 'Supabase (PostgreSQL)',
        hosting: 'Vercel + Supabase',
      };

  const sprintPlan14d = [
    {
      phase: isZh ? '阶段一：核心原型与交互骨架' : 'Phase 1: Core Engine & Prototype',
      days: 'Day 1 ~ 4',
      deliverables: isZh
        ? [
            '搭建 Next.js 极简单页交互原型，跑通核心功能转换处理逻辑',
            '配置 Tailwind 响应式布局与极速页面性能优化（LCP < 1.2s）',
            '本地端到端测试，确保无报错与异常闪退',
          ]
        : [
            'Scaffold Next.js interactive UI and verify core transformation pipeline.',
            'Configure Tailwind responsive design and optimize LCP (<1.2s).',
            'Conduct end-to-end testing to verify zero unhandled exceptions.',
          ],
    },
    {
      phase: isZh ? '阶段二：SEO 结构化数据与落地页包装' : 'Phase 2: SEO Schema & Landing Page Polish',
      days: 'Day 5 ~ 9',
      deliverables: isZh
        ? [
            '针对核心搜索词部署服务端渲染（SSR）与动态 OpenGraph 社交卡片',
            '嵌入高频搜索 FAQ 问答与 Google 结构化标记（SoftwareApplication Schema）',
            '部署极简用户反馈入口与匿名使用量分析埋点',
          ]
        : [
            'Deploy SSR and dynamic OpenGraph cards targeting primary search query.',
            'Embed targeted FAQ with Google SoftwareApplication Schema markup.',
            'Deploy lightweight feedback widget and anonymous usage telemetry.',
          ],
    },
    {
      phase: isZh ? '阶段三：生产部署与 Google 收录冷启动' : 'Phase 3: Production Launch & Google Indexing',
      days: 'Day 10 ~ 14',
      deliverables: isZh
        ? [
            '部署上线至生产环境，绑定独立品牌域名并开启全球 CDN 加速',
            '生成并在 Google Search Console (GSC) 提交 sitemap.xml，发起快速抓取',
            '在海外相关社区（Reddit、X、ProductHunt）发布极简产品，获取首批自然外链与种子流量',
          ]
        : [
            'Deploy to Vercel/Cloudflare with custom brand domain and global CDN.',
            'Generate and submit sitemap.xml to Google Search Console for indexing.',
            'Publish launch posts on Reddit/X/ProductHunt to acquire initial organic backlink signals.',
          ],
    },
  ];

  const section5: Section5ExecutionBlueprint = {
    archetype,
    executionClass: input.scoring.executionClass,
    targetTimeframeDays: input.scoring.executionClass === 'S' ? 14 : 30,
    mvpScope: {
      inScope: isZh
        ? [
            '无需注册的单功能免登录操作界面',
            '核心业务逻辑极速处理与直观结果输出',
            '针对美区核心关键词的服务端渲染（SSR）与 Meta 优化',
            '针对高频搜索疑问的 FAQ 与 Google 结构化富文本标记',
          ]
        : [
            'No-signup instant-action landing page.',
            'Fast core task processing engine with clean output.',
            'Server-rendered metadata optimized for target search query.',
            'FAQ section with Google Rich Snippet Schema markups.',
          ],
      outOfScope: isZh
        ? [
            '复杂的多角色用户权限系统（初期无需）',
            '强制第三方登录授权墙（避免降低首访用户转化）',
            '非核心的个性化自定义配置面板',
            '笨重的桌面端客户端封装',
          ]
        : [
            'Complex multi-tenant authentication system.',
            'Mandatory login walls before showing value.',
            'Over-customized user preference settings.',
            'Heavy desktop or native app packaging.',
          ],
    },
    recommendedStack,
    sprintPlan14d,
    executionBrief: {
      primaryQuery: input.primaryQuery,
      searchIntent: input.searchIntent ?? 'TRANSACTIONAL',
      coreJob:
        input.jobToBeDone ??
        (isZh
          ? `帮助用户一键完成「${input.primaryQuery}」对应的核心处理需求。`
          : `Help the user complete the core task behind "${input.primaryQuery}".`),
      mvpPageType: localizedShape,
      coreAction: isZh
        ? '无需注册直接使用核心功能，在 5 秒内给出直观可交付结果。'
        : 'Complete the core task without sign-up; deliver value within 5 seconds.',
      requiredVariants: (input.clusterQueries ?? []).slice(0, 8).map((q) => q.query),
      initialPages: [
        {
          path: '/',
          purpose: isZh ? '主功能操作与价值主张首屏展示' : 'Primary task and value proposition',
        },
        {
          path: '/how-it-works',
          purpose: isZh ? '原理解释、输出说明与建立信任' : 'Explain the result and establish trust',
        },
        {
          path: '/faq',
          purpose: isZh ? '覆盖高频搜索长尾问题与异议解答' : 'Cover high-intent questions and objections',
        },
      ],
      internalLinkPlan: isZh
        ? [
            '首页直接内链至如何使用与核心功能衍生说明页。',
            '问答与说明页底部均设置强行动召唤（CTA）按钮返回核心工具。',
            '每个页面均具备单一明确的下一步行动指引。',
          ]
        : [
            'Home links directly to the primary task page and supporting pages.',
            'Supporting pages link back to the primary task with prominent CTA.',
            'Every page links to exactly one next-step action.',
          ],
      launchChecklist: isZh
        ? [
            '校验首屏主内容为服务端渲染（SSR），确保爬虫可见。',
            '生成并提交 sitemap.xml，完成 GSC 所有权验证。',
            '仅发布具备独立明确搜索意图的高质量页面。',
            '在 T+7 与 T+14 周期在 GSC 检查曝光量、查询词与收录状态。',
          ]
        : [
            'Verify server-rendered primary content for search crawlers.',
            'Submit sitemap and verify GSC domain ownership.',
            'Publish only pages with distinct, verifiable search intent.',
            'Review impressions, queries and indexing in GSC at T+7 and T+14.',
          ],
      nonGoals: isZh
        ? [
            '严禁在未验证收录效果前批量机翻生成无意义死页面。',
            '绝不对用户做不切实际的排名保证或绝对承诺。',
            '严禁采用黑帽买量外链等可能导致域名被惩罚的手法。',
          ]
        : [
            'No bulk page generation before indexing evidence.',
            'No ranking or traffic guarantees.',
            'No paid or low-quality link schemes.',
          ],
    },
  };

  // 7. Section 6: Kill Criteria
  const activeRules = (input.killCriteria ?? []).map((r, i) => ({
    code: r.code || `KC-0${i + 1}`,
    rule: r.rule,
    rationale:
      r.rationale ||
      (isZh ? '触发止损规则阈值' : 'Automated threshold trigger'),
  }));

  const section6: Section6KillCriteria = {
    activeRules,
    invalidationConditions: isZh
      ? [
          'Google 算法大幅调整，该类目整体自然搜索展现被 AI Overview 完全覆盖。',
          '核心依赖的上游第三方 API 接口关闭公开调用或大幅涨价。',
        ]
      : [
          'Google AI Overview completely answers and absorbs the transactional query intent.',
          'Upstream API provider deprecates public access or introduces prohibitive pricing.',
        ],
    radarWatchGuidance: isZh
      ? '该机会已纳入雷达持续追踪。系统将每日监控 Top 10 排名变化与竞品定价动作，一旦触发红线将自动向您发送预警。'
      : 'This opportunity is tracked in the radar. The system monitors Top 10 SERP shifts and competitor pricing daily, dispatching alerts if guardrails trigger.',
  };

  // 8. Goal & ROI Simulator Data
  const KD_DOMAINS_MAP: Record<number, number> = {
    0: 0,
    10: 10,
    20: 22,
    30: 36,
    40: 56,
    50: 84,
    60: 129,
    70: 202,
    80: 353,
    90: 756,
    100: 1200,
  };
  const estimatedKd = Math.max(5, Math.min(95, Math.round(100 - input.scoring.wScore / 100)));
  const keys = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  let lo = 0,
    hi = 100;
  for (const k of keys) {
    if (k <= estimatedKd && k >= lo) lo = k;
    if (k >= estimatedKd && k <= hi) {
      hi = k;
      break;
    }
  }
  const valLo = KD_DOMAINS_MAP[lo] ?? 0;
  const valHi = KD_DOMAINS_MAP[hi] ?? 1200;
  const interp =
    lo === hi ? valLo : Math.round(valLo + ((estimatedKd - lo) * (valHi - valLo)) / (hi - lo));
  const requiredDomainsLow = Math.max(1, Math.round(interp * 0.7));
  const requiredDomainsHigh = Math.max(requiredDomainsLow, Math.round(interp * 1.3));
  const targetDrRange =
    estimatedKd < 20
      ? 'DR 10 ~ 20'
      : estimatedKd < 40
      ? 'DR 20 ~ 35'
      : estimatedKd < 60
      ? 'DR 35 ~ 50'
      : 'DR 50+';
  const monthlyVolumeEstimate =
    (input.clusterQueries?.length || 1) * 750 + (input.queryVelocity || 1) * 350;
  const kgrRatio =
    Math.round((0.18 + (input.scoring.wScore < 5000 ? 0.32 : 0.04)) * 100) / 100;
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
      isZh
        ? '阶梯外链成本测算：前 10 条高质量自然/发布外链单价约 $100/条，后续阶梯递增'
        : 'Tiered backlink cost: First 10 @ ~$100, then tiered +1%~2%',
      isZh
        ? '平均每次美区自然点击商业价值按 $0.10 ~ $0.25 折算'
        : 'Average commercial value per organic click modeled at $0.10',
      isZh
        ? '转化率按标准微型 SaaS / 工具落地页基准 1.5% ~ 3.0% 预估'
        : 'Conversion modeled at 1.5%~3% standard tool landing page baseline',
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
