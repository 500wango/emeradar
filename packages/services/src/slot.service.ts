import { query } from '@emeradar/db';
import type { PoolClient } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';

/**
 * 认领槽位（ADR-018、01 §1.7 第 5 条、03 §8、05 §5.1）。
 *
 * 这个模块是"某人还占着这条机会"的**唯一**写入点，也是 `opportunity_slots.claimed`
 * 这个汇总缓存唯一的维护者。缓存与 `slot_claims` 的真值必须同事务更新：任何一处
 * 单独改都会让 I11 的夜间检查变成噪声，而噪声会被忽略。
 *
 * 槽位取代了早先"每条机会至多 5 个立项"的单一上限。区别不只是数字：单一上限下，
 * 工具站满了会连带劝退做 Micro-SaaS 的人，而两者根本不竞争同一个搜索词。
 */

/** 每形态默认容量（05 §7.1 `slots.default_capacity_per_archetype`）。 */
export const DEFAULT_SLOT_CAPACITY = 2;
/** 一条机会全部形态的容量之和上限（05 §7.1 `slots.max_capacity_total`、不变量 I10）。 */
export const MAX_CAPACITY_TOTAL = 6;
/** 同一用户同时活跃的 GO 上限（05 §7.1 `slots.max_active_go_per_user`、13 §3.2）。 */
export const MAX_ACTIVE_GO_PER_USER = 2;

/**
 * 一条机会最多提供几个形态的队。由 `MAX_CAPACITY_TOTAL / DEFAULT_SLOT_CAPACITY`
 * 推出而不是另写一个常量：这两个数一旦不同步，Σcapacity ≤ 6 就会被静静地破掉。
 */
export const MAX_ARCHETYPES_PER_OPPORTUNITY = Math.floor(MAX_CAPACITY_TOTAL / DEFAULT_SLOT_CAPACITY);

export interface SlotState {
  archetype: string;
  capacity: number;
  claimed: number;
  remaining: number;
}

export interface MyClaim {
  slotClaimId: string;
  projectId: string;
  archetype: string;
  claimedAt: string;
  deadlineAt: string;
}

export interface OpportunitySlots {
  opportunityId: string;
  slots: SlotState[];
  totalCapacity: number;
  totalClaimed: number;
  totalRemaining: number;
  /** 当前用户已占的那一个形态；未登录或未认领时为 null。 */
  myClaim: MyClaim | null;
}

export class SlotService {
  /**
   * 物化一条机会的槽位行。**只在机会首次变为 TRACKED 时调用**。
   *
   * 集合一旦落地就不再变：每日按新的 top-3 去增删，会让累计的 Σcapacity 越过
   * `MAX_CAPACITY_TOTAL`，而删行会把已认领的槽位连同认领记录一起弄丢。宁可让一条
   * 早期机会少提供几个形态，也不让容量约束在运行中失效。
   *
   * 传入的 `archetypes` 是推荐层的排序结果，按顺序取前
   * `MAX_ARCHETYPES_PER_OPPORTUNITY` 个；重复值会被去掉（同一个形态出现两次会
   * 撞主键，且没有任何意义）。
   */
  static async materialize(
    client: PoolClient,
    opportunityId: string,
    archetypes: readonly string[],
    capacity: number = DEFAULT_SLOT_CAPACITY
  ): Promise<void> {
    const distinct = [...new Set(archetypes)].slice(0, MAX_ARCHETYPES_PER_OPPORTUNITY);
    if (distinct.length === 0) return;
    // I10 在代码侧的第一道闸：Σcapacity 不得越过 max_capacity_total。这里挡住的
    // 是"调用方给的 capacity 太大"这种情形；形态数量已被上面的 slice 限制。
    if (distinct.length * capacity > MAX_CAPACITY_TOTAL) {
      throw new EmeradarError(
        ErrorCode.INTERNAL,
        `Slot capacity for ${opportunityId} would exceed the ${MAX_CAPACITY_TOTAL} total.`,
        500
      );
    }
    await client.query(
      `INSERT INTO opportunity_slots (opportunity_id, archetype, capacity)
       SELECT $1, a, $3 FROM unnest($2::text[]) AS a
       ON CONFLICT (opportunity_id, archetype) DO NOTHING`,
      [opportunityId, distinct, capacity]
    );
  }

  /** 槽位明细。读路径不写库：没有行的形态按"未提供"处理，而不是就地补一行。 */
  static async getSlots(opportunityId: string, userId?: string): Promise<OpportunitySlots> {
    const rows = await query<{ archetype: string; capacity: number; claimed: number }>(
      `SELECT archetype, capacity, claimed FROM opportunity_slots
        WHERE opportunity_id = $1 ORDER BY archetype`,
      [opportunityId]
    );
    const slots: SlotState[] = rows.rows.map((row) => {
      const capacity = Number(row.capacity);
      const claimed = Number(row.claimed);
      return { archetype: row.archetype, capacity, claimed, remaining: Math.max(0, capacity - claimed) };
    });

    let myClaim: MyClaim | null = null;
    if (userId) {
      const mine = await query<{
        id: string; project_id: string; archetype: string; claimed_at: Date; deadline_at: Date;
      }>(
        `SELECT id, project_id, archetype, claimed_at, deadline_at FROM slot_claims
          WHERE opportunity_id = $1 AND user_id = $2 AND state = 'CLAIMED' LIMIT 1`,
        [opportunityId, userId]
      );
      const row = mine.rows[0];
      if (row) {
        myClaim = {
          slotClaimId: row.id,
          projectId: row.project_id,
          archetype: row.archetype,
          claimedAt: row.claimed_at.toISOString(),
          deadlineAt: row.deadline_at.toISOString(),
        };
      }
    }

    return {
      opportunityId,
      slots,
      totalCapacity: slots.reduce((sum, s) => sum + s.capacity, 0),
      totalClaimed: slots.reduce((sum, s) => sum + s.claimed, 0),
      totalRemaining: slots.reduce((sum, s) => sum + s.remaining, 0),
      myClaim,
    };
  }

  /** 该用户当前活跃的 GO 数（D2：唯一判据是 `slot_claims.state = 'CLAIMED'`）。 */
  static async countActiveClaims(userId: string): Promise<number> {
    const res = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM slot_claims WHERE user_id = $1 AND state = 'CLAIMED'`,
      [userId]
    );
    return res.rows[0]?.count ?? 0;
  }

  /**
   * 占用一个槽位。**必须在调用方的事务里执行**——它与扣配额、建 Project 是同一个
   * 原子操作的三段，任何一段单独提交都会留下一个可以被绕过的中间态。
   *
   * 并发保证来自条件递增而不是"先查后写"：四个人抢同一个形态的最后一个槽位时，
   * 后到的三个会在行锁上等待，等第一个提交后重新求值 `claimed < capacity`，于是
   * 恰好一个拿到行。这正是 10 §4.3 写在契约里的那一条。
   */
  static async claim(
    client: PoolClient,
    input: {
      opportunityId: string;
      archetype: string;
      userId: string;
      projectId: string;
      claimedAt: Date;
      deadlineAt: Date;
    }
  ): Promise<{ slotClaimId: string }> {
    // 同一用户的并发 GO 必须先串行化，否则 `active_go_slots_max` 的检查会是一个
    // 竞态：两个人格（两个标签页）同时 GO 两条不同机会，各自读到 1 < 2 就都放行。
    // 按用户加事务级锁，比在每条机会上分别加锁更直接。
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`go:${input.userId}`]);

    // 同一个用户在同一条机会上只能有一条活跃认领（I11 的部分唯一索引）。在插入前
    // 先查一次，是为了把"用户重复点 GO"变成一句能读懂的话，而不是让索引冲突泄漏成
    // 500。锁在上一步已经按用户取得，所以这条检查在同用户并发下是可靠的；索引仍然
    // 保留，负责它管得住的那种并发。
    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM slot_claims
        WHERE user_id = $1 AND opportunity_id = $2 AND state = 'CLAIMED' LIMIT 1`,
      [input.userId, input.opportunityId]
    );
    if (duplicate.rows[0]) {
      throw new EmeradarError(
        ErrorCode.CONFLICT,
        'You already hold a slot on this opportunity.',
        409,
        { details: { slotClaimId: duplicate.rows[0].id } }
      );
    }

    const active = await SlotService.countActiveClaimsWithin(client, input.userId);
    const slotsMax = await SlotService.activeSlotsMaxWithin(client, input.userId);
    if (active >= slotsMax) {
      throw new EmeradarError(
        ErrorCode.ACTIVE_SLOTS_EXCEEDED,
        `You already have ${active} active claim(s); the limit is ${slotsMax}. Finish or archive one before starting another.`,
        409,
        { details: { active, slotsMax } }
      );
    }

    const bumped = await client.query<{ capacity: number; claimed: number }>(
      `UPDATE opportunity_slots
          SET claimed = claimed + 1, updated_at = NOW()
        WHERE opportunity_id = $1 AND archetype = $2 AND claimed < capacity
        RETURNING capacity, claimed`,
      [input.opportunityId, input.archetype]
    );
    if (bumped.rows.length === 0) {
      // 区分"这个形态没开放"与"开放了但被占满"：前者是调用方用错了参数（400 级），
      // 后者才是 SLOT_TAKEN（409）。两者给用户的下一步动作完全不同。
      const exists = await client.query(
        `SELECT 1 FROM opportunity_slots WHERE opportunity_id = $1 AND archetype = $2`,
        [input.opportunityId, input.archetype]
      );
      if (exists.rows.length === 0) {
        throw new EmeradarError(
          ErrorCode.VALIDATION_ERROR,
          `This opportunity does not offer a ${input.archetype} track.`,
          400,
          { details: { alternatives: await SlotService.alternativesWithin(client, input.opportunityId) } }
        );
      }
      throw new EmeradarError(
        ErrorCode.SLOT_TAKEN,
        `The ${input.archetype} track for this opportunity is full.`,
        409,
        { details: { alternatives: await SlotService.alternativesWithin(client, input.opportunityId) } }
      );
    }

    const slotClaimId = `slc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await client.query(
      `INSERT INTO slot_claims
         (id, opportunity_id, archetype, user_id, project_id, state, claimed_at, deadline_at)
       VALUES ($1, $2, $3, $4, $5, 'CLAIMED', $6, $7)`,
      [
        slotClaimId,
        input.opportunityId,
        input.archetype,
        input.userId,
        input.projectId,
        input.claimedAt,
        input.deadlineAt,
      ]
    );
    return { slotClaimId };
  }

  /**
   * 释放一个槽位（质押逾期、凭证校验失败、用户归档、机会归档）。
   *
   * **不退还已扣的配额**——这是让"占坑"有成本的那一半设计（PRD §1.7 第 5 条）。
   * 所以这里只碰槽位，绝不碰 `usage_counters`。
   */
  static async release(
    client: PoolClient,
    input: {
      slotClaimId: string;
      state: 'RELEASED' | 'EXPIRED';
      reason: 'STAKE_EXPIRED' | 'STAKE_INVALID' | 'USER_ARCHIVED' | 'OPPORTUNITY_ARCHIVED';
    }
  ): Promise<boolean> {
    const released = await client.query<{ opportunity_id: string; archetype: string }>(
      `UPDATE slot_claims
          SET state = $2, released_at = NOW(), release_reason = $3
        WHERE id = $1 AND state = 'CLAIMED'
        RETURNING opportunity_id, archetype`,
      [input.slotClaimId, input.state, input.reason]
    );
    const row = released.rows[0];
    // 已经释放过的行不再递减计数：重复执行必须幂等，否则一次重试会把别人的占用
    // 从汇总缓存里减掉，而真值没变——这正是 I11 要抓的那种漂移。
    if (!row) return false;
    await client.query(
      `UPDATE opportunity_slots
          SET claimed = GREATEST(0, claimed - 1), updated_at = NOW()
        WHERE opportunity_id = $1 AND archetype = $2`,
      [row.opportunity_id, row.archetype]
    );
    return true;
  }

  /** 同一条机会上仍有空余的其它形态，供 `409 SLOT_TAKEN` 的 `alternatives[]`。 */
  private static async alternativesWithin(client: PoolClient, opportunityId: string): Promise<string[]> {
    const res = await client.query<{ archetype: string }>(
      `SELECT archetype FROM opportunity_slots
        WHERE opportunity_id = $1 AND claimed < capacity ORDER BY archetype`,
      [opportunityId]
    );
    return res.rows.map((row) => row.archetype);
  }

  private static async countActiveClaimsWithin(client: PoolClient, userId: string): Promise<number> {
    const res = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM slot_claims WHERE user_id = $1 AND state = 'CLAIMED'`,
      [userId]
    );
    return res.rows[0]?.count ?? 0;
  }

  /**
   * 该用户套餐允许的活跃 GO 上限。读的是目录里的 `active_go_slots_max`，
   * 缺键时按 0 处理——**失败关闭**：读不到额度就不给额度，而不是给一个默认的 2。
   */
  private static async activeSlotsMaxWithin(client: PoolClient, userId: string): Promise<number> {
    const res = await client.query<{ slots_max: string | null; role: string }>(
      `SELECT u.role,
              (COALESCE(p.entitlements, '{}'::jsonb)
               || COALESCE(NULLIF(s.entitlements_snapshot, '{}'::jsonb), '{}'::jsonb))
                ->>'active_go_slots_max' AS slots_max
         FROM users u
         LEFT JOIN LATERAL (
           SELECT plan_code, entitlements_snapshot FROM subscriptions
            WHERE user_id = u.id
              AND ((status IN ('ACTIVE','TRIALING') AND current_period_end > NOW())
                OR (status = 'PAST_DUE' AND past_due_since > NOW() - INTERVAL '7 days'))
            LIMIT 1
         ) s ON true
         LEFT JOIN plans p ON p.code = COALESCE(s.plan_code, 'FREE')
        WHERE u.id = $1 AND u.status = 'ACTIVE'`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) throw new EmeradarError(ErrorCode.UNAUTHORIZED, 'User not found', 404);
    if (row.role === 'ADMIN') return Number.MAX_SAFE_INTEGER;
    const parsed = row.slots_max === null ? 0 : Number.parseInt(row.slots_max, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
}
