# 04 — 数据源登记与采集器规格

Status: Draft ｜ 依赖：02、03 ｜ 被依赖：05、06、07、08

## 1. 目的与规则
数据是产品的原料与壁垒，也是最大的成本与合规风险。本文定义：数据源清单、准入流程、采集器契约、追踪层级与成本控制。

**硬规则**
1. 任何数据源上线前必须在本表登记，并完成 §7 准入检查；`legal_status = UNREVIEWED / BLOCKED` 的源不得在生产启用。
2. ToS 风险为 `HIGH` 的源须有书面豁免决策（记录在 ADR），且必须有降级方案。
3. 关键源（autocomplete、SERP）必须至少有一个备选供应商，切换不改变下游 schema。
4. 每次采集都写成本账本（`cost_ledger`）。

## 2. 数据源登记表

| ID | 名称 | 类别 | 方式 | ToS 风险 | 频率 | 角色 | 72h 降级方案 | 备注 |
|----|------|------|------|----------|------|------|--------------|------|
| `src_ac` | Google Autocomplete | AUTOCOMPLETE | 授权 API（首选）/ 无官方接口 | **HIGH**（自采）→ MEDIUM（授权供应商） | 每日 | D 轴核心输入；`first_observed` 来源 | 72h 内沿用最近成功联想快照并打 `STALE_DATA`（D 轴不降档、不告警）；超 72h D 轴 → `INSUFFICIENT` | 无官方 API；见 §8 |
| `src_serp` | Google SERP（深度分层，ADR-022） | SERP | 授权 API | MEDIUM | A 层每日 / B 层每周 | W 轴核心输入 | 同上；超 72h W 轴 → `INSUFFICIENT` | 直接抓取需豁免。`num=100` 自 2025-09 失效，Top 100 按 10 页计费；默认取 Top 10，仅映射到已核验 Project 的 query 每周取 Top 100（§9.2） |
| `src_volume` | 第三方关键词词量（月度搜索量序列） | ATTENTION | 授权 API | MEDIUM | 每月（按 query 拉取月度序列） | **仅供 `ev-1.1` 外部结果事件**（06 §7.1）与报告展示；**不得进入 D 轴特征**，否则 H1 再次自证 | 评估用源，无 72h 语义；缺失时该 Episode 的 `external_demand_formed` 记 `pending`，不判失败 | Proposed，须过 §7 准入（R2）；单价计入 §6.1 的 `C_vol` |
| `src_trends` | Google Trends | ATTENTION | 官方接口（如可用）/ 第三方 | MEDIUM | 每周 | D 轴辅助（权重 ≤ 0.10）；**不得成为单点依赖** | 本就可缺失（D 轴自动重归一）；超 72h 视同缺失 | 缺失时 D 轴自动重归一 |
| `src_hn` | Hacker News | ATTENTION | 官方 API | LOW | 每日 | Why Now / D 轴辅助 | 注意力源缺失仅降低 D 覆盖率，不影响轴分档；72h 内沿用 | |
| `src_github` | GitHub（搜索、Trending） | ATTENTION | 官方 API | LOW | 每日 | Why Now | 同上 | 遵守速率限制 |
| `src_reddit` | Reddit | ATTENTION | 官方 API | MEDIUM | 每日 | Why Now | 同上 | 商用条款需评估 |
| `src_ph` | Product Hunt | ATTENTION | 官方 API | MEDIUM | 每日 | Why Now；商业类比 | 同上 | 商用条款需评估 |
| `src_crawl` | 竞品站点爬取（定价 / checkout / 计数器） | COMMERCIAL | 自建爬虫，**两级管道**（静态 HTTP 优先，动态渲染站点回退无头浏览器，见 §4.2） | LOW–MEDIUM | 每周（A 层域名每 3 日） | M 轴核心输入（OBSERVED） | 72h 内沿用最近商业快照并打 `STALE_DATA`（M 轴不降档）；超 72h M 轴 → `INSUFFICIENT`；连续失败 ≥ 3 次的域名降级（02 §13） | 遵守 robots.txt |
| `src_platform_rev` | 收入透明平台（公开验证的收入 / 销售数据） | COMMERCIAL | 授权 / 公开页 | MEDIUM | 每周 | M 轴营收证据 | 同 `src_crawl` | 逐平台评估条款 |
| `src_gsc` | Google Search Console | GSC | 用户 OAuth | LOW | 每周 | **可选增强项**（PRD F10；见 §9.5） | 非关键源，缺失不影响任何轴；连接 `ERROR` 仅通知用户 | 只读最小权限 |
| `src_rdap` | RDAP / WHOIS | OTHER | 公开协议 | LOW | 按需 | 域名年龄（辅助） | 按需源，无降级语义（缺失即不判定域名年龄） | 可选 |
| `src_domain_established` | 域名上线 / 首次注册时间（RDAP/WHOIS 注册日、应用商店上架日、Wayback 首次快照） | OTHER | 公开协议 / 公开页 | LOW–MEDIUM | 按需 | `PROVEN_NEW_ENTRANT` 的"上线不满 6 个月"判据；写入 `domains.established_at` / `established_source`（03 §domains） | **来源为空时不得推断**（不适用 72h 沿用；缺失即不标 `PROVEN_NEW_ENTRANT`） | 每项必须连同判定依据一起存（PRD §1.7.3） |
| `src_traffic_est` | 第三方流量估算 | COMMERCIAL | 授权 API | MEDIUM | — | 仅展示（`THIRD_PARTY_ESTIMATE`） | 仅展示，缺失不影响轴 | Phase 2，可选 |

> 具体供应商（如提供 SERP / autocomplete 的商业 API）在 §8 评估矩阵中比选；候选须逐一核对当前条款与价格，不在本文预设结论。

> **72h 降级登记规范（PRD §1.6、F1.3；ADR-021）**：偶发采集失败先 `STALE_DATA`——72 小时内沿用最近一次成功快照的档位，**不置 `INSUFFICIENT`、不发布降档 Verdict、不投递降级告警**；**连续失败超过 72 小时**，该源所服务的轴才正式置 `INSUFFICIENT`，届时恢复正常降档与告警路径。每个源登记时必须填写上表「72h 降级方案」列，并明确该源服务的是哪一条轴（每个源只服务一条轴）。判定位置与执行位置见 02 §5.3。

## 3. 采集器契约

```ts
interface Collector<TScope, TItem> {
  readonly sourceId: string;            // src_*
  readonly version: string;             // collector_version，语义化
  readonly limits: {
    maxConcurrency: number;
    ratePerSecond: number;
    perDomainRatePerSecond?: number;
  };

  /** 枚举当日需要采集的条目（含预算截断） */
  plan(ctx: RunContext, scope: TScope): Promise<PlannedBatch<TItem>>;

  /** 采集单个条目；必须幂等；不得抛出未分类异常 */
  collect(ctx: RunContext, item: TItem): Promise<CollectOutcome>;
}

type CollectOutcome =
  | { status: 'OK'; snapshots: SnapshotDraft[]; evidence: EvidenceDraft[]; raw?: RawPayloadDraft; cost: CostRecord }
  | { status: 'SKIPPED'; reason: 'ROBOTS_DISALLOWED' | 'BUDGET' | 'NOT_MODIFIED' | 'DUPLICATE' }
  | { status: 'FAILED'; retryable: boolean; errorCode: string; message: string; cost?: CostRecord };

interface RunContext {
  runId: string; obsDate: string;      // UTC date
  clock: () => Date;                    // 可注入，测试用
  budget: BudgetGuard;                  // 见 §6
  logger: Logger; tracer: Tracer;
}
```

**契约要求**
- `collect` 幂等键：`(sourceId, obsDate, itemKey)`；重复调用返回同一结果，不重复扣费（命中已有快照即 `SKIPPED/DUPLICATE`）。
- 输出只包含**草稿**，由持久化层统一写入快照 / Evidence，采集器不直接写库。
- 每个 `EvidenceDraft` 必须带 `evidence_class`、`evidence_type`、`observed_at`；`SELF_REPORTED` / `THIRD_PARTY_ESTIMATE` 必须带 `label_text`。
- 采集器不得包含评分逻辑。

## 4. 通用采集规则

| 主题 | 规则 |
|------|------|
| 重试 | 指数退避 + 抖动；最多 3 次；仅对 `retryable` 错误 |
| 熔断 | 单源连续失败率 > 50%（窗口 5 分钟、≥ 20 次）→ 熔断 15 分钟；自动半开探测 |
| 速率 | 按 `limits` 与供应商配额；全局令牌桶 |
| 通道 | **Fast Lane / Slow Lane 双通道**（ADR-017、PRD F1.2）：Fast Lane 只服务前端主动触发的「即时初筛」（全局令牌桶 ≤ 5 req/s，缓存命中 < 200ms、实时采集 < 8s）；Slow Lane 服务每日例行观测与每周回测（走供应商低价异步队列，全天任务均匀打散在 24h 窗口）。两者共用同一采集器契约与快照表，调度与速率上限各自独立（02 §5.2） |
| 一鱼多吃（深度分层，ADR-022） | 默认采 **Top 10**（`depth = 10`），供 F6 弱点计算（05 §3.3）；只对映射到已核验 Project 的 query 每周采一次 **Top 100**（`depth = 100`），同一份快照既更新 W 轴、又在内存中匹配项目域名 / 商店链接（`project_serp_rankings`）。**严禁为追踪项目对同一 query 另发一次 SERP 请求**（PRD F1.1）。`num=100` 自 2025 年 9 月失效，Top 100 按 10 页计费（§6.1） |
| 7 天全局去重 | Fast Lane 命中 `serp_snapshots` 中 7 天内同 `(query, market_country, research_language)` 的最近一份快照即直接复用，API 成本为 0；**不建 Redis 缓存层**（ADR-017：快照不可变，额外缓存会造出第二份可能与账本不一致的事实源） |
| 隔离 | 作业按 `(source, batch)` 划分；故障不跨源传播 |
| 载荷 | 原始响应 gzip 存对象存储，记 `sha256`；快照表存标准化行 |
| 时间戳 | `fetched_at` 取采集时刻；`obs_date` 取批次日期，不取 `fetched_at` 的日期（跨零点安全） |
| 去重 | 相同 `sha256` 的载荷不重复存储 |
| 失败可见性 | 失败写入 `collector_runs.error`；15 分钟内在 Admin 可见 |

### 4.1 爬取礼仪（`src_crawl`）
- 遵守 `robots.txt`；被禁止的路径记 `SKIPPED/ROBOTS_DISALLOWED`，不绕过。
- 固定、可识别的 User-Agent，含联系页 URL；提供退出爬取的联系渠道，收到请求 72 小时内处理。
- 每域名并发 = 1，间隔 ≥ 5 秒；不登录、不填表、不提交任何表单。
- 只请求：首页、`/pricing`、导航中发现的定价页、公开 checkout 入口的 HTML（不发起支付）。
- 不采集个人数据；不存储评论中的个人信息。

### 4.2 两级抓取管道（静态优先，动态渲染回退）

**问题**：大量现代独立工具 / Micro-SaaS 站点（Next.js、Nuxt、Webflow 等）将价格信息渲染在客户端（如 Monthly / Annual 切换 Tab 默认不在 DOM 中），或通过 Stripe Pricing Table 等 `<iframe>` / Web Component 异步加载。纯静态 HTTP 抓取会拿到空文本，导致 07 §11 的字面校验找不到价格而丢弃，M 轴被误判为 `INSUFFICIENT` 或 `LOW`——这不是"数据不足"，而是"抓取方式不对"，两者必须区分。

**管道**：
```text
Tier 1（默认，全部请求）
  静态 HTTP GET → 解析 HTML
    ├─ 检测到已知动态定价框架特征（见下）？ ──是──▶ 升级 Tier 2
    ├─ 价格正则（§11 检测规则）命中 0 处，且页面明显是 SPA 壳（<div id="root">/#__next 等标记，
    │  且可见文本 < 阈值）？ ──是──▶ 升级 Tier 2
    └─ 否 ──▶ 按 07 §11 正常检测 / 抽取，记 fetch_tier = 'STATIC'

Tier 2（按需升级）
  无头浏览器渲染（Playwright/CDP，托管服务优先，见 §4.3）
    → 等待 DOM 挂载信号（networkidle 或固定超时，默认 8s）
    → 截取渲染后可见文本 + 关键选择器（价格容器、tab 面板）
    → 记 fetch_tier = 'HEADLESS'
    → 若仍无法提取到价格文本 → 视为正常的"该站点无公开定价"，不视为抓取失败
```

**已知动态定价框架特征**（版本化维护于 `dynamic_pricing_signatures`，随支付签名库一起更新）：
- `<stripe-pricing-table>` 自定义元素或对应脚本引用（`js.stripe.com/v3/pricing-table.js`）；
- 常见价格 SaaS 组件的脚本域名（如已知的 embed 服务商域名清单，逐一核实后加入）；
- 页面主体几乎为空但存在 `id="root"` / `id="__next"` / `data-reactroot` 等客户端渲染标记，且静态 HTML 中价格正则命中为 0。

**成本控制**：Tier 2 比 Tier 1 昂贵（托管无头浏览器按渲染次数计费），因此：
- 只在 Tier 1 判定为"疑似动态"时才升级，不默认对全部目标使用 Tier 2；
- 同一域名 Tier 2 结果按 §7 持续性周期缓存复用判定（即该域名后续快照沿用同一 `fetch_tier`，除非连续 2 次 Tier 1 检测结果与历史不符才重新探测）；
- Tier 2 调用计入成本账本（`source_id = src_crawl`, `run.scope.fetch_tier = 'HEADLESS'`），纳入 §6 成本模型。

### 4.3 无头浏览器基础设施（Phase 0 决策）
首期采用**托管无头浏览器服务**（如 Browserless、ScrapingBee 一类按请求计费的托管方案，具体供应商在 Gate 0 前完成 ≥ 2 家实测比选，比选维度同 §8），不自建 Playwright 容器集群：2–3 人团队没有余力运维浏览器集群的内存泄漏、僵尸进程、指纹更新等问题，按请求付费在追踪池规模（§4.4 的 2,000 个 Tier A/B 种子上限）下的绝对成本可控。若 Phase 2 追踪池规模显著扩大，重新评估自建集群的边际成本。

### 4.4 Autocomplete 早停剪枝（成本控制）
**问题**：不加约束的 `seed + a–z` 全遍历，在 2,000 个 Tier A/B 种子、深度 ≤ 2 的设定下，理论峰值可达每日数万次请求；按主流商业供应商单价估算，仅 autocomplete 一项月成本可能达到目标毛利率无法承受的量级，直接威胁 Gate 0。

**规则**（替代原"单种子日预算 40 次"的固定上限，见 §9.1 修订）：
```text
对每个种子，按修饰词优先级分层展开：
  Layer 0（必扩展）：高意图前缀 / 后缀模板（best * for / * vs / free * / * price / * alternative …，
                     按 research_language 维护模板表，不做 a–z 遍历）
  Layer 1（条件扩展）：Layer 0 中任一模板返回 ≥ 2 条新 query 时，才对该模板做单字母延伸
                     （a–z，26 次请求预算内）
  早停：单个 Layer 1 分支连续 3 个字母返回空或与已收集集合重合度 ≥ 90%，立即终止该分支剩余延伸

预期效果：多数种子仅消耗 Layer 0 的模板次数（个位数到十几次），只有确实在扩张的种子才触发
        Layer 1 的完整字母遍历，单种子日均请求量压至个位数到十位数（而非固定 40 次上限）。
```
早停参数（`layer1_trigger_min_new`、`early_stop_streak`、`early_stop_overlap`）纳入 `sources.config`，随 §6 成本模型一并在 Gate 0 校准。


## 5. 追踪层级与宇宙

| 层级 | 内容 | SERP | Autocomplete | 商业爬取 |
|------|------|------|--------------|----------|
| **A** | TRACKED 机会的主 query + 高价值簇 query | 每日 | 每日 | 目标域名每 3 日 |
| **B** | 其余 TRACKED 与高潜候选 | 每周 | 每日（作为种子） | 每周 |
| **C** | 仅 autocomplete 扩展得到的 query | 无 | 每日或随种子 | 无 |

**升降级**
- CANDIDATE → TRACKED：满足 02 §7 筛选规则。
- B → A：D 轴 ≥ MEDIUM 且 W ≥ MEDIUM；A → B：连续 30 天 D = LOW。
- TRACKED → ARCHIVED：连续 60 天 D = LOW 且无新增 query。
- 层级由预算护栏（§6）与升降级规则共同决定；升降级写审计日志。

## 6. 成本模型与预算控制

### 6.1 公式
```text
-- Slow Lane（与用户数无关）
C_day = N_A · p_A · c_page                             -- p_A：A 层每次采集页数，默认 1（Top 10）
      + (N_B / 7) · p_B · c_page                       -- p_B 默认 1
      + (N_proj_q / 7) · (10 − p_A) · c_page           -- 映射到已核验 Project 的 query 每周补齐 Top 100
      + N_ac · c_ac                                    -- N_ac 由 §4.4 早停规则动态产生，非固定预算
      + N_dom · c_crawl / f_crawl
      + N_dom · r_headless · c_headless / f_crawl      -- Tier 2 无头浏览器成本
      + C_attn + C_llm + C_vol / 30
C_month_slow ≈ 30 · C_day

-- Fast Lane（随用户数线性增长）
C_month_fast = U_active · s_per_user · (1 − r_dedup) · c_scan
  s_per_user：每活跃用户月均初筛次数（Free 终身 1 次摊入，Pro ≤ 15）
  r_dedup：7 天全局去重命中率（Gate 0 实测）
  c_scan：单次初筛成本 = p_scan · c_page_live + c_crawl_live

单机会月成本      = C_month_slow / N_TRACKED
单付费用户边际成本 = (C_month_fast_pro + Δ C_month_slow 因该用户新增的 Project query) / U_pro
毛利率 = 1 − (C_month_slow + C_month_fast + 固定成本) / 月收入
```
`c_*` 为供应商单价（由 §8 评估后填入 `sources.config`）；**`c_page` 按 10 条结果一页计价**——`num=100` 自 2025 年 9 月失效后，供应商基础价只覆盖前 10 条（见 30 §8 来源），旧公式把一次 Top 100 记作一个 `c_serp`，会把 SERP 成本低估约 10 倍。`f_crawl` 为爬取间隔天数；`r_headless` 为触发 Tier 2 的目标域名占比（初始假设 20%–40%，需在 Gate 0 期间用真实抽样校准，见 §4.2/§4.3）；`c_headless` 为托管无头浏览器单次渲染单价；`N_proj_q` 为映射到已核验 Project 的不同 query 数（ADR-022）；`C_vol` 为 `src_volume` 月度费用。

### 6.2 预算护栏
- `daily_budget_usd`、`monthly_budget_usd` 配置于 `sources.config` / 全局配置。
- `BudgetGuard.reserve(cost)` 在每次采集前调用；超出预算返回拒绝。
- **自动降级顺序**（前一级不足以回到预算内再触发下一级）：
  1. 暂停 Discovery 扩展（S1）
  2. B 层 SERP 频率由每周降为每两周
  3. 暂停新 Tier A 升级
  4. Tier A 中 D = LOW 的降为 B
- 触发任何降级即向 Admin 告警，并在成本仪表盘标记。

### 6.3 Gate 0 交付物
- 用真实供应商报价填充的成本表，含无头浏览器供应商实测单价与 `r_headless` 实测值（§4.2/§4.3）；
- Autocomplete 早停规则（§4.4）在真实种子集上的实测单种子请求均值，与"固定 40 次"假设对比；
- 目标毛利率下可支撑的 `N_TRACKED` 上限；
- 若上限 < 产品所需最低追踪池规模，Gate 0 不通过。

### 6.4 单位经济目标（对齐 PRD F1 §8.2）
- **单付费用户月度边际采集成本 < $1.00**：由 ADR-022 深度分层、"7 天全局去重"（复用 `serp_snapshots`，无 Redis）与"Slow Lane 24h 低价异步队列"共同压降。
- **500 活跃用户规模下，月度新增边际 SERP API 成本 < $20**（PRD F1 验收项）。
- **两条目标均待重算（R7）**：它们是在"一次请求拿 Top 100"的前提下写的，这个前提已失效。Gate 0 的成本表（§6.3）必须用 §6.1 新公式代入实测单价与 `r_dedup`，给出两条目标能否达标的结论；采集策略已按 ADR-022（Accepted，PRD v2.2 F1 第 1 条，Q14）定为深度分层；若代入实测单价后仍不能达标，Gate 0 不通过，须先调整追踪池规模或分层频次，**不得**沿用旧数字进入 Phase 1。
- 单付费用户成本的主要变量是 `s_per_user × (1 − r_dedup)` 与该用户新增的 Project query。Pro 每月 15 次初筛若去重率很低，单项就可能逼近 $1，成本表必须单列这一项。

## 7. 数据源准入清单
新源上线前必须全部完成：

| # | 检查项 | 通过条件 |
|---|--------|----------|
| 1 | 登记于 §2 | 字段完整 |
| 2 | 条款审阅 | 商用、存储、再分发、展示均被允许，或记录了限制条件 |
| 3 | 合规评估 | `legal_status = APPROVED / APPROVED_WITH_CONDITIONS` |
| 4 | 降级方案 | 源不可用时的系统行为已定义并测试 |
| 5 | 成本 | 单位成本已知并纳入模型 |
| 6 | Schema 契约 | 采集器通过契约测试（18 §4） |
| 7 | 数据质量 | 抽样 100 条人工核对，错误率在阈值内 |
| 8 | 展示权限 | 明确哪些字段可在公开页与 API 中展示 |

## 8. 供应商评估矩阵（SERP / Autocomplete）

| 维度 | 权重 | 说明 |
|------|------|------|
| 数据覆盖 | 25% | 支持目标市场 / 语言；Top10 完整度；SERP features |
| 稳定性与延迟 | 15% | 成功率、批量接口、并发限制 |
| 单价与计费方式 | 20% | 按请求 / 按结果；批量折扣 |
| 条款 | 20% | 存储期限、再分发、公开展示 |
| 历史数据能力 | 10% | 是否提供可追溯的历史 SERP（用于补齐冷启动） |
| 集成成本 | 10% | API 质量、SDK、文档 |

**产出**：Gate 0 前完成 ≥ 2 家供应商的实测（各 ≥ 1,000 次请求），记录成功率、字段完整率、单价，形成 ADR-006 的决策依据。

## 9. 各源采集细则

### 9.1 Autocomplete（`src_ac`）
- 输入：种子 query（Tier A/B 主 query + 簇 query + 主题种子）；扩展模式：分层早停剪枝，见 §4.4（不做无条件 `seed + a–z` 全遍历）。
- 输出：`autocomplete_observations` 行；新 query 写入 `queries`，`first_observed_at` = 本系统首次观测时间。
- 总深度 ≤ 2；单种子实际请求量由 §4.4 早停规则动态决定，硬上限 `max_expansions_per_seed`（默认 60，作为异常保护而非常态预算）仍保留，防止早停规则失效时无限展开。
- **语义声明**：`first_observed` 仅代表本系统观测；Methodology 页公开观测起始日期。

### 9.2 SERP（`src_serp`）
- **深度分层（ADR-022）**：默认每次保存 **Top 10**（`serp_snapshots.depth = 10`）：URL、标题、摘要、排名、SERP features；域名解析到 eTLD+1（使用公共后缀列表）。rank 1–10 供 F6 弱点计算。
- 只对**映射到已核验 Project 的 query** 每周一次取 **Top 100**（`depth = 100`，分 10 页请求、同一快照落库），11–100 名只供内存匹配项目排名（F10）。一鱼多吃仍然成立：同一次 Top 100 既更新 W 轴、也更新项目排名，**不为项目追踪发起第二次同 query 请求**。
- 未映射到任何 Project 的 query 不取 11–100 名。旧规则（每次 `num=100`）在 2025 年 9 月 Google 停用该参数后已无法以单次请求实现。
- W 轴与 §3.3 的 SERP 弱度只读 rank 1–10，因此深度分层不改变任何轴的计算口径。
- `market_country`、`research_language` 作为请求参数显式传入，不推导。
- 分类（结果类型、域名权威类别、相关性）由 S3 完成（08 §4）；结果类型标签在入库时冻结（ADR-020）。

### 9.3 注意力源（HN / GitHub / Reddit / PH）
- 输出 `INFERRED` 类 Evidence（类型 `ATTENTION_MENTION`），含实体、来源、时间、互动量。
- 实体识别仅做候选匹配（08 §3），低置信度不入库。
- Why Now 文案只引用这些 Evidence，不引入来源外事实。

### 9.4 商业爬取（`src_crawl`）
详见 07。采集器只负责抓取与结构化抽取草稿，分档在 05 / 07。

### 9.5 GSC（`src_gsc`）— 降级为可选增强项（PRD F10、§12.3）

GSC 不再作为"结果回流 / 校准"的常规数据源。

- **主追踪改为自身 SERP Top 100 快照的内存匹配**：系统在执行 F1 例行快照采集（§4 一鱼多吃）时，于内存中匹配已核验项目的域名 / 商店链接，生成 `project_serp_rankings`（03 §projects），据此计算 Builder-outcome precision（30 天 Top 100 入榜率）与公开战绩大盘。此路径**不依赖用户授权、不消耗额外请求**。
- **理由**：核心 ICP 是出海站长，普遍不愿授权 GSC（PRD F10 的"信任摩擦"）。把主追踪建立在自身管线上，才能对全体用户一致生效。
- **GSC 收敛为可选增强项**：仅供愿意深度复盘精细曝光 / 点击数据的用户自愿连接，用于补充可选指标；**不参与三轴评分，也不作为 Builder-outcome precision 的必需输入**。
  - 用户经 OAuth 授权，scope 仅 `webmasters.readonly`；**不向 LLM 发送 GSC 令牌**（08 §12）。
  - 每周同步：按页面与查询维度的 impressions / clicks / position，回溯 28 天以吸收数据修正。
  - 令牌失效 → 连接状态 `ERROR` → 通知用户重新授权，不自动重试超过 3 次。
