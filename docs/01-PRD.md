# 01 — 产品需求文档（PRD）

**产品类别**：Search Opportunity Intelligence for Builders
**文档状态**：Draft for decision
**说明**：文中所有数值阈值均为初始假设，须在 Phase 0 用真实数据校准，并写入版本化的 `scoring_config`。

---

## 1. 产品概述

### 1.1 要解决的问题
独立 Builder 每次启动一个新站或工具，都要为"做什么"花上数周研究，最终多半靠直觉拍板。他们无法回答三个问题：

1. 搜索需求是不是真的在形成？
2. 竞争窗口是否还开着？
3. 是否已经有人在为这件事付钱？

传统 SEO 工具服务于"已选定关键词后的优化"，趋势工具只告诉你什么在涨。没有工具把"需求形成 + 竞争窗口 + 商业证据 + 怎么开工"放进同一个可审计的决策里。

### 1.2 产品定义
**在窗口关闭之前，帮独立 Builder 决定下一个做什么；用可审计的证据支撑判断；交付一份权威、客观的商业机会研究报告（Opportunity Report）；并用公开、不可篡改的预测战绩证明判断是对的。**

### 1.3 目标用户（ICP）
| 类型 | 说明 |
|------|------|
| **主要** | 独立开发者 / Micro-SaaS / 工具站 Builder：每月愿意新上线至少 1 个站或工具，使用现代化工具交付 |
| **次要** | Programmatic SEO 运营者（可使用，不专门优化） |
| **不服务** | 小型 Growth 团队、Domain 研究员、纯内容 / 联盟站运营 |

> 假设：主要用户为华语出海 Builder，目标市场为 en-US。见 §12 决策 1。

### 1.4 用户核心决策
用户不是来"查词"，而是来完成四个决策：

**做不做 → 为什么 → 做什么形态 → 商业验证与风险底线。**

### 1.5 差异化
1. **时间戳证据链**：每条结论可追溯到 `evidence_id` 与不可变快照，没有黑盒分数。
2. **诚实的商业信号分级**：observed / self-reported / estimate / inferred 严格分类，永不混算；明确"这些证据证明了什么、没有证明什么"。
3. **出货闭环与公开战绩**：机会 → 机会研究报告 → Project → GSC 结果回流；预测账本公开命中与失误。

### 1.6 非目标
- 不做 Ahrefs / Semrush 的全功能替代；不以 Keyword Difficulty / 反链库为核心。
- 不做「输入任意关键词、当场给出裁决」的搜索审计。用户申请追踪一个词，只创建观察记录。
- 不做创意目录，不展示未经观测的收入区间。
- 不做纯热点新闻工具，不把新闻、代码仓库、问答、百科穿插后称作 Google 自然排名。
- 不依赖单一数据源生存。每个源只服务一条轴，失败时该轴为 `INSUFFICIENT`。
- 首发不做团队协作、组合管理、多研究市场、开放 API、对话式助手、程序化 SEO 页面。

### 1.7 首发商业产品
首发卖的是每日少数可执行决定，以及这些决定事后能否被复盘。完整包装、页面与门槛见 `20-COMMERCIAL-RELEASE.md`。这里只锁定会改变行为的规则：

1. **发布资格先于裁决。** 主查询的联想观测少于 14 天，或还没有一份单一来源的自然搜索结果快照，或任一关键轴为 `INSUFFICIENT`，或置信度为 `LOW`：不得发布 `BUILD_NOW`、`EARLY_BET`、`WINDOW_CLOSING`。记录状态为 `CANDIDATE`，裁决为 `WATCH`，并带 `PARTIAL_DATA`。信息流不展示 `CANDIDATE`。
2. **窗口关闭有前置裁决。** `WINDOW_CLOSING` 只可能来自一条已经发布的 `BUILD_NOW` 或 `EARLY_BET`，且 W 在 14 天内下降至少一档。当天竞争看起来不强，不是窗口关闭。
3. **商业高档要有观测。** 查询里出现 pricing、tool、api 等词只是 `INFERRED`，M 轴最高为 `LOW`，且不能单独把机会推进 `BUILD_NOW`。`HIGH` 仍要求至少两个独立域名上的 observed 定价或结账。支付按钮只证明有收款设施。
4. **信息流回答做不做。** 每天最多 10 条已发布机会，默认页是 `BUILD_NOW`。`EARLY_BET` 必须标明「商业未验证」。卡片显示分档，不把基点当成百分制主视觉。
5. **动作闭环。** 已发布的 `BUILD_NOW` / `EARLY_BET` 可以关注、做、放弃、导出报告。「做」写入 `decisions` 并创建 Project，绑当时的 `verdict_id`。放弃必须选择原因。「做」不能作用在 `CANDIDATE` 上。
6. **付费物。** Free：战绩、延迟 45 天的机会摘要、每月 1 份报告预览且不能导出。Pro：实时信息流、完整详情、每月 30 份报告导出、关注与邮件告警、项目追踪。首发不卖 Team，不把 API 当作套餐卖点。
7. **对外数字。** 在战绩页同时有命中和失误、并写明样本数与 T+30/60/90 之前，首页、徽章和广告不得出现预测准确率。不得写「扫描了数百万查询」除非数据源登记里有对应体量。

研究市场首发固定为美国英语（`market_country = US`，`research_language = en-US`）。每张卡片写明这一点。界面可以是英语或中文，原始查询和证据标题不翻译。

---

## 2. 产品原则

| ID | 原则 |
|----|------|
| P1 | **证据先于分数**：任何结论可追到 `evidence_id` + `snapshot_id` |
| P2 | **诚实标签**：证据类别永不混算；"数据不足"不等于"低" |
| P3 | **决策优先**：每个界面回答"做 / 不做 / 等"，而不是展示数据 |
| P4 | **出货导向**：产品的成功以用户出货衡量，不以浏览衡量 |
| P5 | **时间是资产**：快照不可变、账本只追加；越早采集越有价值 |
| P6 | **管理自己的拥挤效应**：同一个窗口不能无限卖给所有人 |
| P7 | **可重算**：分数与结论由确定性规则和版本化配置计算；LLM 不决定分数 |

---

## 3. 成功标准

### 3.1 北极星指标
**Activated Builds / Month**：过去 30 天内，从机会 GO 并已上线（绑定 URL 或 GSC property）的项目数。

### 3.2 可证伪假设
| ID | 假设 | 验证方式 | 初始通过线 |
|----|------|----------|-----------|
| H1 | "autocomplete 新增 + SERP 偏弱 + 增长"的早期信号能预测搜索市场的形成 | 预测账本 T+30/60/90，对照基线（同池随机；Google Trends 上升榜） | Top-decile 机会的 60 天市场形成事件率 ≥ 基线 3× |
| H2 | 有 observed 商业证据的机会更值得做 | Design partner 结果 + GSC 数据 | 定性成立，样本持续积累 |
| H3 | Builder 愿意为"决策 + 起手包"付费 | 预售访谈 | ≥ 20 访谈，≥ 8 人预付或签意向 |
| H4 | 机会研究报告显著提升 Builder 的立项信心与出货转化 | Design partner 跟踪 | GO 后 30 天内出货率 ≥ 30% |

任一假设不过线：先修假设，不增加功能。

### 3.3 指标体系
- **漏斗**：Feed → Detail → GO → 机会报告导出 → Project 创建 → Launch → GSC 已连接 → 30 天留存。
- **质量**：
  - Market-formation precision（自动、代理指标）：已发布 verdict 的 T+30/60/90 市场形成事件命中率。
  - Builder-outcome precision（GSC 真实结果）：样本量 ≥ 30 个项目前，仅内部参考。
  - 机会报告 rubric 通过率。
  - PASS 理由分布。
- **获客**：landing → opportunity exploration / signup；public opportunity → signup；pricing → checkout；有机注册 → 激活 / 付费；可观测的 AI 搜索助手引荐会话。

### 3.4 反指标与护栏
- **反指标**（禁止作为目标）：机会浏览数、页面数、纯流量。
- **护栏**：单机会月数据成本；毛利率；误报申诉数；告警退订率。

---

## 4. 用户旅程

### 4.1 首次使用
回答至多 4 个问题（见 F12）→ 直接进入个性化 Feed → **10 分钟内看到至少 1 个 BUILD NOW 或 EARLY BET 机会的完整详情**。

### 4.2 每日循环
Feed → Detail → Compare（可选）→ GO / PASS / Watch → 机会报告导出 → 创建 Project → 上线 → 追踪结果。

### 4.3 告警循环
Watch 的机会发生变化（verdict、窗口关闭、Kill criteria 命中）→ 通知 → 回到 Detail 决策。

### 4.4 每周回顾（Phase 2）
本周新机会、Watchlist 变化、窗口关闭中的机会、已建项目表现。

---

## 5. 核心概念与决策模型

### 5.1 核心对象
| 对象 | 说明 |
|------|------|
| Opportunity | 一个实体 + query cluster + `market_country` + `research_language` |
| Evidence | 带类别、来源、时间戳的最小事实单元 |
| Snapshot | SERP / autocomplete / 商业信号的不可变快照 |
| Verdict | 某个 `scoring_config` 版本在某时点对 Opportunity 的判断 |
| Prediction Ledger | 所有已发布 Verdict 的 append-only 记录；回测、回放、战绩页共用同一数据源 |
| Project | 用户从 Opportunity 创建的实际项目，关联 GSC |

### 5.2 三个互相独立的语言与地域概念
| 概念 | 含义 |
|------|------|
| `ui_locale` | 界面与系统消息语言 |
| `research_language` | 关键词、搜索需求、内容分析的目标语言（BCP 47） |
| `market_country` | SERP、趋势、商业化与竞争分析对应的国家 / 地区（ISO 3166-1 alpha-2） |

任何一个都不得隐式覆盖另一个。

### 5.3 `first_observed`
时间字段统一为 **首次被本系统观测到（`first_observed`）**，不等同于"世界上首次出现"。界面使用"首次观测"字样；Methodology 页披露观测起始日期与覆盖范围。

### 5.4 证据类别
| 类别 | 含义 | 对商业验证（M 轴）的作用 |
|------|------|--------------------------|
| `observed` | 系统直接观测（定价页、checkout、公开计数器、平台披露的销售数据） | 可参与全部评级 |
| `self_reported` | 当事人自报，必须显式标注 | 可参与评级，但不能单独达到 High |
| `third_party_estimate` | 第三方估算，必须显式标注 | 仅展示；无 observed 佐证时权重为 0 |
| `inferred` | 系统推断（如商业意图查询） | 仅可支撑 Low 与 Medium 之间的判断 |

**硬性规则**：检测到 Stripe / Paddle / 支付按钮，只证明"存在变现基础设施"，不等于有收入。矛盾证据必须保留并展示，不得被覆盖。

### 5.5 三轴与证据置信度
每轴分档：`High` / `Medium` / `Low` / `Insufficient`（数据不足）。另有 **Evidence Confidence**：High / Medium / Low，由独立来源数、新鲜度、observed 占比决定。

| 轴 | 回答的问题 | 主要输入 |
|----|-----------|----------|
| **D — Demand Formation** | 需求是否在形成 | autocomplete 新增与增长（7/30/90 天）、query cluster 扩展、跨源关注触发；绝对搜索量若有来源，仅作 estimate 展示 |
| **M — Commercial Proof** | 是否已有钱在流动 | 商业信号引擎（F7） |
| **W — Entry Window** | 窗口是否还开着 | SERP 弱度、竞争变化率、权威新进入者、平台内拥挤度 |

### 5.6 M 轴分档规则（初始值）
- **High**：≥ 2 个独立域名存在 observed 定价 / checkout，且满足以下之一：① ≥ 1 条营收 / 销售证据（observed 平台披露，或标注的 self-reported）；② 定价 / checkout 在 ≥ 90 天的快照中持续存在。
- **Medium**：≥ 2 个独立域名有 observed 定价 / checkout，但无营收证据且持续性不足；或存在 observed 的类目 / 类比验证。
- **Low**：仅有商业意图查询，或仅检测到支付 provider。
- **Insufficient**：采样不足。
- 强负面信号（如竞品下架付费层、公开退款潮）可降档。

### 5.7 Verdict（按顺序评估，首个命中即生效）
| Verdict | 条件（初始值） |
|---------|---------------|
| **BUILD NOW** | D ≥ Medium ∧ M = High ∧ W ≥ Medium ∧ Confidence ≥ Medium |
| **EARLY BET** | D = High ∧ W = High ∧ M ∈ {Low, Medium, Insufficient}；界面明确标注"商业未验证" |
| **WINDOW CLOSING** | 此前已发布的裁决为 BUILD NOW / EARLY BET，且 W 在 14 天内下降 ≥ 1 档。没有前置发布裁决时，低 W 落入 WATCH（数据不足）或 PASS（窗口确已关闭且需求档不是 INSUFFICIENT），不得叫窗口关闭 |
| **WATCH** | D ≥ Medium，且不满足以上任一条件 |
| **PASS** | D = Low，或 M 出现强负面信号，或 W = Low |

目标稀缺性：BUILD NOW 占已发布（`status = TRACKED` 且通过 §1.7 发布资格）机会的 ≤ 5%。稀缺是特性，不是缺陷。未通过发布资格的行留在 `CANDIDATE`，不计入这个比例，也不进入默认信息流。

### 5.8 机会生命周期（市场状态）
`FORMING` → `EARLY_WINDOW` → `CONTESTED` → `MATURE` → `DEAD`

| 转换 | 规则（初始值，配置化） |
|------|-----------------------|
| FORMING → EARLY_WINDOW | D ≥ Medium ∧ W ≥ Medium |
| EARLY_WINDOW → CONTESTED | W 下降 ≥ 1 档，或 Top10 新增 ≥ N 个 specialist / 权威竞品 |
| CONTESTED → MATURE | 竞争结构稳定 ≥ 60 天，且 velocity 趋平 |
| 任意 → DEAD | 需求指标下降并持续 ≥ 60 天 |

每次转换记录：`from / to / rule_id / evidence 与 snapshot ids / scoring_config_version`，支持回放。用户的"关注"是用户与机会的关系（Watchlist），不属于生命周期。

### 5.9 拥挤度（Crowding）
平台内对同一机会的 GO 数量作为 W 轴输入，并聚合展示（k-anonymity：k ≥ 5 才展示具体数字，否则展示分档）。让用户知道"我不是唯一看到这个窗口的人"。

---

## 6. 功能需求

### 6.1 范围总览
| ID | 功能 | 阶段 |
|----|------|------|
| F1 | 信号管线与预测账本 | Phase 0 |
| F2 | 机会引擎（评分 / Verdict / 生命周期） | Phase 0–1 |
| F3 | Opportunity Feed | Phase 1 |
| F4 | Opportunity Detail | Phase 1 |
| F5 | Compare | Phase 1 |
| F6 | SERP Intelligence | Phase 1 |
| F7 | Commercial Signal Engine | Phase 1 |
| F8 | 机会研究报告 (Opportunity Report) | Phase 1 |
| F9 | Watchlist 与 Alerts | Phase 1 |
| F10 | Project 与 Outcome Tracking | Phase 1 |
| F12 | Onboarding 与国际化 | Phase 1 |
| F13 | 公开获客层 | Phase 1（战绩、延迟公开）/ Phase 3（规模化） |
| F14 | 管理后台 | Phase 1（最小集） |

**Phase 2**：用户侧 Historical Replay、对话式 Copilot（仅基于平台数据、强制引用证据）、zh-CN 研究语言、更多 Build Type（API / Developer Tool、Managed Service）、更多告警渠道、Weekly Review、GSC 结果自动校准评分。
**Phase 3**：Programmatic SEO / GEO 规模化、Team 套餐、组合层面的建议。

---

### F1 信号管线与预测账本
**目的**：产品真正的壁垒是随时间积累的观测数据与可验证的预测记录。

**需求**
- 数据来源类别：
  - autocomplete 每日观测
  - 被追踪 query 的 SERP Top10 快照
  - 至少一个"Why Now"关注源
  - 商业信号采集（定价、checkout、公开计数器、平台披露数据）
- 所有 Snapshot 不可变，含 `source_id / collected_at / collector_version / request_hash`。
- Collector 相互隔离：单源失败不影响其他，且 15 分钟内在管理后台可见。
- **预测账本**：每日 Verdict 以 append-only 写入，含 `scoring_config_version` 与输入 snapshot id 集合；人工 override 以新记录追加，不得改写历史。
- **成本账本**：每次采集记录成本，可按来源 / 机会 / 日汇总。

**验收**：任意历史日期的 Verdict 均可用当时的快照与配置版本 100% 复现。

### F2 机会引擎
**需求**
- 输入为快照集与 `scoring_config` 版本；输出确定性：同输入必得同输出。
- LLM 只允许承担：实体归并候选、SERP 结果类型分类（须 schema 校验 + 每周人工抽检）、文本生成。**不得决定分数或 Verdict。**
- Verdict 与生命周期变化产生事件，触发告警评估。
- 提供重算能力（管理后台 / CLI），支持不同配置版本的结果对比。

### F3 Opportunity Feed
**需求**
- 只列出 `status = TRACKED` 且通过 §1.7 发布资格的机会。默认每日最多 10 条，按 Onboarding 个性化；默认 Tab 为 BUILD NOW。Tab：BUILD NOW / EARLY BET / WATCH 变化 / WINDOW CLOSING。
- 另有「申请追踪」：提交一个查询后创建 `CANDIDATE`，页面说明观察已开始、裁决尚未发布。该操作不返回 BUILD NOW，也不消耗报告配额。
- 过滤：market、language、build type、monetization 路线、执行规模（S / M / L）。
- 排序仅 4 种：Verdict 优先（默认）、Velocity、首次观测时间、SERP weakness。
- 卡片字段：主实体 / query、Verdict、D-M-W 分档、Evidence Confidence、首次观测、velocity、一句可追溯的理由（至少引用 1 个 `evidence_id`）、Top build idea。

**验收**：每张卡片的理由都可点开查看对应证据；总分不作为主要视觉元素。

### F4 Opportunity Detail
**首屏（无需滚动）**：Verdict、D-M-W **分档**（不把基点渲染成百分制）、Confidence、研究市场、一句 Why Now、主操作（GO / PASS / Watch / 导出机会报告）。`CANDIDATE` 首屏改为观察状态，GO 与导出不可用。`EARLY_BET` 在操作旁标明「商业未验证」。

**正文按决策顺序**：
1. Why Now 与跨源动量
2. Search Formation：新增 query、intent cluster、关联实体、7/30/90 天变化、query graph
3. SERP Intelligence（F6）
4. Commercial Proof（F7），含 **What this proves / What this does not prove**
5. What to Build：推荐 Build Type（≤ 3），含 MVP 范围、技术复杂度、内容负担、执行规模
6. Monetization 路线：Primary / Secondary / Not recommended，含理由、所需流量强度、time-to-value、可能的护城河
7. Crowding（§5.9）
8. **Kill criteria**：≥ 2 条明确的放弃条件（例如"Top10 出现 ≥ 3 个 specialist 域名则放弃"），可一键转为 Watch 告警
9. **Pre-mortem**：最可能的失败原因，引用证据
10. 评分分解：由确定性规则渲染（无需 LLM）

**验收**：每个数字可点开查看 evidence；Commercial Proof 的"证明什么 / 不证明什么"为必填，缺失则该机会不得发布。

### F5 Compare
- Web 支持 2–3 个机会并排。
- 固定对比维度：Verdict、三轴、Confidence、Crowding、执行规模、Kill criteria 状态。

### F6 SERP Intelligence
- 每个被追踪 query 保存 Top10 快照：URL、结果类型、域名权威分类（规则化标签，不等同于 DA / DR）、相关性、新鲜度，以及 specialist / UGC / official / weak 结果数量。
- SERP weakness 由规则计算，并**列出具体的弱结果**（例如"第 3 位是 2022 年的论坛帖"），而不仅是输出一个数字。
- 竞争变化率 = 相邻快照的结构差异。

### F7 Commercial Signal Engine
**目的**：回答"是否已有钱在流动，证据多强"，而不是预测"可能怎么赚钱"。

**需求**
- 支持的信号：定价 / 套餐观测、checkout / payment 观测、公开销售或支持计数器、平台披露的销售数据、self-reported（显式标注）、third-party estimate（显式标注）、商业意图查询、负面信号。
- 支持 direct / category / analog 三级验证，保留历史商业快照与矛盾证据。
- 输出：M 轴分档、`commercial_stage`、`commercial_evidence_quality`、商业信号时间线。
- 分档规则见 §5.4 与 §5.6。

**验收**：构造测试集覆盖"仅检测到支付 provider""存在矛盾证据""估算无佐证"三类情形，M 轴均不得越级。

### F8 机会研究报告与导出 (Opportunity Report)
**目的**：把一个通过判定的高价值机会转化为权威、客观的商业决策卷宗，驱动立项并防范风险。

**内容（6 个分析板块）**
1. **Executive Summary**：一句话判词、Why Now、核心目标客群画像、极简价值主张（轻量 LLM U5）
2. **Demand Intelligence**：主 Query 与长尾变体图谱、搜索意图分布、需求动量（确定性装配）
3. **Commercial Evidence**：已观测竞品定价区间、支付网关证据、变现路径推荐、证明/不证明说明（确定性装配）
4. **SERP Weakness Audit**：Top 10 弱结果清单与穿透证据（UGC、过期内容、权威缺失）（确定性装配）
5. **Strategic Archetype**：推荐出货形态（Tool / PSEO / Directory / Micro-SaaS）、切入点建议、执行规模分级（S/M/L）
6. **Risk & Kill Criteria**：放弃与止损红线（Kill DSL 映射）与时效免责声明

**要求**
- 90% 内容来自快照确定性装配；LLM 仅生成 ≤ 500 字的高管决策备忘，硬数字强制占位符渲染，严禁幻觉。
- 导出格式：Markdown（面向人、易于笔记整理与提示词引用）、JSON（结构化数据）、Print/PDF（离线汇报）。
- 闭环衔接：报告直接提供“基于此机会立项”操作，联动 Project 追踪与 Prediction Ledger 战绩核销。

**验收**：20 份内部样本，rubric 通过率 ≥ 80%。Rubric：事实引用 100% 有效；无编造竞品与价格；变现建议与证据强度一致；占位符无残留。

### F9 Watchlist 与 Alerts
- 触发器：Verdict 变化、生命周期变化、WINDOW CLOSING、SERP weakness 骤降、autocomplete 扩张 spike、新权威竞品出现、**Kill criteria 命中**、已追踪项目的 GSC 出现拉升。
- 渠道（首发）：Email + 通用 Webhook（内置 Slack / Discord / Telegram 模板）。
- 去重、频控、quiet hours、日 / 周 digest。

### F10 Project 与 Outcome Tracking
- GO / PASS 必须选择结构化理由（PASS 理由同样是校准信号）。
- Project 字段：`opportunity_id`、Build Type、域名、上线日期、目标关键词、追踪页面。
- GSC 只读 OAuth；每周同步 impressions / clicks / position；营收为可选填，标注为 self-reported。
- 结果回流：首发做数据沉淀与人工校准，自动校准在 Phase 2。

### F12 Onboarding 与国际化
**Onboarding**：至多 4 问——Build 偏好、目标市场（默认 en-US）、话题（可选）、**时间预算**（周末 / 两周 / 一个月，映射到执行规模过滤）。

**国际化**
- UI 与系统生成内容（Why Now、评分解释、机会报告、日报、Alerts）支持 `zh-CN` 与 `en-US`。
- **首发验证的研究市场：en-US 单一市场。** zh-CN 研究语言在 Phase 2 验证。
- 架构接受任意 BCP 47 语言标签；新增语言不得要求修改核心表结构。
- 品牌名、产品名、域名、原始关键词与原始证据标题默认保留原文；系统解释层可本地化，但保留 canonical / original 字段以便审计；不把繁体中文自动转成简体后视为同一原始证据；机器翻译保存 provenance，可重新生成。

### F13 公开获客层
见 §7。

### F14 管理后台（首发最小集）
- Source health 与 collector 失败
- 成本仪表盘
- 人工机会审核队列
- Score override（带审计）
- `scoring_config` 版本管理
- 套餐配额与基础滥用检测

实体 merge / split 界面、完整 prompt 注册表、回放与回填任务，首发以脚本形式存在，之后再产品化。

---

## 7. 公开获客层

### 7.1 原则
- **公开 = 延迟 + 有结果。** 实时机会详情属于付费价值，公开的是已发生的事实及其结果。
- 公开页由 public projection 生成，不手工复制分数或证据，不直接读取受限内部数据。
- SEO / GEO 是产品架构的一部分，不是外围项目。

### 7.2 页面范围（首发）
- Landing：展示真实的已发布机会卡（分档，不展示伪造准确率）。账本尚未同时包含命中与失误时，不写预测准确率，改链到方法论和战绩页的覆盖说明。主按钮进入信息流或注册，不把即时扫词当作首屏产品。
- Pricing、Methodology、Data Sources、Docs / API 入口、Login / Signup
- **Track Record**：预测账本的公开视图，包含命中与失误，展示 T+30/60/90 天结果
- **延迟机会页**：仅发布满足资格规则的机会（例如 Verdict 已过 T+45 天，且 W 已降至 ≤ Medium 或进入 CONTESTED）
- **Market / Trend 聚合页**：主题级热度，不暴露具体机会的可执行细节
- 精选 Compare 页（仅限已过期机会）

### 7.3 发布流水线
```
public projection
→ publication eligibility（延迟规则）
→ duplicate / cannibalization check
→ localized render
→ quality validation
→ noindex / indexable decision
→ sitemap / internal-link update
```

### 7.4 规模化条件
Programmatic 规模化仅在 Gate 2 通过后启动。页面数量与纯流量不是成功指标。

---

## 8. 商业模式与单位经济

- **套餐结构**（具体配额与价格在计费与权限规格中定义，定价由预售访谈决定）：
  - Free：Track Record、延迟 45 天的机会摘要、每月 1 份报告预览（不可导出）
  - Pro：实时 Feed（每日最多 10 条已发布决定）、完整 Detail、Watch / 邮件告警、每月 30 份报告导出、Project 追踪
  - Team 与开放 API：不在首发售卖。权益字段可以预留，首发套餐快照里 `api_access = false`
- Web、API 共用同一套配额。
- **单位经济约束**：追踪池规模由成本模型与目标毛利率反推，而不是反过来。必须能回答：每个付费用户每月消耗多少数据成本？目标毛利率 ≥ 70%（待定价确定后校准）。

---

## 9. 非功能需求与数据治理

### 9.1 质量
- 所有推荐可解释；所有 Verdict 可重算；所有历史状态可回放。
- 任何数据点都有来源归属。
- LLM 输出必须经 schema 校验，且事实性内容必须引用 `evidence_id`。
- 每周人工抽检：随机抽取 N 个机会，审计精度与合规。

### 9.2 数据源合规
每个数据源须登记：获取方式（官方 API / 授权 / 抓取）、ToS 风险等级、单位成本、降级方案、法务状态。
- 存在未解决的高 ToS 风险的数据源，须经书面决策才能进入生产。
- 关键数据源必须有替代方案。
- 用户 GSC 数据：只读、最小权限、可随时撤销。

### 9.3 性能与可用性（初始目标）
- Feed / Detail p95 < 1.5s（缓存后）。
- 每日更新在固定窗口内完成；失败可重试，且不产生重复快照。

---

## 10. 交付计划与 Gate

> 时间按 2–3 人团队估算。团队更小则线性拉长，不得靠增加范围补偿。

| 阶段 | 内容 | 大致周期 |
|------|------|---------|
| **Phase 0 验证** | F1、F2 最小版；预测账本上线；成本模型；20+ 访谈；20 份机会报告内部样本 | ~7 周 |
| **Phase 1 私测 → 公测** | F3–F14；战绩页；10–30 个 design partner | ~7–8 周 |
| **Phase 2 扩展** | 见 §6.1 | 视 Gate 1 结果 |
| **Phase 3 规模化** | 见 §6.1 | 视 Gate 2 结果 |

### Gate 0（进入 Phase 1）
- H1 达到通过线，或有明确的信号修正方案
- 单机会月数据成本可支撑目标毛利率
- H3 达成：≥ 8 人预付或签意向
- 机会报告 rubric ≥ 80%
- 所有数据源完成合规登记与评估

### Gate 1（公开发布）
- 预测账本已运行 ≥ 60 天，战绩页包含命中与失误
- ≥ 30 个活跃 design partner，GO 后 30 天出货率 ≥ 30%
- 已有付费用户（≥ 10）

### Gate 2（进入 Phase 3）
- 有机注册 → 激活 → 付费的转化数据成立
- ≥ 30 个 GSC 已连接项目，可对外发布 Builder-outcome precision
- 30 天付费留存达到目标（Gate 1 后设定）

---

## 11. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| H1 不成立（信号无预测力） | 产品前提失效 | Phase 0 预测账本 + Gate 0；未过线先修信号 |
| 数据源政策或成本变化 | 管线中断、毛利崩塌 | 多源、成本账本、合规登记、降级方案 |
| 误报损害信任 | 流失、口碑受损 | 公开战绩含失误；Confidence 显式展示；Kill criteria |
| 窗口拥挤（同一机会被过多用户同时进入） | 产品价值自我销毁 | Crowding、延迟公开、BUILD NOW 保持稀缺 |
| 冷启动：缺少历史数据 | 首发体验空洞 | Phase 0 提前采集；Gate 1 要求账本 ≥ 60 天 |
| LLM 生成内容泛化 / 编造 | 机会报告失真 | 强制证据引用、确定性占位符渲染、rubric 抽检 |
| 范围膨胀 | 永远无法发布 | 阶段 Gate；不以增加范围补偿人力 |

---

## 12. 待决策事项

1. **ICP 与研究市场**：已确认。主要用户为华语出海 Builder，首发研究市场为 en-US / US。新增研究市场要单独过 Gate，不能靠界面上的国家下拉暗示已经覆盖。
2. **团队规模与预算**：直接决定阶段周期与追踪池规模。
3. **数据源立场**：SERP 数据走授权 API 还是抓取？愿意承担多大的 ToS 风险？
4. **定价假设**：以 Phase 0 预售访谈为准，还是先设定假设？
5. **公开延迟规则**：T+45 天与 "W ≤ Medium" 是否合适？Free 层是否需要每周少量准实时样本？
6. **公开失误**：已确认必须公开。没有失误样本的战绩页不得配准确率。

---

## 13. 附录

### 13.1 术语表
| 术语 | 含义 |
|------|------|
| D / M / W | Demand Formation / Commercial Proof / Entry Window 三轴 |
| Evidence Confidence | 证据置信度，由独立来源数、新鲜度、observed 占比决定 |
| `first_observed` | 首次被本系统观测到的时间 |
| Prediction Ledger | 只追加的预测账本 |
| Kill criteria | 预先定义的放弃条件 |
| Crowding | 平台内对同一机会的进入密度 |
| Opportunity Report | 权威、结构化且数据密集的机会研究与商业分析报告导出物 |

### 13.2 配套规格文档
- Scoring Config Spec：三轴、Verdict、生命周期阈值与版本管理
- Prediction Ledger Spec：账本结构、不可变性、回测方法
- Data Source Register：来源、成本、合规状态
- Commercial Signal Spec：信号类型、证据类别、分档规则细则
- Opportunity Report Spec：报告结构、业务闭环、导出规格
- Billing & RBAC Spec：套餐、配额、权限
- Internationalization Spec：locale、translation provenance
- Public Site & Publication Spec：发布资格、质量门槛、索引策略
