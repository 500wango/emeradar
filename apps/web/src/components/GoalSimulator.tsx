'use client';

import React, { useState } from 'react';
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

interface GoalSimulatorProps {
  data: SectionGoalSimulator;
  primaryQuery?: string;
}

export function GoalSimulator({ data, primaryQuery }: GoalSimulatorProps) {
  const { isZh } = useI18n();

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

  const getKgrBadge = (kgr: number) => {
    if (kgr < 0.25) {
      return {
        label: isZh ? '极佳 (<0.25 快速上词)' : 'Excellent (<0.25 Fast Rank)',
        color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    } else if (kgr <= 1.0) {
      return {
        label: isZh ? '中等 (0.25~1.0 有机会)' : 'Moderate (0.25~1.0 Viable)',
        color: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    }
    return {
      label: isZh ? '偏难 (>1.0 需强外链)' : 'High (>1.0 Needs Strong Links)',
      color: 'bg-rose-50 text-rose-700 border-rose-200',
    };
  };

  const kgrBadge = getKgrBadge(data.kgrRatio);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
      {/* Title & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-wider mb-1">
            <Calculator className="w-4 h-4" />
            <span>{isZh ? '独立开发者目标拆解与 ROI 模拟器' : 'Builder Goal & Unit Economics Simulator'}</span>
          </div>
          <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
            {isZh ? '从 $MRR 目标反推 SEO 流量与外链预算' : 'Reverse Engineer $MRR to Traffic & Link Budget'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {isZh
              ? `针对${primaryQuery ? `「${primaryQuery}」` : '目标词'}，基于 Ahrefs KD 对照曲线、KGR 与阶梯外链成本模型直接推算盈亏平衡点。`
              : `Targeting ${primaryQuery ? `"${primaryQuery}"` : 'target query'}, deterministic modeling based on Ahrefs KD curve, KGR, and tiered backlink costs.`}
          </p>
        </div>

        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors self-start sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{isZh ? '重置基准' : 'Reset'}</span>
        </button>
      </div>

      {/* Simulator Inputs Grid */}
      <div className="grid md:grid-cols-3 gap-6 p-5 rounded-2xl bg-slate-50/80 border border-slate-200/80">
        {/* Slider: Monthly Revenue Target */}
        <div className="space-y-2 md:col-span-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              {isZh ? '月度目标营收 (Monthly Target)' : 'Monthly Revenue Target'}
            </span>
            <span className="font-mono font-bold text-sm text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              ${monthlyTarget.toLocaleString()} / mo
            </span>
          </div>
          <input
            type="range"
            min={500}
            max={10000}
            step={100}
            value={monthlyTarget}
            onChange={(e) => setMonthlyTarget(Number(e.target.value))}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>$500</span>
            <span>$2,500</span>
            <span>$5,000</span>
            <span>$7,500</span>
            <span>$10,000</span>
          </div>
        </div>

        {/* Pricing Model / ARPU */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-700">
            {isZh ? '客单价 / 月付 ARPU' : 'Monthly ARPU / Price'}
          </label>
          <div className="grid grid-cols-4 gap-1">
            {[19, 29, 49, 99].map((p) => (
              <button
                key={p}
                onClick={() => setArpu(p)}
                className={`py-1.5 text-xs font-semibold rounded-md border transition-all ${
                  arpu === p
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                ${p}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-400">
            {isZh ? '转化率基准: 2.0% 注册付费' : 'Baseline conversion: 2.0%'}
          </div>
        </div>
      </div>

      {/* Dynamic Results Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Visitors Needed */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <div className="text-slate-500 text-xs font-medium mb-1 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>{isZh ? '每月需独立访问 (UV)' : 'Monthly UV Needed'}</span>
          </div>
          <div className="text-xl font-extrabold text-slate-900 font-mono">
            ~{uvNeeded.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {isZh
              ? `支撑 ${customersNeeded} 位有效付费用户`
              : `To acquire ${customersNeeded} paying users`}
          </p>
        </div>

        {/* Card 2: Cluster Search Volume Needed */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <div className="text-slate-500 text-xs font-medium mb-1 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
            <span>{isZh ? '对应词簇总搜索量' : 'Cluster Volume Target'}</span>
          </div>
          <div className="text-xl font-extrabold text-slate-900 font-mono">
            ~{clusterSearchVolumeNeeded.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {isZh ? '假定排入 Top 3 (平均 CTR 28%)' : 'Assuming Top 3 ranks (28% CTR)'}
          </p>
        </div>

        {/* Card 3: Backlink Budget */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <div className="text-slate-500 text-xs font-medium mb-1 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-indigo-500" />
            <span>{isZh ? '阶梯外链预估预算' : 'Tiered Link Budget'}</span>
          </div>
          <div className="text-xl font-extrabold text-indigo-600 font-mono">
            ${linkCostLow.toLocaleString()} ~ ${linkCostHigh.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {isZh
              ? `${data.requiredDomainsLow}~${data.requiredDomainsHigh} 条独立 RD (@$100~125/条)`
              : `${data.requiredDomainsLow}~${data.requiredDomainsHigh} referring domains`}
          </p>
        </div>

        {/* Card 4: Breakeven Time */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <div className="text-slate-500 text-xs font-medium mb-1 flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>{isZh ? '外链成本收回周期' : 'Breakeven Payback'}</span>
          </div>
          <div className="text-xl font-extrabold text-emerald-600 font-mono">
            ~{breakevenMonths} {isZh ? '个月' : 'mos'}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {isZh ? '基于 70% 稳态毛利折算' : 'Based on 70% gross margin'}
          </p>
        </div>
      </div>

      {/* Competitive Benchmark Block: KD vs Domains vs KGR */}
      <div className="grid md:grid-cols-2 gap-4 pt-2">
        {/* Ahrefs Calibrated Difficulty */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/60 border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-slate-500" />
              {isZh ? 'Ahrefs 标定难度与域名评级要求' : 'Ahrefs Calibrated KD & Target DR'}
            </span>
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-800">
              KD {data.estimatedKd} / 100
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center text-slate-600">
              <span>{isZh ? '建议目标域名评级 (Target DR):' : 'Target Domain Rating:'}</span>
              <strong className="font-mono text-slate-900">{data.targetDrRange}</strong>
            </div>
            <div className="flex justify-between items-center text-slate-600">
              <span>{isZh ? '排入前 10 需关联独立域名 (RD):' : 'Required Referring Domains:'}</span>
              <strong className="font-mono text-slate-900">
                {data.requiredDomainsLow} ~ {data.requiredDomainsHigh} domains
              </strong>
            </div>
          </div>

          {/* KD Visual Bar */}
          <div className="mt-3.5">
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  data.estimatedKd < 30
                    ? 'bg-emerald-500'
                    : data.estimatedKd < 60
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
                style={{ width: `${data.estimatedKd}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-mono">
              <span>Easy (0-29)</span>
              <span>Medium (30-59)</span>
              <span>Hard (60-100)</span>
            </div>
          </div>
        </div>

        {/* KGR & EKGR Ratio Analysis */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/60 border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              {isZh ? '长尾黄金比例 (KGR & EKGR)' : 'Keyword Golden Ratio (KGR)'}
            </span>
            <span
              className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${kgrBadge.color}`}
            >
              {kgrBadge.label}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center text-slate-600">
              <span>KGR = allintitle / monthly search:</span>
              <strong className="font-mono text-slate-900">
                {data.kgrRatio.toFixed(3)}
              </strong>
            </div>
            <div className="flex justify-between items-center text-slate-600">
              <span>EKGR (含难度加权扩展):</span>
              <strong className="font-mono text-slate-900">
                {data.ekgrRatio.toFixed(3)}
              </strong>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-200/60 leading-relaxed">
            {isZh
              ? '💡 KGR < 0.25 意味着当 Google 收录你的新页面时，极有可能在前 50 名乃至前几页迅速获得曝光。'
              : '💡 KGR < 0.25 indicates that once indexed by Google, your new page is highly likely to rank in the top 50 immediately.'}
          </p>
        </div>
      </div>

      {/* Assumptions & Methodology Footer */}
      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-150 text-[11px] text-slate-500 space-y-1">
        <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
          <span>{isZh ? '模型假设与计算规则' : 'Modeling Assumptions'}</span>
        </div>
        {data.assumptions.map((item, idx) => (
          <div key={idx} className="flex items-start gap-1.5">
            <span className="text-slate-400">•</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
