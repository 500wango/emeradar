'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const CREDENTIAL_TYPES = ['DOMAIN_URL', 'STORE_LISTING_URL', 'PUBLIC_PAGE_URL'] as const;
type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export interface CredentialRow {
  id: string;
  credentialType: string;
  url: string;
  verificationState: string;
  rejectionReason: string | null;
  checkedAt: string | null;
}

interface CredentialStatus {
  credentialStatus: string;
  credentialVerifiedAt: string | null;
  credentials: CredentialRow[];
}

/**
 * 上线凭证（09 §8、10 §4.5）。
 *
 * v3.1 里它是 GO 之后的可选动作：没有截止时间，失败不释放任何资源、不退还配额，
 * 也没有重试次数上限。所以这里不渲染倒计时、不渲染"位置将被释放"的警告——那些
 * 都属于已经拆除的质押机制。
 */
export function CredentialPanel({
  projectId,
  projectKind,
  initial,
}: {
  projectId: string;
  /** 实验项目不来自 GO，没有可核验的"上线"语义。 */
  projectKind: string;
  initial: CredentialStatus;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<CredentialStatus>(initial);
  const [credentialType, setCredentialType] = useState<CredentialType>('DOMAIN_URL');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (projectKind === 'EXPERIMENT') return null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/credentials`, {
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
              ? t('projects.credentialUnverifiedWithProbe', { reason: data.detail ?? '', seen })
              : data.detail || t('projects.credentialFailed')
          );
        } else {
          setError(data.detail || t('projects.credentialFailed'));
        }
        setPending(false);
        return;
      }
      // 重新取服务端数据而不是本地改 state：`credential_status` 由服务端判定。
      router.refresh();
      const refreshed = await fetch(`/api/v1/projects/${projectId}/credentials`).catch(() => null);
      if (refreshed?.ok) {
        const next = await refreshed.json();
        setStatus({
          credentialStatus: next.credentialStatus,
          credentialVerifiedAt: next.credentialVerifiedAt ?? null,
          credentials: next.credentials ?? [],
        });
      } else {
        setStatus((current) => ({
          ...current,
          credentialStatus: 'VERIFIED_OWNER',
          credentialVerifiedAt: new Date().toISOString(),
        }));
      }
      setUrl('');
      setPending(false);
    } catch (err: any) {
      setError(err.message || t('projects.credentialFailed'));
      setPending(false);
    }
  }

  const verified = status.credentialStatus === 'VERIFIED_OWNER';
  const rejected = status.credentialStatus === 'REJECTED';

  return (
    <div className="mt-4 rounded-sm border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-fg-subtle" />
        <h3 className="text-sm font-semibold text-fg">{t('projects.credentialTitle')}</h3>
        {/* 徽章里放英文 token、句子放在下面：Badge 的 `uppercase` 与字距对中文
            是空操作，中文标签在徽章里只会显得没有格式（ui/Badge.tsx 顶部已说明）。 */}
        {verified ? (
          <Badge tone="signal" size="sm">
            CREDENTIAL VERIFIED
          </Badge>
        ) : rejected ? (
          <Badge tone="warn" size="sm">
            VERIFICATION REJECTED
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            CREDENTIAL UNVERIFIED
          </Badge>
        )}
      </div>

      {verified ? (
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          {t('projects.credentialVerifiedDesc')}
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed text-fg-muted">
            {rejected ? t('projects.credentialRejectedDesc') : t('projects.credentialDesc')}
          </p>

          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('projects.credentialTypeLabel')}>
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
                  {t(`projects.credentialTypes.${type}`)}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="sr-only">{t('projects.credentialUrlLabel')}</span>
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('projects.credentialUrlPlaceholder')}
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
              {pending ? t('projects.credentialSubmitting') : t('projects.credentialSubmit')}
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
            {t('projects.credentialHistory')}
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
