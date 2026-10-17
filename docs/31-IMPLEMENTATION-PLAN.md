# 31 — 整改实施计划（Implementation Plan）

Status: Approved ｜ Owner: 工程 ｜ Last reviewed: 2026-10-17 ｜ 依赖：01 v2.2、30 ｜ 被依赖：19

**本文是什么**：把 `30` 的整改项（R）与 PRD v2.2 的裁决（Q）拆成可开工的工程任务：每条写清改哪个文件、做什么、怎么验收。里程碑与 Gate 的节奏以 `30 §5` 为准，本文只负责「到代码的最后一公里」。

**本文不是什么**：不重复规格。规则以落点文档为准（`00-INDEX` §8），本文只引用编号。

---

## 1. 代码现状基线（2026-10-17 核对）

下表是开工前在仓库里实际查到的状态，任务的工作量据此估算。

| 项 | 现状 | 位置 | 对应 |
|----|------|------|------|
| SERP 深度 | 写死 `SERP_DEPTH = 100`，每次请求都带 `num=100` | `packages/collectors/src/serp-collector.ts:40` | R7 / Q14 |
| 快车道门槛 | D、W、资格判定里都有 7 天分支；`observe-opportunity.ts:530` 仍按 14 天判 | `scoring/src/demand.ts:23`、`window.ts:11`、`verdict.ts:89`、`services/src/pipeline/observe-opportunity.ts:525–628` | R4 |
| W 新鲜度 | 只有统一的「近期有 SERP 快照」布尔值，不分层级 | `scoring/src/window.ts:14` | R5 |
| 市场 W | 不存在；`W_score` 直接含 `0.15·(100 − crowdingIndex)` | `scoring/src/window.ts:33` | R12 / Q2 |
| 补偿规则 | 接受 `independentDomainsCount ≥ 2` | `scoring/src/verdict.ts` | R11 / Q1 |
| 槽位上限 | `MAX_CLAIMS_PER_OPPORTUNITY = 5`，被三处引用 | `services/src/claim-policy.ts:16`、`opportunity.service.ts`、`pipeline/observe-opportunity.ts:525` | R19 |
| 战绩延迟 | `PUBLIC_DELAY_DAYS = 45` | `services/src/track-record.service.ts:75` | R19 / Q11 |
| 质押窗口 | `STAKE_WINDOW_DAYS = 7`，不分执行规模 | `services/src/project.service.ts:15`、`stake.service.ts:384` | Q5 |
| 待付窗口 | `STEALTH_RESERVATION_GRACE_MINUTES = 45`，`STEALTH_CHECKOUT_SESSION_MINUTES = 35` | `services/src/stealth-lock-policy.ts:29,41` | Q8 |
| 点火包词表 | `clusterQueries` 缺省为 `[]`，服务层从不传入 | `report/src/generator.ts:360`、`launch-kit.ts:626` | R8 |
| 评估规格 | 只有 `ev-1.0` | `services/src/prediction-episode.service.ts:78` | R2 |
| 告警投递 | 只写站内 `notifications`，告警路径不调用邮件服务 | `services/src/alert-triggers.ts` | R14 / Q4 |
| `build_type` | 已收敛：`LIGHTWEIGHT_TOOL` 是 `TOOL` 的别名，DB CHECK 兜底 | `core/src/enums.ts:62` | R19（已完成，只需复核存量行） |
| 迁移 | 最新为 `0008`；`schema.sql` 是冻结 baseline，不得修改 | `packages/db/src/migrations/` | — |

**验证命令**：类型检查走 `pnpm build`（`pnpm lint` 只覆盖 web）；测试走 `pnpm test`。dev server 与 build 共用 `.next`，跑 build 前先停 dev server。

---

## 2. 任务分解

编号格式 `T{里程碑}.{序号}`。「验收」一栏必须在合入前满足。

### M1 引擎可达与账本纪元（第 1–3 周）

| # | 任务 | 改动 | 验收 |
|---|------|------|------|
| T1.1 | 快车道 7 天贯通 | `observe-opportunity.ts` 的资格与 W 判定改用与 `scoring` 相同的快车道门槛；删掉 `:530` 的硬编码 14 | Golden：快车道可达（18 §4.2） |
| T1.2 | W 新鲜度按层级 | `WindowFeatures` 增 `tier` 与 `daysSinceLastSerp`；A 层 > 3 天、B 层 > 8 天置 `INSUFFICIENT`（05 §4.2） | Golden：B 层 W 新鲜度 |
| T1.3 | 市场 W | `window.ts` 同时输出 `wBand`（含拥挤，展示用）与 `marketWBand`（不含拥挤）；账本带日期的 W 历史改记 `marketWBand`；`WINDOW_CLOSING` 只读它 | Golden：认领不触发窗口关闭（Q2） |
| T1.4 | 补偿规则收紧 | `verdict.ts` 的 `mVerified` 改为 `HIGH`，或 `MEDIUM ∧ (hasTransactionTraction ∨ pricingPersistentDays ≥ 90)` | Golden：纯装饰性 MEDIUM 最多 `EARLY_BET`（Q1） |
| T1.5 | INFERRED-only 不挡发布 | 资格判定里删去这一条，改在 `BUILD_NOW` 分支前拦截 | Golden：INFERRED-only 的 `EARLY_BET` |
| T1.6 | 槽位真源统一 | 删除 `MAX_CLAIMS_PER_OPPORTUNITY`；`isCrowdedLocked` 与展示一律读 `opportunity_slots` 的 `Σclaimed == Σcapacity`；活跃谓词统一用 `activeClaimPredicate`（D2） | 三条读路径共用一个函数；grep `MAX_CLAIMS` 为 0 |
| T1.7 | 产出守卫 | Yield 告警只发 Admin 通知，删除任何自动改阈值的路径（05 §7.2） | 单测：断流 7 天只产生告警，不产生新配置 |
| T1.8 | `sc-1.1.0` 进 SHADOW | T1.1–T1.5 打包为新配置版本，写 `verdicts_shadow` 14 天 | 第 14 天出差异报告 |
| T1.9 | 生产 v2 纪元确认 | 核对生产库每日管线是否稳定写入 `hash_version ≥ 2` 行；若没有，先修管线 | 连续 7 天无缺日 |

**M1 实施状态（代码）**：T1.1 的流水线侧（资格与 D/W 门槛已共用快车道 7 天）、T1.2、T1.3、T1.4、T1.5、T1.6 已落地，`pnpm build` 与 `pnpm test` 全绿。
- **版本号偏离**：仓库里 `SCORING_CONFIG_VERSION` 早已是 `sc-1.1.0`（7ee71af 起写入账本），新规则会改变同一输入的输出，所以代码里升到了 `sc-1.2.0`；本文与 05、30 里写的 `sc-1.1.0` 指的是同一批规则，待 T1.8 时统一改名。
- **T1.8 未做**：仓库里没有 `verdicts_shadow` 表，也没有 SHADOW 写入路径，新规则目前直接进每日管线。上线前需要先建影子表并跑满 14 天，或书面决定跳过。
- 市场 W 的带日期历史取自 `opportunity_snapshots.metrics.market_w_band`（`verdicts` 没有该列，`schema.sql` 冻结）；上线前几天没有历史，不会判定降档。
- **T1.7 已落地**：`YieldGuardService.check` 实现两个守卫（下限：7 天无新增 BUILD_NOW/EARLY_BET；上限：BUILD_NOW 存量占比连续 7 天超 5%），只写 `audit_log` 与 Admin 站内通知，不触碰任何评分配置；由新任务 `check-yield`（`50 7 * * *`）每日执行。单测验证断流只产生告警、不产生新配置。
- **T1.9 未开始**：需要访问生产库，本轮没有做。

**注意**：T1.3 改变账本里 W 历史的语义，要进 `sc-1.1.0`，不能直接改 `sc-1.0.0` 的行为（ACTIVE 只前向生效）。

### M2 H1 可证伪与成本（第 2–4 周）

**M2 实施状态（代码）**：
- **T2.3 已落地**（9b6e406）：公开战绩只统计锚定在 `hash_version ≥ 2` 裁决行上的 Episode。评估器（`evaluateDueEpisodes`）尚未加同样的过滤，seed 行的 Episode 仍会被评估，只是不进公开统计；Gate 0 的 H1 评估脚本必须自带该过滤。两个借用 seed 行的测试夹具已改为自建 v2 行。
- **T2.4 已落地**（67e6416）：采集深度默认 10；流水线只对映射到已核验 Project 的主词、且当周还没取过 Top 100 时取 100，并且**只在 depth ≥ 100 的快照上记录排名**，避免把 Top 10 里"没看到"当成"未入榜"。
- **T2.1 / T2.2 / T2.5 / T2.6 未开始**。T2.1 仍是全计划的硬期限，下一步应先做它。

| # | 任务 | 改动 | 验收 |
|---|------|------|------|
| T2.1 | 冻结 `ev-1.1` | `prediction-episode.service.ts` 增 `ev-1.1` 规格：主事件 `external_demand_formed`，B1 Trends 必备；新 Episode 的 `criteria_snapshot` 写入整份规格 | **必须早于首批 v2 Episode 到 T+30**；受 `prevent_episode_rewrite()` 保护 |
| T2.2 | `src_volume` 准入 | 选定第三方词量源，按 04 §7 八项完成登记；采集器接入 `packages/collectors` | 04 §2 登记完整；契约测试通过 |
| T2.3 | 纪元过滤 | `track-record.service.ts` 与评估器只读 `hash_version ≥ 2`；38 行 seed 不进任何统计 | 单测：seed 行注入后统计不变 |
| T2.4 | SERP 深度分层 | `SERP_DEPTH` 改为参数：默认 10；只对映射到已核验 Project 的 query 每周一次 100（ADR-022）；`serp_snapshots.depth` 如实记录 | 请求日志里 `num=100` 只出现在项目 query |
| T2.5 | 成本表与回归 | 用实测单价填 04 §6.3 成本表；按 04 §6.1 新公式写成本回归测试 | 18 §4.2 成本回归通过，或书面结论「达不到」 |
| T2.6 | 全量重算脚本 | 对 v2 纪元全部 Verdict 跑 05 §8 `recompute` | 逐行 bit-for-bit 一致 |

### M3 F8 卖点补实（第 3–6 周）

| # | 任务 | 改动 | 验收 |
|---|------|------|------|
| T3.1 | 词表注入 | `report.service.ts` / `launch-kit.service.ts` 从 `opportunity_queries` 读簇 query 并显式传入；`generator.ts` 去掉 `?? []` 静默缺省，缺失时报错 | 非 seed 机会的词表非空；无观测时输出 `KEYWORDS_UNAVAILABLE.md`（09 §5.3） |
| T3.2 | 意图入库冻结 | `llm/src/classifier.ts` 在入库时给 query 打 `intent` 并写不可变列（新迁移 `0009`） | 重算不调 LLM（ADR-020） |
| T3.3 | 路由字段 | `launch-kit.ts` 输出 `slug / target_keyword / intent / title / h1 / meta_description`；删除 `volume_tier` | 快照测试对齐 09 §5.3 |
| T3.4 | 半遮罩长尾词 | 初筛的 15 个长尾词改从同一来源取 | `live-scan` 单测 |
| T3.5 | 样本与盲审 | 20 份报告 + 点火包，按 9 项 rubric 盲审 | 通过率 ≥ 80%，R1/R2 零违例 |

**T3.1 / T3.3 实施状态**：已落地。`report.service.ts` 从 `opportunity_queries`（非 PRIMARY 角色）读簇内词并显式传入，`generator.ts` 的 `clusterQueries` 改为必填；无观测词时点火包输出 `KEYWORDS_UNAVAILABLE.md`（PSEO 形态同时省略 `routes.yaml`）。词表与路由输出 `slug / target_keyword / intent / title / h1 / meta_description`，`volume_tier` 已删除（无词量源，排序只按查询词，保证可重算）；`title / h1 / meta_description` 只用关键词与机会标题装配，不随界面语言变化（14 §5.4）。模板版本升到 1.1。
- 簇内词的 `intent` 目前由 `report.service.ts` 里的确定性规则分类，不是 T3.2 要求的"入库时冻结"。T3.2（`llm/classifier.ts` 入库打标 + 不可变列）未做，做完后应改读冻结列。
- T3.4 已落地：初筛新建机会时入库并返回最多 15 个长尾词（`SCREENER_LONGTAIL_LIMIT`，此前入库 5 个、返回未截断的建议词），重复扫描改从 `opportunity_queries` 的簇内词读取，与报告、点火包同源；买断打码中的机会不返回词表。
- T3.5（盲审，需要人工）未做。

### M4 预售（第 1–8 周，并行，非工程）

≥ 20 场访谈、≥ 8 人预付或意向（H3）。工程只需保证 Demo 页与报告样本可演示。

### M5 Phase 1 收尾（Gate 0 后 4–6 周）

| # | 任务 | 改动 | 验收 |
|---|------|------|------|
| T5.1 | 质押窗口分档 | `STAKE_WINDOW_DAYS` 改为按 `execution_class` 取 7/14/21；接受预发布页；首次逾期退配额（新迁移加记录列） | 18 §4.2 Q5 两条用例 |
| T5.2 | 活跃 GO 口径 | `ACTIVE_SLOTS_EXCEEDED` 只计质押未核验的 GO（Q15） | 18 §4.2 Q15 用例 |
| T5.3 | 待付窗口 | `STEALTH_RESERVATION_GRACE_MINUTES = 35`、`STEALTH_CHECKOUT_SESSION_MINUTES = 31`（必须短于前者）；30 天内 2 次未付作废后取消买断资格 | 现有 stealth 测试改值后全绿；新增资格取消用例 |
| T5.4 | 告警 MVP | 保留 `rule_type` 单值模型；补齐 6 条首发触发器的求值（含 `evaluateKillPredicate`，按现存 `{metric, op, threshold}` 结构实现）；接入 `email.service.ts` 投递 | 12 §2 标「首发」的 6 条都有求值路径和 Email 投递 |
| T5.5 | Free 精选 | 实现 `feed_selected_weekly`；7 天无新案例时回退历史案例并标注（Q10） | 13 §3.2 用例 |
| T5.6 | Demo 词 | `GET /screener/demos` 与详情接口，只读冻结快照；Admin 维护 | 10 §4.3b；p95 < 200ms |
| T5.7 | 初筛进度 | `GET /screener/scans/{id}` 返回阶段 `status`；前端分步进度条 | 16 §3.2c |
| T5.8 | 反滥用 | 设备指纹为主；IP 只记风险分；无指纹时要求 OAuth 账号满 30 天（Q9） | 13 §7.1 用例 |
| T5.9 | 公开战绩全量 | 删除 `PUBLIC_DELAY_DAYS`；汇总纳入全部 v2 Episode；逐行明细按 Q11 三条件披露 | 15 §8 三项指标有采集点 |
| T5.10 | 兜底与席位 | 连续 2 周 0 产出自动延长 7 天；Pro 席位上限 30、Founding 50 席售罄即止 | 13 用例 |

**T5.2 实施状态**：已落地。`SlotService.countActiveClaims` 与 GO 闸门里的计数都改为只数 `projects.stake_status = 'PENDING'` 的认领；质押核验通过后不再占活跃名额，但形态槽位不释放。

**T5.1 实施状态**：已落地。GO 按 `opportunities.execution_class` 取 7/14/21 天（`StakeService.windowDaysFor`）；首次逾期退 1 次配额，由新迁移 `0009`（`projects.go_quota_period_start` 与 `stake_overdue_refunds`，user_id 主键保证只退一次）支撑，退回 GO 当时计费的周期。预发布着陆页作为凭证：探针已接受 `PUBLIC_PAGE_URL`，未另改。

**T5.9 实施状态**：已落地。`PUBLIC_DELAY_DAYS` 已删除；公开战绩汇总纳入全部 `hash_version ≥ 2` 的 Episode，逐行明细按 Q11 的先到者披露（已完成 T+90、机会槽位满额、当前为 `WINDOW_CLOSING`、或存在已付款的买断，保护期内以打码形式出现）；`stats.undisclosedEpisodes` 公开「已计入但尚未逐行披露」的数量。15 §8 的三项指标采集点尚未单独接线。

**T5.3 已落地（偏离 PRD v2.2 Q8 的 15 分钟）**：Stripe Checkout 会话有效期下限是 30 分钟，待付窗口若短于会话，会出现"占位已作废、结账页仍可付款"（钱已收、交付物不在）。所以窗口取 35 分钟 = 30 + 5 分钟余量，会话 31 分钟。资格取消按账号计（`user_id`），错误码 `403 STEALTH_BUYOUT_SUSPENDED`；"同一设备"维度要等 T5.8 的设备指纹落地后再加。若要真正做到 15 分钟，需要在作废时主动调用 Stripe 的 expire session 接口，目前没有这条出站能力。

**T5.5 部分落地**：`WeeklySelectionService.getWeeklySelectedCase` 已实现选取逻辑，复用 `publication-policy` 的满额与关窗判定：只选槽位满额或当前为 `WINDOW_CLOSING` 的机会，M 轴 INSUFFICIENT 与买断保护期内的不选，空槽 `BUILD_NOW` 永不入选；7 天内无新案例时回退最近一条历史案例并标 `historical: true`。**尚未切换 Free Feed**：`feed_delay_days` 仍是 Free 层实时性的开关，Feed 页与 API 还没改读这个选取结果，也没有按周配额计数。切换前免费用户仍走延迟 Feed，所以没有泄露空槽窗口的风险。

**T5.4 部分落地**：`evaluateKillPredicate` 已在 `@emeradar/scoring` 按现存 `{metric, op, threshold}` 结构实现（指标限 `weak_result_ratio` 与三轴基点，畸形谓词或指标缺失返回 null，不当作未触发）；`KILL_CRITERIA` 已进入可订阅与可求值类型，每日流水线按机会求值一次并缓存，触发的谓词置 `TRIGGERED`，同一机会的多个订阅者都会收到。`SLOTS_LAST_ONE` 已实现（某形态剩余槽位恰为 1，每条规则只提醒一次），迁移 `0010` 放宽了 `alert_rules.rule_type` 的 CHECK，创建入口的 schema 开放 `KILL_CRITERIA` 与 `SLOTS_LAST_ONE`。`CUSTOM_QUERY_PULSE_CONFIRMED`、`PROJECT_SERP_RANK_JUMP` 两条首发触发器仍未实现；Email 投递沿用既有的告警邮件路径。

**T5.10 部分落地**：Pro 席位上限 30、Founding Lifetime 上限 50 已在 `StripeService.createCheckoutSession` 建会话（含开发模拟激活）之前校验，满额返回 `409 SEATS_FULL` 并带 `waitlist: true`；Founding 按永久到期的 PRO 订阅计数，Pro 席位为在期 PRO 订阅总数。校验与落账不在同一事务，并发下可能超卖一两席，严格化需要 webhook 侧再校验。「连续 2 周 0 产出自动延长 7 天」未做，且与 T1.7（产出守卫只告警、不自动改配置）的原则需要先裁决。

---

## 3. 依赖与顺序

```text
T1.9（生产 v2 纪元）──┐
T1.1–T1.5 → T1.8（SHADOW 14 天）→ sc-1.1.0 ACTIVE
T2.2 → T2.1（ev-1.1 冻结，硬期限：首批 v2 Episode 到 T+30 前）
T2.4 → T2.5（成本表）
T3.2 → T3.1 → T3.3 → T3.5（盲审）
            ↓
         Gate 0 → M5
```

- **T2.1 是全计划的硬期限**。错过它，`ev-1.1` 就成了事后定口径，H1 的结论作废，只能等下一批 Episode 再过 30 天。
- T1.3 与 T2.1 都动账本语义，合入前各跑一次 T2.6 全量重算。
- 新增列一律走 `migrations/0009+`，不改 `schema.sql`（改了会 checksum 失配，已部署库拒绝启动）。

## 4. 不做的事

- 冻结期内不做 23、27、29 的新功能（30 §5.1）。
- 不重建告警的「订阅组合」模型（12 文首差距表）；首发只把单值模型补完。
- 不引入 Redis 或新中间件（ADR-017）。
