import { createHash } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import type { PoolClient } from '@emeradar/db';
import { canonicalizeJson } from '@emeradar/ledger';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';
import { SlotService } from './slot.service';
import { StakeService, CREDENTIAL_TYPES, isCredentialType, probeCredential, type CredentialProbe } from './stake.service';
import { normalizeCredentialHost } from './credential-host';
import { hiddenFromViewer } from './stealth-lock-policy';

export const PASS_REASONS = [
  'DEMAND_TOO_THIN',
  'WINDOW_ALREADY_CLOSED',
  'NO_COMMERCIAL_PROOF',
  'OUTSIDE_TIME_BUDGET',
  'NOT_MY_SKILL',
  'OTHER',
] as const;

export type PassReason = (typeof PASS_REASONS)[number];

export type DecisionKind = 'GO' | 'PASS';

export interface RecordDecisionInput {
  opportunityId: string;
  /** The exact verdict row the user was looking at. Required. */
  verdictId: string;
  decision: DecisionKind;
  reasons?: string[];
}

export interface RecordedDecision {
  id: string;
  verdictId: string;
}

/**
 * Content fingerprint of a decision row.
 *
 * It covers *what* was recorded, not *when* relative to other decisions — there
 * is deliberately no `prev_hash` chain here, because decisions are concurrent
 * acts by different users with no natural global order. Paired with the
 * append-only trigger in schema.sql, this makes a decision's justification
 * verifiable after the fact: rewrite the row and the fingerprint stops matching.
 *
 * `verdictRowHash` is included on purpose. It is the fingerprint of the cited
 * verdict's *content*, so a decision is bound to the reasoning the user actually
 * read rather than merely to a row id that could later be re-pointed.
 */
export function calculateDecisionRowHash(row: {
  id: string;
  opportunityId: string;
  userId: string;
  decision: string;
  verdictId: string;
  verdictRowHash: string | null;
  reasons: string[];
  channel: string;
}): string {
  const hash = createHash('sha256');
  hash.update(
    canonicalizeJson({
      id: row.id,
      opportunityId: row.opportunityId,
      userId: row.userId,
      decision: row.decision,
      verdictId: row.verdictId,
      verdictRowHash: row.verdictRowHash,
      // Reasons keep their recorded order: the array as stored is the array
      // that gets hashed, so a verifier can recompute from the row itself.
      reasons: row.reasons,
      channel: row.channel,
    }),
    'utf8'
  );
  return hash.digest('hex');
}

export interface GoAndExportInput {
  opportunityId: string;
  archetype: string;
  /** 用户当下渲染的那一条裁决。必填：GO 必须绑定他实际读到的推理。 */
  verdictId: string;
  reportId?: string;
  /** 可选的当场质押。给了就先探针校验，通过了才进入事务。 */
  credential?: { type: string; url: string };
}

export interface GoAndExportResult {
  projectId: string;
  slotClaimId: string;
  stakeDeadlineAt: string;
  /**
   * 点火包的导出地址（09 §5.3）。装配本身属于 Epic 1.9，此处只返回**凭据**：
   * 端点存在与否由项目是否由 GO 建立决定，而不是由 URL 猜。
   */
  launchKitUrl: string;
}

function launchKitUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}/launch-kit`;
}

export class DecisionService {
  /**
   * 原子 GO（ADR-018、PRD §1.7 第 5 条、10 §4.3、13 §4.3）。
   *
   * 一个事务内完成四件事：扣一次 `atomic_go_export_monthly` → 占一个形态槽位 →
   * 建 Project → 解锁该形态点火包。
   *
   * 为什么必须是同一个事务：这四件事若分头提交，"先建项目、事后补 GO"就成了一个
   * 可观测状态，而 GO 一旦可以被事后补，点火包就同样可以被事后补——绕过 API 即可
   * 白拿付费交付物，那正是 ADR-018 要防的。
   *
   * 网络调用（凭证探针）**在事务之外**：一个 6 秒超时的探针会把 `opportunity_slots`
   * 的目标行锁住 6 秒，把"四人抢最后一个槽位"变成一串串行等待。探针先跑完，事务里
   * 只写它的结论。
   */
  static async goAndExport(
    userId: string,
    input: GoAndExportInput,
    options: { fetchImpl?: typeof fetch; now?: Date } = {}
  ): Promise<GoAndExportResult> {
    const now = options.now ?? new Date();

    const opportunityRes = await query<{ id: string; title: string; status: string; execution_class: string }>(
      `SELECT o.id, o.title, o.status, o.execution_class
         FROM opportunities o
         JOIN opportunity_cards c ON c.opportunity_id = o.id
        WHERE o.id = $1 AND ${hiddenFromViewer('o.id', '$2')}`,
      [input.opportunityId, userId]
    );
    const opportunity = opportunityRes.rows[0];
    if (!opportunity || opportunity.status !== 'TRACKED') {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Published opportunity not found: ${input.opportunityId}`, 404);
    }

    const verdictRes = await query<{ id: string; row_hash: string | null }>(
      `SELECT id, row_hash FROM verdicts WHERE id = $1 AND opportunity_id = $2`,
      [input.verdictId, input.opportunityId]
    );
    const verdict = verdictRes.rows[0];
    if (!verdict) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'The cited verdict does not belong to this opportunity. Reload the page — the verdict you were shown is no longer current.',
        409
      );
    }

    if (input.reportId) {
      const reportRes = await query(
        `SELECT 1 FROM opportunity_reports WHERE id = $1 AND user_id = $2 AND opportunity_id = $3`,
        [input.reportId, userId, input.opportunityId]
      );
      if (reportRes.rows.length === 0) {
        throw new EmeradarError(ErrorCode.FORBIDDEN, 'Report does not belong to this user and opportunity.', 403);
      }
    }

    // 有逾期未处理的项目就先处理（10 §1.1 的 STAKE_REQUIRED）。放在最前面是因为
    // 它问的是"你上一个承诺兑现了吗"，比"这个月还有没有额度"更根本。
    const overdue = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects
        WHERE user_id = $1 AND stake_status = 'PENDING' AND stake_deadline_at < $2`,
      [userId, now]
    );
    if ((overdue.rows[0]?.count ?? 0) > 0) {
      throw new EmeradarError(
        ErrorCode.STAKE_REQUIRED,
        'You have a project whose stake window (7/14/21 days by execution class) has passed without a verified credential. Its slot is released at the next sweep; submit a credential to keep it.',
        422,
        { details: { overdueProjects: overdue.rows[0].count } }
      );
    }

    // 凭证探针在事务外跑。失败**不消耗配额**：为一个打不开的页面扣掉一次月度额度
    // 不是用户能接受的代价，而 GO 还没成立。
    let probe: CredentialProbe | null = null;
    if (input.credential) {
      if (!isCredentialType(input.credential.type)) {
        throw new EmeradarError(
          ErrorCode.VALIDATION_ERROR,
          `credential.type must be one of ${CREDENTIAL_TYPES.join(', ')}.`,
          400
        );
      }
      const terms = await DecisionService.opportunityTerms(input.opportunityId);
      probe = await probeCredential({
        url: input.credential.url,
        credentialType: input.credential.type,
        terms,
        fetchImpl: options.fetchImpl,
      });
      if (!probe.ok) {
        throw new EmeradarError(
          ErrorCode.CREDENTIAL_UNVERIFIED,
          probe.reason ?? 'The submitted credential could not be verified.',
          422,
          { details: { probe } }
        );
      }
    }

    const projectId = `prj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return transaction(async (client) => {
      // 1) 扣配额。放第一位：免费层在这里拿到 PLAN_REQUIRED，额度用尽拿到
      //    QUOTA_EXCEEDED，两者都不该被"槽位刚好也满了"的 409 盖过去——别人占满了
      //    是换条机会的事，自己没额度是换套餐的事，前端给的是完全不同的引导。
      const quota = await EntitlementService.reserveAtomicGoQuota(client, userId);

      // 2) 决策。与项目同事务：一条决策至多一个项目（I6），而"有项目没决策"会让
      //    这条项目的来源无法被审计。
      const decision = await DecisionService.insertGoDecision(client, {
        userId,
        opportunityId: input.opportunityId,
        verdictId: verdict.id,
        verdictRowHash: verdict.row_hash,
      });

      // 3) 建项目。`stake_status` 默认 PENDING、期限 = now + stake_window_days。
      //
      // 先建项目再占槽，是因为 schema 自身的依赖方向就是这样：
      // `slot_claims.project_id` 是 NOT NULL 外键且**立即检查**，认领行不可能先于
      // 项目行存在。10 §4.3 描述的"占槽 → 建 Project"是**概念顺序**（先判定有没有
      // 位置、再落地），不是语句顺序；两者在同一个事务里等价，而逆着外键写只会得到
      // 一个 23503。占槽失败时整个事务回滚，不会留下一个没有槽位的项目。
      const stakeDeadlineAt = StakeService.deadlineFrom(
        now,
        StakeService.windowDaysFor(opportunity.execution_class)
      );
      await client.query(
        `INSERT INTO projects
           (id, user_id, opportunity_id, decision_id, report_id, title, domain, build_type,
            status, launch_date, target_keywords, stake_status, stake_deadline_at, go_quota_period_start)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'IN_DEVELOPMENT',NULL,'{}','PENDING',$8,$9)`,
        [
          projectId,
          userId,
          input.opportunityId,
          decision.id,
          input.reportId ?? null,
          opportunity.title,
          input.archetype,
          stakeDeadlineAt,
          quota.periodStart,
        ]
      );

      // 4) 占槽。并发抢同一形态最后一个槽位时，只有这一个条件递增能让其中一个事务
      //    拿到行；其余的在这里抛 SLOT_TAKEN，整笔回滚（含已扣的配额）。
      const claim = await SlotService.claim(client, {
        opportunityId: input.opportunityId,
        archetype: input.archetype,
        userId,
        projectId,
        claimedAt: now,
        deadlineAt: stakeDeadlineAt,
      });

      if (probe && input.credential) {
        await client.query(
          `INSERT INTO project_credentials
             (id, project_id, credential_type, url, host, verification_state, probe, checked_at)
           VALUES ($1,$2,$3,$4,$5,'VERIFIED',$6::jsonb,NOW())`,
          [
            `crd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            projectId,
            input.credential.type,
            probe.finalUrl ?? input.credential.url,
            // 归一化主机名是 SERP 排名匹配的键（02 §5）。这里曾经写死 NULL，于是从
            // GO 入口提交凭证的项目永远不会被任何快照匹配到——追踪静默地什么也不做，
            // 而界面上没有任何东西显示它没在做。
            normalizeCredentialHost(probe.finalUrl ?? input.credential.url),
            JSON.stringify({
              ok: probe.ok,
              httpStatus: probe.httpStatus,
              title: probe.title,
              h1: probe.h1,
              metaDescription: probe.metaDescription,
              relevance: probe.relevance,
              matchedTerms: probe.matchedTerms,
            }),
          ]
        );
        // 注意 `project_credentials_one_verified` 是每项目一条的部分唯一索引，
        // 所以这里必须先删掉可能的旧 REJECTED 行再置 VERIFIED——同一事务内先插后改
        // 不会撞索引，因为此刻只有刚插入的这一条。
        await client.query(`UPDATE projects SET stake_status = 'VERIFIED' WHERE id = $1`, [projectId]);
      }

      return {
        projectId,
        slotClaimId: claim.slotClaimId,
        stakeDeadlineAt: stakeDeadlineAt.toISOString(),
        launchKitUrl: launchKitUrl(projectId),
      };
    }).catch((error: any) => {
      // 唯一索引是并发下的兜底，但它的冲突不能以 500 的形式泄漏出去：
      //   - `idx_projects_decision`：同一 (用户, 机会, 裁决) 的 GO 是幂等的，
      //     所以重复点击会复用同一条决策，再建项目就撞上这条索引（I6）。
      //   - `slot_claims_one_active_per_user_opportunity`：同一用户在同一机会上
      //     只能有一条活跃认领（I11）。按用户取的事务锁让上面那层预检查在同用户
      //     并发下已经够用，这里兜的是它够不到的情形。
      const constraint = String(error?.constraint ?? '');
      if (error?.code === '23505' && (constraint === 'idx_projects_decision' || constraint === 'slot_claims_one_active_per_user_opportunity')) {
        throw new EmeradarError(
          ErrorCode.CONFLICT,
          'You have already started a project from this opportunity.',
          409
        );
      }
      throw error;
    });
  }

  /** 机会的主词与簇内词，供凭证探针判定相关性。 */
  private static async opportunityTerms(opportunityId: string): Promise<string[]> {
    const res = await query<{ term: string }>(
      `SELECT COALESCE(q.query_text, c.primary_query) AS term
         FROM opportunity_cards c
         LEFT JOIN opportunity_queries oq ON oq.opportunity_id = c.opportunity_id
         LEFT JOIN queries q ON q.id = oq.query_id
        WHERE c.opportunity_id = $1 AND COALESCE(q.query_text, c.primary_query) IS NOT NULL`,
      [opportunityId]
    );
    return res.rows.map((row) => row.term);
  }

  /**
   * 写 GO 决策，按 (user, opportunity, verdict) 幂等。
   *
   * 幂等不是礼节性的：客户端在 GO 之后还要拿点火包，中途失败重试一次不该留下第二条
   * GO。`idx_decisions_go_lookup` 是这条规则的物理依据。
   */
  private static async insertGoDecision(
    client: PoolClient,
    input: { userId: string; opportunityId: string; verdictId: string; verdictRowHash: string | null }
  ): Promise<{ id: string }> {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM decisions
        WHERE user_id = $1 AND opportunity_id = $2 AND verdict_id = $3 AND decision = 'GO' LIMIT 1`,
      [input.userId, input.opportunityId, input.verdictId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const id = `dcs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const rowHash = calculateDecisionRowHash({
      id,
      opportunityId: input.opportunityId,
      userId: input.userId,
      decision: 'GO',
      verdictId: input.verdictId,
      verdictRowHash: input.verdictRowHash,
      reasons: [],
      channel: 'WEB',
    });
    await client.query(
      `INSERT INTO decisions
         (id, opportunity_id, user_id, decision, verdict_id, verdict_row_hash, reasons, channel, row_hash)
       VALUES ($1,$2,$3,'GO',$4,$5,'{}','WEB',$6)`,
      [id, input.opportunityId, input.userId, input.verdictId, input.verdictRowHash, rowHash]
    );
    return { id };
  }

  /**
   * Record the user's GO or PASS, bound to the verdict they were shown.
   *
   * `verdictId` comes from the caller. It is verified to belong to this
   * opportunity, but it is deliberately *not* required to be the newest verdict:
   * pinning the row the user actually read is the whole point, and refusing a
   * slightly older verdict would push the caller back into guessing.
   */
  static async record(userId: string, input: RecordDecisionInput): Promise<RecordedDecision> {
    const reasons = input.decision === 'PASS' ? cleanPassReasons(input.reasons ?? []) : [];
    if (input.decision === 'PASS' && reasons.length === 0) {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        'Choose at least one reason to pass on this opportunity.',
        400
      );
    }

    const opportunityRes = await query<{ id: string }>(
      `SELECT o.id
       FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE o.id = $1 AND o.status = 'TRACKED'`,
      [input.opportunityId]
    );
    if (opportunityRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Published opportunity not found: ${input.opportunityId}`,
        404
      );
    }

    const verdictRes = await query<{ id: string; row_hash: string | null }>(
      `SELECT id, row_hash FROM verdicts WHERE id = $1 AND opportunity_id = $2`,
      [input.verdictId, input.opportunityId]
    );
    const verdict = verdictRes.rows[0];
    if (!verdict) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'The cited verdict does not belong to this opportunity. Reload the page — the verdict you were shown is no longer current.',
        409
      );
    }

    const id = `dcs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const channel = 'WEB';

    /**
     * GO is idempotent per (user, opportunity, verdict).
     *
     * A GO is a commitment, so re-committing to the same verdict is the same act
     * rather than a new one — and the client makes two calls (decision, then
     * project), so a failure between them would otherwise leave a stray GO
     * behind on every retry. PASS is deliberately *not* deduplicated: reasons
     * are a judgement that can legitimately change.
     */
    if (input.decision === 'GO') {
      const existingRes = await query<{ id: string; verdict_id: string }>(
        `SELECT id, verdict_id FROM decisions
         WHERE user_id = $1 AND opportunity_id = $2 AND verdict_id = $3 AND decision = 'GO'
         LIMIT 1`,
        [userId, input.opportunityId, verdict.id]
      );
      const existing = existingRes.rows[0];
      if (existing) return { id: existing.id, verdictId: existing.verdict_id };
    }

    const rowHash = calculateDecisionRowHash({
      id,
      opportunityId: input.opportunityId,
      userId,
      decision: input.decision,
      verdictId: verdict.id,
      verdictRowHash: verdict.row_hash,
      reasons,
      channel,
    });

    await query(
      `INSERT INTO decisions (
         id, opportunity_id, user_id, decision, verdict_id, verdict_row_hash,
         reasons, channel, row_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        input.opportunityId,
        userId,
        input.decision,
        verdict.id,
        verdict.row_hash,
        reasons,
        channel,
        rowHash,
      ]
    );

    return { id, verdictId: verdict.id };
  }
}

function cleanPassReasons(reasons: string[]): string[] {
  return reasons.filter((reason) => (PASS_REASONS as readonly string[]).includes(reason));
}
