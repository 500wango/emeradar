import { query } from '@emeradar/db';
import { createHash } from 'node:crypto';

type IntentKind = 'USE' | 'DOWNLOAD' | 'ALTERNATIVE' | 'API' | 'COMPARE' | 'TUTORIAL';

function idFor(itemId: string, kind: string, text: string): string {
  return `dint_${createHash('sha256').update(`${itemId}:${kind}:${text}`).digest('hex').slice(0, 24)}`;
}

function hypotheses(title: string): Array<{ kind: IntentKind; query: string }> {
  const clean = title.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  const items: Array<{ kind: IntentKind; query: string }> = [{ kind: 'USE', query: `${clean} tool` }];
  if (/api|sdk|developer|github/i.test(clean)) items.push({ kind: 'API', query: `${clean} API` });
  if (/app|tool|service|platform|software/i.test(clean)) items.push({ kind: 'ALTERNATIVE', query: `${clean} alternative` });
  if (/how|guide|learn|tutorial/i.test(clean)) items.push({ kind: 'TUTORIAL', query: `${clean} guide` });
  if (items.length < 3) items.push({ kind: 'COMPARE', query: `${clean} vs alternatives` });
  return items.slice(0, 6);
}

export async function generateDiscoveryIntents(limit = 100): Promise<number> {
  const items = await query<{ id: string; title: string }>(
    `SELECT d.id, d.title FROM discovery_items d
     WHERE NOT EXISTS (SELECT 1 FROM discovery_intents i WHERE i.discovery_item_id = d.id)
     ORDER BY d.first_collected_at DESC LIMIT $1`,
    [limit],
  );
  let created = 0;
  for (const item of items.rows) {
    for (const hypothesis of hypotheses(item.title)) {
      const result = await query(
        `INSERT INTO discovery_intents (id, discovery_item_id, intent_kind, query_hypothesis, status, evidence)
         VALUES ($1, $2, $3, $4, 'HYPOTHESIS', $5)
         ON CONFLICT (discovery_item_id, intent_kind, query_hypothesis) DO NOTHING`,
        [idFor(item.id, hypothesis.kind, hypothesis.query), item.id, hypothesis.kind, hypothesis.query, JSON.stringify({ basis: 'source_title', evidence: 'model_unverified' })],
      );
      created += result.rowCount ?? 0;
    }
  }
  return created;
}
