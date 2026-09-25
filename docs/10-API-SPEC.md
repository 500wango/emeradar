# 10 — REST API 规格

Status: Approved ｜ 依赖：03、05、09、12、13 ｜ 被依赖：16

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
  "detail": "Monthly deep report quota reached (30/30).",
  "request_id": "req_…",
  "upgrade": { "required_plan": "PRO", "url": "https://{domain}/pricing" }
}
```

| HTTP | `code` | 含义 |
|------|--------|------|
| 400 | `VALIDATION_ERROR` | 参数或体校验失败；`errors[]` 含字段路径 |
| 401 | `UNAUTHENTICATED` | 缺失 / 无效凭证 |
| 403 | `FORBIDDEN` | 权限不足（角色 / scope） |
| 403 | `PLAN_REQUIRED` | 当前套餐不含该功能 |
| 403 | `QUOTA_EXCEEDED` | 配额用尽 |
| 404 | `NOT_FOUND` | 资源不存在或不可见 |
| 409 | `CONFLICT` | 状态冲突（如重复创建 Project） |
| 422 | `PRECONDITION_FAILED` | 业务前置条件不满足（如未 GO 就创建 Project） |
| 429 | `RATE_LIMITED` | 触发限流 |
| 503 | `DATA_STALE` | 当日管线未完成且明确不可服务（极少见；一般返回上一日数据并带 `data_as_of`） |
| 5xx | `INTERNAL` | 内部错误，附 `request_id` |

## 2. 认证与授权

| 方式 | 适用 | 说明 |
|------|------|------|
| 会话 Cookie | Web 控制台 | 由 Auth.js (NextAuth v5) 管理，基于数据库会话表（03 §2）；`HttpOnly; Secure; SameSite=Lax`；自带 CSRF 防护 |
| API Key | 脚本 / CLI | `Authorization: Bearer sk_live_…`；仅存哈希；带 scope；可随时吊销 |

**Scopes**：`opportunities:read` `opportunities:write`（watch / decision）`reports:generate` `projects:write` `alerts:write` `account:read`。
- 角色（`USER / ANALYST / ADMIN / SUPPORT`）由 13 定义；`/admin/*` 仅接受会话登录，不接受 API Key。
- 授权与配额检查统一走 `EntitlementService.check()`（13）。

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
  "user_state": { "watching": false, "decision": null },
  "links": { "evidence": "/opportunities/opp_…/evidence" }
}
```
- 数值分数（`score`）默认不返回；`?include=scores` 且套餐允许时返回（13）。
- `verdict = EARLY_BET` 时客户端必须显示"商业未验证"（16）。
- Free 套餐的 Feed 与详情按 `free_delay_days` 返回延迟数据，并带 `delayed: true`、`data_as_of`。

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

### 4.3 决策与关注
| 方法 | 路径 | 说明 |
|------|------|------|
| PUT / DELETE | `/opportunities/{id}/watch` | 关注 / 取消（幂等） |
| GET | `/watchlist` | 我的关注及自上次查看的变化 |
| POST | `/opportunities/{id}/decisions` | 体：`{ decision: GO|PASS, reason_code, note? }`；记录当时的 `verdict_id` |
| GET / POST / PATCH / DELETE | `/opportunities/{id}/kill-criteria[/{kc}]` | 见 12 §5 |

`reason_code`（PASS）：`NOT_MY_TOPIC` `TOO_COMPETITIVE` `WEAK_MONETIZATION` `TOO_MUCH_WORK` `NO_TIME` `DATA_DOUBT` `OTHER`；（GO）：`CLEAR_WINDOW` `MONEY_VALIDATED` `FITS_MY_SKILLS` `QUICK_WIN` `OTHER`。

### 4.4 机会研究报告 (Opportunity Reports)
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/opportunities/{id}/report` | 体：`{ locale?: "zh-CN"\|"en-US" }` → `202 { report_id, status: "QUEUED" }`（若当日快照已有 READY 报告，则直接返回 `200` 缓存结果，零额外扣额）；受配额 Hold 锁定控制（13 §4） |
| GET | `/opportunities/{id}/report` | 查询该机会最新报告状态与数据（Free 预览前 3 条证据；Pro 完整报告） |
| GET | `/reports/{id}` | 按 ID 获取报告详情 |
| GET | `/reports/{id}/export?format=md|json|pdf` | 导出（Pro；支持 Markdown、JSON、PDF） |
| POST | `/reports/{id}/feedback` | `{ section, rating, factual_error?: bool, note? }` |

### 4.5 Project 与 Outcome
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/projects` | 体：`{ decision_id, report_id?, build_type, domain?, target_keywords[], launch_date? }`；`decision_id` 必须是本人的 GO，自动绑定报告实现下游闭环 |
| GET / PATCH | `/projects`、`/projects/{id}` | 列表 / 更新（状态、域名、上线日期、页面） |
| POST | `/projects/{id}/gsc/connect` | 返回 Google OAuth `authorization_url` |
| GET | `/gsc/callback` | OAuth 回调（服务端处理并重定向） |
| DELETE | `/projects/{id}/gsc` | 断开并删除令牌 |
| GET | `/projects/{id}/metrics` | `from` `to` `group_by=week|page|query` |
| POST | `/projects/{id}/revenue` | 自填营收（恒为 `SELF_REPORTED`，界面显式标注） |

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
| GET | `/billing/subscription` | 当前订阅 |
| POST | `/billing/checkout-sessions` | `{ plan }` → 供应商托管结账链接 |
| POST | `/billing/portal-sessions` | 管理订阅链接 |
| GET | `/billing/usage` | 当期各功能用量与上限 |
| POST | `/webhooks/billing` | 入站：验证签名，按事件 ID 幂等处理 |

### 4.8 公开 API（无需登录，可缓存）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/public/track-record/summary` | 汇总统计（06 §11） |
| GET | `/public/track-record/episodes` | 分页 Episode 列表 |
| GET | `/public/checkpoints` | `from` / `to` 账本 checkpoint 摘要 |
| GET | `/public/opportunities/{slug}` | 通过发布资格的机会（15） |
| GET | `/public/markets/{slug}` | 主题聚合 |
| GET | `/public/methodology` | 数据源列表、观测起始日期、评分版本摘要 |

公开 API 只读取 public projection，**不得**访问受限内部行（PRD §11.2）。

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
- 状态机见 09 §2（`QUEUED` → `GENERATING` → `READY` / `FAILED`）。生成成功后额度 Commit，失败则自动释放配额（Release）。
- 首发不提供 WebSocket；如需实时更新，Phase 2 评估 SSE。

## 6. 配额与权益的 API 表现
- 每个受控端点在响应头附带 `X-Quota-Feature`、`X-Quota-Remaining`（如适用）。
- 被限制的字段以 `null` + `restricted: true` 返回，而不是静默省略，便于前端展示升级入口。

## 7. 安全要求
- CORS 仅允许应用与公开站源；公开 API 允许任意源但仅 `GET`。
- 输入统一经 Zod 校验；输出统一经序列化白名单（禁止直接返回 ORM 对象）。
- `Idempotency-Key`、`api-key` 等敏感头不写入日志。
- Webhook 入站校验签名 + 时间戳容差（默认 5 分钟）。

## 8. 契约测试与版本
- CI：从 Zod 生成 OpenAPI；用 `oasdiff`（或同类工具）检测破坏性变更；破坏性变更须递增 `/api/v2`。
- 前端与客户端 SDK 使用生成的类型化客户端，禁止手写重复类型。
- 弃用策略：先标注 `Deprecation` / `Sunset` 头，至少保留 90 天。
