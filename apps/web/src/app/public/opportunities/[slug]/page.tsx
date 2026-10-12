import { notFound } from 'next/navigation';
import { query } from '@emeradar/db';
import { getServerI18n } from '@/lib/i18n/server';
import { PageFrame } from '@/components/ui/PageFrame';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await query<any>(`SELECT content, indexable FROM public_pages WHERE slug = $1 AND status = 'PUBLISHED'`, [slug]);
  const page = res.rows[0];
  return { title: page?.content?.title || slug, robots: page?.indexable ? 'index,follow' : 'noindex,follow' };
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

  return (
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
          {content.title || slug}
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
  );
}
