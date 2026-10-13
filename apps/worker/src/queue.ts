// pg-boss 12 起只有具名导出（`import PgBoss from 'pg-boss'` 在 CJS 下能跑，但类型
// 上不再有 default export）。
import { PgBoss, type Queue, type UpdateQueueOptions } from 'pg-boss';
import { closePool, directConnectionString, query } from '@emeradar/db';
import { TASKS, type TaskSpec } from './tasks';
import { recordDeadLetter, recordJobFailure, recordJobSuccess } from './job-failure';

/**
 * 常驻调度器（ADR-003）。
 *
 * 之前"调度"只活在文档和宿主机 crontab 里：`docs/21` 写着六条 `docker compose
 * run --rm worker <task>`，而代码里没有任何东西知道这些任务该多久跑一次。于是
 * 调度成了仓库之外的一份配置——它不会随代码评审、不会随部署回滚，新加一个任务
 * 就是在别人的 crontab 上补一行。现在排期、重试、死信策略和任务实现是同一份
 * 代码（`tasks.ts`），部署即生效。
 *
 * 两个 pg-boss 特性直接决定这里的写法：
 *
 * 1. **必须走直连**（`DATABASE_DIRECT_URL`）。消费者靠 `LISTEN/NOTIFY` 被唤醒、
 *    并持有会话级锁，而 transaction 模式的连接池会在语句之间把连接换给别人——
 *    通知永远收不到、锁被别人放开。见 ADR-012 与 `directConnectionString`。
 * 2. `createQueue` 不更新已有队列。启动时还要用 `updateQueue` 对齐可变参数，
 *    并核对不可变的 policy；已有 job 仍继承它创建时的参数。
 */
const DEAD_LETTER_QUEUE = 'emeradar-dead-letter';

/**
 * pg-boss createQueue() intentionally leaves an existing queue untouched. Its
 * updateQueue() refuses immutable policy/partition, so fail startup rather than
 * silently running with a different concurrency policy. Mutable settings are
 * reconciled before registering workers and schedules on every start.
 */
export async function configureQueues(boss: PgBoss, tasks: TaskSpec[] = TASKS): Promise<void> {
  const reconcile = async (name: string, policy: string, options: UpdateQueueOptions) => {
    const existing = await boss.getQueue(name);
    if (existing && (existing.policy !== policy || existing.partition)) {
      throw new Error(`Queue ${name} has immutable policy/partition ${existing.policy}/${existing.partition}; expected ${policy}/false`);
    }
    await boss.createQueue(name, { policy, ...options } as Queue);
    // Also update after creation: clears stale defaults left by earlier deployments.
    await boss.updateQueue(name, options);
  };

  await reconcile(DEAD_LETTER_QUEUE, 'standard', {
    retryLimit: 0,
    retentionSeconds: 90 * 24 * 3600,
    deleteAfterSeconds: 90 * 24 * 3600,
  });
  for (const task of tasks) {
    await reconcile(task.command, 'singleton', {
      retryLimit: task.retryLimit,
      retryDelay: task.retryDelaySeconds,
      retryBackoff: task.retryLimit > 0,
      expireInSeconds: task.expireInSeconds,
      deadLetter: DEAD_LETTER_QUEUE,
      notify: true,
    });
  }
}


export interface SchedulerHandle {
  boss: PgBoss;
  stop(): Promise<void>;
}

export async function startScheduler(): Promise<SchedulerHandle> {
  const boss = new PgBoss({
    connectionString: directConnectionString,
    // pg-boss 自己建 schema 与表。应用角色是数据库 owner，因此有建 schema 的权限。
    schema: 'pgboss',
    // 队列建好之后，生产端一条 NOTIFY 就能把空闲的消费者叫醒，而不是等下一次轮询。
    // 直连是它的前提；连不上时 pg-boss 只发 warning 并回落到轮询，不会让调度停摆。
    useListenNotify: true,
  });

  boss.on('error', (error) => console.error('[queue] pg-boss error:', error));
  boss.on('warning', (warning) => console.warn('[queue] pg-boss warning:', warning));

  await boss.start();
  try {
    await configureQueues(boss);

    for (const task of TASKS) {
      await boss.work(task.command, { batchSize: 1, includeMetadata: true }, async (jobs) => {
        const job = jobs[0];
        await execute(task, job.id, job.retryCount ?? 0, job.createdOn);
      });

      if (task.cron) {
        // UTC cron；错过多次排期只补最近一次。死信 payload 保留原任务名。
        await boss.schedule(task.command, task.cron, { command: task.command }, {
          tz: 'UTC',
          key: task.command,
          missed: 'once',
        });
      }
    }

    await boss.work(DEAD_LETTER_QUEUE, { batchSize: 1 }, async (jobs) => {
      const job = jobs[0];
      const command = String((job.data as { command?: string } | null)?.command ?? 'unknown');
      console.error(`[queue] 任务 ${command} 重试耗尽，进入死信队列（job ${job.id}）`);
      await recordDeadLetter(job.id, command, job.data);
    });
  } catch (error) {
    await boss.stop();
    throw error;
  }

  const schedule = TASKS.filter((t) => t.cron)
    .map((t) => `${t.cron} (UTC) → ${t.command}`)
    .join('\n  ');
  console.log(`[queue] 调度器已启动，串行消费 ${TASKS.length} 个任务。排期：\n  ${schedule}`);

  return {
    boss,
    async stop() {
      // 优雅停机：正在跑的任务先跑完，否则 `docker compose up -d` 的一次滚动更新
      // 会在管线写账本的中途把它掐掉。
      await boss.stop({ graceful: true, timeout: 120_000 });
      await closePool();
    },
  };
}

/**
 * 常驻 worker 的健康检查，供容器 healthcheck 调用。**不得**构造 PgBoss 实例：
 * pg-boss 的实例注册表用咨询锁选出唯一的"定时检查者"，一个短命进程去抢那把锁、
 * 抢到就退出，会让真正的调度器在锁超时前拿不到它——健康检查本身成了故障源。
 * 所以这里只读库。
 *
 * 判据是"有一个活着的心跳"，而不是"进程还在"：Docker 自己知道进程在不在，而
 * 处理器把事件循环堵死（同步死循环、打满的 CPU 配额）时进程照样在。心跳按
 * pg-boss 自己的口径算——三次未跳动即视为安静（`INSTANCE_QUIET_BEATS = 3`）。
 */
export async function checkWorkerHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await query<{ live: string; scheduling: boolean }>(
      `SELECT
         (SELECT COUNT(*)::text FROM pgboss.instance
           WHERE stopped_on IS NULL
             AND heartbeat_on > NOW() - heartbeat_seconds * 3 * INTERVAL '1 second') AS live,
         EXISTS (SELECT 1 FROM pgboss.instance
                  WHERE stopped_on IS NULL
                    AND schedule = true
                    AND heartbeat_on > NOW() - heartbeat_seconds * 3 * INTERVAL '1 second') AS scheduling`
    );
    const live = Number(res.rows[0]?.live ?? 0);
    const scheduling = Boolean(res.rows[0]?.scheduling);
    if (live === 0) return { ok: false, detail: 'pgboss 里没有任何活着的心跳：队列消费者没有在消费' };
    return {
      ok: true,
      detail: `队列实例存活 ${live} 个，其中承担排期的 ${scheduling ? '1' : '0'} 个`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `无法读取队列状态（pgboss schema 是否已建？）：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function execute(task: TaskSpec, jobId: string, attempt: number, scheduledAt: Date): Promise<void> {
  // A durable, bounded receipt covers replay after handler completion but before
  // pg-boss acknowledgement. It is NOT exactly-once: a crash before this receipt
  // still requires each handler's natural keys/guards. Queue singleton policy
  // serializes active deliveries; different job IDs remain distinct work.
  const receiptId = `job_${jobId}`;
  const completed = await query(`SELECT 1 FROM audit_log WHERE id = $1 AND action = 'job.succeeded'`, [receiptId]);
  if (completed.rowCount) return;
  const startedAt = Date.now();
  console.log(`[queue] ▶ ${task.command}（job ${jobId}，第 ${attempt + 1} 次）`);
  try {
    // 队列任务不带参数：排期跑的就是"默认参数"那一版。需要别的参数时用 CLI 手工跑，
    // 那条路径会把参数说明写进日志——比在 cron payload 里藏一组参数可查得多。
    await task.run([], { trigger: 'queue', scheduledAt });
    const durationMs = Date.now() - startedAt;
    console.log(`[queue] ✔ ${task.command}（${(durationMs / 1000).toFixed(1)}s）`);
    await recordJobSuccess({ task, jobId, attempt, durationMs });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[queue] ✘ ${task.command}（${(durationMs / 1000).toFixed(1)}s）`, error);
    // 记完账再抛出：抛出会让 pg-boss 按队列策略重试或转入死信，这是它该做的决定。
    const outcome = await recordJobFailure({ task, jobId, attempt, durationMs, error });
    console.error(
      `[queue] ${task.command} 连续失败 ${outcome.consecutiveFailures} 次` +
        (outcome.alerted ? '，已发出告警' : `（未达告警阈值 ${task.alertAfterFailures}）`)
    );
    throw error;
  }
}
