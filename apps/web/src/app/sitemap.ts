import type { MetadataRoute } from 'next';
import { query } from '@emeradar/db';
import { SITE_URL, STATIC_PUBLIC_PAGES, publicOpportunityPath } from '@/lib/seo/site';

export const dynamic = 'force-dynamic';

/**
 * 站点地图。
 *
 * 只放我们愿意被当成 canonical 的 URL（Google 的 sitemap 最佳实践：不是把同一份
 * 内容的每个地址都塞进来），因此这里不包含登录态页面、账号流程页和 /api。
 * 公开页清单来自 `lib/seo/site.ts`，与页面 metadata 用的是同一份常量 —— 加了新页面
 * 却忘了进站点地图这件事，由测试来兜。
 *
 * `lastmod` 只在真有发布日期的地方给（机会档案用 published_at）。静态页刻意不给：
 * 一个"每次都变"的 lastmod 是假的，Google 明确说只在它能被验证时才采信。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await query<{ slug: string; published_at: string }>(
    `SELECT slug, published_at FROM public_pages WHERE page_type = 'OPPORTUNITY' AND status = 'PUBLISHED' AND indexable = true AND locale = 'en-US' ORDER BY published_at DESC`
  );

  return [
    ...STATIC_PUBLIC_PAGES.map((page) => ({
      url: page.path === '/' ? SITE_URL : `${SITE_URL}${page.path}`,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...pages.rows.map((page) => ({
      url: `${SITE_URL}${publicOpportunityPath(page.slug)}`,
      lastModified: new Date(page.published_at),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
  ];
}
