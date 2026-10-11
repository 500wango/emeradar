'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';

const BUILD_TYPES = ['LIGHTWEIGHT_TOOL', 'MICRO_SAAS', 'CONTENT_SITE', 'DIRECTORY'];
const MARKETS = ['US'];
const TOPICS = ['developer_tools', 'finance', 'marketing', 'operations', 'creator_tools'];

export function OnboardingForm({ initialPreferences }: { initialPreferences: any }) {
  const router = useRouter();
  const { updatePreferences } = useAuth();
  const { isZh } = useI18n();
  const [step, setStep] = useState(0);
  const [buildTypes, setBuildTypes] = useState<string[]>(initialPreferences.preferredBuildTypes || []);
  const [markets, setMarkets] = useState<string[]>(initialPreferences.preferredMarkets || ['US']);
  const [timeBudget, setTimeBudget] = useState(initialPreferences.preferredTimeBudget || 'TWO_WEEKS');
  const [topics, setTopics] = useState<string[]>(initialPreferences.topics || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = isZh
    ? ['选择出货形态', '选择研究市场', '设置时间预算', '选择关注主题']
    : ['Choose a build shape', 'Choose a research market', 'Set your time budget', 'Choose topics'];

  async function complete() {
    setSaving(true); setError(null);
    try {
      await updatePreferences({ preferredBuildTypes: buildTypes, preferredMarkets: markets, preferredTimeBudget: timeBudget, topics, onboardingCompleted: true });
      router.push('/feed');
    } catch (err: any) { setError(err.message || (isZh ? '保存偏好失败。' : 'Could not save preferences.')); } finally { setSaving(false); }
  }

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">{isZh ? '首次设置' : 'First-run setup'}</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{isZh ? '让决策流符合你的构建约束' : 'Tune the decision feed to your constraints'}</h1>
        <p className="mt-2 text-sm text-slate-500">{labels[step]}</p>
        <ol className="mt-6 flex gap-2" aria-label={isZh ? '设置步骤' : 'Setup steps'}>{labels.map((_, index) => <li key={index} aria-current={index === step ? 'step' : undefined} className={`h-1.5 flex-1 rounded-full ${index <= step ? 'bg-blue-600' : 'bg-slate-200'}`}><span className="sr-only">{index === step ? (isZh ? '当前步骤' : 'Current step') : ''} {index + 1}</span></li>)}</ol>

        <div className="mt-8 space-y-3">
          {step === 0 && BUILD_TYPES.map((value) => <label key={value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={buildTypes.includes(value)} onChange={() => toggle(buildTypes, value, setBuildTypes)} />{value}</label>)}
          {step === 1 && MARKETS.map((value) => <label key={value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700"><input type="checkbox" checked={markets.includes(value)} onChange={() => toggle(markets, value, setMarkets)} />{value} / en-US</label>)}
          {step === 2 && ['WEEKEND', 'TWO_WEEKS', 'ONE_MONTH'].map((value) => <label key={value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700"><input type="radio" name="time-budget" checked={timeBudget === value} onChange={() => setTimeBudget(value)} />{value}</label>)}
          {step === 3 && TOPICS.map((value) => <label key={value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={topics.includes(value)} onChange={() => toggle(topics, value, setTopics)} />{value.replace('_', ' ')}</label>)}
        </div>

        {error && <p className="mt-4 text-sm text-rose-700" role="alert">{error}</p>}
        <div className="mt-8 flex justify-between gap-3">
          <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || saving} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{isZh ? '上一步' : 'Back'}</button>
          {step < labels.length - 1 ? <button type="button" onClick={() => setStep((current) => Math.min(labels.length - 1, current + 1))} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{isZh ? '下一步' : 'Next'}<ArrowRight className="h-4 w-4" /></button> : <button type="button" onClick={complete} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><CheckCircle2 className="h-4 w-4" />{saving ? (isZh ? '保存中' : 'Saving') : (isZh ? '进入决策流' : 'Open the feed')}</button>}
        </div>
      </section>
    </main>
  );
}
