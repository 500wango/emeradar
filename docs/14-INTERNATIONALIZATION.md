# 14 — 国际化与本地化规格（Internationalization & Localization）

Status: Draft ｜ 依赖：00-INDEX §4.4、01 F12、03 §15、08 U6 ｜ 被依赖：09、10、15、16

## 1. 目的与原则

本系统主要服务面向全球市场出海的独立开发者。国际化（i18n）不是单纯的界面翻译插件，而是贯穿数据采集、实体分析、模型生成与前端呈现的底层架构。

**核心原则**：
1. **三概念强正交分离**：`ui_locale`、`research_language` 与 `market_country` 在所有数据表、API 契约、批处理任务与缓存键中绝对独立，严禁互为默认值或隐式推导（00 §4.4）。
2. **事实保真度高于翻译润色**：搜索词原文、竞品域名、产品品牌名、SERP 原始标题与硬数字必须保持原始形态（Canonical Preservation），系统仅对解释性、引导性段落做本地化。
3. **确定性规范化**：Query 的归一化必须在语言感知下通过确定性纯函数完成，避免同义查询由于大小写或空格差异被分裂建簇。
4. **生成内容本地化可审计**：LLM 生成的本地化文本必须附带源哈希（`source_hash`）与生成溯源（`provenance`），源内容更新时自动失效并具备重算能力。

---

## 2. 三概念正交模型

系统严格区分并解耦以下三个地域/语言维度：

| 维度 | 字段名称 | 标准与取值 | 决定什么 | 不决定什么 |
|------|----------|------------|----------|------------|
| **界面语言** | `ui_locale` | `zh-CN` `en-US` | 导航菜单、按钮标签、系统提示文案、预置错误信息语言 | 不决定搜索什么语言的词，不决定展示哪个国家的 SERP |
| **研究语言** | `research_language` | BCP 47（首发 `en-US`；Phase 2 `zh-CN`） | 关键词文本归一化规则、Autocomplete 扩展词库、意图修饰词列表 | 不决定界面是中文还是英文 |
| **目标市场** | `market_country` | ISO 3166-1 alpha-2 大写（首发 `US`） | Google SERP 抓取地域、Google Trends 区域、本地货币换算展示 | 不决定分析的内容语言 |

### 2.1 隔离约束
* **禁止隐式推导**：前端即使用户选择了 `zh-CN` 界面，创建项目与检索 Feed 时的默认研究市场依然是其偏好中的 `(US, en-US)`，绝不能因为用户切换中文界面就自动将请求过滤为中文搜索词。
* **API 与缓存键维度**：所有缓存层（HTTP ETag、Postgres Detail 缓存、`opportunity_cards`）的键必须显式包含三元组：
  $$\text{CacheKey} = (\text{opportunity\_id}, \text{obs\_date}, \text{market\_country}, \text{research\_language}, \text{ui\_locale})$$

---

## 3. Query 规范化算法规范（`text_normalized`）

在 [`03-DATA-MODEL.md#L173`](file:///home/michael/project/emeradar/docs/03-DATA-MODEL.md#L173) 中，`queries.text_normalized` 是查询去重与聚类的唯一定位键。规范化由纯函数 `normalizeQuery(text, lang)` 执行，必须符合以下算法流水线：

```text
原始输入字符串
  │
  ▼ 1. Unicode 兼容等价规范化（Unicode Normalization Form KC: NFKC）
  │    消除全角/半角字符、罗马数字、特殊空格符号差异
  │
  ▼ 2. 语言感知的重音与变音符号清理（Diacritics Removal）
  │    en-US 语言下：résumé → resume，café → cafe
  │    保留特定代码与工具专有名词的符号保护（见保护白名单）
  │
  ▼ 3. 专有名词与技术标识符保护（Token Protection）
  │    正则标记：C++、.NET、C#、Node.js、Vue.js、A/B Testing 等不破坏标点
  │
  ▼ 4. 标点符号与特殊字符移除
  │    移除引号、问号、惊叹号、括号、下划线等：[^\p{L}\p{N}\s+#.]
  │
  ▼ 5. 大小写折叠（Case Folding）
  │    统一转小写（toLowerCase）
  │
  ▼ 6. 空白符合并与修剪
  │    所有连续空白符（\s+）合并为单个空格，trim 两端空白
  │
输出 text_normalized
```

### 3.1 符号保护白名单（版本化）
```ts
const PRESERVED_TOKENS = new Set([
  'c++', 'c#', '.net', 'node.js', 'vue.js', 'next.js', 'nuxt.js',
  'react.js', 'f#', 'objective-c', 'tcp/ip'
]);
```
对于命中保护白名单的词元，其内部的 `+`、`#`、`.`、`/` 严禁被标点清理步骤剔除。

---

## 4. 静态 UI 国际化架构

采用 Next.js App Router 官方推荐的服务端同构国际化方案，共享模块位于 `packages/i18n`。

### 4.1 目录组织
```text
packages/i18n/
  src/
    locales/
      en-US/
        common.json       # 通用按钮、分页、状态标签
        feed.json         # Feed 筛选、卡片、排序
        detail.json       # 详情页三轴分解、决策面板
        report.json       # 机会研究报告各板块展示
        errors.json       # RFC 9457 业务错误国际化文案
        commercial.json   # 商业信号"证明/不证明"字典（§7）
      zh-CN/
        ...               # 对应中文键
    index.ts              # 纯函数翻译加载器与类型推导
```

### 4.2 路由与 Hydration 策略
* **路由约定**：公开站采用前缀路由（`/{locale}/track-record`），默认 `en-US` 重定向；应用控制台内部由 Cookie / User Profile 驱动，不修改内部操作路径，减少状态丢失。
* **服务端优先渲染（RSC）**：所有文案翻译在服务端组件渲染完成，静态 HTML 直出；客户端仅在交互弹窗（如确认对话框）消费轻量 Context，不全量下发翻译 JSON，保持极小 Client Bundle。
* **类型安全**：基于 TypeScript 的 `IntlKeys` 类型推导，所有调用 `t('detail.window.band')` 在编译期经类型检查，禁止拼写错误。

---

## 5. 生成内容本地化（U6 管道）

对于 LLM 动态生成的非确定性长文本（如 Why Now 叙述、Search Formation 洞察、机会研究报告落地建议），系统按需执行本地化并持久化于 `localized_content`（03 §15）。

### 5.1 生成约束
* **原文生成与按需翻译**：
  * 所有分析内容一律优先以 `research_language`（首发 `en-US`）作为第一事实基准生成并入库（`source_locale = 'en-US'`）；
  * 当用户界面偏好为 `zh-CN` 时，触发本地化管道（U6，08 §2），翻译结果写入 `localized_content`。
* **实体与硬事实不可翻译原则**：
  * 实体名（如 "Stripe", "Next.js", "Cursor"）保留原文；
  * 竞品域名（`eTLD+1`）保持小写 ASCII 原样；
  * 原生关键词（`primary_query`）与 SERP 网页标题（`title`）保持原文，禁止翻译，避免丢失出海用户的真实搜索语感；
  * 仅对其解释性描述（“为什么值得做”、“竞品劣势分析”）进行中文本地化。

### 5.2 缓存失效与版本流转（`source_hash`）
* 每次源内容生成后，计算内容哈希：
  $$\text{source\_hash} = \text{SHA-256}(\text{canonical\_json}(\text{source\_content}))$$
* 当底层数据快照更新导致源内容变化时，`source_hash` 发生改变，既有 `localized_content` 行立即失效；下一次客户端读取时触发异步惰性重译。
* `localized_content.provenance` 记录完整生成溯源：
  ```json
  {
    "model": "claude-3-5-haiku-20241022",
    "prompt_version": "v1.2",
    "translated_at": "2026-09-25T10:00:00Z",
    "cost_usd": 0.00045
  }
  ```

### 5.3 繁体与简体中文策略
系统严格遵循 01 F12 规定：**绝不把繁体中文（zh-TW / zh-HK）自动转换为简体中文后视为同一原始证据**。在 Phase 2 引入中文研究市场时，繁体与简体视为不同字面特征，分别记录观测值。

---

## 6. 商业信号"证明什么/不证明什么"国际化字典

按照 [`07-COMMERCIAL-SIGNAL-SPEC.md#L147`](file:///home/michael/project/emeradar/docs/07-COMMERCIAL-SIGNAL-SPEC.md#L147) 规定，两栏总结由确定性模板驱动，严禁 LLM 自由撰写。字典规范如下：

```json
{
  "commercial": {
    "proves": {
      "PRICING_PAGE_OBSERVED": {
        "en-US": "Directly proves public pricing information exists across {count} domain(s).",
        "zh-CN": "已在 {count} 个独立域名上直接观测到公开定价页面。"
      },
      "PAID_TIER_OBSERVED": {
        "en-US": "Directly proves active commercial offerings with price > 0.",
        "zh-CN": "已证实存在价格大于 0 的正式付费套餐或产品。"
      },
      "CHECKOUT_OBSERVED": {
        "en-US": "Directly proves a verifiable checkout path is operational.",
        "zh-CN": "已证实具备可用的购买下单流程入口。"
      },
      "PAYMENT_INFRA_DETECTED": {
        "en-US": "Proves payment processor infrastructure is implemented.",
        "zh-CN": "检测到已集成支付服务商（具备收款能力）。"
      },
      "PERSISTENCE": {
        "en-US": "Proves the commercial model has been sustained for ≥ {days} days across multiple snapshots.",
        "zh-CN": "商业定价在跨越 ≥ {days} 天的多次快照中持续有效存在。"
      }
    },
    "not_proves": {
      "PRICING_PAGE_OBSERVED": {
        "en-US": "Does NOT prove any actual transactions or paying customers.",
        "zh-CN": "不证明产生过任何实际成交，亦不证明有真实付费用户。"
      },
      "PAID_TIER_OBSERVED": {
        "en-US": "Does NOT prove revenue volume or business sustainability.",
        "zh-CN": "不证明实际销售规模，亦不证明业务模式可持续。"
      },
      "PAYMENT_INFRA_DETECTED": {
        "en-US": "Does NOT prove any revenue has ever flowed through this infrastructure.",
        "zh-CN": "不证明该站点发生过任何真实收入流水。"
      },
      "GLOBAL_DISCLAIMER": {
        "en-US": "Does NOT prove profitability or that your build will capture equal market share.",
        "zh-CN": "绝不构成盈利保证，亦不保证您的项目能够获得同等市场份额。"
      }
    }
  }
}
```

---

## 7. 测试与质量验证标准

1. **Query 规范化单测**：
   - 包含多空格、全角符号、大小写混合、重音符号组合测试；
   - 验证 `c++ builder` 与 `C++ Builder` 规范化为同一 `c++ builder`；
   - 验证 `node.js hosting` 与 `Node.JS   hosting` 规范化为同一 `node.js hosting`。
2. **占位符保真度测试**：
   - 批量抽样 100 份本地化后的长文本，比对文本中的占位符（如 `{{F1.new_queries_7d}}`）是否 100% 完整保留，不得出现占位符被翻译、缺失或符号篡改的情形。
3. **URL 与域名防翻译测试**：
   - 校验所有生成的本地化内容中，绝对禁止将 `github.com`、`stripe.com` 等域名翻译为中文别名。
