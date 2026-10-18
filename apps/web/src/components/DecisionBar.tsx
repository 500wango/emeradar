'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Check, X, FileText } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button, buttonVariants } from '@/components/ui/Button';

interface DecisionBarProps {
  opportunityId: string;
  slug: string;
  /**
   * The ledger row currently on screen. Every decision cites it, so the record
   * after the fact points at the exact reasoning the user acted on. `null` means
   * the page has no sealed verdict to cite, and both buttons are disabled.
   */
  verdictId: string | null;
  /** Carried through from the report studio so the project cites its report. */
  reportId?: string | null;
  /**
   * 推荐形态。v3.1 没有槽位可选，GO 按这条机会推荐的形态落地；为 null 时不能 GO
   * （服务端要求一个合法形态）。
   */
  recommendedArchetype: string | null;
  canGo: boolean;
  canExport: boolean;
  blockReason?: string;
}

export function DecisionBar({
  opportunityId,
  slug,
  verdictId,
  reportId,
  recommendedArchetype,
  canGo,
  canExport,
  blockReason,
}: DecisionBarProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  const archetype = recommendedArchetype;

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

  /**
   * 原子 GO —— **一次请求**。
   *
   * 旧实现先 `POST /decisions` 再 `POST /projects`，两次调用之间失败就会留下一条
   * 没有项目的 GO。更根本的是：扣配额、建项目、解锁点火包这三件事必须同生
   * 共死，任何两段式都等于承认存在"占了槽但没立项"或"立了项但没扣配额"的中间态，
   * 而那正是 ADR-018 用单事务封死的东西（10 §4.3）。
   */
  async function go() {
    if (!verdictId) {
      setError(t('opportunityDetail.goFailed'));
      return;
    }
    if (!archetype) {
      setError(t('opportunityDetail.goNoArchetype'));
      return;
    }
    setPending('go');
    setError(null);
    setUpgradeUrl(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/opportunities/${opportunityId}/go`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetype,
          verdictId,
          reportId: reportId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 每类失败给的是**不同的下一步**，所以不能糊成一句"操作失败"：
        //   自己没额度 → 换套餐（RFC9457 的 `upgrade` 是 `{required_plan, url}`）
        //   重复点击 → 直接去那条项目（配额没有被再扣一次）
        if (data.upgrade?.url) setUpgradeUrl(String(data.upgrade.url));
        if (data.code === 'ALREADY_GO' && data.details?.project_id) {
          router.push(`/projects/${data.details.project_id}`);
          return;
        }
        setError(data.detail || t('opportunityDetail.goFailed'));
        setPending(null);
        return;
      }
      router.push(`/projects/${data.project_id}`);
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
    if (!verdictId) {
      setError(t('opportunityDetail.passFailed'));
      return;
    }
    setPending('pass');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId, verdictId, decision: 'PASS', reasons }),
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

  const goDisabled = !canGo || !verdictId || !archetype || pending !== null;
  const hint = blockReason;

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
          disabled={goDisabled}
        >
          <Check className="w-4 h-4" />
          {pending === 'go' ? t('opportunityDetail.goPending') : t('opportunityDetail.goBtn')}
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
          disabled={!verdictId || pending !== null}
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

      {goDisabled && hint && (
        <p className="text-xs text-warn bg-warn/10 border border-warn/40 rounded-sm px-3 py-2 max-w-md">
          {hint}
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
            disabled={!verdictId || pending !== null}
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
          {upgradeUrl && (
            <>
              {' '}
              <Link href={upgradeUrl} className="font-semibold underline">
                {t('opportunityDetail.upgradePlan')}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
