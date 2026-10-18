'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

/**
 * 承诺质押面板（09 §8、10 §4.5）。
 *
 * 它是 7 天窗口的唯一入口。没这块界面，重后端照样按时扫、按时把槽位收回去——
 * 用户会毫无预告地丢掉一个已经扣过配额的位置。所以这个组件不是"锦上添花的
 * 补全"，而是让"质押"这条规则**可被履行**的那一半。
 */

const CREDENTIAL_TYPES = ['DOMAIN_URL', 'STORE_LISTING_URL', 'PUBLIC_PAGE_URL'] as const;
type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export interface StakeCredentialRow {
  id: string;
  credentialType: string;
  url: string;
  verificationState: string;
  rejectionReason: string | null;
  checkedAt: string | null;
}

interface StakeStatus {
  stakeStatus: string;
  /** v3.1：GO 之后建立的项目没有截止时间，这里就是 null。 */
  stakeDeadlineAt: string | null;
  credentials: StakeCredentialRow[];
}

export function StakePanel({
  projectId,
  projectKind,
  initial,
}: {
  projectId: string;
  /** 实验项目不来自 GO，没有质押义务，也没有占槽位。 */
  projectKind: string;
  initial: StakeStatus;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<StakeStatus>(initial);
  const [credentialType, setCredentialType] = useState<CredentialType>('DOMAIN_URL');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 实验项目不属于"认领了一个槽位"，质押规则不适用。
  if (projectKind === 'EXPERIMENT') return null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/stake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialType, url }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'CREDENTIAL_UNVERIFIED') {
          // 探针取回的关键字段随 422 一起回来，直接摆给用户：他需要的是"你的页面
          // 标题里没有这几个词"这类可操作的信息，而不是"校验失败"这四个字。
          const probe = data.details?.probe;
          const seen = [probe?.title, probe?.h1, probe?.metaDescription]
            .filter((value: unknown) => typeof value === 'string' && value.length > 0)
            .join(' / ');
          setError(
            seen
              ? t('projects.stakeUnverifiedWithProbe', { reason: data.detail ?? '', seen })
              : data.detail || t('projects.stakeFailed')
          );
        } else {
          setError(data.detail || t('projects.stakeFailed'));
        }
        setPending(false);
        return;
      }
      // 成功一次就置 VERIFIED，槽位保住。重新取服务端数据而不是本地改 state：
      // `stake_status` 是服务端判定的，前端"以为成功了"不算数。
      router.refresh();
      const refreshed = await fetch(`/api/v1/projects/${projectId}/stake`).catch(() => null);
      if (refreshed?.ok) {
        const next = await refreshed.json();
        setStatus({
          stakeStatus: next.stakeStatus,
          stakeDeadlineAt: next.stakeDeadlineAt,
          credentials: next.credentials ?? [],
        });
      } else {
        setStatus((current) => ({ ...current, stakeStatus: 'VERIFIED' }));
      }
      setUrl('');
      setPending(false);
    } catch (err: any) {
      setError(err.message || t('projects.stakeFailed'));
      setPending(false);
    }
  }

  const verified = status.stakeStatus === 'VERIFIED';
  const expired = status.stakeStatus === 'EXPIRED_RELEASED';
  const deadline = status.stakeDeadlineAt ? new Date(status.stakeDeadlineAt) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="mt-4 rounded-sm border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-fg-subtle" />
        <h3 className="text-sm font-semibold text-fg">{t('projects.stakeTitle')}</h3>
        {/* 徽章里放英文 token、句子放在下面：Badge 的 `uppercase` 与字距对中文
            是空操作，中文标签在徽章里只会显得没有格式（ui/Badge.tsx 顶部已说明）。 */}
        {verified ? (
          <Badge tone="signal" size="sm">
            STAKE VERIFIED
          </Badge>
        ) : expired ? (
          <Badge tone="danger" size="sm">
            SLOT RELEASED
          </Badge>
        ) : (
          <Badge tone="warn" size="sm">
            {daysLeft === null ? 'CREDENTIAL UNVERIFIED' : `STAKE PENDING · ${Math.max(0, daysLeft)}d`}
          </Badge>
        )}
      </div>

      {verified ? (
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{t('projects.stakeVerifiedDesc')}</p>
      ) : expired ? (
        // 逾期释放槽位，但已扣的配额不退（PRD §1.7 第 5 条）。这句话必须说出来：
        // 用户要能自己核对"我丢了什么、没丢什么"。
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{t('projects.stakeExpiredDesc')}</p>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed text-fg-muted">
            {deadline
              ? t('projects.stakeDesc', { date: deadline.toISOString().slice(0, 10) })
              : t('projects.stakeDescNoDeadline')}
          </p>

          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('projects.stakeTypeLabel')}>
              {CREDENTIAL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={credentialType === type}
                  disabled={pending}
                  onClick={() => setCredentialType(type)}
                  className={[
                    'rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors',
                    credentialType === type
                      ? 'border-accent/60 bg-accent/10 text-accent'
                      : 'border-line bg-surface-2 text-fg-muted hover:text-fg',
                  ].join(' ')}
                >
                  {t(`projects.stakeTypes.${type}`)}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="sr-only">{t('projects.stakeUrlLabel')}</span>
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('projects.stakeUrlPlaceholder')}
                disabled={pending}
                className="w-full max-w-xl rounded-sm border border-line bg-canvas px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>

            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={pending || url.trim().length === 0}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {pending ? t('projects.stakeSubmitting') : t('projects.stakeSubmit')}
            </Button>
            {error && (
              <p className="text-[11px] text-danger" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}

      {status.credentials.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
            {t('projects.stakeHistory')}
          </p>
          <ul className="space-y-1">
            {status.credentials.map((credential) => (
              <li key={credential.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-mono text-fg-muted">{credential.credentialType}</span>
                <span
                  className={
                    credential.verificationState === 'VERIFIED'
                      ? 'text-signal'
                      : credential.verificationState === 'REJECTED'
                      ? 'text-danger'
                      : 'text-fg-subtle'
                  }
                >
                  {credential.verificationState}
                </span>
                <span className="truncate text-fg-subtle">{credential.url}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
