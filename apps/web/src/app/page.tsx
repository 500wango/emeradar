import Link from 'next/link';
import { ArrowRight, Search, ShieldCheck, Zap } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { getServerI18n } from '@/lib/i18n/server';

export default async function HomePage() {
  const { t } = await getServerI18n();

  const pillars = [
    {
      icon: Search,
      title: t('home.pillarDemandTitle'),
      body: t('home.pillarDemandDesc'),
    },
    {
      icon: ShieldCheck,
      title: t('home.pillarCommercialTitle'),
      body: t('home.pillarCommercialDesc'),
    },
    {
      icon: Zap,
      title: t('home.pillarWindowTitle'),
      body: t('home.pillarWindowDesc'),
    },
  ];

  return (
    <div className="flex flex-col">
      <section className="border-b border-slate-200 bg-white pt-16 pb-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Logo variant="full" className="h-16 w-auto" idPrefix="hero-main" />
          <p className="mt-8 text-xs font-bold uppercase tracking-widest text-blue-700">
            {t('home.badge')}
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.15]">
            {t('home.heroTitle')}
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            {t('home.heroDesc')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/feed"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {t('home.ctaDecisions')}
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/methodology"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              {t('home.ctaMethodology')}
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              {t('home.ctaPricing')}
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-3 gap-6">
          {pillars.map((item) => (
            <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <item.icon className="w-5 h-5 text-blue-700" />
              <h2 className="mt-4 text-base font-bold text-slate-900">{item.title}</h2>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">{t('home.publishedBuildNowTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {t('home.publishedBuildNowDesc')}
              </p>
            </div>
            <Link href="/feed" className="text-sm font-semibold text-blue-700 hover:underline">
              {t('home.openFeed')}
            </Link>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
            {t('home.gatedMessage')}{' '}
            <Link href="/login?next=%2Ffeed" className="font-semibold text-blue-700 hover:underline">
              {t('home.signInToView')}
            </Link>
            .
          </div>
        </div>
      </section>
    </div>
  );
}
