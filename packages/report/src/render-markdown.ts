import { OpportunityReportData } from './types';
import {
  formatVerdict,
  formatLifecycle,
  formatArchetype,
  formatExecutionClass,
  formatVerdictDescription,
  formatSearchIntent,
  formatVolumeTier,
  formatResultType,
  formatPricingModel,
  formatSiteStrategy,
  formatBarrierToEntry,
  formatIndieEntrantDensity,
  formatShadowChannel,
  formatPresence,
} from './localization';

export function renderReportToMarkdown(report: OpportunityReportData): string {
  const { metadata, section1, section2, section3, section4, section5, section6 } = report;
  const isZh = metadata.locale === 'zh-CN';

  const dPct = (metadata.scores.dBasisPoints / 100).toFixed(1);
  const mPct = (metadata.scores.mBasisPoints / 100).toFixed(1);
  const wPct = (metadata.scores.wBasisPoints / 100).toFixed(1);

  if (isZh) {
    let md = `# 🎯 商业机会深度研究报告：${metadata.title}

> **报告编号 (Report ID)**：\`${metadata.reportId}\`  
> **机会标识 (Opportunity ID)**：\`${metadata.opportunityId}\` ｜ **观测日期**：\`${metadata.obsDate}\`  
> **生成时间**：\`${metadata.generatedAt}\` ｜ **语言环境**：\`${metadata.locale}\`

---

## 1. 📊 执行摘要与决策裁决 (Executive Summary)

| 评估维度 | 指标与分值 | 通俗解读与说明 |
|:---|:---|:---|
| **雷达综合裁决** | **${formatVerdict(metadata.verdict, 'zh-CN', true)}** | ${formatVerdictDescription(metadata.verdict, 'zh-CN')} |
| **生命周期阶段** | \`${formatLifecycle(metadata.lifecycle, 'zh-CN')}\` | 当前商业机会在搜索生态中所处的红利窗口阶段 |
| **推荐产品形态** | \`${formatArchetype(metadata.recommendedArchetype, 'zh-CN', true)}\` | 抢占该搜索需求阻力最小的产品架构形态 |
| **执行复杂度等级** | \`${formatExecutionClass(metadata.executionClass, 'zh-CN')}\` | 推荐的开发周期与资源投入规模 |
| **搜索需求指数 (D)** | **${dPct} / 100 分** (${metadata.scores.dBasisPoints} 基点) | 衡量美区 Google 真实搜索热度与相关聚合词增速 |
| **商业变现验证 (M)** | **${mPct} / 100 分** (${metadata.scores.mBasisPoints} 基点) | 衡量赛道已有付费竞品、定价档位与实际在线收款能力 |
| **竞争进入窗口 (W)** | **${wPct} / 100 分** (${metadata.scores.wBasisPoints} 基点) | 衡量 Google 前十名结果中薄弱劣质页面的占比（分越高越易渗透） |
| **数据证据置信度** | \`${metadata.scores.confidence === 'HIGH' ? '高置信度 (已完成交叉验证)' : metadata.scores.confidence}\` | 统计样本规模与数据完备性评估 |

### 💡 核心战略论点
${section1.thesis}
${
  section1.veteranVerdict
    ? `
### 🎖️ 独立站老兵渗透战术
> **${section1.veteranVerdict.headline}**
> - **推荐切入战术**：\`${section1.veteranVerdict.penetrationAngle}\`
${section1.veteranVerdict.structuralReasons.map((r) => `> - 🎯 ${r}`).join('\n')}
`
    : ''
}
### ⏰ 为什么是现在？(Why Now)
> [!NOTE]
> ${section1.whyNow}

### 🚀 核心产品概念原型
💡 **${section1.topIdea}**

### ⚠️ 关键风险与假设
${section1.keyRisks.map((risk) => `- ⚠️ ${risk}`).join('\n')}

> [!IMPORTANT]
> **行动落地建议**：${section1.decisionRecommendation}

---

## 2. 🔍 搜索需求与查询词图谱分析 (Search Demand)

- **核心种子查询词 (Primary Query)**：\`${section2.primaryQuery}\`
- **主要搜索意图 (Search Intent)**：\`${formatSearchIntent(section2.searchIntent, 'zh-CN')}\`
- **解决核心任务 (Core Job)**：${section2.jobToBeDone}
- **建议落地形态 (Recommended Shape)**：**${section2.recommendedProductShape}**
- **域名站点策略 (Site Strategy)**：\`${formatSiteStrategy(section2.siteStrategy, 'zh-CN')}\`
- **搜索增长动量 (Velocity)**：\`${section2.queryVelocity}x 基准增速\`

### 关联查询词矩阵 (Query Cluster)
| 搜索关键词 (Google Query) | 搜索意图类型 | 搜索量等级 |
|:--------------------------|:-------------|:-----------|
${section2.clusterQueries.map((q) => `| \`${q.query}\` | ${formatSearchIntent(q.intent, 'zh-CN')} | ${formatVolumeTier(q.volumeTier, 'zh-CN')} |`).join('\n')}

### 搜索框联想词与长尾萌芽信号 (Autocomplete Signals)
${section2.autocompleteSignals.map((s) => `- \`${s}\``).join('\n')}

**动量综合评估**：  
${section2.momentumAssessment}

---

## 3. 🛡️ 竞争格局与搜索结果薄弱点分析 (SERP Weakness)

- **SERP 薄弱度得分**：**${section3.serpWeaknessScore.toFixed(1)} / 100 分**
- **薄弱结果占比**：**${(section3.weakResultsRatio * 100).toFixed(0)}%** 的 Google 首页排位存在明显质量缺陷或切入空隙
- **首页 / 内页结构分布**：独立首页占比 ${(section3.homepageRatio * 100).toFixed(0)}% ｜ 大站无意内页占比 ${(section3.innerPageRatio * 100).toFixed(0)}%

### Google 前 10 名自然搜索结果审计
| 排名 | 目标域名 | 网页原始标题 (Title) | 页面类型 | 渗透难度 | 存在薄弱点原因 |
|:---:|:---|:---|:---:|:---:|:---|
${section3.top10Results.map((r) => `| ${r.rank} | **${r.domain}** | ${r.title} | \`${formatResultType(r.resultType, 'zh-CN')}\` | ${r.isWeak ? '🔴 薄弱 (易被替换)' : '🟢 强劲 (权重高)'} | ${r.weaknessReason || '暂无详细薄弱标注'} |`).join('\n')}

### 可切入空隙与竞品盲区
${section3.vulnerableGaps.map((gap) => `- 🎯 ${gap}`).join('\n')}
${
  section3.indieCompetitionAudit
    ? `
### 🕵️ 中小开发者水下生态与技术壁垒审计 (Indie Competition & Defense Moat)

> [!WARNING]
> **巨头盲区警示**：科技巨头（如 Adobe、Google）看不上此类微型细分赛道，仅靠权重内页占位；真正蚕食利润的是**敏捷的中小独立开发者**。若工具技术门槛过低，将面临严重的同质化批量套壳竞争。

- **技术实现壁垒 (Barrier to Entry)**：**${formatBarrierToEntry(section3.indieCompetitionAudit.barrierToEntry, 'zh-CN')}**
- **壁垒与仿制分析**：${section3.indieCompetitionAudit.barrierReason}
- **中小开发者涌入密度**：**${formatIndieEntrantDensity(section3.indieCompetitionAudit.indieEntrantDensity, 'zh-CN')}**
${section3.indieCompetitionAudit.densityWarning ? `> ⚠️ **水下竞争预警**：${section3.indieCompetitionAudit.densityWarning}\n` : ''}
#### 水下竞争渠道渗透观测 (Shadow Channels)
| 竞争渠道 | 渗透状态 | 真实生态观测与威胁研判 |
|:---|:---:|:---|
${section3.indieCompetitionAudit.shadowChannels.map((c) => `| **${formatShadowChannel(c.channel, 'zh-CN')}** | ${formatPresence(c.presence, 'zh-CN')} | ${c.observation} |`).join('\n')}

#### 🛡️ 防御性护城河构建建议 (Defensive Moat Advice)
${section3.indieCompetitionAudit.defensiveMoatAdvice}
`
    : ''
}

---

## 4. 💰 商业验证与变现天花板 (Commercial Validation)

- **已交叉验证证据数**：${section4.evidenceCount.total} 条（${section4.evidenceCount.observed} 条直接抓取观测，${section4.evidenceCount.selfReported} 条竞品公开声明）

### 细分赛道活跃付费竞品
| 竞品域名 | 收费模式 | 价格区间 | 已集成支付通道 |
|:---------|:---------|:---------|:---------------|
${section4.paidCompetitors.map((c) => `| **${c.domain}** | ${formatPricingModel(c.pricingModel, 'zh-CN')} | ${c.priceRange} | ${c.paymentGateways.join(', ')} |`).join('\n')}

**变现空间与商业天花板评估**：  
${section4.monetizationHeadroom}

> [!NOTE]
> **负面政策与合规风险排查**：${section4.negativeSignalCheck.passed ? '✅ 已通过 — 未检测到侵犯注册商标、平台封禁或灾难性政策红线。' : '⚠️ 警告 — 存在需关注的政策潜在风险。'}

---

## 5. 🛠️ 14 天冲刺执行蓝图 (14-Day Sprint Blueprint)

- **推荐产品形态**：\`${formatArchetype(section5.archetype, 'zh-CN', true)}\`
- **执行复杂度级别**：\`${formatExecutionClass(section5.executionClass, 'zh-CN')}\`
- **建议目标上线周期**：**${section5.targetTimeframeDays} 天**

### 最小可行版本执行简报 (Minimum Execution Brief)
- **用户核心任务**：${section5.executionBrief.coreJob}
- **首发页面形态**：${section5.executionBrief.mvpPageType}
- **核心交互动作**：${section5.executionBrief.coreAction}

#### 初始页面规划 (Initial Pages)
${section5.executionBrief.initialPages.map((p) => `- \`${p.path}\`：${p.purpose}`).join('\n')}

#### 内链布局策略 (Internal Linking)
${section5.executionBrief.internalLinkPlan.map((p) => `- ${p}`).join('\n')}

#### 上线检查清单 (Launch Checklist)
${section5.executionBrief.launchChecklist.map((p) => `- [ ] ${p}`).join('\n')}

#### 明确避坑事项 (Non-goals)
${section5.executionBrief.nonGoals.map((p) => `- ❌ ${p}`).join('\n')}

### MVP 功能边界定义 (Scope Definition)
| MVP 首发包含功能 (In Scope) | 验证期暂不开发功能 (Out of Scope) |
|:----------------------------|:----------------------------------|
${Array.from({
  length: Math.max(
    section5.mvpScope.inScope.length,
    section5.mvpScope.outOfScope.length
  ),
})
  .map((_, i) => {
    const inc = section5.mvpScope.inScope[i] || '';
    const out = section5.mvpScope.outOfScope[i] || '';
    return `| ${inc ? `✅ ${inc}` : ''} | ${out ? `🚫 ${out}` : ''} |`;
  })
  .join('\n')}

### 推荐技术选型 (Recommended Tech Stack)
- **前端架构 (Frontend)**：${section5.recommendedStack.frontend}
- **后端服务 (Backend)**：${section5.recommendedStack.backend}
- **数据持久化 (Database)**：${section5.recommendedStack.database}
- **托管部署 (Hosting)**：${section5.recommendedStack.hosting}

### 14 天上线执行时间表 (Implementation Roadmap)
${section5.sprintPlan14d
  .map(
    (sprint) => `#### ${sprint.phase} (${sprint.days})
${sprint.deliverables.map((d) => `- [ ] ${d}`).join('\n')}`
  )
  .join('\n\n')}

---

## 6. 🛑 止损与叫停红线 (Kill Criteria)

> [!WARNING]
> 一旦在研发或运营过程中触发以下任一红线条件，**应立即终止开发或冻结投入**，避免沉没成本扩大：

| 规则编码 | 触发红线条件 | 制定理由与应对措施 |
|:---:|:---|:---|
${section6.activeRules.map((r) => `| **\`${r.code}\`** | ${r.rule} | ${r.rationale} |`).join('\n')}

### 自动失效场景
${section6.invalidationConditions.map((cond) => `- 🛑 ${cond}`).join('\n')}

### 雷达持续跟踪指引
${section6.radarWatchGuidance}
`;

    if (report.goalSimulator) {
      const sim = report.goalSimulator;
      const estLowCost = sim.requiredDomainsLow * 100;
      const estHighCost = Math.round(sim.requiredDomainsHigh * 125);
      md += `
---

## 7. 🎯 商业收益与 SEO 外链预算测算 (Goal & ROI Simulator)

| 测算指标 | 预估/目标数值 | 业务解读与参考基准 |
|:---|:---|:---|
| **目标月经常性收入 (MRR)** | **$${sim.defaultMonthlyTargetUSD.toLocaleString()} / 月** | 独立开发者基准月收入目标 |
| **Ahrefs 标定难度 (KD)** | **${sim.estimatedKd} / 100 分** | 关键词自然搜索算法竞争阻力 |
| **目标域名权重 (DR)** | **${sim.targetDrRange}** | 进入搜索首页所需的最低域名权威度 |
| **所需反向外链域名数 (RD)** | **${sim.requiredDomainsLow} ~ ${sim.requiredDomainsHigh} 个独立域名** | 达成排位所需的独立引荐域名配额 |
| **预估外链获取预算** | **$${estLowCost.toLocaleString()} ~ $${estHighCost.toLocaleString()}** | 阶梯化外链建设或软文拓展预算 |
| **黄金关键词比率 (KGR)** | **${sim.kgrRatio.toFixed(3)}** | ${sim.kgrRatio < 0.25 ? '✅ 极佳 (< 0.25 具备极速上词潜质)' : '⚠️ 标准'} |
| **聚合长尾 KGR (EKGR)** | **${sim.ekgrRatio.toFixed(3)}** | ${sim.ekgrRatio < 1.0 ? '✅ 潜力良好 (< 1.0)' : '标准'} |
| **聚合词月度搜索潜量** | **约 ${sim.monthlyVolumeEstimate.toLocaleString()} 次/月** | 整个意图词簇的月度总搜索量估算 |

### 核心测算假设条件
${sim.assumptions.map((a) => `- 💡 ${a}`).join('\n')}
`;
    }

    return md;
  }

  // Pure English output for en-US / foreign users
  let md = `# 🎯 Opportunity Research Report: ${metadata.title}

> **Report ID**: \`${metadata.reportId}\`  
> **Opportunity ID**: \`${metadata.opportunityId}\` | **Obs Date**: \`${metadata.obsDate}\`  
> **Generated At**: \`${metadata.generatedAt}\` | **Locale**: \`${metadata.locale}\`

---

## 1. 📊 Executive Summary & Radar Verdict

| Dimension | Metric / Value | Description |
|-----------|----------------|-------------|
| **Verdict** | **\`${metadata.verdict}\`** | ${formatVerdictDescription(metadata.verdict, 'en-US')} |
| **Lifecycle** | \`${metadata.lifecycle}\` | Current opportunity evolution stage in search ecosystem |
| **Recommended Archetype** | \`${formatArchetype(metadata.recommendedArchetype, 'en-US')}\` | Optimal product structure to capture search market |
| **Execution Class** | \`${formatExecutionClass(metadata.executionClass, 'en-US')}\` | Development complexity and sprint timeline tier |
| **Demand Score (D)** | **${dPct} / 100** (${metadata.scores.dBasisPoints} bps) | Search demand velocity & cluster growth |
| **Commercial Signal (M)** | **${mPct} / 100** (${metadata.scores.mBasisPoints} bps) | Verified monetization & paid competition |
| **Competitive Window (W)** | **${wPct} / 100** (${metadata.scores.wBasisPoints} bps) | SERP weakness & low incumbent resistance |
| **Evidence Confidence** | \`${metadata.scores.confidence}\` | Verified statistical evidence confidence tier |

### Strategic Thesis
${section1.thesis}
${
  section1.veteranVerdict
    ? `
### Veteran Penetration Verdict
> **${section1.veteranVerdict.headline}**
> - **Penetration Strategy Angle**: \`${section1.veteranVerdict.penetrationAngle}\`
${section1.veteranVerdict.structuralReasons.map((r) => `> - 🎯 ${r}`).join('\n')}
`
    : ''
}
### Why Now?
> [!NOTE]
> ${section1.whyNow}

### High-Leverage Product Concept
💡 **${section1.topIdea}**

### Key Risks & Assumptions
${section1.keyRisks.map((risk) => `- ⚠️ ${risk}`).join('\n')}

> [!IMPORTANT]
> **Actionable Recommendation**: ${section1.decisionRecommendation}

---

## 2. 🔍 Search Demand & Query Clustering

- **Primary Query**: \`${section2.primaryQuery}\`
- **Search Intent**: \`${section2.searchIntent}\`
- **Core Job**: ${section2.jobToBeDone}
- **Recommended Shape**: **${section2.recommendedProductShape}**
- **Site Strategy**: \`${section2.siteStrategy}\`
- **Query Momentum Velocity**: \`${section2.queryVelocity}x baseline\`

### Query Cluster Matrix
| Search Query | Search Intent | Volume Tier |
|--------------|---------------|-------------|
${section2.clusterQueries.map((q) => `| \`${q.query}\` | ${q.intent} | ${q.volumeTier} |`).join('\n')}

### Autocomplete & Emerging Long-Tail Signals
${section2.autocompleteSignals.map((s) => `- \`${s}\``).join('\n')}

**Momentum Assessment**:  
${section2.momentumAssessment}

---

## 3. 🛡️ Competitive Landscape & SERP Weakness

- **SERP Weakness Score**: **${section3.serpWeaknessScore.toFixed(1)} / 100**
- **Vulnerable Results Ratio**: **${(section3.weakResultsRatio * 100).toFixed(0)}%** of Top 10 results display addressable quality gaps
- **Homepage / Inner-page Mix**: ${(section3.homepageRatio * 100).toFixed(0)}% / ${(section3.innerPageRatio * 100).toFixed(0)}%

### Top 10 Organic Search Results
| Rank | Domain | Title | Result Type | Weakness Status | Reason |
|:----:|--------|-------|:-----------:|:---------------:|--------|
${section3.top10Results.map((r) => `| ${r.rank} | **${r.domain}** | ${r.title} | \`${r.resultType}\` | ${r.isWeak ? '🔴 WEAK' : '🟢 STRONG'} | ${r.weaknessReason || ''} |`).join('\n')}

### Attackable Gaps & Competitor Blindspots
${section3.vulnerableGaps.map((gap) => `- 🎯 ${gap}`).join('\n')}
${
  section3.indieCompetitionAudit
    ? `
### 🕵️ Indie Competition & Defense Moat Audit

> [!WARNING]
> **Strategic Alert**: Tech giants ignore micro-niches and leave generic inner pages; real commercial competition comes from **agile indie builders**. If technical barriers are low, fast clone saturation will follow.

- **Technical Barrier to Entry**: **${formatBarrierToEntry(section3.indieCompetitionAudit.barrierToEntry, 'en-US')}**
- **Barrier Analysis**: ${section3.indieCompetitionAudit.barrierReason}
- **Indie Entrant Density**: **${formatIndieEntrantDensity(section3.indieCompetitionAudit.indieEntrantDensity, 'en-US')}**
${section3.indieCompetitionAudit.densityWarning ? `> ⚠️ **Density Warning**: ${section3.indieCompetitionAudit.densityWarning}\n` : ''}
#### Shadow Channels Penetration Audit
| Shadow Channel | Presence | Ecological Observation & Risk Assessment |
|----------------|:--------:|------------------------------------------|
${section3.indieCompetitionAudit.shadowChannels.map((c) => `| **${formatShadowChannel(c.channel, 'en-US')}** | \`${formatPresence(c.presence, 'en-US')}\` | ${c.observation} |`).join('\n')}

#### 🛡️ Defensive Moat & Anti-Clone Strategy
${section3.indieCompetitionAudit.defensiveMoatAdvice}
`
    : ''
}

---

## 4. 💰 Commercial Validation & Monetization

- **Total Corroborating Signals**: ${section4.evidenceCount.total} (${section4.evidenceCount.observed} directly observed, ${section4.evidenceCount.selfReported} self-reported)

### Paid Solutions Active in Niche
| Competitor Domain | Pricing Model | Price Range | Payment Gateways |
|-------------------|---------------|-------------|------------------|
${section4.paidCompetitors.map((c) => `| **${c.domain}** | ${c.pricingModel} | ${c.priceRange} | ${c.paymentGateways.join(', ')} |`).join('\n')}

**Monetization Headroom**:  
${section4.monetizationHeadroom}

> [!NOTE]
> **Negative Signal Verification**: ${section4.negativeSignalCheck.passed ? '✅ Passed — No catastrophic platform or policy hazards detected.' : '⚠️ Warning — Signals require review.'}

---

## 5. 🛠️ Execution Blueprint & 14-Day Sprint

- **Product Archetype**: \`${section5.archetype}\`
- **Execution Class**: \`${section5.executionClass}\`
- **Target Launch Window**: **${section5.targetTimeframeDays} Days**

### Minimum Execution Brief
- **Core Job**: ${section5.executionBrief.coreJob}
- **MVP Page Type**: ${section5.executionBrief.mvpPageType}
- **Core Action**: ${section5.executionBrief.coreAction}

#### Initial Pages
${section5.executionBrief.initialPages.map((p) => `- \`${p.path}\`: ${p.purpose}`).join('\n')}

#### Internal Linking
${section5.executionBrief.internalLinkPlan.map((p) => `- ${p}`).join('\n')}

#### Launch Checklist
${section5.executionBrief.launchChecklist.map((p) => `- [ ] ${p}`).join('\n')}

#### Non-goals
${section5.executionBrief.nonGoals.map((p) => `- ${p}`).join('\n')}

### Scope Definition
| In Scope (MVP) | Out of Scope (Post-Validation) |
|----------------|--------------------------------|
${Array.from({
  length: Math.max(
    section5.mvpScope.inScope.length,
    section5.mvpScope.outOfScope.length
  ),
})
  .map((_, i) => {
    const inc = section5.mvpScope.inScope[i] || '';
    const out = section5.mvpScope.outOfScope[i] || '';
    return `| ${inc ? `✅ ${inc}` : ''} | ${out ? `❌ ${out}` : ''} |`;
  })
  .join('\n')}

### Recommended Tech Stack
- **Frontend**: ${section5.recommendedStack.frontend}
- **Backend**: ${section5.recommendedStack.backend}
- **Database**: ${section5.recommendedStack.database}
- **Infrastructure**: ${section5.recommendedStack.hosting}

### 14-Day Implementation Roadmap
${section5.sprintPlan14d
  .map(
    (sprint) => `#### ${sprint.phase} (${sprint.days})
${sprint.deliverables.map((d) => `- [ ] ${d}`).join('\n')}`
  )
  .join('\n\n')}

---

## 6. 🚨 Kill Criteria & Radar Invalidation Alerts

> [!WARNING]
> If any of the following events occur, **immediately abort development or freeze marketing spend** to preserve capital:

| Rule Code | Trigger Condition | Rationale |
|:---------:|-------------------|-----------|
${section6.activeRules.map((r) => `| **\`${r.code}\`** | ${r.rule} | ${r.rationale} |`).join('\n')}

### Discontinuation Thresholds
${section6.invalidationConditions.map((cond) => `- 🛑 ${cond}`).join('\n')}

### Radar Monitoring Notice
${section6.radarWatchGuidance}
`;

  if (report.goalSimulator) {
    const sim = report.goalSimulator;
    const estLowCost = sim.requiredDomainsLow * 100;
    const estHighCost = Math.round(sim.requiredDomainsHigh * 125);
    md += `
---

## 7. 🎯 Goal & ROI Simulator (Builder Unit Economics)

| Metric | Target / Projected Value | Operational Benchmark |
|--------|-------------------------|-----------------------|
| **Target Monthly Revenue** | **$${sim.defaultMonthlyTargetUSD.toLocaleString()} / mo** | Baseline ambition tier |
| **Ahrefs-Calibrated KD** | **${sim.estimatedKd} / 100** | Algorithmic resistance estimate |
| **Target Domain Rating (DR)** | **${sim.targetDrRange}** | Viable ranking threshold |
| **Required Referring Domains** | **${sim.requiredDomainsLow} - ${sim.requiredDomainsHigh} domains** | Calibrated link acquisition quota |
| **Estimated Link Outlay** | **$${estLowCost.toLocaleString()} - $${estHighCost.toLocaleString()}** | Tiered outreach & link acquisition |
| **Keyword Golden Ratio (KGR)** | **${sim.kgrRatio.toFixed(3)}** | ${sim.kgrRatio < 0.25 ? '✅ Great (< 0.25 - Fast rank candidate)' : '⚠️ Standard'} |
| **Extended KGR (EKGR)** | **${sim.ekgrRatio.toFixed(3)}** | ${sim.ekgrRatio < 1.0 ? '✅ Promising (< 1.0)' : 'Standard'} |
| **Monthly Volume Modeling** | **~${sim.monthlyVolumeEstimate.toLocaleString()} visits/mo** | Modeled across query cluster |

### Modeling Assumptions
${sim.assumptions.map((a) => `- 💡 ${a}`).join('\n')}
`;
  }

  return md;
}
