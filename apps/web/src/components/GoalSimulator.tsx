'use client';

import { useState } from 'react';
import {
  Calculator,
  Target,
  DollarSign,
  TrendingUp,
  Link2,
  ShieldAlert,
  Sparkles,
  RotateCcw,
  BarChart2,
  Zap,
} from 'lucide-react';
import { SectionGoalSimulator } from '@emeradar/report';
import { useI18n } from '@/lib/i18n';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';

interface GoalSimulatorProps {
  data: SectionGoalSimulator;
  primaryQuery?: string;
}

export function GoalSimulator({ data, primaryQuery }: GoalSimulatorProps) {
  const { t } = useI18n();

  const [monthlyTarget, setMonthlyTarget] = useState<number>(
    data.defaultMonthlyTargetUSD || 2000
  );
  const [arpu, setArpu] = useState<number>(29);
  const [conversionRate, setConversionRate] = useState<number>(0.02); // 2%

  // Derived calculations
  const customersNeeded = Math.ceil(monthlyTarget / arpu);
  const uvNeeded = Math.ceil(customersNeeded / conversionRate);
  const organicClicksTarget = uvNeeded;
  const ctrTop3 = 0.28;
  const clusterSearchVolumeNeeded = Math.ceil(organicClicksTarget / ctrTop3);

  // Link acquisition budgets
  const linkCostLow = data.requiredDomainsLow * 100;
  const linkCostHigh = Math.round(data.requiredDomainsHigh * 125);
  const linkCostAvg = Math.round((linkCostLow + linkCostHigh) / 2);

  // Estimated Breakeven (assuming 70% gross margin)
  const monthlyGrossProfit = monthlyTarget * 0.7;
  const breakevenMonths =
    monthlyGrossProfit > 0
      ? (linkCostAvg / monthlyGrossProfit).toFixed(1)
      : '0.0';

  const handleReset = () => {
    setMonthlyTarget(data.defaultMonthlyTargetUSD || 2000);
    setArpu(29);
    setConversionRate(0.02);
  };

  const getKgrBadge = (kgr: number): { label: string; tone: BadgeTone } => {
    if (kgr < 0.25) {
      return { label: t('goalSim.kgrExcellent'), tone: 'signal' };
    } else if (kgr <= 1.0) {
      return { label: t('goalSim.kgrModerate'), tone: 'warn' };
    }
    return { label: t('goalSim.kgrHigh'), tone: 'danger' };
  };

  const kgrBadge = getKgrBadge(data.kgrRatio);
  const kdTone: BadgeTone = data.estimatedKd < 30 ? 'signal' : data.estimatedKd < 60 ? 'warn' : 'danger';
  const kdLabel =
    data.estimatedKd < 30 ? t('goalSim.kdEasy') : data.estimatedKd < 60 ? t('goalSim.kdMedium') : t('goalSim.kdHard');

  return (
    <Panel className="space-y-6 p-6 sm:p-8">
      {/* Title & Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.18em] text-info">
            <Calculator className="h-4 w-4" />
            <span>{t('goalSim.eyebrow')}</span>
          </div>
          <h3 className="text-xl font-extrabold tracking-tight text-fg">
            {t('goalSim.title')}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {primaryQuery ? t('goalSim.descWithQuery', { query: primaryQuery }) : t('goalSim.desc')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 self-start rounded-sm border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:self-auto"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{t('goalSim.reset')}</span>
        </button>
      </div>

      {/* Explicit provenance: every figure below is a modelled assumption, not an observation. */}
      <p className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
        {t('goalSim.disclaimer')}
      </p>

      {/* Simulator Inputs Grid */}
      <div className="grid gap-6 rounded-sm border border-line bg-surface-2 p-5 md:grid-cols-3">
        {/* Slider: Monthly Revenue Target */}
        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="goal-monthly-target" className="flex items-center gap-1.5 font-semibold text-fg-muted">
              <DollarSign className="h-3.5 w-3.5 text-signal" />
              {t('goalSim.monthlyTargetLabel')}
            </label>
            <span className="rounded-sm border border-signal/40 bg-signal/10 px-2 py-0.5 font-mono text-sm font-bold text-signal">
              ${monthlyTarget.toLocaleString()} / mo
            </span>
          </div>
          <input
            id="goal-monthly-target"
            name="monthlyTarget"
            aria-describedby="goal-monthly-target-range"
            type="range"
            min={500}
            max={10000}
            step={100}
            value={monthlyTarget}
            onChange={(e) => setMonthlyTarget(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-line accent-accent"
          />
          <div id="goal-monthly-target-range" className="flex justify-between font-mono text-[10px] text-fg-subtle">
            <span>$500</span>
            <span>$2,500</span>
            <span>$5,000</span>
            <span>$7,500</span>
            <span>$10,000</span>
          </div>
        </div>

        {/* Pricing Model / ARPU */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-fg-muted">
            {t('goalSim.arpuLabel')}
          </label>
          <div className="grid grid-cols-4 gap-1">
            {[19, 29, 49, 99].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setArpu(p)}
                className={`rounded-sm border py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  arpu === p
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-line bg-surface text-fg-muted hover:text-fg'
                }`}
              >
                ${p}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-fg-subtle">
            {t('goalSim.conversionNote')}
          </div>
        </div>
      </div>

      {/* Dynamic Results Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Visitors Needed */}
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
            <Zap className="h-3.5 w-3.5 text-warn" />
            <span>{t('goalSim.uvLabel')}</span>
          </div>
          <div className="font-mono text-xl font-extrabold text-fg">
            ~{uvNeeded.toLocaleString()}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {t('goalSim.uvDesc', { count: customersNeeded })}
          </p>
        </div>

        {/* Card 2: Cluster Search Volume Needed */}
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
            <TrendingUp className="h-3.5 w-3.5 text-accent" />
            <span>{t('goalSim.clusterLabel')}</span>
          </div>
          <div className="font-mono text-xl font-extrabold text-fg">
            ~{clusterSearchVolumeNeeded.toLocaleString()}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {t('goalSim.clusterDesc')}
          </p>
        </div>

        {/* Card 3: Backlink Budget */}
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
            <Link2 className="h-3.5 w-3.5 text-info" />
            <span>{t('goalSim.linkBudgetLabel')}</span>
          </div>
          <div className="font-mono text-xl font-extrabold text-info">
            ${linkCostLow.toLocaleString()} ~ ${linkCostHigh.toLocaleString()}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {t('goalSim.linkBudgetDesc', { low: data.requiredDomainsLow, high: data.requiredDomainsHigh })}
          </p>
        </div>

        {/* Card 4: Breakeven Time */}
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
            <BarChart2 className="h-3.5 w-3.5 text-signal" />
            <span>{t('goalSim.breakevenLabel')}</span>
          </div>
          <div className="font-mono text-xl font-extrabold text-signal">
            ~{breakevenMonths} {t('goalSim.breakevenUnit')}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {t('goalSim.breakevenDesc')}
          </p>
        </div>
      </div>

      {/* Competitive Benchmark Block: KD vs Domains vs KGR */}
      <div className="grid gap-4 pt-2 md:grid-cols-2">
        {/* Ahrefs Calibrated Difficulty */}
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-bold text-fg-muted">
              <Target className="h-3.5 w-3.5 text-fg-subtle" />
              {t('goalSim.kdTitle')}
            </span>
            <Badge tone={kdTone}>{`KD ${data.estimatedKd} · ${kdLabel}`}</Badge>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between text-fg-muted">
              <span>{t('goalSim.targetDr')}</span>
              <strong className="font-mono text-fg">{data.targetDrRange}</strong>
            </div>
            <div className="flex items-center justify-between text-fg-muted">
              <span>{t('goalSim.requiredRd')}</span>
              <strong className="font-mono text-fg">
                {data.requiredDomainsLow} ~ {data.requiredDomainsHigh}
              </strong>
            </div>
          </div>
        </div>

        {/* KGR & EKGR Ratio Analysis */}
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-bold text-fg-muted">
              <Sparkles className="h-3.5 w-3.5 text-warn" />
              {t('goalSim.kgrTitle')}
            </span>
            <Badge tone={kgrBadge.tone}>{kgrBadge.label}</Badge>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between text-fg-muted">
              <span>KGR = allintitle / monthly search:</span>
              <strong className="font-mono text-fg">
                {data.kgrRatio.toFixed(3)}
              </strong>
            </div>
            <div className="flex items-center justify-between text-fg-muted">
              <span>{t('goalSim.ekgrLabel')}</span>
              <strong className="font-mono text-fg">
                {data.ekgrRatio.toFixed(3)}
              </strong>
            </div>
          </div>

          <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-fg-subtle">
            {t('goalSim.kgrNote')}
          </p>
        </div>
      </div>

      {/* Assumptions & Methodology Footer */}
      <div className="space-y-1 rounded-sm border border-line bg-surface-2 p-3.5 text-[11px] text-fg-subtle">
        <div className="mb-1 flex items-center gap-1 font-semibold text-fg-muted">
          <ShieldAlert className="h-3.5 w-3.5 text-fg-subtle" />
          <span>{t('goalSim.assumptionsTitle')}</span>
        </div>
        {data.assumptions.map((item, idx) => (
          <div key={idx} className="flex items-start gap-1.5">
            <span className="text-fg-subtle">•</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
