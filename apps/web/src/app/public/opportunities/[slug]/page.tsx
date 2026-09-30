import { notFound } from 'next/navigation';
import { query } from '@emeradar/db';
import { getServerI18n } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await query<any>(`SELECT content, indexable FROM public_pages WHERE slug = $1 AND status = 'PUBLISHED'`, [slug]);
  const page = res.rows[0];
  return { title: page?.content?.title || slug, robots: page?.indexable ? 'index,follow' : 'noindex,follow' };
}

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

  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {isZh ? 'Emeradar 公开商业机会档案' : 'Emeradar public opportunity archive'}
      </p>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">{content.title || slug}</h1>
      <p className="mt-3 font-mono text-sm text-slate-600">{content.primaryQuery}</p>
      <div className="mt-8 space-y-5 text-sm leading-7 text-slate-700">
        <section>
          <h2 className="font-semibold text-slate-900">{isZh ? '为何被系统观测' : 'Why this was observed'}</h2>
          <p>{content.whyNow}</p>
        </section>
        <section>
          <h2 className="font-semibold text-slate-900">{isZh ? '产品建议方向' : 'Product direction'}</h2>
          <p>{content.topIdea}</p>
        </section>
      </div>
      <p className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500">
        {isZh ? '历史归档预测。查看实时最新机会数据需登录 Emeradar 账户。' : 'Historical projection. Current opportunity data requires an Emeradar account.'}
      </p>
    </article>
  );
}
