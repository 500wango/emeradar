import { query } from '@emeradar/db';

/**
 * Canonical Opportunity（Phase 1）。
 *
 * 两层消解，顺序固定，先便宜后昂贵：
 *
 *   L1 词法指纹（零成本）：去停用词、词形归一、token 排序。
 *      只解决“写法不同但明显同义”，例如 template spreadsheet / template for spreadsheet。
 *
 *   L2 SERP Top10 交集（要花 SERP 调用）：两个原词看起来不同时，用 Google 自己的
 *      排名结果判断是否同一意图。判据不是“≥4 URL 就合并”——不同意图（pdf editor
 *      vs pdf converter）也可能共享同一批工具站。所以要求：
 *        URL 交集 >= 4
 *        AND 主域名交集 >= 3
 *        AND 两次独立快照都成立
 *      仍然只作为**证据**：写进 merge_evidence，允许人工拆分。
 *
 * `surface_query` 永远保留原词；合并只影响观测账本的挂载，不影响发给 Google 的查询。
 */
export const MERGE_RULE_VERSION = 'canonical-v1';
export const LEXICAL_RULE_VERSION = 'lexical-v1';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'file',
  'free', 'online', 'best', 'top',
  // 连接词/介词：`timesheet calculator with lunch` 与 `timesheet calculator lunch`
  // 是同一个需求，漏掉 with 就会各占一条候选。
  'with', 'without', 'and', 'or', 'by', 'using', 'via', 'vs', 'per',
]);

/**
 * 词法指纹：与 `seed-keyword-candidates.dedupeKey` 同一口径。
 * 两边必须一致，否则同一个需求会在种子层和 canonical 层得到两个键。
 */
export function lexicalFingerprint(surface: string): string {
  return surface
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      let normalized = word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
      if (['convert', 'conversion', 'converter'].includes(normalized)) normalized = 'convert';
      return normalized;
    })
    .filter((word) => !STOP_WORDS.has(word))
    .sort()
    .join(' ');
}

export interface ClusterMemberRow {
  opportunityId: string;
  surfaceQuery: string;
  lexicalFingerprint: string | null;
}

export interface SerpOverlapEvidence {
  urlOverlap: number;
  domainOverlap: number;
  snapshotsCompared: number;
  sampleUrls: string[];
}

/** L2 判据。阈值写在这里，改动必须同时升 MERGE_RULE_VERSION。 */
export function isSameIntent(evidence: SerpOverlapEvidence): boolean {
  return (
    evidence.snapshotsCompared >= 2 &&
    evidence.urlOverlap >= 4 &&
    evidence.domainOverlap >= 3
  );
}

/** 取某机会主 query 最近 N 天的 Top10 URL（去重前的原始列表）。 */
async function recentTopUrls(opportunityId: string, snapshots: number): Promise<string[][]> {
  const res = await query<{ snapshot_id: string; url: string }>(
    `SELECT sr.serp_snapshot_id AS snapshot_id, sr.url
       FROM serp_results sr
       JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
       JOIN opportunity_queries oq ON oq.query_id = ss.query_id AND oq.role = 'PRIMARY'
      WHERE oq.opportunity_id = $1
        AND sr.rank <= 10
      ORDER BY ss.obs_date DESC, sr.rank
      LIMIT 200`,
    [opportunityId]
  );
  const bySnapshot = new Map<string, string[]>();
  for (const row of res.rows) {
    const list = bySnapshot.get(row.snapshot_id) ?? [];
    list.push(row.url);
    bySnapshot.set(row.snapshot_id, list);
  }
  return [...bySnapshot.values()].slice(0, snapshots);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 比较两个机会的 SERP Top10 交集。用**多份快照的两两比较都成立**来抵抗单次抖动：
 * 一次巧合的重叠不足以合并，否则 pdf editor 与 pdf converter 会被合在一起。
 */
export async function serpOverlapEvidence(
  leftOpportunityId: string,
  rightOpportunityId: string
): Promise<SerpOverlapEvidence | null> {
  const [left, right] = await Promise.all([
    recentTopUrls(leftOpportunityId, 2),
    recentTopUrls(rightOpportunityId, 2),
  ]);
  if (left.length === 0 || right.length === 0) return null;

  let compared = 0;
  let bestUrl = 0;
  let bestDomain = 0;
  let sample: string[] = [];
  for (const a of left) {
    for (const b of right) {
      compared++;
      const setB = new Set(b);
      const shared = a.filter((url) => setB.has(url));
      const sharedDomains = new Set(shared.map(domainOf).filter(Boolean));
      if (shared.length > bestUrl) {
        bestUrl = shared.length;
        bestDomain = sharedDomains.size;
        sample = shared.slice(0, 5);
      }
      bestDomain = Math.max(bestDomain, sharedDomains.size);
    }
  }

  return {
    urlOverlap: bestUrl,
    domainOverlap: bestDomain,
    // 「两份快照都成立」的保守口径：如果两边各自只有一份快照，比较次数为 1，
    // isSameIntent 会拒绝合并——数据不足时宁可分开，也不误合并。
    snapshotsCompared: Math.min(left.length, right.length),
    sampleUrls: sample,
  };
}

async function ensureCluster(
  canonicalKey: string,
  marketCountry: string,
  researchLanguage: string,
  mergeEvidence: Record<string, unknown>
): Promise<string> {
  const id = `clu_${canonicalKey.replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${marketCountry.toLowerCase()}`;
  await query(
    `INSERT INTO opportunity_clusters
       (id, canonical_key, market_country, research_language, merge_rule_version, merge_evidence)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (canonical_key, market_country, research_language) DO UPDATE SET
       merge_evidence = opportunity_clusters.merge_evidence || EXCLUDED.merge_evidence,
       updated_at = NOW()`,
    [id, canonicalKey, marketCountry, researchLanguage, MERGE_RULE_VERSION, JSON.stringify(mergeEvidence)]
  );
  const res = await query<{ id: string }>(
    `SELECT id FROM opportunity_clusters
      WHERE canonical_key = $1 AND market_country = $2 AND research_language = $3`,
    [canonicalKey, marketCountry, researchLanguage]
  );
  return res.rows[0]?.id ?? id;
}

export interface CanonicalizeResult {
  clusterId: string;
  representativeOpportunityId: string;
  membersJoined: number;
  /** 由 L2 SERP 交集合并进来的机会（证据写在 merge_evidence 里）。 */
  serpMerged: string[];
}

/**
 * 把一个机会挂进它的 canonical 簇。
 *
 * L1：同 market + 同词法指纹的机会直接同簇；代表词优先“商业意图 + 观测更久”，
 *     而不是 Autocomplete 顺位（顺位偏向头部泛词）。
 * L2：只在 L1 找不到同伴、且调用方显式要求时才跑 SERP 交集。
 */
export async function canonicalizeOpportunity(
  opportunityId: string,
  options: { trySerpMerge?: boolean } = {}
): Promise<CanonicalizeResult | null> {
  const oppRes = await query<{
    id: string;
    title: string;
    market_country: string;
    research_language: string;
    primary_query: string | null;
    observation_days: number;
    search_intent: string | null;
  }>(
    `SELECT o.id, o.title, o.market_country, o.research_language,
            q.query_text AS primary_query,
            COALESCE((SELECT COUNT(DISTINCT observed_date) FROM autocomplete_observations ao
                       WHERE ao.query_id = q.id), 0)::int AS observation_days,
            c.search_intent
       FROM opportunities o
       LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
       LEFT JOIN queries q ON q.id = oq.query_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
      WHERE o.id = $1`,
    [opportunityId]
  );
  const opp = oppRes.rows[0];
  if (!opp) return null;

  const surface = opp.primary_query || opp.title;
  const fingerprint = lexicalFingerprint(surface);
  if (!fingerprint) return null;

  await query(
    `UPDATE opportunities SET lexical_fingerprint = $2 WHERE id = $1`,
    [opportunityId, fingerprint]
  );

  const canonicalKey = fingerprint;
  const mergeEvidence: Record<string, unknown> = {
    lexical: { ruleVersion: LEXICAL_RULE_VERSION, fingerprint, surface },
  };
  const clusterId = await ensureCluster(
    canonicalKey,
    opp.market_country,
    opp.research_language,
    mergeEvidence
  );

  // L1 同伴：同 market + 同指纹；按“商业意图优先、观测更久优先”选代表词。
  const siblings = await query<{ id: string; title: string; primary_query: string | null; observation_days: number; search_intent: string | null }>(
    `SELECT o.id, o.title, q.query_text AS primary_query,
            COALESCE((SELECT COUNT(DISTINCT observed_date) FROM autocomplete_observations ao
                       WHERE ao.query_id = q.id), 0)::int AS observation_days,
            c.search_intent
       FROM opportunities o
       LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
       LEFT JOIN queries q ON q.id = oq.query_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
      WHERE o.lexical_fingerprint = $1
        AND o.market_country = $2
        AND o.research_language = $3
        AND o.status <> 'ARCHIVED'`,
    [fingerprint, opp.market_country, opp.research_language]
  );

  const intentRank = (intent: string | null) =>
    intent === 'TRANSACTIONAL' ? 3 : intent === 'COMMERCIAL' ? 2 : intent === 'INFORMATIONAL' ? 1 : 0;
  const ranked = [...siblings.rows].sort(
    (a, b) => intentRank(b.search_intent) - intentRank(a.search_intent) || b.observation_days - a.observation_days
  );
  const representative = ranked[0]?.id ?? opportunityId;

  let membersJoined = 0;
  for (const member of siblings.rows) {
    const res = await query(
      `INSERT INTO opportunity_cluster_members
         (cluster_id, opportunity_id, surface_query, lexical_fingerprint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cluster_id, opportunity_id) DO NOTHING`,
      [clusterId, member.id, member.primary_query || member.title, fingerprint]
    );
    membersJoined += res.rowCount ?? 0;
  }

  await query(
    `UPDATE opportunities
        SET canonical_opportunity_id = $2
      WHERE id = ANY($1::text[])`,
    [siblings.rows.map((row) => row.id), representative]
  );
  await query(
    `UPDATE opportunity_clusters
        SET representative_opportunity_id = $2, updated_at = NOW()
      WHERE id = $1`,
    [clusterId, representative]
  );

  const serpMerged: string[] = [];
  if (options.trySerpMerge && siblings.rows.length <= 1) {
    // L2：只在 L1 没有同伴时才付 SERP 比较的钱。
    const candidates = await query<{ id: string }>(
      `SELECT o.id
         FROM opportunities o
         JOIN opportunity_cards c ON c.opportunity_id = o.id
        WHERE o.market_country = $1
          AND o.research_language = $2
          AND o.status <> 'ARCHIVED'
          AND o.id <> $3
          AND o.lexical_fingerprint IS NOT NULL
          AND o.lexical_fingerprint <> $4
          AND c.d_band <> 'INSUFFICIENT'
        ORDER BY c.d_basis_points DESC
        LIMIT 10`,
      [opp.market_country, opp.research_language, opportunityId, fingerprint]
    );
    for (const candidate of candidates.rows) {
      const evidence = await serpOverlapEvidence(opportunityId, candidate.id);
      if (!evidence || !isSameIntent(evidence)) continue;
      await query(
        `INSERT INTO opportunity_cluster_members
           (cluster_id, opportunity_id, surface_query, lexical_fingerprint)
         SELECT $1, o.id, COALESCE(q.query_text, o.title), o.lexical_fingerprint
           FROM opportunities o
           LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
           LEFT JOIN queries q ON q.id = oq.query_id
          WHERE o.id = $2
         ON CONFLICT (cluster_id, opportunity_id) DO NOTHING`,
        [clusterId, candidate.id]
      );
      await query(
        `UPDATE opportunities SET canonical_opportunity_id = $2 WHERE id = $1`,
        [candidate.id, representative]
      );
      await query(
        `UPDATE opportunity_clusters
            SET merge_evidence = merge_evidence || $2::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [
          clusterId,
          JSON.stringify({
            serpMerge: {
              ruleVersion: MERGE_RULE_VERSION,
              mergedOpportunityId: candidate.id,
              evidence,
            },
          }),
        ]
      );
      serpMerged.push(candidate.id);
    }
  }

  return { clusterId, representativeOpportunityId: representative, membersJoined, serpMerged };
}

/** 簇成员（含 surface query），供 Admin 与回测核对“合并了什么、依据是什么”。 */
export async function clusterMembers(clusterId: string): Promise<ClusterMemberRow[]> {
  const res = await query<{ opportunity_id: string; surface_query: string; lexical_fingerprint: string | null }>(
    `SELECT opportunity_id, surface_query, lexical_fingerprint
       FROM opportunity_cluster_members WHERE cluster_id = $1 ORDER BY joined_at`,
    [clusterId]
  );
  return res.rows.map((row) => ({
    opportunityId: row.opportunity_id,
    surfaceQuery: row.surface_query,
    lexicalFingerprint: row.lexical_fingerprint,
  }));
}
