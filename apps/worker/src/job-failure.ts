import { AuditService, sendTransactionalEmail } from '@emeradar/services';
import { query } from '@emeradar/db';
import type { TaskSpec } from './tasks';

/**
 * 任务成败的落账与告警。
 *
 * 此前后台任务的失败只有一个归宿：stdout。容器日志会轮转（`max-size: 10m,
 * max-file: 3`），宿主机 cron 的 `>> /var/log/...` 同样会轮转——也就是说，
 * "昨晚的管线失败了"这件事在两天后**不存在任何记录**。管线连着失败一周，唯一
 * 的痕迹是公开账本停止了推进，而账本停止推进看起来和"今天没有机会"一模一样。
 *
 * 所以每次执行都写一条 `audit_log`（`SYSTEM` 身份），失败按**连续失败次数**决定
 * 是否发信。连续计数从审计表本身推出来，不额外维护状态：进程随时可以重启，而
 * "上次成功之后失败了几次"必须跨越重启仍然成立。
 */

export interface JobOutcome {
  task: TaskSpec;
  jobId: string;
  attempt: number;
  durationMs: number;
  error?: unknown;
}

/**
 * 重试次数耗尽、落进死信队列。
 *
 * 这里**不再发一封邮件**：同一个任务的失败在重试过程中已经发过了（见
 * `recordJobFailure` 的阈值），再发一封只是把一封邮件变成两封，而人对重复邮件的
 * 反应是给这个发件人建一条过滤器。落账加一行响亮的日志即可，死信本身就是证据。
 */
export async function recordDeadLetter(jobId: string, command: string, payload: unknown): Promise<void> {
  await AuditService.log({
    actorId: null,
    actorType: 'SYSTEM',
    action: 'job.dead_lettered',
    targetType: 'JOB',
    targetId: command,
    payload: { jobId, payload: payload ?? null },
  });
}

export async function recordJobSuccess(outcome: JobOutcome): Promise<void> {
  // Unlike best-effort security auditing, this receipt must persist before ack.
  await query(
    `INSERT INTO audit_log (id, actor_type, action, target_type, target_id, payload)
     VALUES ($1, 'SYSTEM', 'job.succeeded', 'JOB', $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [`job_${outcome.jobId}`, outcome.task.command, JSON.stringify({
      jobId: outcome.jobId, attempt: outcome.attempt, durationMs: outcome.durationMs,
    })]
  );
}

/**
 * 记下这次失败；达到阈值时发一封告警邮件。
 *
 * 邮件发送失败**不抛错**：审计记录已经落库，告警渠道自己是坏的时候不该把任务
 * 的失败状态再搅浑一次。
 */
export async function recordJobFailure(outcome: JobOutcome): Promise<{
  consecutiveFailures: number;
  alerted: boolean;
}> {
  const message = describeError(outcome.error);

  await AuditService.log({
    actorId: null,
    actorType: 'SYSTEM',
    action: 'job.failed',
    targetType: 'JOB',
    targetId: outcome.task.command,
    payload: {
      jobId: outcome.jobId,
      attempt: outcome.attempt,
      durationMs: outcome.durationMs,
      error: message,
    },
  });

  const consecutiveFailures = await countConsecutiveFailures(outcome.task.command);

  if (consecutiveFailures < outcome.task.alertAfterFailures) {
    return { consecutiveFailures, alerted: false };
  }

  const recipients = await resolveAlertRecipients();
  const subject = `[emeradar] 后台任务 ${outcome.task.command} 连续失败 ${consecutiveFailures} 次`;
  const text = [
    `任务：${outcome.task.command}（${outcome.task.description}）`,
    `连续失败：${consecutiveFailures} 次（告警阈值 ${outcome.task.alertAfterFailures}）`,
    `本次是第 ${outcome.attempt + 1} 次执行，耗时 ${Math.round(outcome.durationMs / 1000)} 秒`,
    `错误：${message}`,
    '',
    '排期与重试策略见 apps/worker/src/tasks.ts。队列状态可以直接查：',
    `  SELECT name, state, COUNT(*) FROM pgboss.job WHERE name = '${outcome.task.command}' GROUP BY 1, 2;`,
    "  -- 重试耗尽的落在死信队列：name = 'emeradar-dead-letter'",
  ].join('\n');

  let emailed = 0;
  for (const to of recipients) {
    if (await sendTransactionalEmail({ to, subject, text })) emailed++;
  }

  await AuditService.log({
    actorId: null,
    actorType: 'SYSTEM',
    action: 'job.alerted',
    targetType: 'JOB',
    targetId: outcome.task.command,
    payload: { consecutiveFailures, recipients: recipients.length, emailed },
  });

  return { consecutiveFailures, alerted: true };
}

/**
 * 上次成功的**时间点**之后连续失败了几次。
 *
 * 用审计表当状态机而不是加一张计数表：累计值一旦是另一份存储，它就会与审计记录
 * 漂移，而审计记录才是"到底发生了什么"的原始材料。这里只是把它数一遍。
 */
async function countConsecutiveFailures(command: string): Promise<number> {
  try {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM audit_log
        WHERE action = 'job.failed'
          AND target_id = $1
          AND occurred_at > COALESCE(
                (SELECT MAX(occurred_at) FROM audit_log
                  WHERE action = 'job.succeeded' AND target_id = $1),
                TIMESTAMPTZ '-infinity')`,
      [command]
    );
    return Number(res.rows[0]?.count ?? 0);
  } catch (error) {
    // 数不出来就当第一次失败：宁可少发一封，也不要在数据库抖动的时刻连发一串。
    console.error('[job] 无法统计连续失败次数，按 1 次处理:', error);
    return 1;
  }
}

/**
 * 告警收件人：`OPS_ALERT_EMAIL` 优先，否则取库里的在职管理员。
 *
 * 兜底查库是有意的：告警通道的配置本身也会被忘掉，而"系统管理员"这个身份已经在
 * 库里了。都不存在（本地、CI）就返回空数组，此时告警只留在 audit_log 里——静默
 * 是可以接受的，前提是它**可见地**静默：调用方会把 `emailed: 0` 记下来。
 */
async function resolveAlertRecipients(): Promise<string[]> {
  const configured = (process.env.OPS_ALERT_EMAIL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;

  try {
    const res = await query<{ email: string }>(
      `SELECT email FROM users
        WHERE role = 'ADMIN' AND status = 'ACTIVE'
        ORDER BY created_at ASC
        LIMIT 5`
    );
    return res.rows.map((r) => r.email).filter(Boolean);
  } catch (error) {
    console.error('[job] 无法解析告警收件人:', error);
    return [];
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}
