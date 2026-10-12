'use client';

import { useState, type ReactNode } from 'react';
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
  Lightbulb,
  Eye,
  Shield,
  AlertTriangle,
  Target,
} from 'lucide-react';
import {
  OpportunityReportData,
  VerdictBasis,
  Section4CommercialValidation,
  formatArchetype,
  formatExecutionClass,
  formatSearchIntent,
  formatSiteStrategy,
  formatResultType,
  formatPricingModel,
  formatBarrierToEntry,
  formatIndieEntrantDensity,
  formatShadowChannel,
  formatScoringFlag,
} from '@emeradar/report';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { Badge, AxisBadge, VerdictBadge, type Band, type Verdict } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { PageFrame } from '@/components/ui/PageFrame';
import { GoalSimulator } from './GoalSimulator';

interface ReportStudioClientProps {
  reportId: string;
  data: OpportunityReportData;
  markdown: string;
  opportunitySlug: string;
  /**
   * The D/M/W bands for this opportunity, read from the published card.
   * The axes are rendered as bands only (docs/16 §3.2); the report payload
   * itself carries basis points, which must never be shown as a percentage.
   */
  bands: { d: string; m: string; w: string };
}

/** Instrument column header, the same voice the track-record tables use. */
const TH = 'px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle';

const calloutTones = {
  neutral: 'border-line bg-surface-2',
  accent: 'border-accent/40 bg-accent/10',
  signal: 'border-signal/40 bg-signal/10',
  warn: 'border-warn/40 bg-warn/10',
  danger: 'border-danger/40 bg-danger/10',
  info: 'border-info/40 bg-info/10',
} as const;

export function ReportStudioClient({
  reportId,
  data,
  markdown,
  opportunitySlug,
  bands,
}: ReportStudioClientProps) {
  const [activeView, setActiveView] = useState<'preview' | 'markdown'>('preview');
  const [copied, setCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showGlossary, setShowGlossary] = useState(false);
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
    <PageFrame width="prose">
      {/* Navigation & Header */}
      <div className="border-b border-line pb-6">
        <Link
          href={`/opportunities/${opportunitySlug}`}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>{t('report.backToWorkspace')}</span>
        </Link>
        <h1 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-fg">
          {t('report.title')}
        </h1>
        <p className="mt-2 font-mono text-[11px] text-fg-subtle">
          REPORT ID <code className="text-fg-muted">{reportId}</code> &bull;{' '}
          {t('report.snapshotFrozen')}
        </p>
      </div>

      {/* Action Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 rounded-full border border-line p-0.5">
          <Button
            variant={activeView === 'preview' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveView('preview')}
          >
            <Layout className="h-3.5 w-3.5" />
            <span>{t('report.tabPreview')}</span>
          </Button>
          <Button
            variant={activeView === 'markdown' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveView('markdown')}
          >
            <FileCode className="h-3.5 w-3.5" />
            <span>{t('report.tabMarkdown')}</span>
          </Button>
        </div>

        {/* Multi-format export bar */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopyMarkdown}>
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-signal" />
                <span className="text-signal">{t('report.copiedMarkdown')}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>{t('report.copyMarkdown')}</span>
              </>
            )}
          </Button>

          <a
            href={`/api/v1/reports/${reportId}/export?format=markdown`}
            download
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Download className="h-3.5 w-3.5" />
            <span>.md</span>
          </a>

          <a
            href={`/api/v1/reports/${reportId}/export?format=json`}
            download
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Download className="h-3.5 w-3.5" />
            <span>.json</span>
          </a>

          <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5" />
            <span>{t('report.printReport')}</span>
          </Button>
        </div>
      </div>

      {activeView === 'markdown' ? (
        /* Raw Markdown View */
        <Panel tone="inverse" className="mt-8 overflow-x-auto p-6">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{markdown}</pre>
        </Panel>
      ) : (
        /* Formatted Studio View */
        <Panel brackets className="mt-8 space-y-10 p-6 sm:p-8">
          {/* Header Banner */}
          <div className="border-b border-line pb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <VerdictBadge verdict={metadata.verdict as Verdict} size="sm" />
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">
                EMERADAR RESEARCH REPORT &bull; SC-1.0.0
              </span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold leading-tight text-fg">
              {metadata.title}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-fg-muted">
              <span>
                <span className="text-fg-subtle">OBS DATE </span>
                <strong className="font-medium text-fg">{metadata.obsDate}</strong>
              </span>
              <span>
                <span className="text-fg-subtle">ARCHETYPE </span>
                <strong className="font-medium text-fg">
                  {isZh ? formatArchetype(metadata.recommendedArchetype, 'zh-CN') : metadata.recommendedArchetype}
                </strong>
              </span>
              <span>
                <span className="text-fg-subtle">CLASS </span>
                <strong className="font-medium text-fg">
                  {isZh ? formatExecutionClass(metadata.executionClass, 'zh-CN') : `${metadata.executionClass} (<14 Days)`}
                </strong>
              </span>
            </div>
          </div>

          {/* 30-Second Quick Decision Guide */}
          <Panel tone="raised" className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <Compass className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <h3 className="font-display text-base font-bold text-fg">
                    {t('report.guideTitle')}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                    {t('report.guideSubtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                aria-expanded={showGuide}
                aria-controls="report-quick-guide-panel"
                className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-accent transition-colors hover:brightness-110"
              >
                <span>{showGuide ? t('report.guideCollapse') : t('report.guideExpand')}</span>
                {showGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {showGuide && (
              <div id="report-quick-guide-panel" className="mt-4 border-t border-line pt-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <GuideStep step="1" title={t('report.guideStep1Title')} desc={t('report.guideStep1Desc')} />
                  <GuideStep step="2" title={t('report.guideStep2Title')} desc={t('report.guideStep2Desc')} />
                  <GuideStep step="3" title={t('report.guideStep3Title')} desc={t('report.guideStep3Desc')} />
                </div>

                {/* Glossary Toggle */}
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowGlossary(!showGlossary)}
                    aria-expanded={showGlossary}
                    aria-controls="report-glossary-panel"
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent transition-colors hover:brightness-110"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>{showGlossary ? t('report.glossaryToggleHide') : t('report.glossaryToggleShow')}</span>
                  </button>

                  {showGlossary && (
                    <div
                      id="report-glossary-panel"
                      className="mt-3 grid gap-3 border border-line bg-surface-2 p-4 text-[11px] leading-relaxed text-fg-muted sm:grid-cols-2"
                    >
                      <GlossaryItem term={t('report.glossaryDmwTitle')}>{t('report.glossaryDmwDesc')}</GlossaryItem>
                      <GlossaryItem term={t('report.glossarySerpTitle')}>{t('report.glossarySerpDesc')}</GlossaryItem>
                      <GlossaryItem term={t('report.glossaryBandTitle')}>{t('report.glossaryBandDesc')}</GlossaryItem>
                      <GlossaryItem term={t('report.glossaryKillTitle')}>{t('report.glossaryKillDesc')}</GlossaryItem>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Three-Axis Readout — bands only, never a percentage (docs/16 §3.2) */}
          <div className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line lg:grid-cols-4">
            <div className="bg-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">DEMAND</div>
              <div className="mt-2">
                <AxisBadge axis="d" band={bands.d as Band} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{t('report.scoreDemandDesc')}</p>
            </div>
            <div className="bg-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">COMMERCIAL</div>
              <div className="mt-2">
                <AxisBadge axis="m" band={bands.m as Band} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{t('report.scoreCommercialDesc')}</p>
            </div>
            <div className="bg-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">WINDOW</div>
              <div className="mt-2">
                <AxisBadge axis="w" band={bands.w as Band} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{t('report.scoreWindowDesc')}</p>
            </div>
            <div className="bg-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">CONFIDENCE</div>
              <div className="mt-2">
                <Badge tone="neutral">{metadata.scores.confidence}</Badge>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{t('report.scoreConfidenceDesc')}</p>
            </div>
          </div>

          {/* SEC 01 · Executive Summary */}
          <ReportSection id="01" label="EXECUTIVE SUMMARY" title={t('report.sec1Title')}>
            <p className="text-sm leading-relaxed text-fg-muted">{section1.thesis}</p>

            {section1.veteranVerdict && (
              <Callout tone="info" icon={<Target className="h-4 w-4 text-info" />} className="mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{section1.veteranVerdict.penetrationAngle.replace(/_/g, ' ')}</Badge>
                  <span className="text-xs font-bold text-fg">{t('report.veteranAngle')}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-fg">{section1.veteranVerdict.headline}</p>
                <ul className="mt-2 space-y-1.5">
                  {section1.veteranVerdict.structuralReasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-fg-muted">
                      <span className="mt-1.5 h-1 w-1 shrink-0 bg-info" aria-hidden="true" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </Callout>
            )}

            <Callout tone="accent" className="mt-4">
              <p>
                <strong className="text-fg">{t('report.whyNow')}</strong>{' '}
                <span className="text-fg-muted">{section1.whyNow}</span>
              </p>
            </Callout>

            <Callout tone="signal" icon={<Lightbulb className="h-4 w-4 text-signal" />} className="mt-4">
              <p>
                <strong className="text-fg">{t('report.topConcept')}</strong>{' '}
                <span className="text-fg-muted">{section1.topIdea}</span>
              </p>
            </Callout>

            {section1.keyRisks && section1.keyRisks.length > 0 && (
              <Callout tone="neutral" className="mt-4">
                <strong className="block font-bold text-fg">{t('report.keyRisks')}</strong>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
                  {section1.keyRisks.map((risk, i) => (
                    <li key={i}>{risk}</li>
                  ))}
                </ul>
              </Callout>
            )}

            <Callout tone="warn" className="mt-4">
              <p>
                <strong className="text-fg">{t('report.recommendation')}</strong>{' '}
                <span className="text-fg-muted">{section1.decisionRecommendation}</span>
              </p>
            </Callout>

            <DecisionBasisPanel basis={section1.decisionBasis} />
          </ReportSection>

          {/* SEC 02 · Demand Intelligence */}
          <ReportSection id="02" label="DEMAND INTELLIGENCE" title={t('report.sec2Title')}>
            <p className="font-mono text-xs text-fg-subtle">
              {t('report.seedQuery')}
              <code className="bg-surface-2 px-2 py-0.5 text-fg">{section2.primaryQuery}</code>
              {' · '}
              {t('report.velocity')} {section2.queryVelocity}x
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <InfoCell label="INTENT">
                {isZh ? formatSearchIntent(section2.searchIntent, 'zh-CN') : section2.searchIntent}
              </InfoCell>
              <InfoCell label="PRODUCT SHAPE">{section2.recommendedProductShape}</InfoCell>
              <InfoCell label="SITE STRATEGY">
                {isZh ? formatSiteStrategy(section2.siteStrategy, 'zh-CN') : section2.siteStrategy}
              </InfoCell>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-fg-muted">
              <strong className="text-fg">{t('report.coreJob')}</strong> {section2.jobToBeDone}
            </p>

            <div className="mt-4 overflow-x-auto border border-line">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-line bg-surface-2">
                  <tr>
                    <th className={TH}>QUERY</th>
                    <th className={TH}>SEARCH INTENT</th>
                    <th className={TH}>VOLUME TIER</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {section2.clusterQueries.map((q, idx) => (
                    <tr key={idx} className="transition-colors hover:bg-surface-2">
                      <td className="px-3 py-2.5 font-mono font-medium text-fg">{q.query}</td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {isZh ? formatSearchIntent(q.intent, 'zh-CN') : q.intent}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone="accent">{q.volumeTier}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportSection>

          {/* SEC 03 · SERP Weaknesses */}
          <ReportSection id="03" label="SERP WEAKNESSES" title={t('report.sec3Title')}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">
                SERP WEAKNESS
              </span>
              <AxisBadge axis="w" band={bands.w as Band} />
              <span className="text-xs text-fg-muted">
                {Math.round(section3.weakResultsRatio * 100)}% {t('report.addressableResults')}
              </span>
            </div>

            <div className="mt-4 overflow-x-auto border border-line">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-line bg-surface-2">
                  <tr>
                    <th className={TH}>#</th>
                    <th className={TH}>DOMAIN</th>
                    <th className={TH}>RESULT TITLE</th>
                    <th className={TH}>TYPE</th>
                    <th className={TH}>STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {section3.top10Results.map((r) => (
                    <tr key={r.rank} className="transition-colors hover:bg-surface-2">
                      <td className="px-3 py-2.5 font-mono font-bold text-fg-subtle">{r.rank}</td>
                      <td className="px-3 py-2.5 font-semibold text-fg">{r.domain}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2.5 text-fg-muted">{r.title}</td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {isZh ? formatResultType(r.resultType, 'zh-CN') : r.resultType}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.isWeak ? (
                          <Badge tone="danger">WEAK</Badge>
                        ) : (
                          <Badge tone="signal">STRONG</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {section3.indieCompetitionAudit && (
              <div className="mt-5 border border-warn/40 bg-warn/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Eye className="h-4 w-4 text-warn" />
                  <span className="text-sm font-bold text-fg">{t('report.indieAuditTitle')}</span>
                  <Badge tone="warn" className="ml-auto">
                    {t('report.copycatDefense')}
                  </Badge>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-fg-muted">
                  <strong className="text-fg">{t('report.strategicNotice')}</strong>
                  {t('report.strategicNoticeDesc')}
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="border border-line bg-surface p-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">
                      BARRIER TO ENTRY
                    </span>
                    <strong className="mt-1 block text-xs text-fg">
                      {formatBarrierToEntry(section3.indieCompetitionAudit.barrierToEntry, isZh ? 'zh-CN' : 'en-US')}
                    </strong>
                    <p className="mt-1 text-[11px] leading-normal text-fg-muted">
                      {section3.indieCompetitionAudit.barrierReason}
                    </p>
                  </div>

                  <div className="border border-line bg-surface p-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">
                      INDIE ENTRANT DENSITY
                    </span>
                    <strong className="mt-1 block text-xs text-fg">
                      {formatIndieEntrantDensity(section3.indieCompetitionAudit.indieEntrantDensity, isZh ? 'zh-CN' : 'en-US')}
                    </strong>
                    {section3.indieCompetitionAudit.densityWarning ? (
                      <p className="mt-1 flex items-start gap-1.5 text-[11px] font-medium leading-normal text-warn">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{section3.indieCompetitionAudit.densityWarning}</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] leading-normal text-fg-muted">
                        {t('report.densityManageable')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1.5 text-[11px] font-bold text-fg">
                    {t('report.shadowChannelsTitle')}
                  </div>
                  <div className="overflow-x-auto border border-line bg-surface">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-line bg-surface-2">
                        <tr>
                          <th className={TH}>CHANNEL</th>
                          <th className={TH}>PRESENCE</th>
                          <th className={TH}>OBSERVATION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {section3.indieCompetitionAudit.shadowChannels.map((c, i) => (
                          <tr key={i} className="transition-colors hover:bg-surface-2">
                            <td className="px-3 py-2 font-semibold text-fg">
                              {formatShadowChannel(c.channel, isZh ? 'zh-CN' : 'en-US')}
                            </td>
                            <td className="px-3 py-2">
                              <Badge tone="warn">{c.presence}</Badge>
                            </td>
                            <td className="px-3 py-2 text-fg-muted">{c.observation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <Callout tone="warn" icon={<Shield className="h-4 w-4 text-warn" />} className="mt-3 bg-surface">
                  <strong className="text-fg">{t('report.defensiveMoat')}</strong>{' '}
                  <span className="text-fg-muted">{section3.indieCompetitionAudit.defensiveMoatAdvice}</span>
                </Callout>
              </div>
            )}
          </ReportSection>

          {/* SEC 04 · Commercial Evidence */}
          <ReportSection id="04" label="COMMERCIAL EVIDENCE" title={t('report.sec4Title')}>
            <div className="grid gap-4 sm:grid-cols-2">
              {section4.paidCompetitors.map((c, i) => (
                <div key={i} className="border border-line bg-surface-2 p-4 text-xs">
                  <div className="text-sm font-bold text-fg">{c.domain}</div>
                  <div className="mt-1 text-fg-muted">
                    {t('report.modelLabel')}
                    {isZh ? formatPricingModel(c.pricingModel, 'zh-CN') : c.pricingModel}
                  </div>
                  <div className="text-fg-muted">
                    {t('report.pricingLabel')}
                    {c.priceRange}
                  </div>
                  <div className="mt-2 text-fg-subtle">
                    {t('report.gatewaysLabel')}
                    {c.paymentGateways.join(', ')}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs leading-relaxed text-fg-muted">{section4.monetizationHeadroom}</p>

            <div className="mt-4 text-xs text-fg-muted">
              <strong className="text-fg">{t('report.evidenceCount')}</strong>{' '}
              {section4.evidenceCount.total}
              {isZh
                ? ` 条（${section4.evidenceCount.observed} 条直接抓取观测，${section4.evidenceCount.selfReported} 条竞品公开声明）`
                : ` (${section4.evidenceCount.observed} directly observed, ${section4.evidenceCount.selfReported} self-reported)`}
            </div>

            <NegativeSignalPanel check={section4.negativeSignalCheck} />
          </ReportSection>

          {/* SEC 05 · Strategic Archetype */}
          <ReportSection id="05" label="STRATEGIC ARCHETYPE" title={t('report.sec5Title')}>
            <div className="border border-line bg-surface-2 p-4 text-xs text-fg-muted">
              <strong className="text-fg">{t('report.stackLabel')}</strong>{' '}
              {section5.recommendedStack.frontend} &bull; {section5.recommendedStack.database}
            </div>

            <Callout tone="accent" className="mt-4">
              <strong className="text-fg">{t('report.executionBrief')}</strong>{' '}
              <span className="text-fg-muted">{section5.executionBrief.coreAction}</span>
              <div className="mt-2 text-fg-muted">
                <strong className="text-fg">{t('report.initialPages')}</strong>{' '}
                {section5.executionBrief.initialPages.map((p) => p.path).join(' · ')}
              </div>
              <div className="mt-2 text-fg-muted">
                <strong className="text-fg">{t('report.launchChecks')}</strong>{' '}
                {section5.executionBrief.launchChecklist.join(' ')}
              </div>
            </Callout>

            <div className="mt-4 space-y-4">
              {section5.sprintPlan14d.map((s, idx) => (
                <div key={idx} className="border border-line p-4">
                  <h4 className="text-sm font-bold text-fg">
                    {s.phase}{' '}
                    <span className="font-mono text-xs font-normal text-fg-subtle">({s.days})</span>
                  </h4>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-fg-muted">
                    {s.deliverables.map((d, dIdx) => (
                      <li key={dIdx}>{d}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </ReportSection>

          {/* Goal & Unit Economics Simulator */}
          {data.goalSimulator && (
            <GoalSimulator data={data.goalSimulator} primaryQuery={section2.primaryQuery} />
          )}

          {/* SEC 06 · Risk & Kill Criteria */}
          <ReportSection id="06" label="RISK & KILL CRITERIA" title={t('report.sec6Title')}>
            <div className="space-y-3">
              {section6.activeRules.map((rule, idx) => (
                <div key={idx} className="border border-danger/40 bg-danger/10 p-3.5 text-xs">
                  <span className="mr-2 font-mono font-bold text-danger">{rule.code}:</span>
                  <span className="text-fg">{rule.rule}</span>
                  {' — '}
                  <em className="text-fg-muted">{rule.rationale}</em>
                </div>
              ))}
            </div>
          </ReportSection>

          {/* Create Project Bottom Callout */}
          <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-display text-lg font-bold text-fg">{t('report.readyTitle')}</h3>
              <p className="mt-1 text-xs text-fg-muted">{t('report.readyDesc')}</p>
            </div>

            {/* Back to the workbench and its decision bar, carrying this report
                so the project cites it. This used to link to
                `/projects?new=…&reportId=…`, which nothing read: the projects
                page takes no searchParams, so the click landed on a plain list
                and both the intent and the report id were dropped. */}
            <Link
              href={`/opportunities/${opportunitySlug}?reportId=${reportId}#decide`}
              className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'shrink-0')}
            >
              <FolderPlus className="h-4 w-4" />
              <span>{t('report.createProject')}</span>
            </Link>
          </div>
        </Panel>
      )}
    </PageFrame>
  );
}

/**
 * One numbered step of the quick decision guide.
 */
function GuideStep({ step, title, desc }: { step: string; title: string; desc: string }) {
  return (
    <div className="border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center bg-accent/10 font-mono text-[11px] font-bold text-accent">
          {step}
        </span>
        <span className="text-xs font-bold text-fg">{title}</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{desc}</p>
    </div>
  );
}

function GlossaryItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <strong className="font-bold text-fg">{term}</strong>
      <span>{children}</span>
    </div>
  );
}

/**
 * A numbered report board (docs/16 §3.5 names six). The eyebrow reuses the
 * `SEC 0n` + English uppercase label language of the public report skeleton, so
 * the preview and the built report read as the same document.
 */
function ReportSection({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] tracking-[0.16em] text-fg-subtle">SEC {id}</span>
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
          {label}
        </span>
      </div>
      <h3 className="mt-2 font-display text-xl font-bold leading-snug text-fg">{title}</h3>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function InfoCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border border-line bg-surface-2 p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">{label}</span>
      <div className="mt-1 text-sm font-semibold text-fg">{children}</div>
    </div>
  );
}

function Callout({
  tone = 'neutral',
  icon,
  className,
  children,
}: {
  tone?: keyof typeof calloutTones;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex items-start gap-3 border p-4 text-xs leading-relaxed text-fg', calloutTones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
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
    <div className="flex items-center gap-2 text-xs font-bold text-fg">
      <Compass className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      <span>{t('report.decisionBasisTitle')}</span>
    </div>
  );

  if (!basis || state === 'NOT_RETAINED') {
    return (
      <Panel tone="sunken" className="mt-4 p-4">
        {heading}
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{t('report.decisionBasisNotRetained')}</p>
      </Panel>
    );
  }

  const rawDiffers = basis.rawVerdict && basis.rawVerdict !== basis.publishedVerdict;

  return (
    <Panel tone="sunken" className="mt-4 p-4">
      {heading}

      {basis.isCompensated && (
        <div className="mt-3 border-l-2 border-warn bg-warn/10 p-3 text-xs leading-relaxed">
          <strong className="block font-bold text-warn">{t('report.decisionBasisCompensatedTitle')}</strong>
          <span className="text-fg-muted">{t('report.decisionBasisCompensatedDesc')}</span>
        </div>
      )}

      <ul className="mt-3 space-y-1.5 text-xs text-fg-muted">
        <li className="flex flex-wrap items-center gap-2">
          <strong className="text-fg">{t('report.sealedVerdict')}</strong>
          <code className="bg-surface-2 px-1.5 py-0.5 font-mono text-fg">{basis.publishedVerdict}</code>
        </li>
        {rawDiffers && (
          <li className="flex flex-wrap items-center gap-2">
            <strong className="text-fg">{t('report.rawVerdict')}</strong>
            <code className="bg-surface-2 px-1.5 py-0.5 font-mono text-fg">{basis.rawVerdict}</code>
            <span className="text-fg-subtle">{t('report.rawVerdictNote')}</span>
          </li>
        )}
        {basis.rulesTriggered.length > 0 && (
          <li className="flex flex-wrap items-center gap-1.5">
            <strong className="text-fg">{t('report.rulesTriggered')}</strong>
            {basis.rulesTriggered.map((r) => (
              <code key={r} className="bg-surface-2 px-1.5 py-0.5 font-mono text-fg-muted">
                {r}
              </code>
            ))}
          </li>
        )}
      </ul>

      <div className="mt-3 text-xs">
        <strong className="text-fg">{t('report.scoringFlags')}</strong>
        {basis.flags.length > 0 ? (
          <ul className="mt-1.5 space-y-1.5">
            {basis.flags.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Badge tone="warn">{f}</Badge>
                <span className="leading-relaxed text-fg-muted">{formatScoringFlag(f, locale)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-fg-subtle"> {t('report.noFlags')}</span>
        )}
      </div>

      {basis.reasons && (
        <table className="mt-3 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="text-fg-subtle">
              <th className="w-28 py-1 pr-3 text-left font-semibold">{t('report.axisReasonHeader')}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="align-top text-fg-muted">
            <tr className="border-t border-line">
              <td className="whitespace-nowrap py-1.5 pr-3 font-semibold text-fg">{t('report.axisD')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.dReason}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="whitespace-nowrap py-1.5 pr-3 font-semibold text-fg">{t('report.axisM')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.mReason}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="whitespace-nowrap py-1.5 pr-3 font-semibold text-fg">{t('report.axisW')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.wReason}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="whitespace-nowrap py-1.5 pr-3 font-semibold text-fg">{t('report.axisVerdict')}</td>
              <td className="py-1.5 leading-relaxed">{basis.reasons.verdictReason}</td>
            </tr>
          </tbody>
        </table>
      )}

      {basis.hashVersion !== undefined && (
        <div className="mt-3 font-mono text-[11px] text-fg-subtle">
          {t('report.hashVersion')} <code className="font-mono">v{basis.hashVersion}</code>
          {basis.hashVersion >= 2 ? ` — ${t('report.hashVersionChained')}` : ''}
        </div>
      )}
    </Panel>
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
      className={cn(
        'mt-4 border p-4 text-xs leading-relaxed text-fg',
        check.passed ? 'border-signal/40 bg-signal/10' : 'border-warn/40 bg-warn/10'
      )}
    >
      <strong className="flex items-start gap-2 font-bold">
        <Shield className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', check.passed ? 'text-signal' : 'text-warn')} />
        <span>
          {t('report.negativeCheckTitle')} —{' '}
          {check.passed ? t('report.negativeCheckPassed') : t('report.negativeCheckWarning')}
        </span>
      </strong>

      <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
        {(check.findings ?? []).map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>

      {flags.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {flags.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Badge tone="warn">{f}</Badge>
              <span className="text-fg-muted">{formatScoringFlag(f, locale)}</span>
            </li>
          ))}
        </ul>
      )}

      {check.state === 'NOT_RETAINED' && (
        <div className="mt-2 text-fg-subtle">{t('report.negativeCheckNotRetained')}</div>
      )}
    </div>
  );
}
