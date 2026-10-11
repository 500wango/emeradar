'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search,
  ArrowRight,
  FileText,
  Sparkles,
  Zap,
  TrendingUp,
  AlertCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { FeedCardItem } from '@emeradar/services';
import { formatScoringFlag } from '@emeradar/report';
import { useI18n } from '@/lib/i18n';

interface FeedClientProps {
  initialItems: FeedCardItem[];
  total: number;
  hasMore: boolean;
  offset: number;
  pageSize: number;
  activeFilters: {
    verdict?: string;
    archetype?: string;
    executionClass?: string;
    search?: string;
  };
}

export function FeedClient({ initialItems, total, hasMore, offset, pageSize, activeFilters }: FeedClientProps) {
  const { t, isZh } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [selectedVerdict, setSelectedVerdict] = useState<string>(activeFilters.verdict || 'ALL');
  const [selectedArchetype, setSelectedArchetype] = useState<string>(activeFilters.archetype || 'ALL');
  const [selectedClass, setSelectedClass] = useState<string>(activeFilters.executionClass || 'ALL');
  const [searchQuery, setSearchQuery] = useState<string>(activeFilters.search || '');
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedVerdict(activeFilters.verdict || 'ALL');
    setSelectedArchetype(activeFilters.archetype || 'ALL');
    setSelectedClass(activeFilters.executionClass || 'ALL');
    setSearchQuery(activeFilters.search || '');
  }, [activeFilters.verdict, activeFilters.archetype, activeFilters.executionClass, activeFilters.search]);

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
    setSelectedVerdict('ALL'); setSelectedArchetype('ALL'); setSelectedClass('ALL'); setSearchQuery('');
    navigate({ verdict: undefined, archetype: undefined, execution_class: undefined, search: undefined, offset: undefined });
  };

  function toggleCompare(opportunityId: string) {
    setCompareIds((current) => current.includes(opportunityId)
      ? current.filter((id) => id !== opportunityId)
      : current.length < 3 ? [...current, opportunityId] : current);
  }

  const getVerdictLabel = (verdict: string) => {
    switch (verdict) {
      case 'BUILD_NOW':
        return t('common.verdicts.BUILD_NOW');
      case 'EARLY_BET':
        return t('common.verdicts.EARLY_BET');
      case 'WATCH':
        return t('common.verdicts.WATCH');
      case 'WINDOW_CLOSING':
        return t('common.verdicts.WINDOW_CLOSING');
      default:
        return verdict;
    }
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

  const getBandLabel = (band: string) => {
    switch (band) {
      case 'HIGH':
        return t('common.bands.HIGH');
      case 'MEDIUM':
        return t('common.bands.MEDIUM');
      case 'LOW':
        return t('common.bands.LOW');
      case 'INSUFFICIENT':
        return t('common.bands.INSUFFICIENT');
      default:
        return band;
    }
  };

  return (
    <div>
      {/* Search & Tabs Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          {/* Verdict Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL', label: t('feed.tabAll') },
              { id: 'BUILD_NOW', label: t('feed.tabBuildNow'), color: 'emerald' },
              { id: 'EARLY_BET', label: t('feed.tabEarlyBet'), color: 'blue' },
              { id: 'WATCH', label: t('feed.tabWatch'), color: 'slate' },
              { id: 'WINDOW_CLOSING', label: t('feed.tabWindowClosing'), color: 'amber' },
            ].map((tab) => {
              const active = selectedVerdict === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => { setSelectedVerdict(tab.id); navigate({ verdict: tab.id, offset: undefined }); }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors ${
                    active
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="feed-search"
              name="search"
              type="search"
              placeholder={t('feed.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </form>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
                <label htmlFor="feed-archetype" className="font-semibold text-slate-500">{t('feed.archetypeFilter')}:</label>
              <select
                id="feed-archetype"
                name="archetype"
                value={selectedArchetype}
                onChange={(e) => { setSelectedArchetype(e.target.value); navigate({ archetype: e.target.value, offset: undefined }); }}
                className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <option value="ALL">{t('feed.allArchetypes')}</option>
                <option value="LIGHTWEIGHT_TOOL">{t('common.archetypes.LIGHTWEIGHT_TOOL')}</option>
                <option value="MICRO_SAAS">{t('common.archetypes.MICRO_SAAS')}</option>
                <option value="PSEO_SITE">{t('common.archetypes.PSEO_SITE')}</option>
                <option value="DIRECTORY">{t('common.archetypes.DIRECTORY')}</option>
                <option value="CONTENT_SITE">{t('common.archetypes.CONTENT_SITE')}</option>
                <option value="TOOL">{t('common.archetypes.TOOL')}</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
                <label htmlFor="feed-execution-class" className="font-semibold text-slate-500">{t('feed.classFilter')}:</label>
              <select
                id="feed-execution-class"
                name="execution_class"
                value={selectedClass}
                onChange={(e) => { setSelectedClass(e.target.value); navigate({ execution_class: e.target.value, offset: undefined }); }}
                className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <option value="ALL">{t('feed.allClasses')}</option>
                <option value="S">{t('common.executionClasses.S')}</option>
                <option value="M">{t('common.executionClasses.M')}</option>
                <option value="L">{t('common.executionClasses.L')}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">
              {isZh
                ? `显示 ${total === 0 ? 0 : offset + 1}-${Math.min(offset + initialItems.length, total)} / ${total} 项决策`
                : `Showing ${total === 0 ? 0 : offset + 1}-${Math.min(offset + initialItems.length, total)} of ${total} radar items`}
            </span>
            {(selectedVerdict !== 'ALL' || selectedArchetype !== 'ALL' || selectedClass !== 'ALL' || activeFilters.search) && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <RotateCcw className="w-3 h-3" />
                {t('common.reset')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Zero State Fallback */}
      {initialItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-xl mx-auto my-12">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">
            {isZh ? '此标签下尚无通过准入门槛的机会' : 'Nothing in this tab passed the gate'}
          </h3>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            {isZh
              ? 'BUILD NOW 决策严格保持精选稀缺，绝不使用低置信度候选来填补空白。'
              : 'BUILD NOW is supposed to stay scarce. Candidates and low-confidence observations are not used to fill the gap.'}
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {isZh ? `查看全部已发布决策 (${total})` : `Show published decisions (${total})`}
          </button>
        </div>
      ) : (
        /* Opportunity Cards Grid */
        <div className="grid md:grid-cols-2 gap-6">
          {initialItems.map((opp) => {
            const isBuildNow = opp.verdict === 'BUILD_NOW';
            const isEarlyBet = opp.verdict === 'EARLY_BET';
            const isClosing = opp.verdict === 'WINDOW_CLOSING';
            const flags = opp.flags ?? [];
            const isCompensated = (opp.rulesTriggered ?? []).includes('RULE_BUILD_NOW_COMPENSATED');

            return (
              <div
                key={opp.opportunityId}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Card Header: Verdict & Tags */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          isBuildNow
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : isEarlyBet
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : isClosing
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {getVerdictLabel(opp.verdict)}
                      </span>
                      <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {getLifecycleLabel(opp.lifecycle)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                      <span className="px-2 py-0.5 rounded bg-slate-100">
                        {t('common.action')}: {getExecutionClassLabel(opp.executionClass)}
                      </span>
                      <span>&bull;</span>
                      <span className="truncate max-w-[140px]">{getArchetypeLabel(opp.recommendedArchetype)}</span>
                    </div>
                  </div>

                  <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={compareIds.includes(opp.opportunityId)}
                      disabled={!compareIds.includes(opp.opportunityId) && compareIds.length >= 3}
                      onChange={() => toggleCompare(opp.opportunityId)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                    />
                    {isZh ? '加入比较' : 'Add to compare'}
                  </label>

                  {/* Title & Primary Query */}
                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className="font-bold text-lg text-slate-900 hover:text-blue-600 transition-colors line-clamp-2"
                  >
                    {opp.title}
                  </Link>

                  <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                    <span>{isZh ? '目标查询词:' : 'Target Query:'}</span>
                    <code className="text-slate-800 bg-slate-100 px-2 py-0.5 rounded font-mono">
                      {opp.primaryQuery}
                    </code>
                    <span className="text-slate-500">
                      {opp.marketCountry} · {opp.researchLanguage}
                    </span>
                  </div>
                  {opp.claimsCount !== undefined && (
                    <div className="mt-2.5 flex items-center gap-2 text-xs">
                      <span className="text-slate-500 font-medium">{isZh ? '认领槽位:' : 'Builder slots:'}</span>
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${
                        opp.isCrowdedLocked || (opp.claimsCount >= (opp.maxClaims ?? 5))
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : opp.claimsCount >= 3
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {opp.isCrowdedLocked || (opp.claimsCount >= (opp.maxClaims ?? 5))
                          ? (isZh ? `已满 (${opp.claimsCount}/5 🔒 窗口关闭)` : `Full (${opp.claimsCount}/5 🔒 Closed)`)
                          : (isZh ? `${opp.claimsCount} / ${opp.maxClaims ?? 5} 已认领` : `${opp.claimsCount} / ${opp.maxClaims ?? 5} claimed`)}
                      </span>
                    </div>
                  )}
                  {isEarlyBet && (
                    <p className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block">
                      {isZh ? '商业化论证未经验证' : 'Commercial case unverified'}
                    </p>
                  )}

                  {/* Top Idea Concept */}
                  <div className="my-4 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900 block mb-0.5">
                      💡 {isZh ? '产品概念:' : 'Product Concept:'}
                    </span>
                    {opp.topIdea}
                  </div>

                  {/* Why Now Callout */}
                  <div className="text-xs text-slate-600 mb-5 leading-relaxed">
                    <strong className="text-slate-800">{isZh ? '为何现在切入?' : 'Why Now?'}</strong> {opp.whyNowSummary}
                  </div>

                  {/* D-M-W Metric Gauges */}
                  <div className="grid grid-cols-3 gap-3 mb-6 p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 text-center">
                    <div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                        <TrendingUp className="w-3 h-3 text-blue-500" />
                        <span>{t('feed.demand')}</span>
                      </div>
                      <div className="text-sm font-bold text-blue-700 mt-1">{getBandLabel(opp.dBand)}</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                        <Sparkles className="w-3 h-3 text-emerald-500" />
                        <span>{t('feed.commercial')}</span>
                      </div>
                      <div className="text-sm font-bold text-emerald-700 mt-1">{getBandLabel(opp.mBand)}</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                        <Zap className="w-3 h-3 text-amber-500" />
                        <span>{t('feed.window')}</span>
                      </div>
                      <div className="text-sm font-bold text-amber-700 mt-1">{getBandLabel(opp.wBand)}</div>
                    </div>
                  </div>

                  {/* 为何是这个结论：判定依据不该只活在报告里。
                      未留存时只在 build 类裁决上提示，避免每张卡片都刷一段免责声明。 */}
                  {(!opp.basisRetained ? isBuildNow || isEarlyBet : isCompensated || flags.length > 0) && (
                    <div className="mb-5 text-xs">
                      {!opp.basisRetained ? (
                        <p className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 leading-relaxed">
                          {t('report.decisionBasisNotRetained')}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {isCompensated && (
                            <p className="p-2.5 rounded-lg bg-amber-50 border-l-4 border-amber-500 text-amber-900 leading-relaxed">
                              <strong className="block mb-0.5">
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
                                  className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200 font-mono text-[10px] cursor-help"
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
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  {isBuildNow || isEarlyBet ? (
                    <Link
                      href={`/opportunities/${opp.slug}/report`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{t('feed.viewFullReport')}</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {isZh ? '报告仅对可构建裁决开放' : 'Report follows a build verdict'}
                    </span>
                  )}

                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
                  >
                    <span>{isZh ? '进入决策工作台' : 'Inspect Decision Workspace'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(total > pageSize || offset > 0) && (
        <nav className="mt-8 flex items-center justify-between border-t border-slate-200 pt-5" aria-label={isZh ? '决策流分页' : 'Decision feed pagination'}>
          <button
            type="button"
            onClick={() => navigate({ offset: String(Math.max(0, offset - pageSize)) }, 'push')}
            disabled={offset === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('feed.previousPage')}
          </button>
          <span className="text-xs text-slate-500">
            {t('feed.pageStatus', { page: String(Math.floor(offset / pageSize) + 1) })}
          </span>
          <button
            type="button"
            onClick={() => navigate({ offset: String(offset + pageSize) }, 'push')}
            disabled={!hasMore}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {t('feed.nextPage')}
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}

      {compareIds.length > 0 && (
        <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-xs font-semibold text-blue-900">
            {isZh ? `已选择 ${compareIds.length} / 3 个机会` : `${compareIds.length} / 3 opportunities selected`}
          </span>
          {compareIds.length >= 2 ? (
            <Link
              href={`/compare?ids=${encodeURIComponent(compareIds.join(','))}`}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              {isZh ? '开始比较' : 'Compare selected'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="text-xs text-blue-700">{isZh ? '再选择一个机会' : 'Select one more opportunity'}</span>
          )}
        </div>
      )}
    </div>
  );
}
