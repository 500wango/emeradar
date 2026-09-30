'use client';

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

export function StartExperimentButton({ experimentCardId, title }: { experimentCardId: string; title: string }) {
  const router = useRouter();
  const { isZh } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experimentCardId, title }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || (isZh ? '未能启动实验。' : 'Could not start the experiment.'));
      router.push(`/projects/${data.id}`);
    } catch (err: any) {
      setError(err.message || (isZh ? '未能启动实验。' : 'Could not start the experiment.'));
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        {pending ? (isZh ? '启动中…' : 'Starting…') : (isZh ? '启动实验' : 'Start experiment')}
      </button>
      {error && <p className="mt-2 text-[11px] text-rose-700">{error}</p>}
    </div>
  );
}
