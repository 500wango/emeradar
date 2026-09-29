# 05 — 评分与决策规格（Scoring Config Spec）

Status: Draft ｜ 依赖：01 §5、03 ｜ 被依赖：06、07、12、16

本文定义三轴、置信度、Verdict、生命周期如何由**确定性纯函数**和**版本化配置**计算。所有数值为 `sc-1.0.0` 的**初始值**，须在 Phase 0 校准。

## 1. 总则
1. 评分包 `@app/scoring` 无 IO、无当前时间读取、无随机数、无 LLM 调用。
2. 输入 = `ScoringInput`（features + 上一日状态 + 配置）；输出 = `ScoringOutput`（三轴、Verdict、生命周期、解释轨迹）。
3. 同一 `ScoringInput` 必得同一 `ScoringOutput`（bit-for-bit，含浮点：统一使用定点四舍五入到 2 位后比较）。
4. 时间点正确性（point-in-time）：`features` 只能使用 `observed_at ≤ obs_date 23:59:59Z` 的数据；禁止前视。
5. 每个结论附 `explanation`：命中的规则、输入值、阈值，UI 用它渲染评分分解（不需要 LLM）。

## 2. 宇宙与预处理

- **宇宙（universe）**：同一 `(market_country, research_language)` 下，`status = TRACKED` 且 `history_days ≥ 14` 的全部机会。
- `history_days`：机会主 query 首次观测至 `obs_date` 的天数。
- **百分位**：`percent_rank` 在宇宙内计算，范围 0–100，并列取平均秩。
- **基线期**：机会主 query 的 `first_observed_at + 14d` 之前观测到的 query，不计入"新增 query"类特征。
- 宇宙大小 < `min_universe_size`（默认 200）时，D 轴百分位失去意义，D 轴统一为 `INSUFFICIENT` 并标 `PARTIAL_DATA`。

## 3. 特征定义

令 `C` 为 `obs_date` 时机会的簇 query 集合（`opportunity_queries`）。

### 3.1 D 轴特征
| 特征 | 定义 |
|------|------|
| `cluster_size` | `C` 中最近 30 天内被观测到的 query 数 |
| `new_queries_7d` | `first_observed_at ∈ (t−7d, t]` 且在基线期之后的 query 数 |
| `cluster_growth_30d` | `active_7d(t) / max(1, active_7d(t−30d)) − 1`，`active_7d(x)` 为以 x 结束的 7 天窗口内被观测到的 `C` 内 query 数 |
| `expansion_slope_30d` | 过去 30 天"累计不同簇 query 数"的最小二乘斜率，除以 `max(1, cluster_size(t−30d))` |
| `attention_sources_active_14d` | 14 天内提及次数 ≥ 该源阈值的注意力源个数（0–4） |
| `attention_growth_14d` | 近 7 天提及数 / max(1, 前 7 天提及数) − 1 |
| `trends_slope_90d`（可选） | 趋势估计斜率，仅当 `src_trends` 有数据 |

### 3.2 W 轴特征
| 特征 | 定义 |
|------|------|
| `serp_weakness` | 见 §3.3；取主 query 与至多 2 个有 SERP 快照的簇 query 的算术平均 |
| `e_specialist_30d` | 当前 Top10 中的 SPECIALIST 域名里，在 `[t−60d, t−30d]` 的所有 Top10 快照中均未出现者的个数 |
| `e_authoritative_30d` | 同上，域名类别为 `MAJOR_MEDIA` 或 `OFFICIAL` |
| `volatility_30d` | `t` 与 `t−30d` 两份 Top10 中同时出现的 URL 的平均绝对排名位移，上限 10 |
| `crowding_index` | `min(100, go_users_14d × crowding_per_user)`，`crowding_per_user` 默认 10 |
| `serp_history_days` | 该机会 SERP 快照覆盖的天数 |

### 3.3 SERP 弱度
对 Top10 第 i 位结果，设排名权重 `r = [0.20, 0.15, 0.12, 0.10, 0.09, 0.08, 0.07, 0.07, 0.06, 0.06]`。单结果弱度 `w_i ∈ [0,1]`：

```text
w_i = clamp( base(result_type) + age_adj(age_days) + relevance_adj(relevance), 0, 1 )

base:   SPECIALIST 0.00 | OFFICIAL 0.00 | EDITORIAL_MEDIA 0.20 | LISTICLE_AFFILIATE 0.30
        DIRECTORY 0.30 | VIDEO 0.40 | DOC 0.50 | UGC_THREAD 0.60 | QA 0.60
        THIN_PAGE 0.70 | OFF_TOPIC 0.90 | UNCLASSIFIED 0.30
age_adj:        >24 个月 +0.20 ； >12 个月 +0.10 ； 否则 0
relevance_adj:  relevance < 0.5 → +0.20 ； 否则 0

serp_weakness = 100 × Σ r_i × w_i
```
输出同时返回**逐结果弱度明细**，供 UI 列出"具体弱结果"（PRD F6）。`UNCLASSIFIED` 使用中性值并计入 `coverage` 惩罚。

**来源纯度（与 01 §1.7 一致）**
- 排名权重只适用于**同一次、单一来源**的自然搜索结果快照（授权 SERP API 或经书面决策的等价采集）。新闻、代码仓库、问答、百科、社区是各自的证据，不得穿插后重新编号为 Top 10 再套用 `r`。
- `age_adj` 只在 `published_at` 或等价时间戳已写入该行时生效。缺时间戳则 `age_adj = 0`，且不得标 `OUTDATED_CONTENT`。
- `relevance_adj` 只在该次采集持久化了 `relevance` 时生效。按来源写死的常数不算观测，调整量为 0。
- 不满足上述条件时，这次采集可以落成辅助证据，但 `serp_history_days` 不增加，W 轴为 `INSUFFICIENT`。

### 3.4 M 轴输入
M 轴由 `commercial_summary`（07 §5）输入，含：独立域名数、各证据类型计数、持续性天数、负面信号、验证级别。分档函数 `bandM()` 位于 `@app/scoring`（纯函数），检测与抽取位于 `@app/commercial`（IO）。

## 4. 三轴计算

### 4.1 D 轴
```text
p_k     = percent_rank( feature_k ; universe )            对每个可用特征
D_score = Σ w_k · p_k / Σ w_k   （仅对可用特征求和）
coverage_D = Σ w_k(可用) / Σ w_k(全部)

权重 w：new_queries_7d 0.30 | cluster_growth_30d 0.25 | expansion_slope_30d 0.20
        attention（两特征合成的百分位）0.15 | trends_slope_90d 0.10
```
分档（自上而下首个命中）：

| 档 | 条件 |
|----|------|
| `INSUFFICIENT` | `history_days < 14` 或 `coverage_D < 0.6` 或宇宙过小 |
| `HIGH` | `D_score ≥ 75` ∧ `new_queries_7d ≥ 3` ∧ `cluster_size ≥ 8` |
| `MEDIUM` | `D_score ≥ 50` ∧ `cluster_size ≥ 5` |
| `LOW` | 其余 |

### 4.2 W 轴
```text
pressure = min(100, 30·e_specialist_30d + 40·e_authoritative_30d + 3·volatility_30d)
W_score  = 0.60·serp_weakness + 0.25·(100 − pressure) + 0.15·(100 − crowding_index)
```
| 档 | 条件 |
|----|------|
| `INSUFFICIENT` | `serp_history_days < 14` 或 `obs_date` 前 3 天内无 SERP 快照 |
| `HIGH` | `W_score ≥ 70` |
| `MEDIUM` | `W_score ≥ 45` |
| `LOW` | 其余 |

### 4.3 M 轴
分档规则见 01 §5.6 与 07 §6。`m_score` 为证据权重之和（仅用于排序与展示，不参与分档）。

### 4.4 Evidence Confidence
```text
c = 0.35·min(1, n_independent_sources / 4)
  + 0.25·observed_share
  + 0.20·freshness
  + 0.20·min(1, history_days / 60)

freshness = clamp(1 − median_evidence_age_days / 90, 0, 1)
observed_share = OBSERVED 证据占本机会有效证据的比例
```
`HIGH` ≥ 0.75；`MEDIUM` ≥ 0.50；否则 `LOW`。`n_independent_sources` = 近 30 天内对该机会有数据贡献的不同 `source_id` 个数。

## 5. Verdict

### 5.0 发布资格
`evaluateVerdict` 之前先算 `publication`。任一条件失败，则本次输出强制为：

| 字段 | 值 |
|------|----|
| `verdict` / `raw_verdict` | `WATCH` |
| `flags` | 含 `PARTIAL_DATA`；历史不足 14 天再加 `BASELINE_PERIOD` |
| `confidence` | 不得为 `HIGH`。关键源失败或历史不足时为 `LOW` |
| 机会 `status` | 保持或降为 `CANDIDATE`，信息流查询排除它 |

失败条件：
- `history_days < 14`，或 D 轴覆盖不足（§4.1 的 `INSUFFICIENT`）
- `serp_history_days < 14`，或最近一份快照不是 §3.3 认可的单一来源自然搜索结果
- M 轴唯一支撑是 `INFERRED`（例如查询词里的商业修饰词），且没有 observed 定价 / 结账
- 任一关键采集源在本批失败，而调用方用空列表继续打分

即时追踪申请（01 F3）走这条路径：它可以保存第一次联想观测和辅助来源行，但不得调用 §5.1 的升档规则。每日批处理在资格满足后才第一次允许 `BUILD_NOW` / `EARLY_BET`。`WINDOW_CLOSING` 另外要求 `prev.verdict` 已是发布过的 `BUILD_NOW` 或 `EARLY_BET`。

### 5.1 原始 Verdict（`raw_verdict`）
自上而下评估，首个命中即返回：

```ts
function rawVerdict(a: Axes, prev: PrevState, cfg: Config): Verdict {
  const negativeM = a.m.hasStrongNegative;

  if (a.d >= MEDIUM && a.m === HIGH && a.w >= MEDIUM && a.conf >= MEDIUM && !negativeM)
    return BUILD_NOW;

  if (a.d === HIGH && a.w === HIGH && a.m in {LOW, MEDIUM, INSUFFICIENT} && a.conf >= LOW && !negativeM)
    return EARLY_BET;

  if ((prev.verdict in {BUILD_NOW, EARLY_BET} && wDroppedWithin(14)) ||
      (prev.verdict === WINDOW_CLOSING && a.w !== HIGH && a.d >= MEDIUM && daysInState(prev) <= cfg.windowClosingMaxDays))
    return WINDOW_CLOSING;

  // PASS 条件先于 WATCH 评估；"数据不足"不等于"低"，不触发 PASS
  if (a.d === LOW || negativeM || a.w === LOW) return PASS;

  return WATCH;   // 含 D 为 INSUFFICIENT 的情形，此时附加 PARTIAL_DATA flag
}
```
说明与对 01 §5.7 的澄清：
- **PASS 条件先于 WATCH 评估。** 若按 PRD 表格顺序（WATCH 在前），"窗口为 LOW"或"商业强负面"但 D ≥ MEDIUM 的机会将永远无法判 PASS。
- `INSUFFICIENT` 在档位比较中不满足"≥ MEDIUM"，也不等于 `LOW`：它不会升档，也不会因此被判 PASS，而是落入 `WATCH` 并附 `PARTIAL_DATA`（P2）。Feed 默认隐藏带 `PARTIAL_DATA` 的 `WATCH`。

- `EARLY_BET` 的界面必须带"商业未验证"标记（16）。
- `windowClosingMaxDays` 默认 30，超时后回落到 `WATCH` 或 `PASS`。

### 5.2 去抖（发布 Verdict）
账本发布值 `verdict` 由 `raw_verdict` 与历史决定：
- 升档（→ `BUILD_NOW` / `EARLY_BET`）：`raw_verdict` 连续 `confirm_days.upgrade`（默认 2）天不变才发布。
- 降档：连续 `confirm_days.downgrade`（默认 2）天才发布。
- **绕过去抖**：M 轴出现强负面信号（`hasStrongNegative`）→ 立即 `PASS`；`DEAD` 状态 → 立即 `PASS`。
- `raw_verdict` 与 `verdict` 均写入账本。

### 5.3 Flags
| Flag | 条件 |
|------|------|
| `W_DROPPING` | 14 天内 W 档下降 ≥ 1，且 Verdict 仍为 `BUILD_NOW` / `EARLY_BET` |
| `M_NEGATIVE` | 存在强负面商业信号 |
| `LOW_CONFIDENCE` | `confidence = LOW` |
| `PARTIAL_DATA` | 任一轴 `INSUFFICIENT`，或宇宙过小 |
| `BASELINE_PERIOD` | 机会仍在基线期内 |

## 6. 生命周期

状态：`FORMING` `EARLY_WINDOW` `CONTESTED` `MATURE` `DEAD`。所有转换需**连续 `confirm_days`（默认 3）天满足条件**；`DEAD` 例外（60 天条件本身已含持续性）。

| 转换 | 条件（初始值） |
|------|----------------|
| （新机会）→ `FORMING` | 初始状态 |
| `FORMING` → `EARLY_WINDOW` | D ≥ MEDIUM ∧ W ≥ MEDIUM |
| `EARLY_WINDOW` → `CONTESTED` | W 档较 7 天前下降 ≥ 1，或 `e_specialist_30d + e_authoritative_30d ≥ 2` |
| `FORMING` → `CONTESTED` | W = LOW ∧ `e_specialist_30d ≥ 2` |
| `CONTESTED` → `EARLY_WINDOW` | W = HIGH 持续 7 天且 `e_* = 0` |
| `CONTESTED` → `MATURE` | 连续 60 天 `volatility_30d ≤ 1.5` ∧ `e_specialist_30d = 0` ∧ `expansion_slope_30d ≤ 0.02` |
| 任意 → `DEAD` | `active_7d(t) / max_{90d}(active_7d) ≤ 0.6` 持续 ≥ 60 天 |
| `DEAD` → `FORMING` | D ≥ MEDIUM ∧ `new_queries_7d ≥ 5` 持续 14 天 |

每次转换写 `lifecycle_transitions`（`from / to / rule_id / verdict_id / evidence_ids`）。规则 ID 形如 `LC-EW-TO-CONTESTED`。

## 7. 配置

### 7.1 结构（节选，JSON，经 Zod 校验）
```json
{
  "version": "sc-1.0.0",
  "universe": { "min_history_days": 14, "min_universe_size": 200 },
  "baseline": { "days": 14 },
  "d": {
    "weights": { "new_queries_7d": 0.30, "cluster_growth_30d": 0.25,
                 "expansion_slope_30d": 0.20, "attention": 0.15, "trends_slope_90d": 0.10 },
    "coverage_min": 0.6,
    "bands": { "high": { "score": 75, "new_queries_7d": 3, "cluster_size": 8 },
               "medium": { "score": 50, "cluster_size": 5 } }
  },
  "w": {
    "rank_weights": [0.20,0.15,0.12,0.10,0.09,0.08,0.07,0.07,0.06,0.06],
    "type_base": { "SPECIALIST": 0, "OFFICIAL": 0, "EDITORIAL_MEDIA": 0.2, "LISTICLE_AFFILIATE": 0.3,
                   "DIRECTORY": 0.3, "VIDEO": 0.4, "DOC": 0.5, "UGC_THREAD": 0.6, "QA": 0.6,
                   "THIN_PAGE": 0.7, "OFF_TOPIC": 0.9, "UNCLASSIFIED": 0.3 },
    "age_adj": [ { "months_gt": 24, "add": 0.2 }, { "months_gt": 12, "add": 0.1 } ],
    "relevance_adj": { "lt": 0.5, "add": 0.2 },
    "pressure": { "specialist": 30, "authoritative": 40, "volatility": 3 },
    "score_weights": { "serp": 0.60, "pressure": 0.25, "crowding": 0.15 },
    "crowding_per_user": 10,
    "bands": { "high": 70, "medium": 45 },
    "min_serp_history_days": 14
  },
  "m": { "rules_ref": "07#6", "evidence_max_age_days": 120, "persistence_days": 90 },
  "confidence": { "weights": [0.35,0.25,0.20,0.20], "high": 0.75, "medium": 0.50 },
  "verdict": { "confirm_days": { "upgrade": 2, "downgrade": 2 }, "window_closing_max_days": 30,
               "build_now_target_share_max": 0.05 },
  "lifecycle": { "confirm_days": 3, "contested_entrants": 2, "mature_days": 60,
                 "dead": { "ratio": 0.6, "days": 60 } }
}
```

### 7.2 版本流转
```text
DRAFT ──(提交)──▶ SHADOW ──(≥14 天 + 对比报告 + 回测不劣化)──▶ ACTIVE ──(被替代)──▶ RETIRED
```
- `SHADOW`：新配置每日并行计算，输出写 `verdicts_shadow`，**不进账本、不发告警**。
- 晋升前必须提供：与 `ACTIVE` 的 Verdict 差异报告；在历史快照上的回测指标（06 §10）不劣化；Admin 双人批准（若仅一名 Admin，则批准后冷却 24 小时才生效）。
- `ACTIVE` 只前向生效；**永不改写历史账本**。
- 配置内容一旦离开 `DRAFT` 即不可变（03 I3）；变更 = 新版本。
- BUILD NOW 稀缺性监控：若 BUILD_NOW 占 TRACKED 的比例连续 7 天 > `build_now_target_share_max`，触发 Admin 告警并要求复核阈值。

## 8. 重算接口
```ts
recompute(opportunityId, obsDate, configVersion): {
  output: ScoringOutput;
  diffAgainstLedger: Diff | null;   // 与账本中该日系统行对比
}
```
- Admin / CLI 可调用；用于配置对比、审计、事故复盘。
- 每日夜间任务随机抽取 1% 的历史 Verdict 重算并比对；不一致即触发严重告警（表示快照被污染或代码非确定）。

## 9. 人工 Override
- 仅 `ANALYST` 提议、`ADMIN` 批准；必须给出 `reason`。
- 以新账本行写入（`is_override = true`，`supersedes_id` 指向被覆盖行），**不改写原行**。
- Override 的 Verdict 在 UI 上显式标注"人工调整"，并在战绩统计中单列。

## 10. Golden 测试（18 §3）
`fixtures/scoring/*` 至少覆盖：
- 每个 `band` 与 Verdict 的边界值（阈值 ±ε）；
- 去抖：单日跳变、连续跳变、绕过去抖；
- `WINDOW_CLOSING` 进入与超时回落；
- 生命周期每条转换及禁止转换；
- 特征缺失 / 覆盖率不足 / 宇宙过小；
- 同输入重复运行结果一致；
- 无前视：把 `obs_date` 之后的数据注入输入，输出不得变化。

## 11. 推荐层：Build Type 与 Monetization 路线

**定位**：推荐层不参与 Verdict，也不进入预测账本；它回答"做什么形态、怎么变现"。同样由确定性规则计算，规则集随 `scoring_config.reco` 版本化，每日结果写入 `opportunity_recommendations`（03 §8）以便复现。LLM 只负责为规则命中结果撰写叙述（08 U4），不参与排序与分级。

### 11.1 输入
- 簇 query 意图构成：`informational / commercial / transactional / navigational` 占比，及工具类修饰词（calculator、converter、generator、checker、template、online、free …，按语言维护词表）占比；
- SERP 构成：各 `result_type` 占比，`SPECIALIST` 工具站数量，`LISTICLE_AFFILIATE`、`DIRECTORY`、`UGC_THREAD` / `QA` 占比；
- 商业摘要（07 §5）：独立付费域名数、订阅 / 一次性套餐分布；
- 簇结构：可参数化模式数量（如 `{X} converter` 共享同一模板的 query 数）、变量集合规模；
- 注意力信号：GitHub / HN 相关活跃度、开发者类修饰词（api、sdk、library）。

### 11.2 Build Type 排序
每个类型按规则累计分（内部值，**界面只展示排名，不展示数值**）：

| Build Type | 加分规则（示例，初始值） | 减分规则 |
|-----------|--------------------------|----------|
| `TOOL` | 工具类修饰词占比 ≥ 30%：+30；Top10 中 SPECIALIST 工具站 ≥ 2（证明工具需求）：+20；`serp_weakness ≥ 60`：+15 | 权威工具站占据 Top3：−20 |
| `CONTENT_SITE` | 信息类占比 ≥ 60%：+30；UGC / QA 占比 ≥ 30%（现有答案薄弱）：+20；存在联盟榜单：+10 | 信息类占比 < 30%：−20 |
| `PSEO_SITE` | 同一模板 query ≥ 20：+35；变量集合 ≥ 100：+15；`serp_weakness ≥ 60`：+10 | 权威站点占 Top3：−20；模板 query < 8：−30 |
| `DIRECTORY` | "best / list / tools for" 类 query ≥ 30%：+30；榜单 / 目录结果占比 ≥ 30%：+20；簇内实体 ≥ 30：+15 | 实体 < 10：−25 |
| `MICRO_SAAS` | 独立订阅型付费域名 ≥ 2：+30；商业意图占比 ≥ 30%：+20；M ≥ MEDIUM：+10 | 执行规模判为 `L`：−15；M ∈ {LOW, INSUFFICIENT}：−10 |

- 输出前 3 名，含 `rationale_rule_ids`、MVP 范围模板 ID、技术复杂度、内容负担、`execution_class`（09 §5）。
- 首发范围外的类型（`API_DEVTOOL`、`MANAGED_SERVICE`）不参与排序（Phase 2）。

### 11.3 Monetization 路线分级
| 路线 | `PRIMARY` 条件 | `NOT_RECOMMENDED` 条件 |
|------|----------------|------------------------|
| `ADS_AFFILIATE` | 信息 + 商业调查类占比 ≥ 60% 且 SERP 中联盟榜单 ≥ 2 | 交易类占比 ≥ 60%（用户直奔购买，广告 / 联盟价值有限） |
| `LEAD_GEN` | 存在服务 / 报价类修饰词占比 ≥ 25% | 无服务类信号 |
| `SAAS_SUBSCRIPTION` | **必须**满足：观测到 ≥ 2 个独立域名的订阅型付费套餐（`P ≥ 2`） | M ∈ {LOW, INSUFFICIENT} 且无付费域名 → 至多 `SECONDARY` 并标注"商业未验证" |
| `DIRECTORY_MARKETPLACE` | Build Type 排名首位为 `DIRECTORY` 且目录类结果存在 | 无目录类信号 |
| `API_DEVELOPER` | 开发者类修饰词占比 ≥ 20% 且注意力源含 GitHub / HN | 无开发者信号 |

- 其余情形：满足部分条件 → `SECONDARY`；无信号 → `NOT_RECOMMENDED`。
- **硬约束**：任何路线的 `PRIMARY` 不得超出 M 轴证据强度（`SAAS_SUBSCRIPTION` 尤其如此）。
- `required_traffic_intensity` 由 `monetization_benchmarks` 配置提供；**基准值为空时界面显示"—"，不得使用凭空数字**。基准值必须由分析师研究并注明来源与日期，展示时带"假设"标签。

### 11.4 测试
- Golden：每个 Build Type / 路线的触发、抑制与边界；
- 约束测试：M = LOW 且无付费域名时，`SAAS_SUBSCRIPTION` 永不为 `PRIMARY`；
- 排序稳定性：同输入同排序（并列时按类型固定顺序打破）。
