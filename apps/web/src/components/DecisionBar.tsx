'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, X, FileText } from 'lucide-react';

const PASS_REASONS = [
  { id: 'DEMAND_TOO_THIN', label: 'Demand is too thin' },
  { id: 'WINDOW_ALREADY_CLOSED', label: 'Window already closed' },
  { id: 'NO_COMMERCIAL_PROOF', label: 'No commercial proof' },
  { id: 'OUTSIDE_TIME_BUDGET', label: 'Outside my time budget' },
  { id: 'NOT_MY_SKILL', label: 'Not my skill' },
  { id: 'OTHER', label: 'Other' },
];

interface DecisionBarProps {
  opportunityId: string;
  slug: string;
  title: string;
  canGo: boolean;
  canExport: boolean;
  blockReason?: string;
}

export function DecisionBar({
  opportunityId,
  slug,
  title,
  canGo,
  canExport,
  blockReason,
}: DecisionBarProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  async function watch() {
    setPending('watch');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId, ruleType: 'VERDICT_CHANGE', frequency: 'DAILY' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not save the watch.');
      setMessage('Watching. You will be notified when the published verdict changes.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  }

  async function go() {
    setPending('go');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityId,
          title,
          targetKeywords: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not start the project.');
      router.push('/projects');
    } catch (err: any) {
      setError(err.message);
      setPending(null);
    }
  }

  async function pass() {
    if (reasons.length === 0) {
      setError('Choose at least one reason.');
      return;
    }
    setPending('pass');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId, reasons }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not record the pass.');
      setPassOpen(false);
      setMessage('Pass recorded against the current verdict.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-3 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={watch}
          disabled={pending !== null}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60"
        >
          <Bell className="w-4 h-4" />
          Watch
        </button>
        <button
          type="button"
          onClick={go}
          disabled={!canGo || pending !== null}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-500"
        >
          <Check className="w-4 h-4" />
          GO
        </button>
        <button
          type="button"
          onClick={() => {
            setPassOpen((open) => !open);
            setError(null);
          }}
          disabled={pending !== null}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-60"
        >
          <X className="w-4 h-4" />
          PASS
        </button>
        {canExport ? (
          <a
            href={`/opportunities/${slug}/report`}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50"
          >
            <FileText className="w-4 h-4 text-blue-600" />
            Export report
          </a>
        ) : (
          <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 bg-slate-50 border border-slate-200">
            <FileText className="w-4 h-4" />
            Report after a published verdict
          </span>
        )}
      </div>

      {!canGo && blockReason && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 max-w-md">
          {blockReason}
        </p>
      )}

      {passOpen && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 max-w-md">
          <p className="text-xs font-semibold text-slate-800 mb-2">Why are you passing?</p>
          <div className="space-y-1.5">
            {PASS_REASONS.map((reason) => (
              <label key={reason.id} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={reasons.includes(reason.id)}
                  onChange={() =>
                    setReasons((current) =>
                      current.includes(reason.id)
                        ? current.filter((id) => id !== reason.id)
                        : [...current, reason.id]
                    )
                  }
                />
                {reason.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={pass}
            disabled={pending !== null}
            className="mt-3 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-60"
          >
            Record pass
          </button>
        </div>
      )}

      {message && <p className="text-xs text-emerald-700">{message}</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
