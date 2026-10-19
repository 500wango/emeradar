/**
 * 离线回测（Phase 3）：只读，不改线上 Gate。
 *
 * 规则：
 *   1. **预注册**：阈值网格与成本矩阵写在 `GRID`，不允许看了结果再改；
 *   2. **时间切分**：按 obs_date 排序，前 70% 训练 / 后 30% 验证，避免用未来数据选阈值；
 *   3. 输出 Precision / Recall / FNR / 成本，每项带 95% 置信区间；
 *   4. 只打印 `SHADOW` 建议，**绝不写回线上配置**。改线上必须走
 *      DRAFT → SHADOW ≥14 天 → 人工批准。
 *
 * 用法：
 *   pnpm --filter @emeradar/services exec tsx src/scripts/backtest-gate.ts [horizon]
 */
import { labelDataset, type LabelDatasetRow } from '../outcome-label.service';
import { query } from '@emeradar/db';

/** 预注册网格：D 轴历史天数门槛。 */
const GRID = [7, 10, 14, 21, 30] as const;
/** 每多观测一天的成本（Autocomplete + SERP + crawl 的边际成本，USD）。 */
const COST_PER_DAY_USD = 0.02;
/** 漏判一个真机会的机会成本（缺省 1.0 只是相对权重，不是真实货币）。 */
const MISS_COST_UNITS = 1.0;
const TRAIN_RATIO = 0.7;

function wilson(successes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 0];
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (centre - spread) / denominator), Math.min(1, (centre + spread) / denominator)];
}

interface Metrics {
  threshold: number;
  predictedPositive: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
  fnr: number | null;
  precisionCi: [number, number];
  fnrCi: [number, number];
  costUnits: number;
}

function evaluate(rows: LabelDatasetRow[], threshold: number): Metrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const row of rows) {
    // 预测规则：该词的历史观测天数是否达到门槛。
    const days = Number((row.features as any).history_days ?? 0);
    const predicted = days >= threshold;
    const actual = row.label === 'POSITIVE';
    if (predicted && actual) tp++;
    else if (predicted && !actual) fp++;
    else if (!predicted && actual) fn++;
    else tn++;
  }
  const predictedPositive = tp + fp;
  const actualPositive = tp + fn;
  const precision = predictedPositive > 0 ? tp / predictedPositive : null;
  const recall = actualPositive > 0 ? tp / actualPositive : null;
  const fnr = actualPositive > 0 ? fn / actualPositive : null;
  return {
    threshold,
    predictedPositive,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    precision,
    recall,
    fnr,
    precisionCi: wilson(tp, predictedPositive),
    fnrCi: wilson(fn, actualPositive),
    costUnits: predictedPositive * threshold * COST_PER_DAY_USD + fn * MISS_COST_UNITS,
  };
}

function fmt(value: number | null): string {
  return value === null ? '—' : (value * 100).toFixed(1) + '%';
}

async function main() {
  const horizon = (Number(process.argv[2]) || 60) as 30 | 60 | 90;
  const rows = await labelDataset({ horizonDays: horizon });
  if (rows.length === 0) {
    console.log(`[backtest] no labels for T+${horizon}. Labels accumulate over time; nothing to calibrate yet.`);
    await query('SELECT 1');
    return;
  }

  const sorted = rows.filter((row) => row.obsDate).sort((a, b) => a.obsDate.localeCompare(b.obsDate));
  const split = Math.floor(sorted.length * TRAIN_RATIO);
  const train = sorted.slice(0, split);
  const valid = sorted.slice(split);

  console.log(`[backtest] horizon=T+${horizon} samples=${sorted.length} train=${train.length} valid=${valid.length}`);
  console.log(`[backtest] positives: train=${train.filter((r) => r.label === 'POSITIVE').length} valid=${valid.filter((r) => r.label === 'POSITIVE').length}`);
  console.log('[backtest] threshold |  valid precision (95% CI) | valid recall | valid FNR (95% CI) | cost');
  for (const threshold of GRID) {
    const m = evaluate(valid, threshold);
    console.log(
      `  ${String(threshold).padStart(2)} | ${fmt(m.precision)} [${fmt(m.precisionCi[0])}, ${fmt(m.precisionCi[1])}]` +
        ` | ${fmt(m.recall)} | ${fmt(m.fnr)} [${fmt(m.fnrCi[0])}, ${fmt(m.fnrCi[1])}] | ${m.costUnits.toFixed(2)}`
    );
  }

  // 只写 DRAFT 提案，**绝不改线上配置**。人工批准后由人改代码、发版，再进 SHADOW。
  const feasible = GRID.map((threshold) => evaluate(valid, threshold)).filter(
    (m) => m.predictedPositive > 0 || valid.length === 0
  );
  const best = feasible.sort((a, b) => a.costUnits - b.costUnits)[0];
  if (best) {
    const current = Math.max(...GRID);
    if (best.threshold !== current) {
      await query(
        `INSERT INTO scoring_config_proposals
           (status, parameter, current_value, proposed_value, horizon_days, sample_size,
            metrics, backtest_rule_version, rationale)
         VALUES ('DRAFT','D_BASELINE_DAYS',$1,$2,$3,$4,$5,$6,$7)`,
        [
          String(current),
          String(best.threshold),
          horizon,
          sorted.length,
          JSON.stringify({ train: train.length, valid: valid.length, best }),
          'backtest-v1',
          `lowest costUnits (${best.costUnits.toFixed(2)}) among the preregistered grid on the validation split`,
        ]
      );
      console.log('');
      console.log('[backtest] DRAFT proposal recorded (NOT applied):');
      console.log(`  D_BASELINE_DAYS ${current} -> ${best.threshold} (costUnits ${best.costUnits.toFixed(2)})`);
    }
  }
  console.log('');
  console.log('[backtest] next steps (all human):');
  console.log('  - review the DRAFT proposal, set SHADOW, observe >=14 days, then approve or reject;');
  console.log('  - 300-500 T+90 samples across 5 thresholds will overfit; require a larger sample or fewer thresholds.');
}

main().catch((error) => {
  console.error('[backtest] failed:', error);
  process.exitCode = 1;
});
