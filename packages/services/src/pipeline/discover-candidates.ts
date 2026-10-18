import { createHash } from 'node:crypto';
import { query } from '@emeradar/db';

/** 单个机会的簇上限。联想词每天约 20 条，不设上限簇会无界增长。 */
const MAX_CLUSTER_QUERIES_PER_OPPORTUNITY = 40;

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function idForQuery(queryText: string): string {
  return `qry_${createHash('sha256').update(queryText).digest('hex').slice(0, 20)}`;
}

/**
 * 把主 query 的 autocomplete 联想词挂进**同一机会**的簇（`role = 'CLUSTER'`，tier C）。
 *
 * 这一步此前把每条联想词注册成一个**新的候选机会**，主 query 落在 tier C。两个后果
 * 都让候选永远发布不了：tier C 按 05 §4.2 没有 SERP、W 轴恒为 `INSUFFICIENT`；新机会
 * 的簇只有它自己一条，`cluster_size ≥ 5` 的 D 轴 MEDIUM 门槛不可能达到。它还批量产出
 * "2026 hell tour schedule" 这类与原意图无关的候选。
 *
 * 04 §5 的定义本来就是「C 层 = 仅 autocomplete 扩展得到的 query」，它们是簇成员，
 * 不是机会。聚类按 02 §7：无 SERP 重叠数据时以词面相似度暂挂——联想词以主 query 为
 * 前缀，词面相似是构造上成立的。
 */
export async function attachAutocompleteClusters(obsDate: string): Promise<number> {
  const rows = await query<{ opportunity_id: string; primary_text: string; suggestion: string }>(
    `SELECT oq.opportunity_id, q.query_text AS primary_text, LOWER(TRIM(s)) AS suggestion
       FROM opportunities o
       JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
       JOIN queries q ON q.id = oq.query_id
       JOIN autocomplete_observations ao ON ao.query_id = q.id
       CROSS JOIN LATERAL unnest(ao.suggestions) AS expanded(s)
      WHERE o.status IN ('CANDIDATE', 'TRACKED')
        AND ao.observed_date <= $1::date
        AND ao.observed_date > $1::date - 14
        AND LENGTH(TRIM(s)) BETWEEN 3 AND 120
      GROUP BY oq.opportunity_id, q.query_text, LOWER(TRIM(s))`,
    [obsDate]
  );

  const clusterCount = new Map<string, number>();
  const counts = await query<{ opportunity_id: string; n: number }>(
    `SELECT opportunity_id, COUNT(*)::int AS n FROM opportunity_queries WHERE role = 'CLUSTER' GROUP BY opportunity_id`
  );
  for (const row of counts.rows) clusterCount.set(row.opportunity_id, row.n);

  let attached = 0;
  for (const row of rows.rows) {
    const text = normalizeQuery(row.suggestion);
    if (!text || text === normalizeQuery(row.primary_text)) continue;
    const current = clusterCount.get(row.opportunity_id) ?? 0;
    if (current >= MAX_CLUSTER_QUERIES_PER_OPPORTUNITY) continue;

    // 已存在的 query 保持原层级（LEAST 只升不降）：同一个词可能是另一个机会的主 query。
    const q = await query<{ id: string }>(
      `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
       VALUES ($1, $2, 'US', 'en-US', $3, 'C')
       ON CONFLICT (query_text, market_country, research_language)
       DO UPDATE SET tier = LEAST(queries.tier, EXCLUDED.tier)
       RETURNING id`,
      [idForQuery(text), text, obsDate]
    );
    const queryId = q.rows[0]?.id;
    if (!queryId) continue;
    const linked = await query(
      `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
       VALUES ($1, $2, 'CLUSTER')
       ON CONFLICT (opportunity_id, query_id) DO NOTHING`,
      [row.opportunity_id, queryId]
    );
    if ((linked.rowCount ?? 0) > 0) {
      clusterCount.set(row.opportunity_id, current + 1);
      attached++;
    }
  }
  return attached;
}
