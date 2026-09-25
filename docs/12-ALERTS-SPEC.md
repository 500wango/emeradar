# 12 — Watchlist、Kill Criteria 与告警规格

Status: Draft ｜ 依赖：01 F9、03、05、07 ｜ 被依赖：09、10、16

## 1. 目的与范围
定义 Watchlist 的变化如何被检测、Kill criteria 如何表达与求值、告警如何去重 / 限流 / 投递。首发渠道：Email + 通用 Webhook（01 F9）。

**DSL 复杂度原则**：Kill criteria 与告警触发条件使用**简单 JSON 谓词**（字段 / 操作符 / 值，可用 `and`/`or` 浅层组合），不做完整 AST 表达式引擎、不支持用户自定义公式或跨字段运算。理由：首发用户需要的是"这几条明确信号出现就提醒我"，不是构建自己的评分系统；简单谓词可静态校验、可确定性求值、可直接映射到已有的 `axis_features` / `verdicts` 字段，复杂度增加的收益不足以覆盖工程与心智成本。

## 2. 触发器目录（Watchlist 变化，非用户自定义）

系统对每个被关注（Watchlist）或有 GO 决定的机会，评估以下内置触发器；用户按渠道订阅，无需自己写条件：

| 触发器 | 检测时机 | 条件 |
|--------|----------|------|
| `VERDICT_CHANGED` | S7（每日） | 当日 `verdict` ≠ 前一日 `verdict`（读账本，非 `raw_verdict`） |
| `LIFECYCLE_CHANGED` | S7 | `lifecycle_transitions` 新增一条 |
| `WINDOW_CLOSING_ENTERED` | S7 | 当日 `verdict = WINDOW_CLOSING` 且前一日不是 |
| `SERP_WEAKNESS_DROP` | S7 | `serp_weakness` 较 7 天前下降 ≥ `serp_weakness_drop_threshold`（默认 20 分） |
| `AUTOCOMPLETE_SPIKE` | S7 | `new_queries_7d` 较其 30 天移动平均 ≥ `autocomplete_spike_multiplier`（默认 3×） |
| `NEW_AUTHORITATIVE_ENTRANT` | S7 | 当日 Top10 新出现 `OFFICIAL` 或 `MAJOR_MEDIA` 类域名，且该域名在 7 天前的 Top10 快照中完全未出现 |
| `KILL_CRITERIA_TRIGGERED` | S7（评估用户 / 系统定义的 Kill criteria，见 §5） | 任一 `ACTIVE` 的 kill criteria 谓词求值为真 |
| `PROJECT_GSC_TRACTION` | GSC 周同步后 | 关联 Project 的曝光量较上周环比 ≥ `traction_spike_multiplier`（默认 2×）且绝对曝光 ≥ `traction_min_impressions`（默认 100） |

- 所有阈值来自 `alert_thresholds` 配置（版本化，同 05 的配置管理方式，但独立于 `scoring_config` 版本流转，因为它不影响评分，只影响是否提醒）。
- 触发器求值使用的输入必须是**当日已落账本 / 已入库**的数据，不早于 S6 完成（对 `VERDICT_CHANGED`、`LIFECYCLE_CHANGED`）。

## 3. 告警规则（用户可配置的"是否通知我"）

用户不编写触发条件本身（§2 已固定），只配置**对哪些触发器、在什么范围内、发到哪个渠道**：

```sql
-- 见 03 alert_rules 表
{
  "rule_type": "TRIGGER_SUBSCRIPTION",
  "params": {
    "triggers": ["VERDICT_CHANGED", "WINDOW_CLOSING_ENTERED", "KILL_CRITERIA_TRIGGERED"],
    "scope": "WATCHLIST_AND_PROJECTS",      -- WATCHLIST_ONLY | PROJECTS_ONLY | WATCHLIST_AND_PROJECTS
    "verdict_filter": ["BUILD_NOW", "EARLY_BET"],   -- 可选：仅当机会当前 verdict 属于此集合才通知
    "min_confidence": "MEDIUM",              -- 可选：低于此置信度不通知
    "digest": "IMMEDIATE"                    -- IMMEDIATE | DAILY | WEEKLY
  }
}
```

**预设规则模板**（Onboarding / 设置页提供，用户可直接选用或在此基础上调整，降低配置门槛）：
| 模板 | 等价配置 |
|------|----------|
| "有变化就告诉我" | 全部触发器，`IMMEDIATE` |
| "只关心窗口变化" | `VERDICT_CHANGED` `WINDOW_CLOSING_ENTERED` `KILL_CRITERIA_TRIGGERED`，`DAILY` |
| "只关心我的项目" | `PROJECT_GSC_TRACTION`，`scope = PROJECTS_ONLY`，`IMMEDIATE` |
| "每周摘要" | 全部触发器，`WEEKLY` |

每个用户可创建多条 `alert_rules`（不同触发器组合对应不同渠道），无上限但受合理性校验（同一 `(triggers, scope)` 组合 + 同一渠道不可重复创建）。

## 4. 事件产生与去重

### 4.1 `alert_events` 生成
S7 阶段：对每个订阅了相关触发器的用户 × 命中的机会，生成一条候选事件；`dedupe_key` 由业务语义构造，保证幂等与合理去重：

```text
dedupe_key = sha256( user_id ‖ coalesce(opportunity_id, '') ‖ coalesce(project_id, '') ‖ trigger_type ‖ obs_date )
```
- 同一用户对同一对象（机会或项目）的同一触发器同一天只产生一条事件（即使多条 `alert_rules` 都订阅了它，也只生成一条 `alert_events`，由投递阶段决定发到哪些渠道，避免重复通知同一信息）。
- 对于项目级触发器（如 `PROJECT_GSC_TRACTION`），必须包含 `project_id`，防止同一用户对同一机会的多个项目发生事件碰撞覆盖。
- `KILL_CRITERIA_TRIGGERED` 的 `dedupe_key` 额外包含 `kill_criteria_id`，因为一个机会可能同时有多条 Kill criteria 触发。

### 4.2 触发到投递的映射
```text
alert_events (1) ──▶ 匹配用户当前所有 alert_rules ──▶ 每条匹配规则的每个 channel_id 生成一条 deliveries
```
- 一个事件可能对应多条 `deliveries`（用户订阅了 Email 和 Webhook 两个渠道）。
- `DAILY` / `WEEKLY` 规则不立即投递，事件先入队，由 §6 的摘要任务批量处理。

## 5. Kill Criteria DSL

### 5.1 谓词结构（Zod schema，`predicate` 列的内容）
```ts
type FieldRef =
  | 'axes.demand.band' | 'axes.commercial.band' | 'axes.window.band'
  | 'axes.commercial.stage'                          // commercial_stage 枚举
  | 'features.serp_weakness' | 'features.e_specialist_30d' | 'features.e_authoritative_30d'
  | 'features.crowding_index' | 'features.new_queries_7d'
  | 'lifecycle' | 'verdict';

type Operator = 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'not_in';

interface Comparison {
  field: FieldRef;
  operator: Operator;
  value: string | number | string[];
}

interface CompoundPredicate {
  and?: (Comparison | CompoundPredicate)[];
  or?: (Comparison | CompoundPredicate)[];
}

type KillPredicate = Comparison | CompoundPredicate;
```
- **深度限制**：`and`/`or` 最多嵌套 2 层（防止用户构造出等价于任意布尔电路的表达式）；每层子条件 ≤ 5 个。
- **字段白名单**：`FieldRef` 是封闭枚举，不支持任意 JSON 路径；新增字段需要修改 schema 版本，不接受运行时动态字段名。
- **类型校验**：`value` 的类型必须与 `field` 对应的实际类型匹配（band 类字段只能比较 `eq`/`neq`/`in`/`not_in`，数值字段可用全部比较操作符）；写入时静态校验，不匹配直接拒绝创建。

### 5.2 示例
```json
{ "and": [
    { "field": "features.e_specialist_30d", "operator": "gte", "value": 3 },
    { "field": "verdict", "operator": "in", "value": ["BUILD_NOW", "EARLY_BET"] }
] }
```
（对应 PRD 示例："Top10 出现 ≥ 3 个 specialist 域名则放弃"）

```json
{ "or": [
    { "field": "axes.window.band", "operator": "eq", "value": "LOW" },
    { "field": "axes.commercial.stage", "operator": "in", "value": ["NONE"] }
] }
```

### 5.3 求值
- 纯函数 `evaluateKillPredicate(predicate, snapshot) → boolean`，位于 `@app/scoring`（同 P7 确定性要求：无 IO、同输入同输出）；`snapshot` 是当日 `verdicts` 行 + 对应 `axis_features` 的只读投影。
- 求值时机：S7，紧随 05 §5 的 Verdict 计算之后，使用**同一批**当日数据，不产生额外的特征读取路径。
- 一条 Kill criteria 触发后状态变为 `TRIGGERED`（03 `kill_criteria.status`），不再重复求值；用户可手动重置为 `ACTIVE`（例如误触发或情况已改变）。

### 5.4 来源：系统建议 vs 用户自定义
- **系统建议模板**（`origin = 'SYSTEM'`，`user_id = null`）：在 Opportunity Detail 生成机会详情时，基于该机会当前的 Build Type 与 Verdict，从固定模板库匹配 1–2 条建议（如"任何机会"都建议"W 降为 LOW"；`EARLY_BET` 额外建议"90 天内商业证据仍为 INSUFFICIENT/LOW"）。用户一键"采纳"即复制为自己的 `ACTIVE` 条目（`origin = 'USER'`，关联该 `user_id`）。
- **用户自定义**：在采纳的模板基础上调整阈值，或从零构建（UI 提供结构化表单而非裸 JSON 编辑，减少语法错误）。
- 每个机会每用户 Kill criteria 数量上限：`max_kill_criteria_per_opportunity`（默认 5），超出拒绝创建。

## 6. 投递

### 6.1 渠道

| 渠道 | 配置 | 说明 |
|------|------|------|
| `EMAIL` | 用户账户邮箱（默认）或指定地址 | 模板化邮件，含机会标题、触发原因（人类可读，非 JSON）、跳转链接 |
| `WEBHOOK` | 用户提供的 HTTPS URL + 可选密钥 | POST JSON payload（§6.4），带 HMAC 签名头；内置 Slack / Discord / Telegram **格式模板**（用户选择目标平台后，系统按对应平台的消息格式包装 payload，本质仍是发往用户自己配置的 Incoming Webhook URL，不是系统直接集成这些平台的官方 API） |

- `notification_channels.config_encrypted` 存储目标地址 / 密钥，信封加密（同 GSC 令牌处理方式，见 17）。
- 新增 Webhook 渠道需通过 `POST /notification-channels/{id}/verify` 验证（发送测试消息，用户在目标端确认收到才激活）。

### 6.2 去重、频控
- 幂等：`deliveries` 的重试（网络失败）复用同一 `alert_event_id` + `channel_id`，不产生新事件。
- **频控**：同一用户同一渠道，`IMMEDIATE` 规则的投递间隔下限 `min_delivery_interval`（默认 5 分钟）；间隔内的多个事件合并为一条"批量"通知（列出多个机会 / 触发器，而非逐条发送）。
- **Quiet hours**：用户可设置免打扰时段（基于 `ui_locale` 推断默认时区，可手动调整）；`IMMEDIATE` 事件在免打扰时段内暂存，时段结束后作为一条合并通知发出；`KILL_CRITERIA_TRIGGERED` 不受 quiet hours 限制（用户主动定义的放弃信号，视为高优先级）。

### 6.3 摘要（Digest）
- `DAILY`：每日固定时间（默认 13:00 UTC，即多数目标市场的早晨到中午）按用户时区就近对齐，汇总前 24 小时内的事件，一条邮件 / Webhook。
- `WEEKLY`：每周一固定时间，汇总前 7 天，并入 Weekly Review 的数据源（Phase 2 §6.1 用途，首发仅摘要通知本身）。
- 摘要生成为幂等批处理任务（`(user_id, digest_type, period_start)` 唯一键），失败可重试不重复发送。

### 6.4 Webhook Payload
```json
{
  "event_id": "ntf_…",
  "occurred_at": "…",
  "triggers": [
    { "type": "WINDOW_CLOSING_ENTERED", "opportunity": { "id": "opp_…", "slug": "…", "title": "…" },
      "detail": { "verdict": "WINDOW_CLOSING", "previous_verdict": "EARLY_BET" },
      "url": "https://{domain}/opportunities/{slug}" }
  ],
  "digest": "IMMEDIATE"
}
```
- 签名：`X-Signature: sha256=HMAC(secret, raw_body)`；文档提供各语言校验示例。
- 失败重试：指数退避，最多 5 次（分钟级到小时级）；连续失败 → `deliveries.status = DEAD` → 渠道标记异常并邮件提醒用户检查 Webhook 配置（这一条走系统保留的 `EMAIL` 渠道，不依赖用户自己的 Webhook）。

## 7. 与其他文档的关系
- `EntitlementService`（13）决定：Free 套餐是否可配置告警渠道、`alert_rules` 数量上限、`kill_criteria` 数量上限是否与套餐挂钩。
- 触发器读取的字段来自 05（`axis_features`、`verdicts`）与 07（`commercial_stage`），Kill Criteria DSL 的字段白名单必须与这两份文档的字段命名保持同步——新增评分字段时若需开放给 Kill Criteria，同一 PR 内更新 §5.1 的 `FieldRef`。
- REST API（10）与 Web 控制台的关注与告警规则共用同一 `AlertService`。

## 8. 测试要求（18 §3）
| 用例 | 期望 |
|------|------|
| Kill predicate 深度 / 宽度超限 | 创建时拒绝，返回 `VALIDATION_ERROR` |
| Kill predicate 字段类型不匹配（如对 band 字段用 `gte`） | 创建时拒绝 |
| 同一 Kill criteria 连续多日满足条件 | 只在首次满足时触发一次，状态转 `TRIGGERED` |
| 同一触发器同一机会同一天多条规则订阅 | 只产生一条 `alert_events`，按渠道分发多条 `deliveries` |
| Quiet hours 内的 IMMEDIATE 事件 | 暂存，时段结束后合并发出 |
| Webhook 连续失败 5 次 | 状态转 `DEAD`，触发系统 Email 提醒 |
| 系统建议模板采纳后修改 | 生成独立 `USER` 记录，不影响原模板 |
