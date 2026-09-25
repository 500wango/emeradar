import React from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface CommercialProofPanelProps {
  stage: string;
  gateways?: string[];
  plansCount?: number;
}

export function CommercialProofPanel({
  stage,
  gateways = ['Stripe'],
  plansCount = 2,
}: CommercialProofPanelProps) {
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
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">•</span>
              <span>
                <strong>基准定价模型存在：</strong>竞品已公开标注文档与套餐（已识别 {plansCount} 个套餐），市场有先验价格锚点。
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">•</span>
              <span>
                <strong>真实支付基建在线：</strong>检测到活跃支付网关（{gateways.join(', ') || 'Stripe'}），证明其并非纯概念站点，已具备收款能力。
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">•</span>
              <span>
                <strong>商业意图明确：</strong>目标受众在搜索此长尾词时，存在向商业工具转化的既有心理预期。
              </span>
            </li>
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
                <strong>不能证明营收规模与盈利：</strong>公开定价不等于真实经常性收入（ARR），不能断定竞品目前盈利或盈亏平衡。
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 font-bold">•</span>
              <span>
                <strong>不能保证客户留存率：</strong>竞品可能面临高流失率（High Churn），需通过差异化功能与更好体验留存用户。
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
