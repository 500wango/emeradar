import { query } from '@emeradar/db';
import {
  buildCannibalizationIndex,
  evaluateCannibalization,
  evaluateLostFirstMoverValue,
  loadLostValueFacts,
  loadPrimaryTopNUrls,
  type CannibalizationIndex,
  type CannibalizationResult,
  type LostFirstMoverBasis,
} from './publication-policy';

export interface PublicationDecision {
  eligible: boolean;
  indexable: boolean;
  eligibility: Record<string, unknown>;
  qualityReport: Record<string, unknown>;
}

/**
 * `docs/10:236` 的 `eligibility.reason` 是**对外契约**：它说出这条机会凭哪一条
 * 「已失去抢跑价值」被公开（15 §3、01 §1.8）。买断、槽位满额都不是它的一部分了。
 */
export type PublicationEligibilityReason = LostFirstMoverBasis;

/** `docs/15 §3` 的硬条件 + 蚕食防护无法评估时的登记码。 */
export type PublicationBlockReason =
  | 'ACTIVE_WINDOW'
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

    // ---- §3 条件①：抢跑价值已耗尽（准入）----
    // 唯一判据是 `evaluateLostFirstMoverValue`（`publication-policy.ts`）：最新裁决为
    // WINDOW_CLOSING / PASS、生命周期已进入竞争态、或连续 14 天没有出现过活跃裁决。
    //
    // 卡片查询里已经带了 `c.lifecycle`，这里直接把它喂给判据而不是再读一次卡片——
    // 同一条机会的生命周期在同一时刻只应有一个答案。其余两个事实（最新裁决、最近一次
    // 活跃日）由 `loadLostValueFacts` 一次取齐。
    const facts = (await loadLostValueFacts([opportunityId])).get(opportunityId) ?? {
      latestVerdict: null,
      latestVerdictDate: null,
      lifecycle: null,
      lastActiveVerdictDate: null,
    };
    const lost = evaluateLostFirstMoverValue(
      { ...facts, lifecycle: row.lifecycle ?? facts.lifecycle },
      now
    );
    const basis: PublicationEligibilityReason | null = lost.basis;

    const blockedBy: PublicationBlockReason[] = [];
    const admissionNotEvaluated: string[] = [];
    let cannibalization: CannibalizationResult | null = null;

    // 仍然活跃（BUILD_NOW / EARLY_BET），或从未满足三条判据之一 → 不公开。
    // `ACTIVE_WINDOW` 是 v3.1 唯一的准入阻断码：判据不再是"还有没有空槽"，而是
    // "这条机会还有没有抢跑价值"。
    if (!basis) blockedBy.push('ACTIVE_WINDOW');

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
     * 「活跃窗口泄露」列为 0 容忍，而 0 容忍必须配一份可复核的凭据，否则复核只能靠
     * 重算——所以：`admission.basis` 写出**凭哪一条**入选（四个 basis 之一），
     * `latestVerdict` / `lifecycle` / `lastActiveVerdictDate` 带上当时的事实、
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
        // 凭据要能回答"凭什么说它已经失去抢跑价值"：三个事实原样落库，复核者不必
        // 重算（重算会得到今天的答案，而不是当时的答案）。
        latestVerdict: facts.latestVerdict,
        latestVerdictDate: facts.latestVerdictDate,
        lifecycle: row.lifecycle ?? facts.lifecycle,
        lastActiveVerdictDate: facts.lastActiveVerdictDate,
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

    const decision = await this.evaluateOpportunity(opportunityId, new Date(), locale, opts);
    // 公开页也标注本次判定是否来自 72h 宽限期内的旧快照；老页面没有这个字段，
    // 读取时按 false 处理。
    const latestVerdictFlags = await query<{ flags: string[] | null }>(
      `SELECT flags FROM verdicts
        WHERE opportunity_id = $1
        ORDER BY obs_date DESC, created_at DESC
        LIMIT 1`,
      [opportunityId]
    );
    const stale = Array.isArray(latestVerdictFlags.rows[0]?.flags)
      ? latestVerdictFlags.rows[0]!.flags!.includes('STALE_DATA')
      : false;
    // 每轮都重算资格并写回状态，所以「重新活跃」会在**同一轮 S8** 把页翻回 DRAFT：
    // 公开页查询带 `status = 'PUBLISHED'`，DRAFT 即 404。撤回与发布走同一条 upsert，
    // 没有单独的撤回路径可以忘记调用（15 §8 的 0 容忍要求）。
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
        JSON.stringify({
          title: card.title,
          primaryQuery: card.primary_query,
          whyNow: card.why_now_summary,
          topIdea: card.top_idea,
          stale,
        }),
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
}
