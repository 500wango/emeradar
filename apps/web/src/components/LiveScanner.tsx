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
/** 价格展示：货币符号与金额必须分开，金额缺失时明确显示 ?，不拼接。 */
function formatPrice(plan: { currency?: string; priceMonthly?: number }): string {
  const symbol = typeof plan.currency === 'string' && plan.currency.length <= 3 ? plan.currency : '';
  const amount = typeof plan.priceMonthly === 'number' && Number.isFinite(plan.priceMonthly)
    ? plan.priceMonthly
    : null;
  return amount === null ? `${symbol}?` : `${symbol}${amount}`;
}

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

      {/* 意图：这个词到底是不是“想买工具”。信息型 SERP 是最容易被误读成机会的情况。 */}
      <div
        className={cn(
          'mt-3 rounded-sm border p-3',
          card.intent.intentFit === 'TOOL_INTENT'
            ? 'border-signal/30 bg-signal/5'
            : card.intent.intentFit === 'INFORMATIONAL'
            ? 'border-warn/40 bg-warn/10'
            : 'border-line bg-surface'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-fg-subtle">
            {isZh ? '意图判断' : 'INTENT'}
          </span>
          <Badge
            tone={
              card.intent.intentFit === 'TOOL_INTENT'
                ? 'signal'
                : card.intent.intentFit === 'INFORMATIONAL'
                ? 'warn'
                : 'neutral'
            }
            size="sm"
          >
            {card.intent.intentFit}
          </Badge>
          <span className="font-mono text-[11px] text-fg-subtle">
            {isZh
              ? `工具页 ${card.intent.signals.dedicatedToolPages}/${card.intent.signals.distinctDomains}`
              : `${card.intent.signals.dedicatedToolPages}/${card.intent.signals.distinctDomains} tool pages`}
            {card.intent.signals.pricedDomains > 0
              ? isZh
                ? ` · ${card.intent.signals.pricedDomains} 家在收费`
                : ` · ${card.intent.signals.pricedDomains} charging`
              : ''}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-muted">
          {card.intent.intentFit === 'INFORMATIONAL'
            ? isZh
              ? '这个词的 SERP 主要被社区帖、内容页和泛平台占据，几乎没有专属工具页——用户更可能在找“怎么做”，而不是找工具。做工具前先确认购买意图。'
              : 'This SERP is mostly UGC, content and generic platform pages with almost no dedicated tool pages — the user is likely looking for how, not for a tool. Confirm purchase intent before building.'
            : card.intent.intentFit === 'TOOL_INTENT'
            ? isZh
              ? 'SERP 里有明确的专属工具页，且通常有人在收费——这与“工具需求”一致。'
              : 'Dedicated tool pages rank here and some charge money — consistent with tool demand.'
            : isZh
              ? '证据不足以判断这是购买意图还是信息意图，继续观察。'
              : 'Not enough evidence to call this purchase or informational intent. Keep observing.'}
        </p>
      </div>

      {/* SERP 弱点 */}
      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-xs font-bold text-fg">
            {isZh
              ? `Google Top ${serp.items.length || 10} 竞争面`
              : `Google Top ${serp.items.length || 10} competition`}
          </h4>
          {serp.available ? (
            <span className="font-mono text-[11px] text-fg-subtle">
              {isZh
                ? `${serp.positions} 个位置 · ${serp.distinctDomains} 个域名 · ${serp.dedicatedToolPages} 个工具页 · ${serp.weakCount} 个弱页`
                : `${serp.positions} positions · ${serp.distinctDomains} domains · ${serp.dedicatedToolPages} tool pages · ${serp.weakCount} weak`}
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
          <p className="mt-1 text-[11px] text-fg-subtle">
            {isZh
              ? '这次没有可探查的竞品域名（SERP 缺失，或前排都是社区/平台页）。'
              : 'No competitor domain was available to probe (SERP missing, or the Top 10 is all UGC/platform pages).'}
          </p>
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
                      .map((plan) => `${plan.name} ${formatPrice(plan)}`)
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
        {pricing.domains.length > 0 && (
          <p className="mt-2 text-[11px] text-fg-subtle">
            {isZh
              ? '只记录观测到的公开定价；没有定价不等于没有付费意愿。'
              : 'Public pricing only; absence of pricing is not proof of no willingness to pay.'}
          </p>
        )}
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
