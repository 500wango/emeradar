import type { Pool } from 'pg';

/**
 * 给一次性夹具临时建的池挂上"空闲连接错误"监听器。
 *
 * 与 `src/client.ts` 里生产池那条监听器是同一件事，缺了它就是一次**假失败**：
 * `pg` 的池在空闲连接被掐断时会在池上 `emit('error')`。没有监听器时 Node 把它
 * 当作未捕获异常，而 `node:test` 会把 uncaughtException 归到**当时正在跑的那个
 * 用例**上——于是一次断言全过的用例被报成失败，报出的错还是
 * `57P01 terminating connection due to administrator command`，看起来像产品坏了。
 *
 * 掐断的来源就在这些用例自己要干的事里：收尾时的
 * `DROP DATABASE ... WITH (FORCE)`。它按设计会终止该库上的连接，而池的关闭与它
 * 之间存在几毫秒的窗口，窗口在机器有负载时变宽（实测：只用例包单跑 6/6 通过，
 * 与另一个包并行跑约 1/4 次触发）。这是夹具的时序，不是被测行为。
 *
 * 加监听器**不会掩盖真实故障**：连接在查询中途死掉时，那条查询本身照样 reject、
 * 用例照样红；被吞掉的只有"什么都没在执行时连接没了"这一种空事件。
 */
export function guardPoolErrors<T extends Pool>(pool: T): T {
  pool.on('error', (error: Error) => {
    console.error(`[db-test] Idle client error: ${error.message}`);
  });
  return pool;
}
