import { randomBytes } from 'node:crypto';
import { query } from '@emeradar/db';

/**
 * 采集运行记录（04 §3、§4「失败可见性」）。
 *
 * 之前只有 discovery 写 `collector_runs`；SERP / Autocomplete 的失败只出现在日志里，
 * Admin 看不到核心源的健康状况。这里把一次 collect 调用包成 RUNNING → SUCCESS /
 * PARTIAL / FAILED，记录条数与错误。
 *
 * 不吞异常：FAILED 先落库，再把原始错误抛回调用方，采集器的语义不变。
 */
export interface CollectorOutcomeLike {
  status: 'OK' | 'SKIPPED' | 'FAILED';
  snapshots?: unknown[];
  message?: string;
  errorCode?: string;
  reason?: string;
}

export async function runCollector<T extends CollectorOutcomeLike>(
  sourceId: string,
  itemKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const runId = `run_${sourceId}_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await query(`INSERT INTO collector_runs (id, source_id, status) VALUES ($1, $2, 'RUNNING')`, [
    runId,
    sourceId,
  ]);

  try {
    const outcome = await fn();
    const items = outcome.snapshots?.length ?? 0;
    const status = outcome.status === 'FAILED' ? 'FAILED' : outcome.status === 'SKIPPED' ? 'PARTIAL' : 'SUCCESS';
    const error =
      outcome.status === 'FAILED'
        ? `${outcome.errorCode ?? 'COLLECT_FAILED'}: ${outcome.message ?? 'unknown error'} (${itemKey})`
        : outcome.status === 'SKIPPED'
        ? `SKIPPED: ${outcome.reason ?? 'unknown'} (${itemKey})`
        : null;
    await query(
      `UPDATE collector_runs
          SET status = $2, items_collected = $3, error_message = $4, finished_at = NOW()
        WHERE id = $1`,
      [runId, status, items, error ? error.slice(0, 1000) : null]
    );
    // 供原始载荷归档使用；不改变 collector 的 outcome 契约。
    (outcome as T & { collectorRunId?: string }).collectorRunId = runId;
    return outcome;
  } catch (error) {
    await query(
      `UPDATE collector_runs
          SET status = 'FAILED', error_message = $2, finished_at = NOW()
        WHERE id = $1`,
      [runId, String((error as Error)?.message ?? error).slice(0, 1000)]
    );
    throw error;
  }
}
