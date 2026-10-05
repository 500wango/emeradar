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
} from 'lucide-react';
import { OpportunityReportData } from '@emeradar/report';
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
  const { t, isZh } = useI18n();

  const { metadata, section1, section2, section3, section4, section5, section6 } = data;

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
                {metadata.verdict}
              </span>
              <span className="text-xs text-slate-400">Emeradar Research Report &bull; sc-1.0.0</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">{metadata.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span>{isZh ? '观测日期: ' : 'Obs Date: '}<strong>{metadata.obsDate}</strong></span>
              <span>{isZh ? '推荐形态: ' : 'Archetype: '}<strong>{metadata.recommendedArchetype}</strong></span>
              <span>{isZh ? '执行等级: ' : 'Class: '}<strong>{metadata.executionClass} (&lt;14 Days)</strong></span>
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
                    {section1.veteranVerdict.penetrationAngle}
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
                <strong className="block text-slate-900 mt-1">{section2.searchIntent}</strong>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{isZh ? '产品形态' : 'Product shape'}</span>
                <strong className="block text-slate-900 mt-1">{section2.recommendedProductShape}</strong>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">{isZh ? '站点策略' : 'Site strategy'}</span>
                <strong className="block text-slate-900 mt-1">{section2.siteStrategy}</strong>
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
                    <td className="p-3 text-slate-600">{q.intent}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                        {q.volumeTier}
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
                        {r.resultType}
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
                  <div className="text-slate-600">{isZh ? '变现模式: ' : 'Model: '}{c.pricingModel}</div>
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
