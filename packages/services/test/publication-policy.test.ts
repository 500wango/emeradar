import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANNIBALIZATION_MAX_JACCARD,
  SERP_TOP_N,
  WINDOW_CLOSING_FRESHNESS_DAYS,
  evaluateCannibalization,
  jaccard,
  normalizeSerpUrl,
  slotFullness,
  windowClosingState,
  type CannibalizationIndex,
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

describe('槽位满额（15 §3.1）', () => {
  // 入参是**按机会汇总后**的计数（`loadSlotTotals` 的返回值），跨形态的求和在 SQL 的
  // `SUM` 里完成。所以这里的"多形态"用例直接给汇总值——被测的是"汇总值够不够判满额"，
  // 而不是再实现一遍求和。
  it('没有槽位行**不算**满额——这是 0 容忍的那条线', () => {
    // 一条没有槽位行的机会，`SUM` 在 SQL 里被 `COALESCE` 成 0。裸比较会把"一个槽位都
    // 没开"读成"已满额"，于是把一条还没开始抢的机会公开出去。15 §8 把这件事列为
    // 0 容忍的 P0。
    const empty = slotFullness({ slotRows: 0, capacity: 0, claimed: 0 });
    assert.equal(empty.full, false);
    assert.equal(empty.slotRows, 0);
    assert.equal(empty.capacity, 0);
    assert.equal(empty.claimed, 0);
  });

  it('单形态满额即满额', () => {
    assert.deepEqual(slotFullness({ slotRows: 1, capacity: 2, claimed: 2 }), {
      slotRows: 1,
      capacity: 2,
      claimed: 2,
      full: true,
    });
  });

  it('多形态要**全部**满额——任一形态有空槽就还没耗尽抢跑价值', () => {
    // 多队列正是 ADR-018 的意图：不同形态的认领者互不挤占，所以只要还有一条队能进人，
    // 这条机会就还有抢跑价值。两个形态各 2 个坑：3/4 未满，4/4 才满。
    assert.equal(slotFullness({ slotRows: 2, capacity: 4, claimed: 3 }).full, false);
    assert.equal(slotFullness({ slotRows: 2, capacity: 4, claimed: 4 }).full, true);
  });

  it('`slotRows` 是数据、不是数组长度', () => {
    // 曾经把这里写成"传入行数组、用 rows.length 当 slotRows"，于是 slotRows 恒为 1 ——
    // 一条一个槽位都没有的机会会报出 slotRows = 1，凭据直接说谎。
    const totals = slotFullness({ slotRows: 3, capacity: 6, claimed: 6 });
    assert.equal(totals.slotRows, 3);
    assert.equal(totals.full, true);
  });

  it('claimed >= capacity 即可（对汇总缓存漂移取保守方向）', () => {
    // 0003 的 CHECK 让 `==` 与 `>=` 等价，但缓存漂移时宁可判成"已满"。
    assert.equal(slotFullness({ slotRows: 1, capacity: 2, claimed: 3 }).full, true);
  });
});

describe('14 天内新进 WINDOW_CLOSING（15 §3.1）', () => {
  /** 按倒序（最新在前）造账本尾部，与 observe-opportunity.ts:474-518 的读取约定一致。 */
  const run = (verdicts: Array<[string, string]>) =>
    verdicts.map(([obs_date, verdict]) => ({ obs_date, verdict }));

  it('空账本不算在关窗期', () => {
    const state = windowClosingState([]);
    assert.equal(state.current, false);
    assert.equal(state.enteredOn, null);
    assert.equal(state.fresh, false);
    assert.equal(state.freshnessDays, WINDOW_CLOSING_FRESHNESS_DAYS);
  });

  it('当前不是 WINDOW_CLOSING 就不算——即使曾经是', () => {
    const state = windowClosingState(
      run([
        ['2026-10-14', 'WATCH'],
        ['2026-10-13', 'WINDOW_CLOSING'],
      ])
    );
    assert.equal(state.current, false);
    assert.equal(state.enteredOn, null);
    assert.equal(state.fresh, false);
  });

  it('只看**当前这一段**的起始日，不看更早的那一段', () => {
    // 离开后再进入算一次新的进入（06 §6 的 Episode 也是这个口径）。若把最早的那一段
    // 当成进入日，一条反复关窗的机会会被永久判成"刚进窗"。
    const state = windowClosingState(
      run([
        ['2026-10-14', 'WINDOW_CLOSING'],
        ['2026-10-13', 'WINDOW_CLOSING'],
        ['2026-10-12', 'WATCH'],
        ['2026-10-11', 'WINDOW_CLOSING'], // 更早的那一段，不算
      ])
    );
    assert.equal(state.current, true);
    assert.equal(state.enteredOn, '2026-10-13');
    assert.equal(state.ageDays, 1);
    assert.equal(state.fresh, true);
  });

  it('4 天前进窗 → 新鲜', () => {
    const state = windowClosingState(
      run([
        ['2026-10-14', 'WINDOW_CLOSING'],
        ['2026-10-13', 'WINDOW_CLOSING'],
        ['2026-10-12', 'WINDOW_CLOSING'],
        ['2026-10-11', 'WINDOW_CLOSING'],
        ['2026-10-10', 'WINDOW_CLOSING'],
        ['2026-10-09', 'BUILD_NOW'],
      ])
    );
    assert.equal(state.enteredOn, '2026-10-10');
    assert.equal(state.ageDays, 4);
    assert.equal(state.fresh, true);
  });

  it('**恰好 14 天**算新鲜（含端点）', () => {
    const state = windowClosingState(
      run([
        ['2026-10-14', 'WINDOW_CLOSING'],
        ['2026-09-30', 'WINDOW_CLOSING'],
        ['2026-09-29', 'BUILD_NOW'],
      ])
    );
    assert.equal(state.enteredOn, '2026-09-30');
    assert.equal(state.ageDays, 14);
    assert.equal(state.fresh, true);
  });

  it('15 天前进窗就不新鲜了', () => {
    const state = windowClosingState(
      run([
        ['2026-10-14', 'WINDOW_CLOSING'],
        ['2026-09-29', 'WINDOW_CLOSING'],
        ['2026-09-28', 'BUILD_NOW'],
      ])
    );
    assert.equal(state.ageDays, 15);
    assert.equal(state.fresh, false);
  });

  it('**粘滞陷阱**：裁决仍是 WINDOW_CLOSING，但已经关了 25 天', () => {
    // verdict.ts:219-223 的迟滞让 WINDOW_CLOSING 能带 30 天上限地延续。所以
    // `verdict === 'WINDOW_CLOSING'` 单独不足以证明"14 天内新进入"——只看它会把一个
    // 25 天前就关窗的机会当成刚关窗，把一条早已没有抢跑价值的页面当成准实时精选。
    const state = windowClosingState(
      run([
        ['2026-10-14', 'WINDOW_CLOSING'],
        ['2026-09-19', 'WINDOW_CLOSING'],
        ['2026-09-18', 'BUILD_NOW'],
      ])
    );
    assert.equal(state.current, true);
    assert.equal(state.ageDays, 25);
    assert.equal(state.fresh, false);
  });

  it('整段被 LIMIT 截断时判否（方向正确）', () => {
    // 30 行全是 WINDOW_CLOSING：真入口更早，算出来的 ageDays 只会偏小，而下限仍 > 14。
    const rows = Array.from({ length: 30 }, (_, i) => ({
      obs_date: new Date(Date.UTC(2026, 9, 14) - i * 86_400_000).toISOString().slice(0, 10),
      verdict: 'WINDOW_CLOSING',
    }));
    const state = windowClosingState(rows);
    assert.equal(state.ageDays, 29);
    assert.equal(state.fresh, false);
  });

  it('只有一行且是 WINDOW_CLOSING → 今天刚进窗', () => {
    const state = windowClosingState(run([['2026-10-14', 'WINDOW_CLOSING']]));
    assert.equal(state.current, true);
    assert.equal(state.ageDays, 0);
    assert.equal(state.fresh, true);
  });

  it('日期读不出来时判否，不去猜', () => {
    const state = windowClosingState(
      run([
        ['not-a-date', 'WINDOW_CLOSING'],
        ['also-bad', 'BUILD_NOW'],
      ])
    );
    assert.equal(state.ageDays, null);
    assert.equal(state.fresh, false);
  });
});

describe('SERP URL 归一（15 §3.3）', () => {
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

describe('蚕食防护状态机（15 §3.3）', () => {
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
