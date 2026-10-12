'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

const BUILD_TYPES = ['LIGHTWEIGHT_TOOL', 'MICRO_SAAS', 'CONTENT_SITE', 'DIRECTORY'];
const MARKETS = ['US'];
const TOPICS = ['developer_tools', 'finance', 'marketing', 'operations', 'creator_tools'];

/** A selectable hairline card. The native control stays inside the label so the
 *  whole card is keyboard reachable without a synthetic role. */
const optionCard = (selected: boolean) =>
  cn(
    'flex cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors',
    selected
      ? 'border-accent bg-accent/10 text-fg'
      : 'border-line-control text-fg-muted hover:border-accent hover:text-fg'
  );

export function OnboardingForm({ initialPreferences }: { initialPreferences: any }) {
  const router = useRouter();
  const { updatePreferences } = useAuth();
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [buildTypes, setBuildTypes] = useState<string[]>(initialPreferences.preferredBuildTypes || []);
  const [markets, setMarkets] = useState<string[]>(initialPreferences.preferredMarkets || ['US']);
  const [timeBudget, setTimeBudget] = useState(initialPreferences.preferredTimeBudget || 'TWO_WEEKS');
  const [topics, setTopics] = useState<string[]>(initialPreferences.topics || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = [
    t('onboarding.step1'),
    t('onboarding.step2'),
    t('onboarding.step3'),
    t('onboarding.step4'),
  ];

  async function complete() {
    setSaving(true); setError(null);
    try {
      await updatePreferences({ preferredBuildTypes: buildTypes, preferredMarkets: markets, preferredTimeBudget: timeBudget, topics, onboardingCompleted: true });
      router.push('/feed');
    } catch (err: any) { setError(err.message || t('onboarding.saveError')); } finally { setSaving(false); }
  }

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl items-center px-6 py-12">
      <Panel className="w-full p-6 sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          {t('onboarding.eyebrow')}
        </p>
        <h1 className="mt-3 font-display text-2xl font-bold text-fg">{t('onboarding.title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{labels[step]}</p>
        <ol className="mt-6 flex gap-2" aria-label={t('onboarding.stepsAria')}>
          {labels.map((_, index) => (
            <li
              key={index}
              aria-current={index === step ? 'step' : undefined}
              className={cn('h-1 flex-1', index <= step ? 'bg-accent' : 'bg-line')}
            >
              <span className="sr-only">
                {index === step ? t('onboarding.currentStep') : ''} {index + 1}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-8 space-y-3">
          {step === 0 &&
            BUILD_TYPES.map((value) => (
              <label key={value} className={optionCard(buildTypes.includes(value))}>
                <input
                  type="checkbox"
                  checked={buildTypes.includes(value)}
                  onChange={() => toggle(buildTypes, value, setBuildTypes)}
                />
                {value}
              </label>
            ))}
          {step === 1 &&
            MARKETS.map((value) => (
              <label key={value} className={optionCard(markets.includes(value))}>
                <input
                  type="checkbox"
                  checked={markets.includes(value)}
                  onChange={() => toggle(markets, value, setMarkets)}
                />
                {value} / en-US
              </label>
            ))}
          {step === 2 &&
            ['WEEKEND', 'TWO_WEEKS', 'ONE_MONTH'].map((value) => (
              <label key={value} className={optionCard(timeBudget === value)}>
                <input
                  type="radio"
                  name="time-budget"
                  checked={timeBudget === value}
                  onChange={() => setTimeBudget(value)}
                />
                {value}
              </label>
            ))}
          {step === 3 &&
            TOPICS.map((value) => (
              <label key={value} className={optionCard(topics.includes(value))}>
                <input
                  type="checkbox"
                  checked={topics.includes(value)}
                  onChange={() => toggle(topics, value, setTopics)}
                />
                {value.replace('_', ' ')}
              </label>
            ))}
        </div>

        {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
        <div className="mt-8 flex justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || saving}
          >
            {t('onboarding.back')}
          </Button>
          {step < labels.length - 1 ? (
            <Button
              type="button"
              onClick={() => setStep((current) => Math.min(labels.length - 1, current + 1))}
            >
              {t('onboarding.next')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={complete} disabled={saving}>
              <CheckCircle2 className="h-4 w-4" />
              {saving ? t('onboarding.saving') : t('onboarding.finish')}
            </Button>
          )}
        </div>
      </Panel>
    </main>
  );
}
