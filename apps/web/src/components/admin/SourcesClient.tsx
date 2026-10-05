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

interface SourcesClientProps {
  initialSources: AdminSourceItem[];
}

export function SourcesClient({ initialSources }: SourcesClientProps) {
  const [sources, setSources] = useState<AdminSourceItem[]>(initialSources);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleToggle = async (sourceId: string, currentActive: boolean) => {
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

      if (res.ok) {
        setSources((prev) =>
          prev.map((s) => (s.id === sourceId ? { ...s, isActive: !currentActive } : s))
        );
      } else {
        alert('切换状态失败');
      }
    } catch (err: any) {
      alert(`网络错误: ${err.message}`);
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
        alert(`添加失败: ${err.error || '未知错误'}`);
      }
    } catch (err: any) {
      alert(`网络错误: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
          <Radio className="w-6 h-6 text-amber-400" />
          <span>采集源与 RSS 监控配置</span>
        </h1>
        <p className="mt-1 text-xs text-slate-400 font-mono">
          Configure Autonomous Discovery Channels & Target RSS Feeds
        </p>
      </div>

      {message && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Add New RSS Source Form */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-3xl p-6 sm:p-8">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-2">
          <Plus className="w-4 h-4 text-amber-400" />
          <span>新增独立开发者 / 技术生态 RSS 监控源</span>
        </h2>
        <p className="text-xs text-slate-400 mb-6">
          添加外部讨论源后，雷达每日执行 `discover` 时将自动抓取该源的最新文章并派生搜索意图。
        </p>

        <form onSubmit={handleAddRss} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
              监控源名称
            </label>
            <input
              type="text"
              placeholder="如：Indie Hackers Tech / Substack"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
              RSS Feed URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
              />
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition disabled:opacity-50 shrink-0"
              >
                {submitting ? '添加中...' : '确认添加'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Sources List */}
      <div className="bg-slate-800/40 border border-slate-800 rounded-3xl p-6 sm:p-8">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4">
          <Globe className="w-4 h-4 text-blue-400" />
          <span>系统采集源清单 ({sources.length})</span>
        </h2>

        <div className="divide-y divide-slate-800">
          {sources.map((s) => (
            <div
              key={s.id}
              className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-0.5">
                  {s.type === 'DISCOVERY' ? (
                    <Rss className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Radio className="w-4 h-4 text-blue-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{s.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400 font-mono">
                      {s.type}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-400 font-mono">
                      Risk: {s.tosRiskLevel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-1">
                    ID: {s.id}
                    {s.config?.url && ` · ${s.config.url}`}
                  </p>
                </div>
              </div>

              {/* Toggle Switch */}
              <div className="flex items-center gap-3 self-end sm:self-center">
                <span
                  className={`text-xs font-mono font-semibold ${
                    s.isActive ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {s.isActive ? '已激活' : '已暂停'}
                </span>
                <button
                  onClick={() => handleToggle(s.id, s.isActive)}
                  className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none ${
                    s.isActive ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      s.isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
