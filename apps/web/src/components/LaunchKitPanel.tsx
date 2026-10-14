'use client';

import { useState } from 'react';
import { FileArchive, Loader2, PackageCheck, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

/**
 * 形态点火包面板（09 §5.3、10 §4.4、ADR-018/019）。
 *
 * 后端把点火包的准入、冻结与打包都做完了，但**没有一个地方能让用户拿到它**——
 * GO 之后前端只是跳回项目页，而项目页上没有这个入口。所以这个面板不是装饰：
 * 少了它，`atomic_go_export_monthly` 扣掉的那一次额度对应的交付物就永远躺在库里。
 *
 * 刻意**不在页面加载时自动取**：导出会顺带生成报告（首次装配）并冻结产物，那是
 * 用户的动作而不是浏览页面的副作用。所以进来先给一个按钮，点了才发生。
 *
 * 三个版本号（snapshot / template / scoring_config）必须摆出来，因为 09 §5.3 硬约束 1
 * 承诺的是"同一份输入必得同一份交付物"——用户要能自己核对这句话，就得知道输入是什么。
 */

interface LaunchKitView {
  launchKitId: string;
  archetype: string;
  templateVersion: string;
  snapshotId: string;
  scoringConfigVersion: string;
  researchLanguage: string;
  obsDate: string;
  contentHash: string;
  files: Array<{ path: string }>;
}

interface VerifyResult {
  verified: boolean;
  storedHash: string;
  recomputedHash: string;
  fileCount: number;
}

export function LaunchKitPanel({
  projectId,
  projectKind,
}: {
  projectId: string;
  /** 实验项目不是由原子 GO 产生的，永远不会有点火包。 */
  projectKind: string;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<LaunchKitView | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 404 与别的失败要分开：前者是"这个项目本来就没有点火包"（实验项目、或槽位已释放），
  // 是可解释的状态；后者才是需要用户重试的问题。
  const [unavailable, setUnavailable] = useState(false);

  if (projectKind === 'EXPERIMENT') return null;

  const base = `/api/v1/projects/${projectId}/launch-kit`;

  async function load() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${base}?format=json`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setUnavailable(true);
        setPending(false);
        return;
      }
      if (!res.ok) {
        setError(data.detail || t('projects.launchKitFailed'));
        setPending(false);
        return;
      }
      setView(data);
      setPending(false);
    } catch (err: any) {
      setError(err.message || t('projects.launchKitFailed'));
      setPending(false);
    }
  }

  async function runVerify() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${base}/verify`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || t('projects.launchKitFailed'));
      } else {
        setVerify(data);
      }
      setPending(false);
    } catch (err: any) {
      setError(err.message || t('projects.launchKitFailed'));
      setPending(false);
    }
  }

  return (
    <div className="mt-4 rounded-sm border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <PackageCheck className="h-4 w-4 text-fg-subtle" />
        <h3 className="text-sm font-semibold text-fg">{t('projects.launchKitTitle')}</h3>
        {view && (
          <Badge tone="accent" size="sm">
            {view.archetype}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">{t('projects.launchKitDesc')}</p>

      {unavailable ? (
        <p className="mt-3 text-xs leading-relaxed text-fg-subtle">{t('projects.launchKitUnavailable')}</p>
      ) : !view ? (
        <div className="mt-3">
          <Button type="button" size="sm" onClick={load} disabled={pending}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PackageCheck className="h-3.5 w-3.5" />
            )}
            {pending ? t('projects.launchKitGenerating') : t('projects.launchKitGenerate')}
          </Button>
        </div>
      ) : (
        <>
          {/* 输入三项 + 指纹。这是硬约束 1 让用户自查的那一组信息。 */}
          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-2">
            {[
              [t('projects.launchKitSnapshot'), view.snapshotId],
              [t('projects.launchKitTemplate'), view.templateVersion],
              [t('projects.launchKitScoringConfig'), view.scoringConfigVersion],
              [t('projects.launchKitHash'), view.contentHash.slice(0, 16)],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="shrink-0 text-fg-subtle">{label}</dt>
                <dd className="truncate text-fg-muted">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* 用 `<a download>` 而不是 fetch + Blob：端点自己带
                `Content-Disposition: attachment`，交给浏览器下载就没有"把整包读进
                内存再吐出来"这一步。 */}
            <a
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
              href={`${base}?format=bundle`}
              download
            >
              <FileArchive className="h-3.5 w-3.5" />
              {t('projects.launchKitDownloadZip')}
            </a>
            <a
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              href={`${base}?format=md`}
              download
            >
              {t('projects.launchKitDownloadMd')}
            </a>
            <Button type="button" variant="ghost" size="sm" onClick={runVerify} disabled={pending}>
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {pending ? t('projects.launchKitVerifying') : t('projects.launchKitVerify')}
            </Button>
          </div>

          {verify && (
            <p
              className={`mt-2 flex items-start gap-1.5 text-[11px] ${
                verify.verified ? 'text-signal' : 'text-danger'
              }`}
              role="status"
            >
              {verify.verified ? (
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              {verify.verified
                ? t('projects.launchKitVerified', { count: String(verify.fileCount) })
                : t('projects.launchKitMismatch', {
                    stored: verify.storedHash.slice(0, 12),
                    recomputed: verify.recomputedHash.slice(0, 12),
                  })}
            </p>
          )}
        </>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
