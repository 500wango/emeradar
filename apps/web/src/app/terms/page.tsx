import Link from 'next/link';
import { getServerI18n } from '@/lib/i18n/server';

export default async function TermsPage() {
  const { t } = await getServerI18n();

  const sections = [
    ['terms.billingTitle', 'terms.billingBody'],
    ['terms.refundTitle', 'terms.refundBody'],
    ['terms.cancellationTitle', 'terms.cancellationBody'],
    ['terms.useTitle', 'terms.useBody'],
    ['terms.changesTitle', 'terms.changesBody'],
    ['terms.contactTitle', 'terms.contactBody'],
  ] as const;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
        {t('terms.badge')}
      </p>
      <h1 className="mt-2 text-3xl font-extrabold text-slate-900 tracking-tight">
        {t('terms.title')}
      </h1>
      <p className="mt-4 text-sm text-slate-600 leading-relaxed">
        {t('terms.intro')}
      </p>

      <div className="mt-10 space-y-8 text-sm text-slate-700 leading-relaxed">
        {sections.map(([title, body]) => (
          <section key={title} className="space-y-2">
            <h2 className="text-lg font-bold text-slate-900">{t(title)}</h2>
            <p>{t(body)}</p>
          </section>
        ))}
      </div>

      <p className="mt-10 text-sm">
        <Link href="/pricing" className="font-semibold text-blue-700 hover:underline">
          {t('terms.backToPricing')}
        </Link>
      </p>
    </div>
  );
}
