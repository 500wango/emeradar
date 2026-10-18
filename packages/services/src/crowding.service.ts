import { query } from '@emeradar/db';

/**
 * 拥挤透明度（01 §5.9、05 §3.3、10 §2）。
 *
 * 三个计数**都不是**评分输入：它们只服务展示、生命周期
 * （`EARLY_WINDOW → CONTESTED`）与 `CROWDING_SIGNAL` 告警。v3.1 已明确它们不得
 * 写回 W，也不得触发 `WINDOW_CLOSING`。
 *
 * 数据来源：
 * - `verified_product_count`：映射到该机会、凭证为 `VERIFIED_OWNER` 且未归档的
 *   独立项目数（05 §3.3 的定义；归档项目不再算当前竞争）。
 * - `top10_specialist_count`：主查询最新 SERP 快照里 `result_type='SPECIALIST'`
 *   的前 10 名条数。
 * - `new_top10_entrants_30d`：当前 Top10 的独立域名中，在最新观测日往前 30 天
 *   **之前**从未进入过该机会 Top10 的数量（即近 30 天首次出现的独立站）。
 *   观测历史不足 30 天时，当前 Top10 都算"近 30 天内首次观测到"——这是如实
 *   反映"我们看见它第一次进来"，而不是把缺失的基线当成 0。
 */
export interface CrowdingSnapshot {
  verifiedProductCount: number;
  top10SpecialistCount: number;
  newTop10Entrants30d: number;
}

export interface CrowdingRow extends CrowdingSnapshot {
  obsDate: string;
}

/**
 * 计算一条机会当日的拥挤度。没有主查询/SERP 快照时，两个 SERP 计数为 0；
 * `verified_product_count` 仍然独立可算（它只依赖项目凭证）。
 */
export async function computeCrowding(opportunityId: string): Promise<CrowdingSnapshot> {
  const verifiedRes = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT p.id)::int AS count
       FROM projects p
      WHERE p.opportunity_id = $1
        AND p.credential_status = 'VERIFIED_OWNER'
        AND p.status <> 'ARCHIVED'`,
    [opportunityId]
  );
  const verifiedProductCount = verifiedRes.rows[0]?.count ?? 0;

  const latestRes = await query<{ id: string; obs_date: string }>(
    `SELECT ss.id, ss.obs_date::text AS obs_date
       FROM serp_snapshots ss
       JOIN opportunity_queries oq ON oq.query_id = ss.query_id AND oq.role = 'PRIMARY'
      WHERE oq.opportunity_id = $1
      ORDER BY ss.obs_date DESC
      LIMIT 1`,
    [opportunityId]
  );
  const latest = latestRes.rows[0];
  if (!latest) {
    return { verifiedProductCount, top10SpecialistCount: 0, newTop10Entrants30d: 0 };
  }

  const specialistRes = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM serp_results
      WHERE serp_snapshot_id = $1 AND rank <= 10 AND result_type = 'SPECIALIST'`,
    [latest.id]
  );
  const top10SpecialistCount = specialistRes.rows[0]?.count ?? 0;

  // 当前 Top10 里，在 latest.obs_date - 30 天之前从未出现过的独立域名。
  const entrantsRes = await query<{ count: number }>(
    `WITH today AS (
       SELECT DISTINCT domain FROM serp_results
        WHERE serp_snapshot_id = $1 AND rank <= 10
     )
     SELECT COUNT(*)::int AS count
       FROM today t
      WHERE NOT EXISTS (
        SELECT 1
          FROM serp_results sr
          JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
          JOIN opportunity_queries oq ON oq.query_id = ss.query_id AND oq.role = 'PRIMARY'
         WHERE oq.opportunity_id = $2
           AND sr.rank <= 10
           AND sr.domain = t.domain
           AND ss.obs_date < ($3::date - INTERVAL '30 days')
      )`,
    [latest.id, opportunityId, latest.obs_date]
  );
  const newTop10Entrants30d = entrantsRes.rows[0]?.count ?? 0;

  return { verifiedProductCount, top10SpecialistCount, newTop10Entrants30d };
}

/** 把当日拥挤度写进 `crowding_daily`（同一机会同一天重复观测是幂等的）。 */
export async function storeCrowding(
  opportunityId: string,
  obsDate: string,
  snapshot: CrowdingSnapshot
): Promise<void> {
  await query(
    `INSERT INTO crowding_daily (
       opportunity_id, obs_date, verified_product_count, top10_specialist_count, new_top10_entrants_30d
     ) VALUES ($1, $2::date, $3, $4, $5)
     ON CONFLICT (opportunity_id, obs_date) DO UPDATE SET
       verified_product_count = EXCLUDED.verified_product_count,
       top10_specialist_count = EXCLUDED.top10_specialist_count,
       new_top10_entrants_30d = EXCLUDED.new_top10_entrants_30d`,
    [
      opportunityId,
      obsDate,
      snapshot.verifiedProductCount,
      snapshot.top10SpecialistCount,
      snapshot.newTop10Entrants30d,
    ]
  );
}

/** 读某机会某天的拥挤度；没有当日行时返回 null（调用方必须显式处理）。 */
export async function loadCrowding(opportunityId: string, obsDate: string): Promise<CrowdingRow | null> {
  const res = await query<{
    obs_date: string;
    verified_product_count: number;
    top10_specialist_count: number;
    new_top10_entrants_30d: number;
  }>(
    `SELECT obs_date::text AS obs_date, verified_product_count, top10_specialist_count, new_top10_entrants_30d
       FROM crowding_daily
      WHERE opportunity_id = $1 AND obs_date = $2::date`,
    [opportunityId, obsDate]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    obsDate: row.obs_date,
    verifiedProductCount: row.verified_product_count,
    top10SpecialistCount: row.top10_specialist_count,
    newTop10Entrants30d: row.new_top10_entrants_30d,
  };
}
