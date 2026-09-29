import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateOpportunityReport,
  renderReportToMarkdown,
  renderReportToHtml,
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
    assert.ok(html.includes('84.0'));
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
});
