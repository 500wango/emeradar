import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';

export interface ScreenerDemoSummary {
  demo_id: string;
  query: string;
  market_country: string;
  research_language: string;
  snapshot_date: string | null;
}

/**
 * 官方 Demo 词（10 §4.3b）。匿名可读，**只读预先冻结的快照**：零配额、零外部请求。
 * 快照缺失回 503 `DEMO_UNAVAILABLE`，绝不回退成实时采集。
 */
export class ScreenerDemoService {
  static async list(): Promise<ScreenerDemoSummary[]> {
    const res = await query<ScreenerDemoSummary>(
      `SELECT demo_id, query, market_country, research_language, snapshot_date::text
         FROM screener_demos ORDER BY position`
    );
    return res.rows;
  }

  static async get(demoId: string): Promise<ScreenerDemoSummary & { result: unknown }> {
    const res = await query<ScreenerDemoSummary & { snapshot: unknown }>(
      `SELECT demo_id, query, market_country, research_language, snapshot_date::text, snapshot
         FROM screener_demos WHERE demo_id = $1`,
      [demoId]
    );
    const row = res.rows[0];
    if (!row) throw new EmeradarError(ErrorCode.NOT_FOUND, `Demo not found: ${demoId}`, 404);
    if (!row.snapshot) {
      throw new EmeradarError(ErrorCode.INTERNAL, 'This demo has no frozen snapshot yet.', 503, {
        code: 'DEMO_UNAVAILABLE',
      });
    }
    const { snapshot, ...summary } = row;
    return { ...summary, result: snapshot };
  }
}
