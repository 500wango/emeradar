import { query } from '@emeradar/db';
import type { IntentDecision } from './intent-fit.service';
import { lexicalFingerprint } from './canonical-query.service';

/**
 * 扫码三态判断。
 *
 * 产品原则：用户问的是「能不能做」，不是「SERP 长什么样」。
 * 所以扫描必须给出**一个**结论，并且当天就能给：
 *
 *   DO_NOT_BUILD  没有工具需求 / 没有付费存在 —— 当天可判，最有价值的结论；
 *   BUILD         有人收钱 + 前排可穿透 —— 当天可判（仍需 14 天才允许“发布”）；
 *   NOT_YET       数据不足 —— 必须说明缺什么、怎么补，否则等于没说。
 *
 * 注意 `BUILD` 与发布门是两件事：这里说的是“这个词值得做”，
 * 账本上的 `BUILD_NOW` 仍要 14 天证据。两者不冲突，也不互相替代。
 */
export const SCAN_VERDICT_VERSION = 'scan-verdict-v1';

export type ScanVerdict = 'BUILD' | 'DO_NOT_BUILD' | 'NOT_YET';

export interface ScanReason {
  kind: 'intent' | 'pricing' | 'competition' | 'data';
  text: string;
}

export interface ScanVerdictResult {
  verdict: ScanVerdict;
  /** 一句话结论，直接给用户看。 */
  headline: string;
  /** 最多三条依据：每条都必须能被下面的事实核对。 */
  reasons: ScanReason[];
  /** 只在该做时才给“怎么切”。 */
  angle: string | null;
  /** 替代词：不做时告诉用户该看什么。 */
  alternatives: Array<{ query: string; why: string }>;
  /** 还不行时说明缺什么。 */
  needs: string | null;
  ruleVersion: string;
}

export interface ScanVerdictInput {
  query: string;
  intent: IntentDecision;
  /** 前排探查到的公开定价（只含成功抓到的）。 */
  priced: Array<{ domain: string; minPrice: number | null; currency: string }>;
  probedDomains: number;
  blockedDomains: number;
  /** 按域名统计。 */
  competitors: number;
  weakDomains: number;
  dedicatedToolPages: number;
}

/** 工具意图修饰词，用于在“不做”时给出同族替代词提示。 */
const TOOL_SUFFIXES = ['generator', 'tool', 'converter', 'app'];

export function evaluateScanVerdict(input: ScanVerdictInput): ScanVerdictResult {
  const { intent } = input;
  const reasons: ScanReason[] = [];

  // ── 1. 信息型：当天可判“不做”，这是最值钱的结论 ────────────────────────
  if (intent.intentFit === 'INFORMATIONAL') {
    reasons.push({
      kind: 'intent',
      text: `Top ${intent.signals.distinctDomains} 里只有 ${intent.signals.dedicatedToolPages} 个专属工具页，其余是社区帖/内容/泛平台。`,
    });
    if (input.probedDomains > 0) {
      reasons.push({
        kind: 'pricing',
        text: `探查了 ${input.probedDomains} 个域名，${input.priced.length} 个有公开付费档位。`,
      });
    }
    reasons.push({
      kind: 'intent',
      text: '搜索引擎把这个词理解成“怎么做”，不是“买什么”。做工具大概率没人买。',
    });
    return {
      verdict: 'DO_NOT_BUILD',
      headline: '不做 —— 这个词不是工具需求',
      reasons,
      angle: null,
      alternatives: suggestAlternatives(input.query),
      needs: null,
      ruleVersion: SCAN_VERDICT_VERSION,
    };
  }

  // ── 2. 工具意图：有人收钱 + 前排可穿透 → 当天可判“做” ────────────────────
  if (intent.intentFit === 'TOOL_INTENT') {
    const weakShare = input.competitors > 0 ? input.weakDomains / input.competitors : 0;
    const weakest = input.priced
      .map((row) => row.minPrice)
      .filter((price): price is number => typeof price === 'number' && price > 0)
      .sort((a, b) => a - b)[0];

    reasons.push({
      kind: 'intent',
      text: `${intent.signals.dedicatedToolPages} 个专属工具页在 Top ${intent.signals.distinctDomains}，这是产品需求词。`,
    });
    if (input.priced.length > 0) {
      reasons.push({
        kind: 'pricing',
        text: `${input.priced.length} 个竞品公开收费${weakest ? `，最低 ${formatPrice(weakest, input.priced[0]?.currency ?? '$')}/月` : ''}。`,
      });
    } else if (input.probedDomains > 0) {
      reasons.push({
        kind: 'pricing',
        text: `探查了 ${input.probedDomains} 个域名，暂未发现公开付费档位——可能只做销售线索，也可能藏在应用内。`,
      });
    }
    reasons.push({
      kind: 'competition',
      text: `前排 ${input.weakDomains}/${input.competitors} 个域名是弱站（论坛、内容或泛平台），可穿透。`,
    });

    // 没有付费证据、同时前排不可穿透：不能喊“做”。
    if (input.priced.length === 0 && weakShare < 0.3) {
      return {
        verdict: 'NOT_YET',
        headline: '还不行 —— 没看到有人为这个词收费，前排也不弱',
        reasons,
        angle: null,
        alternatives: suggestAlternatives(input.query),
        needs:
          '需要一次定价探测覆盖到前排工具站（扫码会现场探查 3 个域名；每日管线也会补）。' +
          '在此之前无法判断是“没人愿意付”还是“只做销售线索”。',
        ruleVersion: SCAN_VERDICT_VERSION,
      };
    }

    return {
      verdict: 'BUILD',
      headline: '可以做 —— 有付费需求，前排有可穿透的弱点',
      reasons,
      angle: buildAngle(input),
      alternatives: [],
      needs: null,
      ruleVersion: SCAN_VERDICT_VERSION,
    };
  }

  // ── 3. 证据不足：必须说清楚缺什么 ──────────────────────────────────────
  reasons.push({
    kind: 'data',
    text: intent.reason,
  });
  if (input.probedDomains === 0) {
    reasons.push({
      kind: 'data',
      text: '还没有对前排站点做过定价探测，所以“有没有人愿意付钱”完全没有证据。',
    });
  }

  return {
    verdict: 'NOT_YET',
    headline: '还不行 —— 证据不够，先别下结论',
    reasons,
    angle: null,
    alternatives: suggestAlternatives(input.query),
    needs:
      input.probedDomains === 0
        ? '重新扫一次（会现场探查 3 个域名），或等每日管线抓过这些域名。'
        : '再观察 3–7 天：让 SERP 与定价都有多份快照后再判断。',
    ruleVersion: SCAN_VERDICT_VERSION,
  };
}

/**
 * “怎么切”：只用可观测事实拼，不编故事。
 *
 * 依据三件事：有人收钱（说明付费意愿存在）、前排弱站（说明可穿透）、
 * 以及最便宜的价格（说明价格带）。看不出差异时返回 null，不硬凑。
 */
function buildAngle(input: ScanVerdictInput): string | null {
  const prices = input.priced
    .map((row) => row.minPrice)
    .filter((price): price is number => typeof price === 'number' && price > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;

  const cheapest = prices[0];
  const mostExpensive = prices[prices.length - 1];
  const weakShare = input.competitors > 0 ? input.weakDomains / input.competitors : 0;

  if (weakShare >= 0.4) {
    return `前排 ${input.weakDomains}/${input.competitors} 是弱站，用一个更专注的单页工具正面切入，价格压在 ${cheapest} 以下抢长尾。`;
  }
  if (mostExpensive > cheapest * 2) {
    return `价格带从 ${cheapest} 到 ${mostExpensive}，中间有空间：做同一件事但更便宜/更简单的版本。`;
  }
  return `价格带集中在 ${cheapest} 左右，靠差异化功能或更窄的细分场景切入。`;
}

function formatPrice(price: number, currency: string): string {
  const symbol = currency.length <= 3 ? currency : '';
  return `${symbol}${price}`;
}

/**
 * “不做”时的出口。
 *
 * 只从同族词里给建议，不凭空造词：先看库里已存在的同词根 query（有真实观测），
 * 没有再退回“词根 + 工具后缀”的启发式，并明确标注是启发式。
 */
export function suggestAlternatives(query: string, known: string[] = []): Array<{ query: string; why: string }> {
  const base = query.trim().toLowerCase();
  const words = base.split(/\s+/).filter(Boolean);
  const out: Array<{ query: string; why: string }> = [];
  const seen = new Set<string>([base]);

  for (const candidate of known) {
    const text = candidate.trim().toLowerCase();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ query: text, why: '库里已有观测的同族词' });
    if (out.length >= 3) return out;
  }

  // 去掉最后一个词（通常是 "seo"/"tips" 这类信息型尾巴），换成工具后缀。
  const stem = words.length > 1 ? words.slice(0, -1).join(' ') : base;
  for (const suffix of TOOL_SUFFIXES) {
    const candidate = `${stem} ${suffix}`;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push({ query: candidate, why: '启发式建议（未观测，需扫描验证）' });
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * 同族已观测词：从 `queries` 里找与本词共享词根的词，且已有观测。
 * 只读，不发请求。
 */
export async function findKnownNeighbors(queryText: string, limit = 6): Promise<string[]> {
  const fingerprint = lexicalFingerprint(queryText);
  const tokens = fingerprint.split(' ').filter((token) => token.length > 3);
  if (tokens.length === 0) return [];

  const res = await query<{ query_text: string }>(
    `SELECT q.query_text
       FROM queries q
      WHERE EXISTS (
              SELECT 1 FROM unnest($1::text[]) AS t
               WHERE q.query_text ILIKE '%' || t || '%'
            )
        AND q.query_text <> $2
      ORDER BY (
        SELECT COUNT(*) FROM unnest($1::text[]) AS t
         WHERE q.query_text ILIKE '%' || t || '%'
      ) DESC
      LIMIT $3`,
    [tokens, queryText, limit]
  );
  return res.rows.map((row) => row.query_text);
}
