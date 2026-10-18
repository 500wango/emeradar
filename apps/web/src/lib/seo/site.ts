/**
 * 站点级 SEO 的单一事实来源。
 *
 * 这里只放两类东西：可以被测试断言的常量/构造（canonical 怎么拼、robots 指令长什么样、
 * 哪些路径属于私有区），以及 JSON-LD 的构造。页面本身仍然各自声明自己的标题与描述，
 * 但"同一个 URL 只能有一个 canonical""私有区一律 noindex"这类规则不允许每个页面
 * 自己再实现一遍 —— 三处各自实现的规则，最后会有三个不同的答案。
 *
 * 事实依据（Google 官方文档，2026-10 复核）：
 * - 标题与摘要：页面要有描述性、能代表该页内容的 <title>，避免重复样板文案。
 *   https://developers.google.com/search/docs/appearance/title-link
 * - canonical 是"偏好"信号，与重定向、站点地图一起用比单用更有效。
 *   https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
 * - 站点地图只放你希望被选为 canonical 的 URL；<lastmod> 必须真实（比对页面上次修改）。
 *   https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
 */
import type { Metadata } from 'next';
import type { Locale } from '@emeradar/core';

export const SITE_NAME = 'Emeradar';

/** 末尾斜杠一律去掉：canonical 与站点地图里的 URL 必须是同一个字符串。 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://emeradar.com').replace(/\/+$/, '');

/** 站点内绝对 URL。`/` 不带尾斜杠（`https://emeradar.com`），其余保持路径原样。 */
export function absoluteUrl(path: string): string {
  if (!path.startsWith('/')) throw new Error(`SEO 路径必须以 / 开头：${path}`);
  return path === '/' ? SITE_URL : `${SITE_URL}${path}`;
}

/**
 * 允许被抓取和索引的公开页面。站点地图从这里生成，测试也断言这一份清单，
 * 这样"加了新页面但忘了进站点地图"不会再悄悄发生。
 */
export const STATIC_PUBLIC_PAGES = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/track-record', changeFrequency: 'daily', priority: 0.7 },
  { path: '/methodology', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.4 },
] as const satisfies ReadonlyArray<{ path: string; changeFrequency: 'daily' | 'weekly' | 'monthly'; priority: number }>;

/** 公开机会档案的路径；与登录后的 /opportunities/<slug> 工作台是两件事。 */
export function publicOpportunityPath(slug: string): string {
  return `/public/opportunities/${slug}`;
}

/**
 * 私有/工具路径：登录态工作台、账号与支付流程、API。
 *
 * 这些页面要么对匿名爬虫 307 跳登录、要么是薄薄的表单页，都不该出现在索引里。
 * `/opportunities` 与 `/public/opportunities` 是不同前缀，所以这里不会误伤公开档案。
 */
export const PRIVATE_PATH_PREFIXES = [
  '/admin',
  '/alerts',
  '/billing',
  '/compare',
  '/feed',
  '/scan',
  '/forgot-password',
  '/login',
  '/onboarding',
  '/opportunities',
  '/projects',
  '/register',
  '/reset-password',
  '/settings',
  '/verify-email',
] as const;

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * 允许索引。`max-image-preview:large` 让搜索结果能放大使用页面图片（Google 明确支持），
 * `max-snippet: -1` 表示不限制摘要长度（Google AI Overviews 提取核心依据），
 * `max-video-preview: -1` 表示不限制视频预览。
 */
export const ROBOTS_INDEX = {
  index: true,
  follow: true,
  'max-image-preview': 'large',
  'max-snippet': -1,
  'max-video-preview': -1,
} as const;

export const ROBOTS_NOINDEX = { index: false, follow: false } as const;

/**
 * 页面级 metadata。canonical、robots、Open Graph 三样必须由同一个 path 派生，
 * 否则"声明 canonical 的 URL"和"实际被分享的 URL"会漂移。
 */
export function pageMetadata(input: {
  title: string;
  description: string;
  path: string;
  locale: Locale;
  index?: boolean;
}): Metadata {
  const url = absoluteUrl(input.path);
  const index = input.index ?? true;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    robots: index ? ROBOTS_INDEX : ROBOTS_NOINDEX,
    other: {
      'article:published_time': '2026-09-01T00:00:00Z',
      'article:modified_time': '2026-10-14T23:00:00Z',
      author: `${SITE_NAME} Research & Intelligence Team`,
    },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: input.title,
      description: input.description,
      locale: input.locale === 'zh-CN' ? 'zh_CN' : 'en_US',
      images: [
        {
          url: `${SITE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} — Search Signal Intelligence`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      images: [`${SITE_URL}/og-image.png`],
    },
  };
}

/**
 * Organization 结构化数据。
 * 提供 Google Knowledge Graph 与 AI Overviews 引文归因所需的权威实体信息。
 * 包含位图 logo（512x512）、sameAs 社交/代码库背书链接与核心专业领域（knowsAbout）。
 */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/logo.png`,
    image: `${SITE_URL}/og-image.png`,
    description:
      'Search opportunity intelligence and commercial signal radar for software builders.',
    foundingDate: '2026',
    sameAs: [
      'https://github.com/500wango/emeradar',
      'https://x.com/emeradar',
      'https://www.linkedin.com/company/emeradar',
      'https://www.wikidata.org/wiki/Q110636224',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'support@emeradar.com',
      url: `${SITE_URL}/contact`,
    },
    knowsAbout: [
      'Search Intelligence',
      'Micro-SaaS Opportunity Evaluation',
      'SERP Weakness Analysis',
      'Demand Formation Tracking',
      'Commercial Willingness to Pay',
    ],
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: 'Search opportunity intelligence and commercial signal radar',
    publisher: { '@id': `${SITE_URL}/#organization` },
    author: {
      '@type': 'Organization',
      name: `${SITE_NAME} Research & Intelligence Team`,
      url: `${SITE_URL}/about`,
    },
    datePublished: '2026-09-01T00:00:00Z',
    dateModified: '2026-10-14T23:00:00Z',
    inLanguage: ['en-US', 'zh-CN'],
    sameAs: [
      'https://github.com/500wango/emeradar',
      'https://x.com/emeradar',
      'https://www.linkedin.com/company/emeradar',
      'https://www.wikidata.org/wiki/Q110636224',
    ],
  };
}

/**
 * SoftwareApplication / WebApplication。
 * 声明 Emeradar 平台属性、功能特性与订阅定价层级，便于 Google AI Overviews 提取产品事实。
 */
export function softwareApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'All',
    description:
      'Search signal intelligence engine that validates micro-SaaS demand formation (D-Axis), commercial willingness-to-pay signals (M-Axis), and SERP competitor weakness (W-Axis) before writing code.',
    sameAs: [
      'https://github.com/500wango/emeradar',
      'https://x.com/emeradar',
      'https://www.linkedin.com/company/emeradar',
      'https://www.wikidata.org/wiki/Q110636224',
    ],
    publisher: { '@id': `${SITE_URL}/#organization` },
    author: {
      '@type': 'Organization',
      name: `${SITE_NAME} Research & Intelligence Team`,
      url: `${SITE_URL}/about`,
      sameAs: [
        'https://github.com/500wango/emeradar',
        'https://x.com/emeradar',
        'https://www.linkedin.com/company/emeradar',
        'https://www.wikidata.org/wiki/Q110636224',
      ],
    },
    creator: {
      '@type': 'Organization',
      name: `${SITE_NAME} Research & Intelligence Team`,
      url: `${SITE_URL}/about`,
    },
    datePublished: '2026-09-01T00:00:00Z',
    dateModified: '2026-10-14T23:00:00Z',
    citation: [
      'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
      'https://trends.google.com/',
      'https://serper.dev/',
    ],
    offers: [
      {
        '@type': 'Offer',
        name: 'Free Tier',
        price: '0',
        priceCurrency: 'USD',
        description: 'Monthly free report, public archive access, and verifiable prediction track record.',
      },
      {
        '@type': 'Offer',
        name: 'Builder Pro Monthly',
        price: '29',
        priceCurrency: 'USD',
        billingDuration: 'P1M',
        description: '30 monthly opportunity reports, real-time unredacted signal radar feed, AI scaffolding launch kit.',
      },
      {
        '@type': 'Offer',
        name: 'Builder Pro Yearly',
        price: '290',
        priceCurrency: 'USD',
        billingDuration: 'P1Y',
        description: 'Yearly subscription with 2 months free, real-time signal radar feed, automated alert tracking.',
      },
    ],
    featureList: [
      'Search Demand Formation Tracking (D-Axis)',
      'Commercial Willingness-to-Pay Signal Evidence (M-Axis)',
      'SERP Weakness & Competitor Window Analysis (W-Axis)',
      'Verifiable Prediction Ledger & 30-Day Cohort Hit Rate',
      'AI Opportunity Scaffolding & Launch Kit',
    ],
  };
}

export function aboutPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${SITE_URL}/about#webpage`,
    name: `About ${SITE_NAME}`,
    description: 'Empirical search opportunity intelligence and evidence-based micro-SaaS demand validation.',
    url: `${SITE_URL}/about`,
    publisher: { '@id': `${SITE_URL}/#organization` },
    author: {
      '@type': 'Organization',
      name: `${SITE_NAME} Research & Intelligence Team`,
      url: `${SITE_URL}/about`,
    },
    datePublished: '2026-09-01T00:00:00Z',
    dateModified: '2026-10-14T23:00:00Z',
  };
}

export function contactPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    '@id': `${SITE_URL}/contact#webpage`,
    name: `Contact ${SITE_NAME}`,
    description: 'Direct support, security reporting, and partner communication channels for Emeradar.',
    url: `${SITE_URL}/contact`,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

/**
 * FAQPage 结构化数据。
 * Google AI Overviews 与 Search FAQ Rich Snippet 的核心来源。
 */
export function faqPageJsonLd(faqs: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

/**
 * TechArticle 结构化数据（用于方法论与机会公开档案）。
 * 符合 docs/15 §6.2 规范与 Google 知识图谱对技术深度解析文章的要求。
 */
export function techArticleJsonLd(input: {
  headline: string;
  description: string;
  path: string;
  locale?: Locale;
  datePublished?: string;
  dateModified?: string;
  articleSection?: string[];
  aboutName?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${absoluteUrl(input.path)}#article`,
    headline: input.headline,
    description: input.description,
    url: absoluteUrl(input.path),
    inLanguage: input.locale === 'zh-CN' ? 'zh-CN' : 'en-US',
    author: {
      '@type': 'Organization',
      name: `${SITE_NAME} Intelligence Engine`,
      url: `${SITE_URL}/`,
    },
    publisher: {
      '@id': `${SITE_URL}/#organization`,
    },
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(input.articleSection ? { articleSection: input.articleSection } : {}),
    ...(input.aboutName
      ? {
          about: {
            '@type': 'Thing',
            name: input.aboutName,
          },
        }
      : {}),
  };
}

/**
 * Dataset 结构化数据（用于公开战绩页）。
 * 符合 docs/15 §6.1 规范，供 AI 模型精确索引预测样本集与命中率指标。
 */
export function datasetJsonLd(input: {
  name: string;
  description: string;
  path: string;
  temporalCoverage?: string;
  spatialCoverage?: string;
  variableMeasured?: string[];
  license?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${absoluteUrl(input.path)}#dataset`,
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    license: input.license || `${SITE_URL}/methodology`,
    creator: {
      '@id': `${SITE_URL}/#organization`,
    },
    temporalCoverage: input.temporalCoverage || '2026-09-01/..',
    spatialCoverage: input.spatialCoverage || 'US',
    variableMeasured: input.variableMeasured || [
      'Demand Formation (D-Axis)',
      'Competitor Entry Window (W-Axis)',
      'Market Formation Outcome (Hit/Miss)',
      '30-Day Cohort Hit Rate',
    ],
  };
}

/** BreadcrumbList。每个 item 都要有 position / name / item 三项，缺一项就无效。 */
export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
