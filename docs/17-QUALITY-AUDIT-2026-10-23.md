# 机会质量审计修复记录（2026-10-23）

对应《Emeradar 机会质量审计与分阶段修复方案》（2026-10-23，基线
`2c14f3333121d5804f9d4bdf4ee0b846081ae301`）。本文记录每个问题的修复方式、
验收方式、风险与回退路径。

## 修复总览

| 审计项 | 级别 | 修复提交 | 状态 |
| --- | --- | --- | --- |
| 01 查询假设经弱验证进入实验卡 | P0 | `fix(pipeline): 任务价值 Gate + 查询级 SERP 满足度` | 已实现 |
| 02 页面分类未接收目标查询 | P0 | 同上 + `fix(scoring)` page-classifier-v3 | 已实现 |
| 03 Feed 默认按 D 分排序 | P0 | `fix(feed): 首屏只出可构建机会` | 已实现 |
| 04 需求增长代理指标伪增长 | P0 | `fix(scoring): 拆分「新发现」与「增长」` | 已实现 |
| 05 pageDiscount 未参与评分 | P1 | `fix(scoring): SERP 弱度加总应用 pageDiscount` | 已实现 |
| 06 商业抽样覆盖 Gate 默认关闭 | P1 | `fix(scoring): 覆盖不足封顶 MEDIUM 并标 PENDING` | 已实现 |
| 07 入口种子缺 ICP 约束 | P1 | `fix(seed): 候选入池前过 ICP 过滤器` | 已实现 |
| 工作单 2/3/7（导出、bad_reason、影子重算） | — | `feat(quality): 质检标注结构与两个只读工具` | 已实现 |

评分口径版本随输出变化一起升级：`sc-1.3.0` → `sc-1.4.0`；页面分类器
`page-classifier-v2` → `page-classifier-v3`。**历史账本行保留各自版本，
不追溯改写。**

## 逐项说明

### 审计 01 — 任务价值准入 Gate

- 新增 `packages/services/src/task-verification.ts`（`task-verification-v1`）：
  确定性三档 `TASK_VERIFIED / TASK_UNVERIFIED / TASK_REFUTED`。REFUTED =
  新闻/事件型标题或裸导航词；VERIFIED = 非新闻且至少一条独立需求信号
  （UGC/QA 讨论、目录收录、确证满足查询的专属供给、任务型联想词）。
- `validate-discovery-intents`：验证结论与依据随验证落库
  （迁移 0047：`discovery_validations.task_status / task_evidence`）；
  REFUTED 的 intent 直接置 `REJECTED`，不再晋级 OBSERVED。
- `generate-experiment-cards`：只认最近一次验证为 TASK_VERIFIED 的 intent。
- 验收：新闻标题即使 SERP 非空也只能停在 REJECTED/HYPOTHESIS；
  无独立需求信号的样本不产生实验卡（`task-verification.test.ts`）。

### 审计 02 — 查询级任务满足度

- `classifyPage(url, title, snippet, query?)` 新增 `queryRelevance`
  （`SATISFIES / NOT_SATISFIED / UNKNOWN`），与页面性质（`resultType`）拆分；
  证据不足一律 UNKNOWN。分类器版本升 `page-classifier-v3`。
- SERP 弱度：只有**确证** NOT_SATISFIED 按低相关处理（+0.2）；
  UNKNOWN 与缺省不改变分数——不可靠证据不提高缺口分。
- 供给缺口（discovery 验证）：专属工具页计数只吃确证满足查询的结果；
  存在工具页但无一可确证满足时，缺口状态是 `UNKNOWN` 而不是自动当缺口。
- 落库：迁移 0047 `serp_results.query_relevance`；采集器把满足度写进
  快照条目与证据载荷。
- 验收：同一产品页对匹配/不匹配查询得到不同满足度
  （`query-satisfaction.test.ts`、`task-verification.test.ts` 管线集成）。

### 审计 03 — Feed 分栏与排序

- `OpportunityService.listFeedCards` 新增 `track`（默认 `BUILDABLE`）：
  首屏只出 `BUILD_NOW / EARLY_BET` 且置信度非 LOW；`WATCHLIST`（WATCH）、
  `EXCLUDED`（PASS / WINDOW_CLOSING）、`ALL` 各自分栏。
- 排序改为裁决质量 → 置信度 → D 分 → 观测时间。
- 兼容：显式 `verdict / verdicts / opportunityIds` 的调用方（每周精选、
  遥测、审查台）语义不变。API 新增可选 `track` 参数；Feed UI 默认
  「可构建」tab，新增 PASS 栏。
- 验收：WATCH/PASS 不进默认首屏；BUILD_NOW(9000) 排在 EARLY_BET(9500) 前
  （`feed-tracks.test.ts`）。

### 审计 04 — 拆分「新发现」与「增长」

- `demand.ts`：评分只吃 `newQueriesPersistent7d`（近 7 天 ≥2 个观测日
  重复出现的新联想词）；`growthBaselineDays < 30` 时增长分量清零、
  非 fast-track 路径 HIGH 封顶 MEDIUM，理由声明 new-discovery only。
- `observe-opportunity`：新增持久新词查询并把 `historyDays` 作为基线传入；
  featureMetrics 记 `new_queries_persistent_7d`。
- 验收：补齐旧词/加深采集不得抬高需求分；缺基线不得产生 HIGH 增长档
  （`demand-growth-baseline.test.ts`）。
- 说明：fast-track（7 天突进，自带 FAST_TRACK 标志）是既有产品决策，
  不受基线封顶，但其理由文本同样声明增长不可测。

### 审计 05 — pageDiscount 参与加总

- 语义定为「对窗口开放度的贡献折算」：首页 1.0、专属落地页 0.65、
  大站无意内页 0.45，加总公式使用 `discountedWeakness`（逐字段可见），
  与「45% 折算」结论文案一致。逐条 `totalWeakness` 保持未折算。
- 验收：同强度占位，首页 > 落地页 > 内页；`isWeak` 不因折算翻转
  （`serp-page-discount.test.ts`）。

### 审计 06 — 商业覆盖「待验证」分层

- `bandM` 新增 `commercialVerification: 'VERIFIED' | 'PENDING'`：
  覆盖不足时 HIGH 封顶 MEDIUM 并标 PENDING（不授予高可信商业标签）；
  `enforceCoverageGate` 保持默认关闭（避免 Feed 干涸），开启时维持
  INSUFFICIENT 行为并同样标 PENDING。无覆盖数据的存量调用方 VERIFIED。
- 验收：覆盖不足 + 强付费证据 → MEDIUM/PENDING（`commercial-coverage.test.ts`）。

### 审计 07 — ICP 过滤器

- `seed-keyword-candidates`：`ICP_CARRIER_TAGS`（`gpu_media`、`regulated`）
  + `SEED_ICP_EXCLUDE`（默认 `gpu_media,regulated`，空串关闭）。被排除载体
  记入 `excludedSeeds`，入池候选的 `candidate_reason` 带 ICP fit 标记。
- 验收：video generation / payroll compliance 出局，CSV validator / JSON diff
  通过（`seed-icp.test.ts`）。

## 质检与回放流程（审计「质量评估方式」）

1. 导出样本（只读）：
   `tsx src/scripts/export-quality-sample.ts --limit 50 --out /tmp/qc.csv`
   —— 按裁决分层取样，`label_*` 与 `bad_reason` 列留人工填写
   （bad_reason 枚举见 `packages/services/src/quality-audit.ts`）。
2. 人工标注：逐条填 `label_VALID_TASK / DEMAND_EVIDENCE / SERP_SATISFACTION /
   MONETIZATION_EVIDENCE / SOLO_BUILDABLE / FINAL_GO` 与 `bad_reason`，留链接。
3. Precision@10：`computePrecisionAtK(labels, 10)` 计算前后对比。
4. 影子重算（只读，不覆盖账本）：
   `tsx src/scripts/shadow-rescore.ts --since <日期> --out /tmp/shadow.ndjson`
   —— 用 sc-1.4.0 重放历史封存输入，输出逐字段差异与汇总
   （verdictFlips / 各轴档位变化数）。
5. 切换标准（沿用审计停止条件）：样本不足不调权重；影子对比未确认优于
   基线不切生产；样本量与人工标注由运营侧完成。

## 测试与构建状态（本分支提交时）

- scoring 102/102；services 392/392；collectors 57/57；db 4/4；ledger 30/30；
  report 25/25；`pnpm test`（turbo 全仓）20/20 任务成功；`pnpm build` 10/10。
- 冒烟：`export-quality-sample` 与 `shadow-rescore` 在开发库各跑一次（只读），
  均 0 行——与「生产管线至今没有真实产出、账本无 hash_version≥2 行」的现状一致；
  脚本本身可运行。

## 已知的后续工作（不在本次范围）

- 报告与点火包的词表仍无词量/意图来源（既有问题，见 repo 记忆）。
- `enforceCoverageGate` 开启前需按审计做影子误杀率统计。
- TASK_VERIFIED 目前是启发式代理判据；「目标用户/输入输出」级审查留给
  人工标注流程与后续模型审查。
- Precision@10 前后对比需要人工标注的真实样本，静态修复无法产出该数字。
