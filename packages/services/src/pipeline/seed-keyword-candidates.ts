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

/** 入口筛选：只看意图与词面，不看排名，也不把任何数值带进评分。 */
export function isCandidateKeyword(s: KeywordSuggestion, seed: string): boolean {
  const kw = s.keyword.toLowerCase();
  if (kw === seed.toLowerCase()) return false;
  if (EXCLUDED.test(kw)) return false;
  if (s.mainIntent === 'navigational') return false;
  const words = kw.split(/\s+/).length;
  return words >= 2 && words <= 6 && /^[a-z0-9 .,'&+-]+$/.test(kw);
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

  const existing = await query<{ query_text: string }>(
    `SELECT q.query_text FROM opportunity_queries oq JOIN queries q ON q.id = oq.query_id WHERE oq.role = 'PRIMARY'`
  );
  const seen = new Set(existing.rows.map((r) => dedupeKey(r.query_text)));

  for (const { seed, archetype } of seeds) {
    result.seeds.push(seed);
    const suggestions = await collector.suggest(seed, DEFAULT_KEYWORD_SEED_FILTER);
    // 失败的请求同样计费（服务端已执行），所以无论成败都记账。
    await CostLedgerService.recordCost({ sourceId: 'src_keyword_seed', costUsd: KEYWORD_SEED_COST_USD, category: 'SERP', units: 1 });
    if (!suggestions) {
      result.failures++;
      continue;
    }
    result.fetched += suggestions.length;

    for (const s of suggestions) {
      if (result.created >= room) break;
      if (!isCandidateKeyword(s, seed)) continue;
      const key = dedupeKey(s.keyword);
      if (seen.has(key)) continue;
      seen.add(key);

      const text = s.keyword.toLowerCase().replace(/\s+/g, ' ').trim();
      const opportunityId = idFor('opp_kw', text);
      const slug = slugFor(text);
      const reason =
        `Long-tail of tool seed "${seed}" (Google US, DataForSEO Labs, ${obsDate}): ` +
        `~${s.searchVolume}/mo, difficulty ${s.keywordDifficulty ?? 'n/a'}, intent ${s.mainIntent ?? 'n/a'}. ` +
        `Entry filter only — volume is not a scoring input.`;

      const created = await transaction(async (client) => {
        const q = await client.query<{ id: string }>(
          `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier, intent)
           VALUES ($1, $2, 'US', 'en-US', $3, 'A', $4)
           ON CONFLICT (query_text, market_country, research_language)
           DO UPDATE SET tier = LEAST(queries.tier, EXCLUDED.tier)
           RETURNING id`,
          [idFor('qry', text), text, obsDate, classifyQueryIntent(text)]
        );
        const queryId = q.rows[0].id;
        const opp = await client.query(
          `INSERT INTO opportunities (
             id, slug, title, status, market_country, research_language,
             first_observed_date, recommended_archetype, execution_class,
             discovery_source, discovered_at, candidate_reason
           ) VALUES ($1, $2, $3, 'CANDIDATE', 'US', 'en-US', $4, $5, 'S', $6, NOW(), $7)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [opportunityId, slug, text, obsDate, archetype, DISCOVERY_SOURCE_KEYWORD_SEED, reason]
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
  return result;
}
