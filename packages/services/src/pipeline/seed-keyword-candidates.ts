import { createHash } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import {
  CostLedgerService,
  DEFAULT_KEYWORD_SEED_FILTER,
  KEYWORD_SEED_COST_USD,
  KeywordSeedCollector,
  KeywordSeedCredentials,
  KeywordSuggestion,
  volumeBand,
} from '@emeradar/collectors';
import { classifyQueryIntent } from '../query-intent';
import { lexicalFingerprint } from '../canonical-query.service';
/**
 * 工具意图种子（02 §7「修饰词模板」）。每个种子是一个产品形态，`keyword_suggestions`
 * 返回包含它的长尾词，例如 generator → "fantasy name generator"、"invoice generator"。
 * 顺序即轮转顺序：每天从游标处取 `SEEDS_PER_RUN` 个，约两周走完一轮。
 */
/**
 * 载体名词（object side）。
 *
 * 这里曾经全是**功能词**（generator / calculator / api / template），只有 pdf/csv/invoice
 * 少数几个名词。结果是「谁在用什么」这一侧完全不受控：
 *   - `keyword_suggestions("generator")` 会返回 `electric generator`、`pokemon generator`；
 *   - 过滤只要求“包含种子”，于是物理产品、随机玩具统统进池。
 *
 * 现在反过来：先定**业务载体**（发票、收据、播客、字幕……），只保留
 * 「载体 + 工具动词」的交集。`electric generator` 没有载体，直接出局；
 * `invoice generator` 同时命中两者，才是真的工具需求。
 */
export const CARRIER_NOUNS: Array<{
  carrier: string;
  archetype: 'TOOL' | 'MICRO_SAAS' | 'DIRECTORY' | 'CONTENT_SITE';
}> = [
  { carrier: 'invoice', archetype: 'TOOL' },
  { carrier: 'receipt', archetype: 'TOOL' },
  { carrier: 'quote', archetype: 'MICRO_SAAS' },
  { carrier: 'estimate', archetype: 'MICRO_SAAS' },
  { carrier: 'timesheet', archetype: 'MICRO_SAAS' },
  { carrier: 'payroll', archetype: 'MICRO_SAAS' },
  { carrier: 'expense', archetype: 'MICRO_SAAS' },
  { carrier: 'budget', archetype: 'MICRO_SAAS' },
  { carrier: 'tax', archetype: 'MICRO_SAAS' },
  { carrier: 'contract', archetype: 'MICRO_SAAS' },
  { carrier: 'nda', archetype: 'TOOL' },
  { carrier: 'proposal', archetype: 'TOOL' },
  { carrier: 'sow', archetype: 'TOOL' },
  { carrier: 'resume', archetype: 'TOOL' },
  { carrier: 'cover letter', archetype: 'TOOL' },
  { carrier: 'portfolio', archetype: 'TOOL' },
  { carrier: 'pdf', archetype: 'TOOL' },
  { carrier: 'csv', archetype: 'TOOL' },
  { carrier: 'excel', archetype: 'TOOL' },
  { carrier: 'spreadsheet', archetype: 'TOOL' },
  { carrier: 'json', archetype: 'TOOL' },
  { carrier: 'markdown', archetype: 'TOOL' },
  { carrier: 'image', archetype: 'TOOL' },
  { carrier: 'photo', archetype: 'TOOL' },
  { carrier: 'video', archetype: 'TOOL' },
  { carrier: 'audio', archetype: 'TOOL' },
  { carrier: 'subtitle', archetype: 'TOOL' },
  { carrier: 'caption', archetype: 'TOOL' },
  { carrier: 'transcript', archetype: 'TOOL' },
  { carrier: 'podcast', archetype: 'TOOL' },
  { carrier: 'podcast show notes', archetype: 'TOOL' },
  { carrier: 'newsletter', archetype: 'MICRO_SAAS' },
  { carrier: 'email', archetype: 'MICRO_SAAS' },
  { carrier: 'calendar', archetype: 'MICRO_SAAS' },
  { carrier: 'booking', archetype: 'MICRO_SAAS' },
  { carrier: 'appointment', archetype: 'MICRO_SAAS' },
  { carrier: 'survey', archetype: 'TOOL' },
  { carrier: 'form', archetype: 'TOOL' },
  { carrier: 'quiz', archetype: 'TOOL' },
  { carrier: 'checklist', archetype: 'CONTENT_SITE' },
  { carrier: 'sitemap', archetype: 'TOOL' },
  { carrier: 'keyword', archetype: 'MICRO_SAAS' },
  { carrier: 'backlink', archetype: 'MICRO_SAAS' },
  { carrier: 'meta description', archetype: 'TOOL' },
  { carrier: 'landing page', archetype: 'MICRO_SAAS' },
  { carrier: 'schema markup', archetype: 'TOOL' },
  { carrier: 'review', archetype: 'MICRO_SAAS' },
  { carrier: 'testimonial', archetype: 'TOOL' },
  { carrier: 'faq', archetype: 'TOOL' },
  { carrier: 'chatbot', archetype: 'MICRO_SAAS' },
  { carrier: 'inventory', archetype: 'MICRO_SAAS' },
  { carrier: 'shipping', archetype: 'MICRO_SAAS' },
  { carrier: 'barcode', archetype: 'TOOL' },
  { carrier: 'qr code', archetype: 'TOOL' },
  { carrier: 'label', archetype: 'TOOL' },
  { carrier: 'password', archetype: 'TOOL' },
  { carrier: 'logo', archetype: 'TOOL' },
  { carrier: 'compliance', archetype: 'MICRO_SAAS' },
  { carrier: 'screenshot', archetype: 'TOOL' },
  { carrier: 'url', archetype: 'TOOL' },
];

/**
 * 工具动词（function side）。只有「载体 + 其中一个动词」才算需求词。
 *
 * 这一侧不单独做种子：`generator` 单独出海的必然是 `electric generator`
 * 这类物理产品，不是软件需求。
 */
export const TOOL_MODIFIERS = [
  'generator', 'calculator', 'converter', 'template', 'checker', 'maker', 'builder',
  'tracker', 'planner', 'finder', 'remover', 'extractor', 'summarizer', 'editor',
  'uploader', 'downloader', 'api', 'tool', 'software', 'app', 'alternative',
  'dashboard', 'audit', 'scanner', 'validator', 'merger', 'splitter', 'compressor',
];

/**
 * 物理世界/非软件意图：出现即出局。
 *
 * `electric generator`、`diesel generator`、`generator for sale` 都是真搜索，
 * 但它们不是软件需求，观测它们只会浪费预算。
 */
const NON_SOFTWARE = /\b(electric|diesel|gas|petrol|portable|inverter|home|for sale|near me|repair|install|wiring|motor|engine|buy online|apk|crack|torrent|download free pdf|hardware|machine|generator set)\b/i;

/** 每天展开的种子数。2 × $0.018 = $0.036/天。 */
export const SEEDS_PER_RUN = Number(process.env.SEED_PER_RUN ?? 4);
/** 每天最多新增的候选数。每个候选此后每天约 $0.005（autocomplete + SERP + 抓取）。 */
export const MAX_NEW_CANDIDATES_PER_RUN = Number(process.env.SEED_MAX_NEW ?? 15);
/** 活跃候选池上限。超过就不再新增，避免观测成本随时间线性上涨。 */
export const MAX_ACTIVE_SEED_CANDIDATES = Number(process.env.SEED_MAX_ACTIVE ?? 300);

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
const INFORMATIONAL_PREFIX = /^(how to|what is|why |is there|best |top \d+)/i;
const DEFINITIONAL = /\b(definition|meaning|what is|what are|full form|explained|examples?|wiki)\b/i;

export function isCandidateKeyword(s: KeywordSuggestion, carrier: string): boolean {
  const kw = s.keyword.toLowerCase();
  const carrierLower = carrier.toLowerCase();

  if (kw === carrierLower) return false;
  if (EXCLUDED.test(kw)) return false;
  if (NON_SOFTWARE.test(kw)) return false;
  if (s.mainIntent === 'navigational') return false;
  if (INFORMATIONAL_PREFIX.test(kw)) return false;
  if (DEFINITIONAL.test(kw)) return false;

  const words = kw.split(/\s+/).length;
  // 只做 US/EN：非 ASCII 词面（“CSV 文件定义”）不是工具长尾。
  if (words < 2 || words > 6 || !/^[a-z0-9 .,'&+-]+$/.test(kw)) return false;

  // 载体必须出现（整词匹配，避免 api ⊂ capital）。
  if (!wordBoundary(carrierLower).test(kw)) return false;
  // 并且必须出现一个工具动词——否则只是“关于这个载体”的内容词。
  const hasModifier = TOOL_MODIFIERS.some((modifier) => wordBoundary(modifier).test(kw));
  if (!hasModifier) return false;

  // 泛化到没有具体动作的“X for sale / X cost”这类词，命中物理/交易噪音已经在上面挡掉；
  // 这里再挡一次纯价格询问。
  if (/\b(cost|price|rate|salary|meaning|vs)\b/.test(kw)) return false;

  return true;
}

function wordBoundary(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

/**
 * 「同一个需求」的粗去重键：DataForSEO 会返回 "barcode generator" / "barcodes generator" /
 * "barcode-generator" 这类拼写变体，各开一个候选只会重复观测同一个 SERP。
 */
/**
 * 合并两路口径的结果，同一个词只留一条。
 *
 * 词量取较大值：两个接口对同一词的估算可能不同（采样窗口/网络口径不同），
 * 取大值是为了让“需求上限”这一侧不被低估——它只用于入口筛选与展示。
 */
export function mergeByKeyword(
  left: KeywordSuggestion[] | null,
  right: KeywordSuggestion[] | null
): KeywordSuggestion[] | null {
  if (left === null && right === null) return null;
  const byKeyword = new Map<string, KeywordSuggestion>();
  for (const list of [left ?? [], right ?? []]) {
    for (const item of list) {
      const existing = byKeyword.get(item.keyword);
      if (!existing || item.searchVolume > existing.searchVolume) {
        byKeyword.set(item.keyword, item);
      }
    }
  }
  return [...byKeyword.values()].sort((a, b) => b.searchVolume - a.searchVolume);
}

export function dedupeKey(keyword: string): string {
  // 与 canonical-query.service 的 lexicalFingerprint 同一口径：种子层与
  // canonical 层必须得到同一个键，否则同一个需求会被合并两次、各算一套观测。
  return lexicalFingerprint(keyword);
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
  })(),
  /** 测试用：显式指定本轮载体，避免依赖“今天是第几天”的轮换。 */
  options: { seeds?: Array<{ seed: string; archetype: 'TOOL' | 'MICRO_SAAS' | 'DIRECTORY' | 'CONTENT_SITE' }> } = {}
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
  const start = (day * SEEDS_PER_RUN) % CARRIER_NOUNS.length;
  // 每天轮换载体名词：先定“做什么”，再要求“用工具做”。
  const seeds =
    options.seeds ??
    Array.from({ length: SEEDS_PER_RUN }, (_, i) => {
      const entry = CARRIER_NOUNS[(start + i) % CARRIER_NOUNS.length];
      return { seed: entry.carrier, archetype: entry.archetype };
    });

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
      const marketArg = {
        locationCode: market.locationCode,
        languageCode: market.language.slice(0, 2).toLowerCase(),
      };
      // 两路一起取：suggestions 给“包含种子的长尾”（覆盖广、量小），
      // ideas 给“相关词”（覆盖窄、量大）。只取一路必然偏向某一端。
      const fromSuggestions = await collector.suggest(seed, DEFAULT_KEYWORD_SEED_FILTER, marketArg);
      const fromIdeas = await collector.ideas(seed, DEFAULT_KEYWORD_SEED_FILTER, marketArg);
      const suggestions = mergeByKeyword(fromSuggestions, fromIdeas);
      // 两路各一次请求；失败同样计费（服务端已执行），所以无论成败都记账。
      // 一路失败时仍记两次：那次请求确实发出去了，不记等于把成本藏起来。
      const requested = (fromSuggestions === null ? 1 : 1) + (fromIdeas === null ? 1 : 1);
      await CostLedgerService.recordCost({
        sourceId: 'src_keyword_seed',
        costUsd: KEYWORD_SEED_COST_USD * requested,
        category: 'SERP',
        units: requested,
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
          `Tool seed "${seed}" (Google ${market.country}, DataForSEO Labs, ${obsDate}): ` +
          `~${s.searchVolume}/mo (${volumeBand(s.searchVolume)}), difficulty ${s.keywordDifficulty ?? 'n/a'}, ` +
          `intent ${s.mainIntent ?? 'n/a'}. Entry filter only — volume is not a scoring input.`;

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
        // 词法指纹随候选落库：canonical 归并与重复观测拦截都依赖它。
        // 同时记下入口需求信号（词量/难度/档位）——只用于排序与展示，不进评分。
        await client.query(
          `UPDATE opportunities
              SET lexical_fingerprint = $2,
                  entry_search_volume = $3,
                  entry_keyword_difficulty = $4,
                  volume_band = $5
            WHERE id = $1`,
          [
            opportunityId,
            dedupeKey(text),
            s.searchVolume,
            s.keywordDifficulty ?? null,
            volumeBand(s.searchVolume),
          ]
        );
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
