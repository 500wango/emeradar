import { query } from '@emeradar/db';

export type ExternalDemandSource = 'src_volume' | 'src_trends';

/**
 * ev-1.1 外部结果事件的原始序列写入口（06 §7.1a）。
 *
 * 采集器（`src_volume` 词量源、`src_trends` Trends 抓取）只通过这里落库。序列必须从
 * Episode 开始那天起逐日写入：预测日的值事后补采补不回来，缺了就只能记 UNEVALUABLE。
 * 同一 (query, source, date) 重复写入以后者为准，保证采集重试幂等。
 */
export class ExternalDemandService {
  static async record(
    queryId: string,
    source: ExternalDemandSource,
    obsDate: string,
    value: number
  ): Promise<void> {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`external demand value must be a non-negative number, got ${value}`);
    }
    await query(
      `INSERT INTO external_demand_observations (query_id, obs_date, source, value)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (query_id, source, obs_date) DO UPDATE SET value = EXCLUDED.value`,
      [queryId, obsDate, source, value]
    );
  }
}
