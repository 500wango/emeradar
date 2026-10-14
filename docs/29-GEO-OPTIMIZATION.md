# 29 — GEO (生成式引擎优化) 落地规范与 Google AI Overviews 对齐报告

Status: Implemented 2026-10-14 ｜ Owner: 前端 / 增长 ｜ 依据：Google Search Central AI Features 官方文档 & Princeton GEO Benchmark

---

## 1. 核心事实与官方文档依据

| 领域 | 官方标准 / 权威研究 | 核心技术结论 |
|---|---|---|
| **Google AI Overviews 机制** | [Google: Optimizing for generative AI features](https://developers.google.com/search/docs/appearance/ai-features) | AI Overviews 深度依托核心搜索索引与 RAG 检索生成，通过 "Query Fan-Out"（子查询扇出）并发检索高置信度支持网页并生成显式引用链接。无需孤立私有黑客手段，以高可提取性内容为根本。 |
| **抓取控制与摘要限制** | [Google: Preview controls and AI features](https://developers.google.com/search/docs/appearance/snippet) | `max-snippet:-1`、`max-image-preview:large`、`max-video-preview:-1` 决定了 AI Overviews 能否提取全文并展示高质量卡片。若设置 `max-snippet:0` 或 `nosnippet`，网页内容将被直接阻断于 AI 摘要之外。 |
| **实体图谱与知识归因** | [Google: Structured Data General Guidelines](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) | 结构化数据（JSON-LD）是 Google Knowledge Graph 与生成式模型理解网页实体属性（Organization、SoftwareApplication、FAQPage、Dataset、TechArticle）的核心依据。 |
| **学术界 GEO 基准** | Princeton / Georgia Tech / Allen AI: *Generative Engine Optimization (GEO)* (KDD 2024) | 统计数据引用（+37% 胜率）、直接引用与权威定义（+30% 胜率）、明确的 Q&A 架构与结构化表格（+28% 胜率）显著提升大语言模型与生成引擎的引文概率。 |
| **Answer Engine 标准** | Answer Engine Indexing Specification (`llms.txt`) | 在站点根目录与 `/.well-known/llms.txt` 提供专供 AI 检索代理（Gemini、Perplexity、SearchGPT、Claude、Cursor）消费的高信噪比 Markdown 摘要。 |

---

## 2. 满分 GEO 优化矩阵（Emeradar 落地清单）

| 序号 | 维度 | Google AI Overviews 要求 | 改动前现状 | 优化后落地（已通过本地与全量构建验证） |
|---|---|---|---|---|
| **1** | **摘要与预览指令** | 允许无限制长文本摘要、大图预览及视频索引 | 仅声明 `max-image-preview:large`, `max-snippet:-1` | 补全 `max-video-preview:-1`；`ROBOTS_INDEX` 达到 Google 官方全规格标准 |
| **2** | **爬虫权限控制** | 需对全网合规爬虫及 AI 检索机器人（Google-Extended、PerplexityBot 等）明确路由策略，阻断私有区，公开站点地图 | 无原生 `robots.txt`，依赖反代，未指明 Sitemap | 新增 `src/app/robots.ts`，原生生成 `/robots.txt`：声明 `Sitemap`，阻断 14 个私有路径，放行所有公开页与静态资产 |
| **3** | **站点与软件实体图谱** | 声明完整品牌主体与 SaaS 产品架构 | 仅声明无 logo 的 Organization 与基础 WebSite | 生成 512x512 位图 `logo.png` 与 1200x630 `og-image.png`；新增 `softwareApplicationJsonLd()` 声明产品属性、定价层级与功能列表 |
| **4** | **商业问答直接提取** | 满足 Query Fan-Out 商业意图子查询（价格、取消策略、额度） | 仅在客户端组件条件渲染 FAQ，无 JSON-LD，非首开项不在 DOM | 新增 `faqPageJsonLd()` 将 Q&A 全量写入 `/pricing`；修改客户端组件保留 DOM 可爬取状态 |
| **5** | **实证方法论知识权威** | 技术规范需可作为第一手权威信源（Primary Source）被直接引用 | `/methodology` 无任何结构化数据 | 注入 `techArticleJsonLd()` 与 `breadcrumbJsonLd()`；增加**核心公理执行摘要面板**，便于 AI 模型生成直接回答（Direct Answer） |
| **6** | **经验验证预测账本** | 科学实验与公开统计需以结构化数据集声明 | `/track-record` 虽有数据表但无 Schema.org 标定 | 注入 `datasetJsonLd()`（符合 docs/15 §6.1），覆盖时间跨度、地理空间与测量指标；表格表头补全 `scope="col"` |
| **7** | **机会归档技术档案** | 历史研报需具备不可篡改的技术出版属性 | 仅输出简单面包屑 | 注入 `techArticleJsonLd()` 标记标题、发布时间、分析对象（about: primaryQuery）与作者主体 |
| **8** | **AI 代理专用通道** | 现代化生成式引擎需标准化高密度上下文 | 无专用入口 | 增加 `/llms.txt` 与 `/.well-known/llms.txt` 静态路由，详述三轴门槛、方案与主要接口 |
| **9** | **全站实体拓扑互链** | 避免孤岛页面，形成闭环 Hub-and-Spoke 内部链接 | 页脚遗漏 `/methodology` 链接 | 页脚导航补齐 `methodology`（中英双语）；公开页全部注入完整层级 `BreadcrumbList` |

---

## 3. 代码变更与资产清单

1. **静态视觉与品牌资源**
   - `scripts/generate-seo-assets.py`：利用 PIL 生成高分辨率深色仪表盘风格资产。
   - `apps/web/public/logo.png`：512x512 位图 logo，用于 Organization 知识图谱与 Apple Touch Icon。
   - `apps/web/public/og-image.png`：1200x630 OpenGraph / Twitter Large Image 分享卡片。
2. **SEO / GEO 核心引擎 (`apps/web/src/lib/seo/site.ts`)**
   - 升级 `ROBOTS_INDEX`，加入 `'max-video-preview': -1`。
   - 升级 `pageMetadata()`，加入大图卡片 `openGraph.images` 与 `twitter.card: 'summary_large_image'`。
   - 升级 `organizationJsonLd()`，写入 `logo`、`image` 与 `knowsAbout` 专业实体知识标签。
   - 新增 `softwareApplicationJsonLd()`、`faqPageJsonLd()`、`techArticleJsonLd()`、`datasetJsonLd()`。
3. **页面与路由落地**
   - `apps/web/src/app/robots.ts`：App Router 原生 robots.txt 生成器。
   - `apps/web/src/app/llms.txt/route.ts` & `/.well-known/llms.txt/route.ts`：生成式引擎专用索引。
   - `apps/web/src/app/layout.tsx`：全局注入 `WebApplication` Schema 与全规格 Open Graph 卡片。
   - `apps/web/src/app/pricing/page.tsx`：注入 `FAQPage` + `BreadcrumbList`。
   - `apps/web/src/app/methodology/page.tsx`：注入 `TechArticle` + `BreadcrumbList`，新增顶部直接回答面板。
   - `apps/web/src/app/track-record/page.tsx`：注入 `Dataset` + `BreadcrumbList`，表头增加 `scope="col"`。
   - `apps/web/src/app/terms/page.tsx`：注入 `BreadcrumbList`。
   - `apps/web/src/app/public/opportunities/[slug]/page.tsx`：注入 `TechArticle` + 动态时间戳 + 知识对象。
   - `apps/web/src/components/PricingClient.tsx`：表格增加 `scope="col"` / `scope="row"`，确保 FAQ 答案在 DOM 中常驻。
   - `apps/web/src/components/Footer.tsx`：页脚导航补全 `methodology` 互链。
   - `apps/web/src/lib/i18n/{types.ts,locales/en.ts,locales/zh.ts}`：补充对应国际化文案。
4. **自动化测试**
   - `apps/web/test/seo.test.ts`：全量覆盖 robots 放行阻断规则、图片资产声明、多类型 JSON-LD 结构有效性。

---

## 4. 验证结果

- **单元测试**：`pnpm --filter @emeradar/web test` 9 个用例全部通过（耗时 ~186ms）。
- **类型检查**：`turbo run lint`（`tsc --noEmit`）0 错误通过。
- **生产构建**：`next build`（33 个静态/动态路由）全部编译成功，验证生成 `○ /robots.txt`、`○ /llms.txt`、`ƒ /sitemap.xml`。
