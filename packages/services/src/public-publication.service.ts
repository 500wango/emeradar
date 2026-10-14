import { query } from '@emeradar/db';
import { getActiveMask, type ActiveMask } from './stealth-lock-policy';
import {
  buildCannibalizationIndex,
  evaluateCannibalization,
  loadPrimaryTopNUrls,
  loadSlotTotals,
  loadVerdictRun,
  slotFullness,
  windowClosingState,
  type CannibalizationIndex,
  type CannibalizationResult,
} from './publication-policy';

export interface PublicationDecision {
  eligible: boolean;
  indexable: boolean;
  eligibility: Record<string, unknown>;
  qualityReport: Record<string, unknown>;
}

/**
 * `docs/10:236` 把公开接口的 `eligibility.reason` 定死成这两个值（外加买断与早退两种），
 * 所以它是一个**对外契约**而不是内部枚举。
 */
export type PublicationEligibilityReason = 'CROWDED_LOCKED' | 'WINDOW_CLOSING' | 'STEALTH_LOCKED';

/** `docs/15 §3` 的三条硬条件 + 蚕食防护无法评估时的登记码。 */
export type PublicationBlockReason =
  | 'OPEN_SLOTS'
  | 'M_INSUFFICIENT'
  | 'CANNIBALIZATION'
  | 'CANNIBALIZATION_DATA_MISSING';

/**
 * 蚕食防护要拿"当前已收录的公开页"作参照。索引按**一轮 S8 运行**构建一次并透传，
 * 省掉每条机会各拉一遍全量已收录集合的开销（详见 `publication-policy.ts`）。
 * 单条调用（买断侧的投影刷新）不传，由 `evaluateOpportunity` 自行加载。
 */
export interface PublicationOptions {
  cannibalizationIndex?: CannibalizationIndex;
}

/**
 * docs/15 §5 的公开页质量门。
 *
 * 此前这里的门线是**照着数据填的**：正文 ≥ 40 词 —— 而 docs/15 §5 要求英文
 * 600 词 / 中文 800 字。40 词这个数不是规格的近似，是"当前卡片字段加起来的长度"，
 * 于是门槛永远通过、页面永远 `indexable = true`，而它对外表达的是"这条通过了六项
 * 质检"。同时 `hasProofAndLimits`（"证明了什么 / 未证明什么"两栏非空）与
 * `hasDistinctiveContent` 用的是**同一个条件**，报告里却列成两项独立检查 ——
 * 于是五项检查里有一项是重名，另有一项（模板文本率）从未实现。
 *
 * 现在的口径：门线取规格值；**没实现的检查显式列进 `notEvaluated`**，而不是拿一个
 * 别的条件顶上。改门线的直接后果是真实的：当前公开页正文只有标题 + whyNow +
 * topIdea，远不到 600 词，因此页面会以 `indexable = false` 发布（页面照旧可访问，
 * 只是 noindex 且不进 sitemap，这正是 docs/15 §5 对未通过质检的处置）。
 */
export class PublicPublicationService {
  /** docs/15 §5：正文纯文本 ≥ 600 词（英文）。 */
  static readonly MIN_BODY_WORDS_EN = 600;
  /** docs/15 §5：正文纯文本 ≥ 800 字（中文）。 */
  static readonly MIN_BODY_WORDS_ZH = 800;

  /**
   * 统计"正文有效字数"。拉丁文本按空格分词，中日文按字符（规格本身就是分别定的）。
   */
  static countBodyUnits(text: string, locale: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const lang = locale.toLowerCase();
    if (lang.startsWith('zh') || lang.startsWith('ja')) {
      // 空白与常见中文标点不算"有效字数"——它们不承载信息。
      return trimmed
        .replace(/\s+/g, '')
        .replace(/[，。、；：！？（）【】「」《》""'']/g, '').length;
    }
    return trimmed.split(/\s+/).filter(Boolean).length;
  }

  /**
   * `docs/15 §3` 的准实时精选准入（C1 准入 → C2 证据 → C3 蚕食），随后接 §5 的质量门。
   *
   * **判据已整条更换。** 旧判据是「T+45 天延迟公开」（`ageDays >= 45` 加一个 `w_band`
   * 白名单），PRD §7.1 已废除，15 §3 换成「这条机会对付费用户还剩多少抢跑价值」。两者
   * 不是同一个判据换参数，而是方向相反：旧规则等的是"时间够久"，于是一条放了半年仍有
   * 空槽的 `BUILD_NOW` 会被公开——正好把付费用户的抢跑窗口送给免费层，而它保护的那个
   * "窗口"可能根本不存在（28 §6）。新规则看的是"还剩多少价值"：那条机会**永远不公开**，
   * 而一条刚发布三天就满额的当天即可公开（15 §3 自己的例子）。
   *
   * 顺序照规格的流程图短路：准入不过就不跑 C3——它要拉 SERP 快照，是这里最贵的一步，
   * 而绝大多数机会每天都在第一步就被挡下。
   */
  static async evaluateOpportunity(
    opportunityId: string,
    now = new Date(),
    locale = 'en-US',
    opts: PublicationOptions = {}
  ): Promise<PublicationDecision> {
    const res = await query<any>(
      `SELECT o.id, o.slug, o.title, c.verdict, c.lifecycle, c.w_band, c.m_band,
              c.why_now_summary, c.top_idea,
              (SELECT COUNT(*)::int FROM evidence e WHERE e.opportunity_id = o.id) AS evidence_count,
              (SELECT COUNT(*)::int FROM serp_results sr JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
               JOIN opportunity_queries oq ON oq.query_id = ss.query_id
               WHERE oq.opportunity_id = o.id AND oq.role = 'PRIMARY' AND sr.is_weak = true) AS weak_result_count
       FROM opportunities o JOIN opportunity_cards c ON c.opportunity_id = o.id WHERE o.id = $1`,
      [opportunityId]
    );
    if (!res.rows[0]) return { eligible: false, indexable: false, eligibility: { reason: 'NOT_FOUND' }, qualityReport: {} };
    const row = res.rows[0];

    // ---- §3 条件①：抢跑价值已耗尽（准入，D12）----
    // 两个分支都从**权威源**读，而不是读被判出来的标志：
    //   · 槽位满额 —— 直读 `opportunity_slots`，不用 `CROWDED_LOCKED` 标志。那个标志的
    //     喂入数的是 `projects` 计数对比常量 5（旧口径），而 0003:83-85 明令禁止这条推导，
    //     claim-policy.ts 自己也写着槽位表才是它的最终形态。
    //   · 刚进关窗期 —— 读账本连续段，不用 `wDroppedWithin`：它是代理，且会被"满额旁路"
    //     与"粘滞"同时骗过。三条理由完整写在 publication-policy.ts。
    const fullness = slotFullness(await loadSlotTotals(opportunityId));
    const windowClosing = windowClosingState(await loadVerdictRun(opportunityId));
    const basis: PublicationEligibilityReason | null = fullness.full
      ? 'CROWDED_LOCKED'
      : windowClosing.fresh
      ? 'WINDOW_CLOSING'
      : null;

    const blockedBy: PublicationBlockReason[] = [];
    const admissionNotEvaluated: string[] = [];
    let cannibalization: CannibalizationResult | null = null;

    // 仍有空余槽位的 BUILD_NOW / EARLY_BET **一律不得公开**——15 §3 第 1 条 的硬阻断，
    // 也是 15 §8 那条 0 容忍指标的正面要求。
    if (!basis) blockedBy.push('OPEN_SLOTS');

    // ---- §3 条件②：证据充足性 ----
    // `opportunity_cards.m_band` 今天带 NOT NULL，但这里仍显式要求非空：约束将来放宽
    // （或改读视图）时，`undefined !== 'INSUFFICIENT'` 会静默放行。
    const mSufficient = row.m_band != null && row.m_band !== 'INSUFFICIENT';
    if (basis && !mSufficient) blockedBy.push('M_INSUFFICIENT');

    // ---- §3 条件③：蚕食防护 ----
    if (basis && mSufficient) {
      const index = opts.cannibalizationIndex ?? (await buildCannibalizationIndex(locale));
      cannibalization = evaluateCannibalization(
        await loadPrimaryTopNUrls(opportunityId),
        index,
        opportunityId // 必须排除自己：候选若已发布就在索引里，与自身重叠恒为 1.0
      );
      if (cannibalization.status === 'BLOCKED') blockedBy.push('CANNIBALIZATION');
      if (cannibalization.status === 'NOT_EVALUATED') {
        blockedBy.push('CANNIBALIZATION_DATA_MISSING');
        admissionNotEvaluated.push('cannibalization');
      }
    }

    const eligible = blockedBy.length === 0;

    /**
     * 资格凭据（03 §15 的 `public_pages.eligibility`、15 §3 第 1 条、06 §5）。
     *
     * 这张快照存在的**唯一**目的是事后回答「为什么这条能被免费用户看到」。15 §8 把
     * 「空槽窗口泄露率」列为 0 容忍，而 0 容忍必须配一份可复核的凭据，否则复核只能靠
     * 重算——所以：`admission.basis` 写出**凭哪一条**入选（两分支不可由 verdict 区分，
     * 因为满额的机会也被判成 `WINDOW_CLOSING`，见 verdict.ts:170-174）、`crowdedLocked`
     * 带上当时的槽位状态（06 §5 明确要求）、`windowClosing.enteredOn` 写出哪天进窗、
     * `cannibalization.maxJaccard` 写出为什么不算蚕食。
     *
     * 已废除的 `delayDays: 45` 与 `ageDays` 一并消失——留着它们等于在凭据里写下一个
     * 已经不存在的判据。
     *
     * `notEvaluated` 只登记**准入层**的未评估项。§5 质检层有它自己的 `notEvaluated`，
     * 两份不能混：层级不同，混了会把"没查过质检"读成"没查过蚕食"。
     */
    const eligibility: Record<string, unknown> = {
      version: 1,
      evaluatedAt: now.toISOString(),
      eligible,
      admission: {
        basis,
        crowdedLocked: {
          slotRows: fullness.slotRows,
          capacity: fullness.capacity,
          claimed: fullness.claimed,
          full: fullness.full,
        },
        windowClosing,
      },
      evidence: { mBand: row.m_band, wBand: row.w_band, sufficient: mSufficient },
      cannibalization,
      notEvaluated: admissionNotEvaluated,
      blockedBy,
    };

    // ---- §5 公开页质量门（本轮不动）----

    // 这三段文字就是公开页真正渲染的全部正文（见
    // apps/web/src/app/public/opportunities/[slug]/page.tsx），不是它的代理指标 ——
    // 所以这个字数与访问者看到的字数是同一个数。
    const bodyText = `${row.title || ''} ${row.why_now_summary || ''} ${row.top_idea || ''}`;
    const minWordCount = locale.toLowerCase().startsWith('zh')
      ? this.MIN_BODY_WORDS_ZH
      : this.MIN_BODY_WORDS_EN;
    const wordCount = this.countBodyUnits(bodyText, locale);
    const evidenceCount = Number(row.evidence_count);
    const weakResultCount = Number(row.weak_result_count);

    const checks: Record<string, boolean> = {
      /** docs/15 §5 第 1 行：正文有效字数。 */
      bodyLength: wordCount >= minWordCount,
      /** 第 2 行：可追溯的 evidence 引用 ≥ 3。 */
      evidenceDensity: evidenceCount >= 3,
      /** 第 4 行：至少一个具体弱竞争对手 URL 与理由。 */
      serpWeaknessSpecificity: weakResultCount > 0,
      /** 卡片确实写了"为什么是现在"和"做什么"。 */
      distinctiveContent: Boolean(row.top_idea && row.why_now_summary),
    };
    const failedChecks = Object.keys(checks).filter((name) => !checks[name]);

    const qualityReport = {
      checks,
      failedChecks,
      /**
       * 尚未实现的检查，显式列出而不是拿别的条件顶上。
       *  - `templateTextRatio`（第 5 行）：需要"模板语料 vs 动态内容"的划分，当前
       *    正文全部来自卡片字段，没有可比的模板基线。
       *  - `proofAndLimits`（第 3 行）：需要"证明了什么 / 未证明什么"两栏的实际内容，
       *    数据模型里没有这两个字段。此前它被 `hasDistinctiveContent` 顶替，于是
       *    报告读起来像查过，实际是同一个条件换了名字。
       */
      notEvaluated: ['templateTextRatio', 'proofAndLimits'] as const,
      wordCount,
      minWordCount,
      lengthUnit: locale.toLowerCase().startsWith('zh') ? 'characters' : 'words',
      evidenceCount,
      weakResultCount,
      hasCommercialProof: row.m_band !== 'INSUFFICIENT',
      hasSerpWeakness: weakResultCount > 0,
      hasDistinctiveContent: Boolean(row.top_idea && row.why_now_summary),
    };
    const indexable = eligible && failedChecks.length === 0;
    return { eligible, indexable, eligibility, qualityReport };
  }

  static async publishOpportunity(
    opportunityId: string,
    locale = 'en-US',
    opts: PublicationOptions = {}
  ): Promise<PublicationDecision> {
    const cardRes = await query<any>(
      `SELECT c.slug, o.title, c.primary_query, c.why_now_summary, c.top_idea
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE c.opportunity_id = $1`,
      [opportunityId]
    );
    const card = cardRes.rows[0];
    if (!card) {
      return { eligible: false, indexable: false, eligibility: { reason: 'NO_CARD' }, qualityReport: {} };
    }

    /**
     * 买断打码必须**早于**资格判定（15 §3.1 第 6 条）。
     *
     * 两者的条件恰好互斥：准实时精选要求"槽位已满额或刚进 `WINDOW_CLOSING`"，而买断
     * 要求"槽位一个都没被认领"。所以一条被买断的机会在资格判定里必然不通过对不对？
     * 不是必然——但**一旦它不通过**，`status` 会落到 `DRAFT`，而公开页查询是
     * `WHERE slug=$1 AND status='PUBLISHED'`，页面就成了 404。而 15 §3.1 第 1 条明写
     * 「**不是删除、不是 404**」：打码页必须**以 200 存在**、只把内容换掉。
     *
     * 顺序写反不会报错，只会让一个付了钱的用户买到的东西从 404 变成 404。
     */
    const mask = await getActiveMask(opportunityId);
    if (mask) return this.publishMasked(card, mask, opportunityId, locale);

    // 不在保护期：撤掉可能仍留着的打码页（画布上只有一条记录该活得下来）。
    await this.clearMaskedProjection(opportunityId);

    const decision = await this.evaluateOpportunity(opportunityId, new Date(), locale, opts);
    const status = decision.eligible ? 'PUBLISHED' : 'DRAFT';
    await query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable, content, eligibility, quality_report, published_at)
       VALUES ($1,$2,$3,'OPPORTUNITY',$4,$5,$6,$7,$8,$9,CASE WHEN $5 = 'PUBLISHED' THEN NOW() ELSE NOW() END)
       ON CONFLICT (slug, locale) DO UPDATE SET
         status = EXCLUDED.status,
         indexable = EXCLUDED.indexable,
         content = EXCLUDED.content,
         eligibility = EXCLUDED.eligibility,
         quality_report = EXCLUDED.quality_report,
         published_at = CASE WHEN EXCLUDED.status = 'PUBLISHED' THEN COALESCE(public_pages.published_at, NOW()) ELSE public_pages.published_at END`,
      [
        `pgm_${opportunityId}_${locale}`,
        card.slug,
        locale,
        opportunityId,
        status,
        decision.indexable,
        JSON.stringify({ title: card.title, primaryQuery: card.primary_query, whyNow: card.why_now_summary, topIdea: card.top_idea }),
        JSON.stringify(decision.eligibility),
        JSON.stringify(decision.qualityReport),
      ]
    );

    /**
     * 同一轮运行内把自己追加进蚕食索引，让后面的机会能看见刚发布的这一页。
     *
     * 只在 `eligible && indexable` 时追加：蚕食比对的口径是"会被 Google 收录的页"
     * （15 §3 第 3 条），而 `indexable = false` 的页不进 sitemap、不会被收录，把它算进去
     * 等于凭空多出一个参照物。代价是这里多拉一次 Top10——但它只在这一页真的可收录
     * 时发生，今天几乎是零次。
     */
    if (decision.eligible && decision.indexable && opts.cannibalizationIndex) {
      opts.cannibalizationIndex.addPublished(opportunityId, card.slug, await loadPrimaryTopNUrls(opportunityId));
    }
    return decision;
  }

  /**
   * 写打码投影（15 §3.1、06 §6.1）。**以 200 存在，但 `indexable = false`。**
   *
   * 三件事都是必须的，少一件就是一次可观测的泄露：
   *
   *   1. **换 slug**。`opportunity_cards.slug` 由词/标题生成，所以它自己就是泄露面
   *      ——15 §8 把「URL slug」与正文并列列为 0 容忍。只改 `content` 而留着一条含
   *      词根的 URL，页面上照样能读出这条机会是什么。
   *   2. **把原 slug 那行翻成 `DRAFT`**，而不是删掉。公开页查询带 `status='PUBLISHED'`，
   *      `DRAFT` 即读不到；而**不删行**意味着期满能把原页原样恢复，不必重算一次
   *      eligibility 去重建一个"和原来差不多"的页面。
   *   3. **标签取自 `stealth_lock_displays`**（`mask.maskedLabel`），不在这里现算：
   *      公开战报（06 §11）要输出同一份标签，两处现算就是两个实现，第一处漂移即 P0。
   *
   * 打码页的 `indexable` 恒为 `false`（15 §5）：它**故意**不进 sitemap，也不该被
   * 索引——它是给人看的证据（"这条被买断了"），不是内容资产。
   */
  private static async publishMasked(
    card: any,
    mask: ActiveMask,
    opportunityId: string,
    locale: string
  ): Promise<PublicationDecision> {
    // 原页留在站点里但不再是"已发布"，于是它既不会 200 也不进 sitemap。
    await query(
      `UPDATE public_pages SET status = 'DRAFT'
        WHERE opportunity_id = $1 AND slug = $2 AND locale = $3 AND status <> 'DRAFT'`,
      [opportunityId, card.slug, locale]
    );

    await query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable, content, eligibility, quality_report, published_at)
       VALUES ($1,$2,$3,'OPPORTUNITY',$4,'PUBLISHED',false,$5,$6,$7,NOW())
       ON CONFLICT (slug, locale) DO UPDATE SET
         status = 'PUBLISHED',
         indexable = false,
         content = EXCLUDED.content,
         eligibility = EXCLUDED.eligibility,
         quality_report = EXCLUDED.quality_report`,
      [
        `pgm_masked_${mask.lockId}_${locale}`,
        mask.maskedSlug,
        locale,
        opportunityId,
        // 三轴档位、判定、观测日期照常展示，只有能反推出词根的那几项被替换
        // （15 §3.1 第 1 条：其余结构化信息照常）。
        JSON.stringify({
          title: mask.maskedLabel,
          primaryQuery: mask.maskedLabel,
          whyNow: mask.maskedLabel,
          topIdea: mask.maskedLabel,
          isStealthMasked: true,
          maskedLabel: mask.maskedLabel,
          unmaskedAt: mask.unmaskedAt,
        }),
        JSON.stringify({
          reason: 'STEALTH_LOCKED',
          lockId: mask.lockId,
          unmaskedAt: mask.unmaskedAt,
        }),
        JSON.stringify({
          checks: { maskedProjection: true },
          failedChecks: [],
          notEvaluated: ['templateTextRatio', 'proofAndLimits', 'bodyLength'],
          note: 'Masked projection: the quality gate is not evaluated while a Stealth Lock is in force.',
        }),
      ]
    );

    return {
      eligible: false,
      indexable: false,
      eligibility: { reason: 'STEALTH_LOCKED', lockId: mask.lockId, unmaskedAt: mask.unmaskedAt },
      qualityReport: {
        checks: { maskedProjection: true },
        failedChecks: [],
        masked: true,
        unmaskedAt: mask.unmaskedAt,
        note: 'The publication quality gate is not evaluated while a Stealth Lock is in force.',
      },
    };
  }

  /**
   * 撤掉某条机会的打码投影。
   *
   * 删行而不是翻 `DRAFT`：这一行**只由打码产生**，期满之后没有任何东西会再引用它，
   * 留着只会在 `public_pages` 里积累一批永远 DRAFT 的幽灵行。它是我们的投影产物，
   * 不是业务记录——与本轮"作废买断不得删业务行"（03 §17 I15）是两回事。
   */
  private static async clearMaskedProjection(opportunityId: string): Promise<void> {
    await query(
      `DELETE FROM public_pages
        WHERE opportunity_id = $1 AND slug LIKE 'stealth-lock-%'`,
      [opportunityId]
    );
  }
}
