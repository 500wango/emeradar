'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, X, FileText } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button, buttonVariants } from '@/components/ui/Button';

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
  const { t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  const passReasons = [
    { id: 'DEMAND_TOO_THIN', label: t('opportunityDetail.passReasonDemandThin') },
    { id: 'WINDOW_ALREADY_CLOSED', label: t('opportunityDetail.passReasonWindowClosed') },
    { id: 'NO_COMMERCIAL_PROOF', label: t('opportunityDetail.passReasonNoCommercialProof') },
    { id: 'OUTSIDE_TIME_BUDGET', label: t('opportunityDetail.passReasonOutsideTimeBudget') },
    { id: 'NOT_MY_SKILL', label: t('opportunityDetail.passReasonNotMySkill') },
    { id: 'OTHER', label: t('opportunityDetail.passReasonOther') },
  ];

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
      if (!res.ok) throw new Error(data.detail || t('opportunityDetail.watchFailed'));
      setMessage(t('opportunityDetail.watchingSuccess'));
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
      if (!res.ok) throw new Error(data.detail || t('opportunityDetail.goFailed'));
      router.push('/projects');
    } catch (err: any) {
      setError(err.message);
      setPending(null);
    }
  }

  async function pass() {
    if (reasons.length === 0) {
      setError(t('opportunityDetail.passReasonRequired'));
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
      if (!res.ok) throw new Error(data.detail || t('opportunityDetail.passFailed'));
      setPassOpen(false);
      setMessage(t('opportunityDetail.passSuccess'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-3 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={watch}
          disabled={pending !== null}
        >
          <Bell className="w-4 h-4" />
          {t('opportunityDetail.watchBtn')}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={go}
          disabled={!canGo || pending !== null}
        >
          <Check className="w-4 h-4" />
          {t('opportunityDetail.goBtn')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-danger/40 text-danger hover:bg-danger/10"
          onClick={() => {
            setPassOpen((open) => !open);
            setError(null);
          }}
          aria-expanded={passOpen}
          aria-controls="pass-reasons"
          disabled={pending !== null}
        >
          <X className="w-4 h-4" />
          {t('opportunityDetail.passBtn')}
        </Button>
        {canExport ? (
          <a
            href={`/opportunities/${slug}/report`}
            className={buttonVariants({ variant: 'outline' })}
          >
            <FileText className="w-4 h-4 text-accent" />
            {t('opportunityDetail.exportReport')}
          </a>
        ) : (
          <span
            className={buttonVariants({
              variant: 'outline',
              className: 'pointer-events-none opacity-50',
            })}
          >
            <FileText className="w-4 h-4" />
            {t('opportunityDetail.exportLocked')}
          </span>
        )}
      </div>

      {!canGo && blockReason && (
        <p className="text-xs text-warn bg-warn/10 border border-warn/40 rounded-sm px-3 py-2 max-w-md">
          {blockReason}
        </p>
      )}

      {passOpen && (
        <div
          id="pass-reasons"
          role="group"
          aria-labelledby="pass-reasons-heading"
          className="rounded-sm border border-line bg-surface p-3 max-w-md"
        >
          <p id="pass-reasons-heading" className="text-xs font-semibold text-fg mb-2">
            {t('opportunityDetail.passReasonsPrompt')}
          </p>
          <div className="space-y-1.5">
            {passReasons.map((reason) => (
              <label key={reason.id} className="flex items-center gap-2 text-xs text-fg-muted">
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
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={pass}
            disabled={pending !== null}
            className="mt-3"
          >
            {t('opportunityDetail.confirmPass')}
          </Button>
        </div>
      )}

      {message && (
        <p className="text-xs text-signal" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
