'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Check, X, FileText, ShieldOff } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button, buttonVariants } from '@/components/ui/Button';

/**
 * 一条形态队里还剩几个位置。字段名与 `GET /opportunities/{id}/slots` 一致，
 * 好让服务端直接把这个数组交下来，不需要在中间再映射一层（映射层正是它会
 * 悄悄和 `SlotService` 说不到一块去的地方）。
 */
export interface SlotOption {
  archetype: string;
  capacity: number;
  claimed: number;
  remaining: number;
}

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
  /** 这条机会开放的形态队。空数组表示一个形态都没开，GO 无处可占。 */
  slots: SlotOption[];
  /** 推荐形态，用作默认选中项。它满了就退到还有余量的那一个。 */
  recommendedArchetype: string | null;
  canGo: boolean;
  canExport: boolean;
  blockReason?: string;
  /**
   * 买断资格（`GET /opportunities/{id}/stealth-lock` 的响应，10 §4.5b）。
   *
   * 由服务端页面取好传下来，而不是在客户端再发一次请求：`claimed_total` 与上面那排
   * 槽位徽章读的是同一张 `opportunity_slots`，让它们来自同一个响应，就不可能各说
   * 一套。`null` 表示这条机会不提供买断入口（未登录、或服务端取不到）。
   */
  stealthLock: {
    available: boolean;
    claimedTotal: number;
    price: number;
    durationDays: number;
    locked: boolean;
    heldByMe: boolean;
    pending: { checkoutUrl: string | null; expiresAt: string } | null;
  } | null;
}

/** `t` 找不到键时原样返回键名，据此判断该枚举有没有译文。 */
function labelOf(t: (key: string) => string, value: string): string {
  const key = `common.archetypes.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

/**
 * 买断按钮为什么不可用——**必须说出具体原因，而不是留一个灰按钮**。
 *
 * 三种原因给出三种完全不同的下一步：已经有人认领了（换一条机会）、你自己已经买下
 * 了（去 GO）、别人正占着（等 45 分钟或对方付款后等 60 天）。合成一句"不可用"
 * 会让用户以为是自己的套餐问题，那样他会去买一个解决不了任何事的升级。
 */
function stealthDisabledReason(
  lock: NonNullable<DecisionBarProps['stealthLock']>,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (lock.available) return null;
  if (lock.locked) {
    return lock.heldByMe
      ? t('opportunityDetail.stealthHeldByYou')
      : t('opportunityDetail.stealthHeldByOther');
  }
  return t('opportunityDetail.stealthUnavailableClaimed', { count: lock.claimedTotal });
}

export function DecisionBar({
  opportunityId,
  slug,
  verdictId,
  reportId,
  slots,
  recommendedArchetype,
  canGo,
  canExport,
  blockReason,
  stealthLock,
}: DecisionBarProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  const open = useMemo(() => slots.filter((slot) => slot.remaining > 0), [slots]);

  /**
   * 默认选中推荐形态。推荐形态被占满时退到第一个还有余量的队——把用户默认推到
   * 一个必然 409 的按钮上，等于让他在一次注定失败的提交里学到"形态"这个概念。
   */
  const [archetype, setArchetype] = useState<string | null>(() => {
    if (recommendedArchetype && open.some((slot) => slot.archetype === recommendedArchetype)) {
      return recommendedArchetype;
    }
    return open[0]?.archetype ?? null;
  });

  const selected = open.find((slot) => slot.archetype === archetype) ?? open[0] ?? null;
  const slotsExhausted = open.length === 0;

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
   * 没有项目的 GO。更根本的是：占槽、扣配额、建项目、解锁点火包这四件事必须同生
   * 共死，任何两段式都等于承认存在"占了槽但没立项"或"立了项但没扣配额"的中间态，
   * 而那正是 ADR-018 用单事务封死的东西（10 §4.3）。
   */
  async function go() {
    if (!verdictId) {
      setError(t('opportunityDetail.goFailed'));
      return;
    }
    if (!selected) {
      setError(t('opportunityDetail.goNoSlot'));
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
          archetype: selected.archetype,
          verdictId,
          reportId: reportId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 每类失败给的是**不同的下一步**，所以不能糊成一句"操作失败"：
        //   别人占满了 → 换形态（服务端已经把还有余量的形态放在 details.alternatives）
        //   自己没额度 → 换套餐
        //   有逾期质押 → 先去补凭证
        // RFC9457 的 `upgrade` 是 `{required_plan, url}`。取 `url` 而不是整个对象：
        // 前端要的是一个链接，套餐名只用于文案，塞进 href 会得到 "[object Object]"。
        if (data.upgrade?.url) setUpgradeUrl(String(data.upgrade.url));
        // 重复 GO：第一次已经成立，直接去那条项目。配额没有被再扣一次。
        if (data.code === 'ALREADY_GO' && data.details?.project_id) {
          router.push(`/projects/${data.details.project_id}`);
          return;
        }
        if (data.code === 'SLOT_TAKEN') {
          const alternatives: string[] = Array.isArray(data.details?.alternatives)
            ? data.details.alternatives
            : [];
          const names = alternatives.map((value) => labelOf(t, value)).join('、');
          setError(
            names
              ? t('opportunityDetail.goSlotTakenAlternatives', { alternatives: names })
              : t('opportunityDetail.goSlotTaken')
          );
          // 槽位余量刚刚变了，把服务端组件重新取一遍，别让用户对着过期的数字再点一次。
          router.refresh();
        } else {
          setError(data.detail || t('opportunityDetail.goFailed'));
        }
        setPending(null);
        return;
      }
      router.push(`/projects/${data.project_id}`);
    } catch (err: any) {
      setError(err.message);
      setPending(null);
    }
  }

  /**
   * 买断下单（10 §4.5b）。
   *
   * 成功后**跳转到托管结账页**，而不是弹一个"已下单"的提示：此刻机会已经对全网
   * 隐藏（下单即写锁），用户手里必须马上有一张能付款的账单，否则那条 45 分钟的
   * 待付窗口会在一个没有任何付款入口的页面上流逝。窗口一过占位作废、机会重新
   * 开放，而他什么都没买到。
   */
  async function buyout() {
    setPending('buyout');
    setError(null);
    setMessage(null);
    setUpgradeUrl(null);
    try {
      const res = await fetch(`/api/v1/opportunities/${opportunityId}/stealth-lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_interval: 'ONE_TIME' }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.upgrade?.url) setUpgradeUrl(String(data.upgrade.url));
        // 已有一笔待付占位（409）时把续付链接直接给出去。这不是错误，是"你上次
        // 没付完"；让他从详情页重新下一单只会撞上同一道闸。
        if (data.code === 'STEALTH_LOCK_PENDING' && data.details?.checkoutUrl) {
          window.location.href = String(data.details.checkoutUrl);
          return;
        }
        setError(data.detail || t('opportunityDetail.stealthFailed'));
        setPending(null);
        return;
      }
      if (data.checkout_url) {
        window.location.href = String(data.checkout_url);
        return;
      }
      // 没有结账链接说明这是一次模拟成交（非生产环境缺密钥）。留在原页面并把
      // 状态刷出来，让下一屏显示"你已买断"。
      setMessage(t('opportunityDetail.stealthSuccess', { days: stealthLock?.durationDays ?? 60 }));
      router.refresh();
      setPending(null);
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

  const goDisabled = !canGo || !verdictId || pending !== null || slotsExhausted;
  // 槽位占满优先于 blockReason：`blockReason` 讲的是"这条机会还没到能 GO 的阶段"，
  // 而这里是"到了，但位置没了"——两句话指的不是同一件事，也给出不同的下一步。
  const hint = slotsExhausted ? t('opportunityDetail.goSlotsExhausted') : blockReason;

  return (
    <div className="flex flex-col items-stretch gap-3 shrink-0">
      {slots.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="radiogroup"
          aria-label={t('opportunityDetail.trackPickerLabel')}
        >
          {slots.map((slot) => {
            const isOpen = slot.remaining > 0;
            const isSelected = selected?.archetype === slot.archetype;
            return (
              <button
                key={slot.archetype}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={!isOpen || pending !== null}
                onClick={() => {
                  setArchetype(slot.archetype);
                  setError(null);
                }}
                className={[
                  'rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors',
                  isSelected
                    ? 'border-accent/60 bg-accent/10 text-accent'
                    : 'border-line bg-surface-2 text-fg-muted hover:text-fg',
                  isOpen ? '' : 'cursor-not-allowed line-through opacity-50',
                ].join(' ')}
              >
                {labelOf(t, slot.archetype)}{' '}
                <span className="font-mono">
                  {slot.remaining}/{slot.capacity}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
        {stealthLock && (
          /**
           * 不可用时**不置灰**，而是渲染成一个带明确原因的禁用按钮 + 一行说明。
           * 一个灰掉的按钮配上没有解释，会被读成"你的套餐不够"（16 §147），而这条
           * 的失败原因与套餐无关——是"这条机会已经不是处女地了"。两者给出的是完全
           * 不同的下一步（升级套餐 vs 换一条机会），所以必须写在用户看得到的地方。
           */
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              variant="outline"
              className={
                stealthLock.available
                  ? 'border-accent/50 text-accent hover:bg-accent/10'
                  : 'opacity-50'
              }
              onClick={buyout}
              disabled={!stealthLock.available || pending !== null}
              title={stealthDisabledReason(stealthLock, t) ?? undefined}
            >
              <ShieldOff className="w-4 h-4" />
              {pending === 'buyout'
                ? t('opportunityDetail.stealthPending')
                : t('opportunityDetail.stealthBtn', { price: `$${stealthLock.price}` })}
            </Button>
            <span className="text-[11px] text-fg-subtle">
              {stealthDisabledReason(stealthLock, t) ??
                t('opportunityDetail.stealthHint', { days: stealthLock.durationDays })}
            </span>
          </div>
        )}
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
