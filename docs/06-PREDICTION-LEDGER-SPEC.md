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

**前台的定位（PRD §1.7 第 7 条）**：Merkle 树的角色是**后台不可篡改的存证 + 前台底栏的校验入口**，不是对外的主打卖点。对用户与公开页而言，账本的价值体现在 **Cohort Hit Rate & Accuracy Matrix（公开 Cohort 战绩大盘）** 与**失误复盘（Misses & Post-mortems）** 上——即系统前向追踪的 T+30/60/90 天市场形成命中率、已立项项目的自然排名爬升率，以及明确列出的预测失误。密码学部分面向愿意自行复算的人（§5 公开验证工具），不在营销层反复强调。

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

> **实现与本行不一致（2026-10-12 核对）**：`pipeline.ts` 取的是前一日检查点的
> **`final_row_hash`**（即前一日最后一行的 `row_hash`），不是 `checkpoint_hash`：
> ```ts
> const prevRowHash = prevCkp.final_row_hash || GENESIS_PREV_HASH;
> const prevCheckpointHash = prevCkp.checkpoint_hash || prevRowHash;
> ```
> 两种取法都能自洽，差别只在"跨日链接的是行链还是检查点链"。**此处不改实现** ——
> 改它等于重算整条行链，会让已经对外发布过的每一个默克尔根与 `checkpoint_hash`
> 全部失效，而"可被任何人复算"正是账本存在的理由。已知的代价是：本行按字面读会
> 得到一个与线上账本不符的验证器。
>
> 校验侧的权威口径**就是实现**，且已被 `services/test/admin-ledger-integrity.test.ts`
> 钉住（手工构造一天完好账本 → 重算必须通过）。要收敛这处分歧，只能走"从某一日起
> 切换 + 记账本代次"的路子，属于独立议题。

> **已修复的验证缺陷（2026-10-12）**：`TrackRecordService.verifyCheckpoint` 曾把
> 当日**最后一行**的 `row_hash` 当作 `prev_checkpoint_hash` 传给
> `calculateCheckpointHash`（变量在遍历中被改写）。后果是**账本第一日永远验不过**
> —— 那一天没有前一日检查点，`?? prevRowHash` 落到被污染的值上；前一日
> `checkpoint_hash` 为 NULL 的天同理。公开验证端点 `/api/v1/public/verify-ledger`
> 与后台"账本完整性"面板都走这条路径，也就是说第一天会一直被报成不一致。已改为
> 在遍历前就固定 `prevRowHash` / `prevCheckpointHash`，与 `pipeline.ts` 逐字对应。

> **行哈希的三个版本（2026-10-13 实现）**：`hash_version` 逐行记录写入时用的字段集，
> 复算时**以列为准**，不从数据形状推断。
>
> | 版本 | 字段集 | 写入起点 |
> |------|--------|----------|
> | 1 | 上表 11 个字段 | 存档行 / seed 伪造行 |
> | 2 | v1 + `raw_verdict`、`flags`、`explanation`（含 `rules_triggered`）、`features_hash`、`d_band`、`m_band`、`w_band` | 2026-10-12 之后的管线 |
> | 3 | v2 + `prediction_spec`（判据版本、地平线、目标事件） | 2026-10-13 之后的管线 |
>
> v1/v2 的字段集**从未改动**，所以此前发布过的每一个默克尔根与 `checkpoint_hash`
> 仍然有效；v3 只前向生效。
>
> **已修复的版本塌缩**：`row-data.ts` 曾用
> `Number(hash_version ?? 1) >= 2 ? 2 : 1` 把列映射到字段集 —— 3 会被读成 2。后果
> 不是边界情况而是**新版本上线当天的必然结果**：那一天所有 v3 行按 v2 复算，公开验证
> 端点会对整天报"账本不一致"。现已逐版本枚举，并对 ≥3 的未知版本归到 3（旧验证器
> 无法验证新格式的行，于是如实报"验不过"，而不是静默按另一个字段集复算）。
> `checkpoint.ts` 的形状推断同理：先判 v3 再判 v2。
>
> **`prediction_spec` 为什么必须入哈希**：判据（阈值、地平线、目标事件）原本只活在
> `prediction-episode.service.ts` 的静态常量里。改一个数字，此后所有**尚未评估**的
> 历史 Episode 都会按新判据判定，而它们的记录里仍写着原来的 `eval_spec` 版本 ——
> 账本一个字节都不用改，历史就被重写了。规格入哈希后，这种改动会在复算时暴露
> （用例见 `services/test/ledger-v3-roundtrip.test.ts`）。

> **存量伪造行（2026-10-13 处置）**：早期演示种子
> `packages/db/src/seed-radar-opportunities.ts` 曾用
> `sha256(opp.id|obsDate|verdict|三轴)` 现造 `row_hash`、用 `sha256('genesis_' + opp.id)`
> 充当 `prev_hash`，把演示数据写进 `verdicts`。那不是"近似真实"：`prev_hash` 不指向
> 当日上一行，`row_hash` 也不是 `calculateRowHash` 的结果，因此这些行**不可复算**，
> 一旦与某天的真实产出同处一个 `obs_date`，那一天的账本会整体验不过。
>
> 现在的口径：**可复验纪元自第一条由管线写入的 `hash_version >= 2` 行起**。本地库里
> 那 38 行 `hash_version = 1` 的演示行（`prev_hash` 无一指向同机会的其它行）不属于
> 任何已发布的账本 —— `ledger_checkpoints` 为空，故没有任何默克尔根需要它们。种子
> 已不再写 `verdicts`，并加了 `EMERADAR_SEED_DEMO=1` 的显式开关（它写入的观测会被
> 管线当作真实输入，所以不能"能跑就跑"）。

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

**公开验证工具**：提供脚本与文档，任何人可下载某日全部 Verdict 的公开摘要，重算 Merkle 根并与已公开值对比。

**公开投影的资格判据（准实时精选，PRD §7.1）**：旧的「45 天延迟公开」方案已**彻底废除**。一条机会进入公开投影的唯一途径，是它**已经失去抢跑价值**：

1. **刚刚满足 `CROWDED_LOCKED`**——全部形态槽位（`Σ opportunity_slots.claimed == Σ capacity`，ADR-018）被认领满额；或
2. **刚进入 `WINDOW_CLOSING`**——此前已发布过 `BUILD_NOW` / `EARLY_BET` 且 W 档在 14 天内下降 ≥ 1 档（05 §5.1 的三个必要条件）。

**硬性排除**：仍有余槽的黄金 `BUILD_NOW`（空槽可认领）**严禁**进入公开投影，防止背刺付费 Pro 用户（PRD §1.7 第 6 条、§7.1）。入选凭据（当时凭 `CROWDED_LOCKED` 还是 `WINDOW_CLOSING`、槽位状态）随页面写 `public_pages.eligibility`（03 §15），使"为什么这条能被免费用户看到"事后可复核。

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

### 6.1 Sealed Ledger（买断项目的计入与打码，PRD §1.7 第 7 条 / ADR-018）
被用户通过 `Stealth Lock`（`stealth_locks`，03 §12）独占买断的机会，**照常写入 `verdicts` 账本、照常生成 `prediction_episodes`，并计入 Cohort 胜率统计**——买断改变的是曝光，不是事实。

- **保护期内的展示**：在 60 天独占保护期内，公开投影（15）把该 Episode 的关键词与实体**打码为 `[Stealth Locked #ID]`**；保护期满（`stealth_locks.unlock_at`）后**自动解密**，公开具体词根。
- **账本与展示解耦**：打码是**投影层行为**，不是对账本的改写——原 `verdicts` 行与 `prediction_episodes` 行从未被修改，打码别名单独存于 `stealth_lock_displays`（03 §15），且 `unmasked_at` 与 `stealth_locks.unlock_at` 严格一致（03 I14）。
- **封印不损害"可证伪"**：因为账本行完整保留、命中与失误的分类不因打码而改变，任何人都能在保护期满后复算这条预测当时对不对。若打码会移除样本、或让胜率统计只挑好的公开，账本的可信度才真正受损——本设计刻意避免这一点。
- **与公开验证的一致性**：§11 的 `public.track_record_episodes` 在保护期内保留该 Episode（参与汇总分子分母），仅其 `title_original` / 关键词字段替换为打码标签。

## 7. 评估规格（`eval_spec = ev-1.0`）

评估规格版本化并**预先固定**（在观测结果前写定），变更即新版本，历史评估保留。

> **已实现（2026-10-13）**：这条此前只是一句承诺 —— 规格的阈值活在
> `prediction-episode.service.ts` 的类静态常量里（`NEW_QUERY_THRESHOLD = 10`、
> `CLUSTER_EXPANSION_MULTIPLIER = 1.5`、`W_LOW_BASIS_POINTS = 4500`、
> `WINDOW_CLOSE_EVIDENCE_THRESHOLD = 3`），评估时才现读。把 `10` 改成 `5`，此后所有
> **尚未评估**的历史 Episode 都按新阈值判定，而它们记录里的 `eval_spec` 版本号一字未改
> —— 没有异常、没有日志、账本无需 UPDATE，历史就被重写了。
>
> 现在两处并存：
> - `prediction_episodes.criteria_version` + `criteria_snapshot`：开 Episode 时把**当下
>   生效的整份规格**（含阈值）写死。它受 `prevent_episode_rewrite()` 保护，与
>   `predicted_at` 同级不可改写。
> - `verdicts.prediction_spec`（`hash_version = 3`）：同一份规格的精简三元组
>   （判据版本、地平线、目标事件）随裁决行入哈希，因此改规格这件事本身会在账本复算时
>   暴露（§4.2）。
>
> 评估器 (`evaluateDueEpisodes`) **只读 Episode 自己的快照**，并把判据来源写进
> `metrics.criteriaSource`：`snapshot` = 按它被预测时的判据判的，
> `active-spec-fallback` = 该 Episode 早于本功能、按当前规格补判的。回填 `NULL` 快照
> 等于替它声称一个从未记录过的判据，所以不做 —— 让"补判"这件事留下痕迹。
> 判据中的 `horizons` 决定评估哪几档（与固定的 `outcome_30d/60d/90d` 取交集）。

### 7.1 事件定义
| 事件 | 定义（初始值） |
|------|----------------|
| `cluster_expansion` | 预测日后第 h 天，簇的 `active_7d` ≥ 预测日值 × 1.5 |
| `sustained_new_queries` | `(start, start+h]` 内基线期后的新增簇 query ≥ 10 |
| `attention_persistence` | 第 h 天注意力源活跃数 ≥ 预测日值 |
| **`market_formed`** | `cluster_expansion` ∧ `sustained_new_queries` |
| **`window_closed`** | 第 h 天 W 档为 `LOW`，或窗口内 `e_specialist + e_authoritative ≥ 3` |
| **`verified_launch_within_7d`**（Builder 结果） | 机会点击 GO 后 **7 天内**，用户回填的 3 类上线凭证之一（独立域名 URL / 应用商店详情页 URL / 公开的 GitHub Release 或着陆页 URL，PRD F10）通过服务端 HTTP 探针核验（`<title>` / `<h1>` / `<meta>` 与机会主题相关） |
| **`serp_top100_within_30d`**（Builder 结果） | 已核验项目在 **30 天内**由 F1 的 Top 100 快照**内存匹配**首次观测到进入自然搜索 Top 100（`project_serp_rankings.best_rank ≤ 100`，03 §12）。**数据来自自身 SERP 管线，不依赖 GSC**（F1 一鱼多吃、F10） |
| `gsc_traction`（**可选增强，非必选**） | 仅供**自愿连接 GSC** 的项目：关联项目上线后 90 天内目标关键词累计曝光 ≥ `traction_impressions`（默认 1,000）且至少有点击。未连接 GSC 的项目此事件为 `pending`，**不得**因此判为失败 |

评估地平线 `h ∈ {30, 60, 90}`。Builder 结果类事件只在**存在已核验 Project** 的 Episode 上评估；`market_formed` / `window_closed` 等需求与竞争事件不要求用户授权任何外部数据。

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
- Builder-outcome 指标在关联项目 < 30 个前仅内部使用。**可对外发布的两个口径**是 `verified_launch_within_7d`（7 天凭证核验通过率）与 `serp_top100_within_30d`（30 天 Top 100 入榜率）——两者都由自身 SERP 管线与 HTTP 探针产生，**无需用户 GSC**（PRD §3.3、Gate 1）。`gsc_traction` 只在连接了 GSC 的**子集**上单独报告，样本与前者隔离，绝不与之混算或作为对外必报项。
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

`public.track_record_episodes`（public projection，只含**满足准实时精选资格**（`CROWDED_LOCKED` 或 `WINDOW_CLOSING`，§5）或**已进入买断打码**（§6.1）的机会）：

| 字段 | 说明 |
|------|------|
| `episode_id` `opportunity_slug` `title_original` | 标识（买断保护期内 `title_original` 为打码标签 `[Stealth Locked #ID]`） |
| `market_country` `research_language` | 市场 |
| `verdict_class` `start_date` `end_date` | Episode |
| `verdict_at_start` 三轴分档 `confidence` | 当时状态 |
| `first_observed_at` | 首次观测 |
| `outcome_30d / 60d / 90d` | `market_formed` `window_closed`（true / false / pending） |
| `is_stealth_masked` `masked_label` `unmasked_at` | 是否处于买断打码期、打码标签、自动解密时刻（03 §15 `stealth_lock_displays`） |
| `ledger_checkpoint_hash` | 起始日 checkpoint，供验证 |
| `is_override` | 是否含人工调整 |

Builder-outcome 列（供公开战绩页）：`launch_verified_7d`（bool / pending）、`serp_top100_30d`（bool / pending），分别对应 §7.1 的 `verified_launch_within_7d` 与 `serp_top100_within_30d`，均不读 GSC。

汇总统计（`public.track_record_summary`）：Episode 总数、已评估数、按 Verdict 的命中率、提升倍数（样本充足时）、窗口存活中位数、**7 天凭证核验通过率与 30 天 Top 100 入榜率**（样本充足时）、更新时间。买断打码的 Episode（§6.1）计入分子与分母，不打折统计口径。

**这一节是买断最集中的泄露面，两个方向都要做对**：

- Episode 的 `opportunity_title` / `opportunity_slug` 直接来自 `opportunities` 表，**打码必须做在这一层**（读 Episode 的服务里），不是在做响应的路由里——路由只是透传，改它等于没改。
- `prediction_episodes` 表里没有标题列，所以 `masked_label` 只能从 `stealth_lock_displays` join 出来（03 §15）。这也是该表**必须存在且必须被读**的原因：它是唯一一处能保证"只打一次码"的地方。
- 方向相反的第二个错误是**剔除**：少一行就是买断者用钱买走了平台的败绩，而战绩页会因此系统性偏乐观——这正是 §6.1 与 15 §3.1 第 2 条要防的事，15 §8 把它列为 100% 的 0 容忍指标。

## 12. 失败与告警
| 事件 | 级别 | 处置 |
|------|------|------|
| 哈希链验证失败 | P0 | 冻结公开发布；对比对象存储备份；取证 |
| 日账本缺失 | P1 | 补跑并标注 `backfilled`；公开页显示缺口 |
| Checkpoint 未在 07:00 UTC 前发布 | P2 | 重试；连续 2 日失败升级 |
| 重算抽检不一致 | P0 | 冻结相关配置；定位非确定性来源 |
