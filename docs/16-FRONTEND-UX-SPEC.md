# 16 — 前端架构与交互体验规格（Frontend & UX Spec）

Status: Draft ｜ 依赖：01（F3–F5, F8, F12, F14）、02 §4、09、10、13、14 ｜ 被依赖：19

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
  │   ├── track-record/page.tsx   # 战绩大盘（SSR/ISR）
  │   └── opportunities/[slug]/   # 延迟机会公开页
  │
  ├── (app)/                      # 核心产品控制台（带侧边栏与顶栏）
  │   ├── layout.tsx              # 鉴权保护、用户上下文、全局证据抽屉
  │   ├── feed/page.tsx           # 主 Feed（F3）
  │   ├── opportunities/[id]/     # 机会工作台详情（F4）
  │   ├── compare/page.tsx        # 机会并排对比（F5）
  │   ├── watchlist/page.tsx      # 我的关注（F9）
  │   ├── projects/               # 出货项目管理（F10）
  │   │   ├── page.tsx
  │   │   └── [id]/page.tsx
  │   ├── alerts/page.tsx         # 告警规则与通知渠道（12）
  │   ├── settings/               # 偏好、计费（13）、API Key
  │   └── admin/                  # 管理员审核与成本仪表盘（F14）
  │
  └── api/v1/                     # REST 端点（10）
```

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
- 社会证明只使用账本里已经能公开的事实。没有同时包含命中和失误的样本时，不出现准确率百分比。
- 下方最多展示 2 条已发布的 `BUILD_NOW`。没有则写明今天没有通过发布资格的 BUILD NOW，并链到方法论。卡片用分档，不用百分制。

### 3.1b 申请追踪
信息流顶部有一条次要表单：「把这个美国英语查询纳入追踪」。提交后调用追踪接口，成功态是：

> 已开始观察。第一次观测不会产生 BUILD NOW 或窗口关闭。裁决要等至少 14 天的联想历史，以及一份单一来源的自然搜索结果快照。

表单不跳进一份看起来已经审完的详情裁决。若返回已有的已发布机会，再链接到详情。

### 3.2 机会信息流（Opportunity Feed，F3）

```text
┌────────────────────────────────────────────────────────────────────────┐
│  Tabs: [BUILD NOW (3)] [EARLY BET (12)] [WATCH CHANGES (5)] [CLOSING]  │
├────────────────────────────────────────────────────────────────────────┤
│  Filter: Market: US ▾ | Type: All ▾ | Exec: Weekend(S) ▾ | Sort: Default│
├────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ [BUILD NOW] PDF to Markdown Converter                  [S] [WEEKEND]│ │
│ │ D: High | M: High | W: High · Conf: Medium · First seen: 14d ago   │ │
│ │ 💡 Top Idea: 纯前端单页工具，解决现有论坛吐槽排版错乱的问题        │ │
│ │ 🔍 理由: 过去 7 天新增 12 个相关查询；Top10 中 4 个为弱论坛帖 [EVD]  │ │
│ │ Actions: [★ Watch] [⚡ Quick GO] [View Detail →]                    │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

* **Tab 分组**：`BUILD_NOW`（默认）、`EARLY_BET`、`WATCH_CHANGES`（有重大演进）、`WINDOW_CLOSING`；
* **卡片设计**：
  * **主视觉**：主实体 / 查询名称、Verdict 徽标、执行规模标签（S/M/L）、`US · en-US`；
  * **拒绝总分**：三轴以独立分档徽章并列（`D: High` `M: High` `W: High`），严禁把基点除以 100 画成百分制进度条，严禁渲染综合分；
  * **事实追溯药丸**：理由中所有硬指标后方附带微缩药丸 `[evd_...]`，点击直接在右侧滑出证据抽屉；
  * **EARLY BET 警示**：若 Verdict 为 `EARLY_BET`，卡片必须强制附带黄色告警标：“商业未验证”。
  * **空的 BUILD NOW**：说明稀缺是发布规则的结果，并允许用户改看其他已发布 Tab。不得用未发布的 `CANDIDATE` 填充。
* **保底与留白回退机制（Relaxed Zero-State Fallback）**：
  * 当用户筛选条件组合导致结果为 0 时，界面绝不展示全白空屏，而是触发自动降级：
    > “在您的当前偏好筛选下暂无结果。为您展示今日全网最值得关注的 3 个 `BUILD NOW` 机会：”

### 3.3 机会决策工作台（Opportunity Detail，F4）

页面严格按独立开发者决策顺序自顶向下布局，严禁杂乱信息堆砌：

1. **首屏吸顶决策栏（Sticky Decision Bar）**：
   * 左侧：Verdict 徽章、D-M-W 档位、置信度、研究市场；
   * 中间：一句话 Why Now（为什么是现在进入）；
   * 右侧核心操作组：`[★ 关注]`、`[✔ GO 决定]`、`[✘ PASS 放弃]`、`[📄 导出机会报告]`。
   * `CANDIDATE`、置信度 `LOW`，或裁决不是 `BUILD_NOW` / `EARLY_BET` 时，GO 与导出禁用，并说明缺的发布条件。关注仍可用。
   * PASS 必须选择至少一条原因：需求不足、窗口已关、没有商业证据、超出时间预算、不是我的能力、其他。
   * GO 创建 Project，并带上当前 `verdict_id`。
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
6. **第五板块：做成什么形态（What to Build）**：
   * 推荐 Build Type 列表（≤ 3 项），含复杂度、执行规模与首发页面架构建议。
7. **第六板块：变现路线（Monetization Route）**：
   * Primary 与 Secondary 路线分析，所需流量强度与冷启动建议。
8. **第七板块：放弃条件（Kill Criteria，12）**：
   * 系统推荐的 1–2 条放弃红线，支持一键点击“采纳为我的监控告警”。

### 3.4 全局证据抽屉（Global Evidence Drawer）
* 在全站任何界面点击任意证据编号（形如 `evd_01J...` 或 `snp_01J...`），屏幕右侧滑出 480px 证据抽屉（Zustand 全局驱动）；
* 抽屉展示：数据源标识、精准抓取时间（本地与 UTC 并列）、证据类别标签（OBSERVED/SELF_REPORTED 等）、快照原始数据摘录（Raw JSON / 网页文本片段）。

### 3.5 机会研究报告与导出工作台（09、10）
* **交互触发**：仅已发布的 `BUILD_NOW` / `EARLY_BET` 可导出。点击 `[📄 导出机会报告]` 打开报告预览。`CANDIDATE` 不生成可导出报告。
* **内容呈现**：结构化展示 6 大分析板块（Executive Summary、Demand Intelligence、Commercial Evidence、SERP Weaknesses、Strategic Archetype、Risk & Kill Criteria）；
* **多格式导出栏**：
  * **`[📋 复制 Markdown]`**：一键将渲染完毕的 GFM Markdown 拷贝至剪贴板，方便粘贴至 Notion / Obsidian；
  * **`[⬇️ 下载 .md]`** / **`[⬇️ 下载 JSON]`** / **`[🖨️ 导出 PDF]`**：提供多种本地离线归档格式；
* **下游立项闭环**：
  * 报告底部显著展示 **`[🚀 基于此机会立项]`** 按钮，点击直接唤起 Project 创建流程，自动绑定 `opportunity_id` 与 `report_id`。

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
* 用户点击 `GO / PASS`：立即将卡片移入已决策分组，并弹出理由确认浮层。

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
| **无障碍与暗色模式** | WCAG 2.1 AA 级 | 默认支持系统级 Dark Mode，颜色对比度 ≥ 4.5:1 |
| **移动端适配** | 100% 响应式 | 在 iPhone / Android 上所有表格支持水平滑动手势，决策栏固定于底部 |
