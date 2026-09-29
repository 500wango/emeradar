import { OpportunityReportData } from './types';

export function renderReportToMarkdown(report: OpportunityReportData): string {
  const { metadata, section1, section2, section3, section4, section5, section6 } = report;

  const dPct = (metadata.scores.dBasisPoints / 100).toFixed(1);
  const mPct = (metadata.scores.mBasisPoints / 100).toFixed(1);
  const wPct = (metadata.scores.wBasisPoints / 100).toFixed(1);

  let md = `# 🎯 Opportunity Research Report: ${metadata.title}

> **Report ID**: \`${metadata.reportId}\`  
> **Opportunity ID**: \`${metadata.opportunityId}\` | **Obs Date**: \`${metadata.obsDate}\`  
> **Generated At**: \`${metadata.generatedAt}\` | **Locale**: \`${metadata.locale}\`

---

## 1. 📊 Executive Summary & Radar Verdict

| Dimension | Metric / Value | Description |
|-----------|----------------|-------------|
| **Verdict** | **\`${metadata.verdict}\`** | Algorithmic judgment based on D-M-W signals |
| **Lifecycle** | \`${metadata.lifecycle}\` | Current opportunity evolution stage |
| **Recommended Archetype** | \`${metadata.recommendedArchetype}\` | Optimal product archetype to capture market |
| **Execution Class** | \`${metadata.executionClass}\` | Development complexity and resource tier |
| **Demand Score (D)** | **${dPct} / 100** (${metadata.scores.dBasisPoints} bps) | Search demand velocity & cluster growth |
| **Commercial Signal (M)** | **${mPct} / 100** (${metadata.scores.mBasisPoints} bps) | Verified monetization & paid competition |
| **Competitive Window (W)** | **${wPct} / 100** (${metadata.scores.wBasisPoints} bps) | SERP weakness & low incumbent resistance |
| **Evidence Confidence** | \`${metadata.scores.confidence}\` | Stored confidence band |

### Strategic Thesis
${section1.thesis}

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

---

## 4. 💰 Commercial Validation & Monetization

- **Total Corroborating Signals**: ${section4.evidenceCount.total} (${section4.evidenceCount.observed} directly observed, ${section4.evidenceCount.selfReported} self-reported, ${section4.evidenceCount.estimated} estimated)

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

  return md;
}
