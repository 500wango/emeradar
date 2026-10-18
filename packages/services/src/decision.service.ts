import { createHash } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import type { PoolClient } from '@emeradar/db';
import { canonicalizeJson } from '@emeradar/ledger';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';
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
}

export interface GoAndExportResult {
  projectId: string;
  /**
   * 点火包的导出地址（09 §5.3）。装配本身属于 Epic 1.9，此处只返回**凭据**：
   * 端点存在与否由项目是否由 GO 建立决定，而不是由 URL 猜。
   */
  launchKitUrl: string;
}

function launchKitUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}/launch-kit`;
}

/** 409 ALREADY_GO：重复 GO 不是错误，而是一次幂等的"已经在了"。 */
function alreadyGo(projectId: string | undefined) {
  return new EmeradarError(
    ErrorCode.ALREADY_GO,
    'You have already started a project from this opportunity.',
    409,
    { details: { project_id: projectId ?? null } }
  );
}

export class DecisionService {
  /**
   * 原子 GO（ADR-018、PRD §1.7 第 5 条、10 §4.3、13 §4.3）。
   *
   * 一个事务内完成三件事：预占一次 `atomic_go_export_monthly` → 写 GO 决策 →
   * 建 Project 壳并授权点火包。
   *
   * 为什么必须是同一个事务：这三件事若分头提交，"先建项目、事后补 GO"就成了一个
   * 可观测状态，而 GO 一旦可以被事后补，点火包就同样可以被事后补——绕过 API 即可
   * 白拿付费交付物，那正是 ADR-018 要防的。
   *
   * v3.1 起这里**没有**槽位认领、凭证探针或质押期限：并发 GO 各扣各的配额，不做
   * 任何"最后一个名额"检查（01 §1.8 第 5 条）。重复 GO 是幂等的 409 ALREADY_GO，
   * 不重复扣减配额。
   */
  static async goAndExport(userId: string, input: GoAndExportInput): Promise<GoAndExportResult> {
    const opportunityRes = await query<{ id: string; title: string; status: string }>(
      `SELECT o.id, o.title, o.status
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
      // PRECONDITION_FAILED 的 HTTP 语义是 422：请求本身合法，但"你看到的那条裁决"
      // 已经不是当前状态。10 §4.3 把重载页面列为唯一正确的下一步。
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'The cited verdict does not belong to this opportunity. Reload the page — the verdict you were shown is no longer current.',
        422
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

    // v3.1（01 §1.8 第 5 条、ADR-018、13 §4）：一次原子事务只剩三件事——
    // 扣一次 `atomic_go_export_monthly`、建 Project 壳、授权点火包。
    //
    // 没有槽位、没有容量上限、没有活跃 GO 上限、没有质押、没有凭证门禁。凭证核验是
    // GO 之后的可选动作（`credential_status`），失败不释放任何资源，也不退配额。
    //
    // 点火包的**内容**也不在这里装配：它依赖报告、证据与冻结快照，还可能调用 LLM，
    // 任何一步失败都会把 GO 一起回滚。这里只保证"存在该用户对该 decision_id 的 GO
    // Project"这条授权成立，内容由首次导出时懒装配（见 LaunchKitService）。
    return transaction(async (client) => {
      // 1) 重复 GO 先于配额预占：同一 (用户, 机会, 裁决) 已经有项目时，重试不该再扣
      //    一次额度，也不该被并发写进第二条项目。这一步在事务里，与下面的插入共享
      //    同一快照，所以"先查后插"在两个并发请求之间也是安全的。
      const existing = await client.query<{ id: string }>(
        `SELECT p.id
           FROM projects p
           JOIN decisions d ON d.id = p.decision_id
          WHERE p.user_id = $1 AND d.user_id = $1
            AND d.decision = 'GO'
            AND d.opportunity_id = $2
            AND d.verdict_id = $3
          LIMIT 1`,
        [userId, input.opportunityId, verdict.id]
      );
      if (existing.rows[0]) throw alreadyGo(existing.rows[0].id);

      // 2) 配额。放第一位：免费层在这里拿到 PLAN_REQUIRED，额度用尽拿到
      //    QUOTA_EXCEEDED，两者都不该被后面的任何失败盖过去。
      const quota = await EntitlementService.reserveAtomicGoQuota(client, userId);

      // 3) 决策。与项目同事务：一条决策至多一个项目（I6），而"有项目没决策"会让
      //    这条项目的来源无法被审计。
      const decision = await DecisionService.insertGoDecision(client, {
        userId,
        opportunityId: input.opportunityId,
        verdictId: verdict.id,
        verdictRowHash: verdict.row_hash,
      });

      // 4) 项目壳。`credential_status` 起步是 UNVERIFIED；`stake_*` 是 v3.0 的遗留列，
      //    v3.1 的 GO 不写它们（0020 删除）。
      const projectId = `prj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await client.query(
        `INSERT INTO projects
           (id, user_id, opportunity_id, decision_id, report_id, title, domain, build_type,
            status, launch_date, target_keywords, credential_status, go_quota_period_start)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'IN_DEVELOPMENT',NULL,'{}','UNVERIFIED',$8)`,
        [
          projectId,
          userId,
          input.opportunityId,
          decision.id,
          input.reportId ?? null,
          opportunity.title,
          input.archetype,
          quota.periodStart,
        ]
      );

      return { projectId, launchKitUrl: launchKitUrl(projectId) };
    }).catch(async (error: any) => {
      // 并发同一 decision：唯一索引是最后一道闸。事务（含配额预占）已经整体回滚，
      // 这里回读既有项目，把 23505 翻译成带 `project_id` 的 409。
      if (error?.code === '23505' && String(error?.constraint ?? '') === 'idx_projects_decision') {
        const existing = await query<{ id: string }>(
          `SELECT p.id
             FROM projects p
             JOIN decisions d ON d.id = p.decision_id
            WHERE p.user_id = $1 AND d.opportunity_id = $2 AND d.verdict_id = $3
              AND d.decision = 'GO'
            LIMIT 1`,
          [userId, input.opportunityId, verdict.id]
        );
        throw alreadyGo(existing.rows[0]?.id);
      }
      throw error;
    });
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
    // v3.1：GO 只有一条入口——`POST /opportunities/{id}/go`。它扣配额、建 Project、
    // 授权点火包，三者同生共死；本端点只记录意见（PASS），收下 GO 就等于开了一条
    // 不扣配额、不建项目的旁路（01 §1.8 第 5 条、ADR-018）。
    if (input.decision === 'GO') {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        'GO is only accepted by POST /api/v1/opportunities/{id}/go; this endpoint records opinions (PASS) only.',
        400
      );
    }

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
