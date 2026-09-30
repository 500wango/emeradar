import Link from 'next/link';
import {
  ArrowRight,
  Search,
  ShieldCheck,
  Zap,
  Target,
  Sparkles,
  Flame,
  CheckCircle2,
  Lock,
  Layers,
  FileCheck2,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { getServerI18n } from '@/lib/i18n/server';
import { OpportunityService, FeedCardItem } from '@emeradar/services';

export default async function HomePage() {
  const { t, isZh } = await getServerI18n();

  // Attempt to fetch actual published BUILD_NOW decisions for the landing showcase
  let buildNowCards: FeedCardItem[] = [];
  try {
    const res = await OpportunityService.listFeedCards({
      verdict: 'BUILD_NOW' as any,
      limit: 2,
    });
    buildNowCards = res.items || [];
  } catch (err) {
    buildNowCards = [];
  }

  const pillars = [
    {
      icon: Search,
      title: t('home.pillarDemandTitle'),
      body: t('home.pillarDemandDesc'),
      tag: 'D 轴 · 需求成型',
    },
    {
      icon: ShieldCheck,
      title: t('home.pillarCommercialTitle'),
      body: t('home.pillarCommercialDesc'),
      tag: 'M 轴 · 商业验证',
    },
    {
      icon: Zap,
      title: t('home.pillarWindowTitle'),
      body: t('home.pillarWindowDesc'),
      tag: 'W 轴 · 进入窗口',
    },
  ];

  const steps = [
    {
      num: '01',
      title: t('home.step1Title'),
      desc: t('home.step1Desc'),
      highlight: isZh ? '稀缺发布（≤5%）' : 'Strictly Scarce (≤5%)',
    },
    {
      num: '02',
      title: t('home.step2Title'),
      desc: t('home.step2Desc'),
      highlight: isZh ? '≥14天趋势观测' : '≥14d History',
    },
    {
      num: '03',
      title: t('home.step3Title'),
      desc: t('home.step3Desc'),
      highlight: isZh ? '落地形态推荐' : 'Archetype Sizing',
    },
    {
      num: '04',
      title: t('home.step4Title'),
      desc: t('home.step4Desc'),
      highlight: isZh ? '独立结账流实证' : 'Observed Checkout',
    },
  ];

  const principles = [
    {
      title: t('home.principle1Title'),
      desc: t('home.principle1Desc'),
      icon: Target,
    },
    {
      title: t('home.principle2Title'),
      desc: t('home.principle2Desc'),
      icon: ShieldCheck,
    },
    {
      title: t('home.principle3Title'),
      desc: t('home.principle3Desc'),
      icon: Lock,
    },
  ];

  return (
    <div className="flex flex-col">
      {/* 1. Hero Section */}
      <section className="border-b border-slate-200 bg-white pt-16 pb-20 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Logo variant="full" className="h-16 w-auto" idPrefix="hero-main" />

          <div className="mt-8 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/80 shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
            <span>{t('home.badge')}</span>
          </div>

          <h1 className="mt-4 text-3xl sm:text-5xl font-black tracking-tight text-slate-900 leading-[1.15]">
            {t('home.heroTitle')}
          </h1>
          <p className="mt-5 text-base sm:text-lg text-slate-600 leading-relaxed max-w-3xl">
            {t('home.heroDesc')}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <Link
              href="/feed"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all"
            >
              {t('home.ctaDecisions')}
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-all"
            >
              {t('home.ctaPricing')}
            </Link>
            <Link
              href="/methodology"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-all"
            >
              {t('home.ctaMethodology')}
            </Link>
            <Link
              href="/track-record"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all"
            >
              <FileCheck2 className="w-4 h-4 text-emerald-600" />
              <span>{t('nav.trackRecord')}</span>
            </Link>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-100 flex flex-wrap items-center gap-6 text-xs text-slate-500 font-medium">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>{isZh ? '专注美国英语 (US · en-US) 搜索市场' : 'Fixed to US English (US · en-US) Search Market'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span>{isZh ? '只追加密码学账本 (Append-Only Ledger)' : 'Cryptographic Merkle Tree Append-Only Ledger'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>{isZh ? '拒绝未审计的虚构准确率' : 'Zero Unaudited Claims'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. D-M-W Three Pillars Section */}
      <section className="border-b border-slate-200 bg-slate-50/70 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
              {isZh ? '三维实证评估体系' : 'Three-Axis Empirical Evaluation'}
            </p>
            <h2 className="mt-2 text-2xl sm:text-3xl font-black text-slate-900">
              {isZh ? '拒绝黑盒分数，只依赖客观可重算事实' : 'No Black-Box Scores. Only Deterministic Evidence.'}
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {pillars.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-slate-200 bg-white p-7 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                      {item.tag}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2.5 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. 4-Step Decision Loop Section */}
      <section className="border-b border-slate-200 bg-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 mb-3">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span>Workflow & Decision Architecture</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {t('home.decisionLoopTitle')}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-500 leading-relaxed">
              {t('home.decisionLoopSubtitle')}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((st) => (
              <div
                key={st.num}
                className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between hover:bg-white hover:shadow-sm transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl font-black text-blue-600/70 font-mono">
                      {st.num}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100/70 text-blue-800">
                      {st.highlight}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{st.title}</h4>
                  <p className="mt-2 text-xs text-slate-600 leading-relaxed">{st.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Published BUILD NOW Decisions / Live Showcase Preview */}
      <section className="border-b border-slate-200 bg-slate-50/50 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <Flame className="w-3 h-3 text-emerald-600" />
                  BUILD NOW
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {isZh ? '首发每日至多 10 条高置信度裁决' : 'Up to 10 verified decisions / day'}
                </span>
              </div>
              <h2 className="text-2xl font-black text-slate-900">
                {t('home.publishedBuildNowTitle')}
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-500">
                {t('home.publishedBuildNowDesc')}
              </p>
            </div>
            <Link
              href="/feed"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline shrink-0"
            >
              <span>{t('home.openFeed')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {buildNowCards.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-6">
              {buildNowCards.map((card) => (
                <div
                  key={card.opportunityId}
                  className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs hover:border-blue-400 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                        {card.marketCountry} · {card.researchLanguage}
                      </span>
                      <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        {card.verdict}
                      </span>
                    </div>

                    <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                      {card.title}
                    </h3>
                    <p className="text-xs text-blue-600 font-mono mt-1">
                      `{card.primaryQuery}`
                    </p>

                    <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                      {card.whyNowSummary}
                    </p>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                      <span>D: <strong className="text-slate-800">{card.dBand}</strong></span>
                      <span>M: <strong className="text-slate-800">{card.mBand}</strong></span>
                      <span>W: <strong className="text-slate-800">{card.wBand}</strong></span>
                      <span>Confidence: <strong className="text-emerald-700">{card.confidence}</strong></span>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <Link
                      href={`/feed?search=${encodeURIComponent(card.primaryQuery)}`}
                      className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <span>{isZh ? '在决策动态中查看' : 'Inspect in Feed'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Illustrative PRD-Compliant Showcase Card when database has 0 published BUILD_NOW */
            <div className="bg-white rounded-3xl border-2 border-slate-200/90 p-6 sm:p-8 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-5">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-wider">
                    {t('home.sampleCardMarket')}
                  </span>
                  <span className="text-xs font-black bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full">
                    BUILD NOW
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-medium">
                  {isZh ? '观测周期：已累积 42 天连续自然搜索快照' : 'Observation History: 42 Days Consecutive Snapshots'}
                </span>
              </div>

              <div className="grid md:grid-cols-3 gap-6 items-start">
                <div className="md:col-span-2">
                  <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">
                    Invoice Generator for Freelancers
                  </h3>
                  <p className="text-xs text-blue-600 font-mono mt-1">
                    query: `freelance invoice pdf generator` · Category: Micro-SaaS
                  </p>

                  <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700 leading-relaxed">
                    <strong className="text-slate-900 font-semibold block mb-1">Why Now:</strong>
                    {t('home.sampleCardWhyNow')}
                  </div>

                  <div className="mt-3 p-4 rounded-xl bg-blue-50/60 border border-blue-100 text-xs text-blue-950 leading-relaxed">
                    <strong className="text-blue-900 font-semibold block mb-1">
                      {isZh ? '推荐构建形态 (What to Build):' : 'Recommended Archetype:'}
                    </strong>
                    {t('home.sampleCardTopIdea')}
                  </div>

                  <div className="mt-3 flex items-start gap-2 text-xs text-slate-600 font-medium">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{t('home.sampleCardEvidence')}</span>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between h-full">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                      {isZh ? '三维评估分档' : 'Tri-Axis Evaluation'}
                    </h4>
                    <div className="space-y-2.5 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-200/60">
                        <span className="text-slate-600">Demand (D):</span>
                        <span className="font-bold text-emerald-700">HIGH</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-200/60">
                        <span className="text-slate-600">Commercial (M):</span>
                        <span className="font-bold text-emerald-700">HIGH (Observed)</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-200/60">
                        <span className="text-slate-600">Window (W):</span>
                        <span className="font-bold text-blue-700">MEDIUM (SERP Weak)</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Confidence:</span>
                        <span className="font-bold text-slate-800">HIGH (3+ Sources)</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-200">
                    <Link
                      href="/feed"
                      className="block w-full py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold text-center hover:bg-blue-700 shadow-sm transition-all"
                    >
                      {isZh ? '查看实时决策流' : 'Explore Realtime Feed'}
                    </Link>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
                <span>{t('home.gatedMessage')}</span>
                <Link href="/login?next=%2Ffeed" className="font-bold text-blue-700 hover:underline shrink-0">
                  {t('home.signInToView')} →
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 5. Pricing & Entitlements Preview Banner */}
      <section className="border-b border-slate-200 bg-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-8 sm:p-12 shadow-xl relative overflow-hidden">
            <div className="max-w-2xl">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 mb-4">
                Transparent Plans & Sizing
              </span>
              <h2 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
                {t('home.pricingBannerTitle')}
              </h2>
              <p className="mt-3 text-xs sm:text-base text-slate-300 leading-relaxed">
                {t('home.pricingBannerDesc')}
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-4 text-xs font-medium text-slate-200">
                <div className="flex items-center gap-2 bg-white/10 px-4 py-2.5 rounded-xl border border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t('home.freeDelayHighlight')}</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 px-4 py-2.5 rounded-xl border border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>{t('home.proRealtimeHighlight')}</span>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/pricing"
                  className="px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-lg shadow-blue-500/25 transition-all inline-flex items-center gap-2"
                >
                  <span>{t('home.explorePricingBtn')}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/register"
                  className="px-6 py-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold border border-white/20 transition-all"
                >
                  {isZh ? '免费体验入门版' : 'Start Free'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Non-Negotiable Product Principles Section */}
      <section className="bg-slate-50 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {t('home.principlesTitle')}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-500">
              {t('home.principlesSubtitle')}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {principles.map((pr, idx) => (
              <div
                key={idx}
                className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 mb-4">
                    <pr.icon className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{pr.title}</h4>
                  <p className="mt-2 text-xs text-slate-600 leading-relaxed">{pr.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
