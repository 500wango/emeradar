import { notFound } from 'next/navigation';
import { query } from '@emeradar/db';
import { getServerI18n } from '@/lib/i18n/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { PageFrame } from '@/components/ui/PageFrame';
import { ROBOTS_INDEX, ROBOTS_NOINDEX, absoluteUrl, breadcrumbJsonLd, publicOpportunityPath } from '@/lib/seo/site';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await query<any>(
    `SELECT content, indexable, locale FROM public_pages WHERE slug = $1 AND status = 'PUBLISHED'`,
    [slug]
  );
  const page = res.rows[0];
  const content = page?.content || {};
  const title = content.title || slug;
  // 描述取页面自己的证据叙述（whyNow），而不是一句放之四海皆准的模板文案：
  // 摘要应当代表这一页的内容，否则等于把摘要交给搜索引擎去猜。
  const description =
    typeof content.whyNow === 'string' && content.whyNow.trim().length > 0
      ? content.whyNow.trim().slice(0, 155)
      : `${title} — archived Emeradar opportunity record with its observation date and source limits.`;
  const path = publicOpportunityPath(slug);
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    // 未通过发布门槛（indexable=false）的档案页留在站点里供人查阅，但不进索引。
    robots: page?.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX,
    openGraph: {
      type: 'article',
      url: absoluteUrl(path),
      title,
      description,
      locale: page?.locale === 'zh-CN' ? 'zh_CN' : 'en_US',
    },
    twitter: { card: 'summary', title, description },
  };
}

/**
 * Archived public record — an indexable page for a historical opportunity,
 * separate from the authenticated workspace. It carries the same "historical
 * projection" disclaimer the publication spec requires, and links onward to the
 * live product rather than trying to be it.
 */
export default async function PublicOpportunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await query<any>(
    `SELECT slug, locale, status, indexable, content, eligibility, quality_report, published_at
     FROM public_pages WHERE slug = $1 AND status = 'PUBLISHED'`,
    [slug]
  );
  const page = res.rows[0];
  if (!page) notFound();
  const content = page.content || {};
  const { isZh } = await getServerI18n();

  const publishedAt = page.published_at ? String(page.published_at).slice(0, 10) : null;
  const title = content.title || slug;

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: isZh ? '首页' : 'Home', path: '/' },
          { name: title, path: publicOpportunityPath(slug) },
        ])}
      />
      <PageFrame width="prose">
        <header className="border-b border-line pb-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-subtle">
            <span className="text-accent">
              {isZh ? '公开机会档案' : 'Public opportunity archive'}
            </span>
            {publishedAt && <span>PUBLISHED {publishedAt}</span>}
            <span>US · EN-US</span>
          </div>
          <h1 className="mt-5 font-display text-3xl font-extrabold leading-tight tracking-tight text-fg sm:text-4xl sm:leading-tight">
            {title}
          </h1>
          {content.primaryQuery && (
            <p className="mt-4 font-mono text-sm text-fg-muted">{`\`${content.primaryQuery}\``}</p>
          )}
        </header>

        <div className="mt-10 space-y-10">
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
              <span className="text-accent">01</span> · {isZh ? '为何被系统观测' : 'Why this was observed'}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">{content.whyNow}</p>
          </section>
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
              <span className="text-accent">02</span> · {isZh ? '产品建议方向' : 'Product direction'}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">{content.topIdea}</p>
          </section>
        </div>

        <p className="mt-12 border-t border-line pt-5 font-mono text-[11px] leading-relaxed text-fg-subtle">
          {isZh
            ? '历史归档预测。查看实时最新机会数据需登录 Emeradar 账户。'
            : 'Historical projection. Current opportunity data requires an Emeradar account.'}
        </p>
      </PageFrame>
    </>
  );
}
