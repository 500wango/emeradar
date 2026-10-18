'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, AlertCircle, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';
import { VerdictBadge, Badge, type Verdict } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

interface LiveScanModalProps {
  onScanSuccess?: (slug: string) => void;
  showQuickChips?: boolean;
}

export function LiveScanner({ onScanSuccess, showQuickChips = false }: LiveScanModalProps = {}) {
  const router = useRouter();
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any | null>(null);

  const handleScan = async (targetQuery?: string) => {
    const q = (targetQuery || query).trim();
    if (!q || q.length < 2) {
      setError(t('liveScanner.errorMinChars'));
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
        throw new Error(data.detail || data.title || t('liveScanner.scanFailed'));
      }

      setScanResult(data.opportunity);
      // 结果里带的是真实 slug（v3.1 没有任何打码投影），可以安全回调给"跳到这条机会"。
      if (onScanSuccess) onScanSuccess(data.opportunity.slug);
    } catch (err: any) {
      setError(err.message || t('liveScanner.scanError'));
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
        className={cn(
          'relative flex items-center rounded-sm border bg-surface transition-colors',
          isScanning
            ? 'border-accent ring-4 ring-accent/10'
            : 'border-line-control hover:border-accent/60 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10'
        )}
      >
        <label htmlFor="live-scan-query" className="pl-4 sm:pl-5 pr-2 text-fg-subtle">
          <Search aria-hidden="true" className="w-5 h-5 text-accent" />
          <span className="sr-only">{t('liveScanner.queryLabel')}</span>
        </label>
        <input
          id="live-scan-query"
          name="query"
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isScanning}
          placeholder={t('liveScanner.placeholder')}
          aria-describedby="live-scan-error"
          className="w-full py-3.5 sm:py-4 px-2 text-sm sm:text-base text-fg placeholder:text-fg-subtle bg-transparent focus:outline-none disabled:opacity-50"
        />
        <div className="pr-2 sm:pr-3 shrink-0">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isScanning || !query.trim()}
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>
              {isScanning ? t('liveScanner.scanning') : t('liveScanner.observe')}
            </span>
          </Button>
        </div>
      </form>

      {showQuickChips && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-fg-subtle font-medium">{t('liveScanner.quickTests')}</span>
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
              className="px-2.5 py-1 rounded-sm border border-line bg-surface-2 hover:border-accent/50 hover:text-accent text-fg-muted transition-colors font-mono text-[11px] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {kw}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          id="live-scan-error"
          className="mt-4 p-4 rounded-sm bg-danger/10 border border-danger/40 text-danger text-xs flex items-center gap-2"
          role="alert"
          aria-live="polite"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {scanResult && (
        <Panel className="mt-5 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <VerdictBadge verdict={scanResult.verdict as Verdict} />
                <Badge tone="neutral">
                  {scanResult.isNew
                    ? t('liveScanner.storedFromObservation')
                    : t('liveScanner.alreadyOnFile')}
                </Badge>
              </div>
              <h3 className="mt-2 text-lg font-bold text-fg">{scanResult.title}</h3>
              <p className="mt-0.5 font-mono text-xs text-fg-subtle">
                {t('liveScanner.primaryQuery')}
                {scanResult.primaryQuery}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              onClick={() => router.push(`/opportunities/${scanResult.slug}`)}
              className="self-start sm:self-auto"
            >
              <span>{t('liveScanner.openRecord')}</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
          <p className="mt-4 font-mono text-xs text-fg-muted">
            D {scanResult.dBand} · M {scanResult.mBand} · W {scanResult.wBand} · {scanResult.confidence}
          </p>
          <p className="mt-2 text-xs text-fg-muted">{scanResult.whyNowSummary}</p>
        </Panel>
      )}
    </div>
  );
}
