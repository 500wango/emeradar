# 15 — 公开获客层与发布流水线规格（Public Site & Publication Spec）

Status: Draft ｜ Owner: 前端/增长 ｜ Last reviewed: 2026-10-14（对齐 PRD v2.1，废除 45 天延迟公开）｜ 依赖：01 §7、05 §5.1/§5.3、06 §6.1、13 §3.2、03 §15、14 ｜ 被依赖：16、19

## 1. 目的与原则

公开获客层（Public Projection Layer）是系统的自然增长与信任建立基石。SEO（搜索引擎优化）与 GEO（生成式 AI 引擎优化）不是外围营销项目，而是产品系统架构的原生组成部分。

**核心原则（01 §7.1）**：
1. **公开 = 准实时样本 + 有结果，且不泄露空槽窗口**：公开层发布的是**已经失去抢跑价值**的机会——槽位已被认领满额（`CROWDED_LOCKED`）或刚进入窗口关闭（`WINDOW_CLOSING`）。它绝不提前泄露仍有空槽的实时窗口。**注意这与已废除的"45 天延迟公开"是两种不同的判据**：旧规则等的是"时间够久"，新规则看的是"这条机会对付费用户还有什么价值"。一条刚发布三天就满额的机会当天即可公开；一条放了半年仍有空槽的机会永远不公开。
2. **纯投影架构（Projection-only）**：公开页面绝不直接跨库读取受限业务表，而是由每日批处理流水线（S8）计算出的 `public_pages` 及公开投影物化视图生成，物理隔离内部数据。
3. **真实数据呈现**：公开站（包括 Landing 页与战绩页）严禁使用抽象概念插画或模拟数据，必须使用真实产品界面、来源、观测日期和结果回流。**前台主打 Cohort Hit Rate & Accuracy Matrix 与事后复盘；Merkle 树等密码学存证作为后台审计手段，前台只在页脚保留一个校验入口**，不作为卖点宣传。账本还不能同时列出命中和失误时，Landing 不写预测准确率、不写未登记的查询体量。允许写的是观测起始日、已追踪查询数、研究市场，以及指向 `/methodology` 与 `/track-record` 的链接。
4. **质量门槛与防降权护栏**：Programmatic SEO 必须遵守严密的质量检查；不满足内容丰富度与独特性的页面强制输出 `noindex`，严禁产生低质薄内容。
5. **买断封印优先（Sealed Ledger）**：处于 `stealth_locks` 保护期（60 天）内的机会，在**一切公开投影**中都以 `[Stealth Locked #ID]` 打码出现——它照常计入 Cohort 胜率统计（否则买断者可以用钱买走平台的战绩），但具体词根与实体在期满前不对公众可见（01 §1.7 第 7 条）。

---

## 2. 公开页面范围与路由

| 路由路径 | 页面类型 | 渲染策略 | 数据源 | 核心转化目标 |
|----------|----------|----------|--------|--------------|
| `/` | 官网首页（Landing） | ISR（24h） | 平台聚合统计 + 来源与结果片段 | 注册 / 预售转化 |
| `/pricing` | 价格与套餐 | 静态（SSG） | `13-BILLING-RBAC` 配置快照 | Checkout 结账 |
| `/methodology` | 方法论与证据规范 | 静态（SSG） | 00、05、06、07 规范公开摘要 | 建立专业信任 |
| `/data-sources` | 数据源登记与合规 | 静态（SSG） | 04 登记表脱敏公开视图 | 消除合规疑虑 |
| `/track-record` | 预测战绩公开大盘 | ISR（每日 S8 刷新） | `public.track_record_summary` + Episodes | 展示判断如何经受结果检验，驱动 Pro 转化 |
| `/opportunities/[slug]` | 准实时精选机会公开页 | ISR / 按需生成 | `public_pages` (page_type='OPPORTUNITY') | 免费体验 → 注册解锁实时 Feed |
| `/case-studies/[slug]` | 已完结案例拆解页（CASE_STUDY） | ISR（按需） | `public_pages` (page_type='CASE_STUDY') | 结果背书 → Pro 转化 |

> **路径以代码为准（2026-10-13 核对）**：本节与 §6.2 写的 `/opportunities/[slug]`，
> 实际路由是 **`/public/opportunities/[slug]`**（`apps/web/src/app/public/opportunities/[slug]/page.tsx`，
> `sitemap.ts` 也按此拼 URL）。两处不是同一个页面：`/opportunities/[slug]` 是登录后的
> 应用内机会详情页，公开投影在 `/public/...` 下。规格里的写法会被读成"公开页就是那个
> 需要登录的页面"，故此处以代码为准标注，不改代码 —— 改路由会让已发布的 URL 失效。
| `/markets/[slug]` | 细分市场热度聚合页 | ISR（每周） | `public_pages` (page_type='MARKET') | 广谱长尾搜索获客 |
| `/compare/[slug]` | 精选过期对比页 | ISR（按需） | `public_pages` (page_type='COMPARE') | 比较意图搜索获客 |

---

## 3. 准实时精选发布资格规则（Publication Eligibility）

> **本节已废除旧的「T+45 天延迟公开」判据**（01-PRD v2.1 §7.1）。旧规则按**时间**决定公开时机，新规则按**这条机会对付费用户还剩多少抢跑价值**决定。区别在两端都很明显：一条刚发布三天就被认领满额的机会当天即可公开；一条放了半年仍空着槽位的 `BUILD_NOW` 永远不公开。

一个 Opportunity 必须**同时满足以下全部条件**，S8 批处理流水线才允许为其生成公开投影并推入发布队列：

```mermaid
flowchart TD
  START[被追踪机会] --> C0{处于 stealth_locks<br/>保护期内?}
  C0 --是--> MASK[强制打码投影<br/>[Stealth Locked #ID] 见 §3.1]
  C0 --否--> C1{已满额或刚关窗?<br/>Σclaimed = Σcapacity<br/>或 14 天内进入 WINDOW_CLOSING}
  C1 --否--> BLOCK[不公开: 仍有空槽<br/>窗口仍在付费权益内]
  C1 --是--> C2{M 轴有有效采样?<br/>M ≠ INSUFFICIENT}
  C2 --否--> BLOCK
  C2 --是--> C3{内部蚕食检查通过?<br/>无同主词冲突页面}
  C3 --否--> BLOCK
  C3 --是--> PUB[生成 public_pages 记录<br/>允许公开访问]
```

1. **抢跑价值已耗尽（准入条件，D12）**：该机会必须处于下列之一——
   - **槽位已满额**：`Σclaimed_slots == Σcapacity`（即 verdict 已被 `CROWDED_LOCKED` 标志覆盖，见 05 §5.3）；或
   - **刚进入关窗期**：14 天内新进入 `WINDOW_CLOSING`（`wDroppedWithin(prev.datedWBandHistory, 14)` 为真，见 05 §5.1）。
   **仍有空余槽位的 `BUILD_NOW` / `EARLY_BET` 一律不得公开**——这是硬阻断，S8 流水线在资格断言阶段即拒绝，不进入质量审查。
2. **证据充足性**：商业信号 M 轴不得为 `INSUFFICIENT`；必须具备确凿的定价或商业意图记录。
3. **蚕食防护（Cannibalization Check）**：该机会的核心 Query 与现有已收录公开页的相似度不得过高（Jaccard Top10 重叠度 `< 0.7`），避免自身网站在 Google 中产生关键词冲突。
4. **买断封印优先**：`stealth_locks` 保护期（60 天）内的机会**不适用上述 1–3 条**，走 §3.1 打码投影路径。

> **配置项**：本节写的三个键（`publication.crowded_ok`、`publication.window_closing_freshness_days`、`publication.cannibalization_max_jaccard`）**没有运行时可调机制**——仓库里不存在 config 表、Zod 校验或环境变量，"配置"一律是编译期常量紧挨消费者并引规格章节。今天的落点：14 天取 `WINDOW_CLOSING_FRESHNESS_DAYS`（`packages/scoring/src/verdict.ts:10`，与 05 §5.1 同源，**只有这一个常量**）；`0.7` 与 Top10 取 `CANNIBALIZATION_MAX_JACCARD` / `SERP_TOP_N`（`packages/services/src/publication-policy.ts`）。`crowded_ok` 无对应物——满额**总是**允许公开，没有开关。

> **实现口径四则（`packages/services/src/publication-policy.ts`，2026-10-14 落地）**：
>
> 1. **「槽位已满额」只能直读 `opportunity_slots`，不能读 `CROWDED_LOCKED` 标志。** 该标志今天的喂入是 `projects` 计数对比常量 5（旧口径），而 `0003` 的迁移注释**明令禁止**再按 `projects.status` 推导"谁占着槽"；它与本节要的 `Σclaimed == Σcapacity` 会在真实数据上分叉。另外「一个槽位行都没有」**不得**算作满额——`0 >= 0` 会把"还没开始抢"读成"已满额"，而那正是 §8 的 0 容忍项。
> 2. **「14 天内新进入 `WINDOW_CLOSING`」按 `verdicts` 的连续段起始日判定，含端点，且当日进窗当日即可公开。** 不能只看 `verdict == 'WINDOW_CLOSING'`：`verdict.ts` 的迟滞让它能带 30 天上限地延续，只看裁决会把一个 25 天前就关窗的机会当成"刚关窗"；也不能只用 `wDroppedWithin`——靠**满额旁路**进入 `WINDOW_CLOSING` 的机会一次 W 降档都没有，用降档做代理会整个漏掉它。参考日取账本最新一行，不取挂钟。
> 3. **蚕食防护的「已收录」= `status='PUBLISHED' AND indexable = true`**，与 `sitemap.ts` 同一口径（打码页与未过质检的页不会被收录，不构成关键词冲突）；比对对象是两侧 PRIMARY query 最新 SERP 快照的 **Top10 结果 URL 集合**（归一后），`>= 0.7` 阻断。四种状态彼此不同，**不可合并**：没有已收录页是 `VACUOUS`（通过），有页但一侧拿不到快照是 `NOT_EVALUATED`（**阻断**并登记进 `notEvaluated`）。后者取 fail-closed 是刻意的——一旦有页可被索引，蚕食就是真问题，静默放过等于让这条检查形同虚设；阻断码可计数，能把 SERP 覆盖缺口变成可见指标。**相似度的口径只有这一种，另一种解读已被否决**：也可以拿"核心 Query 的**词元集合**"算重叠，但本节写的是「**Top10**」，指的是 SERP 结果；而 `14 §3` 的 `normalizeQuery` **全仓未实现**——采它等于让相似度由一份没人写过的归一化决定，也就是把一条未实现的规格悄悄顶上来。**归一化的方向性**同理：`normalizeSerpUrl` 只做下界（去 scheme / `www.` / fragment / 尾斜杠），**刻意不剥 query string**；归一化只会让两个集合**更容易重叠**（挡得更多、公开得更少），而"少公开"是这条判据出错时安全的那一侧。
> 4. **准入判据非单调**，见下条「已知后果」。

> **已知后果（准入判据非单调 → 已发布页会在第 15 天变 404）**：旧判据 `T+45 天` 单调，一旦入选几乎不回退；新判据的「14 天内进窗」会在第 15 天自然失效，而发布流水线每次都按最新判决重写 `public_pages.status`——于是**一条靠关窗入选的页会在第 15 天被翻成 `DRAFT`、URL 变 404**，而那时窗口仍然是关着的，抢跑价值并没有回来。**本轮不改这个行为**：§3 的字面是"S8 才允许为其生成公开投影"，而 §8 把「空槽窗口泄露」列为 **0 容忍的 P0**，自动重评（含撤回）是那条 P0 的唯一防线，为少几次 404 而关掉它等于拿 P0 换非 P0。**但它是 §5 内容生成落地前的阻塞项**：今天 §5 的 600 词门过不了、`indexable` 恒为 `false`，这些页既不进 sitemap 也不被索引，抖动代价接近零；**一旦有页可索引，必须先裁定保留策略**（粘滞 / 撤回 / 归档转 `CASE_STUDY`——§3.1 第 4 条只在买断期满那一处提到后者），**再**让页可索引。

### 3.1 买断保护期的打码投影（Sealed Ledger Projection，D7）

处女地独占买断（`01 §1.7 第 5 条` 的买断资格 + `第 7 条` 的延迟解密）会在 60 天保护期内对机会做半遮蔽，但**不是删除、不是 404、不是从统计中剔除**：

1. **公开投影一律打码**：保护期内的机会在任何公开投影（`/track-record`、`/opportunities/[slug]`、市场聚合页、结构化数据）中，关键词、实体名、URL 与 `primary_query_text` 全部替换为 `[Stealth Locked #ID]`（`ID` 取 `stealth_locks.id` 的后 6 位），其余结构化信息（三轴档位、判定、观测日期、生命周期）照常展示。
2. **照常计入 Cohort 统计（不可协商）**：买断机会的 Verdict 与 `prediction_episodes` 结果**必须**进入 Cohort Hit Rate 与 Accuracy Matrix 的分子分母。否则买断者等于用钱买走了平台的败绩，战绩页会系统性偏乐观——这从根本上摧毁战绩的可信度。
3. **不生成未打码的 `public_pages` 行**：保护期内 S8 只写打码版本；若该机会在买断**之前**已有公开页，则必须在买断生效的同一次 S8 运行中把该页切换为打码投影（同时刷新 CDN 缓存），不得存在"已下线但缓存仍可查"的窗口。
4. **期满自动解密**：保护期结束后的第一次 S8 运行恢复真实词根与实体，`public_pages` 记录以 `page_type='CASE_STUDY'` 重新生成完整案例页（真实结果回流、事后复盘）。
5. **打码不具备可逆性提示**：页面**不得**输出"该词已被人买断"或任何暗示编号与真实词根映射关系的信息，避免通过排序/编号位置反推。
6. **打码是资格判定之前的分支，且付款当时就要写**。两条都是硬约束，各自对应一次已犯过的错：
   - **必须早于 §3 的准实时精选资格**。买断与"槽位是否满额 / 是否刚进 `WINDOW_CLOSING`"无关——一条被买断的 `BUILD_NOW` 机会，槽位恰恰是空的，若先过资格判定就会落到 `status='DRAFT'`，而公开页查询是 `WHERE slug=$1 AND status='PUBLISHED'`，于是它变成 404。但本节的第 1 条明写「**不是删除、不是 404**」：打码页必须**以 200 存在**、只把内容换成打码标签。
   - **必须在付款落账时同步写，而不是等 S8**。买断者在 04:00 付完钱，而下一次 S8 在次日 03:30——中间最长一整天，一条已经卖出去的词根还挂在公开页上，按 §8 的「买断打码泄露率」就是 **P0 事故**。所以付款 webhook 落账后立即重跑该机会的投影（`indexable = false`，`status='PUBLISHED'`）。
   - **URL slug 本身是泄露面**。`opportunity_cards.slug` 由词根/标题生成，所以只改 `content` 不够：打码期要写一行**打码 slug**（由锁 id 派生、不含任何词根）的 `public_pages` 行，并把原 slug 那行翻成 `status='DRAFT'`（**不删行**，期满原样恢复）。代价是原 URL 在这 60 天里 404——可接受，且期满即恢复；反过来留着一条含词根的 URL 而只改正文，按 §8 的 0 容忍口径仍然是泄露。
   - 打码时**从 `stealth_lock_displays` 取标签**（`masked_label` / `unmasked_at`），不在投影里现算：06 §11 要求战报也输出这三个字段，两处各自现算就等于同一份事实有两个实现，第一处漂移即 P0（03 §15）。
7. **打码挂在付款落账上，不挂在占位上——因此存在一段"API 已隐藏、公开页未打码"的窗口，这是刻意的**。下单（`purchase`）只在读路径上生效：机会立即对 Feed / 搜索 / 详情 / 比较消失（10 §7），但公开投影要等 `checkout.session.completed` 落账才刷新（第 6 条）。于是一笔**被遗弃的未付款占位**在待付宽限期内（最长 15 分钟，03 §17 I13，PRD v2.2 Q8）会造成这种错位：`GET /public/opportunities/<真实 slug>` 仍是 200、正文仍是真实词根，而同一时刻 API 已经 404。
   - **为什么不能提前到占位就打码**：打码会把真实 slug 那行翻成 `DRAFT`（第 6 条末），即**把该页踢出 sitemap**。若判据只是"有人下了单"，任何一个不付款的 Pro 用户就拿到一根免费杠杆——对 Feed 里任意一条机会下单再关掉标签页，即可让该公开页下线、把搜索权重与反向链接的既有收益打掉。`STEALTH_LOCK_PENDING`（同一用户同时至多一笔待付占位，10 §4.5b）是**限流**，不是授权：它只让这个人一次遮一条，遮哪一条仍由他说了算。
   - **代价方向是"永不欠打码"**：错位发生在**还没收到钱**的机会上，而这类机会的真实词根此前**本来就是公开的**（它从未被买断过，否则就有一把锁、`Σclaimed` 也就不是 0 了）。所以这段窗口不泄露任何新东西，只是让一个人在 15 分钟里"看得到但点不进去"——而宽限期一过，判据自愈（03 §17 I13），无需任何作业介入，机会对所有人重新完整可见。
   - 与之相对，**已成交**（`provider_payment_id IS NOT NULL`）的买断**没有**这段窗口：落账与打码在同一请求里完成（第 6 条）。§8 的"买断打码泄露率 0 容忍"针对的是这一侧。

### 3.2 已公开机会的重新演进与保活策略（Re-opened Opportunities Preservation）
根据 05 §6 生命周期定义，处于 `DEAD` 或 `CONTESTED` 的机会未来可能因行业爆发再次重新转入 `FORMING` 或 `EARLY_WINDOW`：
1. **绝对禁止删除页面或返回 404**：直接下线或 404 会严重破坏 Google 已建立的索引权重与反向链接；
2. **页面维持 200 OK 并挂载转化横幅**：页面维持 `status = 'PUBLISHED'`，但顶部注入动态高亮横幅：
   > “⚡ 市场演进提醒：该搜索市场已于 {日期} 重新进入新一轮高价值窗口（最新状态：{verdict}）。当前公开内容为历史归档；最新实时动量、SERP 战情与形态点火包仅限 Pro 会员专享 [立即升级解锁实时情报]”；
   > 注意：横幅**只**提示"重新活跃"这一事实，不得输出新的三轴档位、槽位余量或条款，否则等于把刚形成的实时窗口再次泄露——重新活跃的机会若槽位重新空出，同样受 §3 第 1 条约束（以重新活跃日为新起点重新判定）。
3. **转化价值最大化**：将重新活跃的历史机会天然转化为公开站最强有力的“真实战绩背书与付费漏斗入口”。

---

## 4. 发布流水线（Publication Pipeline）

每日批处理 S8 阶段按照以下 8 步标准工序执行：

```text
S6 账本更新完成
  │
  ▼ 1. 投影提取（Public Projection）：提取满足条件的数据投影，脱敏用户数据
  │
  ▼ 2. 资格断言（Eligibility Rules）：先判 §3.1 买断保护期（命中即进入打码分支），
  │     否则运行 §3 的准入 / 证据 / 蚕食三道门槛；空槽窗口在此被硬阻断
  │
  ▼ 3. 战绩聚合（Cohort Aggregate）：重算 Cohort Hit Rate 与 Accuracy Matrix，
  │     基数为全部已到期 Episode，买断机会照常计入（仅词根打码）
  │
  ▼ 4. 本地化渲染（Localized Render）：基于 14 规则生成 en-US 与 zh-CN 页面内容
  │
  ▼ 5. 质量审查（Quality Gate）：运行 §5 自动化质检（字数、引用、结构完整性）
  │
  ▼ 6. 索引决策（Indexability Decision）：通过质检标 indexable=true，未通过标 false
  │
  ▼ 7. 静态持久化（Persistence）：写入 public_pages 表并触发 Next.js revalidateTag()
  │
  ▼ 8. 站点地图与内链更新（Sitemap & Graph）：增量更新 sitemap.xml，重新计算主题内链
```

---

## 5. 质量审查门槛（Quality Gate）与索引策略

为防止生成大量低质长尾页面遭受 Google Helpful Content 算法打击，每个拟公开页面必须通过自动质检评级：

| 检查项 | 指标与通过线 | 未通过处置 |
|--------|--------------|------------|
| **正文有效字数** | 正文纯文本 ≥ 600 词（英文）/ 800 字（中文） | `indexable = false` |
| **证据事实密度** | 页面内有效可追溯的 `evidence_id` 引用数 ≥ 3 条 | `indexable = false` |
| **商业证明完备性** | “证明了什么 / 未证明什么”两栏均非空且有具体事实支撑 | `indexable = false`（阻断发布） |
| **SERP 弱度具体性** | 列出 ≥ 1 个具体弱竞争对手 URL 与弱度理由 | `indexable = false` |
| **模板文本率** | 非模板动态内容占比 ≥ 40% | `indexable = false` |
| **买断保护期打码（D7）** | 处于 `stealth_locks` 保护期内 | **强制** `indexable = false`（打码页无事实密度，且不应进索引留痕；战绩列表中仍可见） |

### 5.1 索引控制机制
* **通过质检**（`indexable = true`）：
  - 允许被搜索引擎抓取并收录：`<meta name="robots" content="index, follow">`；
  - 自动注入对应语言的 `sitemap.xml`。
* **未通过质检**（`indexable = false`）：
  - 页面物理存在（用户仍可通过直接链接访问），但输出：`<meta name="robots" content="noindex, follow">`；
  - 不纳入 `sitemap.xml`，防止稀释整站 SEO 权重。

---

## 6. SEO & GEO 结构化数据规格

所有公开页必须在 Next.js 服务端渲染输出标准的 JSON-LD 结构化数据，确保传统搜索引擎与 AI 检索代理（Perplexity、SearchGPT、Google AI Overviews）能够精确抽取事实。

### 6.1 战绩页（`/track-record`）
注入 `Dataset` 结构，声明公开决策记录的时间范围、研究市场和结果指标；不要在结构化数据中暴露内部账本实现：
```json
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": "Emeradar Search Opportunity Decision Outcomes",
  "description": "Source-backed search opportunity decisions tracked against later market outcomes.",
  "license": "https://emeradar.com/methodology",
  "temporalCoverage": "2026-09-01/..",
  "spatialCoverage": "US",
  "variableMeasured": ["Demand Formation", "Entry Window", "Market Formation Outcome"]
}
```
**战绩展示口径**：以 Cohort Hit Rate（按 Verdict 类型 / 观测月份分组的 T+30/60/90 命中率）与 Accuracy Matrix（BUILD_NOW 在公开后 90 天内进入 `CONTESTED` 的比例）为主，**始终同时列出命中与失误**。处于 buyout 保护期的记录以 `[Stealth Locked #ID]` 出现在列表中被计入统计（见 §3.1），但**不参与**任何可按单条反推词根的聚合切片（例如"某月唯一一条 BUILD_NOW"这类可识别分组须做最小分组量抑制 `k ≥ 5`）。

### 6.2 准实时精选机会详情页（`/opportunities/[slug]` 与 `/case-studies/[slug]`）

> 实际路由见 §2 表格下方的核对说明：`/public/opportunities/[slug]`。
注入 `Article` 与 `ItemPage` 复合结构：
```json
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "Search Market Analysis: {title_original}",
  "datePublished": "{first_observed_at}",
  "dateModified": "{obs_date}",
  "author": { "@type": "Organization", "name": "Emeradar Intelligence Engine" },
  "about": {
    "@type": "Thing",
    "name": "{primary_query_text}"
  }
}
```

已完结案例页（`/case-studies/[slug]`，`page_type='CASE_STUDY'`）在保护期解密后生成，额外注入 `ClaimReview` 式的结果回流声明与真实结果时间线：
```json
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "Case Study: {title_original} — {outcome_label} in {days} days",
  "datePublished": "{first_observed_at}",
  "dateModified": "{revealed_at}",
  "about": { "@type": "Thing", "name": "{primary_query_text}" },
  "mentions": [{ "@type": "CreativeWork", "name": "{user_project_url}" }]
}
```

> **打码期的 JSON-LD 硬约束（D7）**：处于 buyout 保护期时，`headline`、`about.name`、`mentions`、URL slug 以及任何 `<title>` / `<meta name="description">` 中**均不得**出现真实词根或实体名——只输出 `[Stealth Locked #ID]`。结构化数据是最容易被 AI 检索代理抓走并永久留存的通道，这里是泄露风险最高的一处，必须与页面正文同等对待。

---

## 7. 站点地图与内链拓扑（Hub-and-Spoke）

1. **分级 Sitemap**：
   - `/sitemap.xml`：索引总表；
   - `/sitemap-core.xml`：主站静态营销页（Landing、Pricing、Methodology 等）；
   - `/sitemap-opportunities-{yyyy-mm}.xml`：按月切分的准实时精选归档地图（仅包含 `indexable = true` 的页面；打码保护期页面天然缺席）；
   - `/sitemap-markets.xml`：市场主题聚合页；
   - `/sitemap-case-studies.xml`：已完结案例拆解页（解密后生成）。
2. **主题内链架构（Hub and Spoke）**：
   - 每个市场主题页（Hub，如 `/markets/developer-tools`）自动聚合该主题下全部已公开的准实时精选机会（Spokes）；
   - 处于同一聚类（Cluster）内的机会页面之间互相呈现相关比较链接，形成网状互链；
   - 每个机会页面底部固定引导链接："查看该机会的公开战绩与结果记录（Track Record）"。

---

## 8. 监控与反作弊指标

| 指标 | 目标线 | 预警线 | 处置措施 |
|------|--------|--------|----------|
| **GSC 索引率（Index Coverage）** | `indexable` 页面索引率 ≥ 80% | < 60% | 调高质检门槛，暂停新页面索引提交，全面排查薄内容 |
| **软 404 / 抓取异常率** | < 0.5% | > 2% | 触发 P1 运维告警，检查 Next.js ISR 路由异常 |
| **爬虫抓取预算消耗（Crawl Budget）** | Googlebot 日常正常抓取 | 突发 > 10× 异常抓取 | 检查是否存在死循环内链，开启边缘 CDN 频率限制 |
| **空槽窗口泄露率** | 0 容忍（仍有空余槽位的 `BUILD_NOW` / `EARLY_BET` 严禁出现在任何公开投影） | > 0 | **P0 事故**：立即下线公开投影流水线并全量清除 CDN 缓存；复查 S8 资格断言的准入判据 `Σclaimed == Σcapacity` |
| **买断打码泄露率（Sealed Ledger）** | 0 容忍（保护期内真实词根不得出现在正文、JSON-LD、URL slug、`<title>` 或 CDN 缓存） | > 0 | **P0 事故**：立即对该机会全站打码并清除 CDN 缓存；若已进入外部索引或 AI 检索代理，按 26 事故流程评估影响面 |
| **Cohort 统计口径完整率** | 100%（全部已到期 Episode 均进入分子分母，买断机会只打码不剔除） | < 100% | **P0 事故**：战绩可信度直接受损；暂停 `/track-record` 发布，回查 §3.1 第 2 条的聚合实现 |
