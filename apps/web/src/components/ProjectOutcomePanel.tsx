'use client';

import { useState } from 'react';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import type { ProjectOutcomeCheckin, ProjectOutcomeState, ProjectOutcomeStatus } from '@emeradar/services';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

const OPTIONS: Array<{ value: ProjectOutcomeStatus; zh: string; en: string }> = [
  { value: 'BUILDING', zh: '还在做', en: 'Still building' },
  { value: 'LAUNCHED', zh: '已上线', en: 'Launched' },
  { value: 'NO_TRACTION', zh: '上线但没起色', en: 'No traction' },
  { value: 'EARLY_TRACTION', zh: '有早期起色', en: 'Early traction' },
  { value: 'TRACTION', zh: '有明确起色', en: 'Traction' },
  { value: 'ABANDONED', zh: '已放弃', en: 'Abandoned' },
];

export function ProjectOutcomePanel({
  projectId,
  initialState,
  isZh,
}: {
  projectId: string;
  initialState: ProjectOutcomeState;
  isZh: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (status: ProjectOutcomeStatus) => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      });
      if (!res.ok) {
        setMessage(isZh ? '记录失败，请稍后重试。' : 'Could not record. Try again.');
        return;
      }
      const data = (await res.json()) as { checkin: ProjectOutcomeCheckin };
      setState((prev) => ({
        ...prev,
        checkins: [data.checkin, ...prev.checkins],
        nextCheckin: null,
      }));
      setNote('');
      setMessage(isZh ? '已记录。下一次回访会自动出现。' : 'Recorded. The next check-in will appear automatically.');
    } catch {
      setMessage(isZh ? '网络错误。' : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel className="mt-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
            <CalendarClock className="h-4 w-4 text-accent" />
            {isZh ? '结果回访（T+30/60/90）' : 'Outcome check-ins (T+30/60/90)'}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            {isZh
              ? '发现是否有效，最终看项目做出来之后发生了什么。这里记录的是你的判断，不会改写机会的历史裁决。'
              : 'Whether discovery works is decided by what happens after you build. This records your assessment without rewriting the opportunity ledger.'}
          </p>
        </div>
        {state.nextCheckin ? (
          <span className="rounded-full border border-warn/40 bg-warn/10 px-3 py-1 font-mono text-[11px] font-semibold text-warn">
            T+{state.nextCheckin.horizonDays} · {isZh ? '待回访' : 'due'} {state.nextCheckin.dueDate}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-fg-subtle">{isZh ? '暂无到期回访' : 'No check-in due'}</span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={option.value === 'LAUNCHED' ? 'primary' : 'outline'}
            disabled={pending}
            onClick={() => submit(option.value)}
          >
            {isZh ? option.zh : option.en}
          </Button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder={isZh ? '可选：一句话说明结果（收入、用户、放弃原因）' : 'Optional: one line on revenue, users, or why you stopped'}
        className="mt-3 w-full rounded-sm border border-line bg-surface px-3 py-2 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
      />

      {message && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-signal">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {message}
        </p>
      )}

      {state.checkins.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
            {isZh ? '回访记录' : 'History'}
          </p>
          <ul className="mt-2 space-y-1">
            {state.checkins.slice(0, 6).map((checkin) => (
              <li key={checkin.id} className="flex flex-wrap gap-x-3 text-[11px] text-fg-muted">
                <span className="font-mono text-fg-subtle">{checkin.createdAt.slice(0, 10)}</span>
                <span className="font-semibold">{checkin.status}</span>
                {checkin.note && <span className="text-fg-subtle">{checkin.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
