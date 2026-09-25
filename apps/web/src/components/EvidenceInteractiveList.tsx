'use client';

import React from 'react';
import { useEvidenceDrawer } from '../lib/evidence-store';
import { formatDate } from '../lib/format';

interface EvidenceItem {
  id: string;
  evidence_class: string;
  source_type: string;
  source_id?: string;
  domain?: string;
  title: string;
  snippet: string;
  payload: any;
  observed_at: string | Date;
}

export function EvidenceInteractiveList({ evidence }: { evidence: EvidenceItem[] }) {
  const { openDrawer } = useEvidenceDrawer();

  const handleOpen = (ev: EvidenceItem) => {
    openDrawer({
      id: ev.id,
      evidenceClass: ev.evidence_class,
      sourceType: ev.source_type,
      sourceId: ev.source_id || 'src_unknown',
      domain: ev.domain,
      title: ev.title,
      snippet: ev.snippet,
      payload: ev.payload || {},
      observedAt: ev.observed_at,
    });
  };

  const getBadgeStyle = (evClass: string) => {
    switch (evClass) {
      case 'OBSERVED':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'SELF_REPORTED':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'THIRD_PARTY_ESTIMATE':
        return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'INFERRED':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  if (!evidence || evidence.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 text-center">
        暂无关联证据条目
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {evidence.map((ev) => (
        <div
          key={ev.id}
          onClick={() => handleOpen(ev)}
          className="group p-4 rounded-xl bg-slate-50 hover:bg-white border border-slate-200/80 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer text-xs"
        >
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <span>{ev.domain || ev.source_type}</span>
              <span className="text-[10px] font-mono text-slate-400">
                &bull; {formatDate(ev.observed_at)}
              </span>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${getBadgeStyle(
                ev.evidence_class
              )}`}
            >
              {ev.evidence_class}
            </span>
          </div>

          <p className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
            {ev.title}
          </p>
          <p className="text-slate-600 mt-1 italic leading-relaxed line-clamp-2">
            &ldquo;{ev.snippet}&rdquo;
          </p>

          <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-mono">ID: {ev.id.slice(0, 8)}...</span>
            <span className="text-blue-600 font-semibold group-hover:underline flex items-center gap-1">
              <span>查看原始证据抽屉</span>
              <span>&rarr;</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
