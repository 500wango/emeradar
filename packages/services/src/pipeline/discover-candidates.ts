import { createHash } from 'node:crypto';
import { query } from '@emeradar/db';

const MAX_CANDIDATES_PER_RUN = 25;

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function slugForQuery(queryText: string): string {
  const base = queryText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = createHash('sha256').update(queryText).digest('hex').slice(0, 8);
  return `${base || 'emerging-query'}-${suffix}`;
}

function idForQuery(prefix: string, queryText: string): string {
  return `${prefix}_${createHash('sha256').update(queryText).digest('hex').slice(0, 20)}`;
}

/** Promote new autocomplete expansions into the existing opportunity model. */
export async function discoverAutocompleteCandidates(obsDate: string): Promise<number> {
  const suggestions = await query<{
    suggestion: string;
    source_query: string;
  }>(
    `SELECT normalized.suggestion,
            MIN(normalized.source_query) AS source_query
     FROM (
       SELECT LOWER(TRIM(s)) AS suggestion,
              q.query_text AS source_query,
              ao.observed_date
       FROM autocomplete_observations ao
       JOIN queries q ON q.id = ao.query_id
       CROSS JOIN LATERAL unnest(ao.suggestions) AS expanded(s)
       WHERE ao.observed_date <= $1::date
         AND ao.observed_date > $1::date - 14
         AND LENGTH(TRIM(s)) BETWEEN 3 AND 120
       GROUP BY LOWER(TRIM(s)), q.query_text, ao.observed_date
     ) normalized
     GROUP BY normalized.suggestion, normalized.source_query
     ORDER BY COUNT(*) DESC, normalized.suggestion
     LIMIT $2`,
    [obsDate, MAX_CANDIDATES_PER_RUN]
  );

  let created = 0;
  for (const row of suggestions.rows) {
    const candidateQuery = normalizeQuery(row.suggestion);
    const sourceQuery = normalizeQuery(row.source_query);
    if (!candidateQuery || candidateQuery === sourceQuery) continue;

    const existing = await query<{ opportunity_id: string }>(
      `SELECT oq.opportunity_id
       FROM opportunity_queries oq
       JOIN queries q ON q.id = oq.query_id
       WHERE LOWER(q.query_text) = $1 AND oq.role = 'PRIMARY'
       LIMIT 1`,
      [candidateQuery]
    );
    if (existing.rows[0]) continue;

    const queryId = idForQuery('qry', candidateQuery);
    const opportunityId = idForQuery('opp', candidateQuery);
    const slug = slugForQuery(candidateQuery);
    const reason = `New related search: "${candidateQuery}" was discovered while observing "${sourceQuery}".`;

    await query(
      `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
       VALUES ($1, $2, 'US', 'en-US', $3, 'C')
       ON CONFLICT (query_text, market_country, research_language) DO NOTHING`,
      [queryId, candidateQuery, obsDate]
    );
    const actualQuery = await query<{ id: string }>(
      `SELECT id FROM queries WHERE query_text = $1 AND market_country = 'US' AND research_language = 'en-US'`,
      [candidateQuery]
    );
    const actualQueryId = actualQuery.rows[0]?.id;
    if (!actualQueryId) continue;

    const inserted = await query<{ id: string }>(
      `INSERT INTO opportunities (
         id, slug, title, status, market_country, research_language,
         first_observed_date, recommended_archetype, execution_class,
         discovery_source, discovered_at, candidate_reason
       ) VALUES ($1, $2, $3, 'CANDIDATE', 'US', 'en-US', $4, 'LIGHTWEIGHT_TOOL', 'S',
                 'AUTOCOMPLETE', NOW(), $5)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [opportunityId, slug, candidateQuery, obsDate, reason]
    );
    if (!inserted.rows[0]) continue;

    await query(
      `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
       VALUES ($1, $2, 'PRIMARY')
       ON CONFLICT (opportunity_id, query_id) DO NOTHING`,
      [opportunityId, actualQueryId]
    );
    await query(
      `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (opportunity_id, obs_date) DO NOTHING`,
      [`snp_${opportunityId}_${obsDate}`, opportunityId, obsDate, JSON.stringify({ discoverySource: 'AUTOCOMPLETE' })]
    );
    await query(
      `INSERT INTO opportunity_cards (
         opportunity_id, slug, primary_query, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points,
         d_band, m_band, w_band, confidence,
         recommended_archetype, execution_class, why_now_summary, top_idea,
         first_observed_at, query_velocity, featured_evidence_snippet
       ) VALUES ($1, $2, $3, 'WATCH', 'FORMING', 0, 0, 0,
                 'INSUFFICIENT', 'INSUFFICIENT', 'INSUFFICIENT', 'LOW',
                 'LIGHTWEIGHT_TOOL', 'S', $4, $5, NOW(), 0, $6)
       ON CONFLICT (opportunity_id) DO NOTHING`,
      [
        opportunityId,
        slug,
        candidateQuery,
        `Search interest is still being observed for "${candidateQuery}". It appeared as a related search to "${sourceQuery}".`,
        `Start by checking the core job behind "${candidateQuery}"; confirm demand, paid supply, and competition before building.`,
        reason,
      ]
    );
    created++;
  }

  return created;
}
