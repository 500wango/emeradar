# 12 — Watchlist、Kill Criteria 与告警规格

Status: Draft ｜ 依赖：01 F9、03、05、07 ｜ 被依赖：09、10、16

> ## ⚠️ 实现与本规格不一致（2026-10-12 核对）
>
> 本规格描述的是**一套还没建起来的系统**。已落地的是一条窄得多的旧路径，两者不是
> "实现不全"，而是**模型不同**：规格按"订阅触发器组合"建模，代码按"一个 `rule_type`
> 单值"建模。逐条对照：
>
> | 规格 | 实现现状 |
> |---|---|
> | §2 内置触发器（现 12 条，见下表），用户在规则里订阅**组合** | `alert_rules.rule_type` 是**单值**列，一行 = 一个 `(user, opportunity, rule_type)` |
> | §2 触发器名 `VERDICT_CHANGED` / `WINDOW_CLOSING_ENTERED` | 库里和代码里是 `VERDICT_CHANGE` / `WINDOW_CLOSING` —— **同义不同名**，对不上号 |
> | §2 阈值来自 `alert_thresholds`（版本化） | **该表在 `schema.sql` 里不存在**，任何位置都没有 |
> | §2 触发器全部可求值 | 只有 `VERDICT_CHANGE` 与 `WINDOW_CLOSING` 有求值路径（`services/src/alert-triggers.ts`）。其余在创建规则时被显式 400 拒绝 |
> | §3 `params` JSON（triggers/scope/verdict_filter/min_confidence/digest） | 无此列；`alert_rules` 只有 `rule_type` / `frequency` / `is_active`。`scope`、`verdict_filter`、`min_confidence`、模板概念均不存在 |
> | §4 `alert_events` 生成 + `dedupe_key` 去重 + `deliveries` 投递记录 | `alert_events` 表**建了但零读写**；流水线直接 `INSERT INTO notifications`，去重靠 `ON CONFLICT (id) DO NOTHING`；`dedupe_key` 与 `deliveries` 不存在 |
> | §5.1 谓词 `{field, operator, value}` | `kill_criteria.predicate_dsl` 实际存的是 `{metric, op, threshold}` —— **不同构**，改写谓词要么迁移数据要么改规格 |
> | §5.3 `evaluateKillPredicate`（位于 `@emeradar/scoring`） | **不存在**。`predicate_dsl` 只被写入、从不被读取；`kill_criteria.status` 里的 `TRIGGERED` 也**没有任何写入点**（`opportunity.service` 的 `killCriteriaTriggered` 因此恒为 0） |
> | §6.1 Email + Webhook 渠道 | `notification_channels` 表**建了但零读写**；唯一在用的投递是站内 `notifications` 列表 |
>
> **已做的收敛（不改变上述差距）**：创建入口不再放行 `NEW_ENTRANT` / `KILL_CRITERIA`
> （订阅一个永远不会响的规则比不提供更糟），并有一条幂等语句把库里既有的这类
> 活跃规则置为停用；面向用户的"自动叫停"文案改成"需人工对照"。
>
> **待裁决**：本规格是**目标态**（那就要按它重建，`rule_type` 单值模型整体废弃）还是
> **过度设计**（那就要按实现现状重写 §2–§6，删掉 `alert_thresholds` 之类的空头承诺）。
> 在裁决之前，任何按本规格实现的代码都会与线上表结构打架 —— 请先选一边。
> 另外 `en.ts` 的套餐文案 `webhookDelivery: 'In-app notifications & email digests'`
> 承诺了 Email 摘要与 Webhook，二者都没有实现，属于同一处的对外失实。

## 1. 目的与范围
定义 Watchlist 的变化如何被检测、Kill criteria 如何表达与求值、告警如何去重 / 限流 / 投递。首发渠道：Email + 通用 Webhook（01 F9）。

**DSL 复杂度原则**：Kill criteria 与告警触发条件使用**简单 JSON 谓词**（字段 / 操作符 / 值，可用 `and`/`or` 浅层组合），不做完整 AST 表达式引擎、不支持用户自定义公式或跨字段运算。理由：首发用户需要的是"这几条明确信号出现就提醒我"，不是构建自己的评分系统；简单谓词可静态校验、可确定性求值、可直接映射到已有的 `axis_features` / `verdicts` 字段，复杂度增加的收益不足以覆盖工程与心智成本。

## 2. 触发器目录（Watchlist 变化，非用户自定义）

系统对每个被关注（Watchlist）或有 GO 决定的机会，评估以下内置触发器；用户按渠道订阅，无需自己写条件：

| 触发器 | 检测时机 | 条件 | 实现状态 |
|--------|----------|------|----------|
| `VERDICT_CHANGED` | S7（每日） | 当日 `verdict` ≠ 前一日 `verdict`（读账本，非 `raw_verdict`） | 已实现求值路径 |
| `LIFECYCLE_CHANGED` | S7 | `lifecycle_transitions` 新增一条 | 无求值路径 |
| `WINDOW_CLOSING_ENTERED` | S7 | 当日 `verdict = WINDOW_CLOSING` 且前一日不是 | 已实现求值路径 |
| `SERP_WEAKNESS_DROP` | S7 | `serp_weakness` 较 7 天前下降 ≥ `serp_weakness_drop_threshold`（默认 20 分） | 无求值路径 |
| `AUTOCOMPLETE_SPIKE` | S7 | `new_queries_7d` 较其 30 天移动平均 ≥ `autocomplete_spike_multiplier`（默认 3×） | 无求值路径 |
| `NEW_AUTHORITATIVE_ENTRANT` | S7 | 当日 Top10 新出现 `result_type` 为 `OFFICIAL` 或 `EDITORIAL_MEDIA` 的域名，且该域名在 7 天前的 Top10 快照中完全未出现 | 已实现求值路径（代码中名为 `NEW_ENTRANT`） |
| `PROVEN_NEW_ENTRANT` | S7 / F6 | 新**独立站**（上线不满 6 个月、闯入 SERP Top 5、且具备 `COMMERCIAL_TRACTION`）出现；识别规则见 07 §6.4 | 无求值路径 |
| `KILL_CRITERIA_TRIGGERED` | S7（评估用户 / 系统定义的 Kill criteria，见 §5） | 任一 `ACTIVE` 的 kill criteria 谓词求值为真 | 无求值路径（`evaluateKillPredicate` 未落地，见 §5.3） |
| `CUSTOM_QUERY_PULSE_CONFIRMED` | S7（对进入 7 天脉冲雷达的自定义初筛词） | 自定义初筛词的 7 天时序脉冲确认，且该词由 `CANDIDATE` 晋升为 `BUILD_NOW` 时推送抢跑通知（PRD F3 第 2 阶段、F9） | 无求值路径 |
| `SLOTS_LAST_ONE` | S7 | 该机会某一形态剩余可认领槽位恰为 **1**（`opportunity_slots.capacity − claimed == 1`，ADR-018） | 无求值路径 |
| `PROJECT_SERP_RANK_JUMP` | 每周（F1 Top 100 快照内存匹配后，PRD F10） | 已核验项目凭证的域名 / 商店链接**首次**进入 Top 100 / Top 30 / Top 10，或较上周排名跃升 ≥ `rank_jump_threshold`。**数据来自自身 SERP 管线（F1 一鱼多吃），不依赖 GSC** | 无求值路径 |
| `PROJECT_GSC_TRACTION`（**可选增强**） | GSC 周同步后（**仅对自愿连接 GSC 的用户**） | 关联 Project 的曝光量较上周环比 ≥ `traction_spike_multiplier`（默认 2×）且绝对曝光 ≥ `traction_min_impressions`（默认 100） | 无求值路径 |

**`NEW_ENTRANT` 与"新晋赢家"是两个概念（务必区分）**：

- 代码库中的 `NEW_ENTRANT`（`packages/services/src/alert-triggers.ts`）对应本表的 **`NEW_AUTHORITATIVE_ENTRANT`**——**权威域名**（`OFFICIAL` / `EDITORIAL_MEDIA`）进入 Top10，是竞争加剧信号。
  - **判据落在 `serp_results.result_type`，不是 `domain_authority_class`**。后者（`HIGH_AUTHORITY_GENERIC` / `SPECIALIST` / …）是域名分级，检出的是"维基/亚马逊这类泛权威分流注意力"这另一个信号，两者不可互相顶替。
  - 规范拼写是 `EDITORIAL_MEDIA`；早期草案写的 `MAJOR_MEDIA` 在 `ResultType` 里不存在。
  - "7 天前的快照"实现为**不晚于 `obs_date − 7` 的最近一份**，而不是恰好那一天：采集有缺口时后者查不到对照，会把"没有对照组"误读成"没有新进入者"。取不到对照时不求值（不告警），也不返回 false。
- PRD 的 **`PROVEN_NEW_ENTRANT`**（§1.7.3）指**新独立站**跑通变现（上线不满 6 个月、闯入 Top 5、具备 `COMMERCIAL_TRACTION`），是正向示范，识别规则在 07 §6.4，不在本告警表内实现。二者语义、数据来源、用途都不同，不得互相代替。

- 所有阈值来自 `alert_thresholds` 配置（版本化，同 05 的配置管理方式，但独立于 `scoring_config` 版本流转，因为它不影响评分，只影响是否提醒）。**注意**：该表在 `schema.sql` 中尚不存在（见文首差距表）。
- 触发器求值使用的输入必须是**当日已落账本 / 已入库**的数据，不早于 S6 完成（对 `VERDICT_CHANGED`、`LIFECYCLE_CHANGED`）。
- **`STALE_DATA` 期间不得告警（ADR-021、05 §5.3）**：所有 **Verdict 变化类**触发器（`VERDICT_CHANGED`、`WINDOW_CLOSING_ENTERED`、`LIFECYCLE_CHANGED`）在求值时**必须排除处于 72 小时宽限期的轴**。宽限期内该轴沿用最近一次成功快照的档位、打 `STALE_DATA`，**不得发布降档 Verdict、不得投递降级告警**——偶发采集故障不能被用户读成"竞争格局变了"。只有连续失败超 72 小时、该轴真正置 `INSUFFICIENT` 后，才恢复正常的降档与告警路径。

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
| "只关心我的项目" | `PROJECT_SERP_RANK_JUMP`，`scope = PROJECTS_ONLY`，`IMMEDIATE`（GSC 可选增强：仅当用户自愿连接 GSC 时，可额外订阅 `PROJECT_GSC_TRACTION`） |
| "抢跑提醒" | `CUSTOM_QUERY_PULSE_CONFIRMED` `SLOTS_LAST_ONE` `KILL_CRITERIA_TRIGGERED`，`IMMEDIATE` |
| "每周摘要" | 全部触发器，`WEEKLY` |

每个用户可创建多条 `alert_rules`（不同触发器组合对应不同渠道），无上限但受合理性校验（同一 `(triggers, scope)` 组合 + 同一渠道不可重复创建）。

## 4. 事件产生与去重

### 4.1 `alert_events` 生成
S7 阶段：对每个订阅了相关触发器的用户 × 命中的机会，生成一条候选事件；`dedupe_key` 由业务语义构造，保证幂等与合理去重：

```text
dedupe_key = sha256( user_id ‖ coalesce(opportunity_id, '') ‖ coalesce(project_id, '') ‖ trigger_type ‖ obs_date )
```
- 同一用户对同一对象（机会或项目）的同一触发器同一天只产生一条事件（即使多条 `alert_rules` 都订阅了它，也只生成一条 `alert_events`，由投递阶段决定发到哪些渠道，避免重复通知同一信息）。
- 对于项目级触发器（如 `PROJECT_SERP_RANK_JUMP`，及可选的 `PROJECT_GSC_TRACTION`），必须包含 `project_id`，防止同一用户对同一机会的多个项目发生事件碰撞覆盖。
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
- **套餐联动（PRD §1.7 第 6 条、§8.1）**：`CUSTOM_QUERY_PULSE_CONFIRMED` 建立在"自定义词即时初筛"配额之上——Free 层**终身仅 1 次**、Pro 层**每月 15 次**（Pro 未用完的月度初筛配额支持跨月累计 Rollover）。只有已消耗配额、且被加入 7 天脉冲雷达的初筛词才会产生该触发器；Free 层不支持 7 天雷达，故不会触发它。配额与可用触发器集合的裁决统一由 `EntitlementService`（13）负责，本规格不重复定义。

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
| 某轴处于 72 小时 `STALE_DATA` 宽限期（档位沿用昨日成功快照） | **不**产生任何 Verdict 变化类告警（`VERDICT_CHANGED` / `WINDOW_CLOSING_ENTERED` / `LIFECYCLE_CHANGED`）；连续失败 > 72 小时后才恢复降档告警路径（ADR-021） |
| 机会某形态剩余槽位由 2 变为 1 | `SLOTS_LAST_ONE` 恰触发一次（只在跨过 1 的那一刻，不在"仍为 1"的每一天） |
| 已核验项目凭证由 Top 100 之外首次进入 Top 100 | 触发 `PROJECT_SERP_RANK_JUMP`，依据来自 F1 每周 Top 100 快照的内存匹配，**不读 GSC** |
| 订阅尚未实现求值路径的触发器（`PROVEN_NEW_ENTRANT` / `KILL_CRITERIA_TRIGGERED` / `SERP_WEAKNESS_DROP` 等） | 创建时拒绝，不产生"永远不会触发的规则"（见文首差距表） |
