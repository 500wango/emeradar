import React from 'react';
import { ExternalLink, Search, Layers, Compass } from 'lucide-react';

interface GoogleTrendsPanelProps {
  query: string;
  marketCountry?: string;
  clusterQueries?: Array<{ id: string; query_text: string; tier: string }>;
}

export function GoogleTrendsPanel({
  query,
  marketCountry = 'US',
  clusterQueries = [],
}: GoogleTrendsPanelProps) {
  const geo = marketCountry || 'US';
  const trendsExploreUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(
    query
  )}&geo=${encodeURIComponent(geo)}&date=today%2012-m`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Compass className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-slate-900">
              Trends link and stored queries
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            No Trends time series is stored. The link opens Google Trends for {geo}, past 12 months. The list below is the query cluster on file, including the primary query. It is not a live suggest capture unless an evidence row says so.
          </p>
        </div>

        <a
          href={trendsExploreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm shrink-0"
        >
          <span>Open Google Trends ({geo})</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Search className="w-3.5 h-3.5 text-blue-600" />
            <span>Queries on file</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {clusterQueries.length} stored
          </span>
        </div>

        {clusterQueries.length > 0 ? (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {clusterQueries.map((cq) => (
              <div
                key={cq.id}
                className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs hover:bg-slate-100 transition-all"
              >
                <span className="font-mono text-slate-800 truncate pr-2 text-[11px]">
                  {cq.query_text}
                </span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 shrink-0">
                  Tier {cq.tier}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-50 text-center text-xs text-slate-400">
            No related queries stored yet.
          </div>
        )}
      </div>

      <div className="mt-4 p-3 rounded-xl bg-amber-50/70 border border-amber-200/60 text-xs text-amber-800 flex items-start gap-2 leading-relaxed">
        <Layers className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          Demand is scored from repeated observations, not from this link. A missing series is left missing.
        </div>
      </div>
    </div>
  );
}
