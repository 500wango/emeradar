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
 * `max-snippet: -1` 表示不限制摘要长度。
 */
export const ROBOTS_INDEX = {
  index: true,
  follow: true,
  'max-image-preview': 'large',
  'max-snippet': -1,
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
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: input.title,
      description: input.description,
      locale: input.locale === 'zh-CN' ? 'zh_CN' : 'en_US',
    },
    twitter: {
      card: 'summary',
      title: input.title,
      description: input.description,
    },
  };
}

/**
 * Organization 与 WebSite。只写我们真的能背书的字段：没有法定主体名、没有 social 账号
 * 就不编一个出来 —— 结构化数据里编造实体信息正是 Google 要求避免的。
 * 说明：目前站点只有 SVG 图标，没有符合 Google 图片要求的位图 logo，因此不填 logo。
 */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
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
