'use client';

import React, { useState } from 'react';
import {
  Layers,
  Search,
  Trash2,
  Rocket,
  CheckCircle2,
  Clock,
  RotateCw,
} from 'lucide-react';
import { AdminCandidateItem } from '@emeradar/services';

interface CandidatesClientProps {
  initialItems: AdminCandidateItem[];
  total: number;
}

export function CandidatesClient({ initialItems, total: initialTotal }: CandidatesClientProps) {
  const [candidates, setCandidates] = useState<AdminCandidateItem[]>(initialItems);
  const [total, setTotal] = useState<number>(initialTotal);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchCandidates = async (searchQuery = search) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/candidates?search=${encodeURIComponent(searchQuery)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.items);
        setTotal(data.total);
      }
    } catch (err) {
      console.error('Failed to fetch candidates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleModerate = async (opportunityId: string, action: 'ARCHIVE' | 'PROMOTE_TO_TRACKED', title: string) => {
    setProcessingId(opportunityId);
    setActionMessage(null);

    try {
      const res = await fetch('/api/v1/admin/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId, action }),
      });

      if (res.ok) {
        // Remove from list or update
        setCandidates((prev) => prev.filter((item) => item.id !== opportunityId));
        setTotal((prev) => Math.max(0, prev - 1));
        setActionMessage(
          action === 'ARCHIVE'
            ? `已成功废弃并归档生态位：「${title}」`
            : `已提前批准并发布至前台 Feed：「${title}」！`
        );
      } else {
        const err = await res.json();
        alert(`操作失败: ${err.error || '未知错误'}`);
      }
    } catch (err: any) {
      alert(`网络错误: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-emerald-400" />
            <span>候选生态位池治理 (Candidate Pool)</span>
          </h1>
          <p className="mt-1 text-xs text-slate-400 font-mono">
            {total} items in observation pool · Filter out noise & promote high-potential niches
          </p>
        </div>

        <button
          onClick={() => fetchCandidates()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新列表</span>
        </button>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchCandidates(search);
          }}
          className="flex gap-3"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索候选标题、长尾关键词..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shrink-0"
          >
            筛选
          </button>
        </form>
      </div>

      {/* Candidate List */}
      {candidates.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-800 rounded-3xl p-12 text-center">
          <Layers className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">未找到符合条件的候选机会</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {candidates.map((cand) => {
            const isProcessing = processingId === cand.id;
            return (
              <div
                key={cand.id}
                className="bg-slate-800/50 border border-slate-700/70 hover:border-slate-600 rounded-2xl p-5 flex flex-col justify-between transition shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">
                      {cand.discoverySource || 'SNIFFER'}
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>已观察 {cand.observationDays} 天</span>
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-white leading-snug">
                    {cand.title}
                  </h3>
                  <p className="text-xs text-blue-400 font-mono mt-1">
                    `{cand.primaryQuery}`
                  </p>

                  {cand.candidateReason && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 leading-relaxed">
                      <span className="font-semibold text-slate-400 block mb-0.5">
                        💡 发现理由 / 意图背景:
                      </span>
                      {cand.candidateReason}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 text-[10px] font-mono text-slate-400">
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                      形态: {cand.recommendedArchetype}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                      规模: {cand.executionClass}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                      地区: {cand.marketCountry}
                    </span>
                  </div>
                </div>

                {/* Moderation Actions */}
                <div className="mt-5 pt-3 border-t border-slate-700/60 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleModerate(cand.id, 'ARCHIVE', cand.title)}
                    disabled={isProcessing}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>废弃归档</span>
                  </button>

                  <button
                    onClick={() => handleModerate(cand.id, 'PROMOTE_TO_TRACKED', cand.title)}
                    disabled={isProcessing}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-sm transition disabled:opacity-50"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    <span>提前批准发布至 Feed</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
