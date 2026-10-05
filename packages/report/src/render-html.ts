import { OpportunityReportData } from './types';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

export function renderReportToHtml(report: OpportunityReportData): string {
  const { metadata, section1, section2, section3, section4, section5, section6 } = report;

  const dPct = (metadata.scores.dBasisPoints / 100).toFixed(1);
  const mPct = (metadata.scores.mBasisPoints / 100).toFixed(1);
  const wPct = (metadata.scores.wBasisPoints / 100).toFixed(1);

  return `<!DOCTYPE html>
<html lang="${esc(metadata.locale)}">
<head>
  <meta charset="UTF-8">
  <title>Opportunity Research Report: ${esc(metadata.title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      background-color: #ffffff;
      padding: 40px;
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .title {
      font-size: 26px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 8px;
    }
    .meta-bar {
      font-size: 13px;
      color: #64748b;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-build-now { background-color: #dcfce7; color: #15803d; }
    .badge-early-bet { background-color: #e0f2fe; color: #0369a1; }
    .badge-closing { background-color: #fef3c7; color: #b45309; }
    .badge-watch { background-color: #f1f5f9; color: #475569; }
    .badge-pass { background-color: #fee2e2; color: #b91c1c; }
    
    h2 {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin: 32px 0 16px 0;
      border-left: 4px solid #3b82f6;
      padding-left: 12px;
    }
    h3 {
      font-size: 16px;
      font-weight: 600;
      color: #334155;
      margin: 20px 0 10px 0;
    }
    p { margin-bottom: 12px; font-size: 14px; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0 24px 0;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 10px 14px;
      text-align: left;
    }
    th {
      background-color: #f8fafc;
      font-weight: 600;
      color: #475569;
    }
    tr:nth-child(even) td { background-color: #fafbfc; }
    
    .callout {
      padding: 16px;
      border-radius: 8px;
      margin: 16px 0;
      font-size: 14px;
    }
    .callout-note { background-color: #f0fdf4; border-left: 4px solid #22c55e; color: #166534; }
    .callout-important { background-color: #eff6ff; border-left: 4px solid #3b82f6; color: #1e40af; }
    .callout-warning { background-color: #fef2f2; border-left: 4px solid #ef4444; color: #991b1b; }
    
    ul { padding-left: 24px; margin-bottom: 16px; font-size: 14px; }
    li { margin-bottom: 6px; }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin: 20px 0;
    }
    .metric-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .metric-label { font-size: 12px; color: #64748b; font-weight: 500; text-transform: uppercase; }
    .metric-val { font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    
    @media print {
      body { padding: 0; max-width: 100%; font-size: 12px; }
      .metrics-grid { gap: 8px; }
      .header { margin-bottom: 20px; }
      h2 { page-break-after: avoid; }
      table { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <span class="badge ${
        metadata.verdict === 'BUILD_NOW'
          ? 'badge-build-now'
          : metadata.verdict === 'EARLY_BET'
          ? 'badge-early-bet'
          : metadata.verdict === 'WINDOW_CLOSING'
          ? 'badge-closing'
          : metadata.verdict === 'PASS'
          ? 'badge-pass'
          : 'badge-watch'
      }">${esc(metadata.verdict)}</span>
      <span style="font-size: 12px; color: #64748b;">Emeradar Intelligence Radar</span>
    </div>
    <h1 class="title">${esc(metadata.title)}</h1>
    <div class="meta-bar">
      <span><strong>Report ID:</strong> ${esc(metadata.reportId)}</span>
      <span><strong>Obs Date:</strong> ${esc(metadata.obsDate)}</span>
      <span><strong>Archetype:</strong> ${esc(metadata.recommendedArchetype)}</span>
      <span><strong>Execution Class:</strong> ${esc(metadata.executionClass)}</span>
    </div>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Demand Score (D)</div>
      <div class="metric-val" style="color: #2563eb;">${dPct} <span style="font-size: 13px; color: #64748b;">/ 100</span></div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Commercial (M)</div>
      <div class="metric-val" style="color: #16a34a;">${mPct} <span style="font-size: 13px; color: #64748b;">/ 100</span></div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Window (W)</div>
      <div class="metric-val" style="color: #ea580c;">${wPct} <span style="font-size: 13px; color: #64748b;">/ 100</span></div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Confidence</div>
      <div class="metric-val" style="color: #475569;">${esc(metadata.scores.confidence)}</div>
    </div>
  </div>

  <h2>1. Executive Summary & Radar Verdict</h2>
  <p><strong>Strategic Thesis:</strong> ${esc(section1.thesis)}</p>
  ${
    section1.veteranVerdict
      ? `
  <div class="callout" style="background-color: #f5f3ff; border-left: 4px solid #7c3aed; color: #4c1d95;">
    <strong>🎖️ Veteran Penetration Verdict:</strong> ${esc(section1.veteranVerdict.headline)}<br>
    <div style="margin-top: 6px; font-size: 13px;">
      <span class="badge" style="background-color: #ddd6fe; color: #4c1d95; margin-right: 8px;">${esc(section1.veteranVerdict.penetrationAngle)}</span>
      ${section1.veteranVerdict.structuralReasons.map((r) => `<span style="display: block; margin-top: 4px;">🎯 ${esc(r)}</span>`).join('')}
    </div>
  </div>`
      : ''
  }
  <div class="callout callout-note">
    <strong>Why Now?</strong> ${esc(section1.whyNow)}
  </div>
  <p>💡 <strong>High-Leverage Product Concept:</strong> ${esc(section1.topIdea)}</p>
  <h3>Key Risks & Assumptions</h3>
  <ul>
    ${section1.keyRisks.map((risk) => `<li>${esc(risk)}</li>`).join('')}
  </ul>
  <div class="callout callout-important">
    <strong>Actionable Recommendation:</strong> ${esc(section1.decisionRecommendation)}
  </div>

  <h2>2. Search Demand & Query Clustering</h2>
  <p><strong>Primary Query:</strong> <code>${esc(section2.primaryQuery)}</code> (Velocity: ${section2.queryVelocity}x baseline)</p>
  <p><strong>Search Intent:</strong> ${esc(section2.searchIntent)} &nbsp; <strong>Recommended Shape:</strong> ${esc(section2.recommendedProductShape)}</p>
  <p><strong>Core Job:</strong> ${esc(section2.jobToBeDone)}</p>
  <table>
    <thead>
      <tr>
        <th>Query</th>
        <th>Search Intent</th>
        <th>Volume Tier</th>
      </tr>
    </thead>
    <tbody>
      ${section2.clusterQueries.map((q) => `<tr><td><code>${esc(q.query)}</code></td><td>${esc(q.intent)}</td><td>${esc(q.volumeTier)}</td></tr>`).join('')}
    </tbody>
  </table>
  <p><strong>Momentum Assessment:</strong> ${esc(section2.momentumAssessment)}</p>

  <h2>3. Competitive Landscape & SERP Weakness</h2>
  <p><strong>SERP Weakness Score:</strong> ${section3.serpWeaknessScore.toFixed(1)} / 100 (${(section3.weakResultsRatio * 100).toFixed(0)}% vulnerable Top 10 results)</p>
  <p><strong>Homepage / Inner-page Mix:</strong> ${(section3.homepageRatio * 100).toFixed(0)}% / ${(section3.innerPageRatio * 100).toFixed(0)}%</p>
  <table>
    <thead>
      <tr>
        <th>Rank</th>
        <th>Domain</th>
        <th>Title</th>
        <th>Type</th>
        <th>Weakness</th>
      </tr>
    </thead>
    <tbody>
      ${section3.top10Results.map((r) => `<tr>
        <td style="text-align: center; font-weight: 600;">${r.rank}</td>
        <td><strong>${esc(r.domain)}</strong></td>
        <td>${esc(r.title)}</td>
        <td><code>${esc(r.resultType)}</code></td>
        <td>${r.isWeak ? `<span style="color: #dc2626; font-weight: 600;">WEAK</span> (${esc(r.weaknessReason || 'Outdated/UGC')})` : '<span style="color: #16a34a;">STRONG</span>'}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <h2>4. Commercial Validation & Monetization</h2>
  <table>
    <thead>
      <tr>
        <th>Competitor</th>
        <th>Pricing Model</th>
        <th>Price Range</th>
        <th>Gateways</th>
      </tr>
    </thead>
    <tbody>
      ${section4.paidCompetitors.map((c) => `<tr>
        <td><strong>${esc(c.domain)}</strong></td>
        <td>${esc(c.pricingModel)}</td>
        <td>${esc(c.priceRange)}</td>
        <td>${esc(c.paymentGateways.join(', '))}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p>${esc(section4.monetizationHeadroom)}</p>

  <h2>5. Execution Blueprint & 14-Day Sprint</h2>
  <div class="callout callout-important"><strong>Minimum Execution Brief</strong><br>Core job: ${esc(section5.executionBrief.coreJob)}<br>MVP page type: ${esc(section5.executionBrief.mvpPageType)}<br>Core action: ${esc(section5.executionBrief.coreAction)}</div>
  <h3>Initial Pages</h3>
  <ul>${section5.executionBrief.initialPages.map((p) => `<li><code>${esc(p.path)}</code>: ${esc(p.purpose)}</li>`).join('')}</ul>
  <p><strong>Recommended Stack:</strong> ${esc(section5.recommendedStack.frontend)} | ${esc(section5.recommendedStack.database)} | ${esc(section5.recommendedStack.hosting)}</p>
  ${section5.sprintPlan14d.map((s) => `
    <h3>${esc(s.phase)} (${esc(s.days)})</h3>
    <ul>
      ${s.deliverables.map((d) => `<li>${esc(d)}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>6. Kill Criteria & Invalidation Alerts</h2>
  <div class="callout callout-warning">
    <strong>Automatic Kill Rules:</strong>
    <ul>
      ${section6.activeRules.map((r) => `<li><strong>${esc(r.code)}:</strong> ${esc(r.rule)} &mdash; <em>${esc(r.rationale)}</em></li>`).join('')}
    </ul>
  </div>
  <p style="font-size: 13px; color: #64748b; margin-top: 16px;">${esc(section6.radarWatchGuidance)}</p>

  ${
    report.goalSimulator
      ? `
  <h2>7. Goal &amp; ROI Simulator (Builder Unit Economics)</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>Target / Value</th>
        <th>Benchmark &amp; Guidance</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Target Monthly Revenue</strong></td>
        <td><strong style="color: #16a34a; font-size: 15px;">$${report.goalSimulator.defaultMonthlyTargetUSD.toLocaleString()}</strong> / mo</td>
        <td>Builder baseline revenue target</td>
      </tr>
      <tr>
        <td><strong>Calibrated KD</strong></td>
        <td><strong>${report.goalSimulator.estimatedKd}</strong> / 100</td>
        <td>Target DR range: <strong>${esc(report.goalSimulator.targetDrRange)}</strong></td>
      </tr>
      <tr>
        <td><strong>Required Referring Domains</strong></td>
        <td><strong>${report.goalSimulator.requiredDomainsLow} &ndash; ${report.goalSimulator.requiredDomainsHigh}</strong> unique domains</td>
        <td>Calculated using non-linear KD domain curve</td>
      </tr>
      <tr>
        <td><strong>Estimated Link Acquisition Budget</strong></td>
        <td><strong>$${(report.goalSimulator.requiredDomainsLow * 100).toLocaleString()} &ndash; $${Math.round(report.goalSimulator.requiredDomainsHigh * 125).toLocaleString()}</strong></td>
        <td>Tiered outreach &amp; link acquisition</td>
      </tr>
      <tr>
        <td><strong>Keyword Golden Ratio (KGR)</strong></td>
        <td><code>${report.goalSimulator.kgrRatio.toFixed(3)}</code></td>
        <td>${report.goalSimulator.kgrRatio < 0.25 ? '<span style="color: #16a34a; font-weight: 600;">✅ &lt; 0.25 (Fast rank candidate)</span>' : 'Standard difficulty tier'}</td>
      </tr>
      <tr>
        <td><strong>Extended KGR (EKGR)</strong></td>
        <td><code>${report.goalSimulator.ekgrRatio.toFixed(3)}</code></td>
        <td>${report.goalSimulator.ekgrRatio < 1.0 ? '<span style="color: #16a34a; font-weight: 600;">✅ &lt; 1.0 (High opportunity)</span>' : 'Standard tier'}</td>
      </tr>
      <tr>
        <td><strong>Monthly Volume Modeling</strong></td>
        <td>~${report.goalSimulator.monthlyVolumeEstimate.toLocaleString()} visits/mo</td>
        <td>Cluster organic search volume estimate</td>
      </tr>
    </tbody>
  </table>
  <h3>Modeling Assumptions</h3>
  <ul>
    ${report.goalSimulator.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}
  </ul>`
      : ''
  }
</body>
</html>`;
}
