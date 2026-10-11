'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function AlertRuleList({ initialRules }: { initialRules: any[] }) {
  const { t, isZh } = useI18n();
  const [rules, setRules] = useState(initialRules);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(ruleId: string) {
    setPending(ruleId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/alerts?ruleId=${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || (isZh ? '删除监控失败。' : 'Could not remove this watch.'));
      setRules((current) => current.filter((rule) => rule.id !== ruleId));
    } catch (err: any) {
      setError(err.message || (isZh ? '删除监控失败。' : 'Could not remove this watch.'));
    } finally {
      setPending(null);
    }
  }

  if (rules.length === 0) {
    return (
      <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-100">
        <p className="text-xs text-slate-600">{t('alerts.noRulesDesc')}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {error && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
      {rules.map((rule) => (
        <div key={rule.id} className="py-4 flex items-center justify-between gap-4">
          <div>
            <Link href={`/opportunities/${rule.opportunity_slug}`} className="font-bold text-sm text-slate-900 hover:text-blue-600 flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              <span>{rule.opportunity_title}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700">{rule.rule_type}</span>
              <span>&bull;</span>
              <span>{t('alerts.frequency')}: {rule.frequency}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => remove(rule.id)}
            disabled={pending === rule.id}
            aria-label={isZh ? '取消关注' : 'Remove watch'}
            title={isZh ? '取消关注' : 'Remove watch'}
            className="inline-flex items-center justify-center min-h-10 min-w-10 rounded-md border border-slate-200 text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
