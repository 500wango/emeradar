'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Copy,
  Download,
  Printer,
  Check,
  FolderPlus,
  ChevronLeft,
  FileCode,
  Layout,
  Compass,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  OpportunityReportData,
  formatVerdict,
  formatArchetype,
  formatExecutionClass,
  formatPenetrationAngle,
  formatSearchIntent,
  formatSiteStrategy,
  formatResultType,
  formatVolumeTier,
  formatPricingModel,
  formatBarrierToEntry,
  formatIndieEntrantDensity,
  formatShadowChannel,
  formatPresence,
} from '@emeradar/report';
import { useI18n } from '@/lib/i18n';
import { GoalSimulator } from './GoalSimulator';

interface ReportStudioClientProps {
  reportId: string;
  data: OpportunityReportData;
  markdown: string;
  opportunitySlug: string;
}

export function ReportStudioClient({
  reportId,
  data,
  markdown,
  opportunitySlug,
}: ReportStudioClientProps) {
  const [activeView, setActiveView] = useState<'preview' | 'markdown'>('preview');
  const [copied, setCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showGlossary, setShowGlossary] = useState(false);
  const { t, isZh } = useI18n();

  const { metadata, section1, section2, section3, section4, section5, section6 } = data;
  const dPct = (metadata.scores.dBasisPoints / 100).toFixed(1);
  const mPct = (metadata.scores.mBasisPoints / 100).toFixed(1);
  const wPct = (metadata.scores.wBasisPoints / 100).toFixed(1);

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      console.error('Failed to copy to clipboard');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200">
        <div>
          <Link
            href={`/opportunities/${opportunitySlug}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-2 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t('report.backToWorkspace')}</span>
          </Link>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {t('report.title')}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Report ID: <code className="font-mono text-slate-700">{reportId}</code> &bull;{' '}
            {isZh ? '快照锁定确定性分析' : 'Snapshot-frozen deterministic analysis'}
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center p-1 bg-slate-100 rounded-lg text-xs mr-2">
            <button
              onClick={() => setActiveView('preview')}
              className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-colors ${
                activeView === 'preview'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layout className="w-3.5 h-3.5" />
              <span>{t('report.tabPreview')}</span>
            </button>
            <button
              onClick={() => setActiveView('markdown')}
              className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-colors ${
                activeView === 'markdown'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{t('report.tabMarkdown')}</span>
            </button>
          </div>

          <button
            onClick={handleCopyMarkdown}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors shadow-sm"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">{t('report.copiedMarkdown')}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{t('report.copyMarkdown')}</span>
              </>
            )}
          </button>

          <a
            href={`/api/v1/reports/${reportId}/export?format=markdown`}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>.md</span>
          </a>

          <a
            href={`/api/v1/reports/${reportId}/export?format=json`}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>.json</span>
          </a>

          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white transition-colors shadow-sm"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t('report.printReport')}</span>
          </button>
        </div>
      </div>

      {activeView === 'markdown' ? (
        /* Raw Markdown View */
        <div className="bg-slate-900 rounded-2xl p-6 text-slate-200 font-mono text-xs overflow-x-auto shadow-inner">
          <pre className="whitespace-pre-wrap leading-relaxed">{markdown}</pre>
        </div>
      ) : (
        /* Formatted Studio View */
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-10">
          {/* Header Banner */}
          <div className="border-b border-slate-100 pb-6">
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {isZh ? formatVerdict(metadata.verdict, 'zh-CN', true) : metadata.verdict}
              </span>
              <span className="text-xs text-slate-400">Emeradar Research Report &bull; sc-1.0.0</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">{metadata.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span>{isZh ? '观测日期: ' : 'Obs Date: '}<strong>{metadata.obsDate}</strong></span>
              <span>{isZh ? '推荐形态: ' : 'Archetype: '}<strong>{isZh ? formatArchetype(metadata.recommendedArchetype, 'zh-CN') : metadata.recommendedArchetype}</strong></span>
              <span>{isZh ? '执行等级: ' : 'Class: '}<strong>{isZh ? formatExecutionClass(metadata.executionClass, 'zh-CN') : `${metadata.executionClass} (<14 Days)`}</strong></span>
            </div>
          </div>

          {/* 30-Second Quick Decision Guide */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-purple-50/90 border border-blue-100 shadow-xs">
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setShowGuide(!showGuide)}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {isZh ? '新手速读指南：如何 30 秒看懂这份决策报告？' : 'Quick Decision Guide: Interpret this report in 30 seconds'}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {isZh
                      ? '不看复杂公式，普通用户只需关注「做不做、做什么形态、怎么执行」3个核心决策动作'
                      : 'Skip raw algorithmic formulas and focus on the 3 core decision signals'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 shrink-0 ml-2"
              >
                <span>{showGuide ? (isZh ? '收起指南' : 'Collapse') : (isZh ? '展开指南' : 'Expand')}</span>
                {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {showGuide && (
              <div className="mt-4 pt-4 border-t border-blue-100/80 text-xs text-slate-700 space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="p-3.5 bg-white/95 rounded-xl border border-blue-100/80 shadow-2xs">
                    <div className="font-bold text-blue-900 flex items-center gap-1.5 mb-1.5">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 inline-flex items-center justify-center text-[11px] font-black shrink-0">1</span>
                      <span>{isZh ? '第一步：看结论定做不做' : 'Step 1: Check Verdict'}</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[11px]">
                      {isZh
                        ? '看顶部绿色徽章「立即立项 (BUILD NOW)」直接开干（需求大、已有人买单、对手弱）；蓝色「早期下注」适合极简单页抢占先机；灰色「持续观察」建议暂缓动手。'
                        : 'BUILD NOW indicates high search demand and low competition. EARLY BET suggests emerging window. WATCH means hold.'}
                    </p>
                  </div>

                  <div className="p-3.5 bg-white/95 rounded-xl border border-indigo-100/80 shadow-2xs">
                    <div className="font-bold text-indigo-900 flex items-center gap-1.5 mb-1.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 inline-flex items-center justify-center text-[11px] font-black shrink-0">2</span>
                      <span>{isZh ? '第二步：看形态与切入策略' : 'Step 2: Product & Angle'}</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[11px]">
                      {isZh
                        ? '看「推荐形态」（如免登录单页工具）与「老兵切入策略」（如用独立域名单点正面穿透大站内页），这就是阻力最小的产品原型定义。'
                        : 'Review Recommended Archetype (e.g. lightweight tool) and Penetration Strategy to pinpoint the path of least resistance.'}
                    </p>
                  </div>

                  <div className="p-3.5 bg-white/95 rounded-xl border border-purple-100/80 shadow-2xs">
                    <div className="font-bold text-purple-900 flex items-center gap-1.5 mb-1.5">
                      <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 inline-flex items-center justify-center text-[11px] font-black shrink-0">3</span>
                      <span>{isZh ? '第三步：照着 14 天表开工' : 'Step 3: 14-Day Sprint'}</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[11px]">
                      {isZh
                        ? '拉到第 5 节「14天冲刺执行蓝图」，照着阶段一原型、阶段二SEO包装、阶段三Google收录的清单按天执行；如果触碰第6节红线坚决止损。'
                        : 'Execute Section 5 sprint plan from Day 1 to 14. Abort immediately if any Section 6 Kill Criteria trigger.'}
                    </p>
                  </div>
                </div>

                {/* Glossary Toggle */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowGlossary(!showGlossary);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 transition-colors"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>{isZh ? (showGlossary ? '收起通俗名词速查字典' : '看不懂专业词？点击展开「通俗名词速查小字典」') : (showGlossary ? 'Hide Glossary' : 'Need terminology help? Click to view glossary')}</span>
                  </button>

                  {showGlossary && (
                    <div className="mt-2.5 p-3.5 bg-white/95 rounded-xl border border-blue-200/80 grid sm:grid-cols-2 gap-3 text-[11px] text-slate-600 animate-in fade-in duration-200">
                      <div>
                        <strong className="text-slate-900 font-bold">D-M-W 胜率三轴：</strong>
                        <span>D (需求分) = 有没人搜；M (变现分) = 能不能收钱；W (窗口分) = 对手弱不弱、新站好不好上位。</span>
                      </div>
                      <div>
                        <strong className="text-slate-900 font-bold">SERP (搜索结果页)：</strong>
                        <span>指 Google 搜索某个词时排在第 1 页前 10 位的网页盘面。前十若多为无意内页或论坛帖，新站极易超越。</span>
                      </div>
                      <div>
                        <strong className="text-slate-900 font-bold">基点 (bps)：</strong>
                        <span>算法分值单位，100 基点 = 1 分。例如 8400 基点即 84 分（满分 100 分）。</span>
                      </div>
                      <div>
                        <strong className="text-slate-900 font-bold">叫停红线 (Kill Criteria)：</strong>
                        <span>事前约定的止损红线。一旦发现大厂官方直接下场或上线一个月零曝光，必须果断放弃止损，避免沉没成本。</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Three-Axis Score Dashboard */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-xl text-center">
              <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">
                {isZh ? '搜索需求评分 (D)' : 'Demand Score (D)'}
              </div>
              <div className="text-2xl font-black text-blue-900 mt-1">
                {dPct} <span className="text-xs font-normal text-blue-600">/ 100</span>
              </div>
              <div className="text-[10px] text-blue-700/80 mt-1 font-medium">
                {isZh ? '🔥 搜索人数与增速' : 'Search volume & growth'}
              </div>
            </div>

            <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-xl text-center">
              <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                {isZh ? '商业变现验证 (M)' : 'Commercial (M)'}
              </div>
              <div className="text-2xl font-black text-emerald-900 mt-1">
                {mPct} <span className="text-xs font-normal text-emerald-600">/ 100</span>
              </div>
              <div className="text-[10px] text-emerald-700/80 mt-1 font-medium">
                {isZh ? '💰 已证实付费竞品' : 'Verified paid competitors'}
              </div>
            </div>

            <div className="p-4 bg-amber-50/60 border border-amber-100 rounded-xl text-center">
              <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
                {isZh ? '竞争进入窗口 (W)' : 'Window (W)'}
              </div>
              <div className="text-2xl font-black text-amber-900 mt-1">
                {wPct} <span className="text-xs font-normal text-amber-600">/ 100</span>
              </div>
              <div className="text-[10px] text-amber-700/80 mt-1 font-medium">
                {isZh ? '🚪 对手薄弱，易上位' : 'Low incumbent resistance'}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center">
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                {isZh ? '数据置信度' : 'Confidence'}
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {metadata.scores.confidence === 'HIGH' && isZh ? '高置信度' : metadata.scores.confidence}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-medium">
                {isZh ? '📊 多维度交叉验真' : 'Cross-validated signals'}
              </div>
            </div>
          </div>

          {/* §1 Executive Summary */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {isZh ? '1. 执行摘要与雷达裁决' : '1. Executive Summary & Radar Verdict'}
            </h3>
            <p className="text-sm text-slate-700 leading-relaxed mb-4">
              {section1.thesis}
            </p>
            {section1.veteranVerdict && (
              <div className="p-4 rounded-xl bg-purple-50/80 border border-purple-200 text-xs text-purple-950 mb-4">
                <div className="flex items-center gap-2 font-bold text-purple-900 mb-1.5">
                  <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono tracking-wider bg-purple-200/80 text-purple-800 border border-purple-300">
                    {isZh ? formatPenetrationAngle(section1.veteranVerdict.penetrationAngle, 'zh-CN') : section1.veteranVerdict.penetrationAngle}
                  </span>
                  <span>{isZh ? '老兵切入判决' : 'Veteran Penetration Angle'}</span>
                </div>
                <div className="font-semibold text-purple-900 mb-2">
                  {section1.veteranVerdict.headline}
                </div>
                <div className="space-y-1 text-purple-800">
                  {section1.veteranVerdict.structuralReasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-purple-500 font-bold">🎯</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 mb-4">
              <strong>{isZh ? '为何现在切入?' : 'Why Now?'}</strong> {section1.whyNow}
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-xs text-emerald-900 mb-4">
              <strong>💡 {isZh ? '核心产品概念:' : 'Top Product Concept:'}</strong> {section1.topIdea}
            </div>
            {section1.keyRisks && section1.keyRisks.length > 0 && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 mb-4">
                <strong className="block mb-1.5 text-slate-900">{isZh ? '关键风险与假设:' : 'Key Risks & Assumptions:'}</strong>
                <ul className="space-y-1 list-disc list-inside text-slate-600">
                  {section1.keyRisks.map((risk, i) => (
                    <li key={i}>{risk}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-900">
              <strong>{isZh ? '推荐决策:' : 'Recommendation:'}</strong> {section1.decisionRecommendation}
            </div>
          </div>

          {/* §2 Demand Breakdown */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {isZh ? '2. 搜索需求与查询词聚合分析' : '2. Search Demand & Query Clustering'}
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              {isZh ? '种子查询词: ' : 'Seed Query: '}<code className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-800">{section2.primaryQuery}</code> ({isZh ? '动量速度' : 'Velocity'}: {section2.queryVelocity}x)
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mb-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{isZh ? '搜索意图' : 'Intent'}</span>
                <strong className="block text-slate-900 mt-1">{isZh ? formatSearchIntent(section2.searchIntent, 'zh-CN') : section2.searchIntent}</strong>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{isZh ? '产品形态' : 'Product shape'}</span>
                <strong className="block text-slate-900 mt-1">{section2.recommendedProductShape}</strong>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{isZh ? '站点策略' : 'Site strategy'}</span>
                <strong className="block text-slate-900 mt-1">{isZh ? formatSiteStrategy(section2.siteStrategy, 'zh-CN') : section2.siteStrategy}</strong>
              </div>
            </div>
            <p className="text-xs text-slate-700 mb-4"><strong>{isZh ? '用户核心任务 (Core job):' : 'Core job:'}</strong> {section2.jobToBeDone}</p>

            <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">{isZh ? '查询词' : 'Query'}</th>
                  <th className="p-3">{isZh ? '搜索意图' : 'Search Intent'}</th>
                  <th className="p-3">{isZh ? '搜索量等级' : 'Volume Tier'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {section2.clusterQueries.map((q, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-medium text-slate-800">{q.query}</td>
                    <td className="p-3 text-slate-600">{isZh ? formatSearchIntent(q.intent, 'zh-CN') : q.intent}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                        {isZh ? formatVolumeTier(q.volumeTier, 'zh-CN') : q.volumeTier}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* §3 SERP Weakness */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {isZh ? '3. 竞争格局与 SERP 薄弱点分析' : '3. Competitive Landscape & SERP Weakness'}
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              {isZh ? 'SERP 薄弱度得分: ' : 'SERP Weakness Score: '}<strong>{section3.serpWeaknessScore.toFixed(1)} / 100</strong> ({Math.round(section3.weakResultsRatio * 100)}% {isZh ? '可渗透结果比例' : 'addressable results'})
            </p>

            <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-2.5">#</th>
                  <th className="p-2.5">{isZh ? '域名' : 'Domain'}</th>
                  <th className="p-2.5">{isZh ? '搜索标题' : 'Result Title'}</th>
                  <th className="p-2.5">{isZh ? '类型' : 'Type'}</th>
                  <th className="p-2.5">{isZh ? '状态' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {section3.top10Results.map((r) => (
                  <tr key={r.rank} className="hover:bg-slate-50">
                    <td className="p-2.5 font-bold text-slate-400">{r.rank}</td>
                    <td className="p-2.5 font-semibold text-slate-800">{r.domain}</td>
                    <td className="p-2.5 text-slate-600 truncate max-w-xs">{r.title}</td>
                    <td className="p-2.5">
                      <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                        {isZh ? formatResultType(r.resultType, 'zh-CN') : r.resultType}
                      </code>
                    </td>
                    <td className="p-2.5">
                      {r.isWeak ? (
                        <span className="text-rose-700 font-semibold">🔴 {isZh ? '薄弱' : 'WEAK'}</span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">🟢 {isZh ? '强劲' : 'STRONG'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {section3.indieCompetitionAudit && (
              <div className="mt-5 p-4 rounded-xl bg-amber-50/70 border border-amber-200 text-xs">
                <div className="flex items-center gap-2 mb-2 font-bold text-amber-900 text-sm">
                  <span>🕵️</span>
                  <span>{isZh ? '中小开发者水下生态与技术壁垒审计' : 'Indie Competition & Defense Moat Audit'}</span>
                  <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-amber-200/80 text-amber-900 border border-amber-300">
                    {isZh ? '防跟风复制预警' : 'Copycat Defense'}
                  </span>
                </div>

                <p className="text-amber-800 mb-3 leading-relaxed">
                  <strong>{isZh ? '巨头盲区警示：' : 'Strategic Notice: '}</strong>
                  {isZh
                    ? '大厂（如 Adobe、Google）看不上此类极度垂直的长尾场景，仅靠权重内页占位；真正蚕食利润的是敏捷的中小独立开发者。'
                    : 'Tech giants overlook micro-niches, leaving weak inner pages; real commercial competition comes from agile indie builders and Chrome extensions.'}
                </p>

                <div className="grid sm:grid-cols-2 gap-3 mb-3">
                  <div className="p-3 bg-white/90 border border-amber-200 rounded-lg">
                    <span className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">
                      {isZh ? '技术实现壁垒 (Barrier to Entry)' : 'Technical Barrier to Entry'}
                    </span>
                    <strong className="block text-slate-900 text-xs mt-1">
                      {formatBarrierToEntry(section3.indieCompetitionAudit.barrierToEntry, isZh ? 'zh-CN' : 'en-US')}
                    </strong>
                    <p className="text-[11px] text-slate-600 mt-1 leading-normal">
                      {section3.indieCompetitionAudit.barrierReason}
                    </p>
                  </div>

                  <div className="p-3 bg-white/90 border border-amber-200 rounded-lg">
                    <span className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">
                      {isZh ? '中小开发者涌入密度' : 'Indie Entrant Density'}
                    </span>
                    <strong className="block text-slate-900 text-xs mt-1">
                      {formatIndieEntrantDensity(section3.indieCompetitionAudit.indieEntrantDensity, isZh ? 'zh-CN' : 'en-US')}
                    </strong>
                    {section3.indieCompetitionAudit.densityWarning ? (
                      <p className="text-[11px] text-amber-900 font-medium mt-1 leading-normal">
                        ⚠️ {section3.indieCompetitionAudit.densityWarning}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-600 mt-1 leading-normal">
                        {isZh ? '当前赛道涌入密度在可控范围。' : 'Current influx density remains manageable.'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-[11px] font-bold text-amber-900 mb-1.5">
                    {isZh ? '水下竞争渠道渗透观测 (Shadow Channels)' : 'Shadow Channels Penetration Audit'}
                  </div>
                  <div className="border border-amber-200 rounded-lg overflow-hidden bg-white/90">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-amber-100/60 text-amber-900 border-b border-amber-200 text-[11px]">
                        <tr>
                          <th className="p-2 font-semibold">{isZh ? '竞争渠道' : 'Shadow Channel'}</th>
                          <th className="p-2 font-semibold text-center">{isZh ? '渗透状态' : 'Presence'}</th>
                          <th className="p-2 font-semibold">{isZh ? '生态观测' : 'Ecological Observation'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100 text-[11px]">
                        {section3.indieCompetitionAudit.shadowChannels.map((c, i) => (
                          <tr key={i} className="hover:bg-amber-50/50">
                            <td className="p-2 font-semibold text-slate-800">
                              {formatShadowChannel(c.channel, isZh ? 'zh-CN' : 'en-US')}
                            </td>
                            <td className="p-2 text-center">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                                {formatPresence(c.presence, isZh ? 'zh-CN' : 'en-US')}
                              </span>
                            </td>
                            <td className="p-2 text-slate-600">
                              {c.observation}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="p-3 bg-amber-100/60 border-l-4 border-amber-500 rounded text-amber-950 text-xs">
                  <strong>🛡️ {isZh ? '防御性护城河建议：' : 'Defensive Moat Strategy: '}</strong>
                  <span>{section3.indieCompetitionAudit.defensiveMoatAdvice}</span>
                </div>
              </div>
            )}
          </div>

          {/* §4 Commercial Validation */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {isZh ? '4. 商业验证与变现天花板评估' : '4. Commercial Validation & Monetization Headroom'}
            </h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              {section4.paidCompetitors.map((c, i) => (
                <div key={i} className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
                  <div className="font-bold text-slate-900 text-sm mb-1">{c.domain}</div>
                  <div className="text-slate-600">{isZh ? '变现模式: ' : 'Model: '}{isZh ? formatPricingModel(c.pricingModel, 'zh-CN') : c.pricingModel}</div>
                  <div className="text-slate-600">{isZh ? '价格区间: ' : 'Pricing: '}{c.priceRange}</div>
                  <div className="text-slate-500 mt-2">{isZh ? '支付通道: ' : 'Gateways: '}{c.paymentGateways.join(', ')}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {section4.monetizationHeadroom}
            </p>
          </div>

          {/* §5 14-Day Sprint Blueprint */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {isZh ? '5. 落地执行蓝图与 14 天冲刺计划' : '5. Execution Blueprint & 14-Day Sprint'}
            </h3>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700 mb-4">
              <strong>{isZh ? '推荐技术栈: ' : 'Stack: '}</strong> {section5.recommendedStack.frontend} &bull; {section5.recommendedStack.database}
            </div>
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 mb-4">
              <strong>{isZh ? '最小可行执行简报: ' : 'Minimum execution brief: '}</strong> {section5.executionBrief.coreAction}
              <div className="mt-2"><strong>{isZh ? '初始页面集合: ' : 'Initial pages: '}</strong> {section5.executionBrief.initialPages.map((p) => p.path).join(' · ')}</div>
              <div className="mt-2"><strong>{isZh ? '上线检查项: ' : 'Launch checks: '}</strong> {section5.executionBrief.launchChecklist.join(' ')}</div>
            </div>

            <div className="space-y-4">
              {section5.sprintPlan14d.map((s, idx) => (
                <div key={idx} className="p-4 rounded-xl border border-slate-200">
                  <h4 className="font-bold text-sm text-slate-900 mb-2">
                    {s.phase} <span className="text-xs text-slate-500 font-normal">({s.days})</span>
                  </h4>
                  <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside">
                    {s.deliverables.map((d, dIdx) => (
                      <li key={dIdx}>{d}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Goal & Unit Economics Simulator */}
          {data.goalSimulator && (
            <GoalSimulator
              data={data.goalSimulator}
              primaryQuery={section2.primaryQuery}
            />
          )}

          {/* §6 Kill Criteria */}
          <div>
            <h3 className="text-lg font-bold text-rose-700 mb-3 border-l-4 border-rose-600 pl-3">
              {isZh ? '6. 叫停与撤出防护红线 (Kill Criteria)' : '6. Kill Criteria & Invalidation Triggers'}
            </h3>
            <div className="space-y-3">
              {section6.activeRules.map((rule, idx) => (
                <div key={idx} className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-100 text-xs text-rose-900">
                  <span className="font-bold font-mono mr-2">{rule.code}:</span>
                  <span>{rule.rule}</span> &mdash; <em className="text-rose-700">{rule.rationale}</em>
                </div>
              ))}
            </div>
          </div>

          {/* Create Project Bottom Callout */}
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-base text-slate-900">
                {isZh ? '准备好将此研究蓝图落地执行了吗？' : 'Ready to execute this research blueprint?'}
              </h4>
              <p className="text-xs text-slate-500">
                {isZh
                  ? '将本研究报告直接转化为追踪项目，享受每周 GSC 表现数据与成效跟踪。'
                  : 'Turn this report into a tracked project with weekly GSC traction analytics.'}
              </p>
            </div>

            <Link
              href={`/projects?new=${metadata.opportunityId}&reportId=${reportId}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all shrink-0"
            >
              <FolderPlus className="w-4 h-4" />
              <span>{isZh ? '创建跟踪项目' : 'Create Tracking Project'}</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
