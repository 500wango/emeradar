import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlaceholderSyntax,
  extractPlaceholders,
  containsForbiddenPhrases,
  validateAndRenderStatement,
  validateAndRenderBundle,
  EntityDeduplicator,
  SerpResultClassifier,
  PricingTierExtractor,
  FactBundle,
  Statement,
} from '../src';

describe('Placeholder Normalization & Citation Guardrails (08 §6.3)', () => {
  const mockBundle: FactBundle = {
    facts: [
      {
        id: 'F1',
        template: '过去 7 天新增 {{F1.new_queries_7d}} 个查询',
        values: { new_queries_7d: 14 },
      },
      {
        id: 'F2',
        template: 'Top10 中 {{F2.ugc_count}} 个结果为论坛帖',
        values: { ugc_count: 5 },
      },
    ],
  };

  it('should normalize full-width brackets and trim internal whitespace', () => {
    const raw = '新增 ｛｛ F1.new_queries_7d ｝｝ 个相关查询，其中 ｛｛F2.ugc_count  ｝｝ 个在论坛';
    const normalized = normalizePlaceholderSyntax(raw);
    assert.equal(
      normalized,
      '新增 {{F1.new_queries_7d}} 个相关查询，其中 {{F2.ugc_count}} 个在论坛'
    );
  });

  it('should extract all placeholders accurately', () => {
    const text = 'Notice {{F1.new_queries_7d}} new items and {{F2.ugc_count}} forum posts.';
    const placeholders = extractPlaceholders(text);
    assert.equal(placeholders.length, 2);
    assert.equal(placeholders[0].factId, 'F1');
    assert.equal(placeholders[0].field, 'new_queries_7d');
    assert.equal(placeholders[1].factId, 'F2');
    assert.equal(placeholders[1].field, 'ugc_count');
  });

  it('should detect forbidden phrases', () => {
    assert.equal(containsForbiddenPhrases('本项目保证赚钱'), true);
    assert.equal(containsForbiddenPhrases('这是一个稳赚不赔的赛道'), true);
    assert.equal(containsForbiddenPhrases('Guaranteed profit in 30 days'), true);
    assert.equal(containsForbiddenPhrases('这是一个有潜力的细分机会'), false);
  });

  it('should validate and render statements with valid placeholders', () => {
    const statement: Statement = {
      kind: 'FACT',
      text: '过去一周新增 {{F1.new_queries_7d}} 个查询，竞争较弱。',
      cites: ['F1'],
    };

    const res = validateAndRenderStatement(statement, mockBundle);
    assert.equal(res.valid, true);
    assert.equal(res.renderedText, '过去一周新增 14 个查询，竞争较弱。');
  });

  it('should reject statement referencing uncited fact', () => {
    const statement: Statement = {
      kind: 'FACT',
      text: '过去一周新增 {{F1.new_queries_7d}} 个查询，论坛有 {{F2.ugc_count}} 条。',
      cites: ['F1'], // Missing F2
    };

    const res = validateAndRenderStatement(statement, mockBundle);
    assert.equal(res.valid, false);
    assert.ok(res.reason?.includes('uncited fact F2'));
  });

  it('should reject statement with bare numbers instead of placeholders (08 §6.3)', () => {
    const statement: Statement = {
      kind: 'FACT',
      text: '过去一周新增 14 个查询，竞争度低。', // Bare 14 instead of {{F1.new_queries_7d}}
      cites: ['F1'],
    };

    const res = validateAndRenderStatement(statement, mockBundle);
    assert.equal(res.valid, false);
    assert.ok(res.reason?.includes('Bare number 14 used instead of required placeholder'));
  });

  it('should filter invalid statements and keep valid ones in bundle validation', () => {
    const statements: Statement[] = [
      {
        kind: 'FACT',
        text: '过去一周新增 {{F1.new_queries_7d}} 个查询。',
        cites: ['F1'],
      },
      {
        kind: 'FACT',
        text: '稳赚不赔的项目！',
        cites: [],
      },
      {
        kind: 'SUGGESTION',
        text: '建议优先做单页小工具验证。',
        cites: [],
      },
    ];

    const result = validateAndRenderBundle(mockBundle, statements);
    assert.equal(result.statements.length, 2); // Forbidden phrase statement removed
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.citationValid, false); // Not 100% clean due to 1 rejection
  });
});

describe('Entity Deduplicator (08 §3 U1)', () => {
  const existing = [
    { id: 'ent_1', name: 'Cron Expression Generator', aliases: ['crontool', 'cron builder'] },
    { id: 'ent_2', name: 'OG Image Generator', aliases: ['social preview maker'] },
  ];

  it('should auto-merge on high lexical similarity', () => {
    const res = EntityDeduplicator.deduplicate('Cron Expression Generator', existing);
    assert.equal(res.matchedEntityId, 'ent_1');
    assert.ok(res.confidence >= 0.9);
  });

  it('should return null match for novel entities', () => {
    const res = EntityDeduplicator.deduplicate('Postgres Database Backup Tool', existing);
    assert.equal(res.matchedEntityId, null);
    assert.ok(res.confidence < 0.6);
  });
});

describe('SERP Result Classifier (08 §4 U2)', () => {
  it('should classify forum, qa, docs, and affiliate listicles', () => {
    const raw = [
      {
        rank: 1,
        url: 'https://reddit.com/r/webdev/comments/cron',
        domain: 'reddit.com',
        title: 'Best cron tool?',
        snippet: 'Discussion thread',
      },
      {
        rank: 2,
        url: 'https://docs.docker.com/cron',
        domain: 'docker.com',
        title: 'Docker Cron Documentation',
        snippet: 'Official documentation',
      },
      {
        rank: 3,
        url: 'https://techradar.com/best-cron-tools-2026',
        domain: 'techradar.com',
        title: 'Top 10 Best Cron Tools in 2026 - Reviews',
        snippet: 'Comparison listicle',
      },
    ];

    const classified = SerpResultClassifier.classify(raw);
    assert.equal(classified.length, 3);
    assert.equal(classified[0].resultType, 'UGC_THREAD');
    assert.equal(classified[1].resultType, 'DOC');
    assert.equal(classified[2].resultType, 'LISTICLE_AFFILIATE');
  });
});

describe('Pricing Tier Extractor with Literal Verification (08 §5 U3)', () => {
  it('should extract pricing tiers and ensure price_text exists literally', () => {
    const visibleText = `
      Choose the plan that fits you best:
      Starter plan is $15/mo for basic automation.
      Pro plan is $39/mo with unlimited API runs.
      Enterprise is $199/yr for teams.
      Click Subscribe Now to checkout.
    `;

    const res = PricingTierExtractor.extractWithLiteralGuard(visibleText);
    assert.equal(res.tiers.length, 3);
    assert.equal(res.tiers[0].name, 'Starter');
    assert.equal(res.tiers[0].priceText, '$15/mo');
    assert.equal(res.tiers[0].priceAmount, 15);
    assert.equal(res.tiers[0].billingPeriod, 'MONTH');

    assert.equal(res.tiers[1].name, 'Pro');
    assert.equal(res.tiers[1].priceAmount, 39);

    assert.equal(res.hasCheckoutEntry, true);
  });
});
