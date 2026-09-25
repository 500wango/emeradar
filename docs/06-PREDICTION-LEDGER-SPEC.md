# 06 — 预测账本、回测与战绩规格

Status: Draft ｜ 依赖：03、05 ｜ 被依赖：15

## 1. 目的
预测账本是产品可信度的基础：**每天记录系统当时相信什么，事后证明对错，且任何人无法悄悄改写。** 它同时服务四个用途：

| 用途 | 使用方式 |
|------|----------|
| 验证假设 H1 | 按 §10 评估规格计算命中率与提升 |
| 校准评分 | 对比不同 `scoring_config` 的历史表现 |
| 战绩页 | 公开命中与失误（15） |
| 用户侧 Replay | 选择历史日期查看当时状态（Phase 2） |

## 2. 数据流

```text
S5 Score ──▶ S6 Ledger Append ──▶ verdicts (append-only)
                                     │
                                     ├──▶ ledger_checkpoints（每日 Merkle 根 + 链式哈希）
                                     └──▶ Outcome Evaluator（T+30/60/90）──▶ outcome_evaluations
                                                               │
                                                               └──▶ Track Record projection（15）
```

## 3. 写入规则
1. 每个 `TRACKED` 机会每个 `obs_date` 至多写 1 条系统 Verdict（03 I2）。
2. 写入内容包含：三轴分档与分数、`raw_verdict`、`verdict`、`lifecycle`、`flags`、`scoring_config_version`、`input_snapshot_ids`、`features_hash`、`explanation`。
3. 写入分两段：S5（可并发、多 Worker 分片）将计算结果写入 `verdicts_pending`（无排序约束）；S6（单一 Worker，`pg_advisory_lock` 保证同一 `obs_date` 全局唯一执行）读取当日全部暂存行，按 `opportunity_id` 排序后串行计算哈希链，批量写入 `verdicts` 并清空暂存表（详见 02 §5 ADR-014）。`verdicts` 的写入由独立数据库角色 `ledger_writer` 完成；应用其他角色（含 `apps/web`）对 `verdicts` 只读。
4. 管线失败导致某日缺失：写入 `MISSING` 标记行（`ledger_gaps` 表或 checkpoint 中的 `missing` 列表），**不得事后补写并伪装成当日产出**；补跑产生的记录以 `computed_at` 明示，且带 `backfilled = true`，不参与战绩统计。
5. 人工 Override 以新行写入（05 §9），不改写原行。

## 4. 哈希链与 Checkpoint

### 4.1 规范化
- 序列化：JSON Canonicalization Scheme（RFC 8785）。
- 参与哈希的字段：除 `row_hash`、`computed_at` 外的全部列。

### 4.2 行哈希
```text
row_hash = SHA-256( prev_hash ‖ JCS(row_without_row_hash) )
```
- 同一 `obs_date` 内按 `opportunity_id` 升序串联；
- 每日第一行的 `prev_hash` = 前一日 checkpoint 的 `checkpoint_hash`；账本第一日为 32 字节零值的十六进制。

### 4.3 每日 Checkpoint
```text
merkle_root     = MerkleRoot( [row_hash…]，按 opportunity_id 排序，叶/节点哈希按 RFC 6962 前缀规则 )
checkpoint_hash = SHA-256( prev_checkpoint_hash ‖ obs_date ‖ row_count ‖ merkle_root )
```
- 写入 `ledger_checkpoints`；
- **公开发布** `(obs_date, row_count, merkle_root, checkpoint_hash)`（Track Record 页 + 静态 JSON），不含机会明细；
- 可选：把 `checkpoint_hash` 提交给外部可信时间戳服务（RFC 3161），回执存入 `external_timestamp`，以证明"不晚于某时刻存在"。

## 5. 不变量与验证

| 不变量 | 强制 / 验证 |
|--------|-------------|
| 应用角色无 `UPDATE / DELETE`；触发器拒绝对 `verdicts` 的修改 | 03 I1 |
| 行哈希链可从头重验 | **夜间全链验证任务**：从最近一次已验证 checkpoint 起重算；不一致 → P0 告警 |
| Checkpoint 与已公开值一致 | 发布后每日比对 |
| 每个 Verdict 的 `input_snapshot_ids` 存在且不可变 | 03 I4 |
| 随机重算一致 | 05 §8：每日抽 1% 重算并比对 |

**公开验证工具**：提供脚本与文档，任何人可下载某日全部 Verdict 的公开摘要，重算 Merkle 根并与已公开值对比（仅对已公开延迟的机会开放，见 15）。

## 6. 战绩的口径：Episode
连续多日的同一 Verdict 高度相关，直接按日统计会夸大样本量。统计单位为 **Episode**：

```text
Episode = (opportunity_id, verdict_class, start_date)
  verdict_class ∈ { BUILD_NOW, EARLY_BET, WINDOW_CLOSING }（及 WATCH 用于基线对比）
  start_date    = 该机会首次进入该 Verdict 类别的 obs_date
  end_date      = 离开该类别的 obs_date（进行中则为空）
```
- 每个 Episode 只在 `start_date` 计一次预测，评估锚定到 `start_date`。
- 同一机会离开后再次进入，算新 Episode，但两次进入间隔 < 14 天视为同一 Episode。

## 7. 评估规格（`eval_spec = ev-1.0`）

评估规格版本化并**预先固定**（在观测结果前写定），变更即新版本，历史评估保留。

### 7.1 事件定义
| 事件 | 定义（初始值） |
|------|----------------|
| `cluster_expansion` | 预测日后第 h 天，簇的 `active_7d` ≥ 预测日值 × 1.5 |
| `sustained_new_queries` | `(start, start+h]` 内基线期后的新增簇 query ≥ 10 |
| `attention_persistence` | 第 h 天注意力源活跃数 ≥ 预测日值 |
| **`market_formed`** | `cluster_expansion` ∧ `sustained_new_queries` |
| **`window_closed`** | 第 h 天 W 档为 `LOW`，或窗口内 `e_specialist + e_authoritative ≥ 3` |
| **`gsc_traction`**（Builder 结果） | 关联项目上线后 90 天内，目标关键词累计曝光 ≥ `traction_impressions`（默认 1,000）且至少有点击 |

评估地平线 `h ∈ {30, 60, 90}`。

### 7.2 基线
| 基线 | 构造 |
|------|------|
| B0 随机 | 同宇宙、同 `start_date` 队列（cohort）、同数量的随机 TRACKED 机会 |
| B1 趋势榜 | 同宇宙内 `trends_slope_90d` 最高的同数量机会（趋势数据可用时） |
| B2 朴素启发式 | 同宇宙内仅按 `new_queries_7d` 排序取同数量 |

B2 用于证明复合评分比"简单启发式"确有增益。

### 7.3 指标
- `precision@K`（`K = 10`，按日 Top-K Episode）：`market_formed` 命中率。
- **提升（lift）** = 命中率 / 基线命中率。
- **召回**：全宇宙中最终 `market_formed` 的机会里，在形成前 ≥ 30 天已处于 `BUILD_NOW` / `EARLY_BET` 的比例。
- **窗口存活时间**：`BUILD_NOW` / `EARLY_BET` Episode 至 `window_closed` 的天数分布（Kaplan–Meier，含右删失）。
- **校准**：按 Verdict 类别分组的命中率，检验 `BUILD_NOW ≥ EARLY_BET ≥ WATCH`。
- `WINDOW_CLOSING` 的精度：其后 30 天 `window_closed` 比例。

### 7.4 统计规则
- 置信区间：按机会聚类的 bootstrap（10,000 次），报告 95% CI。
- 最小样本：单个指标的 Episode 数 < 100 时，标注"样本不足"，不得在公开页给出提升倍数。
- 不做事后挑选：只报告 `eval_spec` 中预先定义的指标与地平线。
- Builder-outcome（`gsc_traction`）在关联项目 < 30 个前仅内部使用。
- 报告必须同时给出命中与失误清单。

## 8. Outcome Evaluator
- 每日任务：找出满足 `start_date + h ≤ 今日` 且尚无评估记录的 Episode，计算事件并写 `outcome_evaluations`。
- **幂等**：`(verdict_id, horizon_days, eval_spec_version)` 唯一。
- 计算只读快照与 Evidence，不读账本以外的可变状态；使用 point-in-time 查询（`obs_date` 上界）。
- 评估任务失败不影响账本写入。

## 9. 回测（配置变更用）
回测用于评估新 `scoring_config`，**不使用账本，而用快照重算**：

```text
for each obs_date in [T0, T1]:
   features = buildFeatures(snapshots as-of obs_date)      # 严格 as-of
   output   = score(features, candidateConfig)
compare(candidate outputs vs. ACTIVE ledger outputs) on §7 指标
```
要求：
- **无前视**：特征构建器只能读取 `observed_at ≤ obs_date` 的数据；CI 有专门测试（注入未来数据，输出必须不变）。
- 回测窗口内，`start_date + 90` 已过期的 Episode 才可评估 T+90 指标。
- 回测报告固定包含：Verdict 分布变化、Episode 数变化、§7 指标（含 CI）、逐机会差异样本 50 条。
- 晋升条件见 05 §7.2。

## 10. Phase 0 验证计划（H1）

| 周 | 动作 |
|----|------|
| 1–2 | 采集管线与账本上线；冻结 `sc-1.0.0` 与 `ev-1.0` |
| 2–8 | 每日预测写账本；同期若有历史可重建的数据（如 Trends 历史）做代理回测 |
| 6–8 | 首批 Episode 到达 T+30，产出首份评估报告 |
| Gate 0 | H1 通过线：Top-decile 的 `market_formed` 命中率 ≥ 基线 3×（且 B2 上有显著增益），或给出信号修正方案 |

**冷启动说明**：真正的 T+60/T+90 评估必须等待时间流逝，Phase 0 周期只覆盖 T+30。Gate 0 判定以 T+30 数据 + 代理回测为依据，T+60/T+90 结果在 Phase 1 期间补齐并在 Gate 1 复核。

## 11. Track Record 数据契约（供 15 使用）

`public.track_record_episodes`（public projection，只含满足延迟规则的机会）：

| 字段 | 说明 |
|------|------|
| `episode_id` `opportunity_slug` `title_original` | 标识 |
| `market_country` `research_language` | 市场 |
| `verdict_class` `start_date` `end_date` | Episode |
| `verdict_at_start` 三轴分档 `confidence` | 当时状态 |
| `first_observed_at` | 首次观测 |
| `outcome_30d / 60d / 90d` | `market_formed` `window_closed`（true / false / pending） |
| `ledger_checkpoint_hash` | 起始日 checkpoint，供验证 |
| `is_override` | 是否含人工调整 |

汇总统计（`public.track_record_summary`）：Episode 总数、已评估数、按 Verdict 的命中率、提升倍数（样本充足时）、窗口存活中位数、更新时间。

## 12. 失败与告警
| 事件 | 级别 | 处置 |
|------|------|------|
| 哈希链验证失败 | P0 | 冻结公开发布；对比对象存储备份；取证 |
| 日账本缺失 | P1 | 补跑并标注 `backfilled`；公开页显示缺口 |
| Checkpoint 未在 07:00 UTC 前发布 | P2 | 重试；连续 2 日失败升级 |
| 重算抽检不一致 | P0 | 冻结相关配置；定位非确定性来源 |
