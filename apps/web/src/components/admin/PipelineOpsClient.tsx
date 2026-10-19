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
  ExternalLink,
  Radio,
  History,
} from 'lucide-react';
import { AdminPipelineOverview } from '@emeradar/services';
import { safeExternalUrl } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Meter } from '@/components/ui/Meter';
import { Panel } from '@/components/ui/Panel';
import { Stat } from '@/components/ui/Stat';

interface PipelineOpsClientProps {
  initialOverview: AdminPipelineOverview;
}

function staleSourceTone(source: string): BadgeTone {
  if (source === 'COMMERCIAL') return 'warn';
  if (source === 'SERP') return 'info';
  return 'neutral';
}

/**
 * 最新检查点的真实校验结论。
 *
 * 原先这里是写死的一行绿字"默克尔树 SHA-256 存证完整"，无论库里是什么都照亮
 * —— 连一个检查点都没有时也亮。断言不等于验证，所以现在显示服务端**按存储行
 * 重算**出来的结果，四种状态分开渲染：没检查点 / 重算没跑成 / 重算通过 /
 * 重算不一致。
 */
function CheckpointVerdict({
  checkpoint,
}: {
  checkpoint: AdminPipelineOverview['latestCheckpoint'];
}) {
  if (!checkpoint) {
    return (
      <p className="flex items-center gap-1 text-[11px] font-semibold text-fg-subtle">
        <Database className="h-3 w-3" />
        <span>尚无检查点</span>
      </p>
    );
  }

  if (!checkpoint.recomputed) {
    return (
      <p className="flex items-center gap-1 text-[11px] font-semibold text-warn">
        <XCircle className="h-3 w-3" />
        <span>无法重算 —— 该项未通过校验，不等于通过</span>
      </p>
    );
  }

  if (checkpoint.recomputed.verified) {
    return (
      <p className="flex items-center gap-1 text-[11px] font-semibold text-signal">
        <CheckCircle2 className="h-3 w-3" />
        <span>重算通过 · {checkpoint.recomputed.rowCount} 行</span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 text-[11px] font-semibold text-danger">
      <p className="flex items-center gap-1">
        <XCircle className="h-3 w-3" />
        <span>重算不一致 —— 存储根与重算根不符</span>
      </p>
      <p className="font-mono text-[10px] font-normal text-fg-subtle">
        存储 {checkpoint.merkleRoot.slice(0, 12)}… / 重算{' '}
        {checkpoint.recomputed.calculatedMerkleRoot.slice(0, 12)}… ·{' '}
        {checkpoint.recomputed.rowCount}/{checkpoint.totalRecords} 行
      </p>
    </div>
  );
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

  const runStatusTone = (status: string): BadgeTone =>
    status === 'SUCCESS' ? 'signal' : status === 'RUNNING' ? 'info' : 'danger';

  return (
    <div className="space-y-8">
      {/* Header with Refresh */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-fg">
            <Activity className="h-6 w-6 text-accent" />
            <span>雷达运行态势 &amp; 流水线调度</span>
          </h1>
          <p className="mt-1 font-mono text-xs text-fg-subtle">
            Radar Health Watermark &amp; Autonomous Execution Hub
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refreshData}
          disabled={isRefreshing}
        >
          <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>刷新大屏</span>
        </Button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Candidate Pool */}
        <Panel tone="raised" className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <Stat
              value={overview.opportunityStats.candidate}
              unit="个处于观测期"
              label="CANDIDATE POOL"
              tone="warn"
            />
            <Layers className="h-4 w-4 text-warn" />
          </div>
          <p className="text-[11px] text-fg-subtle">全网长尾词嗅探沉淀的原始候选</p>
        </Panel>

        {/* Tracked / Published */}
        <Panel tone="raised" className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <Stat
              value={overview.opportunityStats.tracked}
              unit="个高置信度"
              label="PUBLISHED"
              tone="signal"
            />
            <CheckCircle2 className="h-4 w-4 text-signal" />
          </div>
          <p className="text-[11px] text-fg-subtle">已进入前台 Feed 供构建者消费</p>
        </Panel>

        {/* Cost Watermark */}
        <Panel tone="raised" className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <Stat
              value={`$${overview.costTodayUsd.toFixed(2)}`}
              unit={`/ $${overview.dailyBudgetLimitUsd.toFixed(2)} 熔断线`}
              label="API COST TODAY"
            />
            <DollarSign className="h-4 w-4 text-fg-muted" />
          </div>
          <Meter
            value={overview.costTodayUsd}
            max={overview.dailyBudgetLimitUsd}
            tone={costPercentage > 80 ? 'warn' : 'accent'}
          />
        </Panel>

        {/* Ledger Integrity */}
        <Panel tone="raised" className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <Stat
              value={overview.latestCheckpoint?.obsDate || 'GENESIS'}
              label="LEDGER CHECKPOINT"
            />
            <ShieldCheck className="h-4 w-4 text-info" />
          </div>
          <p className="truncate font-mono text-[10px] text-fg-subtle">
            Root: {overview.latestCheckpoint?.merkleRoot.slice(0, 16) || 'None'}...
          </p>
          <CheckpointVerdict checkpoint={overview.latestCheckpoint} />
        </Panel>
      </div>

      {/* Discovery quality */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
              <Activity className="h-4 w-4 text-accent" />
              <span>发现质量（7 天）</span>
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              关注“用户是否发现了有用的东西”，而不是只看付费转化。
            </p>
          </div>
          <span className="font-mono text-[11px] text-fg-subtle">
            negative rate {(overview.discoveryStats.negativeRate7d * 100).toFixed(1)}%
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat value={overview.discoveryStats.newCandidates7d} unit="条" label="新候选" tone="warn" />
          <Stat value={overview.discoveryStats.helpfulFeedback7d} unit="条" label="有帮助反馈" tone="signal" />
          <Stat value={overview.discoveryStats.negativeFeedback7d} unit="条" label="负面反馈" tone="warn" />
          <Stat value={overview.discoveryStats.candidates} unit="条" label="候选池" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Stat value={overview.discoveryStats.activeSources} unit="个" label="启用源" />
          <Stat value={overview.discoveryStats.sourcesWithRuns24h} unit="个" label="24h 有运行" />
          <Stat value={overview.discoveryStats.candidateMarkets} unit="个" label="候选市场" />
        </div>
        <p className="mt-3 font-mono text-[11px] text-fg-subtle">
          首次反馈时延中位数：{overview.discoveryStats.medianFeedbackLatencyHours === null
            ? '—'
            : `${overview.discoveryStats.medianFeedbackLatencyHours} 小时`}
        </p>
      </Panel>

      {/* Tavily discovery source status */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
              <Radio className="h-4 w-4 text-info" />
              <span>Tavily 搜索状态</span>
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              只用于 discovery/Why Now，不进 W 轴。最近运行、条数与错误都在这里，不用跑 SQL。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={overview.tavily.configured ? 'info' : 'neutral'}>
              {overview.tavily.configured ? (overview.tavily.active ? '已注册' : '已停用') : '未注册'}
            </Badge>
            {overview.tavily.lastStatus && (
              <Badge tone={overview.tavily.lastStatus === 'FAILED' ? 'danger' : 'signal'}>
                {overview.tavily.lastStatus}
              </Badge>
            )}
          </div>
        </div>

        {!overview.tavily.configured ? (
          <p className="mt-4 rounded-sm border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-fg-muted">
            还没有 `src_tavily`。至少需要 `TAVILY_API_KEY` 或 `AISA_API_KEY`，然后运行一次「全网信号捕获」。
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat value={overview.tavily.items24h} unit="条" label="24h 新增" tone="accent" />
              <Stat value={overview.tavily.items7d} unit="条" label="7d 新增" />
              <Stat
                value={overview.tavily.lastItemAt ? new Date(overview.tavily.lastItemAt).toLocaleString('zh-CN') : '—'}
                label="最近一条"
                size="sm"
              />
              <Stat
                value={overview.tavily.lastRunAt ? new Date(overview.tavily.lastRunAt).toLocaleString('zh-CN') : '—'}
                label="最近运行"
                size="sm"
              />
            </div>

            {overview.tavily.lastError && (
              <p className="mt-3 break-all rounded-sm border border-danger/30 bg-danger/5 p-3 font-mono text-[11px] text-danger">
                {overview.tavily.lastError}
              </p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                    <th className="pb-3 font-semibold">STARTED</th>
                    <th className="pb-3 font-semibold">STATUS</th>
                    <th className="pb-3 font-semibold">ITEMS</th>
                    <th className="pb-3 font-semibold">ERROR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line font-mono">
                  {overview.tavily.runs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-fg-subtle">
                        还没有运行记录；触发一次 discover 后这里会出现。
                      </td>
                    </tr>
                  ) : (
                    overview.tavily.runs.map((run) => (
                      <tr key={run.id}>
                        <td className="py-3 text-fg-subtle">
                          {new Date(run.startedAt).toLocaleString('zh-CN')}
                        </td>
                        <td className="py-3">
                          <Badge tone={run.status === 'FAILED' ? 'danger' : run.status === 'SUCCESS' ? 'signal' : 'warn'}>
                            {run.status}
                          </Badge>
                        </td>
                        <td className="py-3 text-fg-muted">{run.itemsCollected}</td>
                        <td className="max-w-md truncate py-3 text-danger/80" title={run.errorMessage ?? undefined}>
                          {run.errorMessage || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {/* Interactive Trigger Hub */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <div className="mb-6 max-w-2xl">
          <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
            <Play className="h-4 w-4 fill-warn text-warn" />
            <span>流水线一键调度指挥台</span>
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            无需通过 SSH 登录服务器，直接在后台手动调度采集、意图派生与每日打分存证。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Step 1: Discover */}
          <Panel tone="sunken" className="flex flex-col justify-between p-4">
            <div>
              <span className="mb-1 block font-mono text-[10px] font-black uppercase tracking-[0.14em] text-accent">
                STEP 01
              </span>
              <h3 className="text-sm font-bold text-fg">捕获全网新信号</h3>
              <p className="mt-1 text-[11px] text-fg-subtle">
                从 Hacker News、RSS 源嗅探最新技术与产品讨论
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => handleTrigger('discover', '全网信号捕获 (discover)')}
              disabled={!!runningTask}
              className="mt-4 w-full"
            >
              {runningTask === '全网信号捕获 (discover)' ? (
                <>
                  <RotateCw className="h-3 w-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  <span>运行 Discover</span>
                </>
              )}
            </Button>
          </Panel>

          {/* Step 2: Generate Intents */}
          <Panel tone="sunken" className="flex flex-col justify-between p-4">
            <div>
              <span className="mb-1 block font-mono text-[10px] font-black uppercase tracking-[0.14em] text-info">
                STEP 02
              </span>
              <h3 className="text-sm font-bold text-fg">派生搜索意图</h3>
              <p className="mt-1 text-[11px] text-fg-subtle">
                将讨论信号转化为 50 个潜在长尾搜索意图假设
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => handleTrigger('generate-intents', '意图假设派生 (generate-intents)')}
              disabled={!!runningTask}
              className="mt-4 w-full"
            >
              {runningTask === '意图假设派生 (generate-intents)' ? (
                <>
                  <RotateCw className="h-3 w-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  <span>生成意图假设</span>
                </>
              )}
            </Button>
          </Panel>

          {/* Step 3: Validate Intents */}
          <Panel tone="sunken" className="flex flex-col justify-between p-4">
            <div>
              <span className="mb-1 block font-mono text-[10px] font-black uppercase tracking-[0.14em] text-warn">
                STEP 03
              </span>
              <h3 className="text-sm font-bold text-fg">验证联想词与供给</h3>
              <p className="mt-1 text-[11px] text-fg-subtle">
                实时请求 Google Suggest 与 SERP 探测供给缺口
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => handleTrigger('validate-intents', '联想与供给验证 (validate-intents)')}
              disabled={!!runningTask}
              className="mt-4 w-full"
            >
              {runningTask === '联想与供给验证 (validate-intents)' ? (
                <>
                  <RotateCw className="h-3 w-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  <span>验证意图假设</span>
                </>
              )}
            </Button>
          </Panel>

          {/* Step 4: Run Daily */}
          <Panel tone="sunken" className="flex flex-col justify-between p-4">
            <div>
              <span className="mb-1 block font-mono text-[10px] font-black uppercase tracking-[0.14em] text-signal">
                STEP 04
              </span>
              <h3 className="text-sm font-bold text-fg">执行每日综合打分</h3>
              <p className="mt-1 text-[11px] text-fg-subtle">
                全量候选 D/M/W 算分、晋升 Tracked 并封存账本
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => handleTrigger('run-daily', '每日全量流水线 (run-daily)')}
              disabled={!!runningTask}
              className="mt-4 w-full"
            >
              {runningTask === '每日全量流水线 (run-daily)' ? (
                <>
                  <RotateCw className="h-3 w-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  <span>执行今日流水线</span>
                </>
              )}
            </Button>
          </Panel>
        </div>

        {/* Live Terminal Output Console */}
        {terminalOutput && (
          <Panel tone="sunken" className="mt-6 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-signal" />
                <span className="font-mono text-xs font-bold text-fg-muted">
                  Worker Execution Output Console
                </span>
              </div>
              {terminalExitCode !== null && (
                <Badge tone={terminalExitCode === 0 ? 'signal' : 'danger'}>
                  Exit Code: {terminalExitCode}
                </Badge>
              )}
            </div>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-signal">
              {terminalOutput}
            </pre>
          </Panel>
        )}
      </Panel>

      {/* Recent Collector Runs */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-fg">
          <Database className="h-4 w-4 text-accent" />
          <span>最近采集任务日志 (Collector Runs)</span>
        </h2>

        {overview.recentCollectorRuns.length === 0 ? (
          <p className="py-4 text-xs text-fg-subtle">暂无采集历史记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                  <th className="pb-3 font-semibold">SOURCE</th>
                  <th className="pb-3 font-semibold">STATUS</th>
                  <th className="pb-3 font-semibold">ITEMS</th>
                  <th className="pb-3 font-semibold">STARTED</th>
                  <th className="pb-3 font-semibold">FINISHED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono">
                {overview.recentCollectorRuns.map((run) => (
                  <tr key={run.id} className="transition hover:bg-surface-2">
                    <td className="py-3 font-medium text-fg">
                      {run.sourceName}
                    </td>
                    <td className="py-3">
                      <Badge tone={runStatusTone(run.status)}>
                        {run.status === 'SUCCESS' && <CheckCircle2 className="h-3 w-3" />}
                        {run.status === 'FAILED' && <XCircle className="h-3 w-3" />}
                        {run.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-fg-muted">
                      {run.itemsCollected} items
                    </td>
                    <td className="py-3 text-fg-subtle">
                      {new Date(run.startedAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="py-3 text-fg-subtle">
                      {run.finishedAt ? new Date(run.finishedAt).toLocaleString('zh-CN') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* STALE_DATA events */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
            <History className="h-4 w-4 text-warn" />
            <span>宽限期降级记录 (STALE_DATA)</span>
          </h2>
          <span className="font-mono text-[11px] text-fg-subtle">
            {overview.recentStaleEvents?.length || 0} 条
          </span>
        </div>

        {!overview.recentStaleEvents || overview.recentStaleEvents.length === 0 ? (
          <p className="py-4 text-xs text-fg-subtle">
            暂无降级记录；采集失败且 72h 内有旧快照时才会出现。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                  <th className="pb-3 font-semibold">DATE</th>
                  <th className="pb-3 font-semibold">OPPORTUNITY</th>
                  <th className="pb-3 font-semibold">SOURCE</th>
                  <th className="pb-3 font-semibold">DOMAIN</th>
                  <th className="pb-3 font-semibold">REFERENCE</th>
                  <th className="pb-3 font-semibold">OBSERVED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono">
                {overview.recentStaleEvents.map((event) => (
                  <tr key={event.id} className="transition hover:bg-surface-2">
                    <td className="py-3 text-fg-subtle">{event.obsDate}</td>
                    <td className="max-w-xs truncate py-3">
                      <a
                        href={`/opportunities/${event.opportunitySlug}`}
                        className="text-accent hover:underline"
                        title={event.opportunityTitle}
                      >
                        {event.opportunityTitle}
                      </a>
                    </td>
                    <td className="py-3">
                      <Badge tone={staleSourceTone(event.source)}>{event.source}</Badge>
                    </td>
                    <td className="py-3 text-fg-muted">{event.domain || '—'}</td>
                    <td className="py-3 text-fg-subtle" title={event.referenceId ?? undefined}>
                      {event.referenceId ? `${event.referenceId.slice(0, 12)}…` : '—'}
                    </td>
                    <td className="py-3 text-fg-subtle">
                      {event.observedAt ? new Date(event.observedAt).toLocaleString('zh-CN') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Live Ingested Discovery Signals */}
      <Panel tone="raised" className="p-6 sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
            <Radio className="h-4 w-4 text-info" />
            <span>最新全网捕获原始商业信号 (Live Discovery Stream)</span>
          </h2>
          <span className="font-mono text-[11px] text-fg-subtle">
            {overview.latestDiscoverySignals?.length || 0} 条实时条目
          </span>
        </div>

        {!overview.latestDiscoverySignals || overview.latestDiscoverySignals.length === 0 ? (
          <p className="py-4 text-xs text-fg-subtle">
            暂无采集条目，请在上方 STEP 01 点击「全网信号捕获」触发采集。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                  <th className="pb-3 font-semibold">SIGNAL</th>
                  <th className="pb-3 font-semibold">PROVIDER</th>
                  <th className="pb-3 font-semibold">COLLECTED</th>
                  <th className="pb-3 text-right font-semibold">SOURCE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overview.latestDiscoverySignals.map((item) => (
                  <tr key={item.id} className="transition hover:bg-surface-2">
                    <td className="max-w-md truncate py-3 font-medium text-fg">
                      {item.title}
                    </td>
                    <td className="py-3">
                      <Badge tone="info">{item.provider}</Badge>
                    </td>
                    <td className="py-3 font-mono text-[11px] text-fg-subtle">
                      {item.collectedAt ? new Date(item.collectedAt).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="py-3 text-right">
                      {item.sourceUrl ? (
                        <a
                          href={safeExternalUrl(item.sourceUrl) ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-accent hover:underline"
                        >
                          <span>查看</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-fg-subtle">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
