# 05 — 评分与决策规格（Scoring Config Spec）

Status: Draft ｜ 依赖：01 §5、03 ｜ 被依赖：06、07、12、16

本文定义三轴、置信度、Verdict、生命周期如何由**确定性纯函数**和**版本化配置**计算。所有数值为 `sc-1.0.0` 的**初始值**，须在 Phase 0 校准。

## 1. 总则
1. 评分包 `@app/scoring` 无 IO、无当前时间读取、无随机数、无 LLM 调用。
2. 输入 = `ScoringInput`（features + 上一日状态 + 配置）；输出 = `ScoringOutput`（三轴、Verdict、生命周期、解释轨迹）。
3. 同一 `ScoringInput` 必得同一 `ScoringOutput`（bit-for-bit，含浮点：统一使用定点四舍五入到 2 位后比较）。
4. 时间点正确性（point-in-time）：`features` 只能使用 `observed_at ≤ obs_date 23:59:59Z` 的数据；禁止前视。
5. 每个结论附 `explanation`：命中的规则、输入值、阈值，UI 用它渲染评分分解（不需要 LLM）。
6. **只读已冻结的快照标签（ADR-020）**：评分与历史重算一律读取快照中入库时冻结的分类字段，**重算路径不得调用 LLM**。若分类未在入库时冻结，则该快照视为无效输入——不得在评分时补跑分类，否则同一快照集合会因模型版本漂移得出不同分数，`100% 可重算`（PRD P7）失效。

## 2. 宇宙与预处理

- **宇宙（universe）**：同一 `(market_country, research_language)` 下，`status = TRACKED` 且 `history_days ≥ min_history_days` 的全部机会。`min_history_days` 常规为 14；满足 §5.0 快车道判定的机会为 `fast_track.min_history_days`（默认 7）。两种门槛必须一致地作用于宇宙准入、§4.1 D 轴与 §4.2 W 轴，否则快车道在宇宙这一层就被挡掉（30 R4）。
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
| `crowding_index` | `min(100, Σclaimed_slots × crowding_per_slot)`，`crowding_per_slot` 默认 20。`Σclaimed_slots` 是该机会**全部形态槽位**中处于 `CLAIMED` 的总数（ADR-018、§5.1），上限 `Σcapacity`，故全部槽位占满时该项达 100 |
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
| `INSUFFICIENT` | `history_days < min_history_days`（§2，快车道为 7）或 `coverage_D < 0.6` 或宇宙过小 |
| `HIGH` | `D_score ≥ 75` ∧ `new_queries_7d ≥ 3` ∧ `cluster_size ≥ 8` |
| `MEDIUM` | `D_score ≥ 50` ∧ `cluster_size ≥ 5` |
| `LOW` | 其余 |

### 4.2 W 轴
```text
pressure = min(100, 30·e_specialist_30d + 40·e_authoritative_30d + 3·volatility_30d)
W_score  = 0.60·serp_weakness + 0.25·(100 − pressure) + 0.15·(100 − crowding_index)
market_W = (0.60·serp_weakness + 0.25·(100 − pressure)) / 0.85     -- 不含拥挤项，归一化到 0–100
```
`w_band` 由 `W_score` 分档，用于展示与 Verdict 主条件；`market_w_band` 用同一阈值表对 `market_W` 分档，**只**用于 `WINDOW_CLOSING` 的降档判定与 `W_DROPPING`（§5.1、§5.3；PRD v2.2 §1.7 第 2 条）。两者的带日期历史都写入 `prev`。`INSUFFICIENT` 条件两者共用。
| 档 | 条件 |
|----|------|
| `INSUFFICIENT` | `serp_history_days < min_history_days`（§2，快车道为 7）或 `obs_date` 前 `serp_freshness_days[tier]` 天内无 SERP 快照 |
| `HIGH` | `W_score ≥ 70` |
| `MEDIUM` | `W_score ≥ 45` |
| `LOW` | 其余 |

**SERP 新鲜度按追踪层级（30 R5）**：`serp_freshness_days` 默认 `{A: 3, B: 8}`。B 层 SERP 每周只采一次（04 §5），若沿用统一的 3 天，B 层机会一周里约 4 天 W 轴为 `INSUFFICIENT`、无法发布。8 = 7 天采集周期 + 1 天调度余量。C 层无 SERP，W 轴恒为 `INSUFFICIENT`。

72 小时宽限（ADR-021）只用于**每日**采集的源。B 层两次采集之间本来就隔 7 天，不能把「本周还没到采集日」读成失败；B 层的一次采集失败，从它的计划采集时间起算 72 小时宽限。

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
| `flags` | 含 `PARTIAL_DATA`；历史不足基线天数再加 `BASELINE_PERIOD` |
| `confidence` | 不得为 `HIGH`。关键源失败或历史不足时为 `LOW` |
| 机会 `status` | 保持或降为 `CANDIDATE`，进入「正在监测的异动流」 |

判定规则（支持双轨制）：
- **常规 Evergreen 轨**：`history_days < 14`，或 D 轴覆盖不足（§4.1 的 `INSUFFICIENT`），或 `serp_history_days < 14`，或最近一份快照不是 §3.3 认可的自然搜索结果。
- **Fast-Track 快车道豁免**：若机会标记为脉冲型（`history_days >= 7` 且 `new_queries_7d >= 3` 且增长加速度显著），允许以 7 天历史进入资格评估，打上 `FAST_TRACK` 标识。此时 §2 宇宙、§4.1 D 轴、§4.2 W 轴的 `min_history_days` 同时取 7；只放宽这里而不放宽三处，快车道就无法到达（30 R4）。
- ~~M 轴唯一支撑是 `INFERRED`~~ **不再是资格条件（30 R6）**：PRD §5.7 允许 M ∈ {Low, Medium, Insufficient} 的 `EARLY_BET`，而 §5.6 的 Low 正是「仅有商业意图查询」。把它当资格条件，等于把 PRD 明确允许的 `EARLY_BET` 一律挡掉。M 仅由 `INFERRED` 支撑时，机会照常参与评估，但 §5.1 中 M 达不到 `MEDIUM`，因此不可能为 `BUILD_NOW`；`EARLY_BET` 照常可达，并带「商业未验证」标记。
- 任一关键采集源在本批失败且**已超出 72 小时宽限期**（该源 `source_health = FAILED`），而调用方用空列表继续打分。处于宽限期内（`source_health = STALE`）时，沿用最近一次成功快照的档位并打 `STALE_DATA`，**不触发本条件**（ADR-021）。

即时追踪申请（01 F3）走这条路径：它可以保存第一次联想观测和辅助来源行，但不得调用 §5.1 的升档规则。每日批处理在资格满足后才第一次允许 `BUILD_NOW` / `EARLY_BET`。`WINDOW_CLOSING` 另外要求 `prev.verdict` 已是发布过的 `BUILD_NOW` 或 `EARLY_BET`。

### 5.1 原始 Verdict（`raw_verdict`）与产出健康区间
系统引入 **Verdict 产出健康区间（Yield Health Band，目标每周 1–5 条 BUILD_NOW/EARLY_BET）**，废除单纯的静态全硬布尔阻断，引入**特征补偿机制（Feature Compensation）**：

```ts
function rawVerdict(a: Axes, prev: PrevState, cfg: Config): Verdict {
  const negativeM = a.m.hasStrongNegative;

  // 1. 槽位全满熔断（防止 Alpha Decay 公地悲剧）
  // 只要有任一形态还有空槽就不算锁死；须 Σclaimed == Σcapacity 才熔断。
  if (a.w.isCrowdedLocked || a.w.slotsClaimedTotal >= a.w.slotsCapacityTotal) {
    return WINDOW_CLOSING; // 或转入 CONTESTED，避免被更多订阅者踏平
  }

  // 2. 标准 BUILD_NOW 门槛
  if (a.d >= MEDIUM && a.m === HIGH && a.w >= MEDIUM && a.conf >= MEDIUM && !negativeM)
    return BUILD_NOW;

  // 3. 特征补偿 BUILD_NOW（打破 0 产出：强爆发需求 + 宽阔窗口 补偿 中等商业验证）
  // v2.2 Q1：纯装饰性定价的 MEDIUM 不得补偿，最多走到 EARLY_BET
  const mVerified = a.m.band === 'HIGH' ||
    (a.m.band === 'MEDIUM' && (a.m.hasTransactionTraction || a.m.pricingPersistentDays >= 90));
  if (a.d === HIGH && a.w === HIGH && mVerified && a.conf >= MEDIUM && !negativeM)
    return BUILD_NOW;

  // 4. 激活 EARLY_BET（放宽门槛，先上车后补票）
  // 门槛：D=HIGH 且 W >= MEDIUM；或 Fast-Track 脉冲下 D >= MEDIUM 且 W=HIGH
  const isEarlyBet = (a.d === HIGH && a.w >= MEDIUM) || (a.fastTrack && a.d >= MEDIUM && a.w === HIGH);
  if (isEarlyBet && a.m in {LOW, MEDIUM, INSUFFICIENT} && a.conf >= LOW && !negativeM)
    return EARLY_BET;

  // 5. 窗口关闭（三个必要条件缺一不可，见下方说明）
  // v2.2 Q2：降档判定只看市场 W（不含 crowding_index），拥挤只经 CROWDED_LOCKED 生效
  if ((prev.verdict in {BUILD_NOW, EARLY_BET} && wDroppedWithin(prev.datedMarketWBandHistory, 14)) ||
      (prev.verdict === WINDOW_CLOSING && a.w !== HIGH && a.d >= MEDIUM && daysInState(prev) <= cfg.windowClosingMaxDays))
    return WINDOW_CLOSING;

  // 6. PASS 条件先于 WATCH 评估
  if (a.d === LOW || negativeM || a.w === LOW) return PASS;

  return WATCH;   // 含 D 为 INSUFFICIENT 的情形，此时附加 PARTIAL_DATA flag
}
```
说明：
- **特征补偿（Compensated Build）**：当搜索需求呈现强烈脉冲拉升、且 SERP 极其虚弱无竞品占据时，即便商业变现证据仍处于中档验证期，系统允许补偿升档为 `BUILD_NOW`，避免好机会因教条的商业硬指标被完全漏掉。
  - **补偿条件（PRD v2.2 §5.7，30 Q1 已裁决）**：M=MEDIUM 时必须**至少含一条 `COMMERCIAL_TRACTION`**（`hasTransactionTraction`），**或**定价 / checkout 在快照中持续 ≥ 90 天（`pricingPersistentDays ≥ 90`，07 §5）。只凭独立定价站数量（`independentDomainsCount ≥ 2`）不再满足补偿——那正是多站静态 `PRICING_DECORATION`，违背 PRD §1.7 第 3 条「有人收费 ≠ 有人付费」。纯装饰性的 MEDIUM 最多到 `EARLY_BET`。现行代码仍按旧口径（`independentDomainsCount ≥ 2`），属 M1 待实现，随 `sc-1.1.0` 进 SHADOW。
- **认领保护**：槽位按 Build Archetype 切分（ADR-018）：默认每形态 `capacity = 2`，全机会 `Σcapacity ≤ 6`。`Σclaimed == Σcapacity` 时置 `isCrowdedLocked`，自动转为 `WINDOW_CLOSING` 并降低后续可见性；任一形态仍有空槽则不熔断。
  - **活跃认领的唯一判定（D2）**：`projects.status != 'ARCHIVED'` **且** 该认领的质押不处于 `EXPIRED_RELEASED`。评分、展示、拦截三条读路径必须复用同一谓词。历史上三处曾分别写成 `!= 'ARCHIVED'` 与 `!= 'ABANDONED'`（后者不在 `projects.status` 的合法取值内，等于把归档项目也计入占用），这是必须消除的分歧。
- **`WINDOW_CLOSING` 的三个必要条件**（缺一即不成立，见 PRD §1.7.2）：
  1. `prev.verdict ∈ {BUILD_NOW, EARLY_BET}`——它必须来自一条**已经发布过**的裁决；当天竞争看起来不强不是窗口关闭。
  2. **市场 W 档**（`market_w_band`，§4.2，不含拥挤项）在 `obs_date` **前 14 天内**下降 ≥ 1 档。这要求降档历史是**带日期**的 `(obs_date, market_w_band)` 序列；仅有档位数组无法判定"14 天内"，会让任意久远的降档在今天触发窗口关闭。
  3. 该判定不得由处于 `STALE_DATA` 的轴触发（ADR-021）。
  例外：全部槽位满额触发的 `CROWDED_LOCKED` 熔断可直接置 `WINDOW_CLOSING`。此前的理由是「能认领的机会必然是已发布裁决」，但没有任何代码校验这个假设。实现时熔断分支必须同时检查 `prev.verdict ∈ {BUILD_NOW, EARLY_BET, WINDOW_CLOSING}`；不满足时记录异常并回落到 `WATCH`，不得凭空产生 `WINDOW_CLOSING`。
  - **拥挤与窗口关闭解耦（PRD v2.2 §1.7 第 2 条、§5.5，30 Q2 已裁决）**：W 展示值（`W_score`、`w_band`）保留 `crowding_index`；但第 2 条的降档判定**只读市场 W**（§4.2 的 `market_w_band`）。否则 2–3 个认领（`crowding_per_slot = 20`、权重 0.15）就能让 W 降一档并触发 `WINDOW_CLOSING`，窗口关闭成了平台自己造成的。拥挤只通过 `CROWDED_LOCKED` 熔断生效。`W_DROPPING`（§5.3）同样按市场 W 判定。
- **`STALE_DATA` 与降档抑制（ADR-021）**：某轴处于 72 小时宽限期内时，沿用最近成功快照的档位并打 `STALE_DATA`。此时**不得发布降档 Verdict、不得投递降级告警**——偶发采集故障不能被用户读成"竞争格局变了"。连续失败超 72 小时后该轴才置 `INSUFFICIENT`，届时恢复正常的降档与告警路径。
- `EARLY_BET` 的界面必须带"商业未验证"标记（16）。
- `windowClosingMaxDays` 默认 30，超时后回落到 `WATCH` 或 `PASS`。

### 5.2 去抖（发布 Verdict）
账本发布值 `verdict` 由 `raw_verdict` 与历史决定：
- 升档（→ `BUILD_NOW` / `EARLY_BET`）：`raw_verdict` 连续 `confirm_days.upgrade`（默认 2）天不变才发布。
- 降档：连续 `confirm_days.downgrade`（默认 2）天才发布。
- **绕过去抖**：M 轴出现强负面信号（`hasStrongNegative`）→ 立即 `PASS`；认领槽位耗尽熔断（`isCrowdedLocked`）→ 立即降级；`DEAD` 状态 → 立即 `PASS`。
- `raw_verdict` 与 `verdict` 均写入账本。

### 5.3 Flags
| Flag | 条件 |
|------|------|
| `W_DROPPING` | 14 天内**市场 W 档**（`market_w_band`，§4.2）下降 ≥ 1，且 Verdict 仍为 `BUILD_NOW` / `EARLY_BET` |
| `M_NEGATIVE` | 存在强负面商业信号 |
| `LOW_CONFIDENCE` | `confidence = LOW` |
| `PARTIAL_DATA` | 任一轴 `INSUFFICIENT`，或宇宙过小 |
| `BASELINE_PERIOD` | 机会仍在基线期内 |
| `FAST_TRACK` | 经 7 天脉冲快车道评估晋级 |
| `CROWDED_LOCKED` | 该机会**全部形态**槽位已满（`Σclaimed == Σcapacity`，默认上限 6），窗口对公域关闭 |
| `STALE_DATA` | 本次评估的至少一个轴复用了 72 小时宽限期内的历史快照（该源 `source_health = STALE`）。带此 flag 时不得发布降档、不得触发降级告警（ADR-021） |

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
    "crowding_per_slot": 20,
    "bands": { "high": 70, "medium": 45 },
    "min_serp_history_days": 14
  },
  "m": { "rules_ref": "07#6", "evidence_max_age_days": 120, "persistence_days": 90 },
  "confidence": { "weights": [0.35,0.25,0.20,0.20], "high": 0.75, "medium": 0.50 },
  "verdict": { "confirm_days": { "upgrade": 2, "downgrade": 2 }, "window_closing_max_days": 30,
               "build_now_target_share_max": 0.05 },
  "lifecycle": { "confirm_days": 3, "contested_entrants": 2, "mature_days": 60,
                 "dead": { "ratio": 0.6, "days": 60 } },
  "slots": { "default_capacity_per_archetype": 2, "max_capacity_total": 6,
             "max_active_go_per_user": 2, "stake_window_days": 7 },
  "staleness": { "grace_hours": 72 }
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
- BUILD NOW 产出健康监控与稀缺性管理：
  - **产出下限（Recall 守卫）**：若全平台连续 7 天没有**新增**任何一条 `BUILD_NOW` 或 `EARLY_BET`，触发 P1 Yield 告警，**由 Admin 人工复核**。复核结论若是调整阈值，必须走上面的 `DRAFT → SHADOW（≥ 14 天）→ ACTIVE` 流程，**不得自动校准**（30 R13）。理由有两条：自动校准会绕过 SHADOW；为凑产出而调阈值，会让 H1 评估的对象在观测期内被改写；
  - **产出上限（Precision 守卫）**：若 BUILD_NOW 占已发布机会的**存量**比例连续 7 天 > `build_now_target_share_max`（默认 5%），触发 Admin 告警并要求复核阈值。
  - **两个守卫的单位不同，分开监控**：下限看的是**每周新增**条数（PRD §1.7 第 4 条「每周 1–5 条」），上限看的是**存量占比**（PRD §5.7「≤ 5%」）。宇宙小时两者可以同时成立，也可以互相冲突；冲突时以存量占比为准，不为凑新增条数降低门槛。

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
- **槽位（ADR-018）**：`Σclaimed == Σcapacity` 熔断；仅某个形态占满而其他形态仍有空槽时**不得**熔断；认领谓词一致性——已归档项目不得计入占用；
- **`WINDOW_CLOSING` 前置裁决**：降档发生在 14 天窗口内才触发；降档发生在 30 天前时不得触发；无前置已发布裁决时低 W 只能落入 `WATCH` 或 `PASS`；
- **`STALE_DATA`（ADR-021）**：源处于 72 小时宽限期内时沿用昨日档位、打 `STALE_DATA`、不发布降档且不产生告警；连续失败 73 小时后该轴才置 `INSUFFICIENT` 并恢复降档路径。
- **补偿 `BUILD_NOW` 的交易门槛（PRD v2.2 Q1）**：D=W=HIGH、M=MEDIUM、仅 ≥ 2 个装饰性定价站（无 `COMMERCIAL_TRACTION`、定价持续 < 90 天）→ 最多 `EARLY_BET`；同条件加一条交易代理，或定价持续 ≥ 90 天 → `BUILD_NOW`（`RULE_BUILD_NOW_COMPENSATED`）；
- **拥挤不触发窗口关闭（PRD v2.2 Q2）**：已发布 `BUILD_NOW`，市场 W 不变、仅因 2–3 个认领使 `w_band` 降一档 → 不得为 `WINDOW_CLOSING`，也不得打 `W_DROPPING`；市场 W 在 14 天内降一档 → `WINDOW_CLOSING`；全部槽位满额 → 经 `CROWDED_LOCKED` 置 `WINDOW_CLOSING`。

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
