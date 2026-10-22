'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search,
  ArrowRight,
  FileText,
  AlertCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { FeedCardItem } from '@emeradar/services';
import { formatScoringFlag } from '@emeradar/report';
import { useI18n } from '@/lib/i18n';
import { AxisBadge, Badge, VerdictBadge, type Verdict } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';

interface FeedClientProps {
  initialItems: FeedCardItem[];
  /** 为真时不渲染通用空态：Free 页已用本周精选面板说明了为什么是空的。 */
  suppressEmptyState?: boolean;
  total: number;
  hasMore: boolean;
  offset: number;
  pageSize: number;
  activeFilters: {
    verdict?: string;
    /** 审计 03：'ALL' 表示跨分栏看全部裁决。 */
    track?: string;
    archetype?: string;
    executionClass?: string;
    search?: string;
  };
}

export function FeedClient({ initialItems, suppressEmptyState, total, hasMore, offset, pageSize, activeFilters }: FeedClientProps) {
  const { t, isZh } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  // 审计 03：默认分栏是「可构建」（BUILD_NOW / EARLY_BET），不是无过滤的全部。
  const [selectedVerdict, setSelectedVerdict] = useState<string>(
    activeFilters.verdict || (activeFilters.track === 'ALL' ? 'ALL' : 'BUILDABLE')
  );
  const [selectedArchetype, setSelectedArchetype] = useState<string>(activeFilters.archetype || 'ALL');
  const [selectedClass, setSelectedClass] = useState<string>(activeFilters.executionClass || 'ALL');
  const [searchQuery, setSearchQuery] = useState<string>(activeFilters.search || '');

  useEffect(() => {
    setSelectedVerdict(activeFilters.verdict || (activeFilters.track === 'ALL' ? 'ALL' : 'BUILDABLE'));
    setSelectedArchetype(activeFilters.archetype || 'ALL');
    setSelectedClass(activeFilters.executionClass || 'ALL');
    setSearchQuery(activeFilters.search || '');
  }, [activeFilters.verdict, activeFilters.track, activeFilters.archetype, activeFilters.executionClass, activeFilters.search]);

  function navigate(next: Record<string, string | undefined>, mode: 'push' | 'replace' = 'replace') {
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    Object.entries(next).forEach(([key, value]) => {
      if (!value || value === 'ALL') params.delete(key);
      else params.set(key, value);
    });
    const query = params.toString();
    if (mode === 'push') router.push(`${pathname}${query ? `?${query}` : ''}`);
    else router.replace(`${pathname}${query ? `?${query}` : ''}`);
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ search: searchQuery.trim() || undefined, offset: undefined });
  }

  const resetFilters = () => {
    setSelectedVerdict('BUILDABLE'); setSelectedArchetype('ALL'); setSelectedClass('ALL'); setSearchQuery('');
    navigate({ verdict: undefined, track: undefined, archetype: undefined, execution_class: undefined, search: undefined, offset: undefined });
  };


  const getArchetypeLabel = (arch: string) => {
    const key = `common.archetypes.${arch}`;
    const translated = t(key);
    return translated !== key ? translated : arch;
  };

  /** 枚举一律走 i18n：界面上不出现裸的 EARLY_WINDOW / S。 */
  const getEnumLabel = (group: string, value: string) => {
    const key = `common.${group}.${value}`;
    const translated = t(key);
    return translated !== key ? translated : value;
  };

  const getLifecycleLabel = (lifecycle: string) => getEnumLabel('lifecycles', lifecycle);
  const getExecutionClassLabel = (cls: string) => getEnumLabel('executionClasses', cls);

  return (
    <div>
      {/* Search & Tabs Header */}
      <Panel className="mb-8 p-4">
        <div className="flex flex-col justify-between gap-4 border-b border-line pb-4 md:flex-row md:items-center">
          {/* Verdict Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'BUILDABLE', label: t('feed.tabBuildable') },
              { id: 'BUILD_NOW', label: t('feed.tabBuildNow') },
              { id: 'EARLY_BET', label: t('feed.tabEarlyBet') },
              { id: 'WATCH', label: t('feed.tabWatch') },
              { id: 'WINDOW_CLOSING', label: t('feed.tabWindowClosing') },
              { id: 'PASS', label: t('feed.tabPass') },
              { id: 'ALL', label: t('feed.tabAll') },
            ].map((tab) => {
              const active = selectedVerdict === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSelectedVerdict(tab.id);
                    if (tab.id === 'BUILDABLE') {
                      // 默认分栏：不带 verdict 也不带 track，服务端按可构建出。
                      navigate({ verdict: undefined, track: undefined, offset: undefined });
                    } else if (tab.id === 'ALL') {
                      navigate({ verdict: undefined, track: 'ALL', offset: undefined });
                    } else {
                      navigate({ verdict: tab.id, track: undefined, offset: undefined });
                    }
                  }}
                  className={`rounded-sm px-3.5 py-1.5 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    active
                      ? 'on-inverse bg-inverse text-inverse-fg'
                      : 'bg-surface-2 text-fg-muted hover:text-fg'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search Bar */}
          <form onSubmit={applySearch} className="relative min-w-[260px]">
            <label htmlFor="feed-search" className="sr-only">{t('feed.searchPlaceholder')}</label>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="feed-search"
              name="search"
              type="search"
              placeholder={t('feed.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-surface-2 py-1.5 pl-9 pr-4 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </form>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 text-xs text-fg-muted">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="feed-archetype" className="font-semibold text-fg-muted">{t('feed.archetypeFilter')}:</label>
              <Select
                id="feed-archetype"
                name="archetype"
                value={selectedArchetype}
                onChange={(e) => { setSelectedArchetype(e.target.value); navigate({ archetype: e.target.value, offset: undefined }); }}
                className="w-auto bg-surface-2 px-2.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <option value="ALL">{t('feed.allArchetypes')}</option>
                <option value="TOOL">{t('common.archetypes.TOOL')}</option>
                <option value="MICRO_SAAS">{t('common.archetypes.MICRO_SAAS')}</option>
                <option value="PSEO_SITE">{t('common.archetypes.PSEO_SITE')}</option>
                <option value="DIRECTORY">{t('common.archetypes.DIRECTORY')}</option>
                <option value="CONTENT_SITE">{t('common.archetypes.CONTENT_SITE')}</option>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="feed-execution-class" className="font-semibold text-fg-muted">{t('feed.classFilter')}:</label>
              <Select
                id="feed-execution-class"
                name="execution_class"
                value={selectedClass}
                onChange={(e) => { setSelectedClass(e.target.value); navigate({ execution_class: e.target.value, offset: undefined }); }}
                className="w-auto bg-surface-2 px-2.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <option value="ALL">{t('feed.allClasses')}</option>
                <option value="S">{t('common.executionClasses.S')}</option>
                <option value="M">{t('common.executionClasses.M')}</option>
                <option value="L">{t('common.executionClasses.L')}</option>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-fg-subtle">
              {t('feed.showingRange', {
                start: total === 0 ? 0 : offset + 1,
                end: Math.min(offset + initialItems.length, total),
                total,
              })}
            </span>
            {(selectedVerdict !== 'ALL' || selectedArchetype !== 'ALL' || selectedClass !== 'ALL' || activeFilters.search) && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex items-center gap-1 font-semibold text-accent transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <RotateCcw className="h-3 w-3" />
                {t('common.reset')}
              </button>
            )}
          </div>
        </div>
      </Panel>

      {/* Zero State Fallback */}
      {initialItems.length === 0 && suppressEmptyState ? null : initialItems.length === 0 ? (
        <Panel className="mx-auto my-12 max-w-xl p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-fg-subtle">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-fg">
            {t('feed.emptyTitle')}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-fg-muted">
            {t('feed.emptyDesc')}
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className={buttonVariants({ size: 'sm', className: 'mt-6' })}
          >
            {t('feed.emptyCta', { total })}
          </button>
        </Panel>
      ) : (
        /* Opportunity Cards Grid */
        <div className="grid gap-6 md:grid-cols-2">
          {initialItems.map((opp) => {
            const isBuildNow = opp.verdict === 'BUILD_NOW';
            const isEarlyBet = opp.verdict === 'EARLY_BET';
            const flags = opp.flags ?? [];
            const isCompensated = (opp.rulesTriggered ?? []).includes('RULE_BUILD_NOW_COMPENSATED');

            return (
              <Panel
                key={opp.opportunityId}
                className="flex flex-col justify-between p-6 transition-colors hover:border-accent"
              >
                <div>
                  {/* Card Header: Verdict & Tags.
                      Stacked below `sm`: both groups hold nowrap badges, and
                      side by side they exceeded the card width at 375 (the page
                      scrolled horizontally by 80px). They only share a row once
                      there is room for both. */}
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-x-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <VerdictBadge verdict={opp.verdict as Verdict} />
                      <Badge tone="neutral">{getLifecycleLabel(opp.lifecycle)}</Badge>
                    </div>

                    <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-fg-muted">
                      <span className="shrink-0 rounded-sm bg-surface-2 px-2 py-0.5">
                        {t('common.action')}: {getExecutionClassLabel(opp.executionClass)}
                      </span>
                      <span className="shrink-0">&bull;</span>
                      <span className="min-w-0 max-w-[140px] truncate">{getArchetypeLabel(opp.recommendedArchetype)}</span>
                    </div>
                  </div>

                  {/* Title & Primary Query */}
                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className="line-clamp-2 text-lg font-bold text-fg transition-colors hover:text-accent"
                  >
                    {opp.title}
                  </Link>

                  {/* flex-wrap：375 下「目标查询词 + 长 query chip + 市场标签」挤在一行时，
                      市场标签会在连字符处断成「US · en-」/「US」两行。放开换行让整块下沉。 */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                    <span className="shrink-0">{t('feed.targetQuery')}</span>
                    <code className="min-w-0 rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-fg">
                      {opp.primaryQuery}
                    </code>
                    <span className="shrink-0 whitespace-nowrap text-fg-muted">
                      {opp.marketCountry} · {opp.researchLanguage}
                    </span>
                  </div>
                  {isEarlyBet && (
                    <p className="mt-2 inline-block rounded-sm border border-warn/40 bg-warn/10 px-2 py-1 text-xs font-semibold text-warn">
                      {t('feed.commercialUnverified')}
                    </p>
                  )}

                  {/* Top Idea Concept */}
                  <div className="my-4 rounded-sm border border-line bg-surface-2 p-3 text-xs text-fg-muted">
                    <span className="mb-0.5 block font-semibold text-fg">
                      💡 {t('feed.productConcept')}
                    </span>
                    {opp.topIdea}
                  </div>

                  {/* Why Now Callout */}
                  <div className="mb-5 text-xs leading-relaxed text-fg-muted">
                    <strong className="text-fg">{t('feed.whyNow')}</strong> {opp.whyNowSummary}
                  </div>

                  {/* D-M-W bands (docs/16 §3.2 — independent banded badges, never a score) */}
                  <div className="mb-6 flex flex-wrap gap-2">
                    <AxisBadge axis="d" band={opp.dBand} />
                    <AxisBadge axis="m" band={opp.mBand} />
                    <AxisBadge axis="w" band={opp.wBand} />
                  </div>

                  {/* 为何是这个结论：判定依据不该只活在报告里。
                      未留存时只在 build 类裁决上提示，避免每张卡片都刷一段免责声明。 */}
                  {(!opp.basisRetained ? isBuildNow || isEarlyBet : isCompensated || flags.length > 0) && (
                    <div className="mb-5 text-xs">
                      {!opp.basisRetained ? (
                        <p className="rounded-sm border border-line bg-surface-2 p-2.5 leading-relaxed text-fg-subtle">
                          {t('report.decisionBasisNotRetained')}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {isCompensated && (
                            <p className="border-l-4 border-warn bg-warn/10 p-2.5 leading-relaxed text-warn">
                              <strong className="mb-0.5 block">
                                ⚠️ {t('report.decisionBasisCompensatedTitle')}
                              </strong>
                              {t('report.decisionBasisCompensatedDesc')}
                            </p>
                          )}
                          {flags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {flags.map((flag) => (
                                <span
                                  key={flag}
                                  title={formatScoringFlag(flag, isZh ? 'zh-CN' : 'en-US')}
                                  className="cursor-help rounded-sm border border-warn/40 bg-warn/10 px-2 py-0.5 font-mono text-[10px] text-warn"
                                >
                                  {flag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                  {isBuildNow || isEarlyBet ? (
                    <Link
                      href={`/opportunities/${opp.slug}/report`}
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>{t('feed.viewFullReport')}</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-fg-subtle">
                      {t('feed.reportGated')}
                    </span>
                  )}

                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    <span>{t('feed.inspectWorkspace')}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {(total > pageSize || offset > 0) && (
        <nav className="mt-8 flex items-center justify-between border-t border-line pt-5" aria-label={t('feed.paginationLabel')}>
          <button
            type="button"
            onClick={() => navigate({ offset: String(Math.max(0, offset - pageSize)) }, 'push')}
            disabled={offset === 0}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <ChevronLeft className="h-4 w-4" />
            {t('feed.previousPage')}
          </button>
          <span className="text-xs text-fg-muted">
            {t('feed.pageStatus', { page: String(Math.floor(offset / pageSize) + 1) })}
          </span>
          <button
            type="button"
            onClick={() => navigate({ offset: String(offset + pageSize) }, 'push')}
            disabled={!hasMore}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('feed.nextPage')}
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}

    </div>
  );
}
