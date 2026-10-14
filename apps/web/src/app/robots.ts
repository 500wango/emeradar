import type { MetadataRoute } from 'next';
import { PRIVATE_PATH_PREFIXES, SITE_URL } from '@/lib/seo/site';

/**
 * 站点 robots.txt 生成（Next.js App Router 标准约定）。
 *
 * 遵循 Google 官方文档规范（2026-10 复核）：
 * - 明确放行所有公开且可收录的页面路径（/、/pricing、/methodology、/track-record、/terms、/public/opportunities/*）及核心静态资源。
 * - 严格阻断私有工作台（/feed、/opportunities/*、/alerts、/projects/*、/settings）、管理后台（/admin/*）、身份验证及内部 API。
 * - 针对 Googlebot、Googlebot-Image、Google-Extended、Bingbot、PerplexityBot 等声明权威规则。
 * - 声明规范的站点地图 Sitemap: https://emeradar.com/sitemap.xml。
 */
export default function robots(): MetadataRoute.Robots {
  const disallowList = [
    '/api/',
    '/opportunities/',
    ...PRIVATE_PATH_PREFIXES.map((prefix) => `${prefix}/`),
    ...PRIVATE_PATH_PREFIXES,
  ];

  const allowList = [
    '/',
    '/.well-known/llms.txt',
    '/about',
    '/contact',
    '/icon.svg',
    '/llms.txt',
    '/logo.png',
    '/methodology',
    '/og-image.png',
    '/pricing',
    '/privacy',
    '/public/opportunities/',
    '/terms',
    '/track-record',
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: allowList,
        disallow: disallowList,
      },
      {
        // 核心搜索引擎与 AI 检索代理
        userAgent: [
          'Googlebot',
          'Googlebot-Image',
          'Google-Extended',
          'Bingbot',
          'PerplexityBot',
          'OAI-SearchBot',
          'Applebot',
        ],
        allow: allowList,
        disallow: disallowList,
      },
      {
        // AI 问答交互抓取器（针对用户提问动态抓取，解决 AI Assistant Fetchers blocked 告警）
        userAgent: [
          'ChatGPT-User',
          'Claude-User',
          'Perplexity-User',
          'meta-externalfetcher',
          'MistralAI-User',
        ],
        allow: allowList,
        disallow: disallowList,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
