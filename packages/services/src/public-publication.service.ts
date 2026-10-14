import { query } from '@emeradar/db';
import { getActiveMask, type ActiveMask } from './stealth-lock-policy';

export interface PublicationDecision {
  eligible: boolean;
  indexable: boolean;
  eligibility: Record<string, unknown>;
  qualityReport: Record<string, unknown>;
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

  static async evaluateOpportunity(
    opportunityId: string,
    now = new Date(),
    locale = 'en-US'
  ): Promise<PublicationDecision> {
    const res = await query<any>(
      `SELECT o.id, o.slug, o.title, o.first_observed_date, c.verdict, c.lifecycle, c.w_band, c.m_band,
              c.why_now_summary, c.top_idea,
              (SELECT MIN(v.obs_date) FROM verdicts v WHERE v.opportunity_id = o.id) AS first_verdict_date,
              (SELECT COUNT(*)::int FROM evidence e WHERE e.opportunity_id = o.id) AS evidence_count,
              (SELECT COUNT(*)::int FROM serp_results sr JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
               JOIN opportunity_queries oq ON oq.query_id = ss.query_id
               WHERE oq.opportunity_id = o.id AND oq.role = 'PRIMARY' AND sr.is_weak = true) AS weak_result_count
       FROM opportunities o JOIN opportunity_cards c ON c.opportunity_id = o.id WHERE o.id = $1`,
      [opportunityId]
    );
    if (!res.rows[0]) return { eligible: false, indexable: false, eligibility: { reason: 'NOT_FOUND' }, qualityReport: {} };
    const row = res.rows[0];
    const firstVerdictDate = row.first_verdict_date || row.first_observed_date;
    const ageDays = Math.floor((now.getTime() - new Date(firstVerdictDate).getTime()) / 86400000);
    const eligible = Boolean(row.verdict) && ageDays >= 45 && ['MEDIUM', 'LOW', 'INSUFFICIENT'].includes(row.w_band) && row.m_band !== 'INSUFFICIENT';

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
    return {
      eligible,
      indexable,
      eligibility: { ageDays, delayDays: 45, windowBand: row.w_band, commercialBand: row.m_band },
      qualityReport,
    };
  }

  static async publishOpportunity(opportunityId: string, locale = 'en-US'): Promise<PublicationDecision> {
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

    const decision = await this.evaluateOpportunity(opportunityId, new Date(), locale);
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
