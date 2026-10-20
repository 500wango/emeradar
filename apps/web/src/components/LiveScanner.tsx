'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, AlertCircle, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';
import { VerdictBadge, Badge, type Verdict } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { ScanVerdictResult, TrendsResult } from '@emeradar/services';

interface LiveScanModalProps {
  onScanSuccess?: (slug: string) => void;
  showQuickChips?: boolean;
  /** Pro 起可把扫描结果加入 7 天雷达。 */
  canTrackRadar?: boolean;
}

type RadarState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; until: string }
  | { status: 'error'; message?: string };

/**
 * 观测卡：扫码当天就能看到的真实事实。
 *
 * 它**不是裁决**。界面必须把这句话写在最显眼的位置——否则用户会把“Top10 有 4 个弱页”
 * 读成“建议现在做”，而后者需要 14 天历史。
 */
/** 三态判断的视觉权重：做 = 绿，不做 = 红，还不行 = 灰。 */
const VERDICT_STYLE: Record<string, { border: string; badge: 'signal' | 'danger' | 'neutral'; icon: string }> = {
  BUILD: { border: 'border-signal/40 bg-signal/5', badge: 'signal', icon: '✓' },
  DO_NOT_BUILD: { border: 'border-danger/30 bg-danger/5', badge: 'danger', icon: '✕' },
  NOT_YET: { border: 'border-line bg-surface', badge: 'neutral', icon: '·' },
};

/**
 * 扫码主输出：**一个判断 + 最多三条依据 + 该做什么**。
 *
 * 刻意不展示 Top10 列表、页面种类、位置数、联想词——那些是依据的原料，
 * 不是给用户看的内容。用户要的是“能不能做”。
 */
function ScanVerdictBlock({
  result,
  trends,
  isZh,
}: {
  result: ScanVerdictResult;
  trends: TrendsResult | null;
  isZh: boolean;
}) {
  const style = VERDICT_STYLE[result.verdict] ?? VERDICT_STYLE.NOT_YET;

  return (
    <div className={`mt-5 rounded-sm border p-5 ${style.border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={style.badge} size="sm">
          {result.verdict}
        </Badge>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
          {isZh ? '判断' : 'VERDICT'}
        </span>
      </div>

      <h3 className="mt-2 text-lg font-bold leading-snug text-fg">{result.headline}</h3>

      <ul className="mt-3 space-y-1.5">
        {result.reasons.slice(0, 3).map((reason, index) => (
          <li key={`${reason.kind}-${index}`} className="flex items-start gap-2 text-xs leading-relaxed text-fg-muted">
            <span className="mt-[2px] shrink-0 font-mono text-fg-subtle">—</span>
            <span>{reason.text}</span>
          </li>
        ))}
      </ul>

      {trends && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-fg-muted">
          <span className="text-fg-subtle">{isZh ? 'Google Trends' : 'Google Trends'}</span>
          {(['ninetyDays', 'twelveMonths'] as const).map((key) => {
            const series = trends[key];
            const label = key === 'ninetyDays' ? (isZh ? '90 天' : '90d') : isZh ? '12 个月' : '12m';
            if (!series || series.average === null) {
              return <span key={key}>{label} 无数据</span>;
            }
            const dir = series.change === null ? '·' : series.change > 0.1 ? '↑' : series.change < -0.1 ? '↓' : '→';
            return (
              <span key={key} className={series.change && series.change > 0.1 ? 'text-signal' : series.change && series.change < -0.1 ? 'text-warn' : ''}>
                {label} {series.average} {dir}
                {series.change === null ? '' : ` ${(series.change * 100).toFixed(0)}%`}
              </span>
            );
          })}
        </div>
      )}

      {result.angle && (
        <p className="mt-3 text-xs leading-relaxed text-fg">
          <span className="font-semibold">{isZh ? '怎么切：' : 'Angle: '}</span>
          {result.angle}
        </p>
      )}

      {result.needs && (
        <p className="mt-3 text-xs leading-relaxed text-fg-muted">
          <span className="font-semibold text-fg">{isZh ? '还缺什么：' : 'Still missing: '}</span>
          {result.needs}
        </p>
      )}

      {result.alternatives.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
            {isZh ? '换个方向看这些词' : 'Look at these instead'}
          </p>
          <ul className="mt-1.5 space-y-1">
            {result.alternatives.map((alt) => (
              <li key={alt.query} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="font-mono text-accent">{alt.query}</span>
                <span className="text-fg-subtle">{alt.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function LiveScanner({ onScanSuccess, showQuickChips = false, canTrackRadar = false }: LiveScanModalProps = {}) {
  const router = useRouter();
  const { t, isZh } = useI18n();
  const [query, setQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [radar, setRadar] = useState<RadarState>({ status: 'idle' });

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
      setRadar({ status: 'idle' });

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

  const trackRadar = async () => {
    if (!scanResult) return;
    setRadar({ status: 'saving' });
    try {
      const res = await fetch('/api/v1/custom-queries/radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId: scanResult.opportunityId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRadar({ status: 'error', message: data.detail || data.title });
        return;
      }
      setRadar({ status: 'saved', until: data.expiresAt });
    } catch {
      setRadar({ status: 'error' });
    }
  };

  const actionable = scanResult?.verdict === 'BUILD_NOW' || scanResult?.verdict === 'EARLY_BET';

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
            {scanResult.status === 'TRACKED' ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => router.push(`/opportunities/${scanResult.slug}`)}
                className="self-start sm:self-auto"
              >
                <span>{t('liveScanner.openRecord')}</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : null}
          </div>
          <p className="mt-4 font-mono text-xs text-fg-muted">
            D {scanResult.dBand} · M {scanResult.mBand} · W {scanResult.wBand} · {scanResult.confidence}
          </p>
          <p className="mt-2 text-xs text-fg-muted">{scanResult.whyNowSummary}</p>

          <ScanVerdictBlock
            result={scanResult.verdictFit}
            trends={scanResult.observation?.trends ?? null}
            isZh={isZh}
          />

          <div className="mt-4 border-t border-line pt-4 text-xs">
            {actionable ? (
              <p className="text-fg-subtle">{t('liveScanner.radarNotNeeded')}</p>
            ) : !canTrackRadar ? (
              <p className="text-fg-subtle">
                {t('liveScanner.radarUpgrade')}{' '}
                <button
                  type="button"
                  onClick={() => router.push('/pricing')}
                  className="font-semibold text-accent hover:underline"
                >
                  {t('liveScanner.radarUpgradeCta')} →
                </button>
              </p>
            ) : radar.status === 'saved' ? (
              <p className="text-signal" role="status">
                {t('liveScanner.radarSaved', {
                  date: new Date(radar.until).toLocaleDateString(),
                })}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={trackRadar}
                  disabled={radar.status === 'saving'}
                >
                  {radar.status === 'saving' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  <span>{radar.status === 'saving' ? t('liveScanner.radarSaving') : t('liveScanner.trackRadar')}</span>
                </Button>
                {radar.status === 'error' && (
                  <span className="text-danger" role="alert">
                    {radar.message || t('liveScanner.radarFailed')}
                  </span>
                )}
              </div>
            )}
            {scanResult.status === 'CANDIDATE' && (
              <p className="mt-2 text-fg-subtle">{t('liveScanner.candidateNote')}</p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
