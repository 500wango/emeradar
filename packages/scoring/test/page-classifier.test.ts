import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyPage, classifyAuthority, PAGE_CLASSIFIER_VERSION } from '../src';

/**
 * 分类器的三个硬要求：可复现、可审计、不默认乐观。
 *
 * 旧实现把 wix.com 判成 SPECIALIST（正面竞争）、把 LinkedIn 判成通用站，
 * 弱点因此被系统性低估——方向刚好反了。
 */
describe('SERP 页面分类器', () => {
  it('泛平台与托管商不再算作专属竞品', () => {
    assertKind('https://www.wix.com/', 'GENERIC_PLATFORM');
    assertKind('https://www.wix.com/website-builder', 'GENERIC_PLATFORM');
    assertKind('https://rss.com/podcasts/', 'HOSTING_SERVICE');
    assertKind('https://transistor.fm/', 'HOSTING_SERVICE');
  });

  it('社交平台算 UGC，且权威度与页面分类一致', () => {
    const linkedin = classifyPage('https://www.linkedin.com/posts/x', 'podcast seo tips');
    assert.strictEqual(linkedin.kind, 'UGC');
    assert.strictEqual(linkedin.isDedicatedTool, false);
    assert.strictEqual(classifyAuthority('https://www.linkedin.com/posts/x', 'linkedin.com'), 'COMMUNITY_FORUM');

    assertKind('https://www.reddit.com/r/podcasting/x', 'UGC');
    assertKind('https://www.quora.com/What-is-x', 'UGC');
  });

  it('未知域名不再默认 SPECIALIST，而是 UNCLASSIFIED', () => {
    const unknown = classifyPage('https://some-new-site.example/', 'Welcome');
    assert.strictEqual(unknown.kind, 'UNCLASSIFIED');
    assert.strictEqual(unknown.resultType, 'UNCLASSIFIED');
    assert.strictEqual(unknown.isDedicatedTool, false);
  });

  it('有产品页证据才判 DEDICATED_TOOL', () => {
    const tool = classifyPage('https://acme.example/pricing', 'Acme — pricing');
    assert.strictEqual(tool.kind, 'DEDICATED_TOOL');
    assert.strictEqual(tool.isDedicatedTool, true);
    assert.strictEqual(tool.resultType, 'SPECIALIST');
  });

  it('内容页判 CONTENT，文档判 DOC', () => {
    assertKind('https://acme.example/blog/podcast-seo', 'CONTENT');
    assertKind('https://acme.example/docs/api', 'DOC');
  });

  it('大厂域名下的产品页仍按产品页算（避免低估自带工具页）', () => {
    assertKind('https://www.microsoft.com/en-us/microsoft-365/pricing', 'DEDICATED_TOOL');
    assertKind('https://www.microsoft.com/', 'OFFICIAL_BRAND');
  });

  it('分类是确定性的，并带版本号', () => {
    const a = classifyPage('https://www.wix.com/', 'Wix');
    const b = classifyPage('https://www.wix.com/', 'Wix');
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.classifierVersion, PAGE_CLASSIFIER_VERSION);
  });
});

function assertKind(url: string, kind: string) {
  assert.strictEqual(classifyPage(url, '').kind, kind);
}
