# 24 — 产品改进与交付计划

Status: Active 2026-10-11 ｜ 目标：把“机会证据验证器 → 决策 → 项目结果回流”收敛为可交付的首发闭环。

> **与 v2.1 的关系**：本文记录的是 PRD v2.1 之前的**历史轮次**（P0/P1 修复与验收清单），其结论按当时的 45 天延迟与 GSC 必选口径写成。PRD 升到 v2.1 后的差距分析与逐文档设计定论（D1–D14）见 `docs/28-PRD-V2.1-ALIGNMENT.md`；本文的历史条目不再逐一回溯改写，v2.1 的新轮次以 28 为准。

## 1. 目标与非目标

### 目标

- 任何用户看到的报告、GO 和项目都必须绑定已发布的 `BUILD_NOW` 或 `EARLY_BET` verdict。
- Free、Pro 的信息流延迟、报告生成、报告导出和项目额度必须与页面、seed、API 采用同一份权益契约。
- Watch 必须可重复点击而不产生重复规则，并可在告警页删除。
- Project 页必须能标记上线；GSC 连接为**可选增强项**（连接后可选 property 并显示状态，未连接不影响核心的自身 SERP 排名追踪）。
- 首页只表达已观测到的事实，不把支付基础设施、哈希或示例数据说成收入证明。

### 非目标

- 本阶段不重写报告生成器、不增加新的数据源、不承诺收入或成功率。
- Team workspace、多席位和开放 API 不属于本产品当前范围；Compare、四步 onboarding、Feed 服务端分页、报告快照隔离、密码 reset、邮箱验证闭环，以及本轮全局跳过导航、Settings、Navbar、Live Scanner、证据列表和后台候选/采集源控件修复已落地。

## 2. 发布阻断项（P0）

| 项目 | 当前风险 | 完成标准 |
|---|---|---|
| Verdict gate | Candidate/Watch 可进入报告或项目 | 服务层和页面同时拒绝；只有 `TRACKED + BUILD_NOW/EARLY_BET` 放行 |
| Report lifecycle | 打开报告误扣导出额度 | 生成使用 `GENERATE_REPORT`；导出只在 Pro 执行导出权限校验 |
| Feed entitlement | Free 被当成实时用户 | Free 仅见每周 1 条准实时精选案例（`CROWDED_LOCKED` / `WINDOW_CLOSING`）与候选区只读，Pro 见全量实时 Feed；`feed_delay_days` 延迟模型已废除 |
| Watch | 重复规则、无法取消 | 同一用户/机会/规则类型幂等；告警页可删除 |
| Project / GSC（可选） | 用户无法完成上线 | 项目页有状态切换；GSC 为**可选增强项**，提供 OAuth 入口、property 选择和断开入口，未连接不阻塞核心 SERP 追踪 |
| Evidence copy | Stripe/hash 被包装成商业实证 | 首页使用 `observed pricing/checkout exists`，明确不证明收入 |
| Pricing source | seed、UI、checkout 价格不一致 | 公开产品只保留 Free 与 Pro；Pro 为 `$29/mo`、`$290/yr`，另有 `$399` Founding Lifetime 一次性方案 |

## 3. 实施顺序

### Sprint 1：信任与权限（本轮）

1. 修正 `ReportService`、`DecisionBar`、`ProjectService` 的发布资格门控。
2. 增加独立报告生成计数器，修正 Free 延迟和 seed 权益。
3. 修正首页和报告 paywall 文案，删除合成 hash/Stripe 证明。

### Sprint 2：行动闭环

1. Watch 幂等创建、删除 API 和管理 UI。
2. Project 状态更新、GSC 连接状态、property 选择和断开 UI。
3. 用事务 advisory lock 保护机会认领槽位。

### Sprint 3：激活与可用性（P1，部分完成）

1. 已完成注册后 onboarding，并保存出货形态、研究市场、时间预算和关注主题。
2. Feed 筛选状态进入 URL 并完成服务端分页；Compare 已支持从 Feed 选择 2–3 个已发布机会，并按统一维度并排比较。
3. 已完成邮箱验证：注册后发送 24 小时一次性链接，账户设置可限流重发；登录、Feed 浏览和机会比较保持可用，但报告生成/导出、正式决策、项目、告警、API key 和 checkout 要求已验证邮箱。密码 reset 已完成，登录/注册/密码恢复、Feed 筛选分页、onboarding、Watch/Project/GSC/site-check，以及本轮 Settings、Navbar、Live Scanner、证据列表和后台治理控件已补齐表单关联、可见焦点、按钮类型、跳过导航和关键异步状态语义。剩余页面仍需后续巡检。

## 4. 验收清单

- Candidate 无论 Free、Pro 都不能生成报告、导出或 GO；历史 Team 账户沿用同一发布资格门槛。
- Free 用户只看到每周 1 条准实时精选案例（`CROWDED_LOCKED` / `WINDOW_CLOSING`）与只读候选观察区；Pro 看到实时已发布决策和候选观察区。
- 报告页面首次打开不会计入导出额度；Free 预览不能导出；Pro 导出权限按套餐生效。
- Watch 重复点击返回已有规则，删除后可以再次关注。
- GO 使用准确的 `verdict_id` 创建项目；项目可切换 `IN_DEVELOPMENT/LAUNCHED`，并显示 launch date。
- GSC OAuth 未配置时显示明确配置状态，不把 URL 格式校验说成已授权。
- Feed 的 verdict、archetype、execution class、search 和 offset 状态可由 URL 重现，分页不再只截取首 10 条。
- 同一用户同一机会的报告缓存必须同时匹配最新 `snapshot_id`、`verdict_id` 和 locale；生成报告不增加 export 计数。
- 密码恢复接口对已存在和不存在邮箱返回相同结果；reset token 只存哈希、30 分钟过期、只能消费一次，并在成功后撤销全部旧 session。
- 首页没有收入、销售量、预测准确率或固定 hash 的未经证实表述。
- `pnpm test`、services 测试、Web build、`git diff --check` 通过。
- Free 套餐的导出额度为 `0`，可访问每周 1 条准实时精选案例；服务测试已与 seed/schema 契约对齐，Pricing 页对零额度使用安全分母，避免 `0/0` 产生无效进度宽度。
- Pricing 与 Settings 已将 `GENERATE_REPORT` 和 `EXPORT_REPORT` 分成两个可见额度指标；用户不再把“生成在线报告预览”和“导出文件”误读为同一件事。
- Compare 已新增 `/compare?ids=...` 页面和 `POST /api/v1/opportunities/compare`；仅接受 2–3 个 `TRACKED`、`BUILD_NOW/EARLY_BET`、非 `LOW` 机会，并沿用用户的 Feed 延迟。
- 邮箱验证已新增 `/verify-email`、`POST /api/v1/auth/verify-email` 和 `POST /api/v1/auth/resend-verification`；token 仅存 SHA-256 哈希、24 小时过期且一次性消费。未验证用户仍可登录、浏览和比较，但高价值动作统一返回 `EMAIL_VERIFICATION_REQUIRED`，账户设置提供重发入口。
- 无障碍切片已补充根布局跳过导航；Settings 使用 `tablist/tab/tabpanel` 和关联 ID，账户信息/API key 输入具备 label、name、autocomplete；证据卡片改为可聚焦 button；Live Scanner、Navbar、候选池、采集源管理、追踪申请和告警删除补齐标签、焦点、按钮类型与异步状态语义。

## 6. 明确移除的范围

Team workspace、多席位协作、团队邀请和开放 API 从当前产品路线移除。产品只服务独立开发者的个人工作流：发现机会、验证证据、做出决策、启动项目并回流结果。

数据库与服务层暂时保留 `TEAM` 枚举和历史订阅兼容，原因是兼容既有数据和后台审计；它不代表当前存在 Team workspace，也不产生公开购买入口。任何新功能不得依赖 `TEAM` 才能成立。

## 5. 风险与回滚边界

- 本轮只修改应用规则、文案和非破坏性 schema/index 定义，不删除用户项目、告警或账本记录。
- 已有 Free/Pro 用户的数据库订阅不自动迁移；部署前需运行计划中的 entitlement 数据校验，发现旧套餐价格时由运营决定是否迁移。
- GSC 真实 OAuth 依赖供应商配置；未配置时产品只展示未连接状态，不伪造成功。
- 邮件验证依赖邮件通道已在运行环境配置：`SMTP_HOST`+`MAIL_FROM`（自建邮件服务器或任何 SMTP 服务商），否则 `RESEND_API_KEY`+`MAIL_FROM` 兜底；未配置时注册仍完成，但用户必须先配置邮件投递再完成验证，应用不会把“已调用发送接口”当作送达证明。
