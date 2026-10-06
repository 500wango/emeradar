import Link from 'next/link';
import Image from 'next/image';
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
  FileText,
  XCircle,
  Clock,
  Cpu,
  TrendingUp,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { getServerI18n } from '@/lib/i18n/server';
import { OpportunityService, FeedCardItem } from '@emeradar/services';
import { LiveScanner } from '@/components/LiveScanner';

export default async function HomePage() {
  const { t, isZh } = await getServerI18n();

  // Fetch actual verified decisions for the landing showcase (strictly BUILD_NOW only)
  let showcaseCards: FeedCardItem[] = [];
  try {
    const res = await OpportunityService.listFeedCards({
      verdict: 'BUILD_NOW',
      limit: 6,
    });
    showcaseCards = res.items || [];
  } catch (err) {
    showcaseCards = [];
  }
  const buildNowCards = showcaseCards;

  const pillars = [
    {
      icon: Search,
      title: t('home.pillarDemandTitle'),
      body: t('home.pillarDemandDesc'),
      tag: isZh ? 'D 轴 · 需求成型' : 'D-Axis · Demand Formation',
      stat: isZh ? '追踪长尾词扩散' : 'Tracks expansion rate',
    },
    {
      icon: ShieldCheck,
      title: t('home.pillarCommercialTitle'),
      body: t('home.pillarCommercialDesc'),
      tag: isZh ? 'M 轴 · 商业验证' : 'M-Axis · Commercial Proof',
      stat: isZh ? '探测真实结账通道' : 'Live checkout detected',
    },
    {
      icon: Zap,
      title: t('home.pillarWindowTitle'),
      body: t('home.pillarWindowDesc'),
      tag: isZh ? 'W 轴 · 竞争窗口' : 'W-Axis · Entry Window',
      stat: isZh ? '穿透论坛与弱站' : 'Penetrates weak SERPs',
    },
  ];

  const steps = [
    {
      num: '01',
      title: t('home.step1Title'),
      desc: t('home.step1Desc'),
      highlight: isZh ? '全网长尾嗅探' : 'Wide-Area Sniffing',
    },
    {
      num: '02',
      title: t('home.step2Title'),
      desc: t('home.step2Desc'),
      highlight: isZh ? '45天冷静期追踪' : '45d Observation',
    },
    {
      num: '03',
      title: t('home.step3Title'),
      desc: t('home.step3Desc'),
      highlight: isZh ? '单周 MVP 架构' : '1-Week Archetype',
    },
    {
      num: '04',
      title: t('home.step4Title'),
      desc: t('home.step4Desc'),
      highlight: isZh ? '不可篡改审计账本' : 'Append-Only Ledger',
    },
  ];

  const comparisonRows = [
    {
      trad: t('home.comparisonRow1Trad'),
      eme: t('home.comparisonRow1Eme'),
    },
    {
      trad: t('home.comparisonRow2Trad'),
      eme: t('home.comparisonRow2Eme'),
    },
    {
      trad: t('home.comparisonRow3Trad'),
      eme: t('home.comparisonRow3Eme'),
    },
    {
      trad: t('home.comparisonRow4Trad'),
      eme: t('home.comparisonRow4Eme'),
    },
  ];

  const reportPoints = [
    {
      icon: TrendingUp,
      title: t('home.reportPoint1Title'),
      desc: t('home.reportPoint1Desc'),
    },
    {
      icon: Target,
      title: t('home.reportPoint2Title'),
      desc: t('home.reportPoint2Desc'),
    },
    {
      icon: Cpu,
      title: t('home.reportPoint3Title'),
      desc: t('home.reportPoint3Desc'),
    },
    {
      icon: Clock,
      title: t('home.reportPoint4Title'),
      desc: t('home.reportPoint4Desc'),
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
      {/* 1. Hero Section & Product Dashboard Showcase */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50/50 pt-16 pb-20 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <Logo variant="full" className="h-16 w-auto mx-auto" idPrefix="hero-main" />

            <div className="mt-7 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/80 shadow-xs">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
              <span>{t('home.badge')}</span>
            </div>

            <h1 className="mt-4 text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 leading-[1.12]">
              {t('home.heroTitle')}
            </h1>

            <p className="mt-5 text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
              {t('home.heroDesc')}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
              <Link
                href="/feed"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all hover:scale-[1.02]"
              >
                {t('home.ctaDecisions')}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3.5 text-sm font-bold text-white hover:bg-slate-800 transition-all"
              >
                {t('home.ctaPricing')}
              </Link>
              <Link
                href="/methodology"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-all bg-white"
              >
                {t('home.ctaMethodology')}
              </Link>
              <Link
                href="/track-record"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all bg-white"
              >
                <FileCheck2 className="w-4 h-4 text-emerald-600" />
                <span>{t('nav.trackRecord')}</span>
              </Link>
            </div>
          </div>

          {/* Visual Showcase: Dashboard Mockup with Floating Badges */}
          <div className="mt-14 relative max-w-5xl mx-auto">
            {/* Ambient Background Glow */}
            <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-teal-500/20 rounded-3xl blur-2xl -z-10 opacity-70"></div>

            {/* Window Frame Container */}
            <div className="relative rounded-2xl border border-slate-200/90 bg-slate-900 shadow-2xl overflow-hidden">
              {/* Window Title Bar */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-b border-slate-800 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
                    <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
                  </div>
                  <span className="ml-3 text-[11px] font-mono text-slate-400 hidden sm:inline">
                    emeradar.app/workspace/scanner · US-EN
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-medium">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    LIVE RADAR
                  </span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-400 font-mono">HASH: 0x8f2a...</span>
                </div>
              </div>

              {/* Main Product UI Image */}
              <div className="relative bg-slate-950 flex items-center justify-center">
                <Image
                  src="/images/dashboard_mockup.jpg"
                  alt="Emeradar Opportunity Radar Dashboard"
                  width={1200}
                  height={675}
                  priority
                  className="w-full h-auto object-cover object-top"
                />
              </div>

              {/* Floating Insight Badges (Overlaid on desktop, stacked below on mobile) */}
              <div className="hidden lg:block">
                {/* Top-Left Badge: BUILD NOW */}
                <div className="absolute top-16 left-6 bg-slate-900/90 backdrop-blur-md border border-emerald-500/40 px-3.5 py-2 rounded-xl shadow-xl text-xs font-semibold text-emerald-300 flex items-center gap-2 animate-bounce-subtle">
                  <Flame className="w-4 h-4 text-emerald-400" />
                  <span>{t('home.floatingBadge1')}</span>
                </div>

                {/* Top-Right Badge: SERP Weakness */}
                <div className="absolute top-16 right-6 bg-slate-900/90 backdrop-blur-md border border-blue-500/40 px-3.5 py-2 rounded-xl shadow-xl text-xs font-semibold text-blue-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>{t('home.floatingBadge2')}</span>
                </div>

                {/* Bottom-Left Badge: Stripe Proof */}
                <div className="absolute bottom-6 left-6 bg-slate-900/90 backdrop-blur-md border border-indigo-500/40 px-3.5 py-2 rounded-xl shadow-xl text-xs font-semibold text-indigo-200 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>{t('home.floatingBadge3')}</span>
                </div>

                {/* Bottom-Right Badge: Cryptographic Seal */}
                <div className="absolute bottom-6 right-6 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-3.5 py-2 rounded-xl shadow-xl text-xs font-mono text-slate-300 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-cyan-400" />
                  <span>{t('home.floatingBadge4')}</span>
                </div>
              </div>
            </div>

            {/* Caption */}
            <p className="mt-3.5 text-center text-xs text-slate-500 font-medium">
              {t('home.dashboardMockupCaption')}
            </p>
          </div>
        </div>
      </section>

      {/* 2. Key Stats Bar */}
      <section className="bg-white border-b border-slate-200 py-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <div className="text-3xl sm:text-4xl font-black text-blue-600 font-mono">
                {t('home.stat1Number')}
              </div>
              <div className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                {t('home.stat1Label')}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <div className="text-3xl sm:text-4xl font-black text-emerald-600 font-mono">
                {t('home.stat2Number')}
              </div>
              <div className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                {t('home.stat2Label')}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <div className="text-3xl sm:text-4xl font-black text-indigo-600 font-mono">
                {t('home.stat3Number')}
              </div>
              <div className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                {t('home.stat3Label')}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <div className="text-3xl sm:text-4xl font-black text-slate-900 font-mono">
                {t('home.stat4Number')}
              </div>
              <div className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                {t('home.stat4Label')}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Live Radar Showcase: Curated Proactive Decisions (No Search Needed!) */}
      <section className="py-18 bg-slate-50 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 mb-3 shadow-xs">
              <Flame className="w-3.5 h-3.5 text-emerald-600" />
              <span>{isZh ? '今日雷达精选推荐 · PROACTIVE RADAR' : 'Today\'s Curated Opportunities · PROACTIVE RADAR'}</span>
            </div>

            <h2 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
              {isZh ? '今日已验证可构建生态位' : 'Today\'s Verified Build Opportunities'}
            </h2>

            <p className="mt-3 text-xs sm:text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
              {isZh
                ? '无需构思或搜索关键词。雷达全天候自主嗅探长尾爆发与商业收银台，直接向你交付高置信度立项决策。'
                : 'No keyword search required. The radar autonomously detects emerging search clusters and live checkout signals, delivering verified build decisions directly to you.'}
            </p>
          </div>

          {showcaseCards.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {showcaseCards.map((card) => {
                const isBuildNow = card.verdict === 'BUILD_NOW';
                return (
                  <div
                    key={card.opportunityId}
                    className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs hover:border-blue-400 hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                          isBuildNow
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-blue-100 text-blue-800 border-blue-200'
                        }`}>
                          {card.verdict}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          {card.recommendedArchetype}
                        </span>
                      </div>

                      <h3 className="text-base font-extrabold text-slate-900 leading-snug line-clamp-2">
                        {card.title}
                      </h3>
                      <p className="text-xs text-blue-600 font-mono mt-1 truncate">
                        `{card.primaryQuery}`
                      </p>

                      <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700">
                        <span className="font-semibold text-slate-900 block mb-0.5">
                          💡 {isZh ? '产品概念:' : 'Concept:'}
                        </span>
                        <p className="line-clamp-2">{card.topIdea}</p>
                      </div>

                      <p className="text-xs text-slate-600 mt-3 leading-relaxed line-clamp-2">
                        <strong className="text-slate-800">{isZh ? '切入原因: ' : 'Why Now: '}</strong>
                        {card.whyNowSummary}
                      </p>

                      {/* 3-Axis Scores Gauge */}
                      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-[10px]">
                        <div className="p-1.5 rounded-lg bg-blue-50/60 border border-blue-100">
                          <span className="text-slate-400 block font-medium">DEMAND</span>
                          <strong className="text-blue-700 font-mono font-bold">{(card.dBasisPoints / 100).toFixed(0)}/100</strong>
                        </div>
                        <div className="p-1.5 rounded-lg bg-emerald-50/60 border border-emerald-100">
                          <span className="text-slate-400 block font-medium">MONEY</span>
                          <strong className="text-emerald-700 font-mono font-bold">{(card.mBasisPoints / 100).toFixed(0)}/100</strong>
                        </div>
                        <div className="p-1.5 rounded-lg bg-amber-50/60 border border-amber-100">
                          <span className="text-slate-400 block font-medium">WINDOW</span>
                          <strong className="text-amber-700 font-mono font-bold">{(card.wBasisPoints / 100).toFixed(0)}/100</strong>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Link
                        href={`/opportunities/${card.slug}/report`}
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        <span>{isZh ? '研报 & ROI' : 'Report & ROI'}</span>
                      </Link>

                      <Link
                        href={`/opportunities/${card.slug}`}
                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        <span>{isZh ? '决策工作台' : 'Workspace'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border border-slate-200">
              <p className="text-slate-500 text-sm">
                {isZh ? '雷达正在生成最新周期决策...' : 'Radar is synthesizing latest cycle decisions...'}
              </p>
            </div>
          )}

          {/* Section Footer: Link to Feed + Optional Custom Query Expander */}
          <div className="mt-12 text-center space-y-4">
            <Link
              href="/feed"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all hover:scale-[1.02]"
            >
              <span>{isZh ? '进入实时雷达机会发现流 (查看全部)' : 'Enter Live Opportunity Radar Feed'}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            {/* Optional Collapsible for manual scanner */}
            <details className="mt-6 group border border-slate-200 rounded-2xl bg-white p-4 max-w-xl mx-auto text-left shadow-xs">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-blue-600" />
                  <span>{isZh ? '有特定的细分长尾词想让雷达定向扫描？展开即时探测器' : 'Have a custom query to observe? Open live query scanner'}</span>
                </span>
                <span className="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-4 pt-4 border-t border-slate-100">
                <LiveScanner showQuickChips={true} />
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* 4. D-M-W Three Pillars Section with 3D Holographic Radar Matrix */}
      <section className="border-b border-slate-200 bg-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
              {isZh ? '三维实证评估体系' : 'Three-Axis Empirical Evaluation'}
            </p>
            <h2 className="mt-2 text-2xl sm:text-3xl font-black text-slate-900">
              {isZh ? '拒绝黑盒分数，只依赖客观可重算事实' : 'No Black-Box Scores. Only Deterministic Evidence.'}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-500">
              {isZh ? 'Demand · Commercial · Window 三轴交叉检验，任一轴不成立即行放弃' : 'Cross-validated across Demand, Commercial, and Window axes. If any fails, we PASS.'}
            </p>
          </div>

          <div className="grid lg:grid-cols-12 gap-10 items-center">
            {/* Visual: Holographic 3D Matrix Image */}
            <div className="lg:col-span-6 relative">
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-xl bg-slate-950 group">
                <Image
                  src="/images/radar_matrix.jpg"
                  alt="Emeradar 3D D-M-W Radar Matrix"
                  width={800}
                  height={500}
                  className="w-full h-auto object-cover group-hover:scale-105 transition-all duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-5">
                  <div className="text-white text-xs font-medium">
                    <span className="text-emerald-400 font-bold block mb-1">D-M-W 交叉立方矩阵</span>
                    <span>只有三轴同时穿透基准阈值，系统方可签署 BUILD NOW 密码学判决</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3 Pillar Feature Cards */}
            <div className="lg:col-span-6 space-y-4">
              {pillars.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 hover:bg-white hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-blue-100/70 text-blue-700 shrink-0">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
                          {item.tag}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {item.body}
                      </p>
                      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{item.stat}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5. Deep-Dive Research Report Showcase */}
      <section className="border-b border-slate-200 bg-slate-50/70 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            {/* Left Column: Report Feature Highlights */}
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 mb-3">
                <FileCheck2 className="w-3.5 h-3.5 text-indigo-600" />
                <span>{t('home.reportSectionBadge')}</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                {t('home.reportSectionTitle')}
              </h2>

              <p className="mt-3 text-xs sm:text-sm text-slate-600 leading-relaxed mb-8">
                {t('home.reportSectionDesc')}
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                {reportPoints.map((pt, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 mb-2.5">
                      <pt.icon className="w-4 h-4" />
                    </div>
                    <h4 className="text-xs font-bold text-slate-900 mb-1">{pt.title}</h4>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{pt.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex items-center gap-3">
                <Link
                  href="/feed"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  <span>{isZh ? '查看最新决策报告示例' : 'View Sample Research Report in Feed'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Right Column: High-Res Research Report Screenshot */}
            <div className="lg:col-span-6">
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-2xl bg-white group">
                <Image
                  src="/images/report_preview.jpg"
                  alt="Emeradar Deep-Dive Research Report Preview"
                  width={800}
                  height={550}
                  className="w-full h-auto object-cover group-hover:scale-[1.02] transition-all duration-300"
                />
                <div className="p-4 bg-slate-900 text-white flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold">{isZh ? '研报结构预览 · 包含落地架构与止损准则' : 'Full Blueprint · MVP Archetype & Kill Criteria'}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">PDF / Web View</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Comparison Section: Traditional SEO Tools vs Emeradar */}
      <section className="border-b border-slate-200 bg-white py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 mb-3">
              <Target className="w-3.5 h-3.5 text-amber-600" />
              <span>{t('home.comparisonBadge')}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {t('home.comparisonTitle')}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-500 leading-relaxed">
              {t('home.comparisonSubtitle')}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider">
              <div className="p-4 md:p-5 text-slate-500 border-b md:border-b-0 md:border-r border-slate-200 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-rose-500" />
                <span>{t('home.comparisonColTrad')}</span>
              </div>
              <div className="p-4 md:p-5 text-blue-700 bg-blue-50/50 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{t('home.comparisonColEme')}</span>
              </div>
            </div>

            <div className="divide-y divide-slate-100 bg-white">
              {comparisonRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-2 text-xs sm:text-sm">
                  <div className="p-4 sm:p-5 text-slate-500 border-b md:border-b-0 md:border-r border-slate-100 flex items-start gap-3 bg-slate-50/20">
                    <span className="text-rose-400 font-bold shrink-0 mt-0.5">✕</span>
                    <span className="leading-relaxed">{row.trad}</span>
                  </div>
                  <div className="p-4 sm:p-5 text-slate-900 font-medium flex items-start gap-3 bg-blue-50/10">
                    <span className="text-emerald-500 font-bold shrink-0 mt-0.5">✓</span>
                    <span className="leading-relaxed">{row.eme}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 7. 4-Step Decision Loop Section */}
      <section className="border-b border-slate-200 bg-slate-50/50 py-18">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 mb-3">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isZh ? '工作流与决策架构' : 'Workflow & Decision Architecture'}</span>
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
                className="p-6 rounded-2xl bg-white border border-slate-200/90 flex flex-col justify-between hover:shadow-md transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl font-black text-blue-600/80 font-mono">
                      {st.num}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/60">
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

      {/* 8. Published BUILD NOW Decisions / Live Showcase Preview */}
      <section className="border-b border-slate-200 bg-white py-18">
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
                      href={`/opportunities/${card.slug}/report`}
                      className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{isZh ? '查看研报与 ROI 测算' : 'Report & ROI Model'}</span>
                    </Link>
                    <Link
                      href={`/opportunities/${card.slug}`}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                    >
                      <span>{isZh ? '工作台' : 'Workspace'}</span>
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
                  {isZh ? '示例：持续观察后的分析格式' : 'Illustrative format after sustained observation'}
                </span>
              </div>

              <div className="grid md:grid-cols-3 gap-6 items-start">
                <div className="md:col-span-2">
                  <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">
                    {isZh ? '自由职业者发票生成器' : 'Invoice Generator for Freelancers'}
                  </h3>
                  <p className="text-xs text-blue-600 font-mono mt-1">
                    {isZh ? '查询词：`freelance invoice pdf generator` · 类别：微型 SaaS' : 'query: `freelance invoice pdf generator` · Category: Micro-SaaS'}
                  </p>

                  <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700 leading-relaxed">
                    <strong className="text-slate-900 font-semibold block mb-1">{isZh ? '为什么是现在：' : 'Why Now:'}</strong>
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
                      {isZh ? '示例评估方式' : 'Illustrative evaluation'}
                    </h4>
                    <div className="space-y-2.5 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-200/60">
                        <span className="text-slate-600">{isZh ? '需求 (D):' : 'Demand (D):'}</span>
                        <span className="font-bold text-emerald-700">{isZh ? '持续信号' : 'Sustained signal'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-200/60">
                        <span className="text-slate-600">{isZh ? '商业验证 (M):' : 'Commercial (M):'}</span>
                        <span className="font-bold text-emerald-700">{isZh ? '有付费供给' : 'Paid supply exists'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-200/60">
                        <span className="text-slate-600">{isZh ? '竞争窗口 (W):' : 'Window (W):'}</span>
                        <span className="font-bold text-blue-700">{isZh ? '仍有切入空间' : 'Room to enter'}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">{isZh ? '置信度:' : 'Confidence:'}</span>
                        <span className="font-bold text-slate-800">{isZh ? '多项信号' : 'Multiple signals'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-200">
                    <Link
                      href="/feed"
                      className="block w-full py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold text-center hover:bg-blue-700 shadow-sm transition-all"
                    >
                      {isZh ? '探索决策流' : 'Explore the decision feed'}
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

      {/* 9. Pricing & Entitlements Preview Banner */}
      <section className="border-b border-slate-200 bg-slate-50/50 py-18">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-8 sm:p-12 shadow-xl relative overflow-hidden">
            <div className="max-w-2xl">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 mb-4">
                <span>{isZh ? '透明增长方案' : 'Transparent Plans & Sizing'}</span>
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

      {/* 10. Non-Negotiable Product Principles Section */}
      <section className="bg-white py-18">
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
                className="p-6 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 mb-4">
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
