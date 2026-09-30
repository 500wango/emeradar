'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, X, FileText } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

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
  const { t, isZh } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  const passReasons = [
    { id: 'DEMAND_TOO_THIN', label: isZh ? '搜索需求过低 / 不足' : 'Demand is too thin' },
    { id: 'WINDOW_ALREADY_CLOSED', label: isZh ? '竞争窗口已关闭 / 巨头已垄断' : 'Window already closed' },
    { id: 'NO_COMMERCIAL_PROOF', label: isZh ? '缺乏可验证的商业付费信号' : 'No commercial proof' },
    { id: 'OUTSIDE_TIME_BUDGET', label: isZh ? '超出当前业余时间预算' : 'Outside my time budget' },
    { id: 'NOT_MY_SKILL', label: isZh ? '与个人技术栈不匹配' : 'Not my skill' },
    { id: 'OTHER', label: isZh ? '其他原因' : 'Other' },
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
      if (!res.ok) throw new Error(data.detail || (isZh ? '未能保存雷达监控。' : 'Could not save the watch.'));
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
      if (!res.ok) throw new Error(data.detail || (isZh ? '未能启动项目立项。' : 'Could not start the project.'));
      router.push('/projects');
    } catch (err: any) {
      setError(err.message);
      setPending(null);
    }
  }

  async function pass() {
    if (reasons.length === 0) {
      setError(isZh ? '请至少选择一项原因。' : 'Choose at least one reason.');
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
      if (!res.ok) throw new Error(data.detail || (isZh ? '未能记录跳过操作。' : 'Could not record the pass.'));
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
        <button
          type="button"
          onClick={watch}
          disabled={pending !== null}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60"
        >
          <Bell className="w-4 h-4" />
          {t('opportunityDetail.watchBtn')}
        </button>
        <button
          type="button"
          onClick={go}
          disabled={!canGo || pending !== null}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-500"
        >
          <Check className="w-4 h-4" />
          {t('opportunityDetail.goBtn')}
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
          {t('opportunityDetail.passBtn')}
        </button>
        {canExport ? (
          <a
            href={`/opportunities/${slug}/report`}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50"
          >
            <FileText className="w-4 h-4 text-blue-600" />
            {t('opportunityDetail.exportReport')}
          </a>
        ) : (
          <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 bg-slate-50 border border-slate-200">
            <FileText className="w-4 h-4" />
            {isZh ? '发布裁决后可导出报告' : 'Report after a published verdict'}
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
          <p className="text-xs font-semibold text-slate-800 mb-2">{t('opportunityDetail.passReasonsPrompt')}</p>
          <div className="space-y-1.5">
            {passReasons.map((reason) => (
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
            {t('opportunityDetail.confirmPass')}
          </button>
        </div>
      )}

      {message && <p className="text-xs text-emerald-700">{message}</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
