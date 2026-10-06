# 13 — 计费、权益与权限规格

Status: Approved ｜ 依赖：01 §8、03、10 ｜ 被依赖：09、12、16、17

## 1. 目的
定义套餐、配额、角色权限如何统一实现为一个单一决策点：`EntitlementService`。避免不同入口限流与权限规则不一致。

## 2. 角色（RBAC）

| 角色 | 说明 | 典型权限边界 |
|------|------|--------------|
| `USER` | 普通用户 | 自己的数据；公开数据；按套餐配额使用功能 |
| `ANALYST` | 内部数据分析 / 审核人员 | `/admin/review-queue`、提议 Override、标注 ANALOG 商业目标；**不能**批准自己提议的 Override |
| `ADMIN` | 内部管理员 | 全部 `/admin/*`；批准 Override；管理 `scoring_configs` 生命周期；管理套餐与配额配置 |
| `SUPPORT` | 客服 | 只读用户账户与订阅状态；可代发验证邮件、触发密码重置；**不能**查看用户的机会数据以外的账单明细之外的支付详情（信用卡号等本就不经过我方系统，见 §7） |

- 角色存于 `users.role`；一个账户一个角色（不做多角色叠加，简化首发）。
- `USER` 角色的实际权限进一步由**套餐权益**（§3）与**资源归属**（是否是本人数据）共同决定，RBAC 只区分"内部角色 vs 普通用户"，业务级差异化由权益层处理。

## 3. 套餐与权益模型

### 3.1 套餐

| 套餐 | 定位 |
|------|------|
| `FREE` | 体验 + 公开延迟数据消费者；转化入口 |
| `PRO` | 核心付费套餐：实时 Feed、完整 Detail、深度机会研究报告导出、Watchlist/Alerts、Project 追踪 |
| `TEAM` | Phase 3；本文档预留结构，不在首发实现 |

### 3.2 `entitlements` 结构（`plans.entitlements` jsonb）
```json
{
  "plan_code": "PRO",
  "features": {
    "feed_realtime": { "type": "boolean", "value": true },
    "feed_delay_days": { "type": "number", "value": 0 },
    "opportunity_detail_full": { "type": "boolean", "value": true },
    "scores_visible": { "type": "boolean", "value": false },
    "compare_max_items": { "type": "number", "value": 3 },
    "deep_report_generate": { "type": "quota", "period": "MONTH", "limit": 30 },
    "deep_report_export": { "type": "boolean", "value": true },
    "watchlist_max_items": { "type": "number", "value": 200 },
    "alert_rules_max": { "type": "number", "value": 20 },
    "kill_criteria_max_per_opportunity": { "type": "number", "value": 5 },
    "alert_channels": { "type": "set", "value": ["EMAIL", "WEBHOOK"] },
    "projects_max": { "type": "number", "value": 50 },
    "gsc_connections_max": { "type": "number", "value": 50 },
    "api_access": { "type": "boolean", "value": false },
    "history_window_days": { "type": "number", "value": 365 },
    "compare_history": { "type": "boolean", "value": true }
  }
}
```
- 三种字段类型：
  - `boolean`：开关型（可用 / 不可用）
  - `number` / `set`：静态上限（数量、渠道集合）
  - `quota`：周期性配额（按 `period` 重置，消耗记录于 `usage_events` / `usage_counters`）
- `FREE` 与 `PRO` 的默认值（初始假设，定价与具体额度以 Phase 0 预售访谈结果为准，见 01 §12 决策 4）：

| 字段 | `FREE`（初始假设） | `PRO`（初始假设） |
|------|---------------------|---------------------|
| `feed_realtime` | `false`（但开放每周 1 条精选实时 BUILD_NOW 及实时候选异动流 Watching Queue） | `true` |
| `feed_delay_days` | 0（彻底移除 45 天无用延迟，改为按条数及形态限流） | 0 |
| `opportunity_detail_full` | `false`（仅摘要 + Track Record 已公开部分） | `true` |
| `scores_visible` | `false` | `false`（首发对任何套餐都不展示数值分，见 05 §1；此字段预留给未来可能的调试 / 企业需求） |
| `compare_max_items` | 2 | 3 |
| `deep_report_generate` | `{ quota, MONTH, 1 }`（体验示例） | `{ quota, MONTH, 30 }` |
| `deep_report_export` | `false` | `true` |
| `watchlist_max_items` | 5 | 200 |
| `alert_rules_max` | 1（仅 `DAILY` digest） | 20 |
| `alert_channels` | `["EMAIL"]` | `["EMAIL","WEBHOOK"]` |
| `projects_max` | 1 | 50 |
| `api_access` | `false` | `false`（首发不售卖；字段保留，Phase 2 再打开） |
| `history_window_days` | 30 | 365 |

### 3.3 版本化
- `plans` 表的 `entitlements` 变更即新记录版本（`plans` 增加 `version` 字段，`plan_code` 相同但 `version` 递增；`subscriptions` 记录订阅时的 `entitlements_snapshot`，避免"运营改了套餐配置导致已订阅用户权益被动变化"的争议——**已订阅用户在当前计费周期内维持订阅时的权益快照，下一周期续费时应用最新配置**，变更需提前通知（§8）。

## 4. `EntitlementService`

### 4.1 接口与预占模式（Hold & Release）
```ts
interface EntitlementService {
  /** 检查开关型权限与静态上限（只读） */
  check(userId: string, feature: string, opts?: { units?: number }): Promise<EntitlementResult>;
  /** 原子预占配额（在入队/开始前调用，DB 层面 UPDATE ... WHERE used + units <= limit 原子保障，杜绝超卖） */
  reserve(userId: string, feature: string, units: number, requestId: string): Promise<ReservationResult>;
  /** 任务彻底失败时的补偿回滚（仅对未产生任何有效产出的彻底失败退回配额） */
  refund(userId: string, feature: string, units: number, requestId: string, reason: string): Promise<void>;
  /** 查询当前用量与周期 */
  getUsage(userId: string, feature: string): Promise<{ used: number; limit: number; period_start: string }>;
}

type EntitlementResult =
  | { allowed: true; remaining?: number }
  | { allowed: false; reason: 'PLAN_REQUIRED' | 'LIMIT_EXCEEDED'; requiredPlan?: string };

type ReservationResult =
  | { success: true; remaining: number }
  | { success: false; reason: 'PLAN_REQUIRED' | 'QUOTA_EXCEEDED'; resetAt: string; requiredPlan?: string };
```
- **预占与补偿机制（Hold & Release Pattern）**：
  - 为防止异步任务在排队与执行窗口期（30–90 秒）遭高并发调用绕过配额产生严重超卖，对 `quota` 周期型配额实行**入队即原子预占**（`reserve`）；
  - `reserve` 利用 PostgreSQL 行锁与条件更新：`UPDATE usage_counters SET used = used + :units WHERE user_id = :uid AND feature = :f AND period_start = :p AND used + :units <= :limit`；若受影响行数为 0 则直接返回 `QUOTA_EXCEEDED` 快速拒绝；
  - 若异步任务最终彻底失败（如骨架生成崩溃、未达到 `PARTIAL` 状态且无有效章节产生），Worker 在错误处理分支调用 `refund` 原子补偿回滚已扣减的配额；若达到 `READY` 或 `PARTIAL`，则配额已被合规消费，无需后续处理。

### 4.2 周期计算
- `quota` 类型的 `period_start`：`MONTH` 按用户所在订阅的计费周期起始日（`subscriptions.current_period_start`）对齐，而非自然月，避免"月中订阅当月配额被稀释"的观感问题；`FREE` 套餐（无订阅）按账户创建日对齐的自然月滚动。
- `usage_counters` 按 `(user_id, feature, period_start)` 累加，读取路径优先查计数器（O(1)），仅在计数器缺失时回溯 `usage_events` 重建（用于处理时区 / 周期边界的异常情况）。

### 4.3 各服务的调用点

| 服务方法 | `feature` | 模式与时机 | 备注 |
|----------|-----------|------------|------|
| `ReportService.request` | `deep_report_generate` | `reserve` 在入队时原子执行；仅当整份报告生成彻底失败时调用 `refund` | 杜绝并发超卖；同快照重复请求不重复扣额（09 §6） |
| `ReportService.export` | `deep_report_export` | `check` | boolean 检查，非 quota |
| `DecisionService.watch` | `watchlist_max_items` | `check` | 检查当前 Watchlist 行数 < 上限 |
| `AlertService.createRule` | `alert_rules_max` | `check` | 同上，行数上限检查 |
| `ProjectService.create` | `projects_max` | `check` | 同上 |
| `OpportunityService.compare` | `compare_max_items` | `check` | 请求体 `ids.length` ≤ 上限，非消耗型 |
| REST API Key 调用 | `api_access` | `check` | 布尔前置检查 |

## 4.4 首发包装约束
与 `20-COMMERCIAL-RELEASE.md` 一致，避免免费路径绕过付费窗口：

- 「申请追踪」创建 `CANDIDATE`，不视为 `feed_realtime`，不扣 `deep_report_generate`。
- `opportunity_detail_full` 对 `CANDIDATE` 关闭：调用方看到观察状态、缺了哪一类证据、预计何时可复评。已发布裁决的完整详情才按套餐打开。
- Free 的信息流只含延迟公开投影（15，默认 45 天）。Pro 的实时信息流每天最多 10 条已发布决定，而不是无限关键词审计。
- 报告导出只针对已发布的 `BUILD_NOW` / `EARLY_BET`。同一快照重复导出不重复扣额。
- Team 不在首发结账页出现。

## 5. 配额耗尽与降级 UX
- REST：见 10 §1.1 错误格式，`QUOTA_EXCEEDED` / `PLAN_REQUIRED`，响应体含 `upgrade.url`。
- Web：受限功能不隐藏，而是可见但置灰 + 升级引导（延续 Free 层"看得见但看不全"的获客逻辑，呼应 PRD §7）。

## 6. 计费流程

### 6.1 供应商
Merchant of Record（00 ADR-007，具体供应商见 01 §12 决策 4）；本方不直接处理信用卡信息，不落地 PCI 范围内数据。

### 6.2 流程
```text
用户选择套餐 → POST /billing/checkout-sessions → 跳转供应商托管结账页
  → 供应商 Webhook 通知（订阅创建 / 续费 / 失败 / 取消）→ POST /webhooks/billing
    → 校验签名 → 按 event_id 幂等处理 → 更新 subscriptions → 必要时更新 users 关联状态
```
- Webhook 事件类型（最小集）：`subscription.created` `subscription.updated` `subscription.canceled` `invoice.payment_failed` `invoice.payment_succeeded` `dispute.created` `dispute.lost`。
- `invoice.payment_failed`：订阅进入 `PAST_DUE`，权益按 `PAST_DUE` 宽限期配置（默认 7 天维持 `PRO` 权益，第 1/3/7 天分别自动发送催缴提醒邮件，7 天后自动降级为 `FREE` 权益但保留数据）处理，不立即锁定账户。
- **拒付与风控争端处理（`dispute.created` / `dispute.lost`）**：
  - 收到 `dispute.created` 时：系统立即原子挂起该用户账户（`users.status = 'SUSPENDED'`），吊销其全部有效会话与 API Key，防止黑卡盗刷者在拒付争议期内继续滥用 LLM 与批量导出数据；
  - 若争议胜诉（`dispute.won`），恢复账户状态为 `ACTIVE`；若争议败诉（`dispute.lost`），终止订阅并将其支付指纹列入滥用黑名单。
- 管理订阅（更换套餐、取消、查看发票）通过 `POST /billing/portal-sessions` 跳转供应商托管页面，不在本产品内重新实现支付表单。

### 6.3 套餐变更与降级规则
- 升级：立即生效（`entitlements_snapshot` 更新），按供应商的按比例计费规则处理差额（由 MoR 处理，不在本方系统实现）。
- 降级 / 取消：`cancel_at_period_end = true`，当前计费周期内维持原权益，周期结束后降级。
- **降级时的数据上限处理与规则停用**：
  - Watchlist / Project：既有数据超出新套餐上限部分（如 Free 上限 5 条但用户有 50 条关注）**不物理删除**，允许只读查看超出部分，但不可新增关注或项目，直至清理到上限以下或重新升级；
  - 告警规则停用（`alert_rules`）：Free 套餐仅允许 1 条告警规则（且仅限 `DAILY` digest）。用户降级为 Free 时，系统按 `created_at ASC` **自动保留最早创建的 1 条有效规则，其余规则批量置为 `status = 'DISABLED_DUE_TO_DOWNGRADE'` 并停止投递**，避免持续消耗邮件服务商额度；用户重新升级为 Pro 时，可在设置页一键恢复全部历史规则。

## 7. 滥用检测（首发最小集）

| 信号 | 阈值（初始值） | 处置 |
|------|----------------|------|
| 单账户 API 请求速率异常 | 超过角色对应速率上限（见 10 §1 `RateLimit-*`）持续 5 分钟 | 自动限流（429），记录，超过 3 次 / 天升级人工review |
| 单账户创建多个 `FREE` 账户（同 IP / 同支付方式指纹） | 24 小时内 ≥ 5 个新账户 | 标记待审核，暂不自动封禁（避免误伤共享网络环境） |
| Webhook 目标地址指向内网 / 保留地址段（SSRF 防护） | 创建时校验 | 拒绝创建，返回 `VALIDATION_ERROR` |
| GSC OAuth 异常（短时间内连接大量不同 Property） | 1 小时内 ≥ 10 个 Property | 标记待审核 |
| 单账户深度报告请求集中于同一机会的大量重复生成 | 同机会 24 小时内 ≥ 5 次重新生成 | 不额外扣配额外的惩罚，但计入 quota 消耗，天然被 `deep_report_generate` 上限约束；仅记录用于产品分析 |

- 检测结果进入 `/admin/review-queue`（10 §4.9），由 `ADMIN` / `SUPPORT` 处理，首发不做自动封号。

## 8. 权益变更通知
- 套餐权益配置（§3.2 具体数值）变更前，对受影响的现有订阅用户提前 ≥ 14 天邮件通知（`EMAIL` 渠道，走系统保留发送路径，不依赖用户的个人告警渠道配置）。
- 变更记录写 `audit_log`（`actor_type = ADMIN`），`plans` 新版本生效日期明确写入，不做即时生效的静默变更。

## 9. 与其他文档的接口
- 03：`plans` `subscriptions` `usage_events` `usage_counters` `api_keys` 表结构已定义，本文档定义其语义与 `entitlements` 内部结构。
- 10：全部受控端点通过 `EntitlementService.check` 前置校验；错误格式统一。
- 09：机会研究报告的配额消耗时点与同快照幂等缓存豁免规则，权威定义在本文 §4.3，09 §6 引用。

## 10. 测试要求（18 §3）
| 用例 | 期望 |
|------|------|
| Free 用户请求深度机会报告导出 | `403 PLAN_REQUIRED` |
| 并发排队多个深度报告生成请求，配额仅剩 1 | 只有 1 个成功获得 `reserve` 并进入 `QUEUED`，其余并发请求立即返回 `403 QUOTA_EXCEEDED` |
| 深度报告生成彻底失败 | 触发 `refund`，用户配额恢复原状 |
| 同快照重复查看/导出已就绪报告 | 零额外配额消耗，直接返回缓存结果 |
| 订阅从 `PRO` 降级为 `FREE`，Watchlist 超限 | 超出部分只读可见，无法新增关注 |
| Webhook 目标为 `127.0.0.1` | 创建请求被拒绝 |
| `invoice.payment_failed` 后 8 天未恢复 | 权益自动降级为 `FREE` 对应值 |
