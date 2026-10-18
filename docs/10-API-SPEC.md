# 10 — REST API 规格

Status: Draft ｜ Owner: 后端 ｜ Last reviewed: 2026-10-18（对齐 PRD v3.1：GO = 配额 + Project 壳 + 点火包；无槽位、无买断、凭证核验可选）｜ 依赖：00-INDEX、03、05、09、12、13、15 ｜ 被依赖：16

Web 前端与第三方脚本共用同一组应用服务（02 §8）。本文定义 REST 契约；OpenAPI 3.1 文件由 Zod schema 生成（`packages/core`），本文与生成物冲突时以生成物为准，并须回补本文。

## 1. 通用约定

| 主题 | 约定 |
|------|------|
| Base URL | `https://api.{domain}/api/v1` |
| 格式 | `application/json; charset=utf-8`；字段名 `snake_case` |
| 时间 | ISO 8601 UTC；`obs_date` 为 `YYYY-MM-DD` |
| 标识符 | 00 §4.1 的前缀 ULID |
| 分页 | 游标分页：`limit`（默认 20，最大 50）、`cursor`；响应含 `next_cursor`（无更多则 `null`） |
| 幂等 | 所有创建类 `POST` 支持 `Idempotency-Key`（24 小时内相同键返回同一结果） |
| 缓存 | 详情 `GET` 返回 `ETag`，支持 `If-None-Match`；`Cache-Control: private, max-age=60` |
| 限流头 | `RateLimit-Limit` `RateLimit-Remaining` `RateLimit-Reset`；超限 `429` + `Retry-After` |
| 追踪 | 每个响应返回 `X-Request-Id`；支持 W3C `traceparent` 入站 |
| 语言 | `ui_locale` 由 `Accept-Language` 或 `?locale=` 决定，仅影响**本地化文本字段**。**`market_country` 与 `research_language` 只能通过显式参数或用户偏好指定，永不由 locale 推导**（00 §4.4） |

### 1.1 错误格式（RFC 9457）
```json
{
  "type": "https://docs.{domain}/errors/quota-exceeded",
  "title": "Quota exceeded",
  "status": 403,
  "code": "QUOTA_EXCEEDED",
  "detail": "Monthly GO quota reached (3/3).",
  "request_id": "req_…",
  "upgrade": { "required_plan": "PRO", "url": "https://{domain}/pricing" }
}
```

| HTTP | `code` | 含义 |
|------|--------|------|
| 400 | `VALIDATION_ERROR` | 参数或体校验失败；`errors[]` 含字段路径 |
| 401 | `UNAUTHENTICATED` | 缺失 / 无效凭证 |
| 403 | `FORBIDDEN` | 权限不足（角色 / scope） |
| 403 | `PLAN_REQUIRED` | 当前套餐不含该功能（如 Free 请求 GO 或导出点火包） |
| 403 | `QUOTA_EXCEEDED` | 配额用尽 |
| 404 | `NOT_FOUND` | 资源不存在或不可见 |
| 409 | `CONFLICT` | 状态冲突（如重复创建 Project） |
| 409 | `ALREADY_GO` | 该裁决已经立项（`launch_kits.decision_id` 唯一）；响应体附既有 `project_id` |
| 422 | `PRECONDITION_FAILED` | 业务前置条件不满足（如未 GO 就请求点火包、裁决已失效） |
| 422 | `CREDENTIAL_UNVERIFIED` | 提交的凭证核验失败（token 不匹配 / 无法访问 / 商店授权失败）；可重试，不影响项目存在 |
| 429 | `RATE_LIMITED` | 触发限流 |
| 503 | `DATA_STALE` | 当日管线未完成且明确不可服务（极少见；一般返回上一日数据并带 `data_as_of`） |
| 5xx | `INTERNAL` | 内部错误，附 `request_id` |

> `ALREADY_GO` 与 `QUOTA_EXCEEDED` 必须严格区分：前者是**这条裁决已经立项**（去既有 Project），后者是**你自己的配额用完了**（等结转或升级）。前端据此给出完全不同的引导（16 §3.3）。

## 2. 认证与授权

| 方式 | 适用 | 说明 |
|------|------|------|
| 会话 Cookie | Web 控制台 | 由 Auth.js (NextAuth v5) 管理，基于数据库会话表（03 §2）；`HttpOnly; Secure; SameSite=Lax`；自带 CSRF 防护 |
| API Key | 脚本 / CLI | `Authorization: Bearer sk_live_…`；仅存哈希；带 scope；可随时吊销 |

**Scopes**：`opportunities:read` `opportunities:write`（watch / decision）`reports:generate` `projects:write` `launch_kits:read` `alerts:write` `account:read`。
- 角色（`USER / ANALYST / ADMIN / SUPPORT`）由 13 定义；`/admin/*` 仅接受会话登录，不接受 API Key。
- 授权与配额检查统一走 `EntitlementService.check()`（13）。
- **原子 GO 是唯一解锁点火包的入口**，因此 `POST /opportunities/{id}/go` 同时要求 `projects:write` + `reports:generate` + `launch_kits:read` 三个 scope；持有其中任一个都不足以单独调用它（13 §4.3）。

## 3. 核心对象：Opportunity

```json
{
  "id": "opp_01J…",
  "slug": "pdf-to-markdown-converter",
  "title": { "original": "PDF to Markdown converter", "localized": "PDF 转 Markdown 转换器" },
  "primary_query": { "id": "qry_…", "text": "pdf to markdown", "market_country": "US", "research_language": "en-US" },
  "first_observed_at": "2026-09-12T03:14:00Z",
  "data_as_of": "2026-10-01",
  "verdict": "EARLY_BET",
  "flags": ["W_DROPPING"],
  "lifecycle": "EARLY_WINDOW",
  "confidence": "MEDIUM",
  "axes": {
    "demand":     { "band": "HIGH" },
    "commercial": { "band": "LOW", "stage": "INFRA_PRESENT", "evidence_quality": "LOW" },
    "window":     { "band": "HIGH" }
  },
  "reason": { "kind": "FACT", "text": "过去 7 天新增 12 个相关查询；Top10 中 4 个为论坛帖。", "cites": ["evd_…", "snp_…"] },
  "recommendation": {
    "execution_class": "S",
    "build_types": [ { "type": "TOOL", "rank": 1 } ],
    "top_build_idea": "…"
  },
  "crowding": {
    "band": "LOW",
    "verified_product_count": 2,
    "top10_specialist_count": 4,
    "new_top10_entrants_30d": 1
  },
  "user_state": { "watching": false, "decision": null, "has_active_project": false },
  "links": { "evidence": "/opportunities/opp_…/evidence" }
}
```
- 数值分数（`score`）默认不返回；`?include=scores` 且套餐允许时返回（13）。
- `verdict = EARLY_BET` 时客户端必须显示"商业未验证"（16）。
- **`crowding` 是透明度字段，不是容量字段**：`verified_product_count` / `top10_specialist_count` / `new_top10_entrants_30d` 只用于展示竞争拥挤度、生命周期转换与 F9 告警，**不进入 `W_score`**，也不限制 GO。v3.1 没有虚拟槽位，响应中不得出现 `slots` / `remaining` / `capacity`。
- **Free 套餐不再有 `delayed` / `free_delay_days` 语义，该字段已删除**。免费层的实时体验是 `feed_selected_weekly`（每周 1 条已失去抢跑价值的案例，15 §3）；`data_as_of` 仍然返回，用于表达"数据截止到哪一天"，与套餐无关。
- **没有买断保护期**：v3.1 不返回 `stealth` 字段，也不存在"对未买断者 404"的可见性分支。可见性只由套餐与公开资格决定。

## 4. 端点

### 4.1 账户与偏好
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/me` | 当前用户、套餐、配额概览 |
| PATCH | `/me` | `display_name`、`ui_locale` |
| GET / PUT | `/me/preferences` | Onboarding 偏好（`build_types` `topics` `markets` `research_languages` `monetization_routes` `time_budget`） |
| GET / POST | `/me/api-keys` | 列出 / 创建（创建响应仅一次返回明文） |
| DELETE | `/me/api-keys/{id}` | 吊销 |
| DELETE | `/me` | 提交账户删除（进入 7 天冷静期） |
| GET / POST / DELETE | `/me/identities[/{provider}]` | 已绑定的社交身份（GitHub / Google）。**反滥用要求**：未绑定至少一个 OAuth 身份时，`live_scan_lifetime` 终身初筛不可用（邮箱注册本身不构成身份证明，13 §7.1）。解绑最后一个身份前必须存在其他凭证，否则 `422 PRECONDITION_FAILED` |

### 4.2 机会
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/opportunities` | Feed。参数：`tab`（`build_now` `early_bet` `watch_changes` `window_closing`）、`market_country`、`research_language`、`verdict`（多值）、`lifecycle`、`build_type`、`route`、`execution_class`、`min_confidence`、`q`、`first_observed_from/to`、`sort`（`verdict` `velocity` `first_observed` `serp_weakness`）、`limit` `cursor` |
| GET | `/opportunities/{id}` | 详情主体（含推荐层、Kill criteria 摘要、Crowding） |
| GET | `/opportunities/{id}/search-formation` | `window=7\|30\|90`；新增 query、cluster、关联实体、query graph 数据 |
| GET | `/opportunities/{id}/serp` | 最近一份 SERP（`query_id`、`date` 可选）：结果、类型、弱度明细、竞争变化 |
| GET | `/opportunities/{id}/commercial` | M 轴、阶段、证据质量、证据表、时间线、证明 / 不证明、矛盾 |
| GET | `/opportunities/{id}/evidence` | 证据列表：`type` `class` `cursor` |
| GET | `/opportunities/{id}/history` | Verdict 时间线与生命周期转换（Pro） |
| POST | `/opportunities/compare` | 体：`{ "ids": ["opp_…", "opp_…"] }`（2–3） |
| GET | `/evidence/{id}` `/snapshots/{id}` | 证据抽屉数据（含来源、时间、载荷摘要） |
| GET | `/opportunities/{id}/crowding` | 竞争透明度明细：`verified_product_count` / `top10_specialist_count` / `new_top10_entrants_30d` 及近 30 天趋势。**所有套餐可见**（01 §5.9） |
| GET | `/candidates` | **候选池（只读）**：尚未达到发布门槛、仍在 CANDIDATE 状态的早期机会。参数 `market_country` `research_language` `topic` `limit` `cursor`。返回**脱敏前**的评分与生命周期，但**不含**初筛结果与任何可执行信息。Free 套餐可读（`candidate_pool_readonly = true`），**不可**点 GO、不可初筛、不可导出（13 §3.2） |

### 4.3 决策、关注与原子 GO
| 方法 | 路径 | 说明 |
|------|------|------|
| PUT / DELETE | `/opportunities/{id}/watch` | 关注 / 取消（幂等） |
| GET | `/watchlist` | 我的关注及自上次查看的变化 |
| POST | `/opportunities/{id}/decisions` | 体：`{ decision: GO\|PASS, verdict_id, reason_code, note? }`；`verdict_id` **必填**，由客户端给出它当下渲染的那一条裁决。**这是"记录意见"，不是"立项"。** 要创建 Project 并解锁点火包必须走下面的 `POST /go` |
| POST | `/opportunities/{id}/go` | **GO（ADR-018）**。体：`{ archetype, verdict_id, report_id?, note? }`。单事务内完成：`reserve` 1 次 `atomic_go_export_monthly` → 建 `projects`（`status='IN_DEVELOPMENT'`、`credential_status='UNVERIFIED'`、`decision_id` 指回该裁决）→ 解锁该裁决点火包。响应 `201 { project_id, launch_kit_url }`。失败：`403 QUOTA_EXCEEDED`、`403 PLAN_REQUIRED`（Free）、`409 ALREADY_GO`（同一 `decision_id` 已立项）、`422 PRECONDITION_FAILED`（裁决已失效） |
| GET | `/opportunities/{id}/kill-criteria` / POST / PATCH / DELETE | 见 12 §5 |

**并发语义（必须实现，不可依赖前端）**：`POST /go` 的配额预占走 `UPDATE usage_counters … WHERE used + 1 <= limit` 原子条件更新；`launch_kits.decision_id` 的唯一约束保证同一裁决不会建出两个 Project。**GO 没有槽位容量上限**：四个用户各自对四条不同裁决 GO 应全部成功（各扣各的配额）；同一用户对同一 `decision_id` 重复 GO 返回 `409 ALREADY_GO`，配额不重复扣减（18 §4.1 有对应并发测试用例）。

`reason_code`（PASS）：`NOT_MY_TOPIC` `TOO_COMPETITIVE` `WEAK_MONETIZATION` `TOO_MUCH_WORK` `NO_TIME` `DATA_DOUBT` `OTHER`；（GO）：`CLEAR_WINDOW` `MONEY_VALIDATED` `FITS_MY_SKILLS` `QUICK_WIN` `OTHER`。

### 4.3b 两阶段自定义词初筛（Screener）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/screener/scans` | 体：`{ query, market_country, research_language, preferred_archetype? }` → `202 { scan_id }`。**第一阶段**为全量数据查询，命中已追踪机会则返回该机会的完整结果；未命中则进入**第二阶段**的按需采集（受全局令牌桶与 7 天去重约束，ADR-017 / 02 §5.2）。配额：Free `live_scan_lifetime`（**终身 1 次**）、Pro `live_scan_monthly`（每月 15 次）（13 §3.2） |
| GET | `/screener/scans/{id}` | 查询状态与结果。**结果按套餐半遮罩**（见 §6）：Free 保留"N 个弱结果 / M 个收钱独立站 / 静态切入难度"等判断性结论，具体弱结果 URL、竞品域名与 15 个长尾词以 `restricted: true` + `null` 返回 |
| POST | `/screener/scans/{id}/promote` | 将初筛结果转为 Watchlist 条目或（Pro）直接进入该机会的详情页。**不创建 Project**——立项必须走 `POST /go` |
| GET | `/screener/demos` | **3 个官方 Demo 词**（PRD F3、§4.1、§7.2）。匿名可读。返回 `[{ demo_id, query, market_country, research_language, snapshot_date }]`，由 Admin 维护、固定为 3 条（R15） |
| GET | `/screener/demos/{demo_id}` | Demo 词的完整初筛结果，结构与 `GET /screener/scans/{id}` 相同但**不打码**（Demo 词是公开样本，不含付费底牌价值）。**只读预先冻结的缓存快照**：零配额、零外部请求、不经令牌桶；快照缺失时返回 `503 DEMO_UNAVAILABLE`，**不得**回退为实时采集（否则匿名接口就成了免费初筛） |

**初筛性能目标（PRD §9.3，R15）**：7 天去重命中（复用 `serp_snapshots`，ADR-017）时，`POST /screener/scans` 直接返回 `200` 与完整结果，服务端 p95 **< 200ms**；未命中走实时采集，从受理到 `status = DONE` p95 **< 8s**。Demo 词接口同属缓存命中档（< 200ms）。

**进度反馈**：沿用本规格的异步风格（`202` + 轮询，§5），不引入 SSE。`GET /screener/scans/{id}` 返回 `status`（`QUEUED` `FETCHING_SERP` `PROBING_COMMERCIAL` `CLASSIFYING` `DONE` `FAILED`）与 `phase_started_at`，前端据此渲染阶段进度（16 §3.2c）；响应带 `Retry-After`（建议 1 秒）。排队超出全局令牌桶时 `status = QUEUED` 并给出预估等待，不计入 8s 目标但必须如实显示。

初筛结果**永不**产生公开投影：一个由用户自定义词触发的查询可能命中处女地，若把它写进公开页就等于把别人刚发现的空地挂上牌子（15 §3、PRD §1.8 第 6 条）。

### 4.4 机会研究报告与点火包 (Report & Launch Kit)
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/opportunities/{id}/report` | 体：`{ locale?: "zh-CN"\|"en-US" }` → `202 { report_id, status: "QUEUED" }`（若当日快照已有 READY 报告，则直接返回 `200` 缓存结果，零额外扣额）。**Pro 报告生成本身不扣额**（只做 `check`），扣额发生在 GO；Free 走 `report_preview_monthly` 预览额度（13 §4.3） |
| GET | `/opportunities/{id}/report` | 查询该机会最新报告状态与数据（Free 仅预览；Pro 完整报告） |
| GET | `/reports/{id}` | 按 ID 获取报告详情 |
| GET | `/reports/{id}/export?format=md\|json\|pdf` | 导出报告（Pro；Markdown、JSON、PDF）。**Free 一律 `403 PLAN_REQUIRED`**——Free 的 `report_preview_monthly` 只能在线预览，没有导出路径 |
| GET | `/projects/{id}/launch-kit?format=bundle\|md\|json` | 导出**形态点火包**（09 §5.3）。默认 `bundle` 返回三件套（`CLAUDE.md`/`.cursorrules`、`routes.yaml`+`keywords.csv`、`landing-skeleton.html`+`sections.yaml`）的 zip。**只有通过 `POST /go` 建立的 Project 才有此端点的资源**；不存在"先拿点火包再决定要不要 GO"的路径。未 GO / 非本人 / Project 已释放 → `404` / `403`。同一 `(project_id, archetype, template_version)` 重复导出**不重复扣额** |
| POST | `/reports/{id}/feedback` | `{ section, rating, factual_error?: bool, note? }` |

`GET /projects/{id}/launch-kit` 的响应头必须带 `X-Launch-Kit-Snapshot`、`X-Launch-Kit-Template-Version`、`X-Scoring-Config-Version`，使用户可以自行核对同一份输入是否产出同一份交付物（09 §5.3 硬约束 1）。

### 4.5 Project 与 Outcome
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects`、`GET / PATCH /projects/{id}` | 列表 / 更新（状态 `IN_DEVELOPMENT` \| `LAUNCHED` \| `ARCHIVED`、域名、上线日期、页面） |
| POST | `/projects/{id}/credentials` | **提交归属凭证（可选）**（09 §8）。体：`{ credential_type: DOMAIN_URL\|PUBLIC_PAGE_URL\|STORE_LISTING_URL\|GITHUB_REPO_URL\|GITHUB_RELEASE_URL, url, proof? }`。按类型核验：页面 `<meta>` token、域名 DNS TXT、商店开发者 OAuth、GitHub `.emeradar-verify` / Release asset。通过 → `credential_status = 'VERIFIED_OWNER'`，返回 `200`；失败 → `422 CREDENTIAL_UNVERIFIED`，状态保持 `UNVERIFIED` / `REJECTED`，**无截止日、不释放资源、不退还配额**，可随时重试 |
| GET | `/projects/{id}/credentials` | 当前凭证状态、`credential_type`、`verification_method`、`verified_at`、历次核验结果。**没有 `stake_deadline_at` / 剩余重试次数** |
| GET | `/projects/{id}/serp-rankings` | **自身项目在该机会 Top 100 快照中的入榜历史**（`date` / `rank` / `matched_url` / `matched_via`）。数据来自每日 S2 快照的内存匹配（02 §5、04 §9.5），**不消耗 GSC**。这是替代 GSC 的主追踪路径。响应为 `{ series: [{ query_id, query_text, rows: [...] }], observed_days, first_ranked_on, days_to_first_rank, best_rank_ever }`：`rank: null` 是**正常取值**（当日未进入采集深度），这些行必须保留，否则"30 天内入榜率"的分母消失；`matched_via` 为命中该行的凭证类型（`credential_type`，00-INDEX §4.3），`STORE_LISTING_URL` 仅按主机名匹配，故其命中为线索而非证据 |
| POST | `/projects/{id}/gsc/connect` | **可选增强项**：返回 Google OAuth `authorization_url`。仅在用户自愿连接时调用；不连接不损失任何核心战绩 |
| GET | `/gsc/callback` | OAuth 回调（服务端处理并重定向） |
| DELETE | `/projects/{id}/gsc` | 断开并删除令牌 |
| GET | `/projects/{id}/metrics` | `from` `to` `group_by=week\|page\|query`。**响应必须标注数据来源** `source: "SERP_SNAPSHOT"`（默认）或 `"GSC"`（已连接时），两者不得混算成一条曲线 |
| POST | `/projects/{id}/revenue` | 自填营收（恒为 `SELF_REPORTED`，界面显式标注） |
| POST | `/projects/{id}/archive` | 归档项目。只改变项目状态（`ARCHIVED`），**不释放任何槽位**（v3.1 没有槽位），**已扣配额不退**（03 §17） |

> **没有独立的 `POST /projects` 端点（这是刻意的）**：Project 只能由 `POST /opportunities/{id}/go` 在原子事务里创建。保留一个裸的建项目端点就等于保留了"先建项目、事后补 GO"的后门，而 GO 一旦可以被事后补，点火包就同样可以被事后补——那正是 ADR-018 要防的（13 §4.3）。一条决策至多一个项目（03 §17 I6）。

### 4.5b 独占买断（v3.1 已移除）

PRD v3.1 删除了 `stealth_locks`、`stealth_lock_displays`、`STEALTH_BUYOUT` 与所有买断端点。不存在 `/opportunities/{id}/stealth-lock` 或 `/me/stealth-locks`；机会可见性不再因付费动作而改变。历史买断数据只作离线归档，不参与 API 契约。

### 4.6 告警与通知
| 方法 | 路径 | 说明 |
|------|------|------|
| GET / POST / PATCH / DELETE | `/alert-rules[/{id}]` | 见 12 §3 |
| GET / POST / DELETE | `/notification-channels[/{id}]` | 邮件 / Webhook |
| POST | `/notification-channels/{id}/verify` | 发送验证消息 |
| GET | `/notifications` | 站内通知收件箱 |

### 4.7 计费
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/billing/subscription` | 当前订阅（含 `plan_code`、`billing_interval`、`purchase_kind`） |
| POST | `/billing/checkout-sessions` | 体：`{ plan_code, billing_interval, purchase_kind? }` → 供应商托管结账链接。`plan_code ∈ {FREE, PRO}`（`TEAM` 为历史兼容值，不出现在结账页，13 §3.1）；**季度 Builder Pass = `{ plan_code: "PRO", billing_interval: "QUARTER" }`**，不是独立的 `plan_code`；`purchase_kind = FOUNDING_LIFETIME` 用于预售终身档 |
| POST | `/billing/portal-sessions` | 管理订阅链接 |
| GET | `/billing/usage` | 当期各功能用量与上限。**必须逐 feature 返回 `{ feature, period, limit, used, remaining, carryover_available }`**，其中 `carryover_available` 表达 `usage_carryovers` 中尚未消费的结转额度（首发仅 `atomic_go_export_monthly` 会有非零值，上限 6，13 §4.2）。用户必须能看懂"我这个月为什么有 6 次" |
| POST | `/webhooks/billing` | 入站：验证签名，按事件 ID 幂等处理。只处理订阅与 Founding Lifetime，**没有 `STEALTH_BUYOUT` 或任何一次性买断商品**（13 §3.1） |

### 4.8 公开 API（无需登录，可缓存）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/public/track-record/summary` | 汇总统计：Cohort Hit Rate（按 Verdict 类型 / 观测月份分组）与 Accuracy Matrix（06 §11） |
| GET | `/public/track-record/episodes` | 分页 Episode 列表。全部已到期 Episode 按同一口径出现，**没有买断打码**；逐行明细只在机会已失去抢跑价值或完成 T+90 评估后出现（06 §11）。列表不得提供任何能按单条反推词根的聚合切片（最小分组量 `k ≥ 5`） |
| GET | `/public/checkpoints` | `from` / `to` 账本 checkpoint 摘要（后台存证用；前台仅在底栏提供校验入口，06 §1） |
| GET | `/public/opportunities/{slug}` | 通过 §15 §3 公开资格的机会（已失去抢跑价值）。响应含 `eligibility: { reason: "WINDOW_CLOSING" \| "PASS" \| "LIFECYCLE_CLOSED" \| "INACTIVE_14D", decided_at }`，用于公开站自证"我们只公开已经没有抢跑价值的机会"；活跃 `BUILD_NOW` / `EARLY_BET` 一律不返回 |
| GET | `/public/opportunities?type=CASE_STUDY` | 已失去抢跑价值的完结案例（`page_type='CASE_STUDY'`） |
| GET | `/public/markets/{slug}` | 主题聚合 |
| GET | `/public/methodology` | 数据源列表、观测起始日期、评分版本摘要 |

公开 API 只读取 public projection，**不得**访问受限内部行（PRD §11.2）。公开 API 在任何情况下都不得返回尚未公开的实时 verdict / 三轴档位 / 竞争指标，包括错误信息、`ETag` 生成输入与日志；一旦机会重新进入 `BUILD_NOW` / `EARLY_BET`，对应页面按 15 §3.1 撤回。

### 4.9 管理（ADMIN / ANALYST，会话登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/sources/health` | 各源最近运行、失败率、延迟 |
| GET | `/admin/costs` | 按源 / 日 / 机会的成本 |
| GET | `/admin/review-queue` | 待审：实体归并、SERP 分类抽检、报告反馈、分析师标注（ANALOG） |
| POST | `/admin/opportunities/{id}/overrides` | 提议 / 批准 Override（05 §9） |
| GET / POST | `/admin/scoring-configs` | 列表 / 新建 DRAFT |
| POST | `/admin/scoring-configs/{version}/{shadow\|activate}` | 进入 SHADOW / 激活（需批准） |
| POST | `/admin/recompute` | `{ opportunity_id, obs_date, config_version }` → 差异 |
| GET | `/admin/ledger/verify` | 触发 / 查看哈希链验证结果 |

所有管理写操作写 `audit_log`，需 `reason`。

## 5. 异步任务
- 报告生成为异步：`POST` 返回 `202`，客户端轮询 `GET /reports/{id}`（建议间隔 1–2 秒，服务端返回 `Retry-After`）。
- 状态机见 09 §2（`QUEUED` → `GENERATING` → `READY` / `FAILED`）。**报告生成不占配额**（配额只在 GO 时扣减），因此失败无需"退还额度"，重试即可。
- **初筛（Screener）也是异步**：`POST /screener/scans` → `202`。第二阶段需要按需采集，受全局令牌桶与 7 天去重约束（ADR-017 / 02 §5.2），因此可能排队数十秒；响应 `Retry-After` 反映预估等待。
- **GO 是同步的**：它必须以单个事务完成，不得异步化。把 GO 拆成"先返回 202、后台建项目"会使配额预占与项目创建脱节，留下扣了额却没有项目的窗口。
- 首发不提供 WebSocket；如需实时更新，Phase 2 评估 SSE。

## 6. 配额、权益与半遮罩的 API 表现
- 每个受控端点在响应头附带 `X-Quota-Feature`、`X-Quota-Remaining`（如适用）；GO 的响应头额外附 `X-Quota-Used` / `X-Quota-Limit`，**没有槽位余量头**。
- 被限制的字段以 `null` + `restricted: true` 返回，而不是静默省略，便于前端展示升级入口。
- **半遮罩（D14）由服务端决定字段可见性，不靠前端 CSS**（否则一切都能被绕过）：
  - `GET /screener/scans/{id}`（Free）：保留 `weak_result_count`、`paid_indie_domain_count`、`static_entry_difficulty` 等**判断性结论**；对 `weak_results[].url`、`competitor_domains[]`、`long_tail_keywords[].text` 返回 `null` 并标 `restricted: true`。
  - `GET /opportunities` Feed（Free）：`feed_selected_weekly` 只返回 1 条，其余条目直接不出现在列表里（不是打码，是不返回）。
  - **半遮罩不得使用"打星号"这类可数还原的方式**：`acme-tools.com` 打码成 `a***-t***.com` 是可以被猜回来的。要么返回完整值，要么返回 `null` + `restricted`。

## 7. 安全要求
- CORS 仅允许应用与公开站源；公开 API 允许任意源但仅 `GET`。
- 输入统一经 Zod 校验；输出统一经序列化白名单（禁止直接返回 ORM 对象）。
- `Idempotency-Key`、`api-key` 等敏感头不写入日志。
- Webhook 入站校验签名 + 时间戳容差（默认 5 分钟）。
- **反滥用（13 §7.1 / 17 §2.5）**：邮箱在入库前做 Canonical 归一化（剥离 Gmail `+` 别名与 `.`）；一次性邮箱域在注册时即拒绝（`403 FORBIDDEN`，`code = DISPOSABLE_EMAIL`）；设备指纹与 IP **仅存加盐哈希**，明文绝不落库、绝不出现在任何 API 响应或日志中（17 §3.5）。同设备 / 同 IP 30 天内只允许 1 次终身初筛额度发放。
- **没有买断相关的存在性/404 分支**：v3.1 删除了 `stealth_locks` 与全部买断端点，机会的可见性只由套餐与公开资格决定，不再因任何付费动作而改变。

## 8. 契约测试与版本
- CI：从 Zod 生成 OpenAPI；用 `oasdiff`（或同类工具）检测破坏性变更；破坏性变更须递增 `/api/v2`。
- 前端与客户端 SDK 使用生成的类型化客户端，禁止手写重复类型。
- 弃用策略：先标注 `Deprecation` / `Sunset` 头，至少保留 90 天。
- **必须存在的契约级测试**（18 §4.1）：
  1. **GO 无槽位并发**：四个各余 1 次配额的用户分别对四条不同裁决 GO，四个请求全部 `201`，各自生成一个 Project 并解锁点火包；同一用户对同一 `decision_id` 重复 GO 返回 `409 ALREADY_GO`，配额不重复扣减。不存在"同一形态最后一个槽位"这种失败。
  2. **无 GO 无点火包**：未 GO 的 Project / 他人 Project 请求 `GET /projects/{id}/launch-kit` 必须为 `403` / `404`；Free 请求必须为 `403 PLAN_REQUIRED`。
  3. **点火包确定性**：同一 `(project_id, archetype, template_version)` 两次导出字节一致。
  4. **活跃窗口不泄漏**：`/public/*` 的任一端点（含 `ETag` 输入与错误响应）都不得出现仍处于 `BUILD_NOW` / `EARLY_BET` 的机会；用账本最新裁决扫描全响应体作为断言（15 §8 的 0 容忍指标）。
  5. **配额与核验解耦**：凭证未提交或核验失败后，`GET /billing/usage` 的 `used` 不减少；跨月后 `carryover_available` 只结转一期且上限 6。
