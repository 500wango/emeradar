import { query } from '@emeradar/db';

export type QueryIntent = 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL' | 'NAVIGATIONAL';

/** 确定性规则分类：同一个词必得同一个结果，不调用任何外部模型（ADR-020）。 */
export function classifyQueryIntent(text: string): QueryIntent {
  const q = text.toLowerCase();
  if (/\b(buy|price|pricing|cost|download|subscribe|deal|coupon|free trial)\b/.test(q)) return 'TRANSACTIONAL';
  if (/^(how|what|why|when|guide|tutorial|learn|meaning)\b/.test(q)) return 'INFORMATIONAL';
  if (/\b(login|sign in|official site)\b/.test(q)) return 'NAVIGATIONAL';
  return 'COMMERCIAL';
}

/**
 * 读冻结的意图；存量行（NULL）在首次使用时按规则补写一次。
 * `WHERE intent IS NULL` 让并发下的第二次写入什么都不改，触发器再兜住任何改写。
 */
export async function frozenIntentFor(queryId: string, text: string): Promise<QueryIntent> {
  const res = await query<{ intent: QueryIntent | null }>(`SELECT intent FROM queries WHERE id = $1`, [queryId]);
  const stored = res.rows[0]?.intent;
  if (stored) return stored;
  const intent = classifyQueryIntent(text);
  await query(`UPDATE queries SET intent = $2 WHERE id = $1 AND intent IS NULL`, [queryId, intent]);
  const after = await query<{ intent: QueryIntent | null }>(`SELECT intent FROM queries WHERE id = $1`, [queryId]);
  return after.rows[0]?.intent ?? intent;
}
