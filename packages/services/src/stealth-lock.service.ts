import { randomUUID } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import type { PoolClient } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { AuditService } from './audit.service';
import { EntitlementService } from './entitlement.service';
import { StripeService } from './stripe.service';
import { PublicPublicationService } from './public-publication.service';
import {
  PUBLICATION_LOCALES,
  STEALTH_BUYOUT_AMOUNT_CENTS,
  STEALTH_BUYOUT_AMOUNT_USD,
  STEALTH_CHECKOUT_SESSION_MINUTES,
  STEALTH_LOCK_DURATION_DAYS,
  STEALTH_RESERVATION_GRACE_MINUTES,
  STEALTH_UNPAID_STRIKE_LIMIT,
  STEALTH_UNPAID_STRIKE_WINDOW_DAYS,
  hiddenFromViewer,
  maskedLabel,
  stealthHiddenPredicate,
} from './stealth-lock-policy';

/**
 * 处女地独占买断的**写入方**（Epic 1.14、PRD §1.7 第 5/7 条、ADR-018）。
 *
 * 一个人付一笔钱，把一条**还没有人认领过任何槽位**的机会从全网买走 60 天。
 * 打码只发生在**公开投影**上：`verdicts` 与 `prediction_episodes` 照常写入、照常计入
 * Cohort 胜率（06 §6.1、15 §3.1 第 2 条）。这条边界是这个模块存在的全部理由——一旦
 * 有人为了"封印"把账本行也拿掉，买断者就等于用钱买走了平台的败绩。
 *
 * 判据（隐藏条件、标签、价格、期限）不在这个文件里，在 `stealth-lock-policy.ts`：
 * 它们要被十几个读路径引用，其中包括本模块的依赖 `public-publication.service.ts`，
 * 留在这里就是循环依赖。**只改这里的写入逻辑，不要在这里重写判据。**
 *
 * ## 为什么是"先占位、后付款"
 *
 * 托管结账页面意味着**付款完成时锁还不存在**。若等到付款才建锁，从付款完成到建锁
 * 之间别人可以点 GO 占槽，于是钱已收、无物可交。而本仓库没有任何出站退款能力
 * （全仓库无 `/v1/refunds` 调用），要为一条新商品新增一条动钱的能力，代价远大于
 * 先占位。所以：下单即建锁、机会即刻隐藏，付款只是给这把已经生效的锁**补上凭据**。
 *
 * 代价是把风险从"钱"搬到"时间"：一笔被遗弃的占位会挡住所有人 45 分钟。因此配套的
 * 是"同一用户同时至多一笔待付占位"这条闸（部分唯一索引，见 0007 迁移），以及
 * 一个**不依赖调度器**的隐藏判据（`stealthHiddenPredicate`）。
 */

/**
 * 判据与标签**只从 `stealth-lock-policy.ts` 导出**，这里不转出。
 *
 * 包的入口 `index.ts` 用 `export *`，两个模块同时导出同名成员会让该名字在包边界上
 * 变成歧义而**整体消失**（`index.ts` 里为 `AlertRuleType` 记过同一个坑）。所以判据
 * 有且仅有一个出处，服务层只 import 它来用。
 */
export interface StealthLockAvailability {
  available: boolean;
  claimedTotal: number;
  price: number;
  durationDays: number;
  /** 此刻已存在一把生效的锁（无论持有人是谁）。`available` 已把它算进去。 */
  locked: boolean;
  /** 那把锁是调用者自己的。用于把"你已买断"与"别人的占位"分开。 */
  heldByMe: boolean;
  /** 调用者自己那笔待付占位；没有则为 null。用于续付。 */
  pending: { lockId: string; checkoutUrl: string | null; expiresAt: string } | null;
}

export interface MyStealthLock {
  lockId: string;
  opportunityId: string;
  opportunityTitle: string;
  maskedLabel: string;
  lockedAt: string;
  unlockAt: string;
  /** 剩余保护天数，向上取整到整日；已过期或已作废为 0。 */
  remainingDays: number;
  status: string;
}

export class StealthLockService {
  /**
   * 这条机会还能不能买（10 §4.5b 的 GET）。
   *
   * `available = (Σclaimed == 0)`：只要有任何一个人认领过，处女地就已经被破坏，
   * 买断**永久**不再开放（PRD §1.7 第 5 条）。注意这与"槽位是否满额"是两个方向：
   * 满额说明竞争已经形成，空槽说明机会还在，而买断恰恰只要**空**的那种。
   */
  static async getAvailability(
    opportunityId: string,
    userId?: string
  ): Promise<StealthLockAvailability> {
    /**
     * 保护期内对非持有者 404，与 `getOpportunityDetail` 同口径。
     *
     * 少了这一道，`GET /opportunities/{id}/stealth-lock` 就是一个**任何人可查的
     * 存在性判据**：非持有者拿一个猜来的 id 请求它，200 说明"这条存在、而且正被人
     * 买断"，404 说明不存在——而后者正是 D3 用 404 想挡住的那条信息。已付款的锁也
     * 一样：`provider_payment_id` 不为空时它对非持有者的可见性没有任何不同。
     *
     * 未传 `userId` 时用空串当"没有这个人"，理由同 `getSlots`：失败开放更危险。
     */
    const visible = await query(
      `SELECT 1 FROM opportunities o WHERE o.id = $1 AND ${hiddenFromViewer('o.id', '$2')}`,
      [opportunityId, userId ?? '']
    );
    if (visible.rows.length === 0) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, 'Opportunity not found', 404);
    }

    const claimedRes = await query<{ claimed: string }>(
      `SELECT COALESCE(SUM(claimed), 0)::text AS claimed FROM opportunity_slots WHERE opportunity_id = $1`,
      [opportunityId]
    );
    const claimedTotal = parseInt(claimedRes.rows[0]?.claimed ?? '0', 10);

    /**
     * 已经生效的锁（可能是别人的、也可能是调用者自己的）。
     *
     * `available` 必须把它算进去，否则持有者会看到一个"立即买断"的按钮：他还没
     * GO 的时候 `Σclaimed` 是 0，只看认领数就会得出"可以买"——而他正是这条锁的
     * 主人。再点一次会落到 `purchase` 的 422，白跑一趟还让人以为出了故障。
     */
    const lockRes = await query<{ user_id: string }>(
      `SELECT sl.user_id FROM stealth_locks sl
        WHERE sl.opportunity_id = $1 AND ${stealthHiddenPredicate('sl')}
        LIMIT 1`,
      [opportunityId]
    );
    const activeLock = lockRes.rows[0] ?? null;

    let pending: StealthLockAvailability['pending'] = null;
    if (userId) {
      const pendingRes = await query<{
        id: string;
        provider_checkout_url: string | null;
        unlock_at: Date;
      }>(
        // 用与隐藏判据同一套条件找"待付"：只有仍在窗口内的占位才值得续付。
        `SELECT id, provider_checkout_url, unlock_at FROM stealth_locks
          WHERE opportunity_id = $1 AND user_id = $2
            AND ${stealthHiddenPredicate('stealth_locks')}
            AND provider_payment_id IS NULL
          LIMIT 1`,
        [opportunityId, userId]
      );
      const row = pendingRes.rows[0];
      if (row) {
        pending = {
          lockId: row.id,
          checkoutUrl: row.provider_checkout_url,
          expiresAt: row.unlock_at.toISOString(),
        };
      }
    }

    return {
      available: claimedTotal === 0 && !activeLock,
      claimedTotal,
      price: STEALTH_BUYOUT_AMOUNT_USD,
      durationDays: STEALTH_LOCK_DURATION_DAYS,
      locked: Boolean(activeLock),
      heldByMe: Boolean(activeLock && userId && activeLock.user_id === userId),
      pending,
    };
  }

  /**
   * 下单（10 §4.5b 的 POST）。写锁与打码行在**同一事务**内，结账会话在事务**之外**建。
   *
   * 会话建在事务外是有意的：Stripe 的往返可能几百毫秒到数秒，把它放进事务就等于
   * 让一次外部调用的超时决定一把行锁持有多久，而这条事务同时挡着 GO（两者抢同一把
   * 机会级 advisory lock）。代价是"事务已提交、建会话失败"这个窗口——它由两件事
   * 兜住：`compensate` 会立刻删掉刚写的锁；即使删除本身也失败，那条行的
   * `provider_payment_id` 与 `provider_checkout_session_id` 都是 NULL，会在 45 分钟
   * 后被作废扫描收走（判据自愈），不会永久挡住机会。
   */
  static async purchase(
    userId: string,
    opportunityId: string
  ): Promise<{ lockId: string; amountCents: number; unlockAt: string }> {
    const ent = await EntitlementService.getUserEntitlements(userId);
    if (!ent.stealthBuyout) {
      throw new EmeradarError(
        ErrorCode.PLAN_REQUIRED,
        'Stealth buyout requires a Pro plan.',
        403
      );
    }

    const oppRes = await query<{ id: string; status: string }>(
      `SELECT id, status FROM opportunities WHERE id = $1`,
      [opportunityId]
    );
    const opp = oppRes.rows[0];
    if (!opp || opp.status !== 'TRACKED') {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Opportunity not found: ${opportunityId}`, 404);
    }

    const lockId = `slk_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const unlockAt = await transaction(async (client: PoolClient) => {
      return StealthLockService.purchaseWithin(client, { userId, opportunityId, lockId });
    });

    return {
      lockId,
      amountCents: STEALTH_BUYOUT_AMOUNT_CENTS,
      unlockAt: unlockAt.toISOString(),
    };
  }

  /**
   * 事务体：占位。**必须在调用方的事务里**——见 `SlotService.claim` 的同名约束。
   *
   * 抢占用 `pg_advisory_xact_lock(hashtext('opp:'||id))`，与 GO 侧同一把。两侧若各用
   * 各的锁，"下单时 Σclaimed == 0"就只是一个瞬间为真的判断：GO 完全可以在这句话与
   * 写入之间完成，于是买断被卖给一条已经被认领的机会，而买断者付的是独占价。
   */
  private static async purchaseWithin(
    client: PoolClient,
    input: { userId: string; opportunityId: string; lockId: string }
  ): Promise<Date> {
    const { userId, opportunityId, lockId } = input;

    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`opp:${opportunityId}`]);

    const claimedRes = await client.query<{ claimed: string }>(
      `SELECT COALESCE(SUM(claimed), 0)::text AS claimed FROM opportunity_slots WHERE opportunity_id = $1`,
      [opportunityId]
    );
    if (parseInt(claimedRes.rows[0]?.claimed ?? '0', 10) > 0) {
      throw new EmeradarError(
        ErrorCode.STEALTH_LOCK_UNAVAILABLE,
        'This opportunity already has claims; the pristine condition no longer holds.',
        422
      );
    }

    // 已存在的 ACTIVE 锁：可能是自己的待付占位（让他续付），也可能是别人的（不卖）。
    const existing = await client.query<{
      id: string;
      user_id: string;
      provider_payment_id: string | null;
      provider_checkout_url: string | null;
    }>(
      `SELECT id, user_id, provider_payment_id, provider_checkout_url
         FROM stealth_locks
        WHERE opportunity_id = $1 AND ${stealthHiddenPredicate('stealth_locks')}
        LIMIT 1`,
      [opportunityId]
    );
    const held = existing.rows[0];
    if (held) {
      if (held.user_id === userId) {
        if (held.provider_payment_id === null) {
          throw new EmeradarError(
            ErrorCode.STEALTH_LOCK_PENDING,
            'You already have an unpaid reservation on this opportunity.',
            409,
            { details: { lockId: held.id, checkoutUrl: held.provider_checkout_url } }
          );
        }
        // 自己已经买下了。他本来就能看到这条机会（持有者可见），所以 422 不泄露
        // 任何他不知道的事，而这句话正是他需要的："你已经买过了。"
        throw new EmeradarError(
          ErrorCode.STEALTH_LOCK_UNAVAILABLE,
          'You already hold the Stealth Lock on this opportunity.',
          422
        );
      }
      /**
       * 别人的锁：**回 404，与"这条机会不存在"完全同形**（10 §7）。
       *
       * 这里曾经回 `422 STEALTH_LOCK_UNAVAILABLE`，看起来更"准确"，但它把这个端点
       * 变成了一台存在性探测器：拿一个猜来的 id 下单，422 说明"存在且正被独占"，
       * 404 说明不存在。而 `422` 的适用场合是**调用者本来就能看到这条机会**——
       * `Σclaimed > 0` 那一种，机会仍留在 Feed 里；保护期内的机会对所有人（含
       * 持有者）都已从 Feed 消失（16 §3.3），调用者不可能"本来就看得见"。
       *
       * 代价是并发窗口里那句话会变得不准确：他半分钟前还在 Feed 上看到这条机会，
       * 现在被告知"不存在"。这个代价比"任何人可查"便宜得多，而且两句话给出的
       * 下一步动作本来就是同一个——这条没了，换一条。
       */
      throw new EmeradarError(ErrorCode.NOT_FOUND, 'Opportunity not found', 404);
    }

    /**
     * 同一用户同时至多一笔待付占位（10 §4.5b 的防滥用闸）。
     *
     * 这道闸**必须在这里显式判一次**，不能只靠 `stealth_locks_one_pending_per_user`
     * 那条部分唯一索引。索引确实挡住了写入，但它吐出来的是 SQLSTATE `23505`，到了
     * 路由层就是一个 500——而这件事根本不是故障，是一个有明确下一步的正常拒绝：
     * 用户上一次的结账页还开着，他该做的是回去把它付掉。
     *
     * 更实际的一层：没有这段判断，`GET` 里那个 `pending.checkout_url` 就成了唯一
     * 能拿到续付链接的地方，而用户最可能撞上这道闸的时机恰恰是他重新点"买断"——
     * 那一刻他拿到的是一个 500，不是一条回去付款的路。
     *
     * 索引保留，负责它管得住的那种并发（同一秒的两个请求）。两者是"给人看的话"
     * 与"给并发看的闸"的关系，不是重复。
     */
    // PRD v2.2 Q8：30 天内累计 2 次未付款作废（已作废，或已超窗口但作业还没扫到）后，
    // 取消买断下单资格。按 user_id 计；补偿删除的行（会话建失败）不留痕，不会被计入。
    const strikes = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM stealth_locks
        WHERE user_id = $1 AND provider_payment_id IS NULL
          AND locked_at > NOW() - ($2 || ' days')::interval
          AND (status = 'VOID'
               OR (status = 'ACTIVE'
                   AND locked_at < NOW() - INTERVAL '${STEALTH_RESERVATION_GRACE_MINUTES} minutes'))`,
      [userId, String(STEALTH_UNPAID_STRIKE_WINDOW_DAYS)]
    );
    if ((strikes.rows[0]?.n ?? 0) >= STEALTH_UNPAID_STRIKE_LIMIT) {
      throw new EmeradarError(
        ErrorCode.STEALTH_BUYOUT_SUSPENDED,
        'Stealth buyout is unavailable after repeated unpaid reservations.',
        403
      );
    }

    const pendingElsewhere = await client.query<{
      id: string;
      provider_checkout_url: string | null;
      unlock_at: Date;
    }>(
      `SELECT id, provider_checkout_url, unlock_at FROM stealth_locks
        WHERE user_id = $1 AND status = 'ACTIVE' AND provider_payment_id IS NULL
          AND locked_at > NOW() - INTERVAL '${STEALTH_RESERVATION_GRACE_MINUTES} minutes'
        LIMIT 1`,
      [userId]
    );
    const pendingRow = pendingElsewhere.rows[0];
    if (pendingRow) {
      throw new EmeradarError(
        ErrorCode.STEALTH_LOCK_PENDING,
        'You already have an unpaid reservation on another opportunity.',
        409,
        {
          details: {
            lockId: pendingRow.id,
            checkoutUrl: pendingRow.provider_checkout_url,
            expiresAt: pendingRow.unlock_at.toISOString(),
          },
        }
      );
    }

    const lockRes = await client.query<{ unlock_at: Date }>(
      `INSERT INTO stealth_locks (id, opportunity_id, user_id, status, locked_at, unlock_at, amount_usd)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW() + ($4 || ' days')::interval, $5)
       RETURNING unlock_at`,
      [lockId, opportunityId, userId, String(STEALTH_LOCK_DURATION_DAYS), STEALTH_BUYOUT_AMOUNT_USD]
    );
    const unlockAt = lockRes.rows[0].unlock_at;

    // 打码行与锁同事务写入（03 §17 I14「有且仅有一条」）。分开写就存在"锁生效了、
    // 投影却拿不到标签"的窗口，而那个窗口里的公开页要么漏词根、要么渲染不出。
    const label = maskedLabel(lockId);
    for (const locale of PUBLICATION_LOCALES) {
      await client.query(
        `INSERT INTO stealth_lock_displays (stealth_lock_id, opportunity_id, masked_label, locale, unmasked_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [lockId, opportunityId, label, locale, unlockAt]
      );
    }

    return unlockAt;
  }

  /**
   * 下单并拿到结账链接——POST 端点的完整编排。
   *
   * 三步的顺序是有意的：**先占位（事务）→ 再建会话 → 最后回填会话 id**。
   *
   *   - 先占位：机会在钱到之前就已经被锁住，所以付款完成与建锁之间没有可供 GO 插入
   *     的窗口。反过来做（先付钱后退款）需要一条本仓库不存在的出站退款能力。
   *   - 建会话在事务外：Stripe 的往返可能几秒，把它放进事务就等于让一次外部调用的
   *     超时决定一把行锁持有多久，而这条事务同时挡着 GO。
   *   - 会话建失败要**立刻撤掉占位**：否则用户既拿不到链接、又占着机会 45 分钟，而
   *     他连一次付款尝试都没做成。撤不掉也不要紧——那条行没有任何凭据，会被作废
   *     扫描收走（判据自愈）。
   */
  static async startPurchase(
    userId: string,
    opportunityId: string,
    returnUrl?: string
  ): Promise<{ lockId: string; checkoutUrl: string; amountUsd: number; expiresAt: string }> {
    const { lockId, amountCents, unlockAt } = await StealthLockService.purchase(
      userId,
      opportunityId
    );

    let session: { url: string; sessionId: string; expiresAt: Date; mock: boolean };
    try {
      session = await StripeService.createStealthLockCheckout({
        userId,
        opportunityId,
        stealthLockId: lockId,
        amountCents,
        returnUrl,
        expiresInMinutes: STEALTH_CHECKOUT_SESSION_MINUTES,
      });
    } catch (error) {
      await StealthLockService.compensateFailedCheckout(lockId).catch((cleanupError) => {
        console.error(
          `[stealth-lock] failed to release reservation ${lockId} after a checkout error:`,
          cleanupError
        );
      });
      throw error;
    }

    // 非生产环境缺少密钥时的模拟成交：与订阅路径的 dev mock 同口径，只在
    // NODE_ENV !== 'production' 且没有 STRIPE_SECRET_KEY 时可达。
    if (session.mock) {
      await StealthLockService.recordPayment(lockId, {
        paymentIntentId: session.sessionId,
        amountUsd: STEALTH_BUYOUT_AMOUNT_USD,
      });
      await StealthLockService.refreshProjection(opportunityId);
      return {
        lockId,
        checkoutUrl: session.url,
        amountUsd: STEALTH_BUYOUT_AMOUNT_USD,
        expiresAt: unlockAt,
      };
    }

    await StealthLockService.attachCheckoutSession(lockId, {
      id: session.sessionId,
      url: session.url,
      expiresAt: session.expiresAt,
    });
    return {
      lockId,
      checkoutUrl: session.url,
      amountUsd: STEALTH_BUYOUT_AMOUNT_USD,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * 重算该机会的公开投影（15 §3.1）。
   *
   * 付款落账后**必须立刻**调用，不能等 S8：买断者在 04:00 付完钱而下一次批处理在
   * 次日 03:30，中间最长一整天，一条已经卖出去的词根还挂在公开页上——按 15 §8 的
   * 「买断打码泄露率」那是 **P0 事故**。所以投影刷新是付款路径的一部分，而不是一个
   * 可以顺延的后台步骤。
   *
   * 失败只记日志不抛：调用它的地方是钱已经到账之后的 webhook，抛出去只会让 Stripe
   * 无限重试，而重试改变不了"付过款"这个事实；真正该做的是让下一次 S8 补上，同时
   * 由 `console.error` 留下痕迹。
   */
  static async refreshProjection(opportunityId: string): Promise<void> {
    await PublicPublicationService.publishOpportunity(opportunityId).catch((error) => {
      console.error(
        `[stealth-lock] public projection refresh failed for ${opportunityId}:`,
        error instanceof Error ? error.message : error
      );
    });
  }

  /** 结账会话建好后回填。 */
  static async attachCheckoutSession(
    lockId: string,
    session: { id: string; url: string; expiresAt: Date }
  ): Promise<void> {
    await query(
      `UPDATE stealth_locks
          SET provider_checkout_session_id = $2, provider_checkout_url = $3,
              checkout_expires_at = $4, updated_at = NOW()
        WHERE id = $1`,
      [lockId, session.id, session.url, session.expiresAt]
    );
  }

  /**
   * 托管结账完成（webhook 的唯一入口）。返回结论供调用方决定 HTTP 码与告警。
   *
   * 三件事按顺序做，顺序本身是有含义的：
   *
   *   1. **落账**（`recordPayment`）：写 `provider_payment_id`，锁从"占位"变成"成交"。
   *      这是这笔收入的唯一真源，所以它排第一——后面两步失败都不该阻止它。
   *   2. **补一行 `stripe_purchases` 归属**（13 §4.3）。它不参与记账，是给入站的
   *      `charge.refunded` / 争议用的：`applyPaymentEvent` 要求"按 PI 恰好查到一行"，
   *      查不到就抛错并被 `retry-stripe-attributions` 每小时重试。少了这一行，一次
   *      拒付会变成一个永不停止的 500 循环，而锁还稳稳挂着。
   *   3. **同步刷新公开投影**。这一步排在最后是因为它最不重要却最慢，而且它自己
   *      已经吞掉失败（`refreshProjection`）——投影刷新失败由下一次 S8 补上，
   *      不该让一次已经收钱的 webhook 返回 5xx 去换一次无用的重投。
   */
  static async confirmCheckout(
    session: {
      paymentIntentId: string | null;
      metadata: Record<string, unknown>;
    },
    amountUsd: number = STEALTH_BUYOUT_AMOUNT_USD
  ): Promise<
    | { status: 'ACTIVATED'; lockId: string; opportunityId: string }
    | { status: 'DUPLICATE'; lockId: string; opportunityId: string }
    | { status: 'VOIDED'; lockId: string; opportunityId: string }
    | { status: 'MISSING' }
    | { status: 'UNATTRIBUTED' }
  > {
    const lockId = typeof session.metadata.stealthLockId === 'string' ? session.metadata.stealthLockId : '';
    const paymentIntentId = session.paymentIntentId;
    // 元数据缺块说明这不是我们发出去的结账会话（或被改过）。回 `UNATTRIBUTED` 让
    // 路由层留下一条可查的记录，而不是静默 200 把一笔无法归属的钱放过去。
    if (!lockId || !paymentIntentId) return { status: 'UNATTRIBUTED' };

    const result = await StealthLockService.recordPayment(lockId, { paymentIntentId, amountUsd });

    if (result.status === 'ACTIVATED' || result.status === 'DUPLICATE') {
      const userId = typeof session.metadata.userId === 'string' ? session.metadata.userId : null;
      if (userId) {
        // ON CONFLICT DO NOTHING：同一笔重复投递不该让 `stripe_payment_intent_id`
        // 的唯一约束把一次幂等的补投变成 500。
        await query(
          `INSERT INTO stripe_purchases (id, user_id, stripe_payment_intent_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
          [`stl_${lockId}`, userId, paymentIntentId]
        );
      }
      await StealthLockService.refreshProjection(result.opportunityId);
    }

    return result.status === 'MISSING' ? { status: 'MISSING' } : { ...result, lockId };
  }



  /**
   * 补偿：结账会话没能建起来，撤掉刚写的占位。
   *
   * 删行在这里是对的（与作废不同）——这条锁**从未对外存在过**：没有会话，用户手里
   * 没有任何链接，也没有任何人看到过它。作废走的是翻 `status='VOID'`，因为那条锁
   * 是"用户点过下单、可能还付了钱"的对象，删掉会让「钱到了但占位没了」只能靠推断
   * （03 §17 I15）。
   */
  static async compensateFailedCheckout(lockId: string): Promise<void> {
    await query(`DELETE FROM stealth_lock_displays WHERE stealth_lock_id = $1`, [lockId]);
    await query(`DELETE FROM stealth_locks WHERE id = $1 AND provider_payment_id IS NULL`, [lockId]);
  }

  /**
   * 付款落账（webhook 调用）。返回结论而不是抛错：**这是钱已经到账之后的路径**，
   * 抛出去只会让 Stripe 无限重试，而重试改变不了"锁已经不在了"这个事实。
   */
  static async recordPayment(
    lockId: string,
    payment: { paymentIntentId: string; amountUsd: number }
  ): Promise<
    | { status: 'ACTIVATED'; opportunityId: string }
    | { status: 'DUPLICATE'; opportunityId: string }
    | { status: 'VOIDED'; opportunityId: string }
    | { status: 'MISSING' }
  > {
    return transaction(async (client: PoolClient) => {
      const res = await client.query<{
        id: string;
        opportunity_id: string;
        status: string;
        provider_payment_id: string | null;
      }>(
        `SELECT id, opportunity_id, status, provider_payment_id
           FROM stealth_locks WHERE id = $1 FOR UPDATE`,
        [lockId]
      );
      const row = res.rows[0];
      // 查不到：可能是补偿删掉的、也可能是运维手工清的。**不能静默 200**——这是
      // "钱已收、交付物不在"的唯一剩余入口。
      if (!row) return { status: 'MISSING' as const };

      if (row.provider_payment_id) {
        // 同一笔重复投递：幂等返回，不动数据。
        return row.provider_payment_id === payment.paymentIntentId
          ? { status: 'DUPLICATE' as const, opportunityId: row.opportunity_id }
          : { status: 'MISSING' as const };
      }
      if (row.status !== 'ACTIVE') {
        return { status: 'VOIDED' as const, opportunityId: row.opportunity_id };
      }

      await client.query(
        `UPDATE stealth_locks
            SET provider_payment_id = $2, amount_usd = $3, updated_at = NOW()
          WHERE id = $1`,
        [lockId, payment.paymentIntentId, payment.amountUsd]
      );
      return { status: 'ACTIVATED' as const, opportunityId: row.opportunity_id };
    });
  }

  /**
   * 作废超窗口的未付款占位（02 §5.1 的 `expire-stealth-locks` 作业的一半）。
   *
   * **翻状态前先向供应商确认会话确实未付款**：钱到了却把占位判为作废，就是"钱已收、
   * 交付物不在"（03 §17 I15）。`isPaid` 由调用方注入，因为它是唯一一处需要出站调用
   * 的地方，而服务层不该自己决定怎么问供应商。
   */
  static async voidUnpaid(
    isPaid: (sessionId: string | null) => Promise<boolean>
  ): Promise<Array<{ lockId: string; opportunityId: string }>> {
    const candidates = await query<{
      id: string;
      opportunity_id: string;
      provider_checkout_session_id: string | null;
    }>(
      `SELECT id, opportunity_id, provider_checkout_session_id
         FROM stealth_locks
        WHERE status = 'ACTIVE' AND provider_payment_id IS NULL
          AND locked_at < NOW() - INTERVAL '${STEALTH_RESERVATION_GRACE_MINUTES} minutes'
        ORDER BY locked_at`,
      []
    );

    const voided: Array<{ lockId: string; opportunityId: string }> = [];
    for (const row of candidates.rows) {
      if (await isPaid(row.provider_checkout_session_id)) continue;
      const res = await query(
        `UPDATE stealth_locks SET status = 'VOID', updated_at = NOW()
          WHERE id = $1 AND status = 'ACTIVE' AND provider_payment_id IS NULL`,
        [row.id]
      );
      if ((res.rowCount ?? 0) > 0) {
        voided.push({ lockId: row.id, opportunityId: row.opportunity_id });
        await AuditService.log({
          actorId: null,
          actorType: 'SYSTEM',
          action: 'stealth_lock.voided',
          targetType: 'opportunity',
          targetId: row.opportunity_id,
          payload: { lockId: row.id, reason: 'RESERVATION_EXPIRED' },
        });
      }
    }
    return voided;
  }

  /** 期满解密（作业的另一半）。`unlock_at` 到点即不再隐藏，这一步只翻状态。 */
  static async releaseExpired(): Promise<Array<{ lockId: string; opportunityId: string }>> {
    const res = await query<{ id: string; opportunity_id: string }>(
      `UPDATE stealth_locks SET status = 'EXPIRED', updated_at = NOW()
        WHERE status = 'ACTIVE' AND unlock_at <= NOW()
        RETURNING id, opportunity_id`,
      []
    );
    for (const row of res.rows) {
      await AuditService.log({
        actorId: null,
        actorType: 'SYSTEM',
        action: 'stealth_lock.expired',
        targetType: 'opportunity',
        targetId: row.opportunity_id,
        payload: { lockId: row.id },
      });
    }
    return res.rows.map((row) => ({ lockId: row.id, opportunityId: row.opportunity_id }));
  }

  /** 退款/拒付：锁作废（13 §4.3）。机会立即回到公共池，打码解除。 */
  static async voidForReversal(lockId: string, reason: string): Promise<void> {
    const res = await query<{ opportunity_id: string }>(
      `UPDATE stealth_locks SET status = 'VOID', updated_at = NOW()
        WHERE id = $1 AND status = 'ACTIVE'
        RETURNING opportunity_id`,
      [lockId]
    );
    const row = res.rows[0];
    if (!row) return;
    await AuditService.log({
      actorId: null,
      actorType: 'SYSTEM',
      action: 'stealth_lock.voided',
      targetType: 'opportunity',
      targetId: row.opportunity_id,
      payload: { lockId, reason },
    });
  }

  /** 我持有的买断（10 §4.5b 的 `GET /me/stealth-locks`）。`VOID` 行不出现。 */
  static async getMyLocks(userId: string): Promise<MyStealthLock[]> {
    const res = await query<{
      id: string;
      opportunity_id: string;
      status: string;
      locked_at: Date;
      unlock_at: Date;
      title: string | null;
      masked_label: string | null;
    }>(
      `SELECT sl.id, sl.opportunity_id, sl.status, sl.locked_at, sl.unlock_at,
              o.title,
              d.masked_label
         FROM stealth_locks sl
         JOIN opportunities o ON o.id = sl.opportunity_id
         LEFT JOIN stealth_lock_displays d
                ON d.stealth_lock_id = sl.id AND d.locale = $2
        WHERE sl.user_id = $1 AND sl.status <> 'VOID'
        ORDER BY sl.locked_at DESC`,
      [userId, PUBLICATION_LOCALES[0]]
    );

    const now = Date.now();
    return res.rows.map((row) => {
      const remainingMs = row.unlock_at.getTime() - now;
      return {
        lockId: row.id,
        opportunityId: row.opportunity_id,
        // 标题照原样给**持有者**：他买的就是这条机会，替他打码等于让他也看不见自己
        // 买的是什么（10 §7：只有非持有者才 404）。
        opportunityTitle: row.title ?? '',
        maskedLabel: row.masked_label ?? maskedLabel(row.id),
        lockedAt: row.locked_at.toISOString(),
        unlockAt: row.unlock_at.toISOString(),
        remainingDays: remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 86400000),
        status: row.status,
      };
    });
  }

}
