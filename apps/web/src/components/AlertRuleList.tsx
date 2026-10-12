'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';

export function AlertRuleList({ initialRules }: { initialRules: any[] }) {
  const { t } = useI18n();
  const [rules, setRules] = useState(initialRules);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(ruleId: string) {
    setPending(ruleId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/alerts?ruleId=${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || t('alerts.removeError'));
      setRules((current) => current.filter((rule) => rule.id !== ruleId));
    } catch (err: any) {
      setError(err.message || t('alerts.removeError'));
    } finally {
      setPending(null);
    }
  }

  if (rules.length === 0) {
    return (
      <Panel tone="raised" className="p-8 text-center">
        <p className="text-xs text-fg-muted">{t('alerts.noRulesDesc')}</p>
      </Panel>
    );
  }

  return (
    <div className="divide-y divide-line">
      {error && <p className="mb-3 rounded-sm bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">{error}</p>}
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-4 py-4">
          <div>
            <Link href={`/opportunities/${rule.opportunity_slug}`} className="flex items-center gap-1.5 text-sm font-bold text-fg transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <span>{rule.opportunity_title}</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-fg-subtle" />
            </Link>
            <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-fg-muted">{rule.rule_type}</span>
              <span>&bull;</span>
              <span>{t('alerts.frequency')}: {rule.frequency}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => remove(rule.id)}
            disabled={pending === rule.id}
            aria-label={t('alerts.removeWatch')}
            title={t('alerts.removeWatch')}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-sm border border-line text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
