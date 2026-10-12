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
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';

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
        console.error('候选审核操作失败:', err);
        alert('操作失败，请稍后重试');
      }
    } catch (err: any) {
      console.error('候选审核操作发生网络错误:', err);
      alert('网络错误，请稍后重试');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-fg">
            <Layers className="h-6 w-6 text-signal" />
            <span>候选生态位池治理 (Candidate Pool)</span>
          </h1>
          <p className="mt-1 font-mono text-xs text-fg-subtle">
            {total} items in observation pool · Filter out noise &amp; promote high-potential niches
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fetchCandidates()}
          disabled={loading}
        >
          <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新列表</span>
        </Button>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-sm border border-signal/40 bg-signal/10 p-4 text-xs font-semibold text-signal"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Search Bar */}
      <Panel tone="raised" className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchCandidates(search);
          }}
          className="flex gap-3"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <label htmlFor="candidate-search" className="sr-only">搜索候选标题或关键词</label>
            <Input
              id="candidate-search"
              name="search"
              autoComplete="off"
              type="text"
              placeholder="搜索候选标题、长尾关键词..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit" size="sm" className="shrink-0">
            筛选
          </Button>
        </form>
      </Panel>

      {/* Candidate List */}
      {candidates.length === 0 ? (
        <Panel tone="raised" className="p-12 text-center">
          <Layers className="mx-auto mb-3 h-8 w-8 text-fg-subtle" />
          <p className="text-sm text-fg-muted">未找到符合条件的候选机会</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {candidates.map((cand) => {
            const isProcessing = processingId === cand.id;
            return (
              <Panel
                key={cand.id}
                tone="raised"
                className="flex flex-col justify-between p-5 transition hover:border-accent"
              >
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge tone="neutral">{cand.discoverySource || 'SNIFFER'}</Badge>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-fg-subtle">
                      <Clock className="h-3 w-3" />
                      <span>已观察 {cand.observationDays} 天</span>
                    </div>
                  </div>

                  <h2 className="text-sm font-bold leading-snug text-fg">
                    {cand.title}
                  </h2>
                  <p className="mt-1 font-mono text-xs text-accent">
                    `{cand.primaryQuery}`
                  </p>

                  {cand.candidateReason && (
                    <div className="mt-3 rounded-sm border border-line bg-canvas p-3 text-[11px] leading-relaxed text-fg-muted">
                      <span className="mb-0.5 block font-semibold text-fg-subtle">
                        💡 发现理由 / 意图背景:
                      </span>
                      {cand.candidateReason}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 font-mono text-[10px] text-fg-subtle">
                    <span className="rounded-sm border border-line bg-surface-2 px-2 py-0.5">
                      形态: {cand.recommendedArchetype}
                    </span>
                    <span className="rounded-sm border border-line bg-surface-2 px-2 py-0.5">
                      规模: {cand.executionClass}
                    </span>
                    <span className="rounded-sm border border-line bg-surface-2 px-2 py-0.5">
                      地区: {cand.marketCountry}
                    </span>
                  </div>
                </div>

                {/* Moderation Actions */}
                <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-3">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => handleModerate(cand.id, 'ARCHIVE', cand.title)}
                    disabled={isProcessing}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>废弃归档</span>
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => handleModerate(cand.id, 'PROMOTE_TO_TRACKED', cand.title)}
                    disabled={isProcessing}
                  >
                    <Rocket className="h-3.5 w-3.5" />
                    <span>提前批准发布至 Feed</span>
                  </Button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
