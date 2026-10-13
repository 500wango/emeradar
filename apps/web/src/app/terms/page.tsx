import Link from 'next/link';
import { getServerI18n } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo/site';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';

/**
 * Terms. Deliberately plain: a contract is read, not admired, so the only
 * design decisions here are the numbered legal-section markers and the
 * hairline between clauses.
 */
const SECTIONS = [
  ['terms.billingTitle', 'terms.billingBody'],
  ['terms.refundTitle', 'terms.refundBody'],
  ['terms.cancellationTitle', 'terms.cancellationBody'],
  ['terms.useTitle', 'terms.useBody'],
  ['terms.changesTitle', 'terms.changesBody'],
  ['terms.contactTitle', 'terms.contactBody'],
] as const;

export async function generateMetadata() {
  const { locale, t } = await getServerI18n();
  return pageMetadata({
    title: t('seo.terms.title'),
    description: t('seo.terms.description'),
    path: '/terms',
    locale,
  });
}

export default async function TermsPage() {
  const { t } = await getServerI18n();

  return (
    <PageFrame width="prose">
      <PageHeader eyebrow="TERMS" title={t('terms.title')} lede={t('terms.intro')} />

      <div className="mt-12 space-y-10">
        {SECTIONS.map(([title, body], index) => (
          <section key={title}>
            <h2 className="flex gap-4 font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
              <span className="text-fg-subtle">{String(index + 1).padStart(2, '0')}</span>
              {t(title)}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">{t(body)}</p>
          </section>
        ))}
      </div>

      <p className="mt-12 border-t border-line pt-8">
        <Link
          href="/pricing"
          className="font-mono text-xs text-accent transition-colors hover:brightness-110"
        >
          {t('terms.backToPricing')} →
        </Link>
      </p>
    </PageFrame>
  );
}
