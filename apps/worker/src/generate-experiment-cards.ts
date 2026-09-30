import { query } from '@emeradar/db';
import { createHash } from 'node:crypto';

export async function generateExperimentCards(limit = 20): Promise<number> {
  const rows = await query<{ item_id: string; intent_id: string; title: string; query_hypothesis: string }>(
    `SELECT d.id item_id, i.id intent_id, d.title, i.query_hypothesis
     FROM discovery_items d JOIN discovery_intents i ON i.discovery_item_id = d.id
     WHERE i.status = 'OBSERVED'
       AND NOT EXISTS (SELECT 1 FROM experiment_cards e WHERE e.discovery_intent_id = i.id)
     ORDER BY i.created_at DESC LIMIT $1`, [limit]);
  let created = 0;
  for (const row of rows.rows) {
    const id = `exp_${createHash('sha256').update(row.intent_id).digest('hex').slice(0, 24)}`;
    const result = await query(
      `INSERT INTO experiment_cards (id, discovery_item_id, discovery_intent_id, title, core_job, recommended_page_shape, minimum_feature, success_signal, abandon_condition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [id, row.item_id, row.intent_id, `Test ${row.query_hypothesis}`, `Help a user complete: ${row.query_hypothesis}`, 'single-purpose task page', `One working flow for ${row.query_hypothesis}`, 'Users complete the core action and return or share', 'No qualified use after the agreed observation window'],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}
