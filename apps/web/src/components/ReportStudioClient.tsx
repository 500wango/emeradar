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
  VerdictBasis,
  Section4CommercialValidation,
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
  formatScoringFlag,
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
            {t('report.snapshotFrozen')}
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
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white transition-colors shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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
              <span>{t('report.obsDate')}<strong>{metadata.obsDate}</strong></span>
              <span>{t('report.archetypeLabel')}<strong>{isZh ? formatArchetype(metadata.recommendedArchetype, 'zh-CN') : metadata.recommendedArchetype}</strong></span>
              <span>{t('report.classLabel')}<strong>{isZh ? formatExecutionClass(metadata.executionClass, 'zh-CN') : `${metadata.executionClass} (<14 Days)`}</strong></span>
            </div>
          </div>

          {/* 30-Second Quick Decision Guide */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-purple-50/90 border border-blue-100 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {t('report.guideTitle')}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {t('report.guideSubtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                aria-expanded={showGuide}
                aria-controls="report-quick-guide-panel"
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 shrink-0 ml-2 cursor-pointer select-none"
              >
                <span>{showGuide ? t('report.guideCollapse') : t('report.guideExpand')}</span>
                {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {showGuide && (
              <div id="report-quick-guide-panel" className="mt-4 pt-4 border-t border-blue-100/80 text-xs text-slate-700 space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="p-3.5 bg-white/95 rounded-xl border border-blue-100/80 shadow-2xs">
                    <div className="font-bold text-blue-900 flex items-center gap-1.5 mb-1.5">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 inline-flex items-center justify-center text-[11px] font-black shrink-0">1</span>
                      <span>{t('report.guideStep1Title')}</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[11px]">
                      {t('report.guideStep1Desc')}
                    </p>
                  </div>

                  <div className="p-3.5 bg-white/95 rounded-xl border border-indigo-100/80 shadow-2xs">
                    <div className="font-bold text-indigo-900 flex items-center gap-1.5 mb-1.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 inline-flex items-center justify-center text-[11px] font-black shrink-0">2</span>
                      <span>{t('report.guideStep2Title')}</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[11px]">
                      {t('report.guideStep2Desc')}
                    </p>
                  </div>

                  <div className="p-3.5 bg-white/95 rounded-xl border border-purple-100/80 shadow-2xs">
                    <div className="font-bold text-purple-900 flex items-center gap-1.5 mb-1.5">
                      <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 inline-flex items-center justify-center text-[11px] font-black shrink-0">3</span>
                      <span>{t('report.guideStep3Title')}</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[11px]">
                      {t('report.guideStep3Desc')}
                    </p>
                  </div>
                </div>

                {/* Glossary Toggle */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowGlossary(!showGlossary)}
                    aria-expanded={showGlossary}
                    aria-controls="report-glossary-panel"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 transition-colors"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>{showGlossary ? t('report.glossaryToggleHide') : t('report.glossaryToggleShow')}</span>
                  </button>

                  {showGlossary && (
                    <div id="report-glossary-panel" className="mt-2.5 p-3.5 bg-white/95 rounded-xl border border-blue-200/80 grid sm:grid-cols-2 gap-3 text-[11px] text-slate-600 animate-in fade-in duration-200">
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
                {t('report.scoreDemandTitle')}
              </div>
              <div className="text-2xl font-black text-blue-900 mt-1">
                {dPct} <span className="text-xs font-normal text-blue-600">/ 100</span>
              </div>
              <div className="text-[10px] text-blue-700/80 mt-1 font-medium">
                {t('report.scoreDemandDesc')}
              </div>
            </div>

            <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-xl text-center">
              <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                {t('report.scoreCommercialTitle')}
              </div>
              <div className="text-2xl font-black text-emerald-900 mt-1">
                {mPct} <span className="text-xs font-normal text-emerald-600">/ 100</span>
              </div>
              <div className="text-[10px] text-emerald-700/80 mt-1 font-medium">
                {t('report.scoreCommercialDesc')}
              </div>
            </div>

            <div className="p-4 bg-amber-50/60 border border-amber-100 rounded-xl text-center">
              <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
                {t('report.scoreWindowTitle')}
              </div>
              <div className="text-2xl font-black text-amber-900 mt-1">
                {wPct} <span className="text-xs font-normal text-amber-600">/ 100</span>
              </div>
              <div className="text-[10px] text-amber-700/80 mt-1 font-medium">
                {t('report.scoreWindowDesc')}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center">
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                {t('report.scoreConfidenceTitle')}
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {metadata.scores.confidence === 'HIGH' && isZh ? t('report.confidenceHigh') : metadata.scores.confidence}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-medium">
                {t('report.scoreConfidenceDesc')}
              </div>
            </div>
          </div>

          {/* §1 Executive Summary */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {t('report.sec1Title')}
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
                  <span>{t('report.veteranAngle')}</span>
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
              <strong>{t('report.whyNow')}</strong> {section1.whyNow}
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-xs text-emerald-900 mb-4">
              <strong>💡 {t('report.topConcept')}</strong> {section1.topIdea}
            </div>
            {section1.keyRisks && section1.keyRisks.length > 0 && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 mb-4">
                <strong className="block mb-1.5 text-slate-900">{t('report.keyRisks')}</strong>
                <ul className="space-y-1 list-disc list-inside text-slate-600">
                  {section1.keyRisks.map((risk, i) => (
                    <li key={i}>{risk}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-900">
              <strong>{t('report.recommendation')}</strong> {section1.decisionRecommendation}
            </div>

            <DecisionBasisPanel basis={section1.decisionBasis} />
          </div>

          {/* §2 Demand Breakdown */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {t('report.sec2Title')}
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              {t('report.seedQuery')}<code className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-800">{section2.primaryQuery}</code> ({t('report.velocity')}: {section2.queryVelocity}x)
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mb-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{t('report.intentLabel')}</span>
                <strong className="block text-slate-900 mt-1">{isZh ? formatSearchIntent(section2.searchIntent, 'zh-CN') : section2.searchIntent}</strong>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{t('report.productShape')}</span>
                <strong className="block text-slate-900 mt-1">{section2.recommendedProductShape}</strong>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{t('report.siteStrategy')}</span>
                <strong className="block text-slate-900 mt-1">{isZh ? formatSiteStrategy(section2.siteStrategy, 'zh-CN') : section2.siteStrategy}</strong>
              </div>
            </div>
            <p className="text-xs text-slate-700 mb-4"><strong>{t('report.coreJob')}</strong> {section2.jobToBeDone}</p>

            <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">{t('report.colQuery')}</th>
                  <th className="p-3">{t('report.colSearchIntent')}</th>
                  <th className="p-3">{t('report.colVolumeTier')}</th>
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
              {t('report.sec3Title')}
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              {t('report.serpWeaknessScore')}<strong>{section3.serpWeaknessScore.toFixed(1)} / 100</strong> ({Math.round(section3.weakResultsRatio * 100)}% {t('report.addressableResults')})
            </p>

            <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-2.5">#</th>
                  <th className="p-2.5">{t('report.colDomain')}</th>
                  <th className="p-2.5">{t('report.colResultTitle')}</th>
                  <th className="p-2.5">{t('report.colType')}</th>
                  <th className="p-2.5">{t('report.colStatus')}</th>
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
                        <span className="text-rose-700 font-semibold">🔴 {t('report.weak')}</span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">🟢 {t('report.strong')}</span>
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
                  <span>{t('report.indieAuditTitle')}</span>
                  <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-amber-200/80 text-amber-900 border border-amber-300">
                    {t('report.copycatDefense')}
                  </span>
                </div>

                <p className="text-amber-800 mb-3 leading-relaxed">
                  <strong>{t('report.strategicNotice')}</strong>
                  {t('report.strategicNoticeDesc')}
                </p>

                <div className="grid sm:grid-cols-2 gap-3 mb-3">
                  <div className="p-3 bg-white/90 border border-amber-200 rounded-lg">
                    <span className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">
                      {t('report.barrierToEntry')}
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
                      {t('report.indieEntrantDensity')}
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
                        {t('report.densityManageable')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-[11px] font-bold text-amber-900 mb-1.5">
                    {t('report.shadowChannelsTitle')}
                  </div>
                  <div className="border border-amber-200 rounded-lg overflow-hidden bg-white/90">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-amber-100/60 text-amber-900 border-b border-amber-200 text-[11px]">
                        <tr>
                          <th className="p-2 font-semibold">{t('report.colShadowChannel')}</th>
                          <th className="p-2 font-semibold text-center">{t('report.colPresence')}</th>
                          <th className="p-2 font-semibold">{t('report.colObservation')}</th>
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
                  <strong>🛡️ {t('report.defensiveMoat')}</strong>
                  <span>{section3.indieCompetitionAudit.defensiveMoatAdvice}</span>
                </div>
              </div>
            )}
          </div>

          {/* §4 Commercial Validation */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {t('report.sec4Title')}
            </h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              {section4.paidCompetitors.map((c, i) => (
                <div key={i} className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
                  <div className="font-bold text-slate-900 text-sm mb-1">{c.domain}</div>
                  <div className="text-slate-600">{t('report.modelLabel')}{isZh ? formatPricingModel(c.pricingModel, 'zh-CN') : c.pricingModel}</div>
                  <div className="text-slate-600">{t('report.pricingLabel')}{c.priceRange}</div>
                  <div className="text-slate-500 mt-2">{t('report.gatewaysLabel')}{c.paymentGateways.join(', ')}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              {section4.monetizationHeadroom}
            </p>

            <div className="mb-4 text-xs text-slate-600">
              <strong className="text-slate-900">{t('report.evidenceCount')}</strong>{' '}
              {section4.evidenceCount.total}
              {isZh
                ? ` 条（${section4.evidenceCount.observed} 条直接抓取观测，${section4.evidenceCount.selfReported} 条竞品公开声明）`
                : ` (${section4.evidenceCount.observed} directly observed, ${section4.evidenceCount.selfReported} self-reported)`}
            </div>

            <NegativeSignalPanel check={section4.negativeSignalCheck} />
          </div>

          {/* §5 14-Day Sprint Blueprint */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
              {t('report.sec5Title')}
            </h3>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700 mb-4">
              <strong>{t('report.stackLabel')}</strong> {section5.recommendedStack.frontend} &bull; {section5.recommendedStack.database}
            </div>
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 mb-4">
              <strong>{t('report.executionBrief')}</strong> {section5.executionBrief.coreAction}
              <div className="mt-2"><strong>{t('report.initialPages')}</strong> {section5.executionBrief.initialPages.map((p) => p.path).join(' · ')}</div>
              <div className="mt-2"><strong>{t('report.launchChecks')}</strong> {section5.executionBrief.launchChecklist.join(' ')}</div>
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
              {t('report.sec6Title')}
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
                {t('report.readyTitle')}
              </h4>
              <p className="text-xs text-slate-500">
                {t('report.readyDesc')}
              </p>
            </div>

            <Link
              href={`/projects?new=${metadata.opportunityId}&reportId=${reportId}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all shrink-0"
            >
              <FolderPlus className="w-4 h-4" />
              <span>{t('report.createProject')}</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 「判定依据」面板。
 * 报告过去只给结论、不给理由；这个面板把账本封存的规则轨迹与评分标志摊开，
 * 并在依据缺失时如实说明，而不是留空让人误以为"没有任何问题"。
 */
function DecisionBasisPanel({ basis }: { basis?: VerdictBasis }) {
  const { t, isZh } = useI18n();
  const locale = isZh ? 'zh-CN' : 'en-US';
  const state = basis?.state ?? 'NOT_RETAINED';

  const heading = (
    <div className="font-bold text-xs text-slate-900 mb-2">
      🧭 {t('report.decisionBasisTitle')}
    </div>
  );

  if (!basis || state === 'NOT_RETAINED') {
    return (
      <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
        {heading}
        {t('report.decisionBasisNotRetained')}
      </div>
    );
  }

  const rawDiffers = basis.rawVerdict && basis.rawVerdict !== basis.publishedVerdict;

  return (
    <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
      {heading}

      {basis.isCompensated && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 border-l-4 border-amber-500 text-amber-900 leading-relaxed">
          <strong className="block mb-1">⚠️ {t('report.decisionBasisCompensatedTitle')}</strong>
          {t('report.decisionBasisCompensatedDesc')}
        </div>
      )}

      <ul className="space-y-1 mb-3">
        <li>
          <strong>{t('report.sealedVerdict')}</strong>：
          <code className="px-1.5 py-0.5 rounded bg-slate-200 font-mono">{basis.publishedVerdict}</code>
        </li>
        {rawDiffers && (
          <li>
            <strong>{t('report.rawVerdict')}</strong>：
            <code className="px-1.5 py-0.5 rounded bg-slate-200 font-mono">{basis.rawVerdict}</code>
            <span className="text-slate-500"> （{t('report.rawVerdictNote')}）</span>
          </li>
        )}
        {basis.rulesTriggered.length > 0 && (
          <li>
            <strong>{t('report.rulesTriggered')}</strong>：
            {basis.rulesTriggered.map((r) => (
              <code key={r} className="ml-1 px-1.5 py-0.5 rounded bg-slate-200 font-mono">
                {r}
              </code>
            ))}
          </li>
        )}
      </ul>

      <div className="mb-3">
        <strong>{t('report.scoringFlags')}</strong>
        {basis.flags.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {basis.flags.map((f) => (
              <li key={f} className="flex items-start gap-1.5">
                <code className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono shrink-0">
                  {f}
                </code>
                <span className="text-slate-600">{formatScoringFlag(f, locale)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-slate-500"> {t('report.noFlags')}</span>
        )}
      </div>

      {basis.reasons && (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1 pr-3 font-semibold w-28">{t('report.axisReasonHeader')}</th>
              <th className="py-1 font-semibold" />
            </tr>
          </thead>
          <tbody className="align-top text-slate-700">
            <tr className="border-t border-slate-200">
              <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{t('report.axisD')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.dReason}</td>
            </tr>
            <tr className="border-t border-slate-200">
              <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{t('report.axisM')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.mReason}</td>
            </tr>
            <tr className="border-t border-slate-200">
              <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{t('report.axisW')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.wReason}</td>
            </tr>
            <tr className="border-t border-slate-200">
              <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{t('report.axisVerdict')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.verdictReason}</td>
            </tr>
          </tbody>
        </table>
      )}

      {basis.hashVersion !== undefined && (
        <div className="mt-3 text-[11px] text-slate-500">
          {t('report.hashVersion')}：<code className="font-mono">v{basis.hashVersion}</code>
          {basis.hashVersion >= 2 ? ` —— ${t('report.hashVersionChained')}` : ''}
        </div>
      )}
    </div>
  );
}

/**
 * 负面信号筛查面板。
 * 原先只在报告里显示一个 ✅/⚠️，findings 与 flags 都被丢弃 —— 那等于"说了结论、藏了证据"。
 */
function NegativeSignalPanel({
  check,
}: {
  check: Section4CommercialValidation['negativeSignalCheck'];
}) {
  const { t, isZh } = useI18n();
  const locale = isZh ? 'zh-CN' : 'en-US';
  const flags = check.flags ?? [];

  return (
    <div
      className={`p-4 rounded-xl border text-xs leading-relaxed ${
        check.passed
          ? 'bg-emerald-50 border-emerald-100 text-emerald-900'
          : 'bg-amber-50 border-amber-200 text-amber-900'
      }`}
    >
      <strong className="block mb-1.5">
        🛡️ {t('report.negativeCheckTitle')} ——{' '}
        {check.passed ? t('report.negativeCheckPassed') : t('report.negativeCheckWarning')}
      </strong>

      <ul className="space-y-1 list-disc list-inside opacity-90">
        {(check.findings ?? []).map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>

      {flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {flags.map((f) => (
            <li key={f} className="flex items-start gap-1.5">
              <code className="px-1.5 py-0.5 rounded bg-white/70 font-mono shrink-0">{f}</code>
              <span className="opacity-90">{formatScoringFlag(f, locale)}</span>
            </li>
          ))}
        </ul>
      )}

      {check.state === 'NOT_RETAINED' && (
        <div className="mt-2 opacity-70">{t('report.negativeCheckNotRetained')}</div>
      )}
    </div>
  );
}
