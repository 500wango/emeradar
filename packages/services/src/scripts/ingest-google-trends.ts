import { LiveScanService } from '../live-scan.service';
import { closePool, query } from '@emeradar/db';

const TRENDS_RSS = 'https://trends.google.com/trending/rss?geo=US';

interface TrendItem {
  title: string;
  approxTraffic: string | null;
  news: Array<{ title: string; url: string; source: string }>;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : null;
}

function parseTrends(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const title = tag(block, 'title');
    if (!title) continue;
    const news: TrendItem['news'] = [];
    for (const newsBlock of block.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/g) || []) {
      const newsTitle = tag(newsBlock, 'ht:news_item_title');
      const url = tag(newsBlock, 'ht:news_item_url');
      const source = tag(newsBlock, 'ht:news_item_source');
      if (newsTitle && url && source) news.push({ title: newsTitle, url, source });
    }
    items.push({
      title,
      approxTraffic: tag(block, 'ht:approx_traffic'),
      news,
    });
  }
  return items;
}

async function attachTrendEvidence(opportunityId: string, item: TrendItem): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM evidence
     WHERE opportunity_id = $1 AND source_type = 'GOOGLE_TRENDS'
     LIMIT 1`,
    [opportunityId]
  );
  if (existing.rows.length > 0) return;

  const snippet = item.approxTraffic
    ? `Google Trends lists this among daily US searches. Approximate traffic: ${item.approxTraffic}.`
    : 'Google Trends lists this among daily US searches. No traffic figure was in the feed.';

  await query(
    `INSERT INTO evidence (opportunity_id, evidence_class, source_type, domain, title, snippet, payload)
     VALUES ($1, 'OBSERVED', 'GOOGLE_TRENDS', 'trends.google.com', $2, $3, $4)`,
    [
      opportunityId,
      `Daily US search trend: ${item.title}`,
      snippet,
      JSON.stringify({
        geo: 'US',
        approxTraffic: item.approxTraffic,
        news: item.news,
        feed: TRENDS_RSS,
      }),
    ]
  );
}

async function main() {
  const response = await fetch(TRENDS_RSS, {
    headers: { 'User-Agent': 'emeradar-trends-ingest/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Google Trends RSS returned ${response.status}`);
  }
  const items = parseTrends(await response.text());
  if (items.length === 0) {
    throw new Error('Google Trends RSS contained no items');
  }

  console.log(`[trends] ${items.length} daily US searches`);
  for (const [index, item] of items.entries()) {
    console.log(`[${index + 1}/${items.length}] ${item.title}`);
    try {
      const result = await LiveScanService.scan({
        query: item.title,
        marketCountry: 'US',
        language: 'en-US',
      });
      await attachTrendEvidence(result.opportunityId, item);
      console.log(
        `  ${result.isNew ? 'stored' : 'already on file'} ${result.slug} suggestions=${result.suggestions.length} traffic=${item.approxTraffic ?? 'n/a'}`
      );
    } catch (error: any) {
      console.error(`  failed: ${error.message}`);
    }
  }
}

main()
  .then(() => closePool())
  .catch(async (error) => {
    console.error(error);
    await closePool();
    process.exit(1);
  });
