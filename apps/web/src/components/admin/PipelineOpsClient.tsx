'use client';

import React, { useState } from 'react';
import {
  Play,
  RotateCw,
  CheckCircle2,
  XCircle,
  Terminal,
  Activity,
  DollarSign,
  Layers,
  Database,
  ShieldCheck,
} from 'lucide-react';
import { AdminPipelineOverview } from '@emeradar/services';

interface PipelineOpsClientProps {
  initialOverview: AdminPipelineOverview;
}

export function PipelineOpsClient({ initialOverview }: PipelineOpsClientProps) {
  const [overview, setOverview] = useState<AdminPipelineOverview>(initialOverview);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string | null>(null);
  const [terminalExitCode, setTerminalExitCode] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/v1/admin/overview');
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error('Failed to refresh overview:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTrigger = async (
    task: 'discover' | 'generate-intents' | 'validate-intents' | 'run-daily',
    label: string
  ) => {
    setRunningTask(label);
    setTerminalOutput(`[${new Date().toLocaleTimeString()}] Starting ${label} (${task})...\n`);
    setTerminalExitCode(null);

    try {
      const res = await fetch('/api/v1/admin/pipeline/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });

      const data = await res.json();
      setTerminalOutput(
        (prev) =>
          (prev || '') +
          `\n--- EXECUTION OUTPUT (${task}) ---\n${data.output || '(No output returned)'}\n\nTask finished with exit code ${data.exitCode}`
      );
      setTerminalExitCode(data.exitCode);
      await refreshData();
    } catch (err: any) {
      setTerminalOutput((prev) => (prev || '') + `\nExecution failed: ${err.message}`);
      setTerminalExitCode(1);
    } finally {
      setRunningTask(null);
    }
  };

  const costPercentage = Math.min(
    100,
    (overview.costTodayUsd / overview.dailyBudgetLimitUsd) * 100
  );

  return (
    <div className="space-y-8">
      {/* Header with Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-400" />
            <span>雷达运行态势 & 流水线调度</span>
          </h1>
          <p className="mt-1 text-xs text-slate-400 font-mono">
            Radar Health Watermark & Autonomous Execution Hub
          </p>
        </div>

        <button
          onClick={refreshData}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>刷新大屏</span>
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Candidate Pool */}
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              候选生态位池
            </span>
            <Layers className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-400">
              {overview.opportunityStats.candidate}
            </span>
            <span className="text-xs text-slate-400">个处于观测期</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            全网长尾词嗅探沉淀的原始候选
          </p>
        </div>

        {/* Tracked / Published */}
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              已发布决策
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-400">
              {overview.opportunityStats.tracked}
            </span>
            <span className="text-xs text-slate-400">个高置信度</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            已进入前台 Feed 供构建者消费
          </p>
        </div>

        {/* Cost Watermark */}
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              今日 API 成本水位
            </span>
            <DollarSign className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-white font-mono">
              ${overview.costTodayUsd.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400">
              / ${overview.dailyBudgetLimitUsd.toFixed(2)} 熔断线
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-3 w-full bg-slate-700/80 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                costPercentage > 80 ? 'bg-rose-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.max(5, costPercentage)}%` }}
            />
          </div>
        </div>

        {/* Ledger Integrity */}
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              审计账本最新存证
            </span>
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold text-white font-mono">
              {overview.latestCheckpoint?.obsDate || 'Genesis'}
            </div>
            <p className="text-[10px] text-slate-400 font-mono mt-1 truncate">
              Root: {overview.latestCheckpoint?.merkleRoot.slice(0, 16) || 'None'}...
            </p>
          </div>
          <p className="mt-2 text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>默克尔树 SHA-256 存证完整</span>
          </p>
        </div>
      </div>

      {/* Interactive Trigger Hub */}
      <div className="bg-slate-800/40 border border-slate-800 rounded-3xl p-6 sm:p-8">
        <div className="max-w-2xl mb-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Play className="w-4 h-4 text-amber-400 fill-amber-400" />
            <span>流水线一键调度指挥台</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            无需通过 SSH 登录服务器，直接在后台手动调度采集、意图派生与每日打分存证。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Step 1: Discover */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-400 block mb-1">
                STEP 01
              </span>
              <h3 className="text-sm font-bold text-white">捕获全网新信号</h3>
              <p className="text-[11px] text-slate-400 mt-1">
                从 Hacker News、RSS 源嗅探最新技术与产品讨论
              </p>
            </div>
            <button
              onClick={() => handleTrigger('discover', '全网信号捕获 (discover)')}
              disabled={!!runningTask}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
            >
              {runningTask === '全网信号捕获 (discover)' ? (
                <>
                  <RotateCw className="w-3 h-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-white" />
                  <span>运行 Discover</span>
                </>
              )}
            </button>
          </div>

          {/* Step 2: Generate Intents */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-400 block mb-1">
                STEP 02
              </span>
              <h3 className="text-sm font-bold text-white">派生搜索意图</h3>
              <p className="text-[11px] text-slate-400 mt-1">
                将讨论信号转化为 50 个潜在长尾搜索意图假设
              </p>
            </div>
            <button
              onClick={() => handleTrigger('generate-intents', '意图假设派生 (generate-intents)')}
              disabled={!!runningTask}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
            >
              {runningTask === '意图假设派生 (generate-intents)' ? (
                <>
                  <RotateCw className="w-3 h-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-white" />
                  <span>生成意图假设</span>
                </>
              )}
            </button>
          </div>

          {/* Step 3: Validate Intents */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                STEP 03
              </span>
              <h3 className="text-sm font-bold text-white">验证联想词与供给</h3>
              <p className="text-[11px] text-slate-400 mt-1">
                实时请求 Google Suggest 与 SERP 探测供给缺口
              </p>
            </div>
            <button
              onClick={() => handleTrigger('validate-intents', '联想与供给验证 (validate-intents)')}
              disabled={!!runningTask}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
            >
              {runningTask === '联想与供给验证 (validate-intents)' ? (
                <>
                  <RotateCw className="w-3 h-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-white" />
                  <span>验证意图假设</span>
                </>
              )}
            </button>
          </div>

          {/* Step 4: Run Daily */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 block mb-1">
                STEP 04
              </span>
              <h3 className="text-sm font-bold text-white">执行每日综合打分</h3>
              <p className="text-[11px] text-slate-400 mt-1">
                全量候选 D/M/W 算分、晋升 Tracked 并封存账本
              </p>
            </div>
            <button
              onClick={() => handleTrigger('run-daily', '每日全量流水线 (run-daily)')}
              disabled={!!runningTask}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
            >
              {runningTask === '每日全量流水线 (run-daily)' ? (
                <>
                  <RotateCw className="w-3 h-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-white" />
                  <span>执行今日流水线</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Terminal Output Console */}
        {terminalOutput && (
          <div className="mt-6 rounded-2xl bg-black/90 border border-slate-800 overflow-hidden shadow-2xl">
            <div className="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-mono font-bold text-slate-300">
                  Worker Execution Output Console
                </span>
              </div>
              {terminalExitCode !== null && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    terminalExitCode === 0
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  Exit Code: {terminalExitCode}
                </span>
              )}
            </div>
            <pre className="p-4 text-xs font-mono text-emerald-300/90 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {terminalOutput}
            </pre>
          </div>
        )}
      </div>

      {/* Recent Collector Runs */}
      <div className="bg-slate-800/40 border border-slate-800 rounded-3xl p-6 sm:p-8">
        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-blue-400" />
          <span>最近采集任务日志 (Collector Runs)</span>
        </h2>

        {overview.recentCollectorRuns.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">暂无采集历史记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                  <th className="pb-3 font-semibold">采集源</th>
                  <th className="pb-3 font-semibold">状态</th>
                  <th className="pb-3 font-semibold">采集条数</th>
                  <th className="pb-3 font-semibold">启动时间</th>
                  <th className="pb-3 font-semibold">完成时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {overview.recentCollectorRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 font-medium text-white">
                      {run.sourceName}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          run.status === 'SUCCESS'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : run.status === 'RUNNING'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {run.status === 'SUCCESS' && <CheckCircle2 className="w-3 h-3" />}
                        {run.status === 'FAILED' && <XCircle className="w-3 h-3" />}
                        {run.status}
                      </span>
                    </td>
                    <td className="py-3 text-slate-300">
                      {run.itemsCollected} items
                    </td>
                    <td className="py-3 text-slate-400">
                      {new Date(run.startedAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="py-3 text-slate-400">
                      {run.finishedAt ? new Date(run.finishedAt).toLocaleString('zh-CN') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
