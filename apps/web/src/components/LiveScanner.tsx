'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, AlertCircle, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface LiveScanModalProps {
  onScanSuccess?: (slug: string) => void;
  showQuickChips?: boolean;
}

export function LiveScanner({ onScanSuccess, showQuickChips = false }: LiveScanModalProps = {}) {
  const router = useRouter();
  const { isZh } = useI18n();
  const [query, setQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any | null>(null);

  const handleScan = async (targetQuery?: string) => {
    const q = (targetQuery || query).trim();
    if (!q || q.length < 2) {
      setError(isZh ? '请输入至少包含 2 个字符的搜索关键词' : 'Please enter a keyword of at least 2 characters');
      return;
    }

    try {
      setIsScanning(true);
      setError(null);
      setScanResult(null);

      const res = await fetch('/api/v1/opportunities/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.title || (isZh ? '扫描失败' : 'Live scan failed'));
      }

      setScanResult(data.opportunity);
      if (onScanSuccess) onScanSuccess(data.opportunity.slug);
    } catch (err: any) {
      setError(err.message || (isZh ? '扫描过程中发生错误。' : 'An error occurred during scanning.'));
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleScan();
        }}
        className={`relative flex items-center shadow-lg shadow-slate-200/50 rounded-2xl border transition-all ${
          isScanning
            ? 'border-blue-500 ring-4 ring-blue-500/10 bg-white'
            : 'border-slate-300 hover:border-slate-400 bg-white focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-500/10'
        }`}
      >
        <div className="pl-4 sm:pl-5 pr-2 text-slate-400">
          <Search className="w-5 h-5 text-blue-600" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isScanning}
          placeholder={isZh ? '输入关键词开始观测。初次观测绝非裁决。' : 'Observe a query. One observation is not a verdict.'}
          className="w-full py-3.5 sm:py-4 px-2 text-sm sm:text-base text-slate-900 placeholder-slate-400 bg-transparent focus:outline-none disabled:opacity-50"
        />
        <div className="pr-2 sm:pr-3 shrink-0">
          <button
            type="submit"
            disabled={isScanning || !query.trim()}
            className="px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl font-semibold text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>{isScanning ? (isZh ? '正在观测' : 'Observing') : (isZh ? '开启观测' : 'Observe')}</span>
          </button>
        </div>
      </form>

      {showQuickChips && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">
            {isZh ? '热门生态位实时测验:' : 'Quick niche tests:'}
          </span>
          {[
            'freelance invoice generator',
            'cron job monitor',
            'pdf watermark api',
            'podcast transcript seo',
          ].map((kw) => (
            <button
              key={kw}
              type="button"
              onClick={() => {
                setQuery(kw);
                handleScan(kw);
              }}
              disabled={isScanning}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-all font-mono text-[11px] disabled:opacity-50"
            >
              {kw}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {scanResult && (
        <div className="mt-5 p-6 rounded-2xl bg-white border border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  {String(scanResult.verdict).replaceAll('_', ' ')}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {scanResult.isNew ? (isZh ? '本次观测新入库' : 'Stored from this observation') : (isZh ? '数据库已有记录' : 'Already on file')}
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-2">{scanResult.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{isZh ? '核心查询词: ' : 'Primary query: '}{scanResult.primaryQuery}</p>
            </div>
            <button
              onClick={() => router.push(`/opportunities/${scanResult.slug}`)}
              className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-blue-600 hover:bg-blue-700 transition flex items-center gap-1.5 self-start sm:self-auto"
            >
              <span>{isZh ? '进入详情记录' : 'Open record'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-700">
            D {scanResult.dBand} · M {scanResult.mBand} · W {scanResult.wBand} · {scanResult.confidence}
          </p>
          <p className="mt-2 text-xs text-slate-600">{scanResult.whyNowSummary}</p>
        </div>
      )}
    </div>
  );
}
