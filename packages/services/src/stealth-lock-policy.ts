import { query } from '@emeradar/db';
import { AuditService } from './audit.service';

/**
 * 买断的**判据与标签**，与写入方（`stealth-lock.service.ts`）分开。
 *
 * 拆出来的理由与 `claim-policy.ts` 完全相同：这些谓词要被**十几个读路径**引用
 * （Feed、详情、比较、槽位、告警规则、公开投影、公开战报），而其中
 * `public-publication.service.ts` 是写入方 `stealth-lock.service.ts` 的依赖。
 * 判据留在写入方，就会形成一个循环：投影要问"这条机会现在该不该打码"，
 * 答案却要 import 那个反过来 import 投影的模块。
 *
 * 于是：**判据住在这里，两端都只依赖这里。** 顺带得到一个更重要的性质——判据只有
 * 一处定义。买断这条路径上最贵的错误是"十几处各自重写一遍隐藏条件"，因为漏掉任何
 * 一处就同时是泄露（P0）与不一致（同一条机会在 Feed 里消失、在公开页上还在）。
 */

/** 单次买断价格（PRD §8.1 给的是区间「如 $199–$299」，最终价注「待 Phase 0」）。 */
export const STEALTH_BUYOUT_AMOUNT_CENTS = 19900;
export const STEALTH_BUYOUT_AMOUNT_USD = STEALTH_BUYOUT_AMOUNT_CENTS / 100;

/** 保护期（03 §12：`unlock_at = locked_at + 60 天`；PRD §1.7 第 7 条）。 */
export const STEALTH_LOCK_DURATION_DAYS = 60;

/**
 * 待付窗口。窗口内占位与已成交的买断对外**没有区别**（机会同样隐藏）；窗口一过
 * 而钱仍未到，占位作废，机会重新对全网开放（03 §17 I13）。
 */
export const STEALTH_RESERVATION_GRACE_MINUTES = 45;

/**
 * 结账会话的有效期，**必须短于待付窗口**。
 *
 * 若两者相等甚至反超，就会出现"占位已作废、而结账页仍可付款"的交错：用户在第 44
 * 分钟付掉一笔，作业在第 45 分钟把占位判为作废——那正是"先占位"这个方案本来要避免
 * 的结局（钱已收、交付物不在）。留出的余量给 webhook 投递延迟。
 *
 * 不取 30（Stripe 允许的下限）：`now` 是发请求**之前**算的，Stripe 看到的时间总比
 * 它晚一点，卡在下限上会被判为不足 30 分钟而拒绝。
 */
export const STEALTH_CHECKOUT_SESSION_MINUTES = 35;

/**
 * 打码标签要覆盖的 locale 集合，与公开投影的产出范围同源。
 *
 * 今天发布层只产出 `en-US`，所以一把锁只有一条显示行——与 03 §17 I14 的「有且仅有
 * 一条」逐字相符。将来多产一个 locale 时改这一处即可：打码行与 `public_pages` 会
 * 一起跟上，不会出现"页面有了、显示行没有"的半边状态。
 */
export const PUBLICATION_LOCALES = ['en-US'] as const;

/**
 * 「这条锁此刻是否在隐藏机会」的**唯一**判据（03 §17 I13）。
 *
 * 三个条件缺一不可，各自挡掉一类错误：
 *
 *   - `status = 'ACTIVE'`：`EXPIRED`（期满）与 `VOID`（占位作废）都不再隐藏。
 *   - `unlock_at > NOW()`：**即使 `expire-stealth-locks` 还没跑**，到点即解密。
 *     少了这一条，期满解密就依赖一个每日作业准点运行。
 *   - `provider_payment_id IS NOT NULL OR locked_at > 窗口`：已付款的买断由
 *     `unlock_at` 说了算；未付款的占位**只在那 45 分钟内**算数。少了后半句，一笔被
 *     遗弃的结账页面就会把机会永久隐藏——而不花钱就能对全网做出这个动作。
 *
 * 拼成 SQL 片段而不是 Postgres 函数：调用点全是既有的手写谓词（`o.status =
 * 'TRACKED'` 那些），一个函数会让它们变成 `WHERE f(o.id)` 而用不上索引；留给各调用
 * 点各自重写，就是十几份各自会漂的副本。
 */
export function stealthHiddenPredicate(lockAlias = 'sl'): string {
  const p = lockAlias ? `${lockAlias}.` : '';
  return [
    `${p}status = 'ACTIVE'`,
    `${p}unlock_at > NOW()`,
    // 括号内的两个分支用 OR 连接，整个括号与上面两条用 AND 连接。**必须写成一条
    // 字符串**：把它拆成两个数组元素，`join(' AND ')` 会插到 `NOT NULL` 与 `OR`
    // 之间，拼出 `IS NOT NULL AND OR ...` ——一条语法错误的 SQL。它在类型检查下
    // 完全隐形，只会在第一个真正跑到这条判据的读路径上炸开。
    `(${p}provider_payment_id IS NOT NULL OR ${p}locked_at > NOW() - INTERVAL '${STEALTH_RESERVATION_GRACE_MINUTES} minutes')`,
  ].join(' AND ');
}

/** 对**所有人**隐藏（Feed / 搜索 / 比较：买断者本人的卡片同样消失，16 §3.3）。 */
export function hiddenFromEveryone(opportunityIdExpr: string): string {
  return `NOT EXISTS (SELECT 1 FROM stealth_locks sl WHERE sl.opportunity_id = ${opportunityIdExpr} AND ${stealthHiddenPredicate('sl')})`;
}

/**
 * 对**非持有者**隐藏（详情 / 研报 / 槽位 / 告警规则，10 §7）。
 *
 * `IS DISTINCT FROM` 而不是 `<>`：未登录时 `viewerParam` 是 NULL，而
 * `sl.user_id <> NULL` 求值为 NULL，`EXISTS` 会把它当假——于是任何人只要不登录就能
 * 把保护期内的机会读出来。这个函数的全部作用是"挡住别人"，用 `<>` 写会让它在最
 * 容易触发的路径上静默失效。
 */
export function hiddenFromViewer(opportunityIdExpr: string, viewerParam: string): string {
  return `NOT EXISTS (SELECT 1 FROM stealth_locks sl
                       WHERE sl.opportunity_id = ${opportunityIdExpr}
                         AND ${stealthHiddenPredicate('sl')}
                         AND sl.user_id IS DISTINCT FROM ${viewerParam})`;
}

/** 打码标签（15 §3.1：`[Stealth Locked #ID]`，ID 取锁 id 的后 6 位）。 */
export function maskedLabel(lockId: string): string {
  return `[Stealth Locked #${lockId.slice(-6)}]`;
}

/**
 * 打码 slug。**由锁 id 派生，不含任何词根**——`opportunity_cards.slug` 是从词/标题
 * 生成的，它自己就是一个泄露面（15 §8 把 URL slug 与正文并列列为 0 容忍项）。
 */
export function maskedSlug(lockId: string): string {
  return `stealth-lock-${lockId.slice(-6).toLowerCase()}`;
}

export interface ActiveMask {
  lockId: string;
  maskedLabel: string;
  maskedSlug: string;
  unmaskedAt: string;
}

/**
 * 某条机会此刻的打码信息；不在保护期则 null。
 *
 * **读 `stealth_lock_displays` 而不是现算标签**（15 §3.1、06 §11）：公开投影与公开
 * 战报都要输出 `masked_label` / `unmasked_at`，两处各自现算就是同一份事实的两个
 * 实现，第一处漂移即 P0 泄露。这张表存在的全部意义就是让"只打一次码"成立。
 */
export async function getActiveMask(opportunityId: string): Promise<ActiveMask | null> {
  const res = await query<{ id: string; masked_label: string | null; unlock_at: Date }>(
    `SELECT sl.id, sl.unlock_at, d.masked_label
       FROM stealth_locks sl
       LEFT JOIN stealth_lock_displays d
              ON d.stealth_lock_id = sl.id AND d.locale = $2
      WHERE sl.opportunity_id = $1 AND ${stealthHiddenPredicate('sl')}
      LIMIT 1`,
    [opportunityId, PUBLICATION_LOCALES[0]]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    lockId: row.id,
    maskedLabel: row.masked_label ?? maskedLabel(row.id),
    maskedSlug: maskedSlug(row.id),
    unmaskedAt: row.unlock_at.toISOString(),
  };
}

/** 批量版，供公开战报一次问清多条机会（逐条查会把一次列表渲染变成 N 次往返）。 */
export async function getActiveMasks(opportunityIds: string[]): Promise<Map<string, ActiveMask>> {
  const unique = [...new Set(opportunityIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const res = await query<{
    opportunity_id: string;
    id: string;
    masked_label: string | null;
    unlock_at: Date;
  }>(
    `SELECT sl.opportunity_id, sl.id, sl.unlock_at, d.masked_label
       FROM stealth_locks sl
       LEFT JOIN stealth_lock_displays d
              ON d.stealth_lock_id = sl.id AND d.locale = $2
      WHERE sl.opportunity_id = ANY($1::text[]) AND ${stealthHiddenPredicate('sl')}`,
    [unique, PUBLICATION_LOCALES[0]]
  );
  const masks = new Map<string, ActiveMask>();
  for (const row of res.rows) {
    masks.set(row.opportunity_id, {
      lockId: row.id,
      maskedLabel: row.masked_label ?? maskedLabel(row.id),
      maskedSlug: maskedSlug(row.id),
      unmaskedAt: row.unlock_at.toISOString(),
    });
  }
  return masks;
}

/** 最小可用的执行器形状，够 `voidStealthLockByPaymentIntent` 在调用方的事务里跑。 */
export interface StealthPolicyExecutor {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/**
 * 退款 / 拒付落账后作废对应的买断（13 §4.3）。
 *
 * 放在**判据模块**而不是服务模块里，是为了让入站支付对账能调它而不绕成环：
 * `stealth-lock.service.ts` → `stripe.service.ts` → `stripe-payment.service.ts`，
 * 若后者再 import 服务模块，这个环就闭合了。本模块只依赖 `@emeradar/db`。
 *
 * 接受调用方的事务客户端，是因为它必须在**对账那一个事务里**执行：把那笔
 * `stripe_purchases` 标成 refunded、判断争议状态、作废锁——三件事拆进两个事务时，
 * 中间那一瞬的状态是"钱已退、锁还挂着"，而 60 天的独占正是靠这个中间态白拿的。
 *
 * 返回受影响的 `opportunityId`。**不刷新公开投影**：解除打码的方向不需要实时
 * （15 §3.1 第 4 条对期满写的就是"第一次 S8 运行恢复真实词根"），与它同向。
 * 那一瞬间公开页显示的仍是打码版本——少披露，不是泄露。
 */
export async function voidStealthLockByPaymentIntent(
  client: StealthPolicyExecutor,
  paymentIntentId: string,
  reason: string
): Promise<string | null> {
  const res = await client.query(
    `UPDATE stealth_locks SET status = 'VOID', updated_at = NOW()
      WHERE provider_payment_id = $1 AND status = 'ACTIVE'
      RETURNING id, opportunity_id`,
    [paymentIntentId]
  );
  const row = res.rows[0];
  if (!row) return null;
  await AuditService.log({
    actorId: null,
    actorType: 'SYSTEM',
    action: 'stealth_lock.voided',
    targetType: 'opportunity',
    targetId: row.opportunity_id,
    payload: { lockId: row.id, reason, paymentIntentId },
  });
  return row.opportunity_id as string;
}
