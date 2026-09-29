# SEO 机会验证改造计划

Status: Implemented  2026-09-29

## 目标

把“搜索需求 → SERP 判断 → 产品形态 → 最小执行 → GSC 复盘”落到机会报告中，使用户可以基于冻结证据完成做 / 观察 / 放弃决策。

## 已完成改造

1. **搜索意图与产品形态**
   - 报告 Demand 区增加 `searchIntent`、`jobToBeDone`、`recommendedProductShape` 和 `siteStrategy`。
   - `siteStrategy` 明确区分独立站、已有站内页和观察。

2. **SERP 证据一致性**
   - 报告服务按同一机会快照日期关联 `serp_snapshots`，避免把机会快照 ID 错当成 SERP 快照 ID。
   - 保留结果 URL，并计算首页 / 内页比例。
   - 报告观察日期使用冻结快照日期。

3. **最小 Execution Brief**
   - 每份报告输出核心任务、MVP 页面类型、核心动作、首批页面、内链计划、上线检查项和非目标。
   - 不自动生成或发布大量页面，不承诺排名和流量。

4. **报告缓存正确性**
   - 缓存命中必须匹配当前日期的冻结 snapshot，避免新快照产生后返回旧报告。

## 主动发现改造（P0，已完成 2026-09-29）

- 每日 pipeline 在观察已存在机会前，从最近 14 天的 `autocomplete_observations` 提取新扩展词。
- 新词经过归一化、确定性 hash 去重后，写入现有 `queries`、`opportunities`、`opportunity_queries`、`opportunity_snapshots` 和 `opportunity_cards`。
- 新候选固定为 `CANDIDATE`、`WATCH`、`INSUFFICIENT`、`LOW`，不会绕过观察期直接发布 `BUILD_NOW` 或进入公开 feed。
- 机会记录保留 `discovery_source`、`discovered_at` 和 `candidate_reason`，前端将其明确展示为 Emerging market candidates。
- 每次最多提取 25 个候选，重复运行幂等；候选随后由既有每日观察流程采集 SERP、商业证据并计算 D/M/W。

## 后续阶段

- **P1：数据完善**：已完成 primary query 搜索意图、产品形态、站点策略和观测证据持久化；报告优先读取冻结卡片字段。
- **P2：GSC 回流**：已完成项目级明细指标表、幂等写入接口和 T+7 / T+14 / T+30 聚合返回；OAuth 调度仍需接入真实凭据后启用。
- **P3：公开获客**：已完成延迟资格、商业/SERP 证据质量门和 `public_pages` 投影写入；公开路由读取投影与 sitemap 接入仍是下一步。
- **P1：候选增长确认**：已记录近/前一周 Autocomplete 覆盖天数与扩展增长、独立来源数到每日快照；缺少近期覆盖时不将扩展斜率输入评分。
- **后续**：增加独立搜索趋势或用户真实站点数据的候选来源，并以稳定的来源类型和时间序列接入；当前 Autocomplete/SERP/商业证据部分来自同一采集链，不能夸大为多来源市场确认。

## 非目标

- 不新增独立关键词评分系统。
- 不把 KD、搜索量、停留时间或外链数量当作单一裁决依据。
- 不引入批量薄页、垃圾外链或自动外部发布能力。

## 验收标准

- 报告能够回答“用户要完成什么、应该做成什么、独立站还是内页、首批做哪些页面”。
- SERP 结果来自与报告相同日期的冻结快照。
- 报告缓存不会跨 snapshot 复用。
- `@emeradar/report` 测试、`@emeradar/report` 构建、`@emeradar/services` 构建通过。

## 本轮实现边界

- GSC 只提供受项目归属校验保护的周数据写入接口，不在本轮接入 Google OAuth 或保存凭据。
- P3 质量门不足时保留页面投影但设为 `indexable=false`，避免薄内容进入 sitemap。
