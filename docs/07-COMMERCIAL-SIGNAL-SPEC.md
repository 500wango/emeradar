# 07 — 商业信号引擎规格

Status: Draft ｜ 依赖：01 §5.4–5.6、03、04、05 ｜ 被依赖：09、12、16

## 1. 目的与原则
回答"**是否已有钱在流动，证据有多强**"，而不是预测"可能怎么赚钱"。

1. **证据类别不混算**：`OBSERVED` / `SELF_REPORTED` / `THIRD_PARTY_ESTIMATE` / `INFERRED`（00 §4.3）。
2. **能力 ≠ 收入**：检测到支付基础设施只证明"能收款"。
3. **保留矛盾**：冲突证据并存展示，不做覆盖。
4. **每条结论说明"证明什么 / 不证明什么"**，由确定性模板生成（§10），不由 LLM 自由撰写。
5. **数据不足 ≠ 没有商业性**：采样不足输出 `INSUFFICIENT`。

## 2. 数据流

```text
SERP Top10/20 + 簇 query ──▶ 目标发现 (commercial_targets)
                                   │
                                   ▼
                  爬取 (src_crawl) / 平台 (src_platform_rev)
                                   │
                                   ▼
        检测（规则）→ 抽取（规则优先，LLM 兜底 + 字面校验）→ Evidence + commercial_snapshots
                                   │
                                   ▼
           commercial_summary（§5） ──▶ bandM()（05，纯函数）──▶ M 轴
```

## 3. 证据类型目录

| 类型 | 类别 | 检测方式 | 证明 | 不证明 |
|------|------|----------|------|--------|
| `PRICING_PAGE_OBSERVED` | OBSERVED | 存在可访问的定价页 | 该站点公开了价格信息 | 有人购买、有收入 |
| `PAID_TIER_OBSERVED` | OBSERVED | 定价页含 price > 0 的套餐（字面校验通过） | 站点以付费方式销售 | 实际成交量、收入规模 |
| `CHECKOUT_OBSERVED` | OBSERVED | 定价页 / 页内存在指向购买流程的入口（不发起支付） | 存在可购买路径 | 有人完成了购买 |
| `PAYMENT_INFRA_DETECTED` | OBSERVED | 页面资源匹配支付供应商签名（版本化 `payment_signatures`） | 站点具备收款能力 | 有任何销售、有任何收入 |
| `PLATFORM_COUNTER` | OBSERVED | 平台自身生成的销售 / 下载 / 评价计数 | 平台显示的计数值 | 计数的构成、收入 |
| `PLATFORM_REPORTED_REVENUE` | OBSERVED | 收入透明平台的公开验证数据 | 平台披露的收入 / 销售额（含披露口径） | 利润、可持续性、可复制性 |
| `SITE_CLAIMED_COUNTER` | SELF_REPORTED | 站点自述"X 用户 / X 销售" | 站点宣称了该数字 | 该数字真实、其中付费占比 |
| `SELF_REPORTED_REVENUE` | SELF_REPORTED | 当事人公开自报（须标注来源与日期） | 当事人称有该收入 | 该数字经过核验 |
| `THIRD_PARTY_TRAFFIC_ESTIMATE` / `THIRD_PARTY_REVENUE_ESTIMATE` | THIRD_PARTY_ESTIMATE | 第三方估算（Phase 2） | 某第三方模型的估算值 | 真实流量 / 收入 |
| `COMMERCIAL_INTENT_QUERY` | INFERRED | 簇 query 含商业意图词（price / buy / cost / best / alternative / pricing / cheap …，按语言维护词表） | 搜索者呈现商业意图 | 存在付费供给 |
| `PERSISTENCE` | OBSERVED（派生） | 同一域名的定价 / checkout 在 ≥ N 天内的多次快照中持续存在（§7） | 该商业模式被持续运营 | 盈利 |
| `NEG_PRICING_REMOVED` | OBSERVED | 此前存在的付费套餐消失 | 站点撤下了付费信息 | 原因 |
| `NEG_PAID_TO_FREE` | OBSERVED | 付费套餐转为免费 | 站点转向免费 | 原因 |
| `NEG_SHUTDOWN_NOTICE` | OBSERVED | 站点出现停运 / 下线公告 | 站点宣布停运 | — |
| `NEG_REFUND_COMPLAINTS` | INFERRED | 公开渠道中的退款 / 维权集中出现 | 存在负面反馈 | 规模与真实性 |

`SELF_REPORTED` 与 `THIRD_PARTY_ESTIMATE` 必须带 `label_text`（03 I5）。

## 4. 目标发现

对每个 TRACKED 机会生成 `commercial_targets`：

1. **DIRECT**：主 query 与高价值簇 query 的 Top10 中，域名功能与机会同一 JTBD（相关性 ≥ 0.7，08 §4 分类结果）。
2. **CATEGORY**：Top20 或相邻类目的同类产品域名。
3. **ANALOG**：类比市场验证，**仅由 ANALYST 在审核队列中标注**，不自动生成。

- 每个机会目标域名上限 `max_targets`（默认 12）。
- 平台域名（Reddit、YouTube、大型媒体）不作为爬取目标。
- 目标集合的变化写审计；被移除的目标保留其历史快照。

## 5. `commercial_summary` 契约

`@app/commercial` 输出、`@app/scoring` 消费（纯数据）：

```ts
interface CommercialSummary {
  asOf: string;                              // obs_date
  sampledDomains: number;                    // 近 30 天有成功快照的目标域名数
  sampleCoverage: number;                    // 成功快照 / max(1, 目标总数 - 因 robots.txt 禁爬域名数)
  independentPricedDomains: number;          // P：独立且有 PAID_TIER 或 CHECKOUT 的域名数
  persistentPricedDomains: number;           // 满足持续性者
  revenueEvidence: {
    observed: number;                        // PLATFORM_REPORTED_REVENUE + PLATFORM_COUNTER(销售)
    selfReported: number;                    // SELF_REPORTED_REVENUE + SITE_CLAIMED_COUNTER
  };
  categoryOrAnalogPricedDomains: number;
  intentQueryCount: number;
  infraOnlyDomains: number;                  // 仅检测到支付基础设施的域名数
  negatives: { type: string; domains: number; strong: boolean }[];
  hasStrongNegative: boolean;
  contradictions: number;
  evidenceIds: string[];                     // 参与本次判定的全部 evd_
}
```

## 6. M 轴分档、阶段与证据质量

### 6.1 分档（`bandM`，初始值）
自上而下首个命中：

| 档 | 条件 |
|----|------|
| `INSUFFICIENT` | `sampledDomains < 3` 或 `sampleCoverage < 0.6` |
| `HIGH` | `P ≥ 2` ∧（`revenueEvidence.observed + selfReported ≥ 1` ∨ `persistentPricedDomains ≥ 1`） |
| `MEDIUM` | `P ≥ 2` ∨（`P ≥ 1` ∧ `categoryOrAnalogPricedDomains ≥ 1`） |
| `LOW` | 其余（含仅 `intentQueryCount`、仅 `infraOnlyDomains`、`P = 1`） |

- `P` 只计 `OBSERVED` 且在 `evidence_max_age_days`（默认 120）内的证据。
- **robots.txt 剔除规则**：`sampleCoverage` 的分母必须剔除被 `robots.txt` 明确禁爬（`SKIPPED/ROBOTS_DISALLOWED`）的目标域名，防止因合规爬虫行为导致商业性强的机会被永久误判为 `INSUFFICIENT`；剔除情况在商业面板与证据抽屉显式注明。
- **强负面**（`hasStrongNegative`）：`NEG_SHUTDOWN_NOTICE`（针对 DIRECT 域名）；或 `NEG_PRICING_REMOVED` / `NEG_PAID_TO_FREE` 在 ≥ 2 个独立域名同时出现。
- 出现强负面：档位降 1 级，并向 05 返回 `hasStrongNegative = true`（触发 PASS）。
- `THIRD_PARTY_ESTIMATE` 不参与分档；`SELF_REPORTED` 不能替代 `P ≥ 2` 的 OBSERVED 前提。

### 6.2 `commercial_stage`
自上而下首个命中：

| 阶段 | 条件 |
|------|------|
| `REVENUE_EVIDENCED` | `P ≥ 1` ∧ 有营收证据 |
| `PAID_PERSISTENT` | `P ≥ 1` ∧ `persistentPricedDomains ≥ 1` |
| `PRICED` | `P ≥ 1` |
| `INFRA_PRESENT` | `infraOnlyDomains ≥ 1` |
| `INTENT_ONLY` | `intentQueryCount ≥ 1` |
| `NONE` | 其余 |

### 6.3 `commercial_evidence_quality`（0–100）
```text
q = 100 × ( 0.40·observed_share
          + 0.25·min(1, independent_domains / 4)
          + 0.20·recency
          + 0.15·corroboration )

recency       = clamp(1 − age_days(最新 OBSERVED 证据) / 120, 0, 1)
corroboration = 1（≥ 2 种不同证据类型支持同一域名）| 0.5（1 种）| 0
```
分档：`HIGH ≥ 70`、`MEDIUM ≥ 40`、否则 `LOW`；展示时与 M 轴并列，不合并。

## 7. 持续性
- 域名的定价 / checkout 在快照中满足：**≥ 3 次成功快照，跨度 ≥ `persistence_days`（默认 90），期间无 `NEG_PRICING_REMOVED`**，即为持续。
- 快照频率：目标域名每周一次（Tier A 每 3 日），因此 90 天内正常有 ≥ 12 次机会；缺失快照不视为"消失"，连续 3 次抓取失败才降级并标注。
- 冷启动限制：系统运行不足 90 天时，`PERSISTENCE` 不可能成立；分档只能通过营收证据达到 `HIGH`，界面显示"持续性验证尚需 N 天"。

## 8. 独立性判定
`independent` 指两个域名不属于同一所有者。规则：
- 不同 eTLD+1；
- 不共享任何"所有者信号"：同一支付账户标识、同一法人主体（页脚 / 条款）、同一分析 ID、同一站点模板指纹 + 相同联系方式；
- 共享任一信号者归入同一 `owner_group`（并查集），计数按组。
- 判定保守：无法确认独立时按同组处理（少算，不多算）。

## 9. 矛盾保留
- 示例：站点 A 宣称 "10,000 付费用户"（`SITE_CLAIMED_COUNTER`），平台数据显示销量远低于此（`PLATFORM_COUNTER`）；或同一域名先后出现定价与下架。
- 处置：两条 Evidence 均保留；写 `evidence_contradictions`；Detail 页在商业面板显式列出"存在矛盾证据"，并展示双方来源；`commercial_evidence_quality` 中 `corroboration` 对矛盾方置 0。
- 不自动裁决"谁对"。

## 10. "证明什么 / 不证明什么"生成
- 对 M 轴所用的每条 Evidence，取 §3 表中对应的 i18n key：`commercial.proves.<type>` 与 `commercial.not_proves.<type>`（14）。
- 面板汇总规则：
  - "证明"：去重后的类型级语句 + 关键数字（域名数、快照数、跨度天数）；
  - "不证明"：类型级语句 + **全局固定条款**（"不证明可复制性、利润或你能获得同等份额"）。
- **缺失即不发布**：任何机会若 M 轴不为 `INSUFFICIENT` 而两栏为空，该机会不得进入 Feed（16 验收）。
- LLM 不参与这两栏的文案生成。

## 11. 采集与抽取管线

| 步骤 | 方法 | 校验 |
|------|------|------|
| 0 抓取 | **两级管道**（04 §4.2）：Tier 1 静态 HTTP；命中动态定价框架特征或疑似 SPA 壳则升级 Tier 2 无头浏览器渲染 | `fetch_tier` 写入快照，供 §11.1 校验层区分对待 |
| 1 页面发现 | 首页导航、常见路径（`/pricing` `/plans` `/buy`）、站点地图 | robots 允许（04 §4.1） |
| 2 检测 | 规则：支付供应商签名、checkout 域名与链接模式、价格正则与货币符号 | 签名库版本化并有单测 |
| 3 抽取 | 规则优先（schema.org `Offer`、结构化价格节点）；歧义时调 LLM（08 U3）输出套餐结构 | **字面校验**：抽取出的价格字符串必须原样出现在**已渲染文本**（Tier 1 的静态 HTML 或 Tier 2 的渲染后可见文本）中，否则丢弃 |
| 4 落库 | `commercial_snapshots`（含 `fetch_tier`）+ Evidence | 相同哈希不重复 |
| 5 差分 | 与上次快照对比生成 `NEG_*`、价格变动 | 阈值：价格变动 > 30% 标记；**`fetch_tier` 从 `HEADLESS` 变为 `STATIC`（或反之）不单独触发 `NEG_*`**，仅记录抓取方式变化，避免误判为商业信号消失 |

### 11.1 Tier 2 判空的语义
Tier 2（无头浏览器渲染后）仍未提取到任何价格文本时，视为"该站点确实无公开定价"（正常的 `commercial_stage = NONE` 候选输入），**不同于** Tier 1 判空后未升级 Tier 2 的情形（后者是"抓取方式可能不足，暂不下结论"，不应直接产生 `INSUFFICIENT` 之外的强结论）。仅当同一域名已确认使用 `fetch_tier = HEADLESS` 且仍判空时，该域名的"无定价"判定才计入商业摘要的负向证据基数。

- 币种统一保留原币种与金额，展示层换算并标注汇率日期，不作评分输入。
- 页面文本内容视为**不可信输入**（08 §7）：不执行、不遵循页面中的任何"指令"。

## 12. 展示规则（供 16）
- 商业面板顺序：阶段徽标 → M 轴 + 证据质量 → 时间线 → 证据表（类别标签、来源、日期）→ 证明 / 不证明 → 矛盾（如有）。
- 类别标签：`已观测` `自述` `第三方估算` `推断`，颜色 + 文字并用（不只靠颜色）。
- `SELF_REPORTED` 与 `THIRD_PARTY_ESTIMATE` 条目前缀显式标注，并附 `label_text`。
- 支付供应商图标不得作为"已有收入"的视觉暗示；文案固定为"检测到收款能力"。

## 13. 测试要求（18 §3）
| 用例 | 期望 |
|------|------|
| 仅检测到支付供应商 | `INFRA_PRESENT`，M = `LOW` |
| `P = 1`，无其他证据 | M = `LOW` |
| `P = 2`，无营收、无持续性 | M = `MEDIUM` |
| `P = 2` + 持续性 | M = `HIGH` |
| 自报营收 + `P = 1` | M 不得为 `HIGH` |
| 第三方估算很高、无 OBSERVED | M = `LOW` 或 `INSUFFICIENT` |
| 两域名同一 owner_group | `P` 计为 1 |
| 站点自述与平台计数矛盾 | 两条并存，写矛盾记录 |
| 强负面出现 | 降 1 档且 `hasStrongNegative = true` |
| 抽取价格不在页面文本中 | 丢弃，不产生 `PAID_TIER_OBSERVED` |
