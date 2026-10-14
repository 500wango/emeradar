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
    '/pricing',
    '/methodology',
    '/track-record',
    '/terms',
    '/public/opportunities/',
    '/icon.svg',
    '/logo.png',
    '/og-image.png',
    '/llms.txt',
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: allowList,
        disallow: disallowList,
      },
      {
        userAgent: ['Googlebot', 'Googlebot-Image', 'Google-Extended', 'Bingbot', 'PerplexityBot'],
        allow: allowList,
        disallow: disallowList,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
