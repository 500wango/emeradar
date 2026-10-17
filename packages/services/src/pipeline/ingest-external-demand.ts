import { query } from '@emeradar/db';
import { ExternalDemandCollector, credentialsFromEnv } from '@emeradar/collectors';
import { ExternalDemandService } from '../external-demand.service';

export interface ExternalDemandIngestResult {
  skipped: boolean;
  reason?: string;
  queries: number;
  volumePoints: number;
  trendsPoints: number;
  failures: number;
}

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * 逐日写入 ev-1.1 的两路外部序列（06 §7.1a）。
 *
 * 范围只取「有未结 Episode 的机会」的主词：序列只为评估服务，没有 Episode 就没有
 * 评估对象，不该为它们花钱。没配凭证就整体跳过并如实报告 —— 不写任何占位值，缺失会让
 * 评估记 UNEVALUABLE，这是对的；写 0 才是错的。
 *
 * 词量按月更新，所以只取最近一个月的值，写在该月 1 日；Trends 每次重取预测日前
 * 28 天到今天的整段，因为 Trends 的 0–100 只在同一次请求内可比。
 */
export async function ingestExternalDemand(
  obsDate: string,
  collector: ExternalDemandCollector | null = (() => {
    const creds = credentialsFromEnv();
    return creds ? new ExternalDemandCollector(creds) : null;
  })()
): Promise<ExternalDemandIngestResult> {
  if (!collector) {
    return { skipped: true, reason: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set', queries: 0, volumePoints: 0, trendsPoints: 0, failures: 0 };
  }

  const targets = await query<{ query_id: string; query_text: string; first_predicted: string }>(
    `SELECT q.id AS query_id, q.query_text, MIN(e.predicted_at)::text AS first_predicted
       FROM prediction_episodes e
       JOIN opportunity_queries oq ON oq.opportunity_id = e.opportunity_id AND oq.role = 'PRIMARY'
       JOIN queries q ON q.id = oq.query_id
      WHERE e.outcome_30d = 'PENDING' OR e.outcome_60d = 'PENDING' OR e.outcome_90d = 'PENDING'
      GROUP BY q.id, q.query_text`
  );

  const result: ExternalDemandIngestResult = {
    skipped: false,
    queries: targets.rows.length,
    volumePoints: 0,
    trendsPoints: 0,
    failures: 0,
  };
  if (targets.rows.length === 0) return result;

  const volume = await collector.fetchVolume(targets.rows.map((t) => t.query_text));
  if (!volume) result.failures++;
  for (const target of targets.rows) {
    const series = volume?.get(target.query_text);
    const latest = series?.[series.length - 1];
    if (latest) {
      await ExternalDemandService.record(target.query_id, 'src_volume', latest.date, latest.value);
      result.volumePoints++;
    }

    const trends = await collector.fetchTrends(target.query_text, addDays(target.first_predicted, -28), obsDate);
    if (!trends) {
      result.failures++;
      continue;
    }
    for (const point of trends) {
      await ExternalDemandService.record(target.query_id, 'src_trends', point.date, point.value);
      result.trendsPoints++;
    }
  }
  return result;
}
