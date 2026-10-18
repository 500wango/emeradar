import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode, isBuildArchetype, normalizeArchetype, type Locale } from '@emeradar/core';
import {
  assembleLaunchKit,
  zipLaunchKit,
  LAUNCH_KIT_TEMPLATE_VERSION,
  type LaunchKitBundle,
  type LaunchKitFile,
} from '@emeradar/report/launch-kit';
import { ReportService } from './report.service';

/**
 * 形态点火包（Launch Kit）的存取（10 §4.4、09 §5.3、ADR-018/019）。
 *
 * 这个服务只回答一个问题：**这个人能不能拿到这份产物**。而答案不是"他有没有权限"，
 * 是"他有没有为它付过一次原子立项"——所以准入判据落在"这个 Project 是否引用了该
 * 用户的一条 GO 决策"上。一个 Project 可以由别的路径产生（实验项目、`decision_id`
 * 为空），那些 Project 从来没有解锁过任何点火包。
 *
 * 两件事必须一起成立，缺一不可：
 *   1. **只有在 GO 事务里建立、且决策确实是该用户的 GO 的项目才有**。否则就是 404，
 *      没有"补一次 GO"的路径（10 §4.4 明写不存在"先拿点火包再决定要不要 GO"）。
 *   2. **产物一旦装配就冻结**。09 §5.3 硬约束 1 要求同一 `(opportunity, snapshot,
 *      archetype, template_version)` 必得 bit-for-bit 相同的产物，而产物里有一段
 *      LLM 叙述（ADR-019，≤ 500 字）——它不可能被确定性重算。所以首次装配写库，
 *      此后一切读取都走库里那一份，**重算路径永不调用 LLM**（同 PRD P5/P7）。
 */

export interface LaunchKitView extends LaunchKitBundle {
  launchKitId: string;
  projectId: string;
  reportId: string;
  /** 首次装配时刻。产物冻结的起点。 */
  generatedAt: string;
  /** 本次是读到了已冻结的那一份，还是刚刚装配出来的。 */
  cached: boolean;
}

interface LaunchKitRow {
  id: string;
  report_id: string;
  project_id: string;
  archetype: string;
  schema_version: string;
  template_version: string;
  snapshot_id: string | null;
  scoring_config_version: string;
  research_language: string;
  files: LaunchKitFile[];
  narrative: { engineering: string; landing: string } | null;
  content_hash: string;
  generated_at: Date;
}

function rowToView(row: LaunchKitRow, cached: boolean): LaunchKitView {
  return {
    launchKitId: row.id,
    projectId: row.project_id,
    reportId: row.report_id,
    schemaVersion: row.schema_version,
    templateVersion: row.template_version,
    snapshotId: row.snapshot_id ?? '',
    scoringConfigVersion: row.scoring_config_version,
    archetype: normalizeArchetype(row.archetype),
    researchLanguage: row.research_language,
    // obs_date 不单独落库：它由快照决定，而快照 id 已经存了。读回来时从文件头部
    // 拿不到，就从 schema 里存的版本项重建一个可展示的值——这里取 `template_version`
    // 之外的字段都从库里来，只有 obsDate 需要额外查询，见下面的 hydrate。
    obsDate: '',
    files: row.files,
    // 叙述随产物一起返回：调用方（复核、导出）需要它，而它本来就存在于库里。
    narrative: row.narrative ?? { engineering: '', landing: '' },
    contentHash: row.content_hash,
    generatedAt: row.generated_at.toISOString(),
    cached,
  };
}

export class LaunchKitService {
  /**
   * 取回（必要时首次装配）某个 Project 的形态点火包。
   *
   * 准入顺序刻意是"项目 → GO 授权 → 报告 → 装配"：先确认这次 GO 真的发生过，再花
   * 任何力气去装配。反过来（先装配再判准入）会把一次越权请求变成一次真实的计算与
   * 一次 LLM 调用。
   *
   * v3.1 的授权只认 `decision_id`：槽位与认领已从产品中删除，归档也不再撤销 GO 的
   * 交付物——用户付过的那次配额买的是这份产物。
   */
  static async getOrCreate(
    projectId: string,
    userId: string,
    options: { locale?: Locale } = {}
  ): Promise<LaunchKitView> {
    const claim = await LaunchKitService.claimFor(projectId, userId);

    // 已经装配过就直接返回冻结的那一份：不再查报告、不再装配、不再调用 LLM。
    // 这条路也是"重复导出不重复扣额"（10 §4.4）在实现上的落点——它什么都没扣，
    // 因为它在第一次装配之后就没有再走过任何计费路径。
    const stored = await query<LaunchKitRow>(
      `SELECT * FROM launch_kits WHERE decision_id = $1`,
      [claim.decisionId]
    );
    if (stored.rows[0]) return LaunchKitService.hydrate(stored.rows[0], true);

    const locale = options.locale ?? 'en-US';
    // `consumeQuota: false`：报告与点火包由同一次原子立项一并解锁（13 §4.3）。
    const report = await ReportService.getOrGenerateReport(claim.opportunityId, userId, locale, {
      consumeQuota: false,
      // 点火包只能由持有该槽位的人装配，所以 viewerId 就是持有者本人。显式传进去是
      // 为了让报告那条查询的可见性判据有确定的答案，而不是靠省略参数去撞 fail-closed
      // 的默认值——那个默认值会让持有者自己被 404。
      viewerId: userId,
    });

    const snapshotId = await LaunchKitService.snapshotIdFor(claim.opportunityId);
    const bundle = assembleLaunchKit({
      report: report.data,
      archetype: claim.archetype,
      researchLanguage: claim.researchLanguage,
      snapshotId,
      scoringConfigVersion: claim.scoringConfigVersion,
      templateVersion: LAUNCH_KIT_TEMPLATE_VERSION,
    });

    // 主键与唯一键都落在 decision 上：一次 GO 至多一份点火包。用 decision 而不是
    // project，是因为"授权"的凭据就是那一条决策（同一 decision 至多一个项目，I6）。
    const launchKitId = `lkit_${claim.decisionId}`;
    await query(
      `INSERT INTO launch_kits (
         id, report_id, project_id, decision_id, archetype, schema_version,
         template_version, snapshot_id, scoring_config_version, research_language,
         files, narrative, content_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
       -- 部分唯一索引不会被裸的 (decision_id) 推断到，冲突目标要带上同一个谓词。
       ON CONFLICT (decision_id) WHERE decision_id IS NOT NULL DO NOTHING`,
      [
        launchKitId,
        report.reportId,
        projectId,
        claim.decisionId,
        claim.archetype,
        bundle.schemaVersion,
        bundle.templateVersion,
        snapshotId || null,
        bundle.scoringConfigVersion,
        bundle.researchLanguage,
        JSON.stringify(bundle.files),
        JSON.stringify(bundle.narrative ?? null),
        bundle.contentHash,
      ]
    );

    // 回读而不是直接把刚装配的对象返回：并发下（同一用户两个标签页同时导出）这里
    // 可能撞上另一个请求先插入的那一行，而"谁先落库谁算数"正是冻结的含义。
    const persisted = await query<LaunchKitRow>(
      `SELECT * FROM launch_kits WHERE decision_id = $1`,
      [claim.decisionId]
    );
    const row = persisted.rows[0];
    if (!row) {
      // 走到这里说明刚插入的行使诈：唯一约束没挡住、回读又读不到。宁可报错，
      // 也不要返回一份**没有落库**的产物——那样用户下到的文件将无法被复核。
      throw new EmeradarError(
        ErrorCode.INTERNAL,
        `Launch kit for project ${projectId} could not be persisted.`,
        500
      );
    }
    return LaunchKitService.hydrate(row, false);
  }

  /**
   * 复核一份已冻结的点火包：用同一份输入重新装配，比对指纹（09 §5.3 硬约束 1）。
   *
   * 用库里冻结的 `files` 里的**叙述段落**作为输入，正是这条复核能做到的全部——
   * 叙述本身不可重算，所以"可复核"的范围是"除叙述外的一切"（模板、硬数据、路由
   * 排序、指纹算法）。把这条边界说清楚，比假装整份产物都能重算要好。
   */
  static async verify(projectId: string, userId: string): Promise<{
    verified: boolean;
    storedHash: string;
    recomputedHash: string;
    templateVersion: string;
    fileCount: number;
  }> {
    const current = await LaunchKitService.getOrCreate(projectId, userId);
    const claim = await LaunchKitService.claimFor(projectId, userId);

    // 叙述取自**库里冻结的那一份**，而不是从渲染好的文件里再抠出来：抠是字符串
    // 手术，模板一改就失效，而失效的方式是"复核永远返回 false"——一个安静地说谎的
    // 检查比没有检查更糟。
    //
    // 界面语言同样从库里读，取自这份产物所引用的那条报告：语言是装配的输入之一
    // （说明文字跟随 `ui_locale`，见 14 §5.4），拿一个固定值去重算，等于给所有
    // 非英语的产物判了死刑。
    const stored = await query<{
      narrative: { engineering: string; landing: string } | null;
      locale: string | null;
    }>(
      `SELECT lk.narrative, r.locale
         FROM launch_kits lk
         JOIN opportunity_reports r ON r.id = lk.report_id
        WHERE lk.project_id = $1`,
      [projectId]
    );
    const narrative = stored.rows[0]?.narrative ?? null;
    const locale: Locale = stored.rows[0]?.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
    const report = await ReportService.getOrGenerateReport(claim.opportunityId, userId, locale, {
      consumeQuota: false,
      // 点火包只能由持有该槽位的人装配，所以 viewerId 就是持有者本人。显式传进去是
      // 为了让报告那条查询的可见性判据有确定的答案，而不是靠省略参数去撞 fail-closed
      // 的默认值——那个默认值会让持有者自己被 404。
      viewerId: userId,
    });
    const recomputed = assembleLaunchKit({
      report: report.data,
      archetype: current.archetype,
      researchLanguage: current.researchLanguage,
      snapshotId: current.snapshotId,
      scoringConfigVersion: current.scoringConfigVersion,
      templateVersion: current.templateVersion,
      narrative,
    });

    return {
      verified: recomputed.contentHash === current.contentHash,
      storedHash: current.contentHash,
      recomputedHash: recomputed.contentHash,
      templateVersion: current.templateVersion,
      fileCount: current.files.length,
    };
  }

  /** `format=bundle` 的 zip 载荷。 */
  static zip(view: LaunchKitView): Buffer {
    return zipLaunchKit(view);
  }

  /**
   * 准入：这个 Project 是不是该用户一次原子 GO 的落地。
   *
   * 判据是"存在该用户对该 `decision_id` 的 GO Project"（v3.1、10 §4.4）：项目必须
   * 引用一条决策，那条决策必须是 GO，且属于同一个人。没有 GO、或引用的是别人的
   * 决策，都按"没有资源"返回 404；项目存在但不是本人的则是 403。
   *
   * 归档**不**撤销这份产物：v3.1 没有槽位可释放，用户花掉的那次配额换来的就是点火包。
   */
  private static async claimFor(
    projectId: string,
    userId: string
  ): Promise<{
    decisionId: string;
    opportunityId: string;
    archetype: ReturnType<typeof normalizeArchetype>;
    researchLanguage: string;
    scoringConfigVersion: string;
  }> {
    const res = await query<{
      user_id: string;
      opportunity_id: string;
      decision_id: string | null;
      decision_kind: string | null;
      decision_user_id: string | null;
      archetype: string | null;
      research_language: string | null;
      scoring_config_version: string | null;
    }>(
      `SELECT p.user_id, p.opportunity_id, p.decision_id, p.build_type AS archetype,
              d.decision AS decision_kind, d.user_id AS decision_user_id,
              o.research_language,
              (SELECT v.scoring_config_version FROM verdicts v
                WHERE v.opportunity_id = p.opportunity_id
                ORDER BY v.obs_date DESC, v.created_at DESC LIMIT 1) AS scoring_config_version
         FROM projects p
         JOIN opportunities o ON o.id = p.opportunity_id
         LEFT JOIN decisions d ON d.id = p.decision_id
        WHERE p.id = $1`,
      [projectId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    }
    if (row.user_id !== userId) {
      // 存在但不是你的 → 403，而不是 404。10 §4.4 把两者并列列出，区分它们不会泄露
      // 什么：项目 id 本身不可枚举，而"这不是你的"与"这不存在"对用户是不同的信息。
      throw new EmeradarError(ErrorCode.FORBIDDEN, 'This project belongs to another account.', 403);
    }
    if (!row.decision_id || row.decision_kind !== 'GO' || row.decision_user_id !== userId) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        'This project has no launch kit: only a project created by an atomic GO has one.',
        404
      );
    }
    if (!row.archetype || !isBuildArchetype(normalizeArchetype(row.archetype))) {
      throw new EmeradarError(
        ErrorCode.INTERNAL,
        `Project ${projectId} has an unrecognized build archetype: ${row.archetype}`,
        500
      );
    }
    return {
      decisionId: row.decision_id,
      opportunityId: row.opportunity_id,
      archetype: normalizeArchetype(row.archetype),
      researchLanguage: row.research_language ?? 'en-US',
      // 评分配置版本取自这条机会**最新的一条裁决**（账本里的原始计量），而不是当前
      // 部署里的常量：点火包说的是"这份产物由哪一版评分规则下的观测支撑"，重装上阵
      // 之后的常量回答不了这个问题。
      scoringConfigVersion: row.scoring_config_version ?? 'unknown',
    };
  }

  private static async snapshotIdFor(opportunityId: string): Promise<string> {
    const res = await query<{ id: string }>(
      `SELECT id FROM opportunity_snapshots WHERE opportunity_id = $1 ORDER BY obs_date DESC LIMIT 1`,
      [opportunityId]
    );
    // 没有快照就不假装有：报告自身在缺快照时会拒绝生成（ReportService 的前置检查），
    // 所以走到这里通常已经有快照；真没有时留空串，由 schema 层落成 NULL。
    return res.rows[0]?.id ?? '';
  }

  /** 补上 `obs_date`。它由快照决定，所以从快照读，不从产物里猜。 */
  private static async hydrate(row: LaunchKitRow, cached: boolean): Promise<LaunchKitView> {
    const view = rowToView(row, cached);
    if (row.snapshot_id) {
      const res = await query<{ obs_date: string }>(
        `SELECT obs_date::text FROM opportunity_snapshots WHERE id = $1`,
        [row.snapshot_id]
      );
      view.obsDate = res.rows[0]?.obs_date ?? '';
    }
    return view;
  }
}
