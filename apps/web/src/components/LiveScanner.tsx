'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Radar,
  Sparkles,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  Compass,
} from 'lucide-react';

const SUGGESTED_QUERIES = [
  'ai vocal isolator web',
  'deepseek cost calculator',
  'shopify bundle discount',
  'figma tokens to tailwind',
  'markdown to academic pdf',
  'screen recorder no watermark online',
];

interface LiveScanModalProps {
  onScanSuccess?: (slug: string) => void;
}

export function LiveScanner({ onScanSuccess }: LiveScanModalProps = {}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any | null>(null);

  const scanSteps = [
    'Querying Google Autocomplete long-tail intent clusters...',
    'Auditing Google SERP Top 10 competitive landscape...',
    'Detecting forum threads, content staleness & weakness signals...',
    'Calculating D-M-W basis point score & entry verdict...',
    'Assembling execution blueprint & decision workspace...',
  ];

  const handleScan = async (targetQuery?: string) => {
    const q = (targetQuery || query).trim();
    if (!q || q.length < 2) {
      setError('Please enter a keyword of at least 2 characters');
      return;
    }

    try {
      setIsScanning(true);
      setError(null);
      setScanResult(null);
      setScanStep(0);

      // Progress animation
      const stepTimer1 = setTimeout(() => setScanStep(1), 600);
      const stepTimer2 = setTimeout(() => setScanStep(2), 1300);
      const stepTimer3 = setTimeout(() => setScanStep(3), 2000);
      const stepTimer4 = setTimeout(() => setScanStep(4), 2600);

      const res = await fetch('/api/v1/opportunities/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      clearTimeout(stepTimer4);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.title || 'Live scan failed');
      }

      setScanResult(data.opportunity);

      if (onScanSuccess) {
        onScanSuccess(data.opportunity.slug);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during scanning.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleOpenWorkspace = (slug: string) => {
    router.push(`/opportunities/${slug}`);
  };

  return (
    <div className="w-full">
      {/* Search Input Box */}
      <div className="relative">
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
            placeholder="Scan any keyword, niche or competitor (e.g. 'notion habit tracker', 'invoice generator free')..."
            className="w-full py-3.5 sm:py-4 px-2 text-sm sm:text-base text-slate-900 placeholder-slate-400 bg-transparent focus:outline-none disabled:opacity-50"
          />

          <div className="pr-2 sm:pr-3 shrink-0">
            <button
              type="submit"
              disabled={isScanning || !query.trim()}
              className="px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl font-semibold text-xs sm:text-sm text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="hidden sm:inline">Scanning...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Scan Market</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Suggested keywords badges */}
        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-400 font-medium flex items-center gap-1 shrink-0">
            <Compass className="w-3.5 h-3.5 text-slate-400" />
            Try scanning:
          </span>
          {SUGGESTED_QUERIES.map((sq) => (
            <button
              key={sq}
              type="button"
              onClick={() => {
                setQuery(sq);
                handleScan(sq);
              }}
              disabled={isScanning}
              className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 font-medium transition text-[11px] disabled:opacity-50"
            >
              {sq}
            </button>
          ))}
        </div>
      </div>

      {/* Scanning In-Progress Feedback */}
      {isScanning && (
        <div className="mt-4 p-5 rounded-2xl bg-blue-50/80 border border-blue-200 text-blue-900 shadow-sm animate-pulse">
          <div className="flex items-center gap-3">
            <Radar className="w-5 h-5 text-blue-600 animate-spin" />
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Live Google Radar Scan in Progress
              </div>
              <div className="text-sm font-semibold text-slate-800 mt-0.5">
                {scanSteps[scanStep]}
              </div>
            </div>
          </div>
          <div className="w-full bg-blue-200/60 rounded-full h-1.5 mt-3 overflow-hidden">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${((scanStep + 1) / scanSteps.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Successful Scan Result Card */}
      {scanResult && (
        <div className="mt-5 p-6 rounded-2xl bg-white border border-emerald-300 shadow-xl shadow-emerald-500/5 animate-in fade-in-50 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  {scanResult.verdict.replace('_', ' ')}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {scanResult.recommendedArchetype.replace('_', ' ')}
                </span>
                {scanResult.isNew ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    Freshly Scanned
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    Verified from Catalog
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-2">{scanResult.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Primary query: "{scanResult.primaryQuery}"</p>
            </div>

            <button
              onClick={() => handleOpenWorkspace(scanResult.slug)}
              className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-blue-600 hover:bg-blue-700 transition flex items-center gap-1.5 self-start sm:self-auto shrink-0 shadow-md shadow-blue-500/20"
            >
              <span>Open Decision Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Scores Overview */}
          <div className="grid grid-cols-3 gap-3 my-4">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 block">Demand Momentum (D)</span>
              <span className="text-base font-extrabold text-blue-600">
                {Math.round(scanResult.dBasisPoints / 100)} / 100
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 block">Monetization (M)</span>
              <span className="text-base font-extrabold text-emerald-600">
                {Math.round(scanResult.mBasisPoints / 100)} / 100
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 block">SERP Weakness (W)</span>
              <span className="text-base font-extrabold text-amber-600">
                {Math.round(scanResult.wBasisPoints / 100)} / 100
              </span>
            </div>
          </div>

          <div className="text-xs text-slate-600 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <span className="font-bold text-slate-800">Why Now: </span>
            {scanResult.whyNowSummary}
          </div>
        </div>
      )}
    </div>
  );
}
