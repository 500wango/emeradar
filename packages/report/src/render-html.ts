import {
  OpportunityReportData,
  VerdictBasis,
  Section4CommercialValidation,
} from './types';
import { Locale } from '@emeradar/core';
import {
  formatVerdict,
  formatArchetype,
  formatBand,
  formatExecutionClass,
  formatSearchIntent,
  formatResultType,
  formatPricingModel,
  formatBarrierToEntry,
  formatIndieEntrantDensity,
  formatShadowChannel,
  formatPresence,
  formatScoringFlag,
} from './localization';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]!));
}

/**
 * 「判定依据」面板。与 Markdown 渲染同源：结论可复核，依据缺失时如实说明。
 */
function renderDecisionBasisHtml(basis: VerdictBasis | undefined, locale: Locale): string {
  const isZh = locale === 'zh-CN';
  const heading = `<h3>🧭 ${isZh ? '判定依据（账本留存）' : 'Decision Basis (Ledger Record)'}</h3>`;
  const state = basis?.state ?? 'NOT_RETAINED';

  if (!basis || state === 'NOT_RETAINED') {
    return `${heading}
  <div class="callout callout-note">
    ${
      isZh
        ? '此记录早于「判定依据留存」功能：账本只封存了裁决结果，没有留下当时的规则轨迹与评分标志。结论本身仍然有效，但无法回溯"为什么是它"。自账本 v2 起，此后每一期判定都可复核。'
        : 'This record predates decision-basis retention: the ledger sealed the verdict but not the rule trace or scoring flags behind it. The conclusion still stands, but "why this verdict" cannot be reconstructed. Every verdict from ledger v2 onward is fully auditable.'
    }
  </div>`;
  }

  const parts: string[] = [heading];

  if (basis.isCompensated) {
    parts.push(`  <div class="callout" style="background-color: #fef3c7; border-left: 4px solid #d97706; color: #92400e;">
    <strong>⚠️ ${isZh ? '这是一条补偿判定' : 'This is a compensated verdict'}</strong><br>
    ${
      isZh
        ? '需求爆发（D=高）叠加竞争窗口全开（W=高）时，系统允许商业验证仅到中等（M=中）就给出「立即构建」。标准规则要求 M 必须为高 —— 请把它读作"值得抢先卡位、但变现方式仍需你自己验证"的机会。'
        : 'With demand spiking (D=HIGH) and the window fully open (W=HIGH), the system permits BUILD_NOW at only MEDIUM commercial validation. The standard rule requires M=HIGH — read it as "worth racing to own, but monetization still needs your own validation".'
    }
  </div>`);
  }

  const rawDiffers = basis.rawVerdict && basis.rawVerdict !== basis.publishedVerdict;
  parts.push(`  <ul>
    <li><strong>${isZh ? '封存裁决' : 'Sealed verdict'}</strong>：<code>${esc(basis.publishedVerdict)}</code></li>
    ${
      rawDiffers
        ? `<li><strong>${isZh ? '去抖前原始值' : 'Raw pre-debounce verdict'}</strong>：<code>${esc(
            basis.rawVerdict
          )}</code>（${isZh ? '本期的发布值被去抖规则压住' : 'the published value was held back by debounce'}）</li>`
        : ''
    }
    ${
      basis.rulesTriggered.length > 0
        ? `<li><strong>${isZh ? '命中规则' : 'Rules triggered'}</strong>：${basis.rulesTriggered
            .map((r) => `<code>${esc(r)}</code>`)
            .join(' ')}</li>`
        : ''
    }
  </ul>`);

  if (basis.flags.length > 0) {
    parts.push(`  <ul style="margin-top: 0;">
    ${basis.flags
      .map((f) => `<li><code>${esc(f)}</code> — ${esc(formatScoringFlag(f, locale))}</li>`)
      .join('')}
  </ul>`);
  } else {
    parts.push(
      `  <p style="font-size: 13px; color: #64748b;">${isZh ? '本期没有命中任何评分标志。' : 'No scoring flags were triggered this cycle.'}</p>`
    );
  }

  if (basis.reasons) {
    parts.push(`  <table>
    <thead><tr><th>${isZh ? '维度' : 'Axis'}</th><th>${isZh ? '判定理由' : 'Reason'}</th></tr></thead>
    <tbody>
      <tr><td>${isZh ? '搜索需求 (D)' : 'Demand (D)'}</td><td>${esc(basis.reasons.dReason)}</td></tr>
      <tr><td>${isZh ? '商业验证 (M)' : 'Commercial (M)'}</td><td>${esc(basis.reasons.mReason)}</td></tr>
      <tr><td>${isZh ? '竞争窗口 (W)' : 'Window (W)'}</td><td>${esc(basis.reasons.wReason)}</td></tr>
      <tr><td>${isZh ? '裁决' : 'Verdict'}</td><td>${esc(basis.reasons.verdictReason)}</td></tr>
    </tbody>
  </table>`);
  }

  if (basis.hashVersion === 3 && basis.predictionSpec !== undefined) {
    parts.push(`<p><strong>${isZh ? '封存预测规格' : 'Sealed prediction specification'}</strong>: <code>${esc(JSON.stringify(basis.predictionSpec))}</code></p>`);
  }

  if (basis.hashVersion !== undefined) {
    parts.push(
      `  <p style="font-size: 12px; color: #64748b;">${isZh ? '账本哈希版本' : 'Ledger hash version'}：<code>v${basis.hashVersion}</code>${
        basis.hashVersion >= 2
          ? isZh
            ? ' —— 本行参与可复核的哈希链。'
            : ' — this row participates in the verifiable hash chain.'
          : ''
      }</p>`
    );
  }

  return parts.join('\n');
}

/**
 * 负面信号筛查面板；与 Markdown 渲染同源。
 */
function renderNegativeSignalHtml(
  check: Section4CommercialValidation['negativeSignalCheck'],
  locale: Locale
): string {
  const isZh = locale === 'zh-CN';
  const parts: string[] = [
    `  <div class="callout ${check.passed ? 'callout-note' : 'callout-important'}">
    <strong>${
      check.passed
        ? isZh
          ? '✅ 负面信号筛查通过'
          : '✅ Negative signal screen passed'
        : isZh
          ? '⚠️ 负面信号筛查存在告警'
          : '⚠️ Negative signal screen raised warnings'
    }</strong>`,
  ];

  for (const finding of check.findings ?? []) {
    parts.push(`    <div style="margin-top: 4px;">• ${esc(finding)}</div>`);
  }

  const flags = check.flags ?? [];
  if (flags.length > 0) {
    parts.push(
      `    <div style="margin-top: 8px; font-size: 13px;"><strong>${isZh ? '本期评分标志' : 'Scoring flags this cycle'}：</strong></div>`,
      ...flags.map(
        (f) => `    <div style="font-size: 13px;">• <code>${esc(f)}</code> — ${esc(formatScoringFlag(f, locale))}</div>`
      )
    );
  } else if (check.state === 'NOT_RETAINED') {
    parts.push(
      `    <div style="margin-top: 8px; font-size: 13px; color: #64748b;">${
        isZh
          ? '（此记录早于评分标志留存功能，本次无标志可展示。）'
          : '(This record predates flag retention; no flags are available to display.)'
      }</div>`
    );
  }

  parts.push('  </div>');
  return parts.join('\n');
}

export function renderReportToHtml(report: OpportunityReportData): string {
  const { metadata, section1, section2, section3, section4, section5, section6 } = report;
  const isZh = metadata.locale === 'zh-CN';

  // 只出档位：01-PRD.md F4 禁止把基点渲染成百分制。
  const dBand = formatBand(metadata.scores.dBand, metadata.locale);
  const mBand = formatBand(metadata.scores.mBand, metadata.locale);
  const wBand = formatBand(metadata.scores.wBand, metadata.locale);

  const verdictBadgeClass =
    metadata.verdict === 'BUILD_NOW'
      ? 'badge-build-now'
      : metadata.verdict === 'EARLY_BET'
      ? 'badge-early-bet'
      : metadata.verdict === 'WINDOW_CLOSING'
      ? 'badge-closing'
      : metadata.verdict === 'PASS'
      ? 'badge-pass'
      : 'badge-watch';

  const verdictLabel = isZh
    ? formatVerdict(metadata.verdict, 'zh-CN', true)
    : metadata.verdict.replace(/_/g, ' ');

  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${isZh ? '商业机会深度研究报告：' : 'Opportunity Research Report: '}${esc(metadata.title)}</title>
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
    .badge-build-now { background-color: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
    .badge-early-bet { background-color: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }
    .badge-closing { background-color: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
    .badge-watch { background-color: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .badge-pass { background-color: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
    
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
      <span class="badge ${verdictBadgeClass}">${esc(verdictLabel)}</span>
      <span style="font-size: 12px; color: #64748b;">Emeradar Intelligence Radar</span>
    </div>
    <h1 class="title">${esc(metadata.title)}</h1>
    <div class="meta-bar">
      <span><strong>${isZh ? '报告编号:' : 'Report ID:'}</strong> ${esc(metadata.reportId)}</span>
      <span><strong>${isZh ? '观测日期:' : 'Obs Date:'}</strong> ${esc(metadata.obsDate)}</span>
      <span><strong>${isZh ? '推荐形态:' : 'Archetype:'}</strong> ${esc(formatArchetype(metadata.recommendedArchetype, isZh ? 'zh-CN' : 'en-US'))}</span>
      <span><strong>${isZh ? '开发周期等级:' : 'Execution Class:'}</strong> ${esc(formatExecutionClass(metadata.executionClass, isZh ? 'zh-CN' : 'en-US'))}</span>
    </div>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">${isZh ? '搜索需求 (D)' : 'Demand (D)'}</div>
      <div class="metric-val" style="color: #2563eb;">${esc(dBand)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">${isZh ? '商业变现验证 (M)' : 'Commercial (M)'}</div>
      <div class="metric-val" style="color: #16a34a;">${esc(mBand)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">${isZh ? '竞争进入窗口 (W)' : 'Window (W)'}</div>
      <div class="metric-val" style="color: #ea580c;">${esc(wBand)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">${isZh ? '数据置信度' : 'Confidence'}</div>
      <div class="metric-val" style="color: #475569;">${esc(metadata.scores.confidence === 'HIGH' && isZh ? '高置信度' : metadata.scores.confidence)}</div>
    </div>
  </div>

  <h2>${isZh ? '1. 执行摘要与雷达裁决' : '1. Executive Summary & Radar Verdict'}</h2>
  <p><strong>${isZh ? '核心战略论点：' : 'Strategic Thesis:'}</strong> ${esc(section1.thesis)}</p>
  ${
    section1.veteranVerdict
      ? `
  <div class="callout" style="background-color: #f5f3ff; border-left: 4px solid #7c3aed; color: #4c1d95;">
    <strong>🎖️ ${isZh ? '独立站老兵渗透战术：' : 'Veteran Penetration Verdict:'}</strong> ${esc(section1.veteranVerdict.headline)}<br>
    <div style="margin-top: 6px; font-size: 13px;">
      <span class="badge" style="background-color: #ddd6fe; color: #4c1d95; margin-right: 8px;">${esc(section1.veteranVerdict.penetrationAngle)}</span>
      ${section1.veteranVerdict.structuralReasons.map((r) => `<span style="display: block; margin-top: 4px;">🎯 ${esc(r)}</span>`).join('')}
    </div>
  </div>`
      : ''
  }
  <div class="callout callout-note">
    <strong>${isZh ? '为何是现在？(Why Now)' : 'Why Now?'}</strong> ${esc(section1.whyNow)}
  </div>
  <p>💡 <strong>${isZh ? '核心产品概念原型：' : 'High-Leverage Product Concept:'}</strong> ${esc(section1.topIdea)}</p>
  <h3>${isZh ? '关键风险与假设' : 'Key Risks & Assumptions'}</h3>
  <ul>
    ${section1.keyRisks.map((risk) => `<li>${esc(risk)}</li>`).join('')}
  </ul>
  <div class="callout callout-important">
    <strong>${isZh ? '落地行动建议：' : 'Actionable Recommendation:'}</strong> ${esc(section1.decisionRecommendation)}
  </div>

  ${renderDecisionBasisHtml(section1.decisionBasis, metadata.locale)}

  <h2>${isZh ? '2. 搜索需求与查询词图谱分析' : '2. Search Demand & Query Clustering'}</h2>
  <p><strong>${isZh ? '种子查询词：' : 'Primary Query:'}</strong> <code>${esc(section2.primaryQuery)}</code> (${isZh ? '动量增速' : 'Velocity'}: ${section2.queryVelocity}x)</p>
  <p><strong>${isZh ? '搜索意图：' : 'Search Intent:'}</strong> ${esc(formatSearchIntent(section2.searchIntent, isZh ? 'zh-CN' : 'en-US'))} &nbsp; <strong>${isZh ? '建议落地形态：' : 'Recommended Shape:'}</strong> ${esc(section2.recommendedProductShape)}</p>
  <p><strong>${isZh ? '解决核心任务：' : 'Core Job:'}</strong> ${esc(section2.jobToBeDone)}</p>
  <table>
    <thead>
      <tr>
        <th>${isZh ? '搜索关键词 (Google Query)' : 'Query'}</th>
        <th>${isZh ? '搜索意图' : 'Search Intent'}</th>
        <th>${isZh ? '搜索量等级' : 'Volume Tier'}</th>
      </tr>
    </thead>
    <tbody>
      ${section2.clusterQueries.map((q) => `<tr><td><code>${esc(q.query)}</code></td><td>${esc(formatSearchIntent(q.intent, isZh ? 'zh-CN' : 'en-US'))}</td><td>${esc(q.volumeTier ?? '—')}</td></tr>`).join('')}
    </tbody>
  </table>
  <p><strong>${isZh ? '动量综合评估：' : 'Momentum Assessment:'}</strong> ${esc(section2.momentumAssessment)}</p>

  <h2>${isZh ? '3. 竞争格局与搜索结果薄弱点分析' : '3. Competitive Landscape & SERP Weakness'}</h2>
  <p><strong>${isZh ? 'SERP 薄弱度得分：' : 'SERP Weakness Score:'}</strong> ${section3.serpWeaknessScore.toFixed(1)} / 100 (${(section3.weakResultsRatio * 100).toFixed(0)}% ${isZh ? '薄弱渗透空隙' : 'vulnerable Top 10 results'})</p>
  <p><strong>${isZh ? '首页 / 内页结构分布：' : 'Homepage / Inner-page Mix:'}</strong> ${(section3.homepageRatio * 100).toFixed(0)}% / ${(section3.innerPageRatio * 100).toFixed(0)}%</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>${isZh ? '目标域名' : 'Domain'}</th>
        <th>${isZh ? '网页原始标题' : 'Title'}</th>
        <th>${isZh ? '类型' : 'Type'}</th>
        <th>${isZh ? '渗透难度' : 'Status'}</th>
        <th>${isZh ? '薄弱原因' : 'Weakness Reason'}</th>
      </tr>
    </thead>
    <tbody>
      ${section3.top10Results.map((r) => `<tr>
        <td style="text-align: center; font-weight: 600;">${r.rank}</td>
        <td><strong>${esc(r.domain)}</strong></td>
        <td>${esc(r.title)}</td>
        <td><code>${esc(formatResultType(r.resultType, isZh ? 'zh-CN' : 'en-US'))}</code></td>
        <td>${r.isWeak ? `<span style="color: #dc2626; font-weight: 600;">${isZh ? '🔴 薄弱' : 'WEAK'}</span>` : `<span style="color: #16a34a;">${isZh ? '🟢 强劲' : 'STRONG'}</span>`}</td>
        <td style="font-size: 12px; color: #64748b;">${esc(r.weaknessReason || '')}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ${
    section3.indieCompetitionAudit
      ? `
  <div style="margin-top: 24px; padding: 20px; border-radius: 8px; background-color: #fffbeb; border: 1px solid #fef3c7;">
    <h3 style="margin-top: 0; color: #92400e; font-size: 16px;">🕵️ ${isZh ? '中小开发者水下生态与技术壁垒审计' : 'Indie Competition & Defense Moat Audit'}</h3>
    <p style="font-size: 13px; color: #78350f; margin-bottom: 12px; line-height: 1.5;">
      <strong>${isZh ? '巨头盲区警示：' : 'Strategic Notice: '}</strong>${isZh ? '大厂看不上此类极度垂直的长尾场景，但中小开发者极易凭借开源库扎堆涌入。' : 'Tech giants ignore these micro-niches; true competition comes from agile indie builders deploying fast wrappers.'}
    </p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
      <div style="background: #ffffff; padding: 12px; border-radius: 6px; border: 1px solid #fde68a;">
        <span style="font-size: 11px; color: #92400e; text-transform: uppercase; font-weight: 600;">${isZh ? '技术实现壁垒' : 'Barrier to Entry'}</span>
        <div style="font-size: 14px; font-weight: 700; color: #78350f; margin-top: 2px;">${esc(formatBarrierToEntry(section3.indieCompetitionAudit.barrierToEntry, isZh ? 'zh-CN' : 'en-US'))}</div>
        <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">${esc(section3.indieCompetitionAudit.barrierReason)}</p>
      </div>
      <div style="background: #ffffff; padding: 12px; border-radius: 6px; border: 1px solid #fde68a;">
        <span style="font-size: 11px; color: #92400e; text-transform: uppercase; font-weight: 600;">${isZh ? '中小开发者涌入密度' : 'Indie Entrant Density'}</span>
        <div style="font-size: 14px; font-weight: 700; color: #78350f; margin-top: 2px;">${esc(formatIndieEntrantDensity(section3.indieCompetitionAudit.indieEntrantDensity, isZh ? 'zh-CN' : 'en-US'))}</div>
        ${section3.indieCompetitionAudit.densityWarning ? `<p style="font-size: 12px; color: #b45309; margin: 4px 0 0 0; font-weight: 500;">⚠️ ${esc(section3.indieCompetitionAudit.densityWarning)}</p>` : ''}
      </div>
    </div>

    <h4 style="font-size: 13px; color: #92400e; margin: 12px 0 6px 0;">${isZh ? '水下竞争渠道渗透观测' : 'Shadow Channels Penetration Audit'}</h4>
    <table style="background: #ffffff; border: 1px solid #fde68a; margin-bottom: 12px;">
      <thead>
        <tr style="background: #fef3c7;">
          <th style="color: #92400e;">${isZh ? '竞争渠道' : 'Shadow Channel'}</th>
          <th style="color: #92400e; text-align: center;">${isZh ? '渗透状态' : 'Presence'}</th>
          <th style="color: #92400e;">${isZh ? '生态观测' : 'Ecological Observation'}</th>
        </tr>
      </thead>
      <tbody>
        ${section3.indieCompetitionAudit.shadowChannels.map((c) => `<tr>
          <td><strong>${esc(formatShadowChannel(c.channel, isZh ? 'zh-CN' : 'en-US'))}</strong></td>
          <td style="text-align: center;"><code>${esc(formatPresence(c.presence, isZh ? 'zh-CN' : 'en-US'))}</code></td>
          <td style="font-size: 12px; color: #475569;">${esc(c.observation)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div style="background: #fefce8; padding: 10px 14px; border-radius: 6px; border-left: 3px solid #f59e0b; font-size: 12px; color: #78350f;">
      <strong>🛡️ ${isZh ? '护城河建议：' : 'Defensive Moat Strategy: '}</strong>${esc(section3.indieCompetitionAudit.defensiveMoatAdvice)}
    </div>
  </div>`
      : ''
  }

  <h2>${isZh ? '4. 商业验证与变现天花板评估' : '4. Commercial Validation & Monetization'}</h2>
  <p><strong>${isZh ? '已交叉验证证据数' : 'Total Corroborating Signals'}：</strong>${section4.evidenceCount.total}${
    isZh
      ? ` 条（${section4.evidenceCount.observed} 条直接抓取观测，${section4.evidenceCount.selfReported} 条竞品公开声明）`
      : ` (${section4.evidenceCount.observed} directly observed, ${section4.evidenceCount.selfReported} self-reported)`
  }</p>
  <table>
    <thead>
      <tr>
        <th>${isZh ? '竞品域名' : 'Competitor Domain'}</th>
        <th>${isZh ? '收费模式' : 'Pricing Model'}</th>
        <th>${isZh ? '价格区间' : 'Price Range'}</th>
        <th>${isZh ? '支付通道' : 'Payment Gateways'}</th>
      </tr>
    </thead>
    <tbody>
      ${section4.paidCompetitors.map((c) => `<tr>
        <td><strong>${esc(c.domain)}</strong></td>
        <td>${esc(formatPricingModel(c.pricingModel, isZh ? 'zh-CN' : 'en-US'))}</td>
        <td>${esc(c.priceRange)}</td>
        <td>${esc(c.paymentGateways.join(', '))}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p>${esc(section4.monetizationHeadroom)}</p>

  ${renderNegativeSignalHtml(section4.negativeSignalCheck, metadata.locale)}

  <h2>${isZh ? '5. 落地执行蓝图与 14 天冲刺计划' : '5. Execution Blueprint & 14-Day Sprint'}</h2>
  <p><strong>${isZh ? '推荐技术栈：' : 'Stack:'}</strong> ${esc(section5.recommendedStack.frontend)} &bull; ${esc(section5.recommendedStack.database)}</p>
  <div class="callout callout-important">
    <strong>${isZh ? '最小可行执行简报：' : 'Minimum Execution Brief:'}</strong> ${esc(section5.executionBrief.coreAction)}
  </div>
  <ul>
    ${section5.sprintPlan14d.map((s) => `<li><strong>${esc(s.phase)} (${esc(s.days)})</strong>: ${esc(s.deliverables.join('；'))}</li>`).join('')}
  </ul>

  <h2>${isZh ? '6. 叫停与撤出防护红线 (Kill Criteria)' : '6. Kill Criteria & Invalidation Triggers'}</h2>
  <ul>
    ${section6.activeRules.map((rule) => `<li><strong>${esc(rule.code)}:</strong> ${esc(rule.rule)} &mdash; <em style="color: #b91c1c;">${esc(rule.rationale)}</em></li>`).join('')}
  </ul>

  ${
    report.goalSimulator
      ? `
  <h2>${isZh ? '7. 商业收益与外链预算测算 (Goal &amp; ROI Simulator)' : '7. Goal &amp; ROI Simulator (Builder Unit Economics)'}</h2>
  <table>
    <thead>
      <tr>
        <th>${isZh ? '测算指标' : 'Metric'}</th>
        <th>${isZh ? '目标/预估数值' : 'Target / Value'}</th>
        <th>${isZh ? '业务解读与基准' : 'Benchmark &amp; Guidance'}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${isZh ? '目标月经常性收入 (MRR)' : 'Target Monthly Revenue'}</strong></td>
        <td><strong style="color: #16a34a; font-size: 15px;">$${report.goalSimulator.defaultMonthlyTargetUSD.toLocaleString(isZh ? 'zh-CN' : 'en-US')}</strong> / ${isZh ? '月' : 'mo'}</td>
        <td>${isZh ? '独立开发者基准月收入目标' : 'Builder baseline revenue target'}</td>
      </tr>
      <tr>
        <td><strong>${isZh ? 'Ahrefs 标定难度 (KD)' : 'Calibrated KD'}</strong></td>
        <td><strong>${report.goalSimulator.estimatedKd}</strong> / 100</td>
        <td>${isZh ? '目标域名权重范围:' : 'Target DR range:'} <strong>${esc(report.goalSimulator.targetDrRange)}</strong></td>
      </tr>
      <tr>
        <td><strong>${isZh ? '所需反向外链域名数 (RD)' : 'Required Referring Domains'}</strong></td>
        <td><strong>${report.goalSimulator.requiredDomainsLow} &ndash; ${report.goalSimulator.requiredDomainsHigh}</strong> ${isZh ? '个独立域名' : 'unique domains'}</td>
        <td>${isZh ? '基于非线性 KD 域名对照曲线测算' : 'Calculated using non-linear KD domain curve'}</td>
      </tr>
      <tr>
        <td><strong>${isZh ? '预估外链获取预算' : 'Estimated Link Acquisition Budget'}</strong></td>
        <td><strong>$${(report.goalSimulator.requiredDomainsLow * 100).toLocaleString(isZh ? 'zh-CN' : 'en-US')} &ndash; $${Math.round(report.goalSimulator.requiredDomainsHigh * 125).toLocaleString(isZh ? 'zh-CN' : 'en-US')}</strong></td>
        <td>${isZh ? '阶梯化外链建设预算' : 'Tiered outreach &amp; link acquisition'}</td>
      </tr>
      <tr>
        <td><strong>${isZh ? '黄金关键词比率 (KGR)' : 'Keyword Golden Ratio (KGR)'}</strong></td>
        <td><code>${report.goalSimulator.kgrRatio.toFixed(3)}</code></td>
        <td>${report.goalSimulator.kgrRatio < 0.25 ? `<span style="color: #16a34a; font-weight: 600;">✅ &lt; 0.25 (${isZh ? '具备极速上词潜质' : 'Fast rank candidate'})</span>` : isZh ? '标准难度' : 'Standard difficulty tier'}</td>
      </tr>
      <tr>
        <td><strong>${isZh ? '聚合长尾 KGR (EKGR)' : 'Extended KGR (EKGR)'}</strong></td>
        <td><code>${report.goalSimulator.ekgrRatio.toFixed(3)}</code></td>
        <td>${report.goalSimulator.ekgrRatio < 1.0 ? `<span style="color: #16a34a; font-weight: 600;">✅ &lt; 1.0 (${isZh ? '潜力良好' : 'High opportunity'})</span>` : isZh ? '标准难度' : 'Standard tier'}</td>
      </tr>
      <tr>
        <td><strong>${isZh ? '聚合词月度搜索潜量' : 'Monthly Volume Modeling'}</strong></td>
        <td>~${report.goalSimulator.monthlyVolumeEstimate.toLocaleString(isZh ? 'zh-CN' : 'en-US')} ${isZh ? '次/月' : 'visits/mo'}</td>
        <td>${isZh ? '整个意图词簇的月度总搜索量估算' : 'Cluster organic search volume estimate'}</td>
      </tr>
    </tbody>
  </table>
  <h3>${isZh ? '核心测算假设条件' : 'Modeling Assumptions'}</h3>
  <ul>
    ${report.goalSimulator.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}
  </ul>`
      : ''
  }
</body>
</html>`;
}
