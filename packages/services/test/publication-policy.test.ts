import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANNIBALIZATION_MAX_JACCARD,
  INACTIVE_WINDOW_DAYS,
  SERP_TOP_N,
  evaluateCannibalization,
  evaluateLostFirstMoverValue,
  jaccard,
  normalizeSerpUrl,
  windowClosingEnteredOn,
  type CannibalizationIndex,
  type LostValueFacts,
} from '../src';

/**
 * `docs/15 §3` 准入判据里**不碰库**的那一半。
 *
 * 拆出纯函数就是为了在这里把边界钉死——`evaluateOpportunity` 要跑一次真实 PostgreSQL
 * 才验得了，而"14 天含不含端点"「无槽位行算不算满额」这类问题一旦只能在集成测试里问，
 * 就没法把边界逐条列出来。
 */

/** 造一个假的已收录索引：`entries` 是 `[opportunityId, slug, url 列表]`。 */
function makeIndex(entries: Array<[string, string, string[]]>, locale = 'en-US'): CannibalizationIndex {
  const pages = new Map<string, { slug: string; urls: Set<string> }>();
  for (const [id, slug, urls] of entries) {
    pages.set(id, { slug, urls: new Set(urls.map(normalizeSerpUrl)) });
  }
  return {
    locale,
    pages,
    addPublished(opportunityId, slug, urls) {
      pages.set(opportunityId, { slug, urls: new Set([...urls].map(normalizeSerpUrl)) });
    },
  };
}

/** 一组互不相同的 SERP URL；`group` 决定它们属于哪个"站点"，用来控制重叠。 */
function urlsFrom(group: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `https://${group}-${i}.example/`);
}

const CANDIDATE = urlsFrom('a', SERP_TOP_N);

/**
 * 一个与 `CANDIDATE` 恰好共享 `shared` 个结果的 10 元集合。
 *
 * 两侧都必须**恰好 10 条**，`J = k/(20-k)` 才成立 —— 这是规格里 0.7 落在 k=8 与 k=9
 * 之间的前提。
 */
function partnerSharing(shared: number): string[] {
  return [...urlsFrom('a', shared), ...urlsFrom('b', SERP_TOP_N - shared)];
}

/** 判据事实的默认值：最新一条 WATCH、生命周期 EARLY_WINDOW、从未活跃过。 */
function facts(overrides: Partial<LostValueFacts> = {}): LostValueFacts {
  return {
    latestVerdict: 'WATCH',
    latestVerdictDate: '2026-10-18',
    lifecycle: 'EARLY_WINDOW',
    lastActiveVerdictDate: null,
    ...overrides,
  };
}

/** 以 2026-10-18 为"今天"的参考时刻。 */
const TODAY = new Date('2026-10-18T00:00:00Z');
const daysAgo = (n: number): string =>
  new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);

describe('「已失去抢跑价值」的四条判据（15 §3、01 §1.8 第 5 条）', () => {
  it('活跃的 BUILD_NOW / EARLY_BET 一律不公开，哪怕生命周期已经写成竞争态', () => {
    for (const latest of ['BUILD_NOW', 'EARLY_BET']) {
      const res = evaluateLostFirstMoverValue(
        facts({ latestVerdict: latest, lifecycle: 'CONTESTED', lastActiveVerdictDate: daysAgo(0) }),
        TODAY
      );
      assert.equal(res.eligible, false);
      assert.equal(res.basis, null);
    }
  });

  it('最新裁决是 WINDOW_CLOSING / PASS → 公开，且凭据写出是哪一条', () => {
    assert.deepEqual(
      evaluateLostFirstMoverValue(facts({ latestVerdict: 'WINDOW_CLOSING' }), TODAY),
      { eligible: true, basis: 'WINDOW_CLOSING' }
    );
    assert.deepEqual(
      evaluateLostFirstMoverValue(facts({ latestVerdict: 'PASS' }), TODAY),
      { eligible: true, basis: 'PASS' }
    );
  });

  it('生命周期进入 CONTESTED / MATURE / DEAD → 公开（LIFECYCLE_CLOSED）', () => {
    for (const lifecycle of ['CONTESTED', 'MATURE', 'DEAD']) {
      assert.deepEqual(
        evaluateLostFirstMoverValue(facts({ latestVerdict: 'WATCH', lifecycle }), TODAY),
        { eligible: true, basis: 'LIFECYCLE_CLOSED' }
      );
    }
    // 仍在 FORMING / EARLY_WINDOW 时这一条不成立；把最后一条活跃裁决放在昨天，
    // 让"14 天没动过"那条也不成立，结论才只剩下"未失去价值"。
    for (const lifecycle of ['FORMING', 'EARLY_WINDOW']) {
      assert.equal(
        evaluateLostFirstMoverValue(facts({ lifecycle, lastActiveVerdictDate: daysAgo(1) }), TODAY).basis,
        null
      );
    }
  });

  it('14 天边界（含端点）：最后一条活跃裁决在 14 天前放行，13 天前仍阻断', () => {
    assert.equal(INACTIVE_WINDOW_DAYS, 14);
    // 窗口是 [today-13, today]：落在 today-14 才在窗口之外。
    assert.deepEqual(
      evaluateLostFirstMoverValue(facts({ lastActiveVerdictDate: daysAgo(14) }), TODAY),
      { eligible: true, basis: 'INACTIVE_14D' }
    );
    assert.deepEqual(
      evaluateLostFirstMoverValue(facts({ lastActiveVerdictDate: daysAgo(13) }), TODAY),
      { eligible: false, basis: null }
    );
    assert.deepEqual(
      evaluateLostFirstMoverValue(facts({ lastActiveVerdictDate: daysAgo(0) }), TODAY),
      { eligible: false, basis: null }
    );
  });

  it('从未出现过活跃裁决 → 算作 INACTIVE_14D；日期读不出来时判否（取严）', () => {
    assert.deepEqual(
      evaluateLostFirstMoverValue(facts({ lastActiveVerdictDate: null }), TODAY),
      { eligible: true, basis: 'INACTIVE_14D' }
    );
    assert.deepEqual(
      evaluateLostFirstMoverValue(facts({ lastActiveVerdictDate: 'not-a-date' }), TODAY),
      { eligible: false, basis: null }
    );
  });

  it('优先级固定：裁决面的事实在生命周期之前', () => {
    const res = evaluateLostFirstMoverValue(
      facts({ latestVerdict: 'WINDOW_CLOSING', lifecycle: 'CONTESTED' }),
      TODAY
    );
    assert.equal(res.basis, 'WINDOW_CLOSING');
  });

  it('窗口关闭段的进入时点只由连续 WINDOW_CLOSING 决定', () => {
    assert.equal(windowClosingEnteredOn([]), null);
    assert.equal(windowClosingEnteredOn([{ obs_date: '2026-10-18', verdict: 'WATCH' }]), null);
    assert.equal(
      windowClosingEnteredOn([
        { obs_date: '2026-10-18', verdict: 'WINDOW_CLOSING' },
        { obs_date: '2026-10-17', verdict: 'WINDOW_CLOSING' },
        { obs_date: '2026-10-16', verdict: 'BUILD_NOW' },
      ]),
      '2026-10-17'
    );
  });
});

describe('SERP URL 归一（15 §3 第 3 条）', () => {
  it('去 scheme、去 www、去 fragment、去尾斜杠，主机名小写', () => {
    assert.equal(normalizeSerpUrl('https://WWW.Example.com/Pricing/'), 'example.com/Pricing');
    assert.equal(normalizeSerpUrl('http://example.com'), 'example.com');
    assert.equal(normalizeSerpUrl('https://example.com/a/b/#x'), 'example.com/a/b');
    assert.equal(normalizeSerpUrl('https://www.example.com/'), 'example.com');
  });

  it('**不去** query string——那是我们不该替对方做的判断', () => {
    assert.equal(normalizeSerpUrl('https://example.com/a?p=1'), 'example.com/a?p=1');
    assert.notEqual(
      normalizeSerpUrl('https://example.com/a?p=1'),
      normalizeSerpUrl('https://example.com/a?p=2')
    );
  });

  it('空值归一成空串', () => {
    assert.equal(normalizeSerpUrl(''), '');
    assert.equal(normalizeSerpUrl('   '), '');
  });
});

describe('Jaccard', () => {
  it('空集与空集是 0——"都没有结果"不是"完全重叠"', () => {
    assert.equal(jaccard(new Set(), new Set()), 0);
    assert.equal(jaccard(new Set(['a']), new Set()), 0);
  });

  it('相同即 1，且对称', () => {
    assert.equal(jaccard(new Set(CANDIDATE), new Set(CANDIDATE)), 1);
    const a = new Set(urlsFrom('a', 3));
    const b = new Set(urlsFrom('b', 3));
    assert.equal(jaccard(a, b), jaccard(b, a));
  });

  it('两个 10 元集合的重叠落在阈值两侧：k=8 过、k=9 挡', () => {
    // 规格是"< 0.7 允许"，而两个 10 元集合的 J = k/(20-k)：k=8 → 0.667，k=9 → 0.818。
    // 0.7 恰好落在这两个整数之间，所以边界只能用它们钉。
    const eight = jaccard(new Set(CANDIDATE), new Set(partnerSharing(8)));
    assert.ok(Math.abs(eight - 8 / 12) < 1e-9, `k=8 应为 0.667，实得 ${eight}`);
    assert.ok(eight < CANNIBALIZATION_MAX_JACCARD);

    const nine = jaccard(new Set(CANDIDATE), new Set(partnerSharing(9)));
    assert.ok(Math.abs(nine - 9 / 11) < 1e-9, `k=9 应为 0.818，实得 ${nine}`);
    assert.ok(nine >= CANNIBALIZATION_MAX_JACCARD);
  });
});

describe('蚕食防护状态机（15 §3 第 3 条）', () => {
  const evaluate = (pages: Array<[string, string, string[]]>, exclude?: string) =>
    evaluateCannibalization(CANDIDATE, makeIndex(pages), exclude);

  it('已收录页数为 0 → VACUOUS，而不是"数据缺失"', () => {
    const result = evaluate([]);
    assert.equal(result.status, 'VACUOUS');
    assert.equal(result.publishedPages, 0);
    assert.equal(result.comparedPages, 0);
    assert.equal(result.unresolvablePages, 0);
    assert.equal(result.threshold, CANNIBALIZATION_MAX_JACCARD);
  });

  it('重叠 8 → PASSED（0.667 < 0.7）', () => {
    const result = evaluate([['opp_x', 'x-slug', partnerSharing(8)]]);
    assert.equal(result.status, 'PASSED');
    assert.equal(result.closestSlug, 'x-slug');
    assert.equal(result.comparedPages, 1);
    assert.ok(result.maxJaccard < CANNIBALIZATION_MAX_JACCARD);
  });

  it('重叠 9 → BLOCKED（0.818 >= 0.7）', () => {
    const result = evaluate([['opp_x', 'x-slug', partnerSharing(9)]]);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.closestSlug, 'x-slug');
    assert.ok(result.maxJaccard >= CANNIBALIZATION_MAX_JACCARD);
  });

  it('取**最相似**的那一页作为凭据', () => {
    const result = evaluate([
      ['opp_far', 'far-slug', urlsFrom('z', SERP_TOP_N)],
      ['opp_near', 'near-slug', partnerSharing(9)],
    ]);
    assert.equal(result.closestSlug, 'near-slug');
    assert.equal(result.comparedPages, 2);
  });

  it('**排除自己**：候选已是已收录页时不能与自身重叠', () => {
    // 索引按运行构建一次、被整批机会共用，候选自己若在里面，与自身重叠恒为 1.0 ——
    // 不排除的话，一条已发布页在复审时会被自己挡成 DRAFT，永远翻不回来。
    const pages: Array<[string, string, string[]]> = [
      ['opp_self', 'self-slug', CANDIDATE],
      ['opp_other', 'other-slug', urlsFrom('z', SERP_TOP_N)],
    ];
    assert.equal(evaluate(pages, 'opp_self').status, 'PASSED');
    // 不排除时确实是 BLOCKED —— 证明这条断言钉的是排除逻辑，不是碰巧算不出来。
    assert.equal(evaluate(pages).status, 'BLOCKED');
  });

  it('候选拿不到 SERP 快照 → NOT_EVALUATED（fail-closed）', () => {
    const result = evaluateCannibalization([], makeIndex([['opp_x', 'x-slug', urlsFrom('a', 2)]]));
    assert.equal(result.status, 'NOT_EVALUATED');
    assert.equal(result.publishedPages, 1);
    assert.equal(result.comparedPages, 0);
    assert.equal(result.unresolvablePages, 1);
    assert.equal(result.candidateTop10Size, 0);
  });

  it('对侧拿不到快照 → 计入 unresolvable，但不影响可比页', () => {
    const result = evaluate([
      ['opp_nosnap', 'nosnap-slug', []],
      ['opp_x', 'x-slug', urlsFrom('z', SERP_TOP_N)],
    ]);
    assert.equal(result.status, 'PASSED');
    // 索引里两页都在 —— 拿不到快照的那页**不能被整体漏掉**，否则"有页但比较不了"
    // 会被误报成"没有页可比较"，也就是把 NOT_EVALUATED 说成 VACUOUS。
    assert.equal(result.publishedPages, 2);
    assert.equal(result.comparedPages, 1);
    assert.equal(result.unresolvablePages, 1);
  });

  it('有页、但全部拿不到快照 → NOT_EVALUATED 而非 VACUOUS', () => {
    const result = evaluate([['opp_nosnap', 'nosnap-slug', []]]);
    assert.equal(result.status, 'NOT_EVALUATED');
    assert.equal(result.publishedPages, 1);
    assert.equal(result.unresolvablePages, 1);
  });

  it('Top10 的深度取自 SERP_TOP_N', () => {
    assert.equal(SERP_TOP_N, 10);
  });
});
