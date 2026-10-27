# 02 — 系统架构

Status: Draft ｜ Last reviewed: 2026-10-18（对齐 PRD v3.1：无槽位、无质押、无买断作业）｜ 依赖：01-PRD v3.1、00-INDEX

## 1. 目标与约束

| 类别 | 内容 |
|------|------|
| 团队 | 2–3 名工程师；运维面必须小 |
| 核心约束 | 评分可重算（P7）；快照与账本不可变（P5）；单源故障不阻塞全局 |
| 关键取舍 | 模块化单体 > 微服务；Postgres > 多存储；批处理 > 流处理 |
| 首发规模假设 | 见 §11 |

## 2. 总览

> **拓扑说明（ADR-011）**：`apps/web`（Next.js App Router）承载用户界面渲染，也通过 `app/api/v1/*` Route Handler 直接对外提供 REST 端点；两者在同一进程内共享 `packages/services`，不经内部 HTTP 跳步。不再单列独立部署的 `apps/api` 服务。`apps/worker` 独立部署，承担批处理管线、告警投递、GSC 同步、机会报告生成等不应阻塞请求-响应周期的工作。

```mermaid
flowchart LR
  subgraph Ext[外部]
    SERP[SERP / Autocomplete 供应商]
    ATTN[HN / GitHub / Reddit / PH]
    WEB[竞品站点 / 无头浏览器集群]
    GSC[Google Search Console]
    LLMP[LLM Provider]
    BILL[计费 MoR]
    MAIL[邮件服务]
  end
  subgraph Sys[系统]
    WEBAPP["apps/web（Next.js）<br/>页面渲染 + /api/v1/* (REST API)"]
    WORKER[apps/worker<br/>pg-boss]
    PGB[[PgBouncer<br/>transaction pooling]]
    PG[(PostgreSQL)]
    OBJ[(对象存储)]
  end
  SERP --> WORKER
  ATTN --> WORKER
  WEB --> WORKER
  GSC --> WORKER
  WORKER <--> LLMP
  WORKER --> PGB
  WORKER --> OBJ
  WEBAPP <--> LLMP
  WEBAPP --> PGB
  PGB --> PG
  BILL --> WEBAPP
  WORKER --> MAIL
```

## 3. 组件职责

| 组件 | 职责 | 不做什么 |
|------|------|----------|
| `apps/web` | 用户界面渲染（RSC/Server Actions 直接调用 `packages/services`）；`app/api/v1/*` 提供 REST（10）端点；鉴权、配额、限流；公开站 SSR / ISR、i18n | 不做批处理、不做定时任务；不直接持有 collector / LLM 长任务（超时敏感操作转发至 worker 队列并轮询） |
| 应用服务层 `packages/services` | `OpportunityService` `DecisionService` `ReportService` `ProjectService` `AlertService` `EntitlementService` | 不含协议细节（HTTP 差异在 adapter 内处理，不渗入 service） |
| `apps/worker` | 每日管线各阶段、告警投递、GSC 同步、机会报告生成（异步部分）、账本写入（S6，单实例） | 不响应用户同步 HTTP 请求 |
| `@app/scoring` | 纯函数：features → 三轴 / Verdict / 生命周期；核心计算使用定点整数（基点），禁止依赖原生浮点的跨版本 / 跨求和顺序一致性（00 ADR-004） | 无 IO、无时钟、无随机数、无 LLM |
| PgBouncer | 连接池代理（transaction 模式），隔离 worker 批处理的高并发短事务与 web 在线查询 | 不做查询路由 / 读写分离决策（首发单主库） |
| PostgreSQL | 事实源、账本、队列（pg-boss） | — |
| 对象存储 | 原始 HTML / JSON 载荷，压缩存储 | 不作为查询源 |

## 4. 代码库结构

```text
apps/
  web/            Next.js（应用 + 公开站 + /api/v1/* Route Handler：REST 出口）
  worker/         pg-boss workers 与调度（含 S6 账本单写入者）
packages/
  core/           领域类型、枚举（来自 00 §4.3）、错误、branded ID 类型（区分 uuid 存储表与 text ULID 表，见 03 §1）
  scoring/        纯函数评分与 Verdict（05）；定点整数运算工具
  ledger/         哈希链、checkpoint、验证（06）
  collectors/     各数据源采集器（04 的契约），含两级抓取（静态 / 无头浏览器）调度
  commercial/     商业信号检测、抽取、摘要装配（07）；M 轴分档纯函数位于 scoring/
  llm/            prompt 注册、schema 校验、引用校验（08）；硬数字占位符渲染
  report/         机会分析报告组装与校验、多格式导出（09）
  services/       应用服务层（`apps/web` 与 `apps/worker` 共同依赖）
  db/             迁移、查询、类型、PgBouncer 连接配置、uuid↔前缀字符串编解码
  i18n/           消息目录与本地化生成（14）
  config/         scoring_config schema 与加载
```

依赖方向：`web → services → {scoring, ledger, commercial, brief, llm, db}`；`worker → services`（与 `web` 平级依赖，不经 `web`）；`scoring` 不得依赖任何其他包（除 `core`）。CI 用依赖规则强制。

## 5. 每日批处理管线

所有阶段以 `(obs_date, stage, scope)` 为幂等键；重跑安全，不产生重复快照。

| # | 阶段 | 计划开始 (UTC) | 输入 | 输出 | 确定性 |
|---|------|---------------|------|------|--------|
| S1 | Discovery | 00:00 | 种子、注意力实体 | 新 query、候选 Opportunity | 否 |
| S2 | Collect | 00:30 | 追踪池、层级 | autocomplete / SERP / 注意力 / 商业快照与 Evidence | 否 |
| S3 | Normalize & Classify | 03:30 | 新快照 | 结果类型、域名分类、商业抽取 | 否（LLM，schema 校验） |
| S4 | Feature Build | 04:30 | 快照与 Evidence | `axis_features` | **是** |
| S5 | Score | 05:00 | features + `scoring_config` | 三轴、Verdict、生命周期 | **是** |
| S6 | Ledger Append | 05:30 | S5 输出 | `verdicts` 行 + checkpoint | **是**（单写入者，见下） |
| S7 | Events & Alerts | 05:45 | Verdict 变化、Kill criteria | 通知 | 是（触发判定）/ 否（投递） |
| S8 | Projections | 06:00 | 账本与业务表 | 读模型、public projection、sitemap | 是 |

- **SLA**：S1–S8 于 06:30 UTC 前完成；账本 checkpoint 于 07:00 前公开。
- **屏障规则与快照批次硬冻结（Snapshot Batch Sealing）**：S4 开始前等待 S2/S3 全部完成或到达 04:30 超时。到达超时时，执行原子批次冻结：将当日 `collector_runs` 中仍处于 `RUNNING` 的作业标记为 `FAILED/TIMEOUT`；S4 特征构建查询时，**强制仅读取 `run_id` 属于已终态为 `SUCCEEDED` 或 `PARTIAL` 的快照记录**，严禁读取超时后迟到写入的数据，彻底规避并发脏读并保障回测与重算 100% 确定性（P7）。超时的来源标记为 `failed`；若该源在 72 小时宽限期内（`source_health = STALE`）则沿用最近成功档位并打 `STALE_DATA`，**超 72h 宽限期后**覆盖率下降才可能把该轴转为 `INSUFFICIENT`（ADR-021、§5.3）。**永远不阻塞管线**。
- **单元隔离**：collector 按 `(source, batch)` 分作业；一个作业失败只影响该源。
- **S6 单写入者约束（ADR-014）**：`verdicts` 表的哈希链要求"同一 `obs_date` 内按 `opportunity_id` 升序前后依赖"，因此 S6 **只能由一个 Worker 实例执行**，禁止多实例并发写入该表。实现：S5 输出全部落入 `verdicts_pending` 暂存表（无哈希链约束，可并发写）；S6 由单一进程读取当日全部暂存行，按 `opportunity_id` 排序后在内存中串行计算 `row_hash` 与 Merkle 根，最后单次批量 `COPY` 写入 `verdicts` 并清空暂存表。追踪池规模（≤ 2,000 机会）下，此串行内存计算 + 批量提交预期在数百毫秒至数秒内完成，不构成管线瓶颈；若追踪池规模显著增长（见 04 §4.4），需重新评估是否引入分桶两级 Merkle 结构。
  调度层通过 pg-boss 的单例作业（同一 `obs_date` 的 S6 任务加咨询锁 `pg_advisory_lock`）保证同一时刻至多一个 S6 实例在跑，重复调度直接跳过。
- **项目 SERP 排名匹配（零新增请求，PRD F1.1）**：S2 对映射到已核验 Project 的 query 每周采一次 Top 100 快照（`depth = 100`，ADR-022、04 §4），在内存中顺带匹配 `project_credentials.host`（已核验项目的域名 / 商店链接），产出 `project_serp_rankings`（rank 1–100；`best_rank IS NULL` 表示当日未入榜）。其余 query 只采 Top 10。**严禁为追踪项目对同一 query 另发一次 SERP 请求**——这份 Top 100 快照同时供 W 轴使用。`num=100` 失效后 Top 100 按 10 页计费，这部分成本已计入 04 §6.1。
- **Merkle 定位（后台存证，PRD §1.8 第 7 条）**：S6 计算并封存 Merkle 根，作为**后台不可篡改的技术存证**；前台主打 **Cohort Hit Rate & Accuracy Matrix（公开战绩大盘与失误复盘）**，仅在公开站底栏留一个 Merkle 根校验入口。两者不互相替代：校验入口证明"账本未被篡改"，战绩大盘回答"判断准不准"。公开投影由 S8 另行生成（15）。

### 5.1 队列与调度（ADR-003 的落地形态）

调度不是仓库之外的一份配置：排期、重试、死信策略与任务实现在**同一份代码**里（`apps/worker/src/tasks.ts`），`apps/worker` 以常驻消费者运行（`docker compose up -d worker`）。队列名 = 手工执行时的子命令名，因此告警里写着的任务名就是运维要敲的命令。

| 队列 | cron（UTC） | 重试 | 超时 | 失败告警阈值 |
|---|---|---|---|---|
| `run-daily` | `30 3 * * *` | 1 次，退避 600s | 1h | 连续 2 次 |
| `discover` | `45 3 * * *` | 2 次，退避 300s | 30m | 连续 2 次 |
| `generate-intents` | `0 4 * * *` | 2 次，退避 300s | 30m | 连续 2 次 |
| `validate-intents` | `15 4 * * *` | 2 次，退避 300s | 30m | 连续 2 次 |
| `generate-experiments` | `30 4 * * *` | 2 次，退避 300s | 30m | 连续 2 次 |
| `sync-gsc` | `0 5 * * *` | 2 次，退避 600s | 30m | 连续 2 次 |
| `evaluate-episodes` | `0 6 * * *` | 2 次，退避 300s | 30m | 连续 2 次 |
| `sweep-subscriptions` | `15 6 * * *` | 2 次，退避 300s | 15m | 连续 2 次 |
| `ingest-external-demand` | `30 5 * * *` | 2 次，退避 600s | 30m | 连续 2 次 |
| `check-yield` | `50 7 * * *` | 2 次，退避 300s | 15m | 连续 2 次 |
| `apply-output-guarantee` | `55 7 * * *` | 2 次，退避 300s | 15m | 连续 2 次 |
| `recompute-sample` | `10 8 * * *` | **不重试** | 15m | 连续 1 次（P0） |
| `verify-ledger` | `0 7 * * *` | **不重试** | 15m | 连续 1 次（P0） |
| `assess-commercial` | 仅手工 | 不重试 | 15m | — |

- **重试耗尽进死信**：统一落到 `emeradar-dead-letter`，消费它只做两件事——写一条 `audit_log`（`job.dead_lettered`）并让队列清空，不再重复发邮件（同一事件在重试过程中已经发过）。
- **失败可见**：每次执行写 `audit_log`（`job.succeeded` / `job.failed` / `job.alerted` / `job.dead_lettered`）。**连续失败次数从审计表本身推导**（"上次成功之后的失败条数"），不另设计数器——计数器是第二份状态，必然会与审计漂移，而它还必须跨进程重启成立。
- **`verify-ledger` 默认验最新检查点，不是"今天"**：账本只在有裁决的日子推进，"今天没有检查点"是常态而非故障。把它当失败会让 P0 通道每天说一次假话，真话也就没人看了。
- **队列参数不会因重新部署而更新**：pg-boss 的 `createQueue` 是 `ON CONFLICT DO NOTHING`。改重试次数需要显式 `UPDATE pgboss.queue`，这条与 `schema.sql` 里"无条件谓词每次部署重放"的教训同源。
- **发布节奏不依赖时钟对齐**：`run-daily` 在 03:30 UTC、最迟 07:00 出验证结果，与 §5 的 SLA 一致；cron 表达式显式带 `tz: 'UTC'`，不依赖宿主机时区。
- **没有质押/买断类作业（v3.1）**：`release-expired-stakes` 与 `expire-stealth-locks` 已随 PRD v3.1 删除。GO 只扣月度配额、建 Project 壳并解锁点火包；凭证核验没有截止时间，失败不释放资源、不退还配额。机会可见性只由套餐与公开资格决定，不存在"到期解密"或"占位作废"的调度依赖。
- **项目 SERP 排名匹配**：不是独立定时任务，随 S2 的 Top 100 快照采集在内存阶段完成（见 §5 说明），因此不占单独队列。

### 5.2 双通道管线（Fast Lane / Slow Lane，ADR-017）

PRD F1.2 要求把"用户主动触发的即时初筛"与"系统例行观测"彻底隔离，避免前端交互的突发流量与批量巡检互相踩踏供应商配额、触发 429。两条通道共用同一份快照表与同一套采集器契约（04 §3），但调度、预算与速率上限各自独立。

| 通道 | 服务对象 | 触发 | 速率与并发 | 时延目标 | 承载 |
|---|---|---|---|---|---|
| **Fast Lane** | 前端主动触发的「即时初筛」（F3 第 1 阶段） | 用户请求（`apps/web` → worker 短任务） | 全局令牌桶 ≤ 5 req/s | 缓存命中 < 200ms；实时采集 < 8s（PRD §9.3） | 高优先级即时任务 |
| **Slow Lane** | 每日例行观测（S2）与每周战绩回测 | pg-boss 定时 / 分发 | 走供应商低价异步队列；全天任务均匀打散在 24h 窗口 | 无硬时延要求，容忍小时级 | `apps/worker` 批处理队列 |

**削峰与去重不引入 Redis（ADR-017，修订 ADR-003）**
- **全局令牌桶**：复用 `rate_limit_buckets`（`bucket_key / count / reset_at`，见 `apps/web/src/lib/rate-limit.ts`），以单条 `INSERT ... ON CONFLICT DO UPDATE` 的原子条件递增实现"全局 ≤ 5 req/s"计数。Fast Lane 每次外部请求前必须先取桶；桶满则排队或降级为读最近快照。
- **7 天全局去重**：**不建缓存层**。Fast Lane 收到查询时，先查 `serp_snapshots` 中 7 天内同 `(query, market_country, research_language)` 的最近一份快照直接复用（缓存命中，API 成本为 0）。快照本就不可变，把它当缓存复用即可；引入 Redis 反而会造出**第二份可能与账本不一致的事实源**（ADR-017）。
- 追踪池规模（≤ 2,000 机会，§11）下，Postgres 足以承担"按 key 的一次原子读写"；若压测不达标，再按 ADR-003 的推翻流程引入外部缓存。

**Slow Lane 的 24 小时均匀打散（pg-boss 落地，ADR-003）**

仓库实际使用 **pg-boss**（PRD 正文里写的 BullMQ 只是举例，以本仓库实现为准）。做法：

1. `run-daily`（或 S1/S2 的分发作业）读当日采集计划，得到 N 个待采条目；
2. 逐个 `boss.send('collect', item, { startAfter })` 入队，第 i 个的 `startAfter = windowStart + i × (86400 / N)` 秒（均匀铺满 24h），必要时叠加 ±抖动以错开供应商侧的精确定时；
3. pg-boss 在到达 `startAfter` 之前不投递该 job，消费者在 24h 内匀速取件，从而**杜绝整点并发尖峰与 429**；
4. 重试与死信沿用 §5.1 统一策略；`send` / `createQueue` 的参数不会因重新部署而自动刷新（同 §5.1 的 `ON CONFLICT DO NOTHING` 教训），调整打散窗口需显式改代码并观察。

**Fast Lane 不做打散**（它对时延敏感，必须即时响应），只有 Slow Lane 铺开到 24h。

### 5.3 采集源 72 小时优雅降级（ADR-021，PRD §1.6 / F1.3）

单源偶发失败不得被用户读成"竞争格局变了"。判定位置在**每日管线的 S2→S4 之间**（源健康度评估），执行位置在 **S5 评分**：

1. **S2/S3 落库时按源维护 `last_success_at`**（该源最近一次 `SUCCEEDED` 采集的成功时刻，可由 `collector_runs.finished_at` 推导；每个源只服务一条轴，见 PRD §1.6）。
2. **S4 特征构建前评估源健康度**，写入 `source_health` 枚举（`OK` / `STALE` / `FAILED`，定义见 00 §4.3）：
   - 本批成功 → `OK`；
   - 本批失败但 `now − last_success_at ≤ 72h` → `STALE`：特征**沿用最近一次成功快照的档位**，不重算、不置 `INSUFFICIENT`；
   - 本批失败且已超 72h → `FAILED`：该轴置 `INSUFFICIENT`。
3. **S5 评分只读该状态**：处于 `STALE` 的轴沿用上一档并打 `STALE_DATA`；**此时不得发布降档 Verdict、不得投递降级告警**（05 §5.1 / §5.3、12）；S7 告警阶段据此跳过。
4. 连续失败超 72 小时后，恢复正常降档与告警路径。

`source_health` 同时通过 Admin Source health 面板暴露（F14），并区分 Fast Lane 与 Slow Lane 的失败来源。

## 6. 确定性边界

```text
   非确定区（可含 LLM / 网络）        │        确定区（纯函数 + 版本化配置）
 采集 → 解析 → 分类/抽取 → 落库快照   │  features → 三轴 → Verdict → 生命周期 → 账本
                                       ▲
                        边界：不可变快照 + scoring_config_version
```

- 边界以内：同输入必同输出（bit-for-bit）；CI 中有 golden 测试（18）。
- 边界之外产生的一切（包括 LLM 分类结果）在落库后即视为**观测事实**，其 `run_id` 与 `prompt_version` 可追溯，但不会在重算时重新调用。

## 7. Discovery（发现管线）

```text
种子来源
  ├─ 主题词表（按 market 维护）
  ├─ 注意力实体（HN / GitHub / Reddit / PH 新实体）
  └─ 修饰词模板（for / vs / free / online / generator / converter / calculator / template …）
        ↓
Autocomplete 扩展（深度 ≤ 2，日预算内）
        ↓
Query 注册（去重键：normalized text + market + language）
        ↓
聚类（SERP Top10 URL 重叠 ≥ 3 → 同簇；无 SERP 时以词面相似度暂挂）
        ↓
候选筛选（CANDIDATE）
   规则：簇规模 ≥ 8；基线期后新增 query ≥ 3（14 天）；非品牌导航词
        ↓
升级为 TRACKED（分配 tier A/B），或长期无信号则 ARCHIVED
```

- **2026-10-18 实现裁决**：候选只从「修饰词模板」一路进入——每日任务 `seed-keywords`（`20 3 * * *`；2026-10-27 起暂停排期，仅手工/Admin 触发）把工具意图种子（generator / calculator / converter / template …，见 `seed-keyword-candidates.ts`）交给 DataForSEO Labs `keyword_suggestions`，取月搜索量 200–20,000、难度 ≤ 30 的 Google US 长尾词，主 query 记 **tier A**（有 SERP）。每天 ≤ 8 个新候选、活跃候选 ≤ 150。**词量与难度只决定是否进池，不进任何评分输入**（06 §7.1a 的 `external_demand_formed` 用同一份词量判结果，进 D 轴即自证）。注意力实体（HN / RSS）不再孵化候选，只作 Why Now 证据。Autocomplete 扩展得到的词挂为原机会的 `CLUSTER`（tier C），不再各自成为候选——此前的做法让候选主 query 落在 tier C（无 SERP，W 恒 `INSUFFICIENT`）、簇规模恒为 1（D 轴 MEDIUM 需 ≥ 5），结构上不可能发布。
- **冷启动基线**：任一种子被首次观测后的前 14 天视为基线期，其间的 `first_observed` 不计入"新增 query"指标。
- 聚类以 SERP 重叠为主，语言无关，为 Phase 2 引入 zh-CN 研究语言留出空间。
- 品牌导航词判定：Top1 为实体官方站且 Top10 中超过半数结果均以该实体为主题。

## 8. 应用服务层

所有入口（REST、Worker、Admin）调用同一组服务：

| 服务 | 关键方法 |
|------|----------|
| `OpportunityService` | `search` `get` `compare` `history` |
| `DecisionService` | `watch` `unwatch` `decide` `listWatchlist` |
| `ReportService` | `request` `get` `export` |
| `ProjectService` | `create` `connectGsc` `metrics` |
| `AlertService` | `evaluate` `dispatch` `digest` |
| `EntitlementService` | `check(user, feature, units)` `consume` — 所有入口共用（13） |

## 9. 读模型与缓存
- `opportunity_cards`（物化表）：S8 阶段**双缓冲刷新**，避免长事务锁表影响在线 Feed 查询（ADR-012）：
  1. S8 将当日全量卡片写入影子表 `opportunity_cards_next`（与线上表结构一致，无索引依赖冲突）；
  2. 写入完成并通过完整性检查（行数、必填字段非空）后，在一个短事务内执行 `ALTER TABLE opportunity_cards RENAME TO opportunity_cards_prev; ALTER TABLE opportunity_cards_next RENAME TO opportunity_cards`（原子切换，毫秒级，不持有长锁）；
  3. `opportunity_cards_prev` 保留至下次刷新前，供当次切换出问题时手动回滚。
  Feed 查询任何时刻只读到完整的一份数据，不会看到"正在刷新中"的部分行。
- Detail 由 `verdicts` 最新行 + 快照聚合，结果按 `(opportunity_id, obs_date, locale)` 缓存于 Postgres 表与 HTTP 缓存头。
- 首发不引入 Redis（ADR-003 修订、ADR-017）。限流使用 Postgres 计数：全局令牌桶复用 `rate_limit_buckets`（§5.2，实现在 `EntitlementService` / `apps/web/src/lib/rate-limit.ts` 内），7 天全局去重复用 `serp_snapshots`；若压测不达标再按 ADR-003 的推翻流程引入。
- 搜索：Postgres FTS + `pg_trgm`。

## 10. 存储与保留

| 数据 | 存储 | 保留 |
|------|------|------|
| 快照（标准化行）、Evidence、Verdict、账本 | Postgres | 永久 |
| 原始载荷（HTML / JSON） | 对象存储（gzip） | 12 个月；账本涉及的载荷永久 |
| `autocomplete_observations` / `serp_results` | Postgres 按月分区（由 `pg_partman` 自动预建未来 2 个月子分区） | 永久；冷分区可归档为只读 |
| LLM 运行记录 | Postgres | 18 个月 |
| 用户 GSC 令牌 | Postgres（信封加密） | 至用户撤销 / 删除 |

## 11. 容量假设（首发，参数化）
| 参数 | 初始值 | 说明 |
|------|--------|------|
| Tier A query | 500–2,000 | 每日 SERP Top 100（一鱼多吃，rank 1–10 服务弱点计算、11–100 内存匹配项目） |
| Tier B query | 5,000–10,000 | 每周 SERP |
| Tier C（仅 autocomplete） | 50,000 | 每日 |
| 商业目标域名 | 2,000–5,000 | 每周爬取 |

- SERP 结果行日增量约 3–4 万，年 ≈ 1,200 万行，Postgres 分区可承载。
- 实际规模由成本模型（04 §6）在 Gate 0 反推确定。

## 12. 环境与部署
- 环境：`dev` / `staging` / `prod`；staging 使用录制回放的供应商响应，不消耗真实配额。
- **连接池（ADR-012）**：生产环境采用分流连接策略：
  1. `apps/web` 与 `apps/worker` 的普通业务查询统一经由 `DATABASE_URL` 连接 PgBouncer（transaction pooling 模式），并为在线查询与批处理分别配置独立的连接池上限，避免批处理占满连接数导致在线请求排队；
  2. `apps/worker` 内部的 `pg-boss` 队列实例与会话级锁（如 S6 单写入者的 `pg_advisory_lock`）统一通过独立环境变量 `DATABASE_DIRECT_URL` 直连 PostgreSQL（或经 PgBouncer 的 session pooling 模式子池），彻底避免 Transaction Pooling 切断 `LISTEN / NOTIFY` 导致任务调度死锁。
- 数据库迁移前向兼容（expand → migrate → contract）。
- 特性开关：配置表 + 环境变量，首发不引入第三方开关服务。

## 13. 失败模式与降级

| 场景 | 行为 |
|------|------|
| SERP 供应商不可用 | 该批 SERP 标 `failed`；**72h 内** W 轴沿用最近成功快照并打 `STALE_DATA`（不降档、不告警）；**超 72h** 才转 `INSUFFICIENT` 并触发 Admin 告警；不阻塞其他阶段（ADR-021、§5.3） |
| LLM 不可用 | 分类队列积压；新结果类型为 `UNCLASSIFIED`，按规则兜底（不参与"弱结果"加分）；机会报告 / 点火包生成返回 `QUEUED` |
| 商业爬取失败 | **72h 内**沿用最近商业快照并打 `STALE_DATA`（M 轴不降档、不告警）；**超 72h** M 轴转 `INSUFFICIENT`；Evidence 新鲜度衰减；连续失败 ≥ 3 次的域名降级（ADR-021、§5.3） |
| 预算触顶 | 自动降级：B 层降为双周 → 暂停 Discovery 扩展 → 暂停新 Tier A 升级（04 §6） |
| 评分作业失败 | 当日不写账本、不发告警，告警值班；次日补跑，账本对缺失日期显式记录 `MISSING` |
