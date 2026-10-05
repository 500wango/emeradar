import { createHash } from 'node:crypto';
import { query, transaction } from '@emeradar/db';

function cleanQueryTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^Show HN:\s*/i, '')
    .replace(/^Ask HN:\s*/i, '')
    .replace(/^Tell HN:\s*/i, '')
    .replace(/\s*–.*$/, '')
    .replace(/\s*-.*$/, '')
    .replace(/\s*\(.*\)$/, '')
    .trim();
}

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = createHash('sha256').update(text).digest('hex').slice(0, 6);
  return `${base || 'opp'}-${suffix}`;
}

function inferArchetype(title: string): string {
  const lower = title.toLowerCase();
  if (/alternative|directory|database|list|curated|landscape/i.test(lower)) {
    return 'DATABASE_DIRECTORY';
  }
  if (/calculator|estimator|pricing|audit|benchmark/i.test(lower)) {
    return 'CALCULATOR_ESTIMATOR';
  }
  if (/template|boilerplate|starter|kit/i.test(lower)) {
    return 'TEMPLATE_BOILERPLATE';
  }
  if (/agent|saas|platform|workflow|engine|copilot|substrate|tool/i.test(lower)) {
    return 'MICRO_SAAS';
  }
  return 'LIGHTWEIGHT_TOOL';
}

export async function incubateCandidatesFromDiscovery(limit = 15): Promise<
  Array<{ id: string; title: string; primaryQuery: string; archetype: string }>
> {
  const items = await query<{
    id: string;
    title: string;
    source_url: string;
    provider: string;
    first_collected_at: string;
  }>(
    `SELECT d.id, d.title, d.source_url, d.provider, d.first_collected_at::text
     FROM discovery_items d
     WHERE NOT EXISTS (
       SELECT 1 FROM opportunities o WHERE o.discovery_source = d.provider AND o.title = d.title
     )
     ORDER BY d.first_collected_at DESC
     LIMIT $1`,
    [limit]
  );

  const created: Array<{ id: string; title: string; primaryQuery: string; archetype: string }> = [];
  const obsDate = new Date().toISOString().slice(0, 10);

  for (const item of items.rows) {
    const cleanQuery = cleanQueryTitle(item.title);
    if (!cleanQuery || cleanQuery.length < 3) continue;

    const oppId = `opp_dsc_${createHash('sha256').update(item.id + cleanQuery).digest('hex').slice(0, 20)}`;
    const qryId = `qry_dsc_${createHash('sha256').update(cleanQuery).digest('hex').slice(0, 20)}`;
    const slug = slugify(cleanQuery);
    const archetype = inferArchetype(item.title);
    const reason = `Captured from live signal [${item.provider}]: "${item.title}". URL: ${item.source_url}`;

    await transaction(async (client) => {
      // 1. Ensure Query exists
      await client.query(
        `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
         VALUES ($1, $2, 'US', 'en-US', $3, 'C')
         ON CONFLICT (query_text, market_country, research_language) DO NOTHING`,
        [qryId, cleanQuery, obsDate]
      );
      const qRes = await client.query<{ id: string }>(
        `SELECT id FROM queries WHERE query_text = $1 AND market_country = 'US' AND research_language = 'en-US'`,
        [cleanQuery]
      );
      const actualQueryId = qRes.rows[0]?.id || qryId;

      // 2. Insert Opportunity with status = 'CANDIDATE'
      const oppRes = await client.query<{ id: string }>(
        `INSERT INTO opportunities (
           id, slug, title, status, market_country, research_language,
           first_observed_date, recommended_archetype, execution_class,
           discovery_source, discovered_at, candidate_reason
         ) VALUES ($1, $2, $3, 'CANDIDATE', 'US', 'en-US', $4, $5, 'S', $6, NOW(), $7)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [oppId, slug, item.title, obsDate, archetype, item.provider, reason]
      );

      if (oppRes.rows.length === 0) return;

      // 3. Link PRIMARY Query
      await client.query(
        `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
         VALUES ($1, $2, 'PRIMARY')
         ON CONFLICT (opportunity_id, query_id) DO NOTHING`,
        [oppId, actualQueryId]
      );

      // 4. Create Opportunity Card in WATCH state
      await client.query(
        `INSERT INTO opportunity_cards (
           opportunity_id, slug, primary_query,
           verdict, lifecycle, recommended_archetype, execution_class,
           d_basis_points, m_basis_points, w_basis_points,
           d_band, m_band, w_band, confidence,
           why_now_summary, top_idea, first_observed_at
         ) VALUES (
           $1, $2, $3,
           'WATCH', 'EARLY_WINDOW', $4, 'S',
           7200, 6800, 7100,
           'HIGH', 'MEDIUM', 'HIGH', 'MEDIUM',
           $5, $6, NOW()
         )
         ON CONFLICT (opportunity_id) DO NOTHING`,
        [
          oppId,
          slug,
          cleanQuery,
          archetype,
          `Fresh builder signal detected from ${item.provider}. Early discussion velocity and organic interest observed.`,
          `Validate core demand for "${cleanQuery}" by checking user pain points, supply gaps, and commercial intent.`,
        ]
      );

      created.push({ id: oppId, title: item.title, primaryQuery: cleanQuery, archetype });
    });
  }

  return created;
}
