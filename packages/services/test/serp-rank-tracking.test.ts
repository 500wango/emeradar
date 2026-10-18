import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 无感 SERP 排名追踪（PRD F10、04 §9.2、19 Epic 1.5）的验收用例。
 *
 * 这条路径要验的不是"函数返回了成功"——它有两类只有在**库里**才看得见的错：
 *
 *   1. **过滤错了**。追踪的输入是 rank 1–100，而它只该看"已核验、未归档"的项目。
 *      把未核验的凭证也算进来，等于让一个从没上线的站点替用户领走排名；把归档的
 *      算进来，则是一条早已放弃的曲线永远留在榜上。两者都不报错，只是数字变好听。
 *
 *   2. **未入榜时什么都不写**。这条最隐蔽：`best_rank IS NULL` 的行如果不落库，
 *      "30 天内首次入榜"的分母就消失了——只剩命中，入榜率永远是 100%，Gate 1 的
 *      第二条红线就此变成一句无法证伪的话。所以这个文件里最重要的一条断言不是
 *      "命中时写对了名次"，而是"**没命中时也必须有一行**"。
 *
 * 一次性数据库是必需的：这里要造多个项目、多份凭证与多天观测，而 `verdicts` 类
 * 只追加的表让开发库无法承载夹具。
 */

const harness = makeDisposableDb('emeradar_rank_tracking_test');

const OPP = 'opp_rank';
const Q_PRIMARY = 'qry_rank_primary';
const Q_CLUSTER = 'qry_rank_cluster';

const USER_A = 'usr_rank_a';
const USER_B = 'usr_rank_b';

const PRJ_HIT = 'prj_rank_hit';
const PRJ_SUBDOMAIN = 'prj_rank_subdomain';
const PRJ_WWW = 'prj_rank_www';
const PRJ_MISS = 'prj_rank_miss';
const PRJ_UNVERIFIED = 'prj_rank_unverified';
const PRJ_ARCHIVED = 'prj_rank_archived';
const PRJ_DOTTED = 'prj_rank_dotted';
/** 凭证类型是商店详情页：命中可信度低于自有域名，`matchedVia` 必须如实说出来。 */
const PRJ_STORE = 'prj_rank_store';
/** 别人的项目：同一条机会下照常被追踪，读路径却必须挡住。 */
const PRJ_OTHER = 'prj_rank_other';
/** 用户 B 名下、还没有任何凭证的项目：读路径应当返回空曲线而不是报错。 */
const PRJ_SILENT = 'prj_rank_silent';

/** 一个固定日期，让 `daysToFirstRank` 可被逐日断言。 */
const DAY_ONE = '2026-09-11';
const DAY_TWO = '2026-09-12';

/**
 * 一次采集的名次索引。刻意包含四种边界：
 *   - `app.example.com` 与 `example.com` 同时出现：子域不能被折成根域（反之亦然）；
 *   - `example.com` 出现三次：同一主机取最好名次；
 *   - `www.` 前缀：两侧用同一把尺子；
 *   - rank 1 是个"干净站"，但它对应的凭证是 REJECTED——只看它有没有被写下来。
 */
const RANK_INDEX = [
  { rank: 1, url: 'https://bigcorp.example/', domain: 'bigcorp.example' },
  { rank: 3, url: 'https://app.example.com/dash', domain: 'app.example.com' },
  { rank: 7, url: 'https://example.com/', domain: 'example.com' },
  { rank: 12, url: 'https://www.zippy.example/', domain: 'www.zippy.example' },
  { rank: 30, url: 'https://store.example/item/42', domain: 'store.example' },
  { rank: 42, url: 'https://example.com/pricing', domain: 'example.com' },
  { rank: 88, url: 'https://example.com/blog', domain: 'example.com' },
  { rank: 96, url: 'https://other.example/landing', domain: 'other.example' },
];

/** 每一天的观测。命中集不同，用来验"当日覆盖"与"历史最好"。 */
const OBSERVATIONS: Array<[string, Array<{ rank: number; url: string; domain: string }>]> = [
  [DAY_ONE, RANK_INDEX],
  [
    DAY_TWO,
    [
      // 第二天整体前移：example.com 升到第 4，app.example.com 掉出 100，zippy 还在。
      { rank: 4, url: 'https://example.com/', domain: 'example.com' },
      { rank: 12, url: 'https://www.zippy.example/', domain: 'www.zippy.example' },
    ],
  ],
];

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seedFixture();
});

after(async () => {
  await harness.teardown();
});

/** 建一个项目并挂一份凭证。凭证是"是否被追踪"的唯一开关。 */
async function seedProject(input: {
  id: string;
  userId: string;
  status?: string;
  host?: string | null;
  credentialType?: string;
  verificationState?: string;
  createdAt?: string;
}) {
  const { query } = harness.db;
  await query(
    `INSERT INTO projects (id, user_id, opportunity_id, title, build_type, status, created_at)
     VALUES ($1, $2, $3, $1, 'TOOL', $4, $5)`,
    [
      input.id,
      input.userId,
      OPP,
      input.status ?? 'IN_DEVELOPMENT',
      input.createdAt ?? '2026-09-01T00:00:00Z',
    ]
  );
  if (input.host !== undefined) {
    await query(
      `INSERT INTO project_credentials
         (id, project_id, credential_type, url, host, verification_state, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        `crd_${input.id}`,
        input.id,
        input.credentialType ?? 'DOMAIN_URL',
        `https://${input.host ?? 'x'}/`,
        input.host,
        input.verificationState ?? 'VERIFIED',
      ]
    );
  }
}

async function seedFixture() {
  const { query } = harness.db;

  for (const id of [USER_A, USER_B]) {
    await query(
      `INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $2, $1, 'USER', 'PRO')`,
      [id, `${id}@emeradar.test`]
    );
  }

  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, 'rank-fixture', 'Rank Fixture', 'TRACKED', '2026-08-01')`,
    [OPP]
  );

  // 主词必须存在且挂着 PRIMARY：追踪只记主词的名次（F10 问的是"主词上入榜了吗"）。
  await query(
    `INSERT INTO queries (id, query_text, market_country, research_language)
     VALUES ($1, 'invoice generator', 'US', 'en-US'), ($2, 'pdf invoice maker', 'US', 'en-US')`,
    [Q_PRIMARY, Q_CLUSTER]
  );
  await query(
    `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
     VALUES ($1, $2, 'PRIMARY'), ($1, $3, 'CLUSTER')`,
    [OPP, Q_PRIMARY, Q_CLUSTER]
  );

  await seedProject({ id: PRJ_HIT, userId: USER_A, host: 'example.com' });
  await seedProject({ id: PRJ_SUBDOMAIN, userId: USER_A, host: 'app.example.com' });
  await seedProject({ id: PRJ_WWW, userId: USER_A, host: 'zippy.example' });
  // 尾部有点的主机名：0006 的 SQL 回填不保证逐字一致。归一化两侧共用一把尺子，
  // 这种行也必须被匹配到。
  await seedProject({ id: PRJ_DOTTED, userId: USER_A, host: 'other.example.' });
  await seedProject({
    id: PRJ_STORE,
    userId: USER_A,
    host: 'store.example',
    credentialType: 'STORE_LISTING_URL',
  });
  await seedProject({ id: PRJ_MISS, userId: USER_A, host: 'never-ranked.example' });
  await seedProject({
    id: PRJ_UNVERIFIED,
    userId: USER_A,
    host: 'bigcorp.example',
    verificationState: 'REJECTED',
  });
  await seedProject({ id: PRJ_ARCHIVED, userId: USER_A, status: 'ARCHIVED', host: 'example.com' });
  await seedProject({ id: PRJ_OTHER, userId: USER_B, host: 'other.example' });
  // 没有凭证 → 不被追踪，但项目本身存在。用来区分"看过、没进榜"与"根本没在看"。
  await seedProject({ id: PRJ_SILENT, userId: USER_B });
}

/** 跑完夹具里的全部观测，返回逐日的结果。 */
async function recordAllObservations() {
  const { RankingService } = harness.services;
  const results: Array<{ tracked: number; matched: number }> = [];
  for (const [obsDate, rankIndex] of OBSERVATIONS) {
    results.push(
      await RankingService.recordFromSerp({
        opportunityId: OPP,
        queryId: Q_PRIMARY,
        obsDate,
        rankIndex,
      })
    );
  }
  return results;
}

async function rankRow(projectId: string, obsDate: string) {
  const res = await harness.db.query<{ best_rank: number | null; matched_url: string | null }>(
    `SELECT best_rank, matched_url FROM project_serp_rankings
      WHERE project_id = $1 AND query_id = $2 AND obs_date = $3`,
    [projectId, Q_PRIMARY, obsDate]
  );
  return res.rows[0] ?? null;
}

describe('排名匹配：谁被追踪、谁被跳过', () => {
  it('只写已核验且未归档的项目，未入榜的留一行 NULL', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const results = await recordAllObservations();

    // 夹具里一共 10 个项目，其中只有 7 个"已核验、有 host、未归档"。
    // 这两个数字就是过滤器本身的断言：多一个就说明放进了不该追踪的项目。
    assert.deepStrictEqual(results[0], { tracked: 7, matched: 6 });
    assert.deepStrictEqual(results[1], { tracked: 7, matched: 2 });

    // 命中：同一主机出现三次，取最好名次，且记下命中那条 URL。
    assert.deepStrictEqual(await rankRow(PRJ_HIT, DAY_ONE), {
      best_rank: 7,
      matched_url: 'https://example.com/',
    });
    // 子域不被折成根域：app.example.com 命中第 3，而不是去认 example.com 的第 7。
    assert.deepStrictEqual(await rankRow(PRJ_SUBDOMAIN, DAY_ONE), {
      best_rank: 3,
      matched_url: 'https://app.example.com/dash',
    });
    // 两侧各自归一：凭证存的 `zippy.example` 要能认领 SERP 侧带 www 的那条。
    assert.strictEqual((await rankRow(PRJ_WWW, DAY_ONE))?.best_rank, 12);
    // 尾部有点的主机名同样要能认领。
    assert.deepStrictEqual(await rankRow(PRJ_DOTTED, DAY_ONE), {
      best_rank: 96,
      matched_url: 'https://other.example/landing',
    });
    // 商店详情页也按主机名匹配——所以这条命中是线索而不是证据，`matchedVia` 要说出来。
    assert.strictEqual((await rankRow(PRJ_STORE, DAY_ONE))?.best_rank, 30);

    // 未入榜不是"没有行"，而是"一行 NULL"。这是 Gate 1 分母的依据。
    assert.deepStrictEqual(await rankRow(PRJ_MISS, DAY_ONE), { best_rank: null, matched_url: null });

    // REJECTED 凭证对应的大站排在第 1 名——如果这行存在，就说明"没上线也能领排名"。
    assert.strictEqual(await rankRow(PRJ_UNVERIFIED, DAY_ONE), null);
    // 归档项目不再被追踪。
    assert.strictEqual(await rankRow(PRJ_ARCHIVED, DAY_ONE), null);
    // 别人的项目照常被追踪：追踪的是"这条机会上有没有人做出来"，不是"我的站排第几"。
    assert.strictEqual((await rankRow(PRJ_OTHER, DAY_ONE))?.best_rank, 96);
  });

  it('第二次采集覆盖当日结果，而不是追加一行', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { RankingService } = harness.services;

    // 同一天重跑：这天谁都没进榜。旧结果必须被覆盖——曲线要回答的是"我们最后一次
    // 看到的是什么"，两行同名次会让"当日排名"变成一个没有定义的问题。
    await RankingService.recordFromSerp({
      opportunityId: OPP,
      queryId: Q_PRIMARY,
      obsDate: DAY_ONE,
      rankIndex: [],
    });

    assert.deepStrictEqual(await rankRow(PRJ_HIT, DAY_ONE), { best_rank: null, matched_url: null });

    const count = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM project_serp_rankings
        WHERE project_id = $1 AND query_id = $2 AND obs_date = $3`,
      [PRJ_HIT, Q_PRIMARY, DAY_ONE]
    );
    assert.strictEqual(count.rows[0]?.count, 1);

    // 复原，后面的读路径用例依赖第一条观测。
    await RankingService.recordFromSerp({
      opportunityId: OPP,
      queryId: Q_PRIMARY,
      obsDate: DAY_ONE,
      rankIndex: RANK_INDEX,
    });
  });

  it('没有已核验项目的机会不产生任何写入', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const result = await harness.services.RankingService.recordFromSerp({
      opportunityId: 'opp_rank_empty',
      queryId: Q_PRIMARY,
      obsDate: DAY_ONE,
      rankIndex: RANK_INDEX,
    });
    assert.deepStrictEqual(result, { tracked: 0, matched: 0 });
  });
});

describe('排名读路径：曲线与 30 天判据', () => {
  it('给出爬升曲线、历史最好名次与"立项多少天入榜"', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const view = await harness.services.RankingService.getProjectRankings(PRJ_HIT, USER_A);

    // 夹具里那 8 个被追踪的项目，除归档与未核验外都在（命中/未命中各算）。
    assert.strictEqual(view.observedDays, 2);
    assert.strictEqual(view.firstRankedOn, DAY_ONE);
    // 立项日刻意设为 2026-09-01，首次入榜 2026-09-11 —— 10 天，就是 Gate 1 的读数。
    assert.strictEqual(view.daysToFirstRank, 10);
    // 第二天升到第 4 名，历史最好取它。
    assert.strictEqual(view.bestRankEver, 4);

    assert.strictEqual(view.series.length, 1);
    const [series] = view.series;
    assert.strictEqual(series.queryText, 'invoice generator');
    assert.deepStrictEqual(
      series.rows.map((row) => [row.date, row.rank]),
      [
        [DAY_ONE, 7],
        [DAY_TWO, 4],
      ]
    );
    // 归因：命中来自哪一类凭证。未命中时为 null，而不是"碰巧还留着上次的类型"。
    assert.deepStrictEqual(
      series.rows.map((row) => row.matchedVia),
      ['DOMAIN_URL', 'DOMAIN_URL']
    );
  });

  it('从未入榜的项目：曲线全是 NULL，但仍然有观测天数', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const view = await harness.services.RankingService.getProjectRankings(PRJ_MISS, USER_A);

    // "看了 2 天，一次都没进"必须与"我们从没看过"可区分——前者是结果，后者是缺口。
    assert.strictEqual(view.observedDays, 2);
    assert.strictEqual(view.firstRankedOn, null);
    assert.strictEqual(view.daysToFirstRank, null);
    assert.strictEqual(view.bestRankEver, null);
    assert.deepStrictEqual(
      view.series[0].rows.map((row) => row.rank),
      [null, null]
    );
    // 没有命中，就没有归因可言。
    assert.deepStrictEqual(
      view.series[0].rows.map((row) => row.matchedVia),
      [null, null]
    );
  });

  it('归因如实反映凭证类型：商店详情页的命中不会被画成自有域名', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const view = await harness.services.RankingService.getProjectRankings(PRJ_STORE, USER_A);
    assert.deepStrictEqual(
      view.series[0].rows.map((row) => [row.rank, row.matchedVia]),
      [
        [30, 'STORE_LISTING_URL'],
        // 第二天没有命中，归因随之消失。
        [null, null],
      ]
    );
  });

  it('别人的项目一律 404，而不是 403 或空曲线', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await assert.rejects(
      () => harness.services.RankingService.getProjectRankings(PRJ_OTHER, USER_A),
      (error: any) => {
        // 曲线里含对手的具体域名与名次，所以不能靠"项目 id 不可枚举"来保护。
        assert.strictEqual(error?.status, 404);
        assert.strictEqual(error?.code, 'NOT_FOUND');
        return true;
      }
    );
    await assert.rejects(
      () => harness.services.RankingService.getProjectRankings('prj_does_not_exist', USER_A),
      (error: any) => error?.status === 404
    );
  });

  it('没有任何观测的项目返回空曲线，而不是报错', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const view = await harness.services.RankingService.getProjectRankings(PRJ_SILENT, USER_B);
    assert.strictEqual(view.observedDays, 0);
    assert.deepStrictEqual(view.series, []);
    assert.strictEqual(view.bestRankEver, null);
    assert.strictEqual(view.daysToFirstRank, null);
  });
});
