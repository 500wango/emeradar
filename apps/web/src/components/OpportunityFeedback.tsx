'use client';

import { useState } from 'react';
import { Bookmark, CheckCircle2, ThumbsUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';

type FeedbackReason = 'INTERESTED' | 'SAVED' | 'NOT_OPPORTUNITY' | 'ALREADY_BUILT' | 'CANNOT_BUILD';

/** 机会详情上的轻量反馈：不阻断阅读，只把“值得做/做不了”沉淀下来。 */
export function OpportunityFeedback({ opportunityId }: { opportunityId: string }) {
  const { isZh } = useI18n();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<FeedbackReason | null>(null);

  const send = async (reason: FeedbackReason) => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/v1/opportunities/${opportunityId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) setDone(reason);
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <CheckCircle2 className="h-3.5 w-3.5 text-signal" />
        {isZh ? '已记录你的反馈。' : 'Feedback recorded.'}
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-subtle">
        {isZh ? '这条机会：' : 'This opportunity:'}
      </span>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => send('INTERESTED')}>
        <ThumbsUp className="h-3 w-3" />
        {isZh ? '感兴趣' : 'Interested'}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => send('SAVED')}>
        <Bookmark className="h-3 w-3" />
        {isZh ? '收藏' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => send('ALREADY_BUILT')}>
        {isZh ? '已有人做' : 'Already built'}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => send('CANNOT_BUILD')}>
        {isZh ? '做不了' : 'Cannot build'}
      </Button>
    </div>
  );
}
