import Link from 'next/link';
import { getServerI18n } from '@/lib/i18n/server';

export default async function MethodologyPage() {
  const { t } = await getServerI18n();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
        {t('methodology.badge')}
      </p>
      <h1 className="mt-2 text-3xl font-extrabold text-slate-900 tracking-tight">
        {t('methodology.title')}
      </h1>
      <p className="mt-4 text-sm text-slate-600 leading-relaxed">
        {t('methodology.intro')}
      </p>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">{t('methodology.lifecycleTitle')}</h2>
        <ol className="grid gap-3 sm:grid-cols-5 list-decimal pl-5">
          <li>{t('methodology.step1')}</li>
          <li>{t('methodology.step2')}</li>
          <li>{t('methodology.step3')}</li>
          <li>{t('methodology.step4')}</li>
          <li>{t('methodology.step5')}</li>
        </ol>
      </section>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">{t('methodology.gateTitle')}</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>{t('methodology.gateItem1')}</li>
          <li>{t('methodology.gateItem2')}</li>
          <li>{t('methodology.gateItem3')}</li>
          <li>{t('methodology.gateItem4')}</li>
        </ul>
        <p>
          {t('methodology.gateFooter')}
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">{t('methodology.bandsTitle')}</h2>
        <p>
          {t('methodology.bandsIntro')}
        </p>
        <p>
          {t('methodology.closingNote')}
        </p>
        <p>
          {t('methodology.earlyBetNote')}
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">{t('methodology.claimsTitle')}</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>{t('methodology.claimItem1')}</li>
          <li>{t('methodology.claimItem2')}</li>
          <li>{t('methodology.claimItem3')}</li>
          <li>{t('methodology.claimItem4')}</li>
        </ul>
      </section>

      <p className="mt-10 text-sm">
        <Link href="/feed" className="font-semibold text-blue-700 hover:underline">
          {t('methodology.backToFeed')}
        </Link>
      </p>
    </div>
  );
}
