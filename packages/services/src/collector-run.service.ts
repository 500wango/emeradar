import { randomBytes } from 'node:crypto';
import { query } from '@emeradar/db';
import { CostLedgerService } from '@emeradar/collectors';

/**
 * 采集运行记录 + 重试 + 熔断（04 §4）。
 *
 * 之前只有 discovery 写 `collector_runs`；SERP / Autocomplete / Crawl 的失败只进
 * 日志，Admin 看不到核心源健康。这里把一次采集包成：
 *   RUNNING →（最多 3 次指数退避）→ SUCCESS / PARTIAL / FAILED
 * 并按 5 分钟窗口的失败率打开 15 分钟熔断。
 *
 * 熔断状态落 `source_circuit_breakers`，因为 worker 是多进程/多实例的，内存状态
 * 无法跨进程；打开期间直接返回 CIRCUIT_OPEN，不再花钱打供应商。
 */
export interface CollectorOutcomeLike {
  status: 'OK' | 'SKIPPED' | 'FAILED';
  snapshots?: unknown[];
  message?: string;
  errorCode?: string;
  reason?: string;
  retryable?: boolean;
  cost?: { costUsd: number; sourceId: string; category: string; units?: number };
}

export interface CollectorRunOptions {
  attempts?: number;
  /** 首次退避基数；测试传 0。 */
  retryBaseMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 500;
const FAILURE_WINDOW_MINUTES = 5;
const MIN_ATTEMPTS_FOR_CIRCUIT = 20;
const FAILURE_RATE_THRESHOLD = 0.5;
const OPEN_MINUTES = 15;

async function isCircuitOpen(sourceId: string): Promise<boolean> {
  const res = await query<{ open: boolean }>(
    `SELECT (open_until IS NOT NULL AND open_until > NOW()) AS open
       FROM source_circuit_breakers WHERE source_id = $1`,
    [sourceId]
  );
  return res.rows[0]?.open === true;
}

/** 熔断判定：5 分钟窗口、≥20 次、失败率 >50% → 打开 15 分钟。 */
async function evaluateCircuit(sourceId: string, finalStatus: CollectorOutcomeLike['status']): Promise<void> {
  try {
    if (finalStatus === 'OK') {
      // 半开探测成功：关闭已经到期的熔断；未到期的打开状态不去动它。
      await query(
        `UPDATE source_circuit_breakers
            SET open_until = NULL, updated_at = NOW()
          WHERE source_id = $1 AND open_until IS NOT NULL AND open_until <= NOW()`,
        [sourceId]
      );
      return;
    }
    if (finalStatus !== 'FAILED') return;

    const stats = await query<{ total: number; failed: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
         FROM collector_runs
        WHERE source_id = $1
          AND started_at > NOW() - ($2 || ' minutes')::interval`,
      [sourceId, String(FAILURE_WINDOW_MINUTES)]
    );
    const { total, failed } = stats.rows[0] ?? { total: 0, failed: 0 };
    if (total >= MIN_ATTEMPTS_FOR_CIRCUIT && failed / total > FAILURE_RATE_THRESHOLD) {
      await query(
        `INSERT INTO source_circuit_breakers (source_id, open_until, opened_at, updated_at)
         VALUES ($1, NOW() + ($2 || ' minutes')::interval, NOW(), NOW())
         ON CONFLICT (source_id) DO UPDATE SET
           open_until = EXCLUDED.open_until,
           opened_at = EXCLUDED.opened_at,
           updated_at = NOW()`,
        [sourceId, String(OPEN_MINUTES)]
      );
    }
  } catch (error) {
    // 熔断状态失败不能影响采集本身。
    console.warn(`[collector] circuit evaluation failed for ${sourceId}:`, error instanceof Error ? error.message : error);
  }
}

function backoffMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
}

export async function runCollector<T extends CollectorOutcomeLike>(
  sourceId: string,
  itemKey: string,
  fn: () => Promise<T>,
  options: CollectorRunOptions = {}
): Promise<T> {
  if (await isCircuitOpen(sourceId)) {
    return {
      status: 'FAILED',
      retryable: false,
      errorCode: 'CIRCUIT_OPEN',
      message: `Circuit open for ${sourceId}; skipped without calling the provider.`,
    } as unknown as T;
  }

  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const runId = `run_${sourceId}_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await query(`INSERT INTO collector_runs (id, source_id, status) VALUES ($1, $2, 'RUNNING')`, [
    runId,
    sourceId,
  ]);

  try {
    let outcome: T | undefined;
    let used = 0;
    while (used < attempts) {
      used++;
      outcome = await fn();
      if (outcome.status !== 'SKIPPED' && outcome.cost) {
        await CostLedgerService.recordCost(outcome.cost as any);
      }
      if (outcome.status !== 'FAILED' || !outcome.retryable) break;
      if (used < attempts) await new Promise((resolve) => setTimeout(resolve, backoffMs(used, baseMs)));
    }

    const final = outcome as T;
    const items = final.snapshots?.length ?? 0;
    const status =
      final.status === 'FAILED' ? 'FAILED' : final.status === 'SKIPPED' ? 'PARTIAL' : 'SUCCESS';
    const error =
      final.status === 'FAILED'
        ? `${final.errorCode ?? 'COLLECT_FAILED'}: ${final.message ?? 'unknown error'} (${itemKey}, ${used}/${attempts})`
        : final.status === 'SKIPPED'
        ? `SKIPPED: ${final.reason ?? 'unknown'} (${itemKey})`
        : null;

    await query(
      `UPDATE collector_runs
          SET status = $2, items_collected = $3, error_message = $4, finished_at = NOW()
        WHERE id = $1`,
      [runId, status, items, error ? error.slice(0, 1000) : null]
    );
    // 供原始载荷归档使用；不改变 collector 的 outcome 契约。
    (final as T & { collectorRunId?: string }).collectorRunId = runId;
    await evaluateCircuit(sourceId, final.status);
    return final;
  } catch (error) {
    await query(
      `UPDATE collector_runs
          SET status = 'FAILED', error_message = $2, finished_at = NOW()
        WHERE id = $1`,
      [runId, String((error as Error)?.message ?? error).slice(0, 1000)]
    );
    await evaluateCircuit(sourceId, 'FAILED');
    throw error;
  }
}
