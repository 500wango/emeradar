import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateOpportunityReport,
  renderReportToMarkdown,
  renderReportToHtml,
  deriveBasisState,
} from '../src';

describe('Opportunity Report Unit Tests', () => {
  const sampleInput = {
    reportId: 'rpt_test_01',
    opportunity: {
      id: 'opp_shopify_tax',
      title: 'Shopify Sales Tax Calculator for Multi-State Vendors',
      slug: 'shopify-sales-tax-calculator',
      marketCountry: 'US',
      researchLanguage: 'en-US',
    },
    scoring: {
      verdict: 'BUILD_NOW' as const,
      rawVerdict: 'BUILD_NOW' as const,
      lifecycle: 'EARLY_WINDOW' as const,
      confidence: 'HIGH' as const,
      confidenceScore: 0.85,
      dScore: 8400,
      mScore: 7600,
      wScore: 8100,
      dBand: 'HIGH' as const,
      mBand: 'HIGH' as const,
      wBand: 'HIGH' as const,
      flags: [],
      explanation: {
        dReason: 'High search volume with 8 new queries in 7d',
        mReason: 'Paid competitors with Stripe Tax integration',
        wReason: 'Outdated blog posts occupying top 3 search results',
        verdictReason: 'Strong D-M-W signals',
        rulesTriggered: ['RULE_BUILD_NOW'],
      },
      recommendedArchetype: 'LIGHTWEIGHT_TOOL' as const,
      executionClass: 'S' as const,
    },
    obsDate: '2026-09-25',
    primaryQuery: 'shopify sales tax calculator',
  };

  it('generates complete 6-section structured report data', () => {
    const report = generateOpportunityReport(sampleInput);

    assert.strictEqual(report.metadata.reportId, 'rpt_test_01');
    assert.strictEqual(report.metadata.verdict, 'BUILD_NOW');
    assert.strictEqual(report.section1.decisionRecommendation.includes('GO'), true);
    assert.strictEqual(report.section2.primaryQuery, 'shopify sales tax calculator');
    assert.strictEqual(report.section2.searchIntent, 'TRANSACTIONAL');
    assert.strictEqual(report.section2.siteStrategy, 'INDEPENDENT_SITE');
    assert.strictEqual(report.section3.top10Results.length, 0);
    assert.strictEqual(report.section4.paidCompetitors.length, 0);
    assert.strictEqual(report.section2.autocompleteSignals.length, 0);
    assert.strictEqual(report.section5.archetype, 'LIGHTWEIGHT_TOOL');
    assert.strictEqual(report.section5.targetTimeframeDays, 14);
    assert.strictEqual(report.section5.executionBrief.initialPages.length, 3);
    assert.strictEqual(report.section6.activeRules.length, 0);

    // Verify Indie Competition & Moat Audit
    assert.ok(report.section3.indieCompetitionAudit);
    assert.strictEqual(report.section3.indieCompetitionAudit.barrierToEntry, 'LOW');
    assert.strictEqual(report.section3.indieCompetitionAudit.indieEntrantDensity, 'HIGH');
    assert.ok(report.section3.indieCompetitionAudit.shadowChannels.length >= 3);
    assert.ok(report.section3.indieCompetitionAudit.defensiveMoatAdvice.length > 0);
  });

  it('renders report to GitHub Flavored Markdown with tables and alerts', () => {
    const report = generateOpportunityReport(sampleInput);
    const md = renderReportToMarkdown(report);

    assert.ok(md.includes('# 🎯 Opportunity Research Report:'));
    assert.ok(md.includes('## 1. 📊 Executive Summary & Radar Verdict'));
    assert.ok(md.includes('## 2. 🔍 Search Demand & Query Clustering'));
    assert.ok(md.includes('## 3. 🛡️ Competitive Landscape & SERP Weakness'));
    assert.ok(md.includes('## 4. 💰 Commercial Validation & Monetization'));
    assert.ok(md.includes('## 5. 🛠️ Execution Blueprint & 14-Day Sprint'));
    assert.ok(md.includes('## 6. 🚨 Kill Criteria & Radar Invalidation Alerts'));
    assert.ok(md.includes('> [!IMPORTANT]'));
    assert.ok(md.includes('> [!WARNING]'));
  });

  it('renders report to standalone printable HTML', () => {
    const report = generateOpportunityReport(sampleInput);
    const html = renderReportToHtml(report);

    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('@media print'));
    assert.ok(html.includes('Shopify Sales Tax Calculator'));
    // 三轴只出档位：01-PRD.md F4 禁止把基点（8400）除以 100 渲染成 84.0 分。
    assert.ok(html.includes('High'));
    assert.ok(!html.includes('84.0'));
    assert.ok(!html.includes('8400'));
  });

  it('classifies SERP homepage and inner-page URLs by pathname', () => {
    const report = generateOpportunityReport({
      ...sampleInput,
      top10Serp: [
        { rank: 1, url: 'https://example.com', domain: 'example.com', title: 'Home', resultType: 'ORGANIC', isWeak: false },
        { rank: 2, url: 'https://example.com/tool', domain: 'example.com', title: 'Tool', resultType: 'ORGANIC', isWeak: true },
      ],
    });

    assert.strictEqual(report.section3.homepageRatio, 0.5);
    assert.strictEqual(report.section3.innerPageRatio, 0.5);
  });

  it('generates veteranVerdict and goalSimulator with calibrated KD and domains', () => {
    const report = generateOpportunityReport({
      ...sampleInput,
      top10Serp: [
        { rank: 1, url: 'https://huge-corp.com/docs/tax', domain: 'huge-corp.com', title: 'Tax Docs', resultType: 'ORGANIC', isWeak: true, pageDiscount: 0.45, isHomepage: false },
        { rank: 2, url: 'https://newblog.io/calculator', domain: 'newblog.io', title: 'Calculator', resultType: 'ORGANIC', isWeak: true, domainDr: 18, isHomepage: false },
        { rank: 3, url: 'https://comp.com', domain: 'comp.com', title: 'Home', resultType: 'ORGANIC', isWeak: false, domainDr: 65, isHomepage: true },
      ],
      searchVolume: 1200,
      allintitleCount: 42,
    });

    // Check Veteran Verdict
    assert.ok(report.section1.veteranVerdict);
    assert.strictEqual(typeof report.section1.veteranVerdict.headline, 'string');
    assert.strictEqual(typeof report.section1.veteranVerdict.penetrationAngle, 'string');
    assert.ok(report.section1.veteranVerdict.structuralReasons.length > 0);

    // Check Goal Simulator
    assert.ok(report.goalSimulator);
    assert.strictEqual(report.goalSimulator.defaultMonthlyTargetUSD, 2000);
    assert.strictEqual(typeof report.goalSimulator.monthlyVolumeEstimate, 'number');
    assert.strictEqual(typeof report.goalSimulator.estimatedKd, 'number');
    assert.ok(report.goalSimulator.requiredDomainsLow >= 0);
    assert.ok(report.goalSimulator.requiredDomainsHigh >= report.goalSimulator.requiredDomainsLow);
    assert.strictEqual(typeof report.goalSimulator.kgrRatio, 'number');
    assert.strictEqual(typeof report.goalSimulator.ekgrRatio, 'number');
    assert.strictEqual(typeof report.goalSimulator.targetDrRange, 'string');

    // Check Markdown rendering includes Section 7 & Veteran Verdict
    const md = renderReportToMarkdown(report);
    assert.ok(md.includes('### Veteran Penetration Verdict'));
    assert.ok(md.includes('## 7. 🎯 Goal & ROI Simulator (Builder Unit Economics)'));
    assert.ok(md.includes('Ahrefs-Calibrated KD'));

    // Check HTML rendering includes Section 7 & Veteran Verdict
    const html = renderReportToHtml(report);
    assert.ok(html.includes('Veteran Penetration Verdict'));
    assert.ok(html.includes('Goal &amp; ROI Simulator'));
  });

  it('renders thorough Chinese report for zh-CN users', () => {
    const reportZh = generateOpportunityReport({
      ...sampleInput,
      opportunity: {
        id: 'opp_stripe_dispute_compiler',
        title: 'Stripe Dispute Evidence Auto-Compiler & Chargeback Defense',
        slug: 'stripe-dispute-evidence-compiler',
        marketCountry: 'US',
        researchLanguage: 'en-US',
      },
      locale: 'zh-CN',
      top10Serp: [
        {
          rank: 1,
          domain: 'stripe.com',
          title: 'Responding to disputes | Stripe Docs',
          resultType: 'OFFICIAL',
          isWeak: true,
          weaknessReason: 'Generic documentation without downloadable assembler',
        },
      ],
      paidCompetitors: [
        {
          domain: 'chargeblast.com',
          pricingModel: 'SUBSCRIPTION',
          priceRange: '$49 - $199/mo',
          paymentGateways: ['Stripe'],
        },
      ],
    });

    assert.strictEqual(reportZh.metadata.locale, 'zh-CN');
    assert.strictEqual(reportZh.metadata.title, 'Stripe 争议退款证据自动收集与抗辩举证中心');
    assert.ok(reportZh.section1.thesis.includes('针对美区搜索核心词'));
    assert.ok(reportZh.section1.thesis.includes('立即立项'));
    assert.ok(reportZh.section1.decisionRecommendation.includes('建议立即立项开发'));
    assert.strictEqual(reportZh.section5.sprintPlan14d.length, 3);
    assert.ok(reportZh.section5.sprintPlan14d[0].phase.includes('阶段一'));

    // Check Markdown output is fully localized in Chinese
    const mdZh = renderReportToMarkdown(reportZh);
    assert.ok(mdZh.includes('# 🎯 商业机会深度研究报告：'));
    assert.ok(mdZh.includes('## 1. 📊 执行摘要与决策裁决'));
    assert.ok(mdZh.includes('## 2. 🔍 搜索需求与查询词图谱分析'));
    assert.ok(mdZh.includes('## 3. 🛡️ 竞争格局与搜索结果薄弱点分析'));
    assert.ok(mdZh.includes('中小开发者水下生态与技术壁垒审计'));
    assert.ok(mdZh.includes('巨头盲区警示'));
    assert.ok(mdZh.includes('## 4. 💰 商业验证与变现天花板'));
    assert.ok(mdZh.includes('## 5. 🛠️ 14 天冲刺执行蓝图'));
    assert.ok(mdZh.includes('## 6. 🛑 止损与叫停红线'));
    assert.ok(mdZh.includes('## 7. 🎯 商业收益与 SEO 外链预算测算'));
    assert.ok(mdZh.includes('🟢 立即立项 (BUILD NOW)'));

    // Check HTML output is fully localized in Chinese
    const htmlZh = renderReportToHtml(reportZh);
    assert.ok(htmlZh.includes('<html lang="zh-CN">'));
    assert.ok(htmlZh.includes('商业机会深度研究报告：'));
    assert.ok(htmlZh.includes('搜索需求 (D)'));
    assert.ok(htmlZh.includes('高（High）'));
    assert.ok(htmlZh.includes('商业变现验证 (M)'));
    assert.ok(htmlZh.includes('竞争进入窗口 (W)'));
    assert.ok(htmlZh.includes('中小开发者水下生态与技术壁垒审计'));
  });

  it('renders pure English report for en-US users without mixed Chinese', () => {
    const reportEn = generateOpportunityReport({
      ...sampleInput,
      locale: 'en-US',
    });

    const mdEn = renderReportToMarkdown(reportEn);
    assert.ok(mdEn.includes('# 🎯 Opportunity Research Report:'));
    assert.ok(mdEn.includes('## 1. 📊 Executive Summary & Radar Verdict'));
    assert.ok(mdEn.includes('## 2. 🔍 Search Demand & Query Clustering'));
    assert.ok(mdEn.includes('## 3. 🛡️ Competitive Landscape & SERP Weakness'));
    assert.ok(mdEn.includes('Indie Competition & Defense Moat Audit'));
    assert.ok(mdEn.includes('Strategic Alert'));
    assert.ok(mdEn.includes('## 4. 💰 Commercial Validation & Monetization'));
    assert.ok(mdEn.includes('## 5. 🛠️ Execution Blueprint & 14-Day Sprint'));
    assert.ok(mdEn.includes('## 6. 🚨 Kill Criteria & Radar Invalidation Alerts'));
    assert.ok(mdEn.includes('## 7. 🎯 Goal & ROI Simulator (Builder Unit Economics)'));
    // Ensure no Chinese characters in en-US output
    assert.strictEqual(/[\u4e00-\u9fa5]/.test(mdEn), false);

    const htmlEn = renderReportToHtml(reportEn);
    assert.ok(htmlEn.includes('<html lang="en">'));
    assert.ok(htmlEn.includes('Demand (D)'));
    assert.ok(htmlEn.includes('High'));
    assert.ok(htmlEn.includes('Commercial (M)'));
    assert.ok(htmlEn.includes('Window (W)'));
    assert.ok(htmlEn.includes('Indie Competition & Defense Moat Audit'));
    assert.strictEqual(/[\u4e00-\u9fa5]/.test(htmlEn), false);
  });
});

describe('Decision basis (why this verdict)', () => {
  const scoring = {
    verdict: 'BUILD_NOW' as const,
    rawVerdict: 'BUILD_NOW' as const,
    lifecycle: 'EARLY_WINDOW' as const,
    confidence: 'HIGH' as const,
    confidenceScore: 0.85,
    dScore: 8400,
    mScore: 6500,
    wScore: 8100,
    dBand: 'HIGH' as const,
    mBand: 'MEDIUM' as const,
    wBand: 'HIGH' as const,
    flags: [] as string[],
    explanation: {
      dReason: 'Demand breakout confirmed over 45 observation days.',
      mReason: 'Two independent paid competitors; pricing partly decorative.',
      wReason: 'SERP weakness above the penetration threshold.',
      verdictReason: 'Breakout demand compensates for developing commercial proof.',
      rulesTriggered: ['RULE_BUILD_NOW_COMPENSATED'],
    },
    recommendedArchetype: 'LIGHTWEIGHT_TOOL' as const,
    executionClass: 'S' as const,
  };

  const base = {
    reportId: 'rpt_basis_01',
    opportunity: {
      id: 'opp_basis',
      title: 'Basis Fixture Opportunity',
      slug: 'basis-fixture',
      marketCountry: 'US',
      researchLanguage: 'en-US',
    },
    obsDate: '2026-10-11',
    primaryQuery: 'basis fixture query',
  };

  it('defaults to NOT_RETAINED and withholds reasons rather than inventing them', () => {
    const report = generateOpportunityReport({ ...base, scoring });
    assert.strictEqual(report.section1.decisionBasis.state, 'NOT_RETAINED');
    assert.strictEqual(report.section1.decisionBasis.reasons, undefined);
    assert.strictEqual(report.section1.decisionBasis.isCompensated, false);
    assert.deepStrictEqual(report.section1.decisionBasis.flags, []);
    // A placeholder explanation is still supplied to satisfy ScoringOutput, so this
    // asserts the state — not the presence of the field — is what suppresses it.
    assert.ok(scoring.explanation.dReason.length > 0);

    const markdown = renderReportToMarkdown(report);
    const html = renderReportToHtml(report);
    assert.ok(markdown.includes('predates decision-basis retention'));
    assert.ok(html.includes('predates decision-basis retention'));
    assert.ok(!markdown.includes(scoring.explanation.dReason));
    assert.ok(!html.includes(scoring.explanation.dReason));
  });

  it('carries the recorded explanation, rules and compensation marker through to both renderers', () => {
    const report = generateOpportunityReport({ ...base, scoring, basisState: 'RECORDED', hashVersion: 2 });

    const basis = report.section1.decisionBasis;
    assert.strictEqual(basis.state, 'RECORDED');
    assert.strictEqual(basis.isCompensated, true);
    assert.strictEqual(basis.hashVersion, 2);
    assert.deepStrictEqual(basis.rulesTriggered, ['RULE_BUILD_NOW_COMPENSATED']);
    assert.strictEqual(basis.reasons?.mReason, scoring.explanation.mReason);
    assert.strictEqual(basis.reasons?.verdictReason, scoring.explanation.verdictReason);

    for (const rendered of [renderReportToMarkdown(report), renderReportToHtml(report)]) {
      assert.ok(rendered.includes('compensated verdict'));
      assert.ok(rendered.includes(scoring.explanation.mReason));
      assert.ok(rendered.includes('RULE_BUILD_NOW_COMPENSATED'));
      assert.ok(rendered.includes('v2'));
    }
  });

  it('does not mark a standard BUILD_NOW as compensated', () => {
    const report = generateOpportunityReport({
      ...base,
      basisState: 'RECORDED',
      scoring: {
        ...scoring,
        explanation: { ...scoring.explanation, rulesTriggered: ['RULE_BUILD_NOW'] },
      },
    });
    assert.strictEqual(report.section1.decisionBasis.state, 'RECORDED');
    assert.strictEqual(report.section1.decisionBasis.isCompensated, false);
    assert.ok(!renderReportToMarkdown(report).includes('compensated verdict'));
  });

  it('surfaces flags without reasons in the FLAGS_ONLY state', () => {
    const report = generateOpportunityReport({
      ...base,
      scoring: { ...scoring, flags: ['M_NEGATIVE', 'LOW_CONFIDENCE'] },
      basisState: 'FLAGS_ONLY',
    });
    const basis = report.section1.decisionBasis;
    assert.strictEqual(basis.state, 'FLAGS_ONLY');
    assert.deepStrictEqual(basis.flags, ['M_NEGATIVE', 'LOW_CONFIDENCE']);
    assert.strictEqual(basis.reasons, undefined);
    assert.strictEqual(basis.isCompensated, false);
  });

  it('drives the negative-signal screen from the sealed flags, not from a constant', () => {
    const clean = generateOpportunityReport({ ...base, scoring, basisState: 'RECORDED' });
    assert.strictEqual(clean.section4.negativeSignalCheck.passed, true);
    assert.deepStrictEqual(clean.section4.negativeSignalCheck.flags, []);

    const flagged = generateOpportunityReport({
      ...base,
      scoring: { ...scoring, flags: ['M_NEGATIVE'] },
      basisState: 'RECORDED',
    });
    assert.strictEqual(flagged.section4.negativeSignalCheck.passed, false);
    assert.deepStrictEqual(flagged.section4.negativeSignalCheck.flags, ['M_NEGATIVE']);
    assert.ok((flagged.section4.negativeSignalCheck.findings ?? []).length > 0);
    assert.ok(renderReportToMarkdown(flagged).includes('M_NEGATIVE'));
    assert.ok(renderReportToHtml(flagged).includes('M_NEGATIVE'));
  });

  it('distinguishes an unscreened legacy record from a clean screen', () => {
    const legacy = generateOpportunityReport({ ...base, scoring });
    assert.strictEqual(legacy.section4.negativeSignalCheck.state, 'NOT_RETAINED');
    const rendered = renderReportToMarkdown(legacy);
    assert.ok(rendered.includes('predates flag retention'));
  });

  it('localizes the decision basis and flag explanations into Chinese', () => {
    const report = generateOpportunityReport({
      ...base,
      scoring: { ...scoring, flags: ['M_NEGATIVE'] },
      basisState: 'RECORDED',
      locale: 'zh-CN' as const,
    });
    const markdown = renderReportToMarkdown(report);
    assert.ok(markdown.includes('判定依据（账本留存）'));
    assert.ok(markdown.includes('这是一条补偿判定'));
    // Flags are audited in the user's own language, not as bare enum codes.
    assert.ok(markdown.includes('商业轴强负面信号'));
    assert.ok(markdown.includes('M_NEGATIVE'));
  });
});

describe('deriveBasisState', () => {
  const explanation = { dReason: 'd', mReason: 'm', wReason: 'w', verdictReason: 'v', rulesTriggered: [] };

  it('treats a missing ledger row as not retained', () => {
    assert.strictEqual(deriveBasisState(null), 'NOT_RETAINED');
    assert.strictEqual(deriveBasisState(undefined), 'NOT_RETAINED');
  });

  it('treats a v1 row with no explanation and no flags as not retained', () => {
    assert.strictEqual(deriveBasisState({ hash_version: 1, explanation: null, flags: null }), 'NOT_RETAINED');
    assert.strictEqual(deriveBasisState({ hash_version: 1, explanation: null, flags: [] }), 'NOT_RETAINED');
  });

  it('defaults a row without hash_version to v1 rather than assuming retention', () => {
    assert.strictEqual(deriveBasisState({ explanation: explanation }), 'NOT_RETAINED');
  });

  it('reports RECORDED only when a v2 row carries an explanation', () => {
    assert.strictEqual(deriveBasisState({ hash_version: 2, explanation, flags: [] }), 'RECORDED');
    // An empty flags array alongside a real explanation is a clean cycle, not a gap.
    assert.strictEqual(deriveBasisState({ hash_version: 2, explanation, flags: null }), 'RECORDED');
  });

  it('keeps flags visible when the trace is missing', () => {
    assert.strictEqual(
      deriveBasisState({ hash_version: 2, explanation: null, flags: ['M_NEGATIVE'] }),
      'FLAGS_ONLY'
    );
  });

  it('does not read an empty flags array as retention', () => {
    assert.strictEqual(deriveBasisState({ hash_version: 2, explanation: null, flags: [] }), 'NOT_RETAINED');
  });
});
