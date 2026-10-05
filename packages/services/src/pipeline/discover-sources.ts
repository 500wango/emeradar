import { query, transaction } from '@emeradar/db';
import {
  AIsaSearchProvider,
  DiscoverySource,
  HackerNewsDiscoverySource,
  RssDiscoverySource,
} from '@emeradar/collectors';

async function getDiscoverySources(): Promise<DiscoverySource[]> {
  const sources: DiscoverySource[] = [];

  // 1. AIsa / Tavily provider if keys available
  if (process.env.AISA_SEARCH_URL && process.env.AISA_API_KEY) {
    sources.push(new AIsaSearchProvider());
  }

  // 2. HackerNews Discovery Source
  sources.push(new HackerNewsDiscoverySource());

  // 3. Env RSS feeds
  const envFeeds = (process.env.DISCOVERY_RSS_FEEDS || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, url] = line.includes('|') ? line.split('|', 2) : [line, line];
      return new RssDiscoverySource(url.trim(), name.trim());
    });
  sources.push(...envFeeds);

  // 4. Active sources from database (e.g. added via Admin Console)
  try {
    const dbSources = await query<{
      id: string;
      name: string;
      type: string;
      config: any;
      is_active: boolean;
    }>(`SELECT id, name, type, config, is_active FROM sources WHERE is_active = true`);

    for (const r of dbSources.rows) {
      if (r.config?.url && (r.config?.provider === 'RSS' || r.type === 'DISCOVERY')) {
        const alreadyExists = sources.some(
          (s) => s instanceof RssDiscoverySource && (s as any).feedUrl === r.config.url
        );
        if (!alreadyExists) {
          sources.push(new RssDiscoverySource(r.config.url, r.name));
        }
      }
    }
  } catch (err) {
    console.warn('[discover] Failed to query active sources from DB, continuing with static sources:', err);
  }

  return sources;
}

async function ensureSource(source: DiscoverySource): Promise<void> {
  await query(
    `INSERT INTO sources (id, type, name, config, tos_risk_level)
     VALUES ($1, 'DISCOVERY', $2, $3, 'LOW')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config, is_active = true`,
    [source.sourceId, source.provider, JSON.stringify({ provider: source.provider })]
  );
}

export async function discoverSources(): Promise<{
  sources: number;
  collected: number;
  inserted: number;
  failed: number;
}> {
  const sources = await getDiscoverySources();
  let collected = 0;
  let inserted = 0;
  let failed = 0;

  for (const source of sources) {
    await ensureSource(source);
    const runId = `run_discovery_${source.sourceId}_${Date.now()}`;
    await query(
      `INSERT INTO collector_runs (id, source_id, status) VALUES ($1, $2, 'RUNNING')`,
      [runId, source.sourceId]
    );

    const outcome = await source.discover();
    if (outcome.status === 'FAILED') {
      failed++;
      await query(
        `UPDATE collector_runs SET status = 'FAILED', finished_at = NOW(), error_message = $2 WHERE id = $1`,
        [runId, `${outcome.errorCode}: ${outcome.message}`.slice(0, 1000)]
      );
      console.error(`[discover] ${source.provider} failed: ${outcome.message}`);
      continue;
    }

    collected += outcome.items.length;
    let runInserted = 0;
    for (const item of outcome.items) {
      const written = await transaction(async (client) => {
        const result = await client.query(
          `INSERT INTO discovery_items (
             id, source_id, source_item_id, provider, source_url, title, excerpt, source_published_at,
             first_collected_at, content_hash, request_hash, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (source_id, source_item_id) DO NOTHING
           RETURNING id`,
          [
            `dsc_${item.contentHash.slice(0, 24)}`,
            source.sourceId,
            item.sourceItemId,
            item.provider,
            item.sourceUrl,
            item.title,
            item.excerpt ?? null,
            item.publishedAt ?? null,
            item.collectedAt,
            item.contentHash,
            item.requestHash,
            JSON.stringify(item.metadata ?? {}),
          ]
        );
        return result.rowCount ?? 0;
      });
      runInserted += written;
    }
    inserted += runInserted;
    await query(
      `UPDATE collector_runs SET status = 'SUCCESS', items_collected = $2, finished_at = NOW() WHERE id = $1`,
      [runId, outcome.items.length]
    );
    console.log(`[discover] ${source.provider}: ${outcome.items.length} collected, ${runInserted} new`);
  }

  return { sources: sources.length, collected, inserted, failed };
}
