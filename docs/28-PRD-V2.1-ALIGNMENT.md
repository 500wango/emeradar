# 28 — PRD v2.1 对齐记录与设计定论（PRD v2.1 Alignment）

Status: Approved ｜ Owner: 产品 ｜ Last reviewed: 2026-10-14 ｜ 依赖：01 ｜ 被依赖：无（本文只做导航与决策记录）

**本文是什么**：`01-PRD.md` 升到 v2.1 之后，其余规格文档与新 PRD 之间的差距分析、本次设计拍板的定论索引（D1–D14）、以及逐份文档的修订台账。

**本文不是什么**：本文**不复制任何规格正文**。表结构在 `03`、评分口径在 `05`、权益定义在 `13`、接口契约在 `10`。在这里重写一遍会造出第二份真源，与 `00-INDEX.md` §8「枚举与阈值只有一个定义处」的约定直接冲突。凡本文提到某条规则，读者应当去落点文档读它。

---

## 1. 为什么需要这份文档

本仓库的文档体系以 PRD 为唯一裁决源：`00-INDEX.md` 规定冲突裁决顺序 `01 > 05 > 03 > 其余`，§8 又要求枚举与阈值的修改「先改索引或 05，再改其他文档」。当 PRD 单独演进而下游不动时，代码会继续按旧文档生长——这不是假设，本次盘点就抓到了实例：`DecisionService.record` 只记 GO/PASS、完全没有槽位概念，而 `09` 开头还写着"不是代码生成脚手架"。

因此本次工作的目标不是"把 PRD 抄进十二份文档"，而是让十二份文档与新 PRD **一致**，并把 v2.1 的四个新机制落到可执行的数据模型 / 接口 / 评分 / 计费规格上，使后续实现有唯一依据。

**边界**：本次**只改设计文档**，未触碰 `apps/`、`packages/` 任何代码，未新增迁移。下文第 6 节登记的代码侧偏差留给实现轮次。

---

## 2. PRD v2.1 相对 v2.0 的增量

v2.1 不是修辞更新，它改动了产品的定价前提。六项：

| # | 增量 | 为什么它会波及这么多文档 |
|---|------|--------------------------|
| 1 | **认领导出原子绑定**（§1.7 第 5 条 / F4 / F8）：不点 GO 锁槽不得导出点火包；一次 GO = 扣 1 次月度导出配额 + 占 1 个活跃槽位 + 解锁该形态点火包 | 这是把"防白嫖"从**前端约定**升级为**事务保证**。只要它落在两个事务里，绕过 API 直接调导出就能白拿交付物，定价随之失效 |
| 2 | **处女地独占买断 + Sealed Ledger**（§1.7 第 5 条 / §1.7 第 7 条）：买断仅在 `Σclaimed == 0` 时开放；买断项目照常入账本并计入胜率，但 60 天保护期内前台打码为 `[Stealth Locked #ID]` | 同时影响发布资格、战绩统计口径与隐私边界。**"计入统计但不显示词根"** 这条最容易被实现者理解成"干脆别统计"，而那等于允许用钱买走平台的败绩 |
| 3 | **72h 优雅降级 `STALE_DATA`**（§1.6 / F1.3）：按 源 × 轴 记录最近成功时间；72h 内偶发失败沿用最近成功快照并打标，不置 `INSUFFICIENT`、不发降级告警；连续失败超 72h 才降级 | 把"我们没采到"与"竞争格局变了"分开。混在一起会直接产生垃圾告警，而告警一旦被用户当噪音，整个 F9 就废了 |
| 4 | **快照标签冻结 + 100% 确定性重算**（P5 / P7 / F2）：LLM 只在入库阶段做实体归并与 SERP 结果类型分类，标签作为不可变快照字段永久冻结；重算**严禁**再调 LLM | 没有这条，"100% 可重算"就是空话：模型版本漂移会让同一快照集合算出不同分数，而账本里已经封存了基于旧分的判据 |
| 5 | **收紧项**：Free 每周精选**只能**是刚 `CROWDED_LOCKED` 或刚进 `WINDOW_CLOSING` 的案例；M 轴 High 需并列"非零正增长"以排除僵尸定价站；质押凭证 1 类扩为 3 类；逾期释放槽位**且已扣配额不退** | 第 5 项是 PRD 内部对自身的加严，但它推翻了两条存量写法（45 天延迟、凭证只有域名一种） |
| 6 | **废除 45 天延迟公开**（§7.1）：公开判据从"时间够久"改为"这条机会对付费用户还剩多少抢跑价值" | 见 §3 的 D12。这是本次波及面最广的一处，因为它同时改掉了 15 的资格规则、13 的免费层权益、10 的字段语义与 06 的公开投影口径 |

---

## 3. 设计定论索引（D1–D14）

每条给出**定论**与**唯一落点**。实现时以落点文档为准，本文只解释"为什么这样定"。

| # | 定论 | 落点 | 关键理由 |
|---|------|------|----------|
| **D1** | 槽位按 Build Archetype 切分：新增 `opportunity_slots(opportunity_id, archetype, capacity, claimed)`，默认每形态 `capacity = 2`、全机会 `Σcapacity ≤ 6`。取代现行单一的"每机会 ≤ 5 立项"。W 轴拥挤度取 `Σclaimed` | 03 §8、05 §3.2/§5.1 | 单一上限无法表达"工具站满了但 Micro-SaaS 还空着"。拥挤度必须与真实的占用同源，否则熔断会按一个虚构的数字触发 |
| **D2** | 活跃认领的**唯一**判定：`未归档 且 质押未逾期释放`（即 `projects.status != 'ARCHIVED'` **且** `stake_status != 'EXPIRED_RELEASED'`） | 03 §17、05 §5.1、10 | 现行代码有三处谓词不一致，其中一处用了 `!= 'ABANDONED'`——一个不在 CHECK 约束里的值，等于把归档项目也算成占用 |
| **D3** | **原子 GO**：单事务内完成 `占槽 → 扣月度导出配额 → 建 Project → 解锁该形态点火包`；并发抢同一槽位只有一个成功 | 10 §4.3、13 §4.3 | 见 §2 第 1 项。**这条决定了没有独立的 `POST /projects` 端点**——保留它就是把后门留着 |
| **D4** | GO 仅限 Pro：Free `active_go_slots_max = 0`，只能浏览精选与终身 1 次初筛 | 13 §3.2、20 §6 | 免费层拿到的是"已经没有抢跑价值"的案例，而不是"少一点"的抢跑权 |
| **D5** | **承诺质押**：3 类凭证（独立域名 / 应用商店详情页 / GitHub Release 或公开着陆页）；7 天期限；HTTP 探针校验 `<title>` / `<h1>` / `<meta>` 相关性；逾期或校验失败自动释放槽位，**配额不退** | 03 §12、10 §4.5、09 §8、12 §触发器 | 不退配额是让"占坑"有成本的那一半。只释放槽位的话，用户可以无限"先占住再说" |
| **D6** | **Stealth Lock**：仅 `Σclaimed == 0` 可下单；下单后该机会从所有 Feed 与公开投影消失 60 天；`stealth_locks` 记录窗口与解密时间 | 03 §12、10 §4.5b、15 §3.1、16 §3.3 | "处女地"的定义就是没人碰过。允许在有认领时买断，等于允许用钱把别人已经投入的项目买断 |
| **D7** | **Sealed Ledger**：买断机会照常写 `verdicts` 与 `prediction_episodes` 并**计入 Cohort 统计**；公开投影在保护期内把关键词与实体替换为 `[Stealth Locked #ID]`，期满自动解密 | 06 §6.1、15 §3.1、10 §4.8 | 若把买断记录从统计里剔除，买断者就买走了平台的败绩，战绩页会系统性偏乐观——这从根本上摧毁战绩的可信度 |
| **D8** | **`STALE_DATA` 与 `PARTIAL_DATA` 并列**（不是替代）：处于该状态时不得发布降档 Verdict、不得投递降级告警 | 05 §5.3、02 §5.3、12 §2 | 两件事不同：`PARTIAL_DATA` 是"这条轴本来就没那么全"，`STALE_DATA` 是"这条轴今天没采到，用的是几天前的"。混用会让用户无法判断数据的时效性 |
| **D9** | **快照标签冻结**：SERP 结果类型与实体归并结果在入库时写入不可变快照字段；评分与重算只读快照，重算路径禁止调 LLM | 03 §6、05 §1、08 §4.4 | 见 §2 第 4 项 |
| **D10** | **配额模型重构**：Free 初筛 = 终身 1 次（用哨兵日期 `1970-01-01` 表达"终身"）；Pro 初筛 = 每月 15 次；Pro 原子立项导出 = 每月 5 次且**支持跨月 Rollover（只结转一期）**；新增季度 Builder Pass（不是独立 `plan_code`）与买断商品 | 13 §3.2/§4.2、03 §3、20 §8 | 终身额度用哨兵日期而不是"另一套逻辑"，是为了让它和周期额度共用同一份原子预占代码——第二份并发控制就是第二个 bug 来源 |
| **D11** | **反滥用**：邮箱 Canonical 归一化（剥离 Gmail `+` 别名与 `.`）、一次性邮箱黑名单、GitHub/Google OAuth 强绑定、同设备/IP 30 天 1 次 | 13 §7.1、17 §2.5、03 §2 | 终身 1 次的额度必须有身份成本，否则它就是"注册一次领一次" |
| **D12** | **Free 准实时精选口径**：只取刚 `CROWDED_LOCKED` 或刚进入 `WINDOW_CLOSING` 的已发布机会；**空槽 `BUILD_NOW` 严禁进入公开投影** | 15 §3、20 §6 | 见 §4 |
| **D13** | **Postgres 限流与去重**：Fast Lane 复用 `rate_limit_buckets` 做全局令牌桶；7 天全局去重 = 命中 `serp_snapshots` 中 7 天内的同 `(query, market_country, research_language)` 快照直接复用 | 02 §5.2、04 §4、00-INDEX ADR-017 | 不引入 Redis。去重本质是复用已落库的不可变快照，再加一层缓存反而造出第二份可能与账本不一致的事实源 |
| **D14** | **半遮罩**：Free 初筛结果保留"N 个弱结果 / M 个收钱独立站 / 静态切入难度"，对具体弱结果 URL、竞品域名、15 个长尾词打码；**由服务端决定字段可见性** | 10 §6、16 §3 | 靠前端 CSS 遮罩等于没遮。且打码不能用可数还原的方式（`a***-t***.com` 是能被猜回来的） |

---

## 4. 本次废除与撤销的三项旧决策

| 旧决策 | 处置 | 理由 |
|--------|------|------|
| **45 天延迟公开**（散落在 8 份文档） | **废除** | 旧规则按**时间**决定公开时机，新规则（D12）按**这条机会还剩多少抢跑价值**决定。两端差异都很明显：刚发布三天就满额的机会当天即可公开；放了半年仍空着槽位的 `BUILD_NOW` 永远不公开。旧规则的问题不是"等得久了点"，而是它在保护一个**可能根本不存在**的窗口，同时白白放走了真实的 SEO 与转化机会 |
| **ADR-008**「移除非核心的 AI 编码执行引擎与 MCP 服务」 | **Superseded（被 ADR-019 取代）** | 原决策把两件事捆在了一起：「不内置执行引擎」与「不交付工程规范」。PRD v2.1 只推翻了后者。点火包是**确定性模板装配**（模板 + 已冻结快照 + 占位符注入，LLM 只写 ≤ 500 字叙述），不生成虚构代码正文、不写用户仓库、不调用任何代码执行或 MCP 能力——它不需要 ADR-008 想移除的那套东西 |
| **Merkle 作为前台卖点** | **降级为底栏校验入口** | 前台主打 Cohort Hit Rate & Accuracy Matrix 与事后复盘。密码学存证对用户不是可读的价值主张；而"不能同时列出命中和失误时不得写准确率"这条才是真正建立信任的东西。存证能力保留在后台（06 §1），并在页脚留一个可核对的入口 |

---

## 5. 逐文档修订台账

状态图例：**✅ 已改** ｜ **— 无需改**（本次未涉及其职责范围）

| 文档 | 状态 | 改了什么 |
|------|------|----------|
| `01-PRD.md` | — | 唯一裁决源，本次未改（v2.1 本身即输入） |
| `00-INDEX.md` | ✅ | §1 登记本文档（第 28 行）；§4.3 新增枚举 `plan_code` / `billing_interval` / `purchase_kind` / `slot_state` / `project_status` / `credential_type` / `stake_status` / `stealth_lock_status` / `source_health`，并把 Verdict flags 的定义权归口到 `05 §5.3`；§5 ADR-003 补 Postgres 令牌桶实现说明、ADR-008 标记 Superseded、新增 ADR-017~021；§6 追溯表补齐（F8 拆为报告 + 点火包、§1.7 第 5 条/§1.7 第 6 条/§1.7 第 7 条、F14 反滥用、F1.3 降级）；§7 删除「Free 层延迟天数」待确认项，改为 Builder Pass / 买断定价与社交登录供应商 |
| `02-SYSTEM-ARCHITECTURE.md` | ✅ | §5 补「项目 SERP 排名匹配」（在 S2 Top 100 快照内存阶段完成，零新增请求）与 Merkle 定位改写；§5.1 队列表新增 `release-expired-stakes`、`expire-stealth-locks` 两个作业；**新增 §5.2 双通道管线（Fast Lane / Slow Lane）**（D13）与 **§5.3 72h 优雅降级**（D8）；§9/§11/§13 的一致性修正（Tier A 改 Top 100）。另修正两处指向 `04 §11` 的悬空引用 |
| `03-DATA-MODEL.md` | ✅ | 新增 12 张表（`opportunity_slots` `slot_claims` `stealth_locks` `stealth_lock_displays` `launch_kits` `project_credentials` `project_serp_rankings` `usage_carryovers` `email_identities` `disposable_email_domains` `device_fingerprints` `lifetime_scan_grants`）；改 `subscriptions`(+`billing_interval`/`purchase_kind`)、`usage_counters`(终身哨兵)、`serp_snapshots`(+`depth`)、`serp_results`(标签冻结列)、`domains`(+`established_at`/`established_source`)、`crowding_daily`(按槽位)、`projects`(状态改 3 态 + 质押列)、`public_pages`(+`CASE_STUDY` + 资格判据)；§17 新增不变量 **I10–I14**；§18 记录反滥用标识与注销的留存张力 |
| `04-DATA-SOURCE-REGISTER.md` | ✅ | §2 登记表新增「72h 降级方案」列与来源 `src_domain_established`，`src_gsc` 改为可选增强项，`src_serp` 更名 Top 100；§4 补通道归属、一鱼多吃、7 天去重三行；§6.4 对齐单位经济目标；§9.2/§9.5 改为 Top 100 与 GSC 降级 |
| `05-SCORING-CONFIG-SPEC.md` | ✅ | §1 新增只读冻结标签条款（D9）；§3.2 `crowding_index` 改按形态槽位汇总（D1）；§5.0 宽限期不得触发资格失败；§5.1 槽位耗尽熔断 + `wDroppedWithin` 14 天约束 + WINDOW_CLOSING 三条件 + 认领保护按 D2；§5.3 新增 `STALE_DATA`（D8）并更新 `CROWDED_LOCKED`；§7.1 新增 `slots` 与 `staleness` 配置块；§10 补对应 Golden 测试 |
| `06-PREDICTION-LEDGER-SPEC.md` | ✅ | §1 前台定位（Merkle 降为底栏）；§5 公开投影资格改 D12；**新增 §6.1 Sealed Ledger**（D7）；§7.1 `gsc_traction` 降为可选 + 新增两个 Builder-outcome 事件；§11 Track Record 契约补打码字段与 Cohort 口径 |
| `07-COMMERCIAL-SIGNAL-SPEC.md` | ✅ | §5 新增 `persistentGrowingDomains`；§6.1 `HIGH` 收紧为"有定价 **且** 有正增长"（僵尸定价站过滤）；**新增 §6.4 `PROVEN_NEW_ENTRANT` 判据**（且明确不得用 `first_observed_at` 冒充 `established_at`）；§7 列出三项可采信的正增长观测；§13 补三类验收 |
| `08-LLM-PIPELINE-SPEC.md` | ✅ | §2 新增使用点 U7（点火包叙述，ADR-019）；**新增 §4.4 分类标签冻结与"评分不再调 LLM"边界**（D9）；§6.4 给出 U7 三件交付物与硬约束；§8/§10/§11/§12 同步（队列优先级、评测行、失败退回纯模板、隐私） |
| `09-OPPORTUNITY-REPORT-SPEC.md` | ✅ | §1 改为 F8 **双交付物**定位并写明 ADR-008 边界（删除"不是代码生成脚手架"）；§2 流程图与六原则重写（配额单闸门、原子 GO、多凭证质押）；**新增 §5.3 点火包三件套规格 + §5.4 两交付物对照**；§6 配额改终身/月度/5 次 Rollover 并明确"配额不退"；§7 新增 R9 点火包确定性（rubric 8→9）；§8 改写为原子 GO + 3 类凭证探针 + 无感 SERP 排名追踪 |
| `10-API-SPEC.md` | ✅ | §1.1 错误码重写（新增 `SLOT_TAKEN` / `ACTIVE_SLOTS_EXCEEDED` / `STAKE_REQUIRED` / `STEALTH_LOCK_UNAVAILABLE` / `CREDENTIAL_UNVERIFIED`，并规定买断保护期返回 404 而非 403）；§2 scope；§3 新增 `slots` / `stealth` 字段并删除 `free_delay_days` 语义；§4 新增槽位、候选池、`POST /go`、初筛（含半遮罩）、`/projects/{id}/stake`、SERP 排名、买断等端点，**明确移除独立 `POST /projects`**；§4.7/§4.8/§5/§6/§7/§8 同步 |
| `12-ALERTS-SPEC.md` | ✅ | §2 触发器扩到 12 条并加「实现状态」列（区分有求值路径与创建即拒的），新增 `PROVEN_NEW_ENTRANT` / `CUSTOM_QUERY_PULSE_CONFIRMED` / `SLOTS_LAST_ONE` / `PROJECT_SERP_RANK_JUMP`，补 `STALE_DATA` 期不得告警的硬规则（D8）与 `NEW_ENTRANT` 命名澄清；§3/§4.1/§7/§8 同步 |
| `13-BILLING-RBAC.md` | ✅ | §3.1 套餐表重构（Free 无 GO 权限、PRO 含 Builder Pass、`STEALTH_BUYOUT` 不是 `plan_code`）；§3.2 权益表重写（删 `feed_delay_days`、`deep_report_*`；加 `feed_selected_weekly` / `live_scan_lifetime` / `atomic_go_export_monthly` / `active_go_slots_max` / `launch_kit_export` / `stealth_buyout` / `report_preview_monthly` / `candidate_pool_readonly`），**并把 Free 的 `alert_rules_max` 收紧为 0**（见 §7）；§4.2 终身哨兵 + Rollover；§4.3 调用点表围绕原子 GO 重写；§4.4 废除延迟改为准实时；§7.1/§7.2 反滥用闸门与信号；§10 测试表扩充 |
| `14-INTERNATIONALIZATION.md` | ✅ | 新增 §5.4 点火包本地化边界（说明文字随 `ui_locale`，词表/路由/关键词保持 `research_language`）；§7 补语言边界测试 |
| `15-PUBLIC-SITE-PUBLICATION-SPEC.md` | ✅ | §1 原则重写（公开 = 准实时样本，Merkle 降为底栏，新增买断封印优先）；§2 路由表改名并新增 `/case-studies/[slug]`；**§3 整体重写为准实时精选资格**（D12）并新增 **§3.1 Sealed Ledger 打码投影**（D7）；§3.2 保活策略补横幅不得泄露新窗口；§4 流水线 7 步改 8 步（新增 Cohort 聚合）；§5 新增打码期强制 noindex 行；§6.1/§6.2 战绩口径与 CASE_STUDY 结构化数据 + 打码期 JSON-LD 硬约束；§7/§8 同步（新增"空槽窗口泄露率""买断打码泄露率""Cohort 统计口径完整率"三项 0 容忍指标） |
| `16-FRONTEND-UX-SPEC.md` | ✅ | §2 路由树补 `/screener`、`/case-studies/[slug]`、研报工作室与候选池；§3.1b 补 Fast-Track 文案；§3.2 Feed 补槽位透明与 `PROVEN_NEW_ENTRANT` 徽章，**新增 §3.2b 候选池 Tab**；§3.3 决策栏重写（GO 与 PASS 分层、买断置灰原因、质押倒计时、三种 GO 失败态区分）；§3.5 报告工作台补点火包面板；**§4.1 明确 GO 不得做乐观更新** |
| `17-SECURITY-PRIVACY-OPS.md` | ✅ | 新增 §2.5 反滥用与防白嫖引擎（D11）；§3.1 GSC 改可选增强；新增 §3.5 反滥用标识的留存口径（注销时保留哈希、删除指纹） |
| `18-QA-TEST-STRATEGY.md` | ✅ | §4 新增交付闭环 / 槽位 / 反滥用用例（12 条，含并发抢槽与配额不退）；§6 评测表加 U7；新增 §7.1 点火包评分 L1–L6；E2E 改为原子 GO 与准实时精选页；不变量引用升到 I1–I14 |
| `19-DELIVERY-PLAN.md` | ✅ | §1 运维策略改写（不引入独立缓存 / 中间件，令牌桶与去重走 Postgres）；Epic 1.5 / 1.7 改写；**新增 Epic 1.9–1.15**（点火包、锁槽与原子 GO、两阶段初筛、候选池、质押核验、买断与解密、反滥用）；Gate 1 / Gate 2 判据对齐 PRD §10 |
| `20-COMMERCIAL-RELEASE.md` | ✅ | §3 补 Fast-Track 7 天豁免；§6 套餐表重写（Free / Pro / Buyout，删除 45 天延迟与"每月 30 份报告"，补 Builder Pass 与对赌兜底）；§7 路由口径改准实时精选 + 战绩页补 Cohort 表述 |
| `21-DOCKER-VPS-DEPLOYMENT.md` | ✅ | 明确**不需要 Redis / 缓存容器**及其理由（ADR-017），避免部署脚本先行加容器 |
| `22-EARLY-DISCOVERY-DEVELOPMENT-PLAN.md` | — | 未提及被废除的机制；其"不增加 Redis、常驻浏览器集群或多 worker 框架"与 ADR-017 一致，无需改动 |
| `23-COMPETITIVE-EVOLUTION-AND-EXECUTION-PLAN.md` | ✅ | 清除第 118 行「45 天窗口期」文案残留；`/ledger` 公开战绩大盘更名为 Cohort Hit Rate & Accuracy Matrix |
| `24-PRODUCT-IMPROVEMENT-PLAN.md` | ✅ | 顶部新增与 v2.1 的关系说明（历史轮次不回溯改写，新轮次以本文为准）；清除 `feed_delay_days=45` 残留；GSC 表述降为可选 |
| `25-BACKUP-AND-RESTORE.md` | ✅ | 恢复演练抽查表补 `opportunity_slots` / `slot_claims` / `stealth_locks`（有状态、丢了无法重算），并说明新表由整库 `pg_dump` 自动覆盖 |
| `26-SECURITY-AUDIT.md` | ✅ | §5.2 登记反滥用属应用层机制、不在本轮主机审计范围内，并给出落地后需实测的验证点 |
| `27-SEO-BASELINE.md` | ✅ | §5 补 `/case-studies/[slug]` 待纳入站点地图、候选池与 `/screener` 必须继续 noindex；澄清"产品内 GSC 降级"与"运维侧提交站点地图"是两件事 |

---

## 6. 一并修正的存量缺陷

本次盘点在代码里抓到四处与新 PRD 冲突的既有缺陷。按"只补设计文档"的范围，**代码未改**，但这些缺陷的统一判据已经写进规格，实现时以规格为准。

| # | 缺陷 | 现状（代码） | 规格给出的唯一判据 |
|---|------|--------------|--------------------|
| 1 | **槽位计数谓词不一致** | `project.service.ts:570` 用 `status != 'ARCHIVED'`；而 `observe-opportunity.ts:465` 与 `opportunity.service.ts:286/400/474` 用 `status != 'ABANDONED'`——`ABANDONED` 不在 `projects.status` 的 CHECK 约束内（合法值为 `IN_DEVELOPMENT` / `LAUNCHED` / `ARCHIVED`），因此该条件恒为真，等于把归档项目也算作占用 | **D2**：`未归档 且 质押未逾期释放`，落点 03 §17、05 §5.1 |
| 2 | **`WINDOW_CLOSING` 缺「14 天内」约束** | `prev.wBandHistory` 是无日期的档位数组，降档可能来自任意久远的历史；此外还有 CROWDED_LOCKED 与自持两条旁路 | 05 §5.1 的 `wDroppedWithin(prev.datedWBandHistory, 14)` 与三条件；05 §10 补 Golden 测试。**注（2026-10-14 补记）：这条只欠评分侧**——发布层（`15 §3 第 1 条`）已改为读 `verdicts` 的连续段起始日，正是为了绕开这个无日期数组，故公开准入**不**被本条阻塞 |
| 3 | **`NEW_ENTRANT` 是显式的空实现** | `alert-triggers.ts` 明确标注未实现；12 的触发器表里它连求值路径都没有 | 12 §2 拆分为 `NEW_AUTHORITATIVE_ENTRANT`（旧名 `NEW_ENTRANT`）与新的 `PROVEN_NEW_ENTRANT`，并逐条标注实现状态 |
| 4 | **`POST /projects` 可绕过 GO** | `createProject` 在 `decisionId` 缺失时会**替用户插一条 GO**（理由写死 `Direct project initiation`），使 `decisions` 表里躺着用户从未表达的意图 | **D3**：10 §4.5 明确不再提供独立建项目端点；`decisions.verdict_id` 必填且钉住用户实际读到的那一行（该修复已由 16 §5.5 记录并落地） |

---

## 7. 本次发现、但尚未裁决或尚未实现的偏差

如实登记，避免下一轮重新发现：

1. **Free 告警权益的 PRD / 13 张力——已在本次裁决**。PRD §8.1 的免费层能力清单写"自动化追踪与告警：不支持"，而 `13 §3.2` 曾给 `alert_rules_max = 1`（仅 DAILY digest）。按 `00-INDEX` 的裁决顺序（`01 > 05 > 03 > 其余`），**以 PRD 为准**，13 已收紧为 `0` 且 `alert_channels = []`。记在这里是因为它是一次**跨文档的实质权益变更**，不是笔误。
2. **`build_type` 枚举与实现值不一致（未改，属代码侧）**。`00-INDEX` §4.3 的 `build_type` 与 `05 §11.2` 的排序表用 `TOOL` / `CONTENT_SITE` / `PSEO_SITE` / `DIRECTORY` / `MICRO_SAAS`（+ Phase 2 两项），而代码在 `packages/scoring/src/recommendation.ts` 等处产出并落库 **`LIGHTWEIGHT_TOOL`**——一个不在枚举里的值。本次把 `09` 的示例与 R5 改为规范取值，但**代码侧的迁移未做**。这条必须在实现轮次处理：槽位与点火包模板都要按 `archetype` 取键，若同一个形态在文档里叫 `TOOL`、在库里叫 `LIGHTWEIGHT_TOOL`，槽位容量会被**静默地分裂成两套**，`Σcapacity ≤ 6` 的约束也就形同虚设。
3. **PRD 正文的队列技术举例与仓库实现不符**。PRD F1.2 举例写 BullMQ，仓库实际是 **pg-boss v12**。已在 02 §5.2 明确以 pg-boss 为准（ADR-003 未变），不需要推翻任何决策。
4. **买断保护期的公开投影对"已存在页面"的处理依赖 S8 的同一次运行**。15 §3.1 要求"买断生效的同一次 S8 运行中把该页切换为打码投影"，因此下单事务与 S8 之间存在一个最长约一天的窗口。这不是缺陷（页面此刻仍是旧数据、没有泄露新事实），但实现时必须确保**打码切换与 CDN 缓存刷新是同一步**，否则会出现"库里已打码、CDN 仍可查"的假安全。18 §4.1 已有对应用例。

**以下第 5–12 条由 D12 的实现轮（公开站准入判据换成"还剩多少抢跑价值"）发现并登记；第 5–7 条与本轮的判据直接相邻，故先登记。都未改。**

5. **`PUBLIC_DELAY_DAYS = 45` 仍在公开战绩上生效，且注释引的是已废除的规则（未改，属代码侧）**。`packages/services/src/track-record.service.ts:75` 的这个常量把 `prediction_episodes` 的公开披露压后 45 天，而 `:80` 的注释自述是"与 `public_pages` 用的是同一个 45 天禁售期"——那个禁售期已由 PRD §7.1 废除，本轮把公开页的准入整条换掉了，**但战绩页仍是旧口径**。两者用的是同一条已死规则的两半，于是会出现"机会页当天可公开、它的战绩却要等 45 天"。**不能顺手一起改**：战绩披露延迟防的是"提前暴露预测结果"，与公开页防的"泄露抢跑窗口"不是同一件事，是一条**独立的产品决策**（披露延迟多长、是否与 `evaluate-episodes` 的 30 天结算窗口对齐），须单独裁定。
6. **`isCrowdedLocked` 的喂入与 05 §5.1 / ADR-018 不一致（未改，本轮已绕过）**。规格定义 `Σclaimed == Σcapacity` 时置位，而代码今天的喂入是 `COUNT(*) FROM projects` 对比常量 `MAX_CLAIMS_PER_OPPORTUNITY = 5`（`observe-opportunity.ts`、`opportunity.service.ts`、`claim-policy.ts`）。这正是 §6 第 1 条那条计数谓词的同一处，而 `0003` 的迁移注释已**明令禁止**再按 `projects.status` 推导"谁占着槽"。修它会同时动评分与账本，属独立一轮；本轮 §3 条件①**直读 `opportunity_slots`** 绕过了它，因此准入口径是对的、而 `CROWDED_LOCKED` 这个标志本身仍是错的。
7. **`crowding_daily` 是死表**。03 建了它（按槽位），`packages/` 下**零引用**：从不写入、从不读取。它是"按形态切分槽位"那轮的遗留物，实际的槽位真源是 `opportunity_slots`。
8. **`public_pages.page_type` 的文档取值多于实际约束**。03 的 `public_pages` DDL 列 8 个取值（`OPPORTUNITY` / `MARKET` / `TREND_ENTITY` / `REPLAY` / `REPORT` / `COMPARE` / `TRACK_RECORD` / `CASE_STUDY`），而 `schema.sql` 的 CHECK 只有 4 个（`OPPORTUNITY` / `TRACK_RECORD` / `METHODOLOGY` / `MARKET`）；15 §2/§3.1 还引用 `CASE_STUDY`（§3.1 第 4 条要求买断期满以它重建案例页）与 `COMPARE`。同时 `/markets/[slug]`、`/case-studies/[slug]`、`/compare/[slug]` 三个公开路由**不存在**（实际只有 `/public/opportunities/[slug]` 与 `/track-record`）。改 CHECK 要动枚举，须先走 `00-INDEX` §4.3。
9. **S8 的排期时刻文档与代码不一致**。02 §5 的调度表把 S8 排在 **06:00**、SLA 写"S1–S8 于 06:30 UTC 前完成"，而代码里含 S8 发布循环的 `run-daily` 排期是 `30 3 * * *`（`apps/worker/src/tasks.ts:96`）。不影响正确性（发布在账本写入之后，见 `pipeline.ts`），但调度表对不上就会让"为什么凌晨三点 CPU 高"这类问题查错方向。
10. **10 §4.8 的 `GET /public/opportunities/{slug}` 端点不存在**。`apps/web/src/app/api/v1/public/` 下只有 `track-record` 与 `verify-ledger`；公开页是服务端渲染的 HTML 路由，`eligibility` 取出后**未渲染任何字段**。因此"公开接口只承诺 `reason` 与 `decided_at`"这句今天没有载体——它约束的是一个还没写的接口。
11. **15 §8 的监控指标一个都没实现**。§8 那三项 0 容忍指标（"空槽窗口泄露率""买断打码泄露率""Cohort 统计口径完整率"）**没有采集点**，本轮为 §3 新增判据准备的护栏是**测试**而非监控。上线后至少应给 `CANNIBALIZATION_DATA_MISSING` 加一个计数：它把"SERP 快照覆盖不足"从沉默的阻断变成可见指标。
12. **公开投影没有"按需生成 / 全量重建"入口**。唯一入口是 S8 每日循环与买断侧 `refreshProjection`（`stealth-lock.service.ts` 经 `expire-stealth-locks` 调用）。因此判据变更**不会回填重评**历史 `public_pages` 行——只有下次 S8 覆盖到的机会才会按新判据改写。上线的第一天，库里存量的 `eligibility` 仍是旧口径写下的。

---

## 8. 未决事项

按 PRD §12.5 的口径，以下留待 Phase 0，**本次不锁定数值**：

1. **Stealth Buyout 单次买断与季度 Builder Pass 的最终美金定价**（决定 13 §3.2 与 20 §8 的具体数字）。文档中的额度是初始假设，须由预售访谈校准。
2. **社交登录供应商（GitHub / Google）与设备指纹的具体实现方案**（决定 13 §7.1 与 ADR-015 的 Auth.js provider 配置）。
3. **点火包模板的版本化与存放方式**：`template_version` 是点火包确定性的一部分（09 §5.3），但模板放在仓库里还是数据库里尚未定。
4. **`established_at` 的来源供应商**（`src_domain_established`，04 §2）：WHOIS 还是第三方 API，决定 07 §6.4 的 `PROVEN_NEW_ENTRANT` 判据能覆盖多少域名。**在来源确定前，该判据必须按"来源为空即不升级"执行**，不得用 `first_observed_at` 兜底。

---

## 9. 验证方式与结果

机械校验（基线在改动前核对过，结果为改动后复查）。下表的命中统计**一律排除本文**——本文作为对照记录必然引用这些字符串本身。

| 检查 | 基线 | 结果 |
|------|------|------|
| `grep -rln "45 天\|45-day\|free_delay_days\|feed_delay_days" docs/`（排除本文） | 8 份（`00` `10` `13` `15` `20` `23` `24` + `01`） | ✅ 仅剩**「已废除」语境**的显式说明（01 与 06/09/10/13/15/19/20/24 的废除声明）。无一处仍在**规定**行为 |
| `grep -rn "k-anonymity" docs/`（排除本文） | 仅 `01-PRD.md:213` | ✅ 仍仅此一处，且原文即"不再使用 k-anonymity 隐藏" |
| `grep -rn "不是代码生成脚手架\|不做虚构代码" docs/`（排除本文） | `09` 第 12 行 | ✅ 已清零。`09` §1 改为双交付物定位 + ADR-008 边界说明 |
| 枚举唯一性 | — | ✅ `00-INDEX` §4.3 是唯一定义处。新增的 `slot_state` / `credential_type` / `stake_status` / `stealth_lock_status` / `source_health` 无第二处定义；Verdict flags 定义权明确归口 `05 §5.3` |
| 交叉引用可解析 | 存在 `04 §11` 悬空引用（04 只有 §1–§9） | ✅ 已改为 `04 §4.4`；全库 `NN §X.Y` 形式的引用已用脚本遍历核对，除本文的对照记录外无未解析项 |
| PRD 引用形式 | 早期写法用 `01 §1.7.5` / `PRD §1.7.6` 等**不存在的编号**——PRD 的 §1.7 是一个 1–7 的**编号列表**，没有 `1.7.5` 这样的标题 | ✅ 全库统一为 `01 §1.7 第 5/6/7 条`（共 34 处，涉及 14 份文档）。这是本仓库文档体系里最容易复发的引用错误：PRD 用列表编号、其他文档用标题编号，两者形似而不同 |
| 追溯闭合 | — | ✅ `00-INDEX` §6 追溯表的每个 F 编号都有主文档；§1.7 第 5 条/§1.7 第 6 条/§1.7 第 7 条、F1.3、F14 均已登记，与本文 §5 台账一致 |
| `git diff --check` | — | ⚠️ 仅 `01-PRD.md` 第 3–4 行报尾随空格。**这两处是 Markdown 硬换行（行尾两个空格），是 PRD 作者的刻意写法**，且 `01-PRD.md` 本次未被修改；本文与其余文档无空白错误 |

---

## 10. 本次不做的事

- **不改任何 `apps/`、`packages/` 代码**，不新增数据库迁移。第 6、7 节的代码侧偏差留给实现轮次。
  - **例外（2026-10-14 补记）**：D12 的**实现**已单独落地一轮——`docs/15 §3` 的公开站准入判据已由 `T+45 天延迟` 换成"还剩多少抢跑价值"，含 `publication-policy.ts`、`0008_public_pages_indexes.sql` 与 `18 §4.1` 的新用例。该轮**只动 D12**：第 6 节与第 7 节其余各条（`build_type` 枚举、槽位计数谓词、`PUBLIC_DELAY_DAYS`、`isCrowdedLocked` 喂入……）**一条都没碰**，仍在等待各自的轮次。
- **不引入 Redis**（ADR-003 保持有效，实现方式按 D13 写明）。
- **不恢复 AI 编码执行引擎**：点火包是确定性模板装配 + 受约束文本生成，与 ADR-008 当年移除的执行引擎不是同一样东西（ADR-019）。
- **不锁定供应商与具体定价**：留待 Phase 0（见 §8）。
- **不回溯改写 `24-PRODUCT-IMPROVEMENT-PLAN.md` 的历史轮次**：那份文档按当时的 45 天延迟与 GSC 必选口径写成，结论在当时成立；v2.1 的新轮次以本文为准，历史条目不再逐一改写，避免制造"这份文档到底哪个版本对"的混乱。
