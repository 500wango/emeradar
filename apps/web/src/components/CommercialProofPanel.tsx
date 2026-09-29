import React from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface CommercialProofPanelProps {
  stage?: string;
  gateways?: string[];
  plansCount?: number;
}

export function CommercialProofPanel({
  stage = 'NONE',
  gateways = [],
  plansCount = 0,
}: CommercialProofPanelProps) {
  const observedCommercial = plansCount > 0 || gateways.length > 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <span>商业佐证双面板 (Commercial Proof Double-Panel)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            PRD F7 事实护栏：严格区分可信证据边界，防止虚假繁荣误判
          </p>
        </div>
        <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
          阶段：{stage}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Left Panel: What This Proves */}
        <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/80">
          <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs uppercase tracking-wider mb-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>此信号能证明什么 (What This Proves)</span>
          </div>
          <ul className="space-y-2 text-xs text-emerald-950">
            {observedCommercial ? (
              <>
                {plansCount > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold">•</span>
                    <span>
                      Observed pricing on file: {plansCount} plan{plansCount === 1 ? '' : 's'}. This is a price anchor, not revenue.
                    </span>
                  </li>
                )}
                {gateways.length > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold">•</span>
                    <span>
                      Checkout infrastructure observed: {gateways.join(', ')}. A payment button proves the provider is present.
                    </span>
                  </li>
                )}
              </>
            ) : (
              <li className="flex items-start gap-2">
                <span className="text-emerald-500 font-bold">•</span>
                <span>
                  No observed pricing or checkout is stored for this opportunity. Stage on file: {stage}.
                </span>
              </li>
            )}
          </ul>
        </div>

        {/* Right Panel: What This Does NOT Prove */}
        <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200/80">
          <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wider mb-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>此信号不能证明什么 (What This Does NOT Prove)</span>
          </div>
          <ul className="space-y-2 text-xs text-amber-950">
            <li className="flex items-start gap-2">
              <span className="text-amber-500 font-bold">•</span>
              <span>
                Observed prices and payment buttons do not prove revenue, profit, or retention.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 font-bold">•</span>
              <span>
                A commercial word in the query is inferred intent. It does not prove anyone is paying.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 font-bold">•</span>
              <span>
                <strong>不能替代自有用户验证：</strong>仍需遵循 14 天 MVP 纪律，在本地快速上线后获取首批自有用量与反馈。
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
