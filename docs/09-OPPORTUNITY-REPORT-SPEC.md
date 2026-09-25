# 09 — 机会研究与商业分析报告规格（Opportunity Report Spec）

Status: Approved ｜ 依赖：00-INDEX、01 F8、05、07、08 ｜ 被依赖：10、13、16

---

## 1. 目的与定位

机会研究与商业分析报告（Opportunity Research Report）把一个经过验证的高价值搜索机会（`BUILD_NOW` 或 `EARLY_BET`），转化为一份**权威、客观、结构化且数据密集的商业决策卷宗**。

**核心定位**：
- **不是代码生成脚手架**：我们不做长篇累牍、容易漂移的虚构代码和架构生成；开发者有自己成熟的开发环境与工具链（Cursor, Claude Code, v0 等）。
- **是出海 Builder 的立项验资机与决策备忘录**：它直接回答“为什么值得做、商业变现的真实底线在哪里、SERP 留下的具体切入空隙是什么、做成什么形态阻力最小、什么情况下必须立刻止损”。
- **全链路业务闭环**：打通从“机会发现 → 配额锁扣 → 确定性证据装配 + 决策备忘生成 → 多格式导出 → 一键立项 → GSC 战绩核销”的完整商业流。

---

## 2. 业务逻辑全景闭环

```mermaid
flowchart TD
  subgraph User[用户端体验]
    A[浏览 Feed / Detail] --> B[点击 生成/导出机会分析报告]
    B --> C{Entitlement 校验}
    C -->|配额不足| C1[提示升级 Pro/Team 套餐]
    C -->|配额充足| D[预扣配额 Hold 状态]
    D --> E[异步生成任务排队]
    E --> F[查看交互式报告 / 导出]
    F --> G[一键立项: Create Project]
    G --> H[上线并绑定 GSC]
  end

  subgraph System[系统管线]
    E --> S1[S4 快照冻结数据装配 (确定性 90%)]
    S1 --> S2[LLM U5 生成决策备忘 (轻量 ≤500字)]
    S2 --> S3{事实校验与占位符渲染}
    S3 -->|失败 ≤2次重试| S2
    S3 -->|终态成功| S4[写入 opportunity_reports 状态 READY]
    S3 -->|终态失败| S5[状态 FAILED / 释放配额 Release]
    S4 --> S6[正式扣除配额 Commit]
    H --> S7[战绩追踪与 Prediction Ledger 核销]
  end
```

### 业务闭环五大原则：
1. **计费与配额闭环**：采用 Hold & Release 预扣机制。生成开始前原子锁定额度，生成成功后 `Commit`；若生成失败或校验丢弃，自动 `Release` 退回配额。
2. **数据确定性闭环**：报告 90% 的内容（D-M-W 拆解、关键词图谱、SERP 弱结果列表、竞品真实价格）直接从每日已封存的 `opportunity_snapshots` 确定性拉取，杜绝 LLM 幻觉。
3. **轻量决策备忘（LLM U5）**：仅由 LLM 输出 ≤ 500 字的高管决策备忘（Why Now、目标客群画像、差异化切入点、风险评级），且所有硬事实强制绑定证据占位符。
4. **幂等与多格式导出闭环**：同一用户在同一数据快照日对同一机会的请求完全幂等，已生成的报告直接复用；支持 Markdown、JSON、PDF 三种格式导出。
5. **立项与战绩核销闭环**：报告底部直接提供“基于此机会立项”操作，自动关联 `projects` 表与 `opportunity_id`，用户上线后接入 GSC 数据，反哺公开预测账本（Prediction Ledger）。

---

## 3. 报告数据结构规范（`schema_version = 1.0`）

报告顶层 Schema 位于 `packages/report/schema/report-1.0.json`：

```json
{
  "schema_version": "1.0",
  "report_id": "rpt_01J...",
  "opportunity_id": "opp_01J...",
  "user_id": "usr_01J...",
  "snapshot_id": "snp_01J...",
  "obs_date": "2026-10-01",
  "scoring_config_version": "sc-1.0.0",
  "locale": "zh-CN",
  "market_country": "US",
  "research_language": "en-US",
  "verdict": "BUILD_NOW",
  "recommended_archetype": "LIGHTWEIGHT_TOOL",
  "execution_class": "S",
  "scores": {
    "d_basis_points": 8200,
    "m_basis_points": 7600,
    "w_basis_points": 8800,
    "confidence": "HIGH"
  },
  "sections": {
    "executive_summary": {},
    "demand_intelligence": {},
    "commercial_evidence": {},
    "serp_weakness_audit": {},
    "strategic_archetype": {},
    "risk_and_kill_criteria": {}
  },
  "citations": {
    "F1": { "type": "SERP", "snapshot_id": "snp_...", "rank": 3, "url": "https://..." },
    "F2": { "type": "PRICING", "evidence_id": "evd_...", "domain": "competitor.com", "price": "$19/mo" }
  },
  "metadata": {
    "generated_at": "2026-10-01T04:35:10Z",
    "generation_duration_ms": 2180,
    "export_count": 0,
    "last_exported_at": null
  }
}
```

---

## 4. 报告六大核心分析板块规范

标注：**[D]** 确定性装配；**[L]** LLM 生成（U5，遵循 08 §6 引用规则）；**[D+L]** 确定性骨架 + LLM 提炼。

### 4.1 §1 Executive Summary（决策备忘录）[L]
- **目标**：30 秒内向创业者/Builder 阐明核心战略逻辑。
- **字段**：
  ```json
  {
    "one_sentence_verdict": "强需求已形成且存在明显 SERP 弱点，但商业变现需保持轻量工具定位以控制获客成本。",
    "why_now": "近 30 天内搜索需求突破临界点，SERP 前三名被 2022 年过时论坛帖占据，大厂尚未介入。",
    "target_persona": {
      "who": "海外中小独立电商卖家 / Shopify 运营人员",
      "pain": "手动计算退税和运费分摊耗时且极易出错",
      "urgency": "每月报税周期前集中高频搜索"
    },
    "core_value_prop": "极简免登录的专用计算器，一键生成符合当地税局要求的报表。"
  }
  ```
- **约束**：必须基于 `[D]` 提供的真实数据，严禁凭空产生无证据支撑的宏大商业叙事。

### 4.2 §2 Demand Intelligence（需求图谱与搜索意图）[D]
- **数据源**：`autocomplete_observations` 与 `query_clusters`。
- **字段**：
  ```json
  {
    "primary_query": "shopify tax calculator free",
    "search_intent": "TRANSACTIONAL",
    "demand_trajectory": "ACCELERATING",
    "cluster_keywords": [
      {
        "query": "shopify tax calculator free",
        "intent": "TRANSACTIONAL",
        "priority": "P0",
        "volume_tier": "HIGH",
        "first_observed": "2026-08-15"
      },
      {
        "query": "how to calculate shopify sales tax by state",
        "intent": "INFORMATIONAL",
        "priority": "P1",
        "volume_tier": "MEDIUM",
        "first_observed": "2026-09-02"
      }
    ],
    "seasonal_notes": "无明显周期性波动，全年稳定"
  }
  ```

### 4.3 §3 Commercial Evidence（商业变现底线与证据）[D+L]
- **数据源**：`commercial_snapshots` 与 `evidence`。
- **字段**：
  ```json
  {
    "m_score_grade": "HIGH",
    "monetization_stage": "PRICED",
    "observed_pricing": {
      "median_monthly_usd": 19.00,
      "price_range": "$9/mo - $49/mo",
      "free_tier_present": true,
      "evidence_cite": "F2"
    },
    "payment_infrastructure": ["STRIPE", "PADDLE"],
    "recommended_routes": [
      { "route": "SAAS_SUBSCRIPTION", "grade": "PRIMARY", "rationale": "同类独立工具均有稳定月度订阅模型" },
      { "route": "ADS_AFFILIATE", "grade": "SECONDARY", "rationale": "可挂接会计软件 Affiliate 链接" }
    ],
    "what_this_proves": "证明已有 3 家独立产品在此领域设置公开定价页并接入真实支付网关。",
    "what_this_does_not_prove": "不证明竞品的具体 MRR 或真实净利润率，需谨慎测算自身流量转化率。"
  }
  ```
- **红线**：严禁把推测数据包装成事实；若 M 轴为 `LOW`，必须醒目标注“商业化真实性待进一步测试”。

### 4.4 §4 SERP Weakness Audit（竞争格局与搜索断层）[D]
- **数据源**：`serp_results` 与 `serp_weakness_audit`。
- **展示 Top 10 SERP 穿透证据**：
  ```json
  {
    "w_score_grade": "HIGH",
    "weak_result_ratio": 0.60,
    "weaknesses_identified": [
      {
        "rank": 1,
        "domain": "reddit.com",
        "weakness_type": "UGC_FORUM",
        "title": "Anyone know a good tool for shopify tax?",
        "published_at": "2022-04-10",
        "citation": "F1"
      },
      {
        "rank": 3,
        "domain": "outdated-blog.org",
        "weakness_type": "STALE_CONTENT",
        "title": "5 Tips for Tax in 2021",
        "published_at": "2021-11-03",
        "citation": "F3"
      }
    ],
    "authoritative_competitors": []
  }
  ```

### 4.5 §5 Strategic Archetype & Build Angle（推荐构建形态与切入策略）[D+L]
- **字段**：
  ```json
  {
    "recommended_archetype": "LIGHTWEIGHT_TOOL",
    "execution_class": "S",
    "estimated_mvp_days": "3-5 天",
    "core_differentiator": "针对论坛用户反映的‘老旧工具不支持 2026 新州税率’，以‘实时最新税率 + 免注册即用’作为核心切口。",
    "suggested_pages": [
      { "path": "/", "purpose": "核心免登录计算器主界面，提供立即可用的交互体验" },
      { "path": "/by-state", "purpose": "按各州税率索引的落地页合集，承接长尾搜索意图" },
      { "path": "/faq", "purpose": "解答报税高频常见问题，建立信任与 Schema 结构化数据" }
    ]
  }
  ```

### 4.6 §6 Risk & Kill Criteria（风险清单与止损红线）[D]
- **直接映射系统中的 Kill DSL（12）**：
  ```json
  {
    "active_kill_rules": [
      {
        "rule_code": "NEW_AUTHORITATIVE_ENTRANT",
        "threshold": "Shopify 官方或 Intuit 推出同名原生内置功能并进入 SERP Top 3",
        "action": "立即停止投放与迭代，转入长尾维护或放弃"
      },
      {
        "rule_code": "W_SCORE_COLLAPSE",
        "threshold": "SERP 弱结果比例跌破 20%（竞争者大量涌入）",
        "action": "审视是否已有先发 SEO 优势，若无则停止进一步投入"
      }
    ],
    "disclaimer": "本报告基于截至 2026-10-01 的公开市场观测数据生成，不构成投资或商业回报保证。"
  }
  ```

---

## 5. 导出规格与交付形态

### 5.1 导出格式一览

| 格式 | 用途 | 交付方式 |
| :--- | :--- | :--- |
| **Markdown (`.md`)** | 开发者个人笔记（Notion / Obsidian）、直接作为自有提示词或 PRD 上下文 | 一键复制到剪贴板；下载为 `{slug}-opportunity-report-v{version}.md` |
| **JSON (`.json`)** | 团队数据集成、自建内部分析管道 | 下载为完整符合 Schema 的 JSON 结构化数据 |
| **PDF (Print / PDF)** | 离线汇报、与合伙人/投资人同步决策 | 网页端一键调用标准排版打印样式（Tailwind print CSS）或直接导出 PDF |

### 5.2 Markdown 报告标准渲染模板样例

````markdown
# 机会商业分析报告：Shopify 免登录税率计算器
> **判定结论**：`BUILD NOW` ｜ **综合置信度**：`HIGH` ｜ **数据基准日**：2026-10-01
> **目标市场**：US (en-US) ｜ **建议形态**：LIGHTWEIGHT_TOOL ｜ **执行规模**：S (3~5天)

---

## 一、 决策备忘录 (Executive Summary)
- **核心结论**：强需求已形成且存在明显 SERP 弱点，但商业变现需保持轻量工具定位以控制获客成本。
- **Why Now**：近 30 天内搜索需求突破临界点，SERP 前三名被 2022 年过时论坛帖占据，大厂尚未介入。
- **目标客群**：海外中小独立电商卖家 / Shopify 运营人员。

## 二、 关键得分分解
| 评估维度 | 得分 (基点) | 评级 | 关键事实 |
| :--- | :--- | :--- | :--- |
| **D - 需求形成** | 8200 / 10000 | HIGH | 簇内包含 14 个长尾变体，近 30 天出现加速趋势 |
| **M - 商业真实性** | 7600 / 10000 | HIGH | 观测到 3 家同类产品公开定价（中位数 $19/mo），接入 Stripe |
| **W - 准入窗口** | 8800 / 10000 | HIGH | SERP Top 10 中 60% 为弱结果（Reddit、过时文章） |

## 三、 商业变现证据与底线 (Commercial Evidence)
- **已观测定价**：区间 $9/mo - $49/mo，中位数 $19/mo。
- **已证实支付基础设施**：Stripe, Paddle。
- **本报告证明了什么**：证明已有真实独立开发者与软件厂商在此需求下成功实现付费转化。
- **本报告不能证明什么**：不代表你的产品上线即可自动盈利，最终转化率取决于产品体验与税率准确度。

## 四、 SERP 竞争弱点列表 (Top Weaknesses)
1. **[Rank 1] reddit.com** (2022-04-10) — 论坛问答帖，无交互式计算工具。
2. **[Rank 3] outdated-blog.org** (2021-11-03) — 包含大量过时旧税率，用户评论抱怨频繁。

## 五、 推荐构建形态与落地建议
- **形态推荐**：`LIGHTWEIGHT_TOOL`（无须强制登录，首屏直接交互，计算完毕后引导邮件订阅或高级报表导出）。
- **极简结构建议**：
  - `/`：核心免登录计算器主界面；
  - `/by-state`：按各州税率索引的长尾聚合页面；
  - `/faq`：报税合规问答与结构化标记。

## 六、 风险监控与止损红线 (Kill Criteria)
- [ ] 若 Shopify 官方或 Intuit 在 SERP Top 3 推出同名原生工具，立即终止额外开发投放。
- [ ] 若 SERP 弱结果比例跌破 20%，停止大规模页面扩充。

---
*免责声明：本报告基于 Emeradar 系统截至 2026-10-01 的公开市场客观观测数据生成，不构成任何投资或收益承诺。*
````

---

## 6. 配额、计费与生命周期

1. **配额扣减规则（与 13 联动）**：
   - Free 套餐：可免费在线浏览机会核心评分与前 3 条证据，每月可体验生成 1 份示例报告；
   - Pro 套餐：每月包含 30 份完整机会深度研究报告生成/导出配额；
   - Team 套餐：每月包含 100 份完整机会深度研究报告生成/导出配额。
2. **Hold & Release 事务原子性**：
   - 用户发起生成请求时，`EntitlementService` 预先执行原子锁定；
   - 任务在 Worker 完成并写入数据库后，状态变为 `READY`，正式 `Commit`；
   - 若系统因 LLM 超时或校验失败阻断且超过重试上限，状态置为 `FAILED`，额度自动 `Release`，不扣除用户月度余额。
3. **快照级幂等缓存**：
   - 针对 `(user_id, opportunity_id, snapshot_id)` 形成唯一索引；
   - 用户在当日快照周期内重复查看、下载或导出同一份报告，**零额外配额消耗**。
4. **过期与演进标记（`stale`）**：
   - 每天 04:30 批处理后，若机会的 Verdict 发生转移（如 `BUILD_NOW` 降级为 `WATCH`）或触发 Kill criteria，该报告标记为 `stale = true`；
   - 界面友好提示：“底层市场数据已于 {最新日期} 发生变化，建议刷新分析”。

---

## 7. 验收与质量门禁（8-Point Rubric）

系统自动化校验（阻断项）与人工抽检（每项 1 分，总分 8 分，≥ 7 分且 R1、R2 均满足视为合格）：

| 序号 | 检查维度 | 性质 | 规则描述 |
| :--- | :--- | :--- | :--- |
| **R1** | **引用真实性** | **一票否决** | 报告中引用的所有 SERP 排名、竞品域名必须在系统证据库中有明确对应 `evidence_id` / `snapshot_id`。 |
| **R2** | **严禁编造商业事实** | **一票否决** | 严禁凭空虚构竞品价格、支付网关或用户评价；M 轴为 LOW 时严禁声称“商业模式成熟”。 |
| **R3** | **占位符渲染完整性** | **阻断** | 报告渲染后不得残留未填充的 `{{Fx.field}}` 模板占位符。 |
| **R4** | **SERP 弱点客观性** | **核心** | 弱点列表必须直接映射自 SERP 审计事实（论坛帖、旧内容、低权威页）。 |
| **R5** | **形态推荐合理性** | **核心** | 推荐形态必须符合 05 §4.2 决策矩阵（低意图不做 SaaS，高交互做 Tool）。 |
| **R6** | **止损红线明确度** | **核心** | 必须包含至少 1 条可执行的 Kill Criteria 预警。 |
| **R7** | **多语言契约** | **核心** | 报告分析文案必须与用户 `ui_locale` 一致，专业术语与搜索词保持原文。 |
| **R8** | **免责与时效标注** | **合规** | 必须明确包含生成时间基准日与免责声明。 |

---

## 8. 下游闭环：立项与战绩核销

本报告不仅仅是供阅读的文档，更是整个产品生态的驱动源：
1. **一键立项 (Create Project)**：
   - 报告详情页与导出界面提供“🚀 基于此机会立项”按钮；
   - 点击后在 `projects` 表创建记录，绑定 `project.opportunity_id = opp_id` 与 `project.report_id = rpt_id`；
2. **成果核销与预测验证 (Prediction Verification)**：
   - 用户立项并上线自己的产品后，可在 Emeradar 填入上线域名或绑定 GSC；
   - 系统自动对齐该机会在 T+30d / T+60d / T+90d 的搜索表现；
   - 若用户成功斩获流量与排名，该结果将作为真实案例进入公开战绩库（Prediction Ledger & Hall of Fame），形成坚不可摧的产品口碑闭环！
