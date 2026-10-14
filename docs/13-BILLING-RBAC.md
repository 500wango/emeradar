# 13 — 计费、权益与权限规格

Status: Approved ｜ 依赖：01 §8、03、10 ｜ 被依赖：09、12、16、17

## 1. 目的
定义套餐、配额、角色权限如何统一实现为一个单一决策点：`EntitlementService`。避免不同入口限流与权限规则不一致。

### 邮箱验证门槛

登录和 Feed/Compare 浏览不要求邮箱验证，保证用户可以先理解产品价值。报告生成与导出、正式决策、项目创建、告警规则、API key 创建和 checkout 属于高价值或外部投递动作，统一要求 `users.email_verified_at IS NOT NULL`；未满足时 API 返回 `EMAIL_VERIFICATION_REQUIRED`，页面引导用户到账户设置重发验证邮件。验证 token 仅保存哈希、24 小时过期且一次性消费。账户设置、证据列表和管理台操作控件必须保留可见键盘焦点与原生语义。

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
| `FREE` | 体验 + 准实时精选消费者；转化入口。**无认领槽位权限**——免费层不能 GO，也就拿不到点火包（PRD §1.7 第 6 条） |
| `PRO` | 核心付费套餐：全量实时 Feed、完整 Detail、**原子立项（锁槽 + 导出 AI 点火包）**、自定义词初筛与 7 天脉冲雷达、Watchlist/Alerts、Project 追踪。计费间隔支持月付 / **季度 Builder Pass** / 年付 |
| `TEAM` | 历史兼容值；不在结账页出现，不提供 workspace 或多席位功能 |

**`STEALTH_BUYOUT` 不是一个 `plan_code`**，而是单次增值商品（PRD §8.1）：它买的不是订阅权益，所以不进 `plans` 表、不产生续费，落库为 `stealth_locks`（03 §12）而不是 `subscriptions`。购买资格由数据而非规格决定——`已认领槽位 == 0` 才可下单。

### 3.2 `entitlements` 结构（`plans.entitlements` jsonb）
```json
{
  "plan_code": "PRO",
  "features": {
    "feed_realtime": { "type": "boolean", "value": true },
    "feed_selected_weekly": { "type": "quota", "period": "WEEK", "limit": 1 },
    "candidate_pool_readonly": { "type": "boolean", "value": true },
    "opportunity_detail_full": { "type": "boolean", "value": true },
    "scores_visible": { "type": "boolean", "value": false },
    "compare_max_items": { "type": "number", "value": 3 },
    "live_scan_lifetime": { "type": "quota", "period": "LIFETIME", "limit": 1 },
    "live_scan_monthly": { "type": "quota", "period": "MONTH", "limit": 15 },
    "pulse_radar": { "type": "boolean", "value": true },
    "atomic_go_export_monthly": { "type": "quota", "period": "MONTH", "limit": 5, "rollover": true },
    "active_go_slots_max": { "type": "number", "value": 2 },
    "launch_kit_export": { "type": "boolean", "value": true },
    "stealth_buyout": { "type": "boolean", "value": true },
    "report_preview_monthly": { "type": "quota", "period": "MONTH", "limit": 1 },
    "watchlist_max_items": { "type": "number", "value": 200 },
    "alert_rules_max": { "type": "number", "value": 20 },
    "kill_criteria_max_per_opportunity": { "type": "number", "value": 5 },
    "alert_channels": { "type": "set", "value": ["EMAIL", "WEBHOOK"] },
    "projects_max": { "type": "number", "value": 50 },
    "gsc_connections_max": { "type": "number", "value": 50 },
    "api_access": { "type": "boolean", "value": false },
    "history_window_days": { "type": "number", "value": 365 }
  }
}
```
- 四种字段类型：
  - `boolean`：开关型（可用 / 不可用）
  - `number` / `set`：静态上限（数量、渠道集合）
  - `quota`：周期性配额（按 `period` 重置，消耗记录于 `usage_events` / `usage_counters`）
  - `quota` 加 `"rollover": true`：**跨月累计**（PRD §8.1），期末剩余额度写入 `usage_carryovers`，下期叠加
- **`period: "LIFETIME"` 是终身额度**，实现上用固定哨兵日期 `1970-01-01` 作为 `usage_counters.period_start`（03 §3），因此与周期额度共用同一套原子预占逻辑，不需要为它写第二份并发控制。
- **`feed_delay_days` 已被删除**。旧版用它表达"Free 延迟 45 天"，PRD §7.1 已彻底废除该方案；免费层的实时体验改由 `feed_selected_weekly`（每周 1 条**刚满额锁定或刚进入 `WINDOW_CLOSING`** 的准实时案例）承担，资格口径见 15 §3。

- `FREE` 与 `PRO` 的默认值（初始假设，定价与具体额度以 Phase 0 预售访谈结果为准，见 01 §12 决策 5）：

| 字段 | `FREE` | `PRO` |
|------|--------|-------|
| `feed_realtime` | `false` | `true` |
| `feed_selected_weekly` | `{ WEEK, 1 }` | —（实时流已覆盖） |
| `candidate_pool_readonly` | `true` | `true` |
| `opportunity_detail_full` | `false`（摘要 + 精选案例 + Track Record） | `true` |
| `scores_visible` | `false` | `false`（首发对任何套餐都不展示数值分，见 05 §1） |
| `compare_max_items` | 2 | 3 |
| `live_scan_lifetime` | `{ LIFETIME, 1 }`（**半遮罩**展示，见 10 §4.3） | — |
| `live_scan_monthly` | — | `{ MONTH, 15 }` |
| `pulse_radar` | `false` | `true` |
| `atomic_go_export_monthly` | —（**无 GO 权限**） | `{ MONTH, 5, rollover: true }` |
| `active_go_slots_max` | `0` | `2` |
| `launch_kit_export` | `false` | `true` |
| `stealth_buyout` | `false` | `true` |
| `report_preview_monthly` | `{ MONTH, 1 }`（**不可导出**） | — |
| `watchlist_max_items` | 5 | 200 |
| `alert_rules_max` | `0`（**不支持自动化告警**，PRD §8.1） | 20 |
| `alert_channels` | `[]` | `["EMAIL","WEBHOOK"]` |
| `projects_max` | `0`（不能 GO 就无法建项目；**既有项目不删除，降级后只读**） | 50 |
| `gsc_connections_max` | `0` | 50（GSC 为可选增强项，非必选） |
| `api_access` | `false` | `false`（首发不售卖；字段保留，Phase 2 再打开） |
| `history_window_days` | 30 | 365 |

> **免费层不含自动化追踪与告警**（`alert_rules_max = 0`、`alert_channels = []`）。PRD §8.1 的免费层能力清单里明确写着"自动化追踪与告警：不支持"，而本文早先给过 `alert_rules_max = 1`（仅 DAILY digest）——按 00-INDEX 的冲突裁决顺序（`01 > 05 > 03 > 其余`），PRD 优先，此处以 PRD 为准收紧为 0。免费层能拿到的主动信息是 `/feed` 的精选与候选池，以及 `/watchlist` 的手动回访，不是推送。

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
- `quota` 类型的 `period_start`：`MONTH` 按用户所在订阅的计费周期起始日（`subscriptions.current_period_start`）对齐，而非自然月，避免"月中订阅当月配额被稀释"的观感问题；`WEEK` 按该周期起始日对齐的 7 天窗口；`FREE` 套餐（无订阅）按账户创建日对齐的自然月滚动。
- **`LIFETIME` 用固定哨兵日期 `1970-01-01`** 作为 `period_start`。这不是把终身额度塞进周期模型凑数——而是让终身额度与周期额度共享同一套 `reserve` / `refund` 原子预占与并发控制（§4.1），否则一个 feature 要维护第二份"只此一次"的判定逻辑，而两份逻辑迟早会不一致。
- ****跨月累计（Rollover）** 只在 `entitlements` 标注了 `"rollover": true` 的 feature 上生效**（首发仅 `atomic_go_export_monthly`）。周期切换到下一期时，把上一期 `limit - used` 的剩余额度以一行写入 `usage_carryovers`（03 §3），本期可用额度 = `limit + Σ 未被消费的结转`。只结转**一期**：不无限累积，否则用户攒够额度后可以在一个月内把整套 Feed 立项完，槽位机制会被自己的配额绕开。结转行逐笔留存，使"额度去哪了"可被回答，而不是靠一个会漂移的余额数字。
- `usage_counters` 按 `(user_id, feature, period_start)` 累加，读取路径优先查计数器（O(1)），仅在计数器缺失时回溯 `usage_events` 重建（用于处理时区 / 周期边界的异常情况）。

### 4.3 各服务的调用点

| 服务方法 | `feature` | 模式与时机 | 备注 |
|----------|-----------|------------|------|
| `LiveScanService.scan`（Free） | `live_scan_lifetime` | `reserve`（`LIFETIME` 哨兵周期），且必须先通过反滥用闸门（§7） | 结果**半遮罩**（10 §4.3）；额度消耗后**不退还**——退还等于把终身 1 次变成无限次 |
| `LiveScanService.scan`（Pro） | `live_scan_monthly` | `reserve` | 全量展示，可一键转 7 天脉冲雷达 |
| `DecisionService.goAndExport` | `atomic_go_export_monthly`（+ `active_go_slots_max` 上限检查） | **单事务原子操作**：`reserve` 配额 → 占 1 个形态槽位 → 建 Project → 解锁该形态点火包 | PRD §1.7 第 5 条「不点 GO 绝不允许导出」。并发抢同一槽位只有一个成功（10 §4）；配额与槽位必须同事务，否则绕过 API 即可白拿点火包 |
| `ReportService.preview`（Free） | `report_preview_monthly` | `reserve` | 仅在线预览；Free 的 `launch_kit_export` 恒为 `false`，无导出路径 |
| `ReportService.request`（Pro） | 不单独扣额 | `check` | Pro 的报告与点火包由 `atomic_go_export_monthly` 在 GO 时一并解锁，不设第二份额度——否则"锁槽一次"与"导出一次"会分叉成两个可分别绕过的闸门 |
| `DecisionService.watch` | `watchlist_max_items` | `check` | 检查当前 Watchlist 行数 < 上限 |
| `AlertService.createRule` | `alert_rules_max` | `check` | 同上，行数上限检查 |
| `OpportunityService.compare` | `compare_max_items` | `check` | 请求体 `ids.length` ≤ 上限，非消耗型 |
| `ProjectService.submitCredential` | 不单独扣额 | `check` | 质押凭证提交只做归属与格式校验；额度已在 GO 时扣减，**逾期释放槽位时不退还**（PRD §1.7 第 5 条） |
| `StealthLockService.purchase` | `stealth_buyout` | `check` + 下单事务内校验 `Σclaimed == 0` | 一次性商品，不走 quota；资格由数据决定而不是套餐 |
| REST API Key 调用 | `api_access` | `check` | 布尔前置检查 |

**`reserve` 需感知 Rollover**：读侧可用额度为 `limit + Σ 未消费结转`（§4.2），因此 §4.1 的条件更新 `WHERE used + :units <= :limit` 中的 `:limit` 必须是**含结转的有效上限**，而不是 `entitlements` 里的原始 `limit`。把有效上限在事务内算出并作为参数传入，是把这条规则只写在一处的最简单办法。

## 4.4 首发包装约束
与 `20-COMMERCIAL-RELEASE.md` 一致，避免免费路径绕过付费窗口：

- 「申请追踪」创建 `CANDIDATE`，不视为 `feed_realtime`，也不扣任何配额。
- `opportunity_detail_full` 对 `CANDIDATE` 关闭：调用方看到观察状态、缺了哪一类证据、预计何时可复评。已发布裁决的完整详情才按套餐打开。
- **Free 的实时体验由 `feed_selected_weekly` 承担，而不是延迟**：每周 1 条**刚满足 `CROWDED_LOCKED` 或刚进入 `WINDOW_CLOSING`** 的已发布机会。**仍有空余槽位的黄金 `BUILD_NOW` 严禁进入免费可见范围**——这是"准实时样本防背刺"（PRD §7.1），免费层看到的是真实且足够震撼的案例，但抢跑价值 100% 留给付费用户。资格判据见 15 §3。
- **Free 没有 GO 权限**（`active_go_slots_max = 0`）：不能认领槽位，也就不能创建 Project、不能导出报告或点火包。免费层能读到的报告只有每月 1 份历史案例预览，且不可导出。
- Pro 的实时信息流每天最多 10 条已发布决定，而不是无限关键词审计；候选观察区对实时套餐开放，对 Free 只读。
- **报告与 AI 点火包在 GO 之后才解锁**，两者同属一次原子立项；同一快照重复查看不重复扣额（09 §6）。
- **季度 Builder Pass 不是独立 `plan_code`**，而是 PRO 权益在 `billing_interval = 'QUARTER'` 下的售卖方式（03 §3）。这样同一份权益只有一个真源，避免 `PRO` 与 `BUILDER_PASS` 两套配额各自漂移。
- **Stealth Buyout 是单次增值商品**，不进 `plans`、不产生续费、不授予任何订阅权益；下单资格由数据决定（`已认领槽位 == 0`），落库为 `stealth_locks`（03 §12）。
- Team 为历史兼容值，不在结账页出现，也不对应当前可用的 workspace 或多席位功能。
- Founding Pro Lifetime 为一次性 `$399` 付款，复用当前 Pro 权益与月度配额，以 `purchase_kind = 'FOUNDING_LIFETIME'` 标记，不产生续费事件。付款后不提供退款。终身版不承诺无限报告、无限抓取或未来高成本模块，当前仅作为首发早鸟方案。

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

## 7. 防白嫖与滥用检测（首发最小集）

### 7.1 反滥用引擎（Anti-Abuse Engine，PRD F14）

"Free 终身仅 1 次免费实时初筛"是一条**价值很高、单次可白拿**的规则。只靠在 `usage_counters`
里记 `used = 1` 拦不住它——换一个邮箱就是一个新账号，而这正是攻击者会做的事。因此该额度
的发放必须经过下列四道彼此独立的闸门，任一不通过即拒绝，且拒绝理由不向用户暴露具体命中了哪一道：

| 闸门 | 规则 | 依据 |
|------|------|------|
| **G1 邮箱 Canonical 归一化** | 剥离 Gmail 的 `+别名` 与 `.`，小写归一；归一化结果在 `email_identities.canonical_email` 上唯一 | 03 §2。同一自然人的 Gmail 变体只能注册一个账号。非 Gmail 域只做小写归一——点号在多数邮箱服务里是有意义的字符 |
| **G2 一次性邮箱黑名单** | 注册时比对 `disposable_email_domains`，命中即拒绝注册 | 03 §2 |
| **G3 OAuth 强绑定** | 领取终身额度**必须**通过 GitHub 或 Google OAuth 登录（纯邮箱密码账号不发放） | 社交身份的注册成本远高于填一个邮箱；`accounts` 表已具备承载能力（ADR-015 的 Auth.js 自带 provider 机制，不引入外部托管 Auth 服务） |
| **G4 设备/IP 30 天限流** | 同一设备指纹或同一 IP 在 30 天内至多触发 1 次；判定依据是 `lifetime_scan_grants` 而非账号计数 | 03 §2。`usage_counters` 只防同一账号重复领取，防不住换号重领 |

- 额度状态机：`reserve` 扣减 `live_scan_lifetime`（LIFETIME 哨兵周期）**与**写入一行 `lifetime_scan_grants` 必须在**同一事务**内完成。只写其中一边，都会留下一条可被利用的路径——只扣配额则换号即可绕过，只写指纹则同号可重复领取。
- **不退还**：初筛额度一旦消耗即不可退（PRD §1.7 第 5 条 对配额退还的一贯口径）。这里与报告生成的 Hold & Release 不同：报告是异步任务，失败时用户没有拿到任何产出，理应退还；初筛是同步返回结果的动作，"失败"本身就是一次有效产出。
- 拿不到指纹或 IP 时**放行但不记录**：宁可让一个真实用户领到，也不要因为客户端不配合指纹采集而永久拒绝他。这类放行会被计数并在管理后台暴露，用于观察绕过规模。

### 7.2 检测信号

| 信号 | 阈值（初始值） | 处置 |
|------|----------------|------|
| 单账户 API 请求速率异常 | 超过角色对应速率上限（见 10 §1 `RateLimit-*`）持续 5 分钟 | 自动限流（429），记录，超过 3 次 / 天升级人工 review |
| 单账户创建多个 `FREE` 账户（同 IP / 同设备指纹 / 同支付方式指纹） | 24 小时内 ≥ 5 个新账户 | 标记待审核，暂不自动封禁（避免误伤共享网络环境） |
| 终身初筛的**无指纹放行**比例异常 | 单日无指纹放行 > 总发放的 30% | 告警：可能有人在系统性规避 G4 |
| Webhook 目标地址指向内网 / 保留地址段（SSRF 防护） | 创建时校验 | 拒绝创建，返回 `VALIDATION_ERROR` |
| GSC OAuth 异常（短时间内连接大量不同 Property） | 1 小时内 ≥ 10 个 Property | 标记待审核（GSC 已降为可选增强项，此信号优先级随之下降） |
| 同一机会在 24 小时内被同一账户反复重新生成报告 | ≥ 5 次 | 计入 quota 消耗，天然被 `atomic_go_export_monthly` 约束；仅记录用于产品分析 |
| GO 后 7 天质押逾期率异常 | 单账户累计逾期 ≥ 2 次 | 标记待审核；额度不退还已由 §4.3 保证，此处只做人工评估是否限制其后续认领 |

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
| Free 用户请求导出 AI 点火包或创建 Project | `403 PLAN_REQUIRED`（`active_go_slots_max = 0`） |
| Free 用户第二次请求实时初筛 | `403 QUOTA_EXCEEDED`（`LIFETIME` 哨兵周期已用尽） |
| 换一个账号、同一设备指纹在 30 天内请求实时初筛 | 被反滥用闸门拒绝（G4），且拒绝理由不区分具体闸门 |
| 同一 Gmail 的 `+别名` 变体尝试注册第二个账号 | 注册被拒（G1 归一化后 `canonical_email` 冲突） |
| 并发排队多个报告生成请求，配额仅剩 1 | 只有 1 个成功获得 `reserve` 并进入 `QUEUED`，其余并发请求立即返回 `403 QUOTA_EXCEEDED` |
| 报告生成彻底失败且无任何有效章节产出 | 触发 `refund`，用户配额恢复原状 |
| 实时初筛请求失败（上游超时） | **不退还** `live_scan_lifetime`（同步动作的失败仍是一次有效产出） |
| 同快照重复查看已就绪报告 | 零额外配额消耗，直接返回缓存结果 |
| 四人并发对同一机会同一形态点 GO，该形态仅剩 1 个槽位 | 只有 1 人成功；其余返回槽位已满，且**无人的配额被扣减** |
| GO 后 7 天未提交凭证 | 槽位释放、`stake_status = 'EXPIRED_RELEASED'`、**已扣配额不退还** |
| 对 `Σclaimed > 0` 的机会发起 Stealth Buyout | 下单被拒（非处女地） |
| Pro 上月 5 次立项只用了 3 次，本月查看可用额度 | 显示 5 + 2 = 7（Rollover），且 `usage_carryovers` 有对应行 |
| 订阅从 `PRO` 降级为 `FREE`，Watchlist 超限 | 超出部分只读可见，无法新增关注 |
| 订阅从 `PRO` 降级为 `FREE`，既有 Project 仍在 | 只读可见、不删除；`stake_status = 'PENDING'` 的质押仍按 7 天期限结算 |
| Webhook 目标为 `127.0.0.1` | 创建请求被拒绝 |
| `invoice.payment_failed` 后 8 天未恢复 | 权益自动降级为 `FREE` 对应值 |
