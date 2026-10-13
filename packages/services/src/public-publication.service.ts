import { query } from '@emeradar/db';

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
    const decision = await this.evaluateOpportunity(opportunityId, new Date(), locale);
    // `title` lives on opportunities, not on the card; the previous single-table
    // read referenced a column that has never existed there, so every
    // projection threw and was swallowed by the caller's catch.
    const row = await query<any>(
      `SELECT c.slug, o.title, c.primary_query, c.why_now_summary, c.top_idea
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE c.opportunity_id = $1`,
      [opportunityId]
    );
    if (!row.rows[0]) return decision;
    const card = row.rows[0];
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
}
