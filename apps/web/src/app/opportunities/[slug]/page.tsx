import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  ShieldCheck,
  TrendingUp,
  Sparkles,
  Zap,
  FileText,
  AlertTriangle,
  ChevronLeft,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { AuthService, EntitlementService, OpportunityService, freeAccessibleOpportunityId } from '@emeradar/services';
import { query } from '@emeradar/db';
import { formatScoringFlag, deriveBasisState } from '@emeradar/report';
import { EvidenceInteractiveList } from '@/components/EvidenceInteractiveList';
import { CommercialProofPanel } from '@/components/CommercialProofPanel';
import { GoogleTrendsPanel } from '@/components/GoogleTrendsPanel';
import { UserPainPointsPanel } from '@/components/UserPainPointsPanel';
import { DecisionBar } from '@/components/DecisionBar';
import { getServerI18n } from '@/lib/i18n/server';
import { canOpenFullOpportunity, canOpenReport } from '@/lib/plan-access';
import { safeExternalUrl } from '@/lib/format';
import { PageFrame } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Badge, VerdictBadge, AxisBadge, type Verdict } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

interface OpportunityWorkspacePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reportId?: string | string[] }>;
}

const TH = 'py-2.5 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em]';

export default async function OpportunityWorkspacePage({
  params,
  searchParams,
}: OpportunityWorkspacePageProps) {
  const { slug } = await params;
  const { reportId: reportIdParam } = await searchParams;
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect(`/login?next=${encodeURIComponent(`/opportunities/${slug}`)}`);
  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  // Free 只能打开本周精选那一条（13 §3.2），资格与 Feed 同源；其余机会照旧引导升级。
  const weeklyId = ent.opportunityDetailFull ? null : await freeAccessibleOpportunityId(slug);
  if (!canOpenFullOpportunity(ent, weeklyId)) redirect('/pricing?feature=opportunity-detail');

  let data: any;
  try {
    // Free 的访问资格已在上面判过（本周精选那一条）；v3.1 没有天数延迟，所以这里
    // 不再传 `minAgeDays`。
    data = await OpportunityService.getOpportunityDetail(slug);
  } catch {
    notFound();
  }

  const { t, locale } = await getServerI18n();


  const { opportunity, queries, serpResults, evidence, commercialProof, killCriteria, latestVerdict } = data;
  // 报告只对已发布的 BUILD_NOW / EARLY_BET 生成（ReportService 的硬条件）。
  // 周案例（PASS / WINDOW_CLOSING / WATCH）必然不满足，渲染入口只会把用户带到
  // "EVIDENCE GATE NOT MET"。
  // Free 只能打开周案例；周案例是历史案例，但 13 §3.2 给它 1 份预览额度。
  const reportAvailable = canOpenReport(ent, weeklyId, opportunity.verdict);

  // 枚举值绝不裸输出：用户看到的应当是"立即构建"，而不是 BUILD_NOW。
  const label = (group: string, value: string | null | undefined) => {
    if (!value) return '';
    const key = `common.${group}.${value}`;
    const translated = t(key);
    return translated !== key ? translated : value;
  };
  const verdictLabel = (verdict: string) => label('verdicts', verdict);
  const archetypeLabel = (arch: string) => label('archetypes', arch);
  const executionClassLabel = (cls: string) => label('executionClasses', cls);

  // 判定依据：latestVerdict 是账本里的那一行，不是卡片投影。
  // 留存口径与报告/卡片共用 deriveBasisState，避免三处各判各的。
  const basisRetained = deriveBasisState(latestVerdict) !== 'NOT_RETAINED';
  const basisRules: string[] = Array.isArray(latestVerdict?.explanation?.rulesTriggered)
    ? latestVerdict.explanation.rulesTriggered
    : [];
  const basisFlags: string[] = Array.isArray(latestVerdict?.flags) ? latestVerdict.flags : [];
  const basisCompensated = basisRules.includes('RULE_BUILD_NOW_COMPENSATED');
  const basisRawVerdict: string | null = latestVerdict?.raw_verdict ?? null;
  const basisRawDiffers = basisRetained && basisRawVerdict && basisRawVerdict !== latestVerdict?.verdict;

  const staleEventsRes =
    latestVerdict?.obs_date && basisFlags.includes('STALE_DATA')
      ? await query<{
          source: string;
          domain: string;
          reference_id: string | null;
          observed_at: string | null;
        }>(
          `SELECT source, domain, reference_id, observed_at::text
             FROM stale_data_events
            WHERE opportunity_id = $1 AND obs_date = $2::date
            ORDER BY source, domain
            LIMIT 12`,
          [opportunity.id, latestVerdict.obs_date]
        )
      : { rows: [] as Array<{ source: string; domain: string; reference_id: string | null; observed_at: string | null }> };
  const staleEvents = staleEventsRes.rows;

  const isBuildNow = opportunity.verdict === 'BUILD_NOW';
  const isEarlyBet = opportunity.verdict === 'EARLY_BET';
  const publishable =
    opportunity.status === 'TRACKED' &&
    (isBuildNow || isEarlyBet) &&
    opportunity.confidence !== 'LOW';

  // 决定必须引用用户当下看到的那一行账本。没有 row 就没有可引用的依据，
  // 两个按钮都保持锁定 —— 服务端也拒绝无依据的决策。
  const verdictId: string | null = latestVerdict?.id ?? null;
  const canGo = publishable && verdictId !== null;
  const canExport = publishable;
  const blockReason = canGo
    ? undefined
    : verdictId === null
    ? t('opportunityWorkspace.noVerdictBlockReason')
    : t('opportunityWorkspace.goBlockReason');

  /**
   * 研报工作室的「创建跟踪项目」带着 reportId 跳回来，由这一页转交给 DecisionBar，
   * 最终写进 projects.report_id。校验放在渲染期而不是提交期：否则决策已经落账
   * 才发现报告不属于本人，会留下一条没有项目的 GO。
   */
  let reportId: string | null = null;
  const candidateReportId = Array.isArray(reportIdParam) ? reportIdParam[0] : reportIdParam;
  if (candidateReportId) {
    const reportRes = await query<{ id: string }>(
      `SELECT id FROM opportunity_reports
       WHERE id = $1 AND user_id = $2 AND opportunity_id = $3`,
      [candidateReportId, session.user.id, opportunity.id]
    );
    reportId = reportRes.rows[0]?.id ?? null;
  }

  const confidenceTone =
    opportunity.confidence === 'HIGH'
      ? 'signal'
      : opportunity.confidence === 'MEDIUM'
      ? 'info'
      : 'warn';

  const progressSteps: Array<[string, boolean]> = [
    [t('opportunityWorkspace.progressSignal'), true],
    [t('opportunityWorkspace.progressCandidate'), true],
    [t('opportunityWorkspace.progressObservation'), opportunity.status === 'TRACKED'],
    [t('opportunityWorkspace.progressGate'), opportunity.status === 'TRACKED'],
    [
      t('opportunityWorkspace.progressPrediction'),
      opportunity.status === 'TRACKED' && Boolean(latestVerdict),
    ],
  ];

  const weakCount = serpResults.filter((r: any) => r.is_weak).length;

  return (
    <PageFrame width="full">
      {/* Back to Feed Link */}
      <Link
        href="/feed"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted hover:text-fg mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>{t('opportunityWorkspace.backToFeed')}</span>
      </Link>

      {/* Sticky Decision Bar (docs/16 §3.3-1) */}
      <div
        id="decide"
        className="sticky top-16 z-30 -mx-4 sm:-mx-6 lg:-mx-8 mb-6 scroll-mt-20 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:px-6 lg:px-8"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <VerdictBadge verdict={opportunity.verdict as Verdict} size="sm" />
            <AxisBadge axis="d" band={opportunity.d_band ?? '—'} />
            <AxisBadge axis="m" band={opportunity.m_band ?? '—'} />
            <AxisBadge axis="w" band={opportunity.w_band ?? '—'} />
            <Badge tone={confidenceTone}>{opportunity.confidence ?? '—'}</Badge>
            <Badge tone="neutral">
              {opportunity.market_country} · {opportunity.research_language}
            </Badge>
            <Badge tone="neutral">{label('lifecycles', opportunity.lifecycle)}</Badge>
            <span className="hidden min-w-0 items-center gap-2 lg:flex">
              {/* shrink-0 + nowrap: the label must not break. "WHY NOW" split over
                  two lines the moment the badge row squeezed this column; the
                  truncated summary is the part that should absorb the pressure. */}
              <span className="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                WHY NOW
              </span>
              <span className="max-w-md truncate text-xs text-fg-muted">
                {opportunity.why_now_summary}
              </span>
            </span>
          </div>

          <DecisionBar
            opportunityId={opportunity.id}
            slug={opportunity.slug}
            verdictId={verdictId}
            reportId={reportId}
            recommendedArchetype={opportunity.recommended_archetype ?? null}
            canGo={canGo}
            canExport={canExport}
            blockReason={blockReason}
          />
        </div>
      </div>

      {/* Hero Title Block */}
      <Panel brackets className="p-6 md:p-8 mb-10">
        <div className="pb-6 border-b border-line">
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-fg tracking-tight">
            {opportunity.title}
          </h1>
          <div className="mt-2 text-xs text-fg-subtle flex items-center gap-2">
            <span>{t('opportunityWorkspace.primarySeedQuery')}</span>
            <code className="text-fg bg-surface-2 border border-line px-2 py-0.5 rounded-sm font-mono font-medium">
              {opportunity.primary_query}
            </code>
          </div>
        </div>

        {/* D-M-W Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="p-4 rounded-sm bg-surface-2 border border-line">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <TrendingUp className="w-3.5 h-3.5 text-axis-d" />
              <span>{t('opportunityWorkspace.demandScore')}</span>
            </div>
            <div className="font-mono text-2xl font-bold text-axis-d mt-1">
              {opportunity.d_band ?? '—'}
            </div>
            <div className="text-[11px] text-fg-subtle mt-1">
              {t('opportunityWorkspace.demandBand')}
            </div>
          </div>

          <div className="p-4 rounded-sm bg-surface-2 border border-line">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <Sparkles className="w-3.5 h-3.5 text-axis-m" />
              <span>{t('opportunityWorkspace.commercialScore')}</span>
            </div>
            <div className="font-mono text-2xl font-bold text-axis-m mt-1">
              {opportunity.m_band ?? '—'}
            </div>
            <div className="text-[11px] text-fg-subtle mt-1">
              {t('opportunityWorkspace.commercialBand')}
            </div>
          </div>

          <div className="p-4 rounded-sm bg-surface-2 border border-line">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <Zap className="w-3.5 h-3.5 text-axis-w" />
              <span>{t('opportunityWorkspace.windowScore')}</span>
            </div>
            <div className="font-mono text-2xl font-bold text-axis-w mt-1">
              {opportunity.w_band ?? '—'}
            </div>
            <div className="text-[11px] text-fg-subtle mt-1">
              {t('opportunityWorkspace.windowBand')}
            </div>
          </div>

          <div className="p-4 rounded-sm bg-surface-2 border border-line">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <ShieldCheck className="w-3.5 h-3.5 text-info" />
              <span>{t('opportunityWorkspace.evidenceLevel')}</span>
            </div>
            <div className="mt-1.5">
              <Badge tone={confidenceTone} size="sm">
                {opportunity.confidence ?? '—'}
              </Badge>
            </div>
            <div className="text-[11px] text-fg-subtle mt-1">
              {opportunity.confidence === 'LOW'
                ? t('opportunityWorkspace.notEnoughHistory')
                : t('opportunityWorkspace.evidenceConfidence')}
            </div>
          </div>
        </div>

        {latestVerdict && basisFlags.includes('STALE_DATA') && (
          <div className="mt-6 rounded-sm border-l-4 border-warn bg-warn/10 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold text-warn">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{t('report.staleDataTitle')}</span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              {t('report.staleDataDesc')}
            </p>
            {staleEvents.length > 0 && (
              <div className="mt-3 border-t border-warn/30 pt-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-warn">
                  {t('report.staleDataSources')}
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-fg-muted">
                  {staleEvents.map((event, index) => (
                    <li key={`${event.source}-${event.domain}-${index}`} className="break-all">
                      <span className="text-fg-subtle">{event.source}</span>
                      {event.domain ? ` · ${event.domain}` : ''}
                      {event.reference_id ? ` · ${event.reference_id.slice(0, 16)}…` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 判定依据：把"为什么是它"和结论摆在一起，而不是只给一个标签 */}
        {latestVerdict && (
          <div className="mt-6 pt-5 border-t border-line">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-sm font-bold text-fg">
                🧭 {t('report.decisionBasisTitle')}
              </h2>
              {basisRetained && basisCompensated && (
                <Badge tone="warn">⚠️ {t('report.decisionBasisCompensatedTitle')}</Badge>
              )}
            </div>

            {!basisRetained ? (
              <p className="text-xs text-fg-muted leading-relaxed bg-surface-2 border border-line rounded-sm p-4">
                {t('report.decisionBasisNotRetained')}
              </p>
            ) : (
              <div className="text-xs text-fg-muted space-y-3">
                {basisCompensated && (
                  <p className="p-3 rounded-sm bg-warn/10 border-l-4 border-warn text-warn leading-relaxed">
                    {t('report.decisionBasisCompensatedDesc')}
                  </p>
                )}

                <ul className="space-y-1">
                  <li>
                    <strong className="text-fg">{t('report.sealedVerdict')}</strong>：
                    <span className="ml-1 px-1.5 py-0.5 rounded-sm bg-surface-2 border border-line font-mono">
                      {verdictLabel(latestVerdict.verdict)}
                    </span>
                  </li>
                  {basisRawDiffers && (
                    <li>
                      <strong className="text-fg">{t('report.rawVerdict')}</strong>：
                      <span className="ml-1 px-1.5 py-0.5 rounded-sm bg-surface-2 border border-line font-mono">
                        {verdictLabel(basisRawVerdict)}
                      </span>
                      <span className="text-fg-subtle"> （{t('report.rawVerdictNote')}）</span>
                    </li>
                  )}
                  {basisRules.length > 0 && (
                    <li>
                      <strong className="text-fg">{t('report.rulesTriggered')}</strong>：
                      {basisRules.map((rule) => (
                        <span
                          key={rule}
                          className="ml-1 px-1.5 py-0.5 rounded-sm bg-surface-2 border border-line font-mono"
                        >
                          {rule}
                        </span>
                      ))}
                    </li>
                  )}
                </ul>

                <div>
                  <strong className="text-fg">{t('report.scoringFlags')}</strong>
                  {basisFlags.length > 0 ? (
                    <ul className="mt-1 space-y-1">
                      {basisFlags.map((flag) => (
                        <li key={flag} className="flex items-start gap-1.5">
                          <span className="px-1.5 py-0.5 rounded-sm bg-warn/10 text-warn font-mono shrink-0">
                            {flag}
                          </span>
                          <span className="text-fg-muted">{formatScoringFlag(flag, locale)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-fg-subtle"> {t('report.noFlags')}</span>
                  )}
                </div>

                {latestVerdict.explanation && (
                  <div className="rounded-sm border border-line overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <tbody className="align-top">
                        {[
                          [t('report.axisD'), latestVerdict.explanation.dReason],
                          [t('report.axisM'), latestVerdict.explanation.mReason],
                          [t('report.axisW'), latestVerdict.explanation.wReason],
                          [t('report.axisVerdict'), latestVerdict.explanation.verdictReason],
                        ].map(([axis, reason], index) => (
                          <tr key={String(axis)} className={index > 0 ? 'border-t border-line' : ''}>
                            <td className="py-2 px-3 font-semibold text-fg-subtle bg-surface-2 whitespace-nowrap align-top w-32">
                              {axis}
                            </td>
                            <td className="py-2 px-3 leading-relaxed text-fg-muted">{reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="text-[11px] text-fg-subtle">
                  {t('report.hashVersion')}：
                  <code className="font-mono">v{latestVerdict.hash_version}</code>
                  {Number(latestVerdict.hash_version) >= 2 ? ` —— ${t('report.hashVersionChained')}` : ''}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 pt-5 border-t border-line">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-bold text-fg">{t('opportunityWorkspace.decisionProgress')}</h2>
            <span className="text-[11px] text-fg-subtle">
              {opportunity.status === 'TRACKED'
                ? t('opportunityWorkspace.publishedRecord')
                : t('opportunityWorkspace.stillObserving')}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
            {progressSteps.map(([stepLabel, done], index) => (
              <div
                key={String(stepLabel)}
                className={cn(
                  'rounded-sm border px-3 py-2',
                  done
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-line bg-surface-2 text-fg-muted'
                )}
              >
                <span className="font-mono font-bold">{index + 1}</span> {stepLabel}
              </div>
            ))}
          </div>
          {opportunity.status !== 'TRACKED' && (
            <p className="mt-3 text-xs text-fg-subtle">{t('opportunityWorkspace.candidateNote')}</p>
          )}
        </div>
      </Panel>

      {/* Decision Workspace Content Sections */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column (2 Cols): Core Analytical Deep Dive.
            `min-w-0` is load-bearing: a grid item's automatic minimum is its
            min-content size, and an `overflow-x-auto` wrapper does NOT stop that
            contribution — the SERP table's own min-content (490px) was dragging
            the whole track to 540px and scrolling the page sideways at 375. With
            the minimum released, the table scrolls inside its own wrapper, which
            is the behaviour docs/16 §5 asks for. */}
        <div className="min-w-0 lg:col-span-2 space-y-8">
          {isEarlyBet && (
            <p className="text-sm font-semibold text-warn bg-warn/10 border border-warn/40 rounded-sm px-4 py-3">
              {t('opportunityWorkspace.earlyBetWarning')}
            </p>
          )}

          {/* Section 1: Google Trends Demand & Trajectory */}
          <GoogleTrendsPanel
            query={opportunity.primary_query}
            marketCountry={opportunity.market_country}
            clusterQueries={queries}
          />

          {/* Section 2: Real User Needs & Frustration Analysis */}
          <UserPainPointsPanel
            primaryQuery={opportunity.primary_query}
            recommendedArchetype={opportunity.recommended_archetype}
            executionClass={opportunity.execution_class}
            topIdea={opportunity.top_idea}
            serpResults={serpResults}
          />

          {/* Section 3: Why Now & Top Concept */}
          <Panel className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">WHY NOW</p>
            <h2 className="mt-1 text-base font-bold text-fg mb-3">
              {t('opportunityWorkspace.whyNowTitle')}
            </h2>
            <div className="p-4 rounded-sm bg-accent/10 border border-accent/30 text-xs text-fg leading-relaxed">
              {opportunity.why_now_summary}
            </div>

            <div className="mt-4 p-4 rounded-sm bg-signal/10 border border-signal/30 text-xs text-fg leading-relaxed">
              <strong>💡 {t('opportunityWorkspace.recommendedConcept')}</strong> {opportunity.top_idea}
            </div>
          </Panel>

          {/* Section 4: SERP Weakness Inspector (docs/16 §3.3-4) */}
          <Panel className="p-6">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                  SERP INTELLIGENCE
                </p>
                <h2 className="mt-1 text-base font-bold text-fg">
                  {t('opportunityWorkspace.serpTitle')}
                </h2>
                <p className="text-xs text-fg-subtle mt-0.5">{t('opportunityWorkspace.serpDesc')}</p>
              </div>
              <Badge tone="warn" size="sm" className="shrink-0">
                {t('opportunityWorkspace.serpWeakCount', { count: weakCount })}
              </Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-fg-subtle border-b border-line">
                  <tr>
                    <th className={TH}>#</th>
                    <th className={TH}>{t('opportunityWorkspace.thDomain')}</th>
                    <th className={TH}>{t('opportunityWorkspace.thTitle')}</th>
                    <th className={TH}>{t('opportunityWorkspace.thType')}</th>
                    <th className={TH}>{t('opportunityWorkspace.thWeakness')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {serpResults.map((r: any) => (
                    <tr key={r.rank} className="hover:bg-surface-2 transition-colors">
                      <td className="py-3 px-3 font-bold text-fg-subtle align-top">{r.rank}</td>
                      <td className="py-3 px-3 align-top">
                        <span className="inline-block bg-surface-2 border border-line text-fg-muted px-2 py-0.5 rounded-sm text-xs font-mono">
                          {r.domain}
                        </span>
                      </td>
                      <td className="py-3 px-3 max-w-md align-top">
                        <a
                          href={safeExternalUrl(r.url) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-fg hover:text-accent hover:underline inline-flex items-center gap-1.5 group"
                          title={r.title}
                        >
                          <span className="line-clamp-1">{r.title}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-fg-subtle group-hover:text-accent shrink-0" />
                        </a>
                        {r.snippet && (
                          <p className="text-[11px] text-fg-subtle mt-1 line-clamp-2 leading-relaxed">
                            {r.snippet}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-3 align-top">
                        <code className="text-[11px] text-fg-muted bg-surface-2 border border-line px-1.5 py-0.5 rounded-sm font-mono">
                          {r.result_type}
                        </code>
                      </td>
                      <td className="py-3 px-3 align-top">
                        {r.is_weak ? (
                          <span className="inline-flex items-center gap-1 text-danger font-medium text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-danger"></span>
                            {r.weakness_type || '—'}
                          </span>
                        ) : (
                          <span className="text-fg-muted font-medium text-xs">
                            {r.result_type === 'SPECIALIST' || r.result_type === 'OFFICIAL'
                              ? t('opportunityWorkspace.serpSpecialist')
                              : t('opportunityWorkspace.serpNotWeak')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Section 5: Query Cluster Matrix */}
          <Panel className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
              QUERY CLUSTER
            </p>
            <h2 className="mt-1 text-base font-bold text-fg mb-1">
              {t('opportunityWorkspace.queryMatrixTitle')}
            </h2>
            <p className="text-xs text-fg-subtle mb-4">{t('opportunityWorkspace.queryMatrixDesc')}</p>

            <div className="grid sm:grid-cols-2 gap-3">
              {queries.map((q: any) => (
                <div
                  key={q.id}
                  className="p-3 rounded-sm bg-surface-2 border border-line flex items-center justify-between gap-2 text-xs"
                >
                  <code className="font-mono text-fg font-medium truncate">{q.query_text}</code>
                  <Badge tone="accent">Tier {q.tier}</Badge>
                </div>
              ))}
            </div>
          </Panel>

          {/* Section 6: Commercial Signal Proof Boundary (docs/16 §3.3-5) */}
          <CommercialProofPanel
            stage={commercialProof?.stage || 'NONE'}
            gateways={commercialProof?.gateways || []}
            plansCount={commercialProof?.plansCount || 0}
          />

          {/* Section 7: Corroborating Evidence Chain with Slide-Over Drawer */}
          <Panel className="p-6">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                  EVIDENCE CHAIN
                </p>
                <h2 className="mt-1 text-base font-bold text-fg">
                  {t('opportunityWorkspace.evidenceChainTitle')}
                </h2>
                <p className="text-xs text-fg-subtle mt-0.5">
                  {t('opportunityWorkspace.evidenceChainDesc')}
                </p>
              </div>
              <Badge tone="neutral" className="shrink-0">
                {t('opportunityWorkspace.evidenceCount', { count: evidence.length })}
              </Badge>
            </div>

            <EvidenceInteractiveList evidence={evidence} />
          </Panel>
        </div>

        {/* Right Column (1 Col): Rules, Blueprint & Evidence */}
        <div className="space-y-8">
          {/* Execution Blueprint Recommendation */}
          <Panel className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
              BUILD SHAPE
            </p>
            <h3 className="mt-1 text-sm font-bold text-fg mb-4">
              {t('opportunityWorkspace.buildShape')}
            </h3>

            <div className="space-y-4 text-xs">
              <div>
                <span className="text-fg-subtle block mb-1">
                  {t('opportunityWorkspace.recommendedArchetype')}
                </span>
                <span className="font-bold text-base text-fg">
                  {archetypeLabel(opportunity.recommended_archetype)}
                </span>
              </div>

              <div>
                <span className="text-fg-subtle block mb-1">
                  {t('opportunityWorkspace.devTimeBudget')}
                </span>
                <span className="font-bold text-sm text-fg">
                  {executionClassLabel(opportunity.execution_class)} &bull;{' '}
                  {t('opportunityWorkspace.sprint14')}
                </span>
              </div>

              <div className="pt-3 border-t border-line">
                <span className="text-fg-subtle block mb-2">
                  {t('opportunityWorkspace.recommendedStack')}
                </span>
                <ul className="space-y-1.5 text-fg-muted">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                    Next.js 15+ App Router
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                    Tailwind CSS (Zero-bloat UI)
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                    PostgreSQL / Supabase
                  </li>
                </ul>
              </div>

              {reportAvailable && (
                <div className="pt-4 border-t border-line">
                  <Link
                    href={`/opportunities/${opportunity.slug}/report`}
                    className={buttonVariants({
                      variant: 'outline',
                      className: 'w-full border-accent/40 text-accent hover:bg-accent/10',
                    })}
                  >
                    <FileText className="w-4 h-4" />
                    <span>{t('opportunityWorkspace.openReport')}</span>
                  </Link>
                </div>
              )}
            </div>
          </Panel>

          {/* Kill Criteria Matrix */}
          <Panel className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
              KILL CRITERIA
            </p>
            <h3 className="mt-1 text-sm font-bold text-danger mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>{t('opportunityWorkspace.killCriteriaTitle')}</span>
            </h3>
            <p className="text-xs text-fg-subtle mb-4">{t('opportunityWorkspace.killCriteriaDesc')}</p>

            <div className="space-y-3">
              {killCriteria.map((kc: any) => (
                <div
                  key={kc.id}
                  className="p-3 rounded-sm bg-danger/10 border border-danger/30 text-xs text-fg-muted"
                >
                  <span className="font-bold font-mono text-[11px] text-danger block mb-0.5">
                    {kc.rule_code}
                  </span>
                  {kc.description}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
