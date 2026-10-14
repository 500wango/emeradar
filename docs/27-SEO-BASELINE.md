# SEO 基线：按 Google 官方文档核对，并落地可验证的最小改动

Status: Implemented 2026-10-13（改动在仓库内；线上生效需部署）

本文只回答一件事：**这个站点的 SEO 现状与 Google 文档的要求差在哪，改了哪几处，怎么验证的。**
不承诺排名、收录或流量 —— 那些不是代码能保证的东西。

## 1. 依据与作用域

| 主题 | 官方文档（2026-10-13 复核） |
|---|---|
| 标题 | https://developers.google.com/search/docs/appearance/title-link |
| 摘要/描述 | https://developers.google.com/search/docs/appearance/snippet |
| canonical 与重复 URL | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls |
| 站点地图 | https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap |
| 多语言/多地区 | https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites |
| JavaScript 渲染 | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics |

关键事实（直接影响本文的判断）：

- Googlebot **不设置 `Accept-Language`**，也不带 cookie（多语言文档原文：crawler sends HTTP requests without setting Accept-Language）。本站在服务端只读 `emeradar_locale` cookie，因此爬虫拿到的是 `DEFAULT_LOCALE`。
- 标题应当"描述性强、能代表该页"，并避免跨页重复的样板文案。
- 站点地图只放你希望成为 canonical 的 URL；`<lastmod>` 必须能被验证，否则 Google 不采信。
- 标题长度、H1 数量、字数、关键词密度都不是排名通过/失败规则 —— 本文不把它们当门槛。

## 2. 审计发现（改动前）

| # | 现状 | 证据（改动前实测） | 影响 | 处理 |
|---|---|---|---|---|
| 1 | 除首页与公开档案外，所有公开页共用同一份 `<title>`/`description`，无 canonical | `curl https://emeradar.com/pricing` 与 `/methodology`、`/track-record`、`/terms` 的 head 完全相同 | 四个可索引页面在搜索结果里同名同摘要 | 已修：每页独立的 i18n 文案 + `pageMetadata()` 生成 canonical/OG/twitter |
| 2 | 无 canonical / Open Graph / Twitter 元数据 | 线上首页 HTML 无 `rel=canonical`、无 `og:*` | 重复 URL 的偏好信号缺失；分享卡片无标题描述 | 已修：根布局 `metadataBase` + `alternates.canonical` + `openGraph`/`twitter` |
| 3 | `<title>` 是英文，页面正文（爬虫看到的那一版）是中文 | 线上 `lang="zh-CN"`、H1 中文，`<title>` 英文 | 标题与内容语言不一致，等于把标题交给搜索引擎重写 | 已修：标题/描述按服务端 locale 取词 |
| 4 | 站点地图漏掉 `/pricing` | `https://emeradar.com/sitemap.xml` 只有 4 条 | 主要转化页缺少发现路径 | 已修：公开页清单集中到 `lib/seo/site.ts`，站点地图与 metadata 共用 |
| 5 | 私有/工具页没有任何索引控制 | `/login`、`/settings`、`/feed` 响应既无 robots meta 也无 `X-Robots-Tag` | 薄表单页可能被收进索引 | 已修：middleware 对私有路径统一 `X-Robots-Tag: noindex, nofollow` |
| 6 | 无任何结构化数据 | 线上 HTML 无 `application/ld+json` | 站点实体（谁、叫什么）没有机器可读表述 | 已修：Organization / WebSite / 公开档案 BreadcrumbList |
| 7 | 公开档案页只有 title，无 description/canonical | `generateMetadata` 只返回 title + robots | 归档页在结果里无摘要，且可能与登录态页混同 | 已修：取 `content.whyNow` 作描述 + canonical + 面包屑 |
| 8 | `robots.txt` 由 Cloudflare 托管，无 `Sitemap:` 指令 | 线上 `/robots.txt` 结尾是 `# END Cloudflare Managed Content` | 站点地图只能靠 GSC 手动提交 | **未改**（不在仓库里，见 §5） |

## 3. 改动清单

- `src/lib/seo/site.ts`（新）：`SITE_URL`/`absoluteUrl`、公开页清单 `STATIC_PUBLIC_PAGES`、私有路径 `PRIVATE_PATH_PREFIXES`/`isPrivatePath`、`ROBOTS_INDEX`/`ROBOTS_NOINDEX`、`pageMetadata()`、Organization/WebSite/Breadcrumb 构造。
- `src/components/seo/JsonLd.tsx`（新）：JSON-LD 输出组件，`<` 转义为 `\u003c` 防标签截断。
- `src/app/layout.tsx`：`metadata` → `generateMetadata()`（按 locale 取标题，`metadataBase`，`title.template`），正文首部输出站点级 JSON-LD。
- `src/app/{page,pricing,methodology,track-record,terms}/page.tsx`：各自声明标题/描述/canonical。
- `src/app/public/opportunities/[slug]/page.tsx`：描述取档案证据、canonical、Open Graph、BreadcrumbList。
- `src/app/sitemap.ts`：改为由公开页清单 + `public_pages` 生成；静态页不再伪造 `lastmod`。
- `src/middleware.ts`：私有路径加 `X-Robots-Tag`。
- `src/lib/i18n/{types.ts,locales/zh.ts,locales/en.ts}`：新增 `seo` 文案命名空间（中英各一套，类型强制齐全）。
- `test/seo.test.ts`（新）：4 个用例覆盖私有/公开路径边界、清单唯一性、metadata 一致性、JSON-LD 字段完整性。

### 一个被实测推翻的疑虑

JSON-LD 是 `<script type="application/ld+json">`，在 `script-src 'nonce-…' 'strict-dynamic'` 下会不会被 CSP 拦掉？**不会** —— 用严格 CSP 的页面实测：元素可读、无 `securitypolicyviolation`。它是数据块而不是脚本，因此不需要 nonce；给它加 nonce 只会把 nonce 值写进页面内容。这一点写在 `JsonLd.tsx` 的注释里，避免下一个人"顺手修好"。

## 4. 验证证据（本地构建 + 真实渲染）

本地以生产构建（`next build` → `next start -p 3100`，连开发库）实测：

- `/`、`/pricing`、`/methodology`、`/track-record`、`/terms`：标题各不相同、canonical 正确、`og:*`/`twitter:card` 齐全、`robots: index, follow, max-image-preview:large, max-snippet:-1`、每页 `Organization`+`WebSite`、每页恰好 1 个 `<h1>`。
- `/sitemap.xml`：5 条 URL，含 `/pricing`。
- `X-Robots-Tag: noindex, nofollow`：`/feed`(307)、`/login`、`/settings`、`/opportunities/demo`(307)、`/admin/users`(404)、`/onboarding`(307)、`/compare`(307)。
- 公开路径无该响应头：`/`、`/pricing`；`/api/*` 不经过 middleware（matcher 有意排除），故也不带头。
- `pnpm run lint`（tsc --noEmit）、`pnpm run build`、`pnpm --filter @emeradar/web test`（8 用例）全部通过。

**未验证（需要部署后才成立）**：以上都是本地产物。线上是否为同样的 head、Google 是否按新 canonical 归并，必须部署后重跑本节的探测。

## 5. 明确的未做项与待决策

1. **语言与 URL 策略（最大的一个）**：Googlebot 不带 cookie，所以它索引到的是 `DEFAULT_LOCALE`（当前 `zh-CN`），而产品文案自称面向 "US · EN-US" 市场。文档给的正式解法是"每种语言一个 URL + hreflang"，现在是单 URL 双语言（靠 cookie 切换）。
   - 取哪条路由是产品决策，不在本次改动里。
   - 若维持现状：把 `DEFAULT_LOCALE` 定为爬虫该看到的语言即可（一行），但那也是"给 Google 看哪一版"的决定。
2. **`robots.txt` 在 Cloudflare 侧**：缺 `Sitemap:` 指令；`User-agent: *` 是 `Allow: /`，`/api` 未屏蔽；同时屏蔽了 `GPTBot`/`ClaudeBot`/`Google-Extended` 等（`ai-train=no`）。要不要放行 Google-Extended（影响 Gemini/AI 摘要里的使用，不影响 Search 收录）是产品取舍 —— 需要 Cloudflare 面板或 API token 才能改。
3. **static 化与 CSP nonce 的取舍**：根布局 `dynamic = 'force-dynamic'` 是为了 CSP nonce 按请求生成（HTML 不能带陈旧 nonce），代价是整站 SSR、`cache-control: private, no-store`，首字节与抓取预算都不占优。改成静态/ISR 需要换一版 CSP 策略（哈希或按请求重写 nonce），属于安全敏感改动，没有一起做。
4. **没有位图 logo 与 OG 图片**：`public/` 只有 `icon.svg`。Organization 的 `logo` 因此留空（不给错资源），分享卡片也只有文字。补一张位图会同时改善这两处。
5. **Search Console**：站点地图目前只能靠 GSC 手动提交（`robots.txt` 无 Sitemap 行）；本次没有动 GSC。
   - **注意区分两件事**：PRD v2.1 把**产品内**的 GSC 连接降为可选增强项（`src_gsc`，见 `04` §9.5 与 `06` §7.1），那是因为它从"必选的战绩核销凭据"变成了"用户自愿的自身流量复盘"。这是**产品功能**的降级，与**运维侧**提交站点地图这件事无关 —— 后者仍然是站长自己要和 Google 打交道的事，GSC 依旧是站点地图被发现的唯一途径。
6. **PRD v2.1 新增的一条路由待纳入**：`/case-studies/[slug]`（买断保护期满后解密生成的完结案例页，`15` §3.1）。它以 `page_type='CASE_STUDY'` 出现在 `public_pages`，因此 `lib/seo/site.ts` 的公开页清单与 `sitemap` 生成逻辑需要把它一并纳入（与 `/public/opportunities/[slug]` 同一路径，不需要新机制）。当前库里没有解密记录，所以线上暂时不会出现该 URL —— 与第 4 条的"没发布过 indexable 记录"是同一类空状态，不是抓取故障。
   - **明确不该被索引的**：候选池（`/feed` 的候选池 Tab）与 `/screener` 是登录后页面，必须继续输出 `X-Robots-Tag: noindex`。买断保护期内的公开投影也强制 `indexable = false`（`15` §5），因此不会进 sitemap。

## 6. 监控与判定规则

部署后（建议 T+7 / T+14 / T+30）：

1. 重跑 §4 的本地探测脚本，对线上 URL 断言标题唯一、canonical 正确、`X-Robots-Tag` 只出现在私有路径。
2. GSC「网页」报告：确认 `/pricing`、`/methodology`、`/track-record`、`/terms` 各自成为独立 URL（而不是合并到首页或互相替代），且 `/login`、`/settings` 不出现。
3. 站点地图：GSC 中 `sitemap.xml` 抓取成功、URL 数与线上一致。
4. 若 T+30 后公开档案页（`/public/opportunities/*`）仍未被抓取，检查是"没发布过 indexable 记录"还是抓取问题 —— 数据库侧的 `public_pages` 当前没有满足条件的行时，站点地图里本来就不该有它们。
5. 回滚边界：本次改动全部是新增元数据与响应头，回滚 = 还原这 12 个文件；不涉及 schema、不改 URL 结构、不动已有页面内容。

## 7. 与其他文档的关系

- SEO 机会验证（产品功能侧）见 `20-SEO-OPPORTUNITY-OPTIMIZATION-PLAN.md`。
- 安全头与 CSP 决策见 `26-SECURITY-AUDIT.md`；部署流程见 `21-DOCKER-VPS-DEPLOYMENT.md`。
