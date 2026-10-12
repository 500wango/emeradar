'use client';

import React, { useState } from 'react';
import {
  Radio,
  Plus,
  CheckCircle2,
  Rss,
  Globe,
} from 'lucide-react';
import { AdminSourceItem } from '@emeradar/services';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';

interface SourcesClientProps {
  initialSources: AdminSourceItem[];
}

function riskTone(level: string): BadgeTone {
  if (level === 'LOW') return 'signal';
  if (level === 'HIGH') return 'danger';
  return 'warn';
}

export function SourcesClient({ initialSources }: SourcesClientProps) {
  const [sources, setSources] = useState<AdminSourceItem[]>(initialSources);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleToggle = async (sourceId: string, currentActive: boolean) => {
    // Row-level guard: block repeat/concurrent toggles while one is in flight.
    if (processingId) return;
    setProcessingId(sourceId);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle',
          sourceId,
          isActive: !currentActive,
        }),
      });

      if (!res.ok) {
        console.error('切换采集源状态失败:', res.status);
        alert('切换状态失败，请稍后重试');
        return;
      }

      // Refresh the row from server truth rather than optimistically negating
      // the (possibly stale) client value — rapid clicks used to send the same
      // target twice and leave the switch inverted.
      const listRes = await fetch('/api/v1/admin/sources');
      if (listRes.ok) {
        const listData = await listRes.json();
        setSources(listData.sources);
      }
    } catch (err: any) {
      console.error('切换采集源状态时发生网络错误:', err);
      alert('网络错误，请稍后重试');
    } finally {
      setProcessingId(null);
    }
  };

  const handleAddRss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    setSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch('/api/v1/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          name: name.trim(),
          url: url.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSources((prev) => [...prev, data.source]);
        setName('');
        setUrl('');
        setMessage(`已成功添加 RSS 采集源：「${data.source.name}」！`);
      } else {
        const err = await res.json();
        console.error('添加采集源失败:', err);
        alert('添加采集源失败，请稍后重试');
      }
    } catch (err: any) {
      console.error('添加采集源时发生网络错误:', err);
      alert('网络错误，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-fg">
          <Radio className="h-6 w-6 text-warn" />
          <span>采集源与 RSS 监控配置</span>
        </h1>
        <p className="mt-1 font-mono text-xs text-fg-subtle">
          Configure Autonomous Discovery Channels &amp; Target RSS Feeds
        </p>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-sm border border-signal/40 bg-signal/10 p-4 text-xs font-semibold text-signal">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Add New RSS Source Form */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-fg">
          <Plus className="h-4 w-4 text-warn" />
          <span>新增独立开发者 / 技术生态 RSS 监控源</span>
        </h2>
        <p className="mb-6 text-xs text-fg-muted">
          添加外部讨论源后，雷达每日执行 `discover` 时将自动抓取该源的最新文章并派生搜索意图。
        </p>

        <form onSubmit={handleAddRss} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="source-name" className="mb-1.5 block text-[11px] font-semibold text-fg-subtle">
              监控源名称
            </label>
            <Input
              id="source-name"
              name="name"
              autoComplete="off"
              type="text"
              placeholder="如：Indie Hackers Tech / Substack"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="source-url" className="mb-1.5 block text-[11px] font-semibold text-fg-subtle">
              RSS Feed URL
            </label>
            <div className="flex gap-2">
              <Input
                id="source-url"
                name="url"
                autoComplete="url"
                type="url"
                placeholder="https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="flex-1 font-mono"
              />
              <Button type="submit" size="sm" disabled={submitting} className="shrink-0">
                {submitting ? '添加中...' : '确认添加'}
              </Button>
            </div>
          </div>
        </form>
      </Panel>

      {/* Sources List */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-fg">
          <Globe className="h-4 w-4 text-accent" />
          <span>系统采集源清单 ({sources.length})</span>
        </h2>

        <div className="divide-y divide-line">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-center"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2 text-fg-muted">
                  {s.type === 'DISCOVERY' ? (
                    <Rss className="h-4 w-4 text-warn" />
                  ) : (
                    <Radio className="h-4 w-4 text-accent" />
                  )}
                </div>
                {/* min-w-0 + flex-wrap：名字旁边挂着两枚 nowrap 徽章，下面还有一行
                    可能很长的 mono URL；不放开收缩与换行，375 下整页横向滚出 37px。 */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-fg">{s.name}</span>
                    <Badge tone="neutral">{s.type}</Badge>
                    <Badge tone={riskTone(s.tosRiskLevel)}>Risk: {s.tosRiskLevel}</Badge>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-fg-subtle">
                    ID: {s.id}
                    {s.config?.url && ` · ${s.config.url}`}
                  </p>
                </div>
              </div>

              {/* Toggle Switch */}
              <div className="flex items-center gap-3 self-end sm:self-center">
                <span
                  className={`font-mono text-xs font-semibold ${
                    s.isActive ? 'text-signal' : 'text-fg-subtle'
                  }`}
                >
                  {s.isActive ? '已激活' : '已暂停'}
                </span>
                <button
                  type="button"
                  aria-label={s.isActive ? `暂停 ${s.name}` : `激活 ${s.name}`}
                  aria-pressed={s.isActive}
                  onClick={() => handleToggle(s.id, s.isActive)}
                  disabled={processingId === s.id}
                  className={`relative h-6 w-11 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    s.isActive ? 'border-signal bg-signal' : 'border-line-control bg-surface-2'
                  }`}
                >
                  <span
                    className={`block h-4 w-4 rounded-full bg-solid transition-transform ${
                      s.isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
