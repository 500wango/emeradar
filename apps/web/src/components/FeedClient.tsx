'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Search,
  ArrowRight,
  FileText,
  Sparkles,
  Zap,
  TrendingUp,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { FeedCardItem } from '@emeradar/services';

interface FeedClientProps {
  initialItems: FeedCardItem[];
  total: number;
}

export function FeedClient({ initialItems, total }: FeedClientProps) {
  const [selectedVerdict, setSelectedVerdict] = useState<string>('BUILD_NOW');
  const [selectedArchetype, setSelectedArchetype] = useState<string>('ALL');
  const [selectedClass, setSelectedClass] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Client-side filtering for fast interactivity
  const filtered = initialItems.filter((item) => {
    if (selectedVerdict !== 'ALL' && item.verdict !== selectedVerdict) {
      return false;
    }
    if (selectedArchetype !== 'ALL' && item.recommendedArchetype !== selectedArchetype) {
      return false;
    }
    if (selectedClass !== 'ALL' && item.executionClass !== selectedClass) {
      return false;
    }
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchQuery = item.primaryQuery.toLowerCase().includes(q);
      const matchWhyNow = item.whyNowSummary.toLowerCase().includes(q);
      if (!matchTitle && !matchQuery && !matchWhyNow) return false;
    }
    return true;
  });

  const resetFilters = () => {
    setSelectedVerdict('BUILD_NOW');
    setSelectedArchetype('ALL');
    setSelectedClass('ALL');
    setSearchQuery('');
  };

  return (
    <div>
      {/* Search & Tabs Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          {/* Verdict Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL', label: 'All Opportunities' },
              { id: 'BUILD_NOW', label: 'BUILD NOW', color: 'emerald' },
              { id: 'EARLY_BET', label: 'EARLY BET', color: 'blue' },
              { id: 'WATCH', label: 'WATCH', color: 'slate' },
              { id: 'WINDOW_CLOSING', label: 'WINDOW CLOSING', color: 'amber' },
            ].map((tab) => {
              const active = selectedVerdict === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setSelectedVerdict(tab.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
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
          <div className="relative min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter published decisions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            />
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-500">Archetype:</span>
              <select
                value={selectedArchetype}
                onChange={(e) => setSelectedArchetype(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs focus:outline-none"
              >
                <option value="ALL">All Archetypes</option>
                <option value="LIGHTWEIGHT_TOOL">Lightweight Tool</option>
                <option value="BOILERPLATE_SCAFFOLD">Boilerplate Scaffold</option>
                <option value="MICRO_SAAS">Micro SaaS</option>
                <option value="PSEO_SITE">pSEO Programmatic Site</option>
                <option value="DIRECTORY">Directory / List</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-500">Scope:</span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs focus:outline-none"
              >
                <option value="ALL">All Classes</option>
                <option value="S">Class S (&lt;14 Days)</option>
                <option value="M">Class M (2 - 4 Weeks)</option>
                <option value="L">Class L (&gt;1 Month)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Showing {filtered.length} of {total} radar items</span>
            {(selectedVerdict !== 'BUILD_NOW' || selectedArchetype !== 'ALL' || selectedClass !== 'ALL' || searchQuery) && (
              <button
                onClick={resetFilters}
                className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Zero State Fallback */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-xl mx-auto my-12">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Nothing in this tab passed the gate</h3>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            BUILD NOW is supposed to stay scarce. Candidates and low-confidence observations are not used to fill the gap.
          </p>
          <button
            onClick={() => setSelectedVerdict('ALL')}
            className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
          >
            Show published decisions ({total})
          </button>
        </div>
      ) : (
        /* Opportunity Cards Grid */
        <div className="grid md:grid-cols-2 gap-6">
          {filtered.map((opp) => {
            const isBuildNow = opp.verdict === 'BUILD_NOW';
            const isEarlyBet = opp.verdict === 'EARLY_BET';
            const isClosing = opp.verdict === 'WINDOW_CLOSING';

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
                        {opp.verdict}
                      </span>
                      <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {opp.lifecycle}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                      <span className="px-2 py-0.5 rounded bg-slate-100">
                        Class {opp.executionClass}
                      </span>
                      <span>&bull;</span>
                      <span>{opp.recommendedArchetype}</span>
                    </div>
                  </div>

                  {/* Title & Primary Query */}
                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className="font-bold text-lg text-slate-900 hover:text-blue-600 transition-colors line-clamp-2"
                  >
                    {opp.title}
                  </Link>

                  <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                    <span>Target Query:</span>
                    <code className="text-slate-800 bg-slate-100 px-2 py-0.5 rounded font-mono">
                      {opp.primaryQuery}
                    </code>
                    <span className="text-slate-500">
                      {opp.marketCountry} · {opp.researchLanguage}
                    </span>
                  </div>
                  {isEarlyBet && (
                    <p className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block">
                      Commercial case unverified
                    </p>
                  )}

                  {/* Top Idea Concept */}
                  <div className="my-4 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900 block mb-0.5">💡 Product Concept:</span>
                    {opp.topIdea}
                  </div>

                  {/* Why Now Callout */}
                  <div className="text-xs text-slate-600 mb-5 leading-relaxed">
                    <strong className="text-slate-800">Why Now?</strong> {opp.whyNowSummary}
                  </div>

                  {/* D-M-W Metric Gauges */}
                  <div className="grid grid-cols-3 gap-3 mb-6 p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 text-center">
                    <div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                        <TrendingUp className="w-3 h-3 text-blue-500" />
                        <span>Demand</span>
                      </div>
                      <div className="text-sm font-bold text-blue-700 mt-1">{opp.dBand}</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                        <Sparkles className="w-3 h-3 text-emerald-500" />
                        <span>Commercial</span>
                      </div>
                      <div className="text-sm font-bold text-emerald-700 mt-1">{opp.mBand}</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                        <Zap className="w-3 h-3 text-amber-500" />
                        <span>Window</span>
                      </div>
                      <div className="text-sm font-bold text-amber-700 mt-1">{opp.wBand}</div>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  {isBuildNow || isEarlyBet ? (
                    <Link
                      href={`/opportunities/${opp.slug}/report`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>View Report</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-400">Report follows a build verdict</span>
                  )}

                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
                  >
                    <span>Inspect Decision Workspace</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
