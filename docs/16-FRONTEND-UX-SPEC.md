# 16 — 前端架构与交互体验规格（Frontend & UX Spec）

Status: Draft ｜ Owner: 前端/设计 ｜ Last reviewed: 2026-10-18（对齐 PRD v3.1：GO = 配额 + Project 壳 + 点火包；无槽位、无买断、无质押倒计时）｜ 依赖：01（F3–F5, F8, F12, F14）、02 §4、05、07、09、10、13、14、15 ｜ 被依赖：19

## 1. 架构与技术栈选型

前端与 API 适配层同构部署于 `apps/web`（Next.js App Router，ADR-001/011），严格践行**服务端优先渲染（RSC）+ 渐进式客户端交互**原则。

* **核心技术栈**：
  * **框架**：Next.js 15+（App Router，RSC + Server Actions）
  * **样式与设计系统**：Tailwind CSS + Radix UI 原语（基于 shadcn/ui 设计模式）
  * **状态管理与数据请求**：
    * 服务端数据与缓存：TanStack Query (React Query v5) 与 Next.js `fetch(..., { next: { tags } })`
    * 客户端瞬态状态（抽屉开闭、局部表单、草稿）：Zustand
  * **长列表虚拟化**：TanStack Virtual（保障 Feed 滚动 60fps）
  * **图表组件**：Recharts（SERP 排名变化、GSC 趋势、Search Formation 图谱）
  * **图标系统**：Lucide React

---

## 2. 路由拓扑与页面结构

应用划分为公开营销路由（`(marketing)`）与主工作台路由（`(app)`），布局完全解耦：

```text
apps/web/app/
  ├── (marketing)/                # 公开获客与静态页（无侧边栏布局）
  │   ├── layout.tsx
  │   ├── page.tsx                # Landing 官网
  │   ├── pricing/page.tsx        # 套餐与定价
  │   ├── methodology/page.tsx    # 方法论
  │   ├── track-record/page.tsx   # 战绩大盘（Cohort Hit Rate & Accuracy Matrix，SSR/ISR）
  │   ├── case-studies/[slug]/    # 已失去抢跑价值的完结案例（15 §3）
  │   └── opportunities/[slug]/   # 准实时精选机会公开页
  │
  ├── (app)/                      # 核心产品控制台（带侧边栏与顶栏）
  │   ├── layout.tsx              # 鉴权保护、用户上下文、全局证据抽屉
  │   ├── feed/page.tsx           # 主 Feed（F3）+ 候选池 Tab
  │   ├── opportunities/[id]/     # 机会工作台详情（F4）
  │   │   ├── report/page.tsx     # 研报工作室 + 点火包导出
  │   ├── screener/page.tsx       # 自定义词两阶段初筛（F3 扩展，10 §4.3b）
  │   ├── compare/page.tsx        # 机会并排对比（F5）
  │   ├── watchlist/page.tsx      # 我的关注（F9）
  │   ├── projects/               # 出货项目管理（F10）
  │   │   ├── page.tsx
  │   │   └── [id]/page.tsx       # 含可选凭证核验（无倒计时）
  │   ├── alerts/page.tsx         # 告警规则与通知渠道（12）
  │   ├── settings/               # 偏好、计费（13）、API Key、已绑身份
  │   └── admin/                  # 管理员审核与成本仪表盘（F14）
  │
  └── api/v1/                     # REST 端点（10）
```

> **公开页与登录页是两个不同的页面，不要合并**：`/public/opportunities/[slug]` 是公开投影，`/opportunities/[id]` 是登录后的应用内工作台。二者 slug/id 体系、可见字段、缓存策略都不同（15 §2 的核对说明）。

---

## 3. 核心界面与交互规范

### 3.1 首次使用引导（Onboarding Modal，F12）
* **交互触发**：新注册用户或 `user_preferences` 为空时全屏模态拦截；
* **至多 4 步极简问卷**（支持单选卡片，总耗时 ≤ 45 秒）：
  1. **出货偏好**：多选（工具、PSEO 站、内容站、Directory、Micro-SaaS）；
  2. **时间预算**：单选（`WEEKEND` 周末出货 → 匹配 S 规模；`TWO_WEEKS` → 匹配 M；`ONE_MONTH` → 匹配 L）；
  3. **目标市场**：默认 `US (en-US)`，支持切换；
  4. **关注话题**：可选填常用关键词标签。
* **完成即转化**：提交后立即写入 `user_preferences`，无刷新平滑进入 `/feed`，并在 3 秒内完成首屏渲染。

### 3.1a 官网首页
- 首屏说明三件事：需求是否在形成、窗口是否还开着、是否已有人付钱。主按钮是进入信息流或注册。
- 不放置关键词即时扫描，不放置带虚构收入区间的创意目录。
- 社会证明只使用已经公开的来源、观测日期和结果事实。没有同时包含命中和失误的样本时，不出现准确率百分比；前台不展示内部账本实现。
- 下方最多展示 2 条已发布的 `BUILD_NOW`。没有则写明今天没有通过发布资格的 BUILD NOW，并链到方法论。卡片用分档，不用百分制。

**落地现状（2026-10-12 首页试点，已按本节重做）**——同时修正了三处此前的违规实现：

1. 机会卡片曾按 `basisPoints / 100` 渲染 `xx/100` 与进度条，现改为 `D/M/W + HIGH/MEDIUM/LOW/INSUFFICIENT` 分档徽章，页面上不出现任何百分制或综合分；
2. 首页曾一次拉取 6 条 showcase 并按三列铺满，现 `BUILD NOW ≤ 2`、`EARLY BET ≤ 4`，且**取数后先截断再渲染**，右侧读数与卡片同源，不会出现「面板显示 4 条 BUILD NOW 但页面只画 2 条」；
3. 数据库无已发布 `BUILD_NOW` 时，首页曾回落到一张虚构的「Invoice Generator for Freelancers」示例卡，违反 `15-PUBLIC-SITE-PUBLICATION-SPEC.md` 的禁用模拟数据条款，现改为规范要求的空状态（说明门槛、链到 `/methodology`）。

首屏的实时读数面板取自已入库的观测记录与账本检查点（`TrackRecordService.getPublicTrackRecord` 的聚合值 + `OpportunityService.listFeedCards`），进程内做 5 分钟记忆化，避免匿名流量反复扫账本。

### 3.1b 申请追踪
信息流顶部有一条次要表单：「把这个美国英语查询纳入追踪」。提交后调用追踪接口，成功态是：

> 已开始观察。第一次观测不会产生 BUILD NOW 或窗口关闭。裁决要等至少 14 天的联想历史，以及一份单一来源的自然搜索结果快照。

表单不跳进一份看起来已经审完的详情裁决。若返回已有的已发布机会，再链接到详情。

**Fast-Track 例外（7 天豁免）**：当查询触发了 Fast-Track 条件（PRD §5 / 05 §5.1，判定结果显示 `FAST_TRACK` 标志）时，上面这段"要等 14 天"的文案**必须**换成：

> 该查询已满足 Fast-Track 条件，观察期缩短至 7 天。仍需要一份自然搜索结果快照才能出裁决。

Fast-Track 是**缩短观察期**，不是**免于观察**。界面绝不承诺"立刻出结果"，也不得把 `FAST_TRACK` 标志渲染成已发布的判定——它只是一个加速的信号（05 §5.3）。

### 3.2 机会信息流（Opportunity Feed，F3）

```text
┌────────────────────────────────────────────────────────────────────────┐
│  Tabs: [BUILD NOW (3)] [EARLY BET (12)] [WATCH CHANGES (5)] [CLOSING]  │
│        [候选池 · 只读 — 早期机会，尚不可立项]                           │
├────────────────────────────────────────────────────────────────────────┤
│  Filter: Market: US ▾ | Type: All ▾ | Exec: Weekend(S) ▾ | Sort: Default│
├────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ [BUILD NOW] PDF to Markdown Converter                  [S] [WEEKEND]│ │
│ │ D: High | M: High | W: High · Conf: Medium · First seen: 14d ago   │ │
│ │ 🧭 竞争: Top10 中 4 个 specialist · 近 30 天 1 个新进入者 · 已核验 2 个 │ │
│ │ 💡 Top Idea: 纯前端单页工具，解决现有论坛吐槽排版错乱的问题        │ │
│ │ 🔍 理由: 过去 7 天新增 12 个相关查询；Top10 中 4 个为弱论坛帖 [EVD]  │ │
│ │ Actions: [★ Watch] [⚡ GO & 导出点火包] [View Detail →]             │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

* **Tab 分组**：`BUILD_NOW`（默认）、`EARLY_BET`、`WATCH_CHANGES`（有重大演进）、`WINDOW_CLOSING`、**候选池（只读）**；
* **竞争拥挤度透明（必做）**：每张卡片必须展示该机会的竞争透明度三项——Top10 中 specialist / 权威竞品数、近 30 天新进入 Top10 的独立站数、已核验的独立产品 / 落地页数（数据取自 `crowding_daily`，01 §5.9）。这不是"剩余名额"，也不影响 GO 是否成功；v3.1 没有虚拟槽位或容量上限，任何 `[已满额]` / `[剩 N 个]` 的写法都是错误实现。
* **卡片设计**：
  * **主视觉**：主实体 / 查询名称、Verdict 徽标、执行规模标签（S/M/L）、`US · en-US`；
  * **拒绝总分**：三轴以独立分档徽章并列（`D: High` `M: High` `W: High`），严禁把基点除以 100 画成百分制进度条，严禁渲染综合分；
  * **事实追溯药丸**：理由中所有硬指标后方附带微缩药丸 `[evd_...]`，点击直接在右侧滑出证据抽屉；
  * **EARLY BET 警示**：若 Verdict 为 `EARLY_BET`，卡片必须强制附带黄色告警标：“商业未验证”。
  * **`PROVEN_NEW_ENTRANT` 徽章（新晋赢家雷达）**：当 M 轴因"新出现的独立域名在 6 个月内闯入 Top 5 且具备商业痕迹"而升档时（07 §6.4），卡片必须显示可点击的 `[🏁 新晋赢家]` 徽章，展开显示该域名、首次观测量级与 `established_at` 的来源。**`established_at` 缺失时不得显示该徽章**——上线时间是这条判据的全部依据，用 `first_observed_at` 冒充会把"我们刚开始看它"说成"它刚上线"。
  * **空的 BUILD NOW**：说明稀缺是发布规则的结果，并允许用户改看其他已发布 Tab。不得用未发布的 `CANDIDATE` 填充。
* **保底与留白回退机制（Relaxed Zero-State Fallback）**：
  * 当用户筛选条件组合导致结果为 0 时，界面绝不展示全白空屏，而是触发自动降级：
    > “在您的当前偏好筛选下暂无结果。为您展示今日全网最值得关注的 3 个 `BUILD NOW` 机会：”

### 3.2b 候选池 Tab（只读）
候选池展示仍在 `CANDIDATE` 状态、**尚未达到发布门槛**的早期机会（10 §4.2 的 `GET /candidates`）。它是免费层的诚实替代品：不给抢跑窗口，但让人看见"系统正在盯着什么"。

* **可见**：主查询、三轴档位、首次观测日、所属话题。Free 与 Pro 都可读（`candidate_pool_readonly = true`）。
* **不可见 / 不可做**：不显示完整证据链与竞争统计、不显示初筛结果、**没有任何 GO / 导出 / 报告的入口**。若用户对候选池条目发起 GO，服务端返回 `422 PRECONDITION_FAILED`（未达发布资格）；前端不得预先渲染出必然被拒绝的按钮。
* **升级引导**：条目底部统一文案「该机会仍在观察期，达到发布资格后可立项」，而不是灰掉的禁用按钮——灰色按钮暗示"你升级就行"，但这里缺的不是套餐而是时间。

### 3.2c Demo 词与初筛扫描进度（`/screener`，F3、PRD §4.1 / §9.3；30 R15）
* **Demo 词入口**：搜索框下方固定展示 3 个官方 Demo 词（`GET /screener/demos`，10 §4.3b）。点击直接读取缓存快照渲染完整初筛卡，**不弹额度确认、不扣配额、不触发外部请求**；卡片顶部标注「官方示例 · 数据基准日 {as_of}」，不得让用户误以为是实时结果。未登录访客同样可用（Landing 的零成本体验路径）。
* **额度确认**：输入自定义词提交前弹窗确认消耗额度（Free「终身唯一 1 次」/ Pro「本月剩余 N 次」）；Demo 词跳过此步。
* **扫描进度反馈**：提交后按 `GET /screener/scans/{id}` 返回的 `status`（10 §4.3b）渲染分步进度条（排队 → 取 SERP → 收款探针 → 汇总），轮询间隔遵循响应的 `Retry-After`（默认 1 秒）。缓存命中（目标 < 200ms）直接出卡，不闪进度条；实时采集超过 8 秒仍未完成时显示「仍在采集，可离开本页，完成后在站内通知」，而不是无限转圈。
* **失败态**：令牌桶排队、供应商失败、配额不足三者文案分开；供应商失败**不扣额度**的规则以 13 为准，前端只展示服务端返回的结论。

### 3.3 机会决策工作台（Opportunity Detail，F4）

页面严格按独立开发者决策顺序自顶向下布局，严禁杂乱信息堆砌：

1. **首屏吸顶决策栏（Sticky Decision Bar）**：
   * 左侧：Verdict 徽章、D-M-W 档位、置信度、研究市场；
   * 中间：一句话 Why Now（为什么是现在进入）；
   * 右侧核心操作组：`[★ 关注]`、`[⚡ GO & 导出点火包]`、`[✘ PASS 放弃]`。
   * **`GO` 与 `PASS` 是两个不同层级的东西**：`PASS` 只是记录意见（`POST /decisions`）；`GO` 是**立项**——点击后在单个事务里扣 1 次月度 GO 配额、建 Project 壳并解锁该裁决的点火包（10 §4.3）。因此按钮文案必须是 `GO & 导出点火包` 而不是 `GO`，让用户在按下去之前就知道这一步是有成本、有后果的。
   * `CANDIDATE`、置信度 `LOW`，或裁决不是 `BUILD_NOW` / `EARLY_BET` 时，GO 与导出禁用，并说明缺的发布条件。关注仍可用。
   * **GO 前置校验与失败态**：点击时弹出一个确认浮层，列出**本次要消耗的东西**（1 次月度 GO 配额；创建 1 个 Project 壳；解锁该裁决的点火包）。服务端返回 `403 QUOTA_EXCEEDED` 时引导升级或等待下月/结转额度；返回 `409 ALREADY_GO` 时提示"该裁决已经立项"，并链到既有 Project；`422 PRECONDITION_FAILED` 表示裁决已失效或不再满足发布资格。Free 用户不显示可点击的 GO，而是显示升级引导；Free 每周精选卡若为回退的历史案例，卡片角标显示「历史案例」并注明原入选日期，不得伪装成本周新案例。**这些失败态的补救动作不同，必须区分展示**。
   * **凭证核验（GO 之后，可选）**：GO 成功后，`/projects/{id}` 显示「未核验」徽章与凭证提交入口（域名 / 着陆页 meta token、DNS TXT、应用商店 OAuth、GitHub 仓库文件 / Release asset）。**没有倒计时、没有逾期、没有槽位释放，也不退还配额**；未提交或未通过不影响项目存在，只是不进入公开战绩、North Star 与 Gate 1 统计。核验通过后徽章变为 `VERIFIED_OWNER`，并开启排名周报。**这是纯展示与提交层行为**：12 没有"凭证到期"触发器，不产生 `notifications` 记录。
   * PASS 必须选择至少一条原因：需求不足、窗口已关、没有商业证据、超出时间预算、不是我的能力、其他。
2. **第一板块：Why Now 与跨源动量**：
   * 展示 Hacker News / GitHub / Reddit / Product Hunt 的注意力信号时间线。
3. **第二板块：搜索形成期（Search Formation）**：
   * 7/30/90 天查询簇扩张面积图；新增查询词云与意图分布。
4. **第三板块：SERP 战情（SERP Intelligence，F6）**：
   * 只有快照来源是单一自然搜索结果时，标题才写 Google organic Top 10。新闻、仓库、问答、百科各自成组，标题写来源和域名。
   * 弱对手必须带可复算的理由（如：“第 3 位：发布于 2022 年的论坛帖，相关性 0.4”）。没有存下的年龄或相关度，就不显示过时或低相关。
   * 非弱结果只有在类型为 SPECIALIST 或 OFFICIAL 时才标 Specialist / official。
5. **第四板块：商业证据双栏面板（Commercial Proof，F7）**：
   * 左栏：**证明了什么**。没有 observed 定价或结账时写“尚未观测到”，不得默认填写支付服务商或套餐数。
   * 右栏：**不证明什么**，固定包含“支付按钮不等于收入”和“查询词里的商业意图不等于有人付费”。
   * 若存在矛盾证据，展开显著的黄色冲突警示块。两栏皆空则不得进入信息流。
   * **僵尸定价站的说明义务**：M 轴档位若因"只有定价页、没有正增长"而未能升到 `HIGH`，面板须写明这一判断（"观测到 3 个独立定价域名，但排名/评论/外链均无正增长迹象"），让用户理解为什么一个"看起来有人收钱"的市场只拿到 `MEDIUM`（07 §6.1）。同理，若 M 轴因 `PROVEN_NEW_ENTRANT` 升档，须展示 `[🏁 新晋赢家]` 徽章与 `established_at` 的来源（07 §6.4）。**断言必须带上它依据的那条观测**，否则用户无法分辨"系统判断"与"系统猜的"。
6. **第五板块：做成什么形态（What to Build）**：
   * 推荐 Build Type 列表（≤ 3 项），含复杂度、执行规模与首发页面架构建议。
7. **第六板块：变现路线（Monetization Route）**：
   * Primary 与 Secondary 路线分析，所需流量强度与冷启动建议。
8. **第七板块：放弃条件（Kill Criteria，12）**：
   * 系统推荐的 1–2 条放弃红线，支持一键点击“采纳为我的监控告警”。

### 3.4 全局证据抽屉（Global Evidence Drawer）
* 在全站任何界面点击任意证据编号（形如 `evd_01J...` 或 `snp_01J...`），屏幕右侧滑出 480px 证据抽屉（Zustand 全局驱动）；
* 抽屉展示：数据源标识、精准抓取时间（本地与 UTC 并列）、证据类别标签（OBSERVED/SELF_REPORTED 等）、快照原始数据摘录（Raw JSON / 网页文本片段）。

### 3.5 机会研究报告、点火包与导出工作台（09、10）
* **交互触发**：仅已发布的 `BUILD_NOW` / `EARLY_BET` 可生成。点击 `[🧪 生成机会报告]` 打开报告预览（Pro 不扣额；Free 走每月 1 份预览额度）。`CANDIDATE` 不生成可导出报告。
* **内容呈现**：结构化展示 6 大分析板块（Executive Summary、Demand Intelligence、Commercial Evidence、SERP Weaknesses、Strategic Archetype、Risk & Kill Criteria）；
* **报告导出栏（Pro）**：
  * **`[📋 复制 Markdown]`**：一键将渲染完毕的 GFM Markdown 拷贝至剪贴板，方便粘贴至 Notion / Obsidian；
  * **`[⬇️ 下载 .md]`** / **`[⬇️ 下载 JSON]`** / **`[🖨️ 导出 PDF]`**：提供多种本地离线归档格式。**Free 一律不渲染这一栏**（服务端会拒绝，前端不该先把按钮画出来再报错）。
* **点火包面板（交付物二，09 §5.3）**：与报告并列的独立面板，展示三件套的内容预览与下载入口：
  * `CLAUDE.md` / `.cursorrules`（工程规范）、`routes.yaml` + `keywords.csv`（PSEO 路由词表）、`landing-skeleton.html` + `sections.yaml`（着陆页骨架）；
  * **未 GO 时整个面板处于锁定态**，文案是「点击 GO 并扣除 1 次配额后解锁点火包」——**不提供任何绕过 GO 的下载入口**；
  * 下载后展示并允许复制三项版本标识（`snapshot_id` / `template_version` / `scoring_config_version`），使用户可以自行核对同一份输入是否产出同一份交付物（09 §5.3 硬约束 1）；
  * 面板内明确写出「不会写入你的仓库、不调用任何代码执行」——这是用户对"AI 生成代码"的合理顾虑，须前置消除（ADR-019）。
* **下游立项闭环（原子 GO）**：
  * 报告底部显著展示 **`[🚀 基于此机会立项并解锁点火包]`** 按钮，点击唤起 §3.3 的 GO 确认浮层（扣 1 次配额 + 建 Project 壳 + 解锁点火包，单事务）；
  * **不提供"先立项再说"的旁路**：没有独立的建项目入口，`projects.report_id` 由 GO 事务一并写入（§5.5 记录的溯源链修复正是为此）。

---

## 4. 客户端状态管理与网络层

```mermaid
flowchart TD
  subgraph DataLayer[数据层]
    RQ[TanStack Query Cache]
    API[/api/v1 REST Client]
  end
  subgraph UIState[Zustand 瞬态状态]
    DRAWER[Evidence Drawer State]
    FILTER[Feed Filter & Tab State]
  end
  subgraph Views[界面层]
    FEED[Feed View]
    DETAIL[Detail View]
    REPORT[Opportunity Report Modal/Drawer]
  end

  API --> RQ
  RQ --> FEED
  RQ --> DETAIL
  RQ --> REPORT
  FEED -->|Click EVD Pill| DRAWER
  DETAIL -->|Click EVD Pill| DRAWER
  FILTER --> FEED
```

### 4.1 乐观更新（Optimistic Updates）
* 用户点击 `★ Watch`：UI 立即翻转点亮状态，并更新 Watchlist 计数，后台异步发送 `PUT /opportunities/{id}/watch`；网络失败自动回滚并弹出 Toast 提醒；
* 用户点击 `PASS`：可乐观地把卡片移入已决策分组并弹出理由浮层（记录意见，代价低、失败可重试）；
* **`GO` 绝不做乐观更新（重要）**：它会在服务端扣一次配额、创建 Project 并解锁点火包，而这些都可能在服务端失败（`403 QUOTA_EXCEEDED` / `409 ALREADY_GO` / `422 PRECONDITION_FAILED`）。若先渲染成功态再回滚，用户会经历"成功了 → 又没了"的错觉。因此 GO 走**阻塞式提交**：确认浮层 → 按钮进入 loading → 以服务端响应为准渲染结果或失败态。这条规则与 §3.3 的失败态区分是同一件事的两面。

### 4.2 缓存与重验证策略
* Feed 列表：`staleTime = 60s`，页面切换复用缓存，避免频繁重刷；
* 机会报告生成轮询：采用轻量轮询（初始 1.5s，最长 5s），通常 2~3s 内完成并展示。

---

## 5. 性能预算与体验指标

| 指标 | 目标要求 | 监控与兜底措施 |
|------|----------|----------------|
| **FCP（首屏渲染）** | < 1.0 秒 | 营销页面严格走 SSG/ISR；控制台预载关键 CSS |
| **Feed 切换延迟** | < 200 毫秒 | 过滤参数与 Tab 采用 React 19 `useTransition`，非阻塞响应 |
| **详情页加载 p95** | < 1.5 秒 | 服务端使用并行数据抓取（`Promise.all` 获取三轴详情） |
| **初筛：缓存命中 / Demo 词** | < 200 毫秒（服务端 p95） | 7 天去重命中直接 `200` 返回（10 §4.3b）；Demo 词只读冻结快照（R15） |
| **初筛：实时采集** | < 8 秒（受理到 `DONE`，p95） | 按 10 §4.3b 的阶段状态渲染进度（§3.2c）；排队等待单独显示，不伪装成扫描中 |
| **无障碍与浅色主题** | WCAG 2.1 AA 级 | 全站浅色单主题（2026-10-12 定稿，见 §5.1），文本对比度 ≥ 4.5:1、控件边界 ≥ 3:1 |
| **移动端适配** | 100% 响应式 | 在 iPhone / Android 上所有表格支持水平滑动手势，决策栏固定于底部 |

### 5.1 主题策略（2026-10-12 定稿：浅色单主题）

**全站浅色单主题。** 同日的深色方案（深空黑画布）已废弃，改以「仪器纸白」重新落地同一套视觉语言。上表原先「默认支持系统级 Dark Mode」的表述同样作废。

- **保留与替换**：视觉语言整体保留 —— 胶片噪点、取景器角框面板、等宽大写数据语言、「观测台」排版（Syne + 中文衬线 + JetBrains Mono）、雷达扫描动效、D/M/W 三轴分档。**只把画布从深空黑换成纸白**。此前认为「浅色底上不成立」的三层装饰，实测换成墨色角框与降低扫描透明度后成立（见 §5.4）。
- **机制（已收口）**：不再有第二套作用域，也没有 `data-theme`、路由清单、阻塞内联脚本与 `ThemeSync` —— 这些为「边迁移边试色」而生的过渡机件已随本次改造整体删除。所有令牌只有一套值，写在 `globals.css` 的 `:root` 里，`color-scheme: light`。软导航不再需要任何主题兜底，因为不存在需要切换的东西。
- **令牌取值**：每一个值都以 WCAG 算式核定，不靠目测（脚本与阈值见 §5.4）。`fg` / `fg-muted` / `fg-subtle` 三级文本在 `canvas`、`surface`、`surface-2` 三种底上都 ≥ 4.5:1；信号色（`signal` / `warn` / `danger` / `info` / `axis-*` / `accent`）一律取**纸面可读的深墨**，因为它们作为**文字**（`text-signal` 等）出现的次数远多于作为填充。
- **三层细线**：`line`（纯装饰分隔，豁免 1.4.11）、`line-strong`（装饰性强调：链接下划线、雷达环、骨架条）、`line-control`（控件边界：输入框、描边按钮、开关、下拉）。**表单控件与描边按钮一律走 `line-control`**，因为在那里边框就是唯一的可见边界，须 ≥ 3:1。
- **反色作用域**：产品里唯一保持深色的表面是「仪器井」（证据抽屉、定价价值锚板、研报原始指标块、设置页方案卡），由 `.on-inverse` 类承载。它把**信号族与文本族**令牌在整棵子树内重指向深底可读的那一套（`--c-inverse-*`），因此子树里写 `text-warn`、`text-fg-subtle` 都自动正确 —— 后者让一个为纸面写的组件（如 `SectionHeading`）可以直接放进井里。成对的填充色也一并翻转：`accent-fg` / `danger-fg` / `warn-fg` 取井内墨色，`solid` 取井内浅色（井里的实心按钮相对周围是反的）。结构令牌（`surface` / `line` / `inverse`）**不动** —— 它们在井内总是与 `inverse-*` 显式配对，静默重指会一次性打断所有制品的底色关系。理由是实测教训：靠「每个调用点记得改写 `text-inverse-*`」的约定在定价页两次失效，先是四个读数以 2.6–2.8:1 渲染上线，接着是眉标 1.05:1（见 §5.4）。
- **视觉资产约束**（不变）：首页不放置抽象插画或模拟数据，读数一律来自入库记录；样本不足时渲染 `—`，不以估算值填充。

### 5.2 第二期：营销页迁移（2026-10-12）

清单已扩至 7 条：`/`、`/pricing`、`/methodology`、`/terms`、`/track-record`、`/public/opportunities`、`/logo-preview`（最后一条是无人引用的内部设计样张，只为不把它那片深色内容压在浅色壳层下）。`/billing` 复用 `PricingClient`，随第三期一起迁。

本期同时修正了四处与此前实现不符的问题：

1. **战绩页在样本单边时仍打印百分比**。§3.1a 规定「没有同时包含命中和失误的样本时，不出现准确率百分比」，但 `hitRate30d` 在「尚未评估」和「全中」两种情况下都算出 100%，调用方无法区分。`TrackRecordService` 现已随比率一并返回命中数与评估数，页面在 `hits === 0 || hits === evaluated` 时改为展示 `命中数/评估数`。
2. **战绩页的观测指标是一段永不触发的死代码**。原实现读 `metrics.cluster_expansion`，而该 JSONB 实际按周期嵌套、键名为驼峰（`metrics.h30.clusterExpansion`，见 `PredictionEpisodeService.evaluateEpisodeAtHorizon`），于是该列对每一行都落在兜底分支；而兜底文案还硬编码了「已有 3 个新入局者关闭窗口」——这个数字没有任何查询返回过。现改为读取真实周期数据，缺失时不作陈述。
3. **账本检查点原本已查出却从未渲染**。战绩页既已取回 `checkpoints`，现公开展示观测日、行数与 Merkle 根前缀，让「可验证」有可核对的落点。
4. **导航栏在 375 宽度被压垮**（`登录` 竖排、`注册` 被挤成圆点），因为语言切换器的文字标签、Logo 与两个按钮在一条 16px 高的行里争位。窄屏下语言切换器降级为 `EN / 中文` 紧凑形态、Logo 缩至 `h-7`，按钮加 `whitespace-nowrap`。这是全站性的既存缺陷，非本期引入。

另外，定价页原有的 9 处 `isZh ? … : …` 内联三元已迁进字典；`perForever` / `perMonth` / `faqBadge` / `roiBadge` 四个「声明了却从未定义」的可选键改为必填并补齐，与 §3.1a 同一条契约收紧思路。

### 5.3 第三期：应用内页；第四期：管理控制台（2026-10-12）

清单再扩 14 条：应用壳层 `/feed`、`/opportunities`、`/projects`、`/alerts`、`/billing`、`/settings`、`/onboarding`、`/compare`，机会工作台 `/opportunities/[slug]` 与其研报工作室 `/opportunities/[slug]/report`，以及管理控制台 `/admin`（含 4 个 Client 组件）。至此 `OBSERVATORY_ROUTES` 覆盖全站所有路由，未迁移的路由只剩「用户自己新建的页面」这一类。

应用内页的页面外壳统一收进 `ui/PageFrame`（`prose` / `wide` / `full` 三档宽度）与 `ui/PageHeader`，此前每个页面各写一套 `mx-auto max-w-* px-* py-*` 的写法取消。两期里所有迁移过的文件都已不再出现 Tailwind 原色（`slate-*` / `blue-*` / `emerald-*` …），与「未迁移页面照旧可用原色」并行 —— 前者由令牌类与 `ui/` 原语承担，后者是过渡期零回归的物理基础。

本期修正的三处问题：

1. **管理控制台叠了两层导航**。`Navbar` 在角色为 `ADMIN` / `ANALYST` 时会渲染一组指向 `/admin`、`/admin/candidates`、`/admin/sources`、`/admin/users` 的链接，而 `admin/layout.tsx` 又自带一套同目标的「EMERADAR OPS」导航条，两者上下叠加。修复不为 admin 单独改 `Navbar`（那会让「管理员从营销页进控制台」这条路径失效），而是新建一个客户端组件 `SiteChrome` 统一持有导航栏与页脚，在 `/admin` 前缀下整体不渲染。判断放在客户端的原因与主题机制相同：根 layout 在软导航时不重渲染，服务端也拿不到 pathname。
2. **导出的研报仍在把三轴打成百分制**。§3.1a 与 01-PRD.md F4 的禁令针对的是「D-M-W 的呈现口径」，而 `packages/report` 的 Markdown / HTML 两个渲染器一直输出 `xx / 100 分（基点）`，`generator.ts` 的三轴回退论点更直接写着「当前综合评分」——同一个违规只是换了个出口。现新增 `formatBand()`，`metadata.scores` 增加 `dBand` / `mBand` / `wBand`（由账本封存的档位带出；早于档位留存的存量报告缺这三个字段时如实标注「未留存」，不回算），三轴一律以 `高（High）` 这类档位呈现，基点不再出现在导出物里。KD 难度与 SERP 薄弱度两处 `/ 100` 保留：前者是 Ahrefs 的外部标定刻度，后者是单维度的扫描结果，二者都不是 D-M-W 基点。
3. **`feed.pageStatus` 永远渲染成原始键名**。该键在字典里被定义成 `({ page }) => …` 函数，而 `getNestedValue`（`lib/i18n/context.tsx`）只返回字符串，函数值一律落到 `undefined`，于是分页状态始终显示字面量 `feed.pageStatus`。改为占位符字符串 `'第 {page} 页'`（`interpolate` 早已支持 `{param}`），类型同步改为 `string`。这是「字典值只能是字符串」这条隐含契约的一个反例，已并入下述契约收紧。

验收时又在真 375px 视口（`375x812x2,mobile,touch`；注意只有 `resize_page` 会被钳在 500px，必须走 `emulate`）下量出五处横向溢出，一并修掉。共同根因都是 **flex / grid 子项的自动最小尺寸**：`min-width: auto` 让子项不能收缩到内容宽度以下，`overflow-x-auto` 也**不会**阻断这份 min-content 贡献：

1. **`/feed` 卡片头部**（溢出 80px）：判定徽章组与「操作 / 规模」元信息组是并排的两个 nowrap 分组，375 下放不下也不会换行。改为 `sm` 以下上下堆叠，并给两组加 `min-w-0`。
2. **机会工作台 SERP 表**（溢出 180px）：`grid lg:grid-cols-3` 的轨道被表体 490px 的 min-content 顶到 540px。给主列加 `min-w-0`，表格回到自己的 `overflow-x-auto` 里横向滚动 —— 这正是 §5 表格规格要的行为。
3. **`/settings` 账户条**（溢出 23px）：头像 + 「显示名 + 两枚 nowrap 徽章 + mono User ID」的信息块没有收缩权限。加 `min-w-0`，邮箱与 ID 允许 `break-all`，标签行允许换行。
4. **`/admin/users` 筛选栏**（溢出 326px）：三个原生 `<select>` 的固有宽度由最长选项决定，整行被顶宽。容器允许 `flex-wrap`，三个下拉加 `min-w-0 flex-1`。
5. **`/admin/sources` 来源卡**（溢出 37px）：来源名旁的 `Risk:` 徽章与随后的 mono URL 同理。加 `min-w-0` + `flex-wrap`，长 URL `break-all`。

同一轮 375px 目视还发现一处不构成溢出、但同样读不通的排版：`/feed` 卡片的「目标查询词 + query chip + 市场标签」是单行不换行的 flex，市场标签 `US · en-US` 被挤到容器边缘后在连字符处断成 `US · en-` / `US` 两行。改为 `flex-wrap` 并给市场标签 `shrink-0 whitespace-nowrap`，窄屏下整块下沉到下一行，query chip 也拿回完整宽度。

过程里还修掉两处自己引入/暴露的缺陷：

- **`SiteChrome` 首版把页脚放到了正文上方**。导航栏与页脚作为两个独立 flex 子项交给根 layout 时顺序正确，收敛进一个组件的 fragment 后就成了「导航栏、页脚、正文」（`body` 是 `flex-col`）。现把 `<main>` 一并收进 `SiteChrome`，顺序由构造保证，不再依赖 layout 的摆放。
- **三轴 `INSUFFICIENT` 徽章对比度 4.19:1**（Lighthouse 抓到）：`fg-subtle` 已经是最暗的文本令牌，又叠了一层 `opacity-80`。改为只在有色分支保留淡化，muted 分支直接用令牌本色（约 6:1）。同时给填充式危险按钮补了配对的 `danger-fg`：深色作用域的 `danger` 是亮粉色（为深底上的文字而设），配 `text-white` 只有 2.49:1，浅色作用域 `danger-fg` 仍为白，行为不变。

上述改动后 `/feed`、`/opportunities/[slug]`、`/admin`、`/admin/users`、`/settings`、`/pricing` 的 Lighthouse 无障碍均为 100，`/admin/users` 从 96 修正到 100。

契约影响：`TranslationDictionary` 里被声明成「返回字符串的函数」的键到此清零，字典值一律只能是字符串。`t` 的签名仍是 `(key: string) => string` —— 收紧成键路径类型收益明显但改动面大，仍留作后续独立任务（同 §5.2 的结论）。

未修但已记录（均为本期之前既有，与配色重构无关）：

- `ReportStudioClient` 的英文分支有 12 处直接渲染枚举原值（如 `COMMERCIAL_INVESTIGATION`、`HOMEPAGE_DIRECT`），只有中文分支走 `formatXxx()`。英文用户看到的是 SCREAMING_SNAKE。
- `Navbar` 没有移动端菜单（主导航为 `hidden md:flex`，无汉堡入口），窄屏下只能靠页脚与页内链接导航。

（第 5 条原为「`/logo-preview` 在产品内无任何引用」，该页已随 §5.4 删除。另一条原为「`DecisionBar` 只发 `opportunityId` / `title` / `targetKeywords`，溯源链是断的」，已随 §5.5 修复并移出本清单。）

### 5.4 浅色化与机制收口（2026-10-12）

§5.1 的深色方案在同日被浅色方案取代。这不是回退到改造前的界面 —— 上一版浅色是「Tailwind 模板水平」，本次是同一套观测台语言换纸白画布。落地范围与依据：

**删除的机件**（原 §5.1「待收口」项，本次一并做完）：`lib/theme/route-theme.ts`（含 `OBSERVATORY_ROUTES`、`themeForPath`、`themeBootstrapScript`）、`components/ThemeSync.tsx`、根 layout 里的阻塞内联脚本与 `<html suppressHydrationWarning>`。浅色下首帧就是纸白，不再存在深色底的白闪问题，也就不需要抢在首绘前写样式。副作用是 `Navbar` / `Footer` 各少了一处 `usePathname` 读取。

**随之删除的死代码**：`Logo` 的 `tone` 属性与深色配色（`#6FF2B0` 那一套）。它存在的唯一理由是深底上近黑字标不可见，深色没了它就没有第二种取值，三个调用点全部回到默认。`/logo-preview`（为预览该属性而建、产品内零引用）与四个零引用资产（`public/logo.svg`、`images/dashboard_mockup.jpg`、`images/radar_matrix.jpg`、`images/report_preview.jpg`，合计约 1.9 MB）一并删除。

**验收时发现并修掉的四个真缺陷**：

1. **首页 H1 行高被静默覆盖（本次最严重的观感缺陷）**。`leading-[1.12]` 与 `sm:text-4xl` 并存时，后者同时写 `font-size` 与 `line-height` 且排在样式表更后，于是 ≥640px 下实际行高是 `2.5rem`——56px 的字号配 40px 行高，三行中文互相压字。修法是**在每个断点的 `text-*` 旁边重新声明一次 `leading-*`**，全站 11 处同形写法一并修（`page.tsx`、`SectionHeading`、`PricingClient`、`public/opportunities/[slug]`）。这条已固化为约定：`leading-*` 与响应式 `text-*` 必须配对出现。
2. **反色井里的语义色是纸面深墨**。定价页价值锚板（`Panel tone="inverse"`）里的 `text-warn` / `text-signal` / `text-axis-m` / `text-accent` 四个读数以 2.6–2.8:1 渲染。这**不是本次引入的**：改造前的浅色主题下同样如此，深色主题期间被「信号色恰好是亮色」意外掩盖，浅色一恢复就重现。修法不是逐处改写，而是新增 `.on-inverse` 作用域在子树内重指向 `--c-inverse-*`（见 §5.1）。
3. **文本令牌上的透明度修饰**。`text-fg/50` 在纸白上是 3.3:1，`text-signal/80` 是 4.23:1，均不达 AA；三处 `text-fg/50` 里还有一处注释声称「50% 已够 4.5:1」，该说法在原浅色配色下也不成立。五处一律改为整令牌（`text-fg-subtle` / `text-signal`）。约定：**不留透明度修饰在文本令牌上** —— 那不是「弱化」旋钮，是砍对比度。
4. **反色井里的「文本」令牌同样是纸面深墨**（缺陷 2 的同源问题，首轮只改了信号族）。定价板复用 `SectionHeading`，而它是为纸面写的，眉标走 `text-fg-subtle` —— 在井里就是 18 26 22 打在 19 26 23 上，1.05:1，字面意义上不可见。`text-inverse-fg` 一级在井里本来是对的，缺的是二级与三级。修法同上：`.on-inverse` 把 `--c-fg` / `--c-fg-muted` / `--c-fg-subtle` 一并重指向新增的 `--c-inverse-fg-muted`（168 179 171，8.2:1）与 `--c-inverse-fg-subtle`（142 154 145，6.1:1）。为此必须先**把 `--c-fg` 从「填充色」的角色里解绑**：全站有两处写 `bg-fg text-canvas`（次要按钮、跳转链接），一旦 `--c-fg` 在井内被重指，这两处会在井里静默反转成「浅底浅字」。遂新增 `--c-solid` / `--c-solid-fg` 承载「页面主墨作为填充」，四个调用点（`Button` secondary、跳转链接、`StartExperimentButton`、`/admin/sources` 开关滑块）改走它。同理井内的 `warn` 是亮琥珀，实心徽章须配井内墨色而非白，新增 `--c-warn-fg` 并在作用域内重指。

**核验方式**：令牌取值用脚本按 WCAG 公式逐一核算（文本令牌 × 三种底、`bg-X/10` 着色徽章、实心填充的配对前景、`line-control` 对三种底、反色井内的亮信号与三级文本），阈值 4.5:1 / 3:1；渲染结果用一段注入页面的运行时审计器复核，它遍历每个元素**直接持有的文本节点**、向上回溯合成有效背景（含半透明叠加）后逐项报出未达标者。脚本核算全绿；运行时审计覆盖 17 条可达路由（`/`、`/pricing`、`/feed`、`/settings`、`/compare`、`/methodology`、`/track-record`、`/terms`、`/login`、`/register`、`/reset-password`、`/verify-email`、`/forgot-password`、`/admin`、`/admin/users`、机会工作台 `/opportunities/[slug]` 与其研报工作室 `/opportunities/[slug]/report`）全部 0 处，并额外覆盖证据抽屉打开态与 `/admin/users` 的新建用户模态。`/pricing` 首轮报出 5 处（缺陷 2 与页脚一根分隔竖线），修复后归零。Lighthouse 快照模式在 `/`、`/pricing`、`/feed`、机会工作台（含抽屉打开态）、`/admin/users`（含模态打开态）上均为无障碍 100。

两处**核验工具自身的坑**值得记下来，否则下一轮会重复踩：

- **审计器只统计叶子节点，漏掉「文本 + 子元素」混排的容器**。首版写了 `if (el.children.length) continue`，于是 `<h2 class="… text-fg-subtle">` 这类既有直接文本又有子元素的标题被整条跳过；`/pricing` 上那处 3.1:1 是 Lighthouse 抓到的，审计器当时报的是 0。改为遍历每个元素的直接子文本节点后，才把它复现出来。
- **开发服务器早于 `tailwind.config.ts` 的改动启动时，会一直供应缺少新工具类的 CSS**，而缺类不报错 —— 它就静默地不生效，元素退回继承色。本次是先给 `--c-inverse-fg-subtle` 写完类、`pnpm build` 也全绿，运行时却量到井内文本是 1.0:1：因为当时在跑的是改动前启动的 dev server，`text-inverse-fg-subtle` 这条规则根本不在样式表里（`document.styleSheets` 里查无此选择器即可确诊）。**结论：这类验收一律跑 `next build` 的产物，不要跑长驻的 dev server**；顺带确认 `.next` 里确实存在新类。

**同轮修掉的两处观感问题**：首页窄屏 CTA 三件套原会折成「按钮 + 一个链接」/「另一个链接」两行、右侧留半行空白，改为窄屏竖排左对齐；`RadarSweep` 触点的 `shadow-[0_0_10px]` 光晕是深底读法，纸面上等于没有，改为 `0 0 0 3px` 的扩散环。

**未能覆盖的两类路由**（是可达性问题，不是审计缺口）：

- `/alerts`、`/projects`、`/billing` 三个页面首行即 `if (session.user.role === 'ADMIN') redirect('/admin')`。可用于验收的账号是运维护号，因此这三条在登录态下**结构上不可达**（实测硬导航后被弹回 `/admin`），本轮未能目视或量测。它们与已覆盖的应用内页共用同一套令牌与 `ui/` 原语，但「共用」不等于「验过」——记在这里，等有普通用户账号时补。
- `/public/opportunities/[slug]` 当前 404：`/sitemap.xml` 只列出 `/`、`/methodology`、`/terms`、`/track-record`，即库里没有已公开发布的机会记录，该路由没有可渲染的对象。

**遗留（本次未动，与配色无关）**：`Logo` 的 `variant="full"` 与 `variant="icon"` 两个分支在应用内无调用点；`LanguageSwitcher` 的 `toggle` 变体内部硬编码 `中文` / `EN` 而非走字典；`/admin/users` 的新建用户浮层没有 `role="dialog"` / `aria-modal`；§5.3 末尾那份「未修但已记录」清单里除 `/logo-preview` 之外的各项仍然成立。

### 5.5 决策溯源链修复（2026-10-12）

§5.3 记录过一条「溯源链是断的」，当时并按**规范符合性瑕疵**归档。复核后确认定性错了：它不是瑕疵，是**产品的核心主张没有闭环**——「机会证据验证器 → 决策 → 项目结果回流」这条链在「决策」与「项目」之间是断开的，而这是 24 号文档 §2 的 P0 首发闭环本身。

**断在哪**：`DecisionBar` 的 GO 只发 `opportunityId` / `title` / `targetKeywords`；`ProjectService.createProject` 见 `decisionId` 缺失，就自己查「该机会最新的裁决」并**替用户插一条 GO**（理由写死 `Direct project initiation`）。于是：项目永远引向一条用户没做过的决策；`decisions` 表里躺着大量用户从未表达的「意图」；`projects.report_id` 恒为 NULL，因为研报工作室那个「创建跟踪项目」指向 `/projects?new=…&reportId=…`，而 `/projects` 不读 searchParams。`decisions` 与它引用的 `verdicts` 行之间没有任何可复算的联系。

**为什么没被更早发现**：`createProject` 在自己那一层有完整前置校验（发布资格、配额、决策归属、报告归属），单测全绿；`DecisionService.pass` 也自洽。每一段都对，接缝才断。而验收一直是**按模块**做的——配色/对比度/无障碍/路由覆盖——没有一次把「点 GO」到「项目落库」整条跑通。这是流程缺口，不是某个用例写漏了。

**改法**（分层，每层只做自己那件事）：

1. **契约**：`decisionSchema` 新增必填 `verdictId` 与必填 `decision: 'GO' | 'PASS'`，`reasons` 保持可选（只有 PASS 需要，该规则在服务层，因为它取决于 decision 取值）。
2. **服务**：`DecisionService.pass` → `DecisionService.record(userId, { opportunityId, verdictId, decision, reasons })`。裁决必须属于该机会，但**不要求是最新的一条**——钉住用户实际读到的那一行才是目的，拒绝稍旧的裁决只会把调用方推回猜测。落库时一并写入 `verdict_row_hash`（被引用裁决行的内容指纹）与 `row_hash`（本行内容指纹）。GO 对 `(user, opportunity, verdict)` **幂等**：客户端是两步调用，中间失败重试不该堆积 GO；PASS 不去重，理由是可以改的判断。
3. **服务**：`createProject` 删掉伪造分支，`decisionId` 变为必填；查重后拒绝同一条决策立第二个项目（不变量 I6）。
4. **视图**：`DecisionBar` 两步提交——先 `POST /api/v1/decisions` 拿 `id`，再 `POST /api/v1/projects` 携带它；新增 `verdictId` / `reportId` 两个 props，`verdictId` 为 null 时 GO 与 PASS 双双锁定。
5. **路由**：机会工作台接受 `?reportId=`，在**渲染期**校验归属（不属于本人/本机会就丢弃）。放在渲染期而不是提交期，是因为放提交期会让决策先落账、项目后失败，留下一条没有项目的 GO。
6. **链接**：研报工作室的「创建跟踪项目」改为 `/opportunities/{slug}?reportId={id}#decide`，工作台因此新增 `id="decide"` 锚点。`projects.report_id` 不再是 NULL。
7. **物理约束**：`decisions` 加 `verdict_row_hash` / `row_hash` 两列（可空，存量行不回溯补算，与 `verdicts.hash_version` 的处理一致）；`projects(decision_id)` 加部分唯一索引，把 I6 从文档落实成约束。

**两条刻意的不对称，都写进了注释**：

- **`decisions` 只挡 UPDATE，不挡 DELETE。** 改写是真正的威胁；而 `decisions.user_id` 是 `ON DELETE CASCADE`，一旦连 DELETE 也挡，任何做过决策的账号就**再也注销不掉**（`DELETE FROM users` 会因触发器中止）。审计价值不足以换掉这项能力。副作用是 03 §18 那句「注销时把 decisions / projects 匿名化保留」目前只有 UPDATE 能实现，而触发器正挡着——真要落地需要开一个受控口子（例如仅在 `users` 已软删除时放行），已记在 schema 注释里。
- **`decisions` 没有 `prev_hash`。** 决策是不同用户在不同时刻各自做出的行为，没有天然全局顺序，硬造链只会把「不可伪造」降级成「按写入顺序不可伪造」。真正接上外部锚点的是 `verdict_row_hash`：它把决策挂进 `verdicts` 既有的哈希链，而那条链有 `ledger_checkpoints` 的 Merkle 根可被第三方复算。本表自己的 `row_hash` 是自指的，证明力弱一档，这一点没有含糊过去。

**核验方式**：新增 `packages/services/test/decision-traceability.test.ts`（9 条）。它**自建一次性数据库**而不是复用开发库——夹具必须造两条裁决才能验证「钉的是哪一条」，而 `verdicts` 只追加，写进开发库就是往账本里塞两条永远删不掉的假裁决。连接串从 `@emeradar/db` 的连接池取（turbo 默认不把 `DATABASE_URL` 透传进测试进程），并在改写后断言 `current_database()` 就是那个一次性库，防止夹具静默落到开发库上。

浏览器端另跑了一遍真流程（生产构建 + `next start`）：登录 PRO 账号 → 机会工作台（带 `?reportId=`）→ 点 GO → 落库检查：`decisions.verdict_id` 正是该页渲染的那一条、`verdict_row_hash` 与该 `verdicts.row_hash` 相等（可复算）、`projects.decision_id` 指回该决策、`projects.report_id` 非空。随后复检：连点第二次 GO 不改库、只报"已经用这条决策建过项目"；PASS 录入理由成功；带一个不属于本人的 `reportId` 打开工作台，该参数被丢弃且落库仍是 NULL，不报错。

> **v2.1 更新（2026-10-14）**：本节第 4、5 步描述的"两步提交"（先 `POST /api/v1/decisions` 再 `POST /api/v1/projects`）在 PRD v2.1 下**不再适用**。原子 GO 要求扣额、建 Project、解锁点火包落在**同一个事务**里，因此 `POST /api/v1/projects` 这个端点已被移除，改由 `POST /opportunities/{id}/go` 一次完成（10 §4.3 / §4.5、13 §4.3、16 §3.3）。上面记录的溯源链修复本身没有失效——`verdict_id` 必填、钉住用户读到的那一行、`projects.report_id` 不为 NULL 这些结论全部保留，只是执行入口从"两步"收成了"一步"。这也是为什么 §4.1 要特别强调 GO 不能做乐观更新。
