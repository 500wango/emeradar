import { closePool } from '@emeradar/db';
import { TASKS, findTask } from './tasks';
import { checkWorkerHealth, startScheduler } from './queue';

/**
 * 命令行的两种身份：
 *
 *   - `<task>`   手工执行**一次**某个任务，参数与从前一致。它和排期跑的是同一个
 *                `TaskSpec.run`，所以"排期上跑的"与"我手工跑的"不可能不一致。
 *   - `start`    以常驻消费者身份启动调度器（ADR-003）。
 *
 * 失败一律以抛出结束，由这里统一转成退出码：任务实现里**不允许**调用
 * `process.exit`——那会跳过 `finally` 里的连接池关闭，也会让常驻进程在跑任务的中途
 * 直接消失（从前 `verify-ledger` 就是这么写的）。
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'run-daily';

  if (command === 'start') {
    await runResident();
    return;
  }

  try {
    if (command === 'health') {
      // 容器 healthcheck 用：只读库，不起第二个队列实例（见 checkWorkerHealth）。
      const health = await checkWorkerHealth();
      console.log(`[cli] ${health.detail}`);
      if (!health.ok) process.exitCode = 1;
      return;
    }

    const task = findTask(command);
    if (!task) {
      console.log(`Unknown command: ${command}`);
      console.log('Available commands:');
      console.log('  start                    常驻调度器（按 cron 排期消费全部任务）');
      console.log('  health                   常驻 worker 的健康检查（容器 healthcheck 用）');
      for (const t of TASKS) {
        console.log(`  ${t.command.padEnd(24)} ${t.description}（${t.cron ? `${t.cron} UTC` : '仅手工触发'}）`);
      }
      process.exitCode = 1;
      return;
    }

    // 位置参数原样透传，与从前的 `args[1]` 是同一个含义。
    await task.run(args.slice(1), { trigger: 'cli' });
  } catch (err) {
    console.error('[cli] Command failed with error:', err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

/**
 * 常驻模式。**不走**上面那个 `finally`：连接池在常驻进程里是长期资源，任务还会
 * 一直用它，关掉它等于让调度器活着但什么也干不了。
 */
async function runResident() {
  const scheduler = await startScheduler();
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[cli] 收到 ${signal}，等待正在执行的任务结束后退出...`);
    await scheduler.stop();
    process.exit(0);
  };
  // 部署时的滚动更新发 SIGTERM：跑完手头这一次再走，否则管线可能在写账本的中途
  // 被掐断。SIGINT 同理，给本地 Ctrl-C 用。
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main();
