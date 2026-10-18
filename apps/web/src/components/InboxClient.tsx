'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Inbox, Lightbulb, ArrowRight, CheckCircle2, XCircle, Bookmark, Ban, Hammer } from 'lucide-react';
import type { InboxItem, InboxResponse } from '@emeradar/services';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { PageFrame } from '@/components/ui/PageFrame';

type FeedbackReason = 'INTERESTED' | 'SAVED' | 'NOT_OPPORTUNITY' | 'ALREADY_BUILT' | 'CANNOT_BUILD';

interface InboxClientProps {
  initialData: InboxResponse;
}

export function InboxClient({ initialData }: InboxClientProps) {
  const { isZh } = useI18n();
  const [items, setItems] = useState<InboxItem[]>(initialData.items);
  const [pending, setPending] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (item: InboxItem, reason: FeedbackReason) => {
    if (pending) return;
    setPending(item.opportunityId);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/opportunities/${item.opportunityId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setMessage(isZh ? '反馈提交失败，请稍后重试。' : 'Could not record feedback. Try again.');
        return;
      }
      if (reason === 'INTERESTED' || reason === 'SAVED') {
        setSaved((prev) => new Set(prev).add(item.opportunityId));
        setMessage(
          reason === 'SAVED'
            ? isZh ? '已收藏。' : 'Saved.'
            : isZh ? '已记录为感兴趣，后续会优先展示。' : 'Marked as interested.'
        );
      } else {
        setItems((prev) => prev.filter((row) => row.opportunityId !== item.opportunityId));
        setMessage(isZh ? '已移除这类信号。' : 'Signal dismissed.');
      }
    } catch {
      setMessage(isZh ? '网络错误，请稍后重试。' : 'Network error. Try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <PageFrame width="full">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            {isZh ? '早期信号' : 'Early signals'}
          </p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-3xl font-bold tracking-tight text-fg">
            <Inbox className="h-7 w-7 text-warn" />
            {isZh ? '机会收件箱' : 'Opportunity Inbox'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
            {isZh
              ? '这里不是已发布裁决，而是值得你继续看的早期信号。先判断“要不要深挖”，再决定是否进入证据/裁决流程。'
              : 'These are early signals, not published verdicts. Decide whether to dig in before spending time on full evidence.'}
          </p>
        </div>
        <Link
          href="/scan"
          className="inline-flex items-center gap-2 rounded-full border border-line-control px-4 py-2 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {isZh ? '用自己的词扫描' : 'Scan your own query'}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {!initialData.isPaid && (
        <div className="mb-6 rounded-sm border border-warn/40 bg-warn/10 p-4 text-xs leading-relaxed text-fg-muted">
          <strong className="text-warn">{isZh ? 'Free 层：' : 'Free tier: '}</strong>
          {isZh
            ? `每周展示 ${initialData.freeQuota ?? 3} 条早期信号。升级后可看更多候选、自定义雷达和提醒。`
            : `${initialData.freeQuota ?? 3} early signals are shown for free. Upgrade for more candidates, custom radars and alerts.`}
        </div>
      )}

      {message && (
        <div className="mb-6 flex items-center gap-2 rounded-sm border border-signal/40 bg-signal/10 p-3 text-xs font-semibold text-signal">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {message}
        </div>
      )}

      {items.length === 0 ? (
        <Panel tone="raised" className="p-8 text-center">
          <Lightbulb className="mx-auto h-8 w-8 text-fg-subtle" />
          <p className="mt-3 text-sm font-semibold text-fg">
            {isZh ? '今天没有新的早期信号。' : 'No fresh early signals today.'}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            {isZh
              ? '系统仍在后台扫描。你也可以用自己的词手动扫描，或查看决策流里的已观测机会。'
              : 'The scanner keeps running. Try a manual query or browse the live feed.'}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/scan">
              <Button size="sm" variant="outline">{isZh ? '手动扫描' : 'Scan manually'}</Button>
            </Link>
            <Link href="/feed">
              <Button size="sm" variant="ghost">{isZh ? '查看决策流' : 'Browse feed'}</Button>
            </Link>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <Panel key={item.opportunityId} tone="raised" className="flex flex-col p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn">{item.stage}</Badge>
                {item.discoverySource && <Badge tone="neutral">{item.discoverySource}</Badge>}
                <Badge tone="neutral">{item.marketCountry} · {item.researchLanguage}</Badge>
                {item.observationDays > 0 && (
                  <Badge tone="info">{item.observationDays}d</Badge>
                )}
              </div>

              <h2 className="mt-3 text-lg font-bold leading-snug text-fg">{item.title}</h2>
              {item.primaryQuery && (
                <p className="mt-1 font-mono text-xs text-fg-muted">{item.primaryQuery}</p>
              )}
              {item.candidateReason && (
                <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-fg-muted">
                  {item.candidateReason}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-fg-subtle">
                <span>{isZh ? `${item.evidence.weakResultCount} 个弱页` : `${item.evidence.weakResultCount} weak pages`}</span>
                <span>{isZh ? `${item.evidence.pricedDomains.length} 个已定价` : `${item.evidence.pricedDomains.length} priced`}</span>
                <span>{isZh ? `${item.evidence.observationDays} 天观测` : `${item.evidence.observationDays}d observed`}</span>
              </div>
              {item.evidence.weakResults.length > 0 && (
                <p className="mt-1 line-clamp-2 break-all font-mono text-[11px] text-fg-subtle">
                  {item.evidence.weakResults
                    .slice(0, 2)
                    .map((result) => result.domain)
                    .join(' · ')}
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <Button
                  size="sm"
                  variant={saved.has(item.opportunityId) ? 'secondary' : 'primary'}
                  disabled={pending === item.opportunityId || saved.has(item.opportunityId)}
                  onClick={() => submit(item, 'INTERESTED')}
                >
                  {saved.has(item.opportunityId) ? (isZh ? '已感兴趣' : 'Interested') : (isZh ? '感兴趣' : 'Interested')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending === item.opportunityId || saved.has(item.opportunityId)}
                  onClick={() => submit(item, 'SAVED')}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  {isZh ? '收藏' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending === item.opportunityId}
                  onClick={() => submit(item, 'ALREADY_BUILT')}
                >
                  <Ban className="h-3.5 w-3.5" />
                  {isZh ? '已有人做' : 'Already built'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending === item.opportunityId}
                  onClick={() => submit(item, 'CANNOT_BUILD')}
                >
                  <Hammer className="h-3.5 w-3.5" />
                  {isZh ? '做不了' : 'Cannot build'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending === item.opportunityId}
                  onClick={() => submit(item, 'NOT_OPPORTUNITY')}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  {isZh ? '不是机会' : 'Not an opportunity'}
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </PageFrame>
  );
}
