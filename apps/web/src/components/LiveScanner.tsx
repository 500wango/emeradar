'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, AlertCircle, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';
import { VerdictBadge, Badge, type Verdict } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { ObservationCard } from '@emeradar/services';

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
function ObservationPanel({ card, isZh }: { card: ObservationCard; isZh: boolean }) {
  const serp = card.serp;
  const pricing = card.pricing;

  const statusLabel = (status: string) => {
    if (status === 'OK') return isZh ? '抓到公开定价' : 'Public pricing found';
    if (status === 'NOT_FOUND') return isZh ? '看过了，没有公开定价' : 'Read, no public pricing';
    if (status === 'ROBOTS') return isZh ? 'robots 拒绝抓取' : 'robots.txt disallowed';
    return isZh ? '抓取被拦截，未知' : 'Blocked — unknown';
  };

  const statusTone = (status: string) =>
    status === 'OK' ? 'signal' : status === 'NOT_FOUND' ? 'warn' : 'danger';

  return (
    <div className="mt-6 rounded-sm border border-line bg-surface-2/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-sm border border-info/40 bg-info/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-info">
            {isZh ? '观测 · 非建议' : 'OBSERVATION · NOT A VERDICT'}
          </span>
          <span className="font-mono text-[11px] text-fg-subtle">
            {card.market} · {card.language}
          </span>
        </div>
        <span className="font-mono text-[11px] text-fg-subtle">
          {isZh ? '数据来自' : 'observed'} {String(card.observedAt).slice(0, 10)}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-fg-muted">
        {isZh
          ? `这是现在能看到的事实，不是构建建议。${card.verdictEta.reason}`
          : `What is observable right now, not a build recommendation. ${card.verdictEta.reason}`}
      </p>

      {/* SERP 弱点 */}
      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-xs font-bold text-fg">
            {isZh ? 'Google Top 10 竞争面' : 'Google Top 10 competition'}
          </h4>
          {serp.available ? (
            <span className="font-mono text-[11px] text-fg-subtle">
              {isZh
                ? `${serp.weakCount}/${serp.items.length} 个弱页 · 弱点率 ${Math.round(serp.weakRatio * 100)}%`
                : `${serp.weakCount}/${serp.items.length} weak · ${Math.round(serp.weakRatio * 100)}%`}
              {serp.provider ? ` · ${serp.provider}` : ''}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-danger">
              {isZh ? '未知（未取到 SERP）' : 'unknown (no SERP)'}
            </span>
          )}
        </div>

        {!serp.available ? (
          <p className="mt-1 text-[11px] text-fg-subtle">{serp.note}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {serp.items.map((item) => (
              <li key={`${item.rank}-${item.url}`} className="flex items-start gap-2 text-[11px]">
                <span className="w-5 shrink-0 font-mono text-fg-subtle">{item.rank}</span>
                <span className="min-w-0 flex-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-accent hover:underline"
                  >
                    {item.domain}
                  </a>
                  <span className="ml-2 text-fg-subtle">{item.resultType}</span>
                  {item.isWeak && (
                    <Badge tone="warn" size="sm" className="ml-2">
                      {item.weaknessType ?? (isZh ? '弱页' : 'weak')}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 定价 */}
      <div className="mt-5 border-t border-line pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-xs font-bold text-fg">
            {isZh ? '前排站点公开定价' : 'Public pricing on competitors'}
          </h4>
          <span className="font-mono text-[11px] text-fg-subtle">
            {isZh
              ? `探查 ${pricing.probed} · 有价 ${pricing.priced} · 仅网关 ${pricing.infraOnly} · 未知 ${pricing.blocked}`
              : `${pricing.probed} probed · ${pricing.priced} priced · ${pricing.infraOnly} gateway-only · ${pricing.blocked} unknown`}
          </span>
        </div>

        {pricing.domains.length === 0 ? (
          <p className="mt-1 text-[11px] text-fg-subtle">{pricing.note}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {pricing.domains.map((row) => (
              <li key={row.domain} className="flex flex-wrap items-center gap-2 text-[11px]">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-accent hover:underline"
                >
                  {row.domain}
                </a>
                <Badge tone={statusTone(row.status)} size="sm">
                  {statusLabel(row.status)}
                </Badge>
                {row.plans.length > 0 && (
                  <span className="text-fg-muted">
                    {row.plans
                      .slice(0, 3)
                      .map((plan) => `${plan.name} ${plan.currency}${plan.priceMonthly ?? '?'}`)
                      .join(' · ')}
                  </span>
                )}
                {row.plans.length === 0 && row.gateways.length > 0 && (
                  <span className="text-fg-subtle">{row.gateways.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-fg-subtle">{pricing.note}</p>
      </div>

      {/* 联想词 */}
      <div className="mt-5 border-t border-line pt-4">
        <h4 className="text-xs font-bold text-fg">
          {isZh ? '实时联想词' : 'Live autocomplete'}
        </h4>
        {card.autocomplete.observed ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.autocomplete.suggestions.slice(0, 12).map((suggestion) => (
              <span
                key={suggestion}
                className="rounded-sm border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-muted"
              >
                {suggestion}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-fg-subtle">{card.autocomplete.note}</p>
        )}
      </div>

      {/* 还缺什么 */}
      <div className="mt-5 rounded-sm border border-warn/30 bg-warn/5 p-3">
        <p className="text-[11px] leading-relaxed text-fg-muted">
          {isZh
            ? `还差什么才能给裁决：联想词需 ${card.verdictEta.needsAutocompleteDays} 天历史，SERP 需 ${card.verdictEta.needsSerpDays} 天历史。现在这张卡是观测，不是推荐。`
            : `What still gates a verdict: ${card.verdictEta.needsAutocompleteDays} days of autocomplete and ${card.verdictEta.needsSerpDays} days of SERP history. This card is observation, not recommendation.`}
        </p>
      </div>
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

          {scanResult.observation && <ObservationPanel card={scanResult.observation} isZh={isZh} />}

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
