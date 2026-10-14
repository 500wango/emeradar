# 18 — 测试策略与质量工程规格（QA & Test Strategy）

Status: Draft ｜ 依赖：01 §3 & §10、05 §10、06 §5、08 §10、09 §7 ｜ 被依赖：19

## 1. 目的与原则

本系统以“**不可篡改的预测战绩与可审计的证据链**”为核心信誉资产。任何评分不确定性、哈希链断裂、LLM 幻觉或数据泄露都将直接摧毁产品立足之本。

**核心原则**：
1. **确定性第一**：评分纯函数（`@app/scoring`）与账本哈希链（`@app/ledger`）实行 100% 严苛的 Golden 测试，杜绝跨架构、跨版本的浮点与时间漂移；
2. **LLM 结果必须经过确定性严查**：大模型生成的内容必须通过编译期般的自动化断言（Schema、硬数字占位符保真度、证据引用有向图），评测集纳入常规 CI；
3. **数据库不变量自动断言**：DDL 中的 I1 至 I14 不变量必须在 CI 集成测试中执行主动攻击测试；
4. **测试分层与轻量敏捷**：2–3 人团队不维护冗杂低效的低质用例，重点构建高价值契约测试与金字塔分层保障。

---

## 2. 测试分层金字塔（Test Pyramid）

```mermaid
flowchart TD
  E2E[端到端测试 E2E<br/>Playwright 核心主链路 5–10 个]
  LLM_EVAL[LLM 离线基准评测集<br/>U1–U6 结构化标注集]
  INTEG[集成测试 Integration<br/>DB 不变量 I1–I14 / pg-boss 队列 / Entitlement 并发]
  CONTRACT[契约测试 Contract<br/>OpenAPI 破坏性检测 / JSON Schema 校验]
  UNIT[纯函数单元测试 Unit<br/>@app/scoring Golden 固件 / 无前视测试 / 哈希链]

  E2E --> LLM_EVAL
  LLM_EVAL --> INTEG
  INTEG --> CONTRACT
  CONTRACT --> UNIT
```

---

## 3. 单元测试（Unit Testing）

### 3.1 `@app/scoring` 确定性评分测试（05 §10）
* **Golden 测试固件（Fixtures）**：
  * 在 `packages/scoring/test/fixtures/` 维护包含典型行业机会输入与上一日状态的快照集；
  * 断言：同一 `ScoringInput` 无论在 ARM64（开发机）还是 x86_64（CI 容器），生成的 `ScoringOutput`（三轴分档、Verdict、`explanation`）必须 **bit-for-bit 完全一致**；
* **边界与极端值**：
  * 阈值边界测试（Score = 74.99 vs 75.00，验证无浮点舍入跳档）；
  * 极端数据：宇宙规模 `< min_universe_size` 时 D 轴必须正确归为 `INSUFFICIENT` 并附带 `PARTIAL_DATA`；
* **严格无前视断言（No-Lookahead Test）**：
  * 向特征构建器注入 `observed_at > obs_date 23:59:59Z` 的未来快照数据，断言输出的分数与 Verdict 绝对不发生任何变化。

### 3.2 `@app/ledger` 哈希链与 Checkpoint（06 §4）
* **RFC 8785 JCS 规范化测试**：验证 JSON 键排序、浮点表示在极端字段下的哈希稳定性；
* **RFC 6962 Merkle 树断言**：测试奇数叶子节点、空节点与跨天串联的前后依赖一致性。

### 3.3 Query 规范化（14 §3）
* 运行 100+ 边界词测试集（含重音、多空格、全角符号、C++、.NET 等保护词），验证 `text_normalized` 的确定性。

---

## 4. 集成测试（Integration Testing）

采用 Testcontainers 或独立 PostgreSQL 测试容器，重点验证系统不变量与并发安全性：

| 测试用例模块 | 攻击场景与测试动作 | 预期断言 |
|--------------|--------------------|----------|
| **不变量 I1** | 应用角色执行 `DELETE FROM verdicts` 或 `UPDATE evidence` | 数据库触发器直接抛出 SQL 异常，操作被强行回滚 |
| **不变量 I2** | 尝试针对同一 `(opportunity_id, obs_date)` 插入两条 `is_override = false` 的行 | 命中唯一部分索引，抛出唯一键冲突 |
| **不变量 I8** | 创建机会时未关联 `role = 'PRIMARY'` 的查询，或尝试关联两条 PRIMARY 查询 | 事务中断或抛出排他唯一索引错误 |
| **配额并发预占** | 10 个并发线程同时发起 `EntitlementService.reserve()`，此时配额仅剩 1 | **恰好 1 个线程成功**，其余 9 个立即返回 `QUOTA_EXCEEDED`，`used` 计数器最终严格等于上限，绝无超卖 |
| **两级爬取降级** | 模拟 SPA 壳页面返回空文本，触发 Tier 2 检测 | 确认 `fetch_tier` 被标记为 `HEADLESS`，并正确调用无头浏览器驱动 |
| **S6 咨询锁互斥** | 两个 Worker 实例同时对同一 `obs_date` 调度 S6 账本归档 | 一个持有 `pg_advisory_lock` 执行批量写入，另一个跳过执行，绝不重复生成行哈希 |

### 4.1 交付闭环、槽位与反滥用用例（PRD §1.7、ADR-018、ADR-021）

以下用例覆盖首发商业闭环与防白嫖机制，均为发布前必过项：

| 用例 | 场景与测试动作 | 预期断言 |
|------|----------------|----------|
| **Fast-Track 快车道（05 §5.0）** | 机会 `history_days = 8`、`new_queries_7d = 4` 且斜率显著 | 允许以 7 天历史进入资格评估并打 `FAST_TRACK`；**不**因 < 14 天落入 `WATCH` + `PARTIAL_DATA` |
| **特征补偿 `RULE_BUILD_NOW_COMPENSATED`（05 §5.1）** | D=HIGH、W=HIGH、M=MEDIUM（≥2 独立定价站或初现交易代理）、conf ≥ MEDIUM | `raw_verdict = BUILD_NOW`，`explanation` 命中 `RULE_BUILD_NOW_COMPENSATED`；M=LOW 或无 observed 证据时**不得**补偿 |
| **按形态切分槽位（ADR-018）** | 机会含 `[TOOL×2][PSEO×2]`；仅 TOOL 两个槽被占 | **不得**熔断（不置 `isCrowdedLocked` / `WINDOW_CLOSING`），W 轴照常计算；仅当 `Σclaimed == Σcapacity` 全部形态占满时才熔断。反例：任一形态空槽即不熔断，必须断言 |
| **原子 GO 并发（ADR-018、10 §原子 GO）** | 4 个用户并发对同一形态仅剩 1 槽点击 GO | **恰好 1 个成功**（占槽 + 扣月度导出配额 + 建 Project + 解锁该形态点火包在**同一事务**内完成），其余立即失败；`opportunity_slots.claimed`、`slot_claims` 与 `usage_counters` 三方一致，无超卖 |
| **承诺质押 3 类凭证（PRD F10）** | 分别提交 `DOMAIN_URL` / `STORE_LISTING_URL` / `PUBLIC_PAGE_URL`，探针 `<title>`/`<h1>`/`<meta>` 相关性通过 | 三类均置 `stake_status = VERIFIED`，槽位保留；探针不相关或超时则 `REJECTED` |
| **质押 7 天逾期释放且配额不退（PRD §1.7 第 5 条、03 I12）** | GO 后 7 天内未提交凭证或不通过 | `stake_status = EXPIRED_RELEASED`，槽位释放回公共池，`slot_claims` 与 `opportunity_slots.claimed` 同步递减；**已扣减的月度导出配额不退还** |
| **处女地独占买断（03 I13、PRD §1.7 第 5 条）** | ① `Σclaimed == 0` 下单；② 已有任一用户 GO（`Σclaimed > 0`）后下单；③ 同一用户已有一笔待付占位时再下单；④ 待付占位超窗口后**不跑任何作业** | ① 成功生成 `stealth_locks(ACTIVE)` + `stealth_lock_displays`（账本打码 60 天）；② **下单事务必须被拒** `422`，买断按钮置灰并**写明原因**；③ `409 STEALTH_LOCK_PENDING` 且附续付链接，不产生第二把锁；④ 机会自行重新可见（判据自愈，见 03 §17 I13——把正确性挂在作业上等于让一次调度故障变成无尽遮蔽） |
| **买断可见性矩阵（10 §7）** | 保护期内，持有者与非持有者分别请求 Feed / 详情 / 研报 / 槽位 / 告警规则（创建**与列表**）/ 通知列表 / 公开页 / 公开战报 | Feed 与比较对**双方都**排除；详情 / 研报 / 槽位 / 告警规则 / 通知对持有者 `200`、对非持有者 `404`（与"不存在"同形，列表类是**该行不出现**）；公开页 `200` 且已打码；公开战报里该 Episode **仍在**分子分母，只是标题被替换 |
| ↑ 该矩阵的两条执行纪律 | ① **按数据枚举读路径，不按函数清单**：凡是能返回该机会标题 / slug / 词根 / id 的端点都算在内。首发演练正是在这里查出一条侧门——研报端点原样返回 21 KB 全文，而"我接线了哪几个函数"这张清单看起来是齐的。② **判据落在服务层，不只加在路由上**：路由挡得住 HTTP，挡不住服务层直调（点火包就是直调） | ② 的反例可验：删掉 `ReportService.getOrGenerateReport` 的 `viewerId` 判据、只留路由上的检查，点火包那条路径就会在保护期内吐出真实标题 |
| ↑ **两处刻意例外，不是漏网**（10 §7） | ① 告警规则 / 通知**列表**是整行不出现，不是把标题打码（行里的 `opportunity_id` 直接嵌了 slug）。② 用户**自己已经建好的项目**（`GET /projects`、`/projects/{id}`）上的机会字段**照常显示**。扫描时这两处会命中词根，属预期 | ② 必须断言**能看到**：买家买的是向前的「不被发现、不被占用」，读者早就掌握了该机会，抹掉标题只会把用户自己的看板弄坏。把它当漏网"修"掉是本条的主要回归风险 |
| **打码时机：挂在付款上，不挂在占位上**（15 §3.1 第 7 条） | 对一条**已有真实公开页**的处女地机会下单（未付款），此时分别读 API 详情与公开页 | API 侧对非持有者 `404`、Feed 里不出现；公开页**仍是真实 slug 的 200 且未打码**——本条**必须断言"没被打码"**。提前打码等于给一个不付款的 Pro 用户一根把任意公开页踢出 sitemap 的杠杆（`STEALTH_LOCK_PENDING` 只限流、不授权）。付款落账后同一页才必须变成打码态 |
| **买断打码不泄漏（10 §8.4、15 §8，0 容忍）** | 取一条词根独特的被买断机会，扫全部 `/api/v1/public/*` 响应体 | 响应体（含 `<title>`、slug、JSON-LD、公开战报）中**扫不到真实词根子串**；`is_stealth_masked` / `masked_label` / `unmasked_at` 三个字段齐备 |
| **反滥用-邮箱归一化（13 §7.1、17 §2.5）** | 同一自然人用 `j.doe+free@gmail.com` 与 `jdoe@gmail.com` 先后注册领取终身免费初筛 | 归一为同一 `canonical_email`，第二次领取被拒；非 Gmail 域**不**剥离点号（不同人不得误合并） |
| **反滥用-指纹 30 天限流（03 §2）** | 同一 `fingerprint_hash`/`ip_hash` 30 天内第二次触发免费实时初筛；随后注销账户并重注册 | 第二次被拒；注销后 `lifetime_scan_grants` 哈希**保留**（`user_id` 置 NULL）、`device_fingerprints` **删除**，重注册仍无法再领 |
| **两阶段初筛与半遮罩可见性（F3）** | Free 用户提交自定义词；Pro 用户提交同词 | 第 1 阶段 5 秒内返回静态初筛卡；Free 的具体弱结果 URL、收钱竞品域名与 15 长尾词在**API 响应与渲染层双重不可得**（高斯模糊），Pro 全量可见 |
| **`STALE_DATA` 72h 宽限（ADR-021、05 §5.3）** | 某源 72 小时内偶发失败 | 沿用最近成功快照档位并打 `STALE_DATA`；**不发布降档 Verdict、不投递降级告警**；连续失败 73 小时后该轴才置 `INSUFFICIENT` 并恢复降档与告警 |
| **`WINDOW_CLOSING` 的 14 天约束（05 §5.1）** | ① 降档发生在 `obs_date` 前 14 天内且 `prev.verdict ∈ {BUILD_NOW, EARLY_BET}`；② 降档发生在 30 天前或无前置已发布裁决 | ① 触发 `WINDOW_CLOSING`；② **不得**触发，低 W 只能落入 `WATCH` 或 `PASS` |

---

## 5. 契约测试（Contract Testing）

* **OpenAPI 兼容性断言**：
  * CI 中从 Zod 领域模型动态生成 `openapi.json`，使用 `oasdiff` 与主分支基线比对；
  * 若存在未经显式批准的破坏性变更（Breaking Change，如删除字段、修改枚举类型），直接阻断 PR 合并；
* **机会报告 Schema 校验**：
  * 校验生成的报告 JSON 是否 100% 符合 `packages/report/schema/report-1.0.json` 规范。

---

## 6. LLM 评测集体系（Evaluation Suites）

评测用例集纳入独立版本化目录 `packages/llm/evals/`，分为快速抽样集（PR 阻断）与全量评测集（夜间执行）：

| 任务 | 评测集规模 | 黄金标准来源 | 核心指标与门槛 | 执行频率 |
|------|------------|--------------|----------------|----------|
| **U1 实体归并** | 300 对同义/近邻候选 | 人工双盲标注 | 自动归并准确率 ≥ 95% | 夜间 |
| **U2 SERP 分类** | 500 个真实 SERP 网页 | 资深 SEO 分析师标注 | `result_type` 宏 F1 ≥ 0.85；`is_specialist` F1 ≥ 0.88 | 夜间 |
| **U3 定价抽取** | 200 个多样化定价页 | 人工提取真实价格表 | 价格数值与套餐名称精确匹配率 ≥ 98% | 每次 Prompt 修改 |
| **U4 解释文本** | 50 条每日 Why Now 样本 | 事实包与生成比对 | 自动占位符解析率 100%；事实一致性 ≥ 95% | PR 抽检 |
| **U5 机会研究报告** | 20 份真实机会报告样本 | 见 §7 评测计分卡（Rubric） | **Rubric 得分 ≥ 7/8 且 R1、R2 零容忍项 100% 达标** | 发布新模型前 |
| **U6 本地化** | 每语言 100 组翻译对 | 双语对比 | 占位符、硬数字与证据引用保真度 100% | PR 抽检 |
| **U7 点火包装配** | 每个 Build Type / 形态各 10 份 | 见 §7.1 点火包 rubric（L1–L6） | **Rubric 得分 ≥ 5/6 且 L1、L2 零容忍项 100% 达标** | 发布新模型前 |

---

## 7. 机会研究报告评分体系（Rubric Scorecard，09 §7）

由 2 名独立评审对生成的机会分析报告执行双盲评审打分：

| 维度 | 检查内容 | 分值 | 一票否决？ |
|------|----------|------|------------|
| **R1. 事实引用有效性** | 文中所有事实陈述必须附带合法证据引用，且数字由确定性占位符正确渲染 | 1 分 | **是（未通过总分记 0）** |
| **R2. 零编造（No Hallucination）** | 不存在未经快照佐证的凭空捏造竞品、虚构价格或虚假市场结论 | 1 分 | **是（未通过总分记 0）** |
| **R3. 占位符渲染完整性** | 报告最终渲染文本中绝不残留未解析的 `{{Fx.field}}` 占位符 | 1 分 | 否 |
| **R4. SERP 弱点客观性** | 竞品与弱对手分析明确对应到 Top10 快照中的弱结果 URL | 1 分 | 否 |
| **R5. 变现建议诚实度** | 变现路径严格受 M 轴证据强度约束，未经验证必须明确标明 | 1 分 | 否 |
| **R6. 推荐形态合理性** | 出货形态符合搜索意图矩阵（高交互做 Tool，聚合做 Directory/PSEO） | 1 分 | 否 |
| **R7. 止损红线明确度** | 必须包含至少 1 条可落地的 Kill Criteria 条件 | 1 分 | 否 |
| **R8. 时效与免责声明** | 明确标注观测基准日，附带标准免责声明 | 1 分 | 否 |

### 7.1 点火包评分体系（Launch Kit Rubric，09 §5）

PRD §3.3 要求「机会报告与点火包 rubric 通过率」并列达标，故除报告 R1–R8 外，另设点火包（按所选 Build Archetype 动态装配）rubric，由 2 名独立评审双盲打分：

| 维度 | 检查内容 | 分值 | 一票否决？ |
|------|----------|------|------------|
| **L1. 形态绑定一致性** | 点火包形态与 GO 所选 Build Archetype 一致，未混入其他形态的模板或词表 | 1 分 | **是（未通过总分记 0）** |
| **L2. 硬数据占位符注入** | 词表、竞品价格、搜索动量等硬数字 100% 由确定性模板注入，无 LLM 编造（ADR-019） | 1 分 | **是（未通过总分记 0）** |
| **L3. PSEO 词表可导入** | `slug` / 关键词 / 建议 `<title>` / `<h1>` / Meta 模板齐全，可直接导入 Next.js / Astro 路由 | 1 分 | 否 |
| **L4. 工程规范可执行性** | `CLAUDE.md` / `.cursorrules` 的技术栈、MVP 边界、避坑指南具体可执行 | 1 分 | 否 |
| **L5. 落地页文案证据锚定** | Hero / 痛点 / 定价文案锚定 F7 已观测证据，未越出 M 轴证据强度 | 1 分 | 否 |
| **L6. 语言边界正确** | 词表与落地页文案保持 `research_language`（`en-US`），仅说明文字随 `ui_locale`（14 §5.4） | 1 分 | 否 |

通过线：**≥ 5/6 且 L1、L2 零容忍项 100% 达标**。点火包 rubric 与报告 rubric 分别统计，任一不达标不得放行 Gate 0 / Gate 1。

---

## 8. 端到端自动化测试（E2E Testing）

基于 Playwright 编写 3 条核心用户黄金链路（运行于 Staging 回放环境，不消耗生产预算）：
1. **Onboarding → Feed 决策流**：新用户完成 4 问偏好问卷 → 浏览 Feed → 筛选 S 级周末工具 → 打开 Detail → 展开证据抽屉查看证据 → 点击 `GO` 并输入理由；
2. **机会报告导出 → Project 立项流**：针对 GO 状态机会触发生成 → 验证报告 6 大分析板块正常渲染 → 一键导出 Markdown / PDF / JSON → 原子 GO（选择 Build Archetype，同一事务内占槽 + 扣导出配额 + 建 Project + 解锁该形态点火包）；
3. **公开站 SEO 渲染流**：访问 `/track-record` 验证 Cohort Hit Rate & Accuracy Matrix 渲染与底栏 Merkle 根校验入口正常 → 访问**准实时精选机会页**（`CROWDED_LOCKED` / `WINDOW_CLOSING` 口径，PRD §7.1 已废除 45 天延迟）验证 `noindex` / `indexable` 标签符合预期。

---

## 9. 持续交付流水线质量门禁（Quality Gates）

```mermaid
flowchart LR
  PR[提交 Pull Request] --> G1[Gate A: 代码静态质检<br/>TypeScript / ESLint / Prettier]
  G1 --> G2[Gate B: 确定性纯函数测试<br/>Scoring Golden / Ledger / oasdiff]
  G2 --> G3[Gate C: DB 不变量集成测试<br/>Testcontainers I1–I14 验证]
  G3 --> MERGE[允许合并至 main]

  MERGE --> NIGHTLY[夜间流水线 Nightly]
  NIGHTLY --> G4[Gate D: 1% 历史账本重算一致性校验]
  NIGHTLY --> G5[Gate E: 全量 LLM 评测集跑分]
```

* **夜间账本全链自检任务（06 §5）**：
  * 从首日 Checkpoint 起，重现近 60 天全部 Verdict 的行哈希与 Merkle 根；
  * 若发现任何一行哈希不匹配，立即挂起夜间流水线并触发 P0 告警，定位快照污染来源。
