import { createHash } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import {
  CostLedgerService,
  DEFAULT_KEYWORD_SEED_FILTER,
  KEYWORD_SEED_COST_USD,
  KeywordSeedCollector,
  KeywordSeedCredentials,
  KeywordSuggestion,
} from '@emeradar/collectors';
import { classifyQueryIntent } from '../query-intent';

/**
 * 工具意图种子（02 §7「修饰词模板」）。每个种子是一个产品形态，`keyword_suggestions`
 * 返回包含它的长尾词，例如 generator → "fantasy name generator"、"invoice generator"。
 * 顺序即轮转顺序：每天从游标处取 `SEEDS_PER_RUN` 个，约两周走完一轮。
 */
export const TOOL_INTENT_SEEDS: Array<{ seed: string; archetype: 'TOOL' | 'MICRO_SAAS' | 'DIRECTORY' | 'CONTENT_SITE' }> = [
  { seed: 'generator', archetype: 'TOOL' },
  { seed: 'calculator', archetype: 'TOOL' },
  { seed: 'converter', archetype: 'TOOL' },
  { seed: 'template', archetype: 'TOOL' },
  { seed: 'checker', archetype: 'TOOL' },
  { seed: 'maker', archetype: 'TOOL' },
  { seed: 'online tool', archetype: 'TOOL' },
  { seed: 'estimator', archetype: 'TOOL' },
  { seed: 'planner', archetype: 'TOOL' },
  { seed: 'tracker', archetype: 'MICRO_SAAS' },
  { seed: 'alternative', archetype: 'DIRECTORY' },
  { seed: 'extension', archetype: 'TOOL' },
  { seed: 'api', archetype: 'MICRO_SAAS' },
  { seed: 'software for', archetype: 'MICRO_SAAS' },
  { seed: 'app for', archetype: 'MICRO_SAAS' },
  { seed: 'how to automate', archetype: 'MICRO_SAAS' },
  { seed: 'free online', archetype: 'TOOL' },
  { seed: 'pdf', archetype: 'TOOL' },
  { seed: 'csv', archetype: 'TOOL' },
  { seed: 'spreadsheet', archetype: 'TOOL' },
  { seed: 'invoice', archetype: 'TOOL' },
  { seed: 'resume', archetype: 'TOOL' },
  { seed: 'checklist', archetype: 'CONTENT_SITE' },
  { seed: 'directory', archetype: 'DIRECTORY' },
  // 2026-10 扩展：从“单页工具”扩到插件/集成/工作流/垂直角色，避免候选池只覆盖
  // generator/calculator 一类词。仍然只做入口，词量不进评分。
  { seed: 'plugin', archetype: 'TOOL' },
  { seed: 'integration', archetype: 'MICRO_SAAS' },
  { seed: 'dashboard', archetype: 'MICRO_SAAS' },
  { seed: 'monitor', archetype: 'MICRO_SAAS' },
  { seed: 'scheduler', archetype: 'MICRO_SAAS' },
  { seed: 'scraper', archetype: 'TOOL' },
  { seed: 'extractor', archetype: 'TOOL' },
  { seed: 'summarizer', archetype: 'TOOL' },
  { seed: 'workflow', archetype: 'MICRO_SAAS' },
  { seed: 'compliance', archetype: 'MICRO_SAAS' },
  { seed: 'for freelancers', archetype: 'MICRO_SAAS' },
  { seed: 'for agencies', archetype: 'MICRO_SAAS' },
];

/** 每天展开的种子数。2 × $0.018 = $0.036/天。 */
export const SEEDS_PER_RUN = 2;
/** 每天最多新增的候选数。每个候选此后每天约 $0.005（autocomplete + SERP + 抓取）。 */
export const MAX_NEW_CANDIDATES_PER_RUN = 8;
/** 活跃候选池上限。超过就不再新增，避免观测成本随时间线性上涨。 */
export const MAX_ACTIVE_SEED_CANDIDATES = 150;

/** 品牌 / 导航词与成人词：观测它们只会得到官方站霸榜（02 §7 品牌导航词判定）。 */
const EXCLUDED = /\b(login|sign in|near me|porn|sex|nude|casino|bet|lottery|google|youtube|facebook|instagram|tiktok|amazon|chatgpt|openai|microsoft|apple|minecraft|roblox|fortnite|pokemon)\b/i;

export const DISCOVERY_SOURCE_KEYWORD_SEED = 'KEYWORD_SEED';

function idFor(prefix: string, text: string): string {
  return `${prefix}_${createHash('sha256').update(text).digest('hex').slice(0, 20)}`;
}

function slugFor(text: string): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `${base || 'keyword'}-${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
}

/**
 * 入口筛选：只看意图与词面，不看排名，也不把任何数值带进评分。
 *
 * 2026-10 收紧：DataForSEO 的 `keyword_suggestions` 会返回“语义相关但并不是
 * 工具需求”的词（例如 2026 hell、ai valuation 这类新闻/金融短语）。旧过滤只
 * 看词数与字符集，这些词会占满 150 的候选池，并且每天烧 autocomplete/SERP/抓取
 * 成本。现在要求：
 *   - 具体种子（generator/calculator/...）必须真的包含种子词；
 *   - 宽种子（software for / app for / for agencies）必须带工具/软件名词；
 *   - 新闻、金融、教程类短语在没有工具名词时直接拒绝。
 */
const TOOL_SIGNAL = /\b(generator|calculator|converter|convert|conversion|template|checker|maker|estimator|planner|tracker|alternative|extension|api|plugin|integration|dashboard|monitor|scheduler|scraper|extractor|extract|summarizer|workflow|compliance|checklist|directory|tool|tools|software|app|apps|platform|automation|builder|editor|manager|assistant|crm|erp|saas|website|landing page|portfolio|merge|split|compress|generate|validate|clean|dedupe)\b/i;
const NEWS_SIGNAL = /\b(hell|news|report|trend|forecast|valuation|funding|salary|jobs?|course|tutorial|stock|price prediction|market size)\b/i;
const INFORMATIONAL_PREFIX = /^(how to|what is|why |is there|best |top \d+)/i;
const DEFINITIONAL = /\b(definition|meaning|what is|what are|full form|explained|examples?|wiki)\b/i;

/** 这些种子的词面太宽，不能靠“包含种子”判断，必须出现工具/软件名词。 */
const BROAD_SEEDS = new Set([
  'online tool',
  'free online',
  'software for',
  'app for',
  'how to automate',
  'for freelancers',
  'for agencies',
]);

export function isCandidateKeyword(s: KeywordSuggestion, seed: string): boolean {
  const kw = s.keyword.toLowerCase();
  const seedLower = seed.toLowerCase();
  if (kw === seedLower) return false;
  if (EXCLUDED.test(kw)) return false;
  if (s.mainIntent === 'navigational') return false;
  if (INFORMATIONAL_PREFIX.test(kw)) return false;
  if (DEFINITIONAL.test(kw)) return false;

  const words = kw.split(/\s+/).length;
  // 当前只做 US/EN；非 ASCII 词面（例如“CSV 文件定义”）不是工具长尾，直接拒绝。
  if (words < 2 || words > 6 || !/^[a-z0-9 .,'&+-]+$/.test(kw)) return false;

  const toolSignal = TOOL_SIGNAL.test(kw);
  // 信息性搜索只有在出现明确的工具/操作名词时才可能是可构建需求；
  // “csv file”“csv file definition”这类定义词不是机会。
  if (s.mainIntent === 'informational' && !toolSignal) return false;
  // 必须按词边界匹配：种子 "api" 不能因为 "capital gains" 里含有 api 就通过。
  const includesSeed = new RegExp(`\\b${seedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(kw);
  if (BROAD_SEEDS.has(seedLower)) {
    if (!toolSignal) return false;
  } else if (!includesSeed) {
    return false;
  }

  // 有工具名词时，"valuation calculator" 可以是合法工具；没有工具名词时，
  // "ai valuation"、"2026 hell" 只是新闻/事件。
  if (NEWS_SIGNAL.test(kw) && !toolSignal) return false;
  if (/\b20\d{2}\b/.test(kw) && !toolSignal) return false;

  return true;
}

/**
 * 「同一个需求」的粗去重键：DataForSEO 会返回 "barcode generator" / "barcodes generator" /
 * "barcode-generator" 这类拼写变体，各开一个候选只会重复观测同一个 SERP。
 */
export function dedupeKey(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .sort()
    .join(' ');
}

export interface SeedMarket {
  country: string;
  locationCode: number;
  language: string;
}

/** 默认只开 US；通过 `SEED_MARKETS` 显式增加市场，避免无意中把采集成本翻倍。 */
export const DEFAULT_SEED_MARKETS: SeedMarket[] = [
  { country: 'US', locationCode: 2840, language: 'en-US' },
];

/**
 * `SEED_MARKETS="US:2840:en-US,GB:2826:en-GB"`。
 * 解析失败的行直接丢弃；全部失败时回退 US，不把坏配置变成“零市场”。
 */
export function parseSeedMarkets(raw = process.env.SEED_MARKETS || ''): SeedMarket[] {
  const markets: SeedMarket[] = [];
  for (const entry of raw.split(',')) {
    const [country, code, language] = entry.trim().split(':');
    const locationCode = Number(code);
    if (!/^[A-Za-z]{2}$/.test(country || '') || !Number.isInteger(locationCode) || locationCode <= 0) continue;
    const normalized = country.toUpperCase();
    if (markets.some((market) => market.country === normalized)) continue;
    markets.push({
      country: normalized,
      locationCode,
      language: (language || 'en-US').trim(),
    });
  }
  return markets.length > 0 ? markets : DEFAULT_SEED_MARKETS;
}

export interface SeedKeywordResult {
  skipped: boolean;
  reason?: string;
  seeds: string[];
  fetched: number;
  created: number;
  failures: number;
}

function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): KeywordSeedCredentials | null {
  if (env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) return { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD };
  return env.AISA_API_KEY ? { aisaApiKey: env.AISA_API_KEY } : null;
}

/**
 * 每日从工具意图种子生成候选（替代从 HN / RSS 新闻标题孵化）。
 *
 * 新候选的主 query 记为 **tier A**：04 §5 里只有 A/B 层有 SERP，而一条候选要发布，
 * 必须先攒够 14 天 SERP（05 §4.2）。C 层候选的 W 轴恒为 `INSUFFICIENT`，永远发布不了。
 *
 * 词量 / 难度只用于决定「是否进入候选池」，**不写进任何评分输入**（06 §7.1a）；原始值
 * 留在 `candidate_reason` 里供人看，不进 `opportunity_snapshots.metrics`。
 */
export async function seedKeywordCandidates(
  obsDate: string,
  collector: KeywordSeedCollector | null = (() => {
    const creds = credentialsFromEnv();
    return creds ? new KeywordSeedCollector(creds) : null;
  })()
): Promise<SeedKeywordResult> {
  const result: SeedKeywordResult = { skipped: false, seeds: [], fetched: 0, created: 0, failures: 0 };
  if (!collector) return { ...result, skipped: true, reason: 'neither DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD nor AISA_API_KEY is set' };

  const active = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM opportunities WHERE discovery_source = $1 AND status = 'CANDIDATE'`,
    [DISCOVERY_SOURCE_KEYWORD_SEED]
  );
  const room = Math.min(MAX_NEW_CANDIDATES_PER_RUN, MAX_ACTIVE_SEED_CANDIDATES - (active.rows[0]?.n ?? 0));
  if (room <= 0) return { ...result, skipped: true, reason: `active seed candidates at cap (${MAX_ACTIVE_SEED_CANDIDATES})` };

  // 游标按日期推导而不是存状态：同一天重跑展开同一组种子（幂等），隔天自然前进。
  const day = Math.floor(Date.parse(`${obsDate}T00:00:00Z`) / 86_400_000);
  const start = (day * SEEDS_PER_RUN) % TOOL_INTENT_SEEDS.length;
  const seeds = Array.from({ length: SEEDS_PER_RUN }, (_, i) => TOOL_INTENT_SEEDS[(start + i) % TOOL_INTENT_SEEDS.length]);

  const markets = parseSeedMarkets();
  const existing = await query<{ query_text: string; market_country: string }>(
    `SELECT q.query_text, q.market_country
       FROM opportunity_queries oq JOIN queries q ON q.id = oq.query_id
      WHERE oq.role = 'PRIMARY'`
  );
  const seen = new Set(existing.rows.map((r) => `${r.market_country}:${dedupeKey(r.query_text)}`));

  for (const { seed, archetype } of seeds) {
    result.seeds.push(seed);
    for (const market of markets) {
      const suggestions = await collector.suggest(seed, DEFAULT_KEYWORD_SEED_FILTER, {
        locationCode: market.locationCode,
        languageCode: market.language.slice(0, 2).toLowerCase(),
      });
      // 失败的请求同样计费（服务端已执行），所以无论成败都记账。
      await CostLedgerService.recordCost({
        sourceId: 'src_keyword_seed',
        costUsd: KEYWORD_SEED_COST_USD,
        category: 'SERP',
        units: 1,
      });
      if (!suggestions) {
        result.failures++;
        continue;
      }
      result.fetched += suggestions.length;

      for (const s of suggestions) {
        if (result.created >= room) break;
        if (!isCandidateKeyword(s, seed)) continue;
        const key = `${market.country}:${dedupeKey(s.keyword)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const text = s.keyword.toLowerCase().replace(/\s+/g, ' ').trim();
        const opportunityId = idFor('opp_kw', `${market.country}:${text}`);
        const slug = market.country === 'US' ? slugFor(text) : `${slugFor(text)}-${market.country.toLowerCase()}`;
        const reason =
          `Long-tail of tool seed "${seed}" (Google ${market.country}, DataForSEO Labs, ${obsDate}): ` +
          `~${s.searchVolume}/mo, difficulty ${s.keywordDifficulty ?? 'n/a'}, intent ${s.mainIntent ?? 'n/a'}. ` +
          `Entry filter only — volume is not a scoring input.`;

      const created = await transaction(async (client) => {
        const q = await client.query<{ id: string }>(
          `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier, intent)
           VALUES ($1, $2, $3, $4, $5, 'A', $6)
           ON CONFLICT (query_text, market_country, research_language)
           DO UPDATE SET tier = LEAST(queries.tier, EXCLUDED.tier)
           RETURNING id`,
          [
            idFor('qry', `${market.country}:${text}`),
            text,
            market.country,
            market.language,
            obsDate,
            classifyQueryIntent(text),
          ]
        );
        const queryId = q.rows[0].id;
        const opp = await client.query(
          `INSERT INTO opportunities (
             id, slug, title, status, market_country, research_language,
             first_observed_date, recommended_archetype, execution_class,
             discovery_source, discovered_at, candidate_reason
           ) VALUES ($1, $2, $3, 'CANDIDATE', $4, $5, $6, $7, 'S', $8, NOW(), $9)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            opportunityId,
            slug,
            text,
            market.country,
            market.language,
            obsDate,
            archetype,
            DISCOVERY_SOURCE_KEYWORD_SEED,
            reason,
          ]
        );
        if (opp.rows.length === 0) return false;
        await client.query(
          `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')
           ON CONFLICT (opportunity_id, query_id) DO NOTHING`,
          [opportunityId, queryId]
        );
        // 卡片以全 INSUFFICIENT 起步：还没有任何一次观测，不能先填分数。
        await client.query(
          `INSERT INTO opportunity_cards (
             opportunity_id, slug, primary_query, verdict, lifecycle,
             d_basis_points, m_basis_points, w_basis_points,
             d_band, m_band, w_band, confidence,
             recommended_archetype, execution_class, why_now_summary, top_idea, first_observed_at
           ) VALUES ($1, $2, $3, 'WATCH', 'FORMING', 0, 0, 0,
                     'INSUFFICIENT', 'INSUFFICIENT', 'INSUFFICIENT', 'LOW',
                     $4, 'S', $5, $6, NOW())
           ON CONFLICT (opportunity_id) DO NOTHING`,
          [
            opportunityId,
            slug,
            text,
            archetype,
            `Observation started ${obsDate}. A verdict needs 14 days of autocomplete and Google SERP history.`,
            `Check who currently ranks for "${text}" and whether any of them charge before building.`,
          ]
        );
        return true;
      });
      if (created) result.created++;
      }
    }
  }
  return result;
}
