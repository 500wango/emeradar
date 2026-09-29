import type { MetadataRoute } from 'next';
import { query } from '@emeradar/db';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://emeradar.com';
  const pages = await query<{ slug: string; published_at: string }>(
    `SELECT slug, published_at FROM public_pages WHERE page_type = 'OPPORTUNITY' AND status = 'PUBLISHED' AND indexable = true AND locale = 'en-US' ORDER BY published_at DESC`
  );
  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/methodology`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/track-record`, changeFrequency: 'daily', priority: 0.7 },
    ...pages.rows.map((page) => ({ url: `${base}/public/opportunities/${page.slug}`, lastModified: new Date(page.published_at), changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
