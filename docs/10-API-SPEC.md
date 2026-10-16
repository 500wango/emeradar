# 10 — REST API 规格

Status: Draft ｜ Owner: 后端 ｜ Last reviewed: 2026-10-14（对齐 PRD v2.1：原子 GO、槽位、质押、买断、半遮罩初筛）｜ 依赖：00-INDEX、03、05、09、12、13、15 ｜ 被依赖：16

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
  "detail": "Monthly atomic GO quota reached (5/5).",
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
| 404 | `NOT_FOUND` | 资源不存在或不可见（买断保护期内的机会对未买断者一律返回 404，**不返回 403**，避免暴露"这个词存在且被人买走了"） |
| 409 | `CONFLICT` | 状态冲突（如重复创建 Project、重复绑定的质押凭证） |
| 409 | `SLOT_TAKEN` | 该形态槽位已被占满，GO 失败。响应体必须附 `alternatives[]`：同一机会**仍有空余**的其他 `archetype`（可能是空数组） |
| 409 | `ACTIVE_SLOTS_EXCEEDED` | 用户质押尚未核验通过（`stake_status = 'PENDING'`）的 GO 已达 `active_go_slots_max`（默认 2）；已 `VERIFIED` 的 GO 不计入（PRD v2.2 Q15） |
| 422 | `PRECONDITION_FAILED` | 业务前置条件不满足（如未 GO 就请求点火包、质押窗口已过） |
| 422 | `STAKE_REQUIRED` | 该用户存在逾期未质押的项目，须先处理才能发起新的 GO |
| 422 | `STEALTH_LOCK_UNAVAILABLE` | 买断下单时 `Σclaimed > 0`（已有他人认领，处女地已被破坏） |
| 409 | `STEALTH_LOCK_PENDING` | 该用户已有一笔待付占位未结。响应体附该笔的 `checkout_url` 与 `expires_at`——这条闸是"同时至多一笔"，所以第二次请求必须**能续付**而不是撞死 |
| 422 | `CREDENTIAL_UNVERIFIED` | 提交的质押凭证探针校验失败（页面不可达 / 相关性不足） |
| 429 | `RATE_LIMITED` | 触发限流 |
| 503 | `DATA_STALE` | 当日管线未完成且明确不可服务（极少见；一般返回上一日数据并带 `data_as_of`） |
| 5xx | `INTERNAL` | 内部错误，附 `request_id` |

> `SLOT_TAKEN` 与 `QUOTA_EXCEEDED` 必须严格区分：前者是**别人占了**（换形态或换机会就有救），后者是**你自己用完了**（要么等跨月结转、要么升级）。前端据此给出完全不同的引导（16 §3.3）。

## 2. 认证与授权

| 方式 | 适用 | 说明 |
|------|------|------|
| 会话 Cookie | Web 控制台 | 由 Auth.js (NextAuth v5) 管理，基于数据库会话表（03 §2）；`HttpOnly; Secure; SameSite=Lax`；自带 CSRF 防护 |
| API Key | 脚本 / CLI | `Authorization: Bearer sk_live_…`；仅存哈希；带 scope；可随时吊销 |

**Scopes**：`opportunities:read` `opportunities:write`（watch / decision）`reports:generate` `projects:write` `launch_kits:read` `stealth:write`（买断下单）`alerts:write` `account:read`。
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
  "crowding": { "band": "LOW" },
  "slots": {
    "capacity_total": 6,
    "claimed_total": 4,
    "remaining_total": 2,
    "by_archetype": [
      { "archetype": "TOOL", "capacity": 2, "claimed": 2, "remaining": 0 },
      { "archetype": "MICRO_SAAS", "capacity": 2, "claimed": 1, "remaining": 1 },
      { "archetype": "PSEO_SITE", "capacity": 2, "claimed": 1, "remaining": 1 }
    ]
  },
  "stealth": { "locked": false, "unlocks_at": null },
  "user_state": { "watching": false, "decision": null, "has_active_project": false },
  "links": { "evidence": "/opportunities/opp_…/evidence" }
}
```
- 数值分数（`score`）默认不返回；`?include=scores` 且套餐允许时返回（13）。
- `verdict = EARLY_BET` 时客户端必须显示"商业未验证"（16）。
- **`slots` 是每个机会都必须返回的可信字段**（不按套餐裁剪）：它告诉用户"这个窗口还剩多少位置"。已经满额的机会（`remaining_total = 0`）会带 `flags` 中的 `CROWDED_LOCKED`，且**必然**是公开投影里可见的那一类（15 §3）——换言之用户看得到的公开机会，槽位一定已经满了，这不是巧合而是发布资格的定义。
- **Free 套餐不再有 `delayed` / `free_delay_days` 语义，该字段已删除**。免费层的实时体验是 `feed_selected_weekly`（每周 1 条刚满额锁定或刚关窗的准实时案例，15 §3）；`data_as_of` 仍然返回，用于表达"数据截止到哪一天"，与套餐无关。
- **买断保护期**（`stealth.locked = true`）：对未持有该买断的用户，`GET /opportunities/{id}` 返回 `404 NOT_FOUND`，且**不得**出现在任何 Feed、搜索、比较结果中（PRD §1.7 第 7 条）。持有者可见，并在响应中带 `stealth.unlocks_at`。

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
| GET | `/opportunities/{id}/search-formation` | `window=7|30|90`；新增 query、cluster、关联实体、query graph 数据 |
| GET | `/opportunities/{id}/serp` | 最近一份 SERP（`query_id`、`date` 可选）：结果、类型、弱度明细、竞争变化 |
| GET | `/opportunities/{id}/commercial` | M 轴、阶段、证据质量、证据表、时间线、证明 / 不证明、矛盾 |
| GET | `/opportunities/{id}/evidence` | 证据列表：`type` `class` `cursor` |
| GET | `/opportunities/{id}/history` | Verdict 时间线与生命周期转换（Pro） |
| POST | `/opportunities/compare` | 体：`{ "ids": ["opp_…", "opp_…"] }`（2–3） |
| GET | `/evidence/{id}` `/snapshots/{id}` | 证据抽屉数据（含来源、时间、载荷摘要） |
| GET | `/opportunities/{id}/slots` | 槽位明细：每个 `archetype` 的 `capacity` / `claimed` / `remaining`，以及当前用户是否已占、占的是哪一形态。**所有套餐可见**（透明本身就是产品卖点，13 §3.2） |
| GET | `/candidates` | **候选池（只读）**：尚未达到发布门槛、仍在 CANDIDATE 状态的早期机会。参数 `market_country` `research_language` `topic` `limit` `cursor`。返回**脱敏前**的评分与生命周期，但**不含**初筛结果、槽位余量与任何可执行信息。Free 套餐可读（`candidate_pool_readonly = true`），**不可**点 GO、不可初筛、不可导出（13 §3.2） |

### 4.3 决策、关注与原子 GO
| 方法 | 路径 | 说明 |
|------|------|------|
| PUT / DELETE | `/opportunities/{id}/watch` | 关注 / 取消（幂等） |
| GET | `/watchlist` | 我的关注及自上次查看的变化 |
| POST | `/opportunities/{id}/decisions` | 体：`{ decision: GO\|PASS, verdict_id, reason_code, note? }`；`verdict_id` **必填**，由客户端给出它当下渲染的那一条裁决。**这是"记录意见"，不是"认领"。** 要占用槽位并解锁点火包必须走下面的 `POST /go` |
| POST | `/opportunities/{id}/go` | **原子 GO（ADR-018）**。体：`{ archetype, verdict_id, report_id?, credential?: { type, url }, note? }`。单事务内完成：`reserve` 1 次 `atomic_go_export_monthly` → 锁定 `(opportunity_id, archetype)` 行并校验 `claimed < capacity` → `claimed += 1` → 建 `projects`（`status='IN_DEVELOPMENT'`、`stake_status='PENDING'`、`stake_deadline_at = now() + stake_window_days`，窗口按所选形态的执行规模 S 7 / M 14 / L 21 天，PRD v2.2 Q5）→ 解锁该形态点火包。响应 `201 { project_id, slot_claim_id, stake_deadline_at, launch_kit_url }`。失败：`409 SLOT_TAKEN`（附 `alternatives[]`）、`409 ACTIVE_SLOTS_EXCEEDED`、`403 QUOTA_EXCEEDED`、`403 PLAN_REQUIRED`（Free）、`422 STAKE_REQUIRED`（有逾期未处理的项目） |
| GET | `/opportunities/{id}/kill-criteria` / POST / PATCH / DELETE | 见 12 §5 |

**并发语义（必须实现，不可依赖前端）**：`POST /go` 对 `opportunity_slots` 的目标行先 `SELECT … FOR UPDATE`（或 `UPDATE … WHERE claimed < capacity` 条件递增）再判断，**四人同时抢同一形态的最后一个槽位时只有一个返回 201，其余返回 `409 SLOT_TAKEN`**。这条并发保证写在契约里而不是实现里，因为它是产品定价的前提（18 §4.1 有对应并发测试用例）。

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

初筛结果**永不**产生公开投影：一个由用户自定义词触发的查询可能命中处女地，若把它写进公开页就等于把别人刚发现的空地挂上牌子（15 §3、PRD §1.7 第 6 条）。

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
| POST | `/projects/{id}/stake` | **提交承诺质押凭证**（ADR-018、09 §8）。体：`{ credential_type: DOMAIN_URL\|STORE_LISTING_URL\|PUBLIC_PAGE_URL, url }`。同步触发 HTTP 探针校验 `<title>`/`<h1>`/`<meta>` 与机会主词的相关性；通过 → `stake_status = 'VERIFIED'`，返回 `200`；失败 → `422 CREDENTIAL_UNVERIFIED`（附探针实际取回的关键字段，便于用户自查），`stake_status` 保持 `PENDING`，槽位不释放，可重试至 `stake_deadline_at` |
| GET | `/projects/{id}/stake` | 当前质押状态、`stake_deadline_at`、剩余重试次数、历次校验结果 |
| GET | `/projects/{id}/serp-rankings` | **自身项目在该机会 Top 100 快照中的入榜历史**（`date` / `rank` / `matched_url` / `matched_via`）。数据来自每日 S2 快照的内存匹配（02 §5、04 §9.5），**不消耗 GSC**。这是替代 GSC 的主追踪路径。响应为 `{ series: [{ query_id, query_text, rows: [...] }], observed_days, first_ranked_on, days_to_first_rank, best_rank_ever }`：`rank: null` 是**正常取值**（当日未进入采集深度），这些行必须保留，否则"30 天内入榜率"的分母消失；`matched_via` 为命中该行的凭证类型（`credential_type`，00-INDEX §4.3），`STORE_LISTING_URL` 仅按主机名匹配，故其命中为线索而非证据 |
| POST | `/projects/{id}/gsc/connect` | **可选增强项**：返回 Google OAuth `authorization_url`。仅在用户自愿连接时调用；不连接不损失任何核心战绩 |
| GET | `/gsc/callback` | OAuth 回调（服务端处理并重定向） |
| DELETE | `/projects/{id}/gsc` | 断开并删除令牌 |
| GET | `/projects/{id}/metrics` | `from` `to` `group_by=week\|page\|query`。**响应必须标注数据来源** `source: "SERP_SNAPSHOT"`（默认）或 `"GSC"`（已连接时），两者不得混算成一条曲线 |
| POST | `/projects/{id}/revenue` | 自填营收（恒为 `SELF_REPORTED`，界面显式标注） |
| POST | `/projects/{id}/archive` | 归档项目。归档即释放占用的槽位（`slot_claims.state = 'RELEASED'`、`release_reason = 'USER_ARCHIVED'`），**已扣配额不退**（03 §17 I12） |

> **没有独立的 `POST /projects` 端点（这是刻意的）**：Project 只能由 `POST /opportunities/{id}/go` 在原子事务里创建。保留一个裸的建项目端点就等于保留了"先建项目、事后补 GO"的后门，而 GO 一旦可以被事后补，点火包就同样可以被事后补——那正是 ADR-018 要防的（13 §4.3）。一条决策至多一个项目（03 §17 I6）。

### 4.5b 处女地独占买断（Stealth Lock）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/opportunities/{id}/stealth-lock` | 查询该机会是否**可**下单：返回 `{ available, claimed_total, price, duration_days, locked, held_by_me }`。`available = (claimed_total == 0 && !locked)`——只要有任何一个人认领过，处女地就已被破坏，买断不再开放（PRD §1.7 第 5 条）；而已有一把生效的锁时同样为 `false`，否则**买断者本人**会看到一个"立即买断"的按钮（他还没 GO 时 `claimed_total` 正是 0）。若调用者已有一笔**待付**占位，额外返回 `pending: { lock_id, checkout_url, expires_at }` 供续付。**保护期内非持有者返回 `404`**，与 `GET /opportunities/{id}` 完全同形：否则这个端点就是一个任何人可查的存在性判据 |
| POST | `/opportunities/{id}/stealth-lock` | 下单买断。体：`{ billing_interval: ONE_TIME }`。**资格由数据决定，不由套餐决定**：事务内再次校验 `Σclaimed == 0`，否则 `422 STEALTH_LOCK_UNAVAILABLE`。**成功即写锁**（`status='ACTIVE'`、`unlock_at = now() + duration_days`、`provider_payment_id = NULL`）并返回托管结账链接；机会从此刻起就从所有 Feed / 搜索 / 比较 / 公开投影中消失。同一用户已有一笔待付占位时返回 `409 STEALTH_LOCK_PENDING` 并附该笔的续付链接——见下。响应 `201 { lock_id, checkout_url, amount_usd, expires_at }` |
| GET | `/me/stealth-locks` | 我持有的买断及剩余保护天数。每行 `{ lock_id, opportunity_id, opportunity_title, masked_label, locked_at, unlock_at, remaining_days, status }`。`VOID` 行不出现（那条锁从未成交，列出来只会让用户以为买成功了）；`EXPIRED` 保留（它是一段真实的历史）。**持有者看到的是真实标题**——打码是对外的，他买的正是这条机会；这也是保护期内他回到该机会的唯一入口（§7） |

**占位先于付款（`provider_payment_id IS NULL` 的 `ACTIVE` 行）**：托管结账页面意味着付款完成时锁还不存在，若等到付款才建锁，付完款与建锁之间别人可以点 GO 占槽，于是钱已收、无物可交。所以**先占位、后付款**，并把风险从"钱"搬到"时间"：

- 待付窗口 **15** 分钟（`STEALTH_RESERVATION_GRACE_MINUTES`，`packages/services/src/stealth-lock-policy.ts`；PRD v2.2 Q8 由 45 缩为 15，代码常量待改）内，占位与已成交的买断对外**没有区别**（机会同样隐藏）。
- 窗口一过而钱仍未到，占位自动失效（`status='VOID'`）：机会重新对全网开放。**失效不依赖清理作业是否跑过**——隐藏与否由 `status + unlock_at + provider_payment_id + locked_at` 现算（03 §17 I13），否则一次作业停摆就会变成一次无限期的全网遮蔽。
- 结账会话的 `expires_at`（`STEALTH_CHECKOUT_SESSION_MINUTES`）必须**短于**待付窗口（预留 webhook 投递延迟的余量），否则会出现"占位已作废而会话仍可付款"。这个大小关系是硬约束，不是两个各自可调的旋钮。PRD v2.2 Q8 原定窗口 15 分钟，但 Stripe Checkout 会话最短 30 分钟，窗口短于会话就会出现上述交错，所以落地为：会话 31 分钟（`STEALTH_CHECKOUT_SESSION_MINUTES`）、待付窗口 35 分钟（`STEALTH_RESERVATION_GRACE_MINUTES`），即"窗口不得低于会话时长 + 余量"。**未付款惩罚**：同一账号 30 天内累计 2 次未付款作废（含已超窗口但作业未扫到的占位）后，下单返回 `403 STEALTH_BUYOUT_SUSPENDED`；会话创建失败而被补偿删除的占位不计入。按规范化身份 / 设备归并计数待 T5.8 反滥用引擎落地后再做。
- 同一用户**同时至多一笔待付占位**。没有这条闸时，一个付费账号可以对 Feed 里每条处女地免费提交一次"下单"再关掉标签页，把整网反复遮黑。
- **多账号轮流的闸（PRD v2.2 Q8）**：同一规范化身份（`email_identities`）或同一设备指纹在 30 天内累计 **2 次**未付作废（`VOID`）后，取消其买断下单资格：`POST` 返回 `422 STEALTH_LOCK_UNAVAILABLE`，`GET` 返回 `available = false` 并附 `reason = 'PURCHASE_SUSPENDED'`。判定在下单事务内现算，不依赖作业。
- 窗口内已付款：webhook 回填 `provider_payment_id`，并**同步刷新该机会的公开投影**（不等 S8 批处理），否则从付款到下一次批处理之间有最长一整天的真实词根裸奔，按 15 §8 即 P0。

**买断者保留 GO 的权利**：`Σclaimed == 0` 约束的是**下单那一刻**。下单之后买断者自己可以在这条机会上 GO——PRD 第 72 行与第 364 行把它写成「由买断者**一人独享窗口期**」，若买断者连立项都不行，这个商品就什么也没交付。于是 `Σclaimed` 会从 0 变成 1，而 60 天打码继续到 `unlock_at`：被打码的是**账本投影**，不是买断者自己的项目。

**买断不影响的账本行为（必须写进契约，避免实现者"顺手"把它剔除）**：买断机会照常写 `verdicts` 与 `prediction_episodes`，照常计入 Cohort 统计；公开投影只做**打码**，不做剔除（06 §6.1、15 §3.1）。

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
| GET | `/billing/usage` | 当期各功能用量与上限。**必须逐 feature 返回 `{ feature, period, limit, used, remaining, carryover_available }`**，其中 `carryover_available` 表达 `usage_carryovers` 中尚未消费的结转额度（首发仅 `atomic_go_export_monthly` 会有非零值，13 §4.2）。用户必须能看懂"我这个月为什么有 6 次" |
| POST | `/webhooks/billing` | 入站：验证签名，按事件 ID 幂等处理。`STEALTH_BUYOUT` 的 `purchase_kind` 一次性商品也走此通道，**不走 quota**（13 §4.3） |

### 4.8 公开 API（无需登录，可缓存）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/public/track-record/summary` | 汇总统计：Cohort Hit Rate（按 Verdict 类型 / 观测月份分组）与 Accuracy Matrix（06 §11） |
| GET | `/public/track-record/episodes` | 分页 Episode 列表。**买断保护期内的记录照常出现**，但 `primary_query_text` / 实体 / URL 替换为 `[Stealth Locked #ID]`，并附 `is_stealth_masked = true`、`unmasked_at`（15 §3.1）；列表**不得**提供任何能按单条反推词根的聚合切片（最小分组量 `k ≥ 5`） |
| GET | `/public/checkpoints` | `from` / `to` 账本 checkpoint 摘要（后台存证用；前台仅在底栏提供校验入口，06 §1） |
| GET | `/public/opportunities/{slug}` | 通过**准实时精选**发布资格的机会（15 §3）：仅当槽位已满额或刚进入 `WINDOW_CLOSING`。响应含 `eligibility: { reason: "CROWDED_LOCKED" \| "WINDOW_CLOSING", decided_at }`，用于公开站自证"我们只公开已经没得抢的机会" |
| GET | `/public/opportunities?type=CASE_STUDY` | 已解密完结案例（`page_type='CASE_STUDY'`） |
| GET | `/public/markets/{slug}` | 主题聚合 |
| GET | `/public/methodology` | 数据源列表、观测起始日期、评分版本摘要 |

公开 API 只读取 public projection，**不得**访问受限内部行（PRD §11.2）。打码是**服务端投影层**的职责：公开 API 在任何情况下都不得返回未经打码的真实词根，包括错误信息、`ETag` 生成输入与日志。

### 4.9 管理（ADMIN / ANALYST，会话登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/sources/health` | 各源最近运行、失败率、延迟 |
| GET | `/admin/costs` | 按源 / 日 / 机会的成本 |
| GET | `/admin/review-queue` | 待审：实体归并、SERP 分类抽检、报告反馈、分析师标注（ANALOG） |
| POST | `/admin/opportunities/{id}/overrides` | 提议 / 批准 Override（05 §9） |
| GET / POST | `/admin/scoring-configs` | 列表 / 新建 DRAFT |
| POST | `/admin/scoring-configs/{version}/{shadow|activate}` | 进入 SHADOW / 激活（需批准） |
| POST | `/admin/recompute` | `{ opportunity_id, obs_date, config_version }` → 差异 |
| GET | `/admin/ledger/verify` | 触发 / 查看哈希链验证结果 |

所有管理写操作写 `audit_log`，需 `reason`。

## 5. 异步任务
- 报告生成为异步：`POST` 返回 `202`，客户端轮询 `GET /reports/{id}`（建议间隔 1–2 秒，服务端返回 `Retry-After`）。
- 状态机见 09 §2（`QUEUED` → `GENERATING` → `READY` / `FAILED`）。**报告生成不占配额**（配额只在 GO 时扣减），因此失败无需"退还额度"，重试即可。
- **初筛（Screener）也是异步**：`POST /screener/scans` → `202`。第二阶段需要按需采集，受全局令牌桶与 7 天去重约束（ADR-017 / 02 §5.2），因此可能排队数十秒；响应 `Retry-After` 反映预估等待。
- **原子 GO 是同步的**：它必须以单个事务完成，不得异步化。把 GO 拆成"先返回 202、后台建项目"会使"只有一个并发请求成功"这条保证失效。
- 首发不提供 WebSocket；如需实时更新，Phase 2 评估 SSE。

## 6. 配额、权益与半遮罩的 API 表现
- 每个受控端点在响应头附带 `X-Quota-Feature`、`X-Quota-Remaining`（如适用）；GO 的响应头额外附 `X-Slot-{archetype}-Remaining`。
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
- **买断相关端点不得泄露存在性**：`POST /opportunities/{id}/stealth-lock` 对非本人持有且处于保护期的机会返回 `404`，与"该机会不存在"完全同形；`422 STEALTH_LOCK_UNAVAILABLE` 只在**调用者本来就能看到该机会**（即它尚在 Feed 中）时使用。**同一条规矩适用于一切读取路径**——详情、研报、槽位明细、告警规则创建：保护期内对**非持有者**一律 404，对**持有者**一律 200（他买的就是独享）。Feed / 搜索 / 比较是例外：那三处对**所有人**（含持有者）排除，因为 PRD 要的是"从 Feed 中消失"，而持有者回到这条机会的入口是 `GET /me/stealth-locks`。把 404 与"隐藏"混成一个口径会两头都错：对持有者 404，等于 $199 换到一条看不见的记录；对非持有者只隐藏不 404，则告警规则的创建会变成一台存在性探测器。

  两处例外，都是刻意的，不许被当成漏网之鱼"修"掉：

  - **列表类端点排除该行，而不是打码标题**（`GET /alerts` 的规则与通知）。行里带着 `opportunity_id`，而本库的机会 id 直接嵌了 slug（`opp_adsense_rpm_simulator`），只换标题等于把词根留在同一行的另一个字段里；换 id 又会打断 UI 的跳转目标。排除在这里是无损的：保护期内对非持有者的投递本来就被 pipeline 抑制，那条规则是哑的，期满自然回来。
  - **用户自己已经建好的项目上的机会字段不打码**（`GET /projects`、`GET /projects/{id}`）。买断卖的是**向前**的两件事——不被发现、不被别人占用；而这条路径的读者早就掌握了该机会（他先认领了槽位、在他的项目上投入过），「取消知道」做不到。他能做的每个动作都已堵死（Feed / 搜索 / 比较 / 详情 / 研报 / 槽位 / 告警一律按上面的规矩，`SlotService.claim` 拒非持有者）。在这里抹掉标题换到的是零额外保护，代价是他的看板失去上下文、`stake` 的相关性探针拿不到词——把保证做成表演。判据本身也不便落在这一层：它是用户**自有资产**的读，不是对该机会的读。

## 8. 契约测试与版本
- CI：从 Zod 生成 OpenAPI；用 `oasdiff`（或同类工具）检测破坏性变更；破坏性变更须递增 `/api/v2`。
- 前端与客户端 SDK 使用生成的类型化客户端，禁止手写重复类型。
- 弃用策略：先标注 `Deprecation` / `Sunset` 头，至少保留 90 天。
- **必须存在的契约级测试**（18 §4.1）：
  1. **槽位并发**：N 个并发 `POST /go` 争抢同一形态最后一个槽位，成功数必须恰好为 1，其余全部 `409 SLOT_TAKEN` 且带 `alternatives[]`。
  2. **无 GO 无点火包**：未 GO 的 Project / 他人 Project 请求 `GET /projects/{id}/launch-kit` 必须为 `403` / `404`；Free 请求必须为 `403 PLAN_REQUIRED`。
  3. **点火包确定性**：同一 `(project_id, archetype, template_version)` 两次导出字节一致。
  4. **打码不泄漏**：买断保护期内，`/public/*` 的任一端点（含 `ETag` 输入与错误响应）都不得出现真实词根；用"真实词根子串"扫描全响应体作为断言（15 §8 的 0 容忍指标）。
  5. **配额不退**：质押逾期释放槽位后，`GET /billing/usage` 的 `used` 不减少；跨月后 `carryover_available` 只结转一期。
