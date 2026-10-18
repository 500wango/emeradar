import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { generateOpportunityReport, type ReportGenerationInput } from '@emeradar/report';
// 点火包走子路径（`@emeradar/report/launch-kit`）：它依赖 node:crypto / node:zlib，
// 不能进桶——web 的客户端组件从桶里取值，拉进 node 内建模块会让构建直接失败。
import {
  assembleLaunchKit,
  zipLaunchKit,
  LAUNCH_KIT_TEMPLATE_VERSION,
  type LaunchKitBundle,
} from '@emeradar/report/launch-kit';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 形态点火包（Epic 1.9、ADR-018/019、09 §5.3）。
 *
 * 这块要验的只有两件事，而它们都是**承诺**而不是功能：
 *   1. **没有 GO 就没有点火包**。准入判据是"该项目引用了该用户的一条 GO 决策"，
 *      而不是"存在某个项目"——否则任何一个能被创建出来的项目都会顺带解锁点火包，
 *      而 ADR-018 的全部意义就是"不点 GO 不得导出"。
 *   2. **同一份输入必得同一份产物**（硬约束 1）。这条不能靠"看起来一样"来验，
 *      只能靠字节：同一输入两次装配得到同一个 `content_hash`、同一串 zip 字节，
 *      而输入里任何一项（形态、模板版本、快照、界面语言）变了都必须变。
 *
 * 准入的用例走真实数据库（报告由 `ReportService` 从冻结快照装配），因为判据就长在
 * 那几张表上。装配器的用例不碰数据库：它的输入是一份报告，直接构造它比把整条管线
 * 跑一遍更接近"同一输入"这个前提。
 */

const harness = makeDisposableDb('emeradar_launch_kit_test');

const PLAN = 'TEST_LAUNCH_KIT';

/** 走完整 GO → 导出的用户。 */
const OWNER = 'usr_lkit_owner';
/** 用来验证"别人的项目"的那一个。 */
const OTHER = 'usr_lkit_other';
/** 归档释放槽位的用户。 */
const ARCHIVER = 'usr_lkit_archiver';
/** 用来验证"导出不重复扣报告额度"的用户。 */
const QUOTA_USER = 'usr_lkit_quota';
/** 实验项目的拥有者：他的项目从来没有认领过槽位。 */
const EXPERIMENT_USER = 'usr_lkit_experiment';

const OPP_MAIN = 'opp_lkit_main';
const OPP_ARCHIVED = 'opp_lkit_archived';
const OPP_QUOTA = 'opp_lkit_quota';
/** 用来验"界面语言不是英语时复核依然成立"的那一条。 */
const OPP_ZH = 'opp_lkit_zh';
const EXP_PROJECT = 'prj_lkit_experiment';

interface OpportunityFixture {
  id: string;
  verdictId: string;
  archetype: string;
}

const OPPORTUNITIES: OpportunityFixture[] = [
  { id: OPP_MAIN, verdictId: 'vdt_lkit_main', archetype: 'PSEO_SITE' },
  { id: OPP_ARCHIVED, verdictId: 'vdt_lkit_archived', archetype: 'PSEO_SITE' },
  { id: OPP_QUOTA, verdictId: 'vdt_lkit_quota', archetype: 'TOOL' },
  { id: OPP_ZH, verdictId: 'vdt_lkit_zh', archetype: 'PSEO_SITE' },
];

function verdictOf(opportunityId: string): string {
  const found = OPPORTUNITIES.find((o) => o.id === opportunityId);
  if (!found) throw new Error(`no fixture verdict for ${opportunityId}`);
  return found.verdictId;
}

async function seedFixture() {
  const { query } = harness.db;

  await query(
    `INSERT INTO plans (code, name, price_usd_monthly, entitlements)
     VALUES ($1, 'Launch Kit', 0.00,
       '{"atomic_go_export_monthly":10,"active_go_slots_max":5,
         "generate_reports_monthly":30,"max_projects":50}'::jsonb)
     ON CONFLICT (code) DO NOTHING`,
    [PLAN]
  );

  for (const id of [OWNER, OTHER, ARCHIVER, QUOTA_USER, EXPERIMENT_USER]) {
    await query(
      `INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $2, $3, 'USER', 'PRO')`,
      [id, `${id}@emeradar.test`, id]
    );
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, $3, 'ACTIVE', NOW() + INTERVAL '30 days')`,
      [`sub_${id}`, id, PLAN]
    );
  }

  for (const { id: opportunityId, verdictId, archetype } of OPPORTUNITIES) {
    const slug = opportunityId.replace(/_/g, '-');
    // `queries` 有 UNIQUE(query_text, market_country, research_language)，而 SERP 快照
    // 是每查询一份——所以每条机会要有自己的主词，不能三处共用一个字符串。
    const primaryQuery = opportunityId === OPP_MAIN ? 'invoice generator' : `invoice generator ${slug}`;

    await query(
      `INSERT INTO opportunities (id, slug, title, status, market_country, research_language)
       VALUES ($1, $2, $3, 'TRACKED', 'US', 'en-US')`,
      [opportunityId, slug, `${slug} opportunity`]
    );
    // 卡片上的列几乎都是 NOT NULL：报告要引用它，GO 也要 JOIN 它。
    await query(
      `INSERT INTO opportunity_cards (
         opportunity_id, slug, primary_query, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
         confidence, recommended_archetype, execution_class, why_now_summary,
         top_idea, first_observed_at, search_intent
       ) VALUES ($1, $2, $3, 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', 'HIGH', 'HIGH',
         'HIGH', $4, 'M', 'fixture why now', 'fixture idea', NOW(), 'COMMERCIAL')`,
      [opportunityId, slug, primaryQuery, archetype]
    );
    // 账本行挂着只追加触发器，所以一次性数据库是唯一能造裁决的地方。形状与
    // decision-traceability / atomic-go 的夹具一致，免得三处对"一条裁决长什么样"
    // 各说各话。
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         prev_hash, row_hash)
       VALUES ($1, $2, CURRENT_DATE, '2.3', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', $3, $4)`,
      [verdictId, opportunityId, '0'.repeat(64), verdictId.padEnd(64, '0')]
    );
    await query(
      `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics)
       VALUES ($1, $2, CURRENT_DATE, '{}'::jsonb)`,
      [`snp_${opportunityId}`, opportunityId]
    );

    // 报告要求一条真实的 SERP 观测：缺了它 ReportService 会拒绝生成（这是有意的，
    // 报告不能凭空造竞品）。
    const queryId = `qry_${opportunityId}`;
    await query(
      `INSERT INTO queries (id, query_text, market_country, research_language)
       VALUES ($1, $2, 'US', 'en-US')`,
      [queryId, primaryQuery]
    );
    await query(
      `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`,
      [opportunityId, queryId]
    );
    await query(
      `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio)
       VALUES ($1, $2, CURRENT_DATE, 0.3000)`,
      [`srp_${opportunityId}`, queryId]
    );
    for (const [rank, domain, resultType, weak] of [
      [1, 'bigcorp.example', 'OFFICIAL', false],
      [2, 'blog.example', 'EDITORIAL_MEDIA', true],
      [3, 'forum.example', 'UGC_THREAD', true],
    ] as const) {
      await query(
        `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, result_type, is_weak, weakness_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `srp_${opportunityId}`,
          rank,
          `https://${domain}/page-${rank}`,
          domain,
          `${domain} title`,
          resultType,
          weak,
          weak ? 'THIN_CONTENT' : null,
        ]
      );
    }
  }
}

async function decisionOf(projectId: string): Promise<string> {
  const res = await harness.db.query<{ decision_id: string }>(
    `SELECT decision_id FROM projects WHERE id = $1`,
    [projectId]
  );
  return res.rows[0].decision_id;
}

describe('点火包的准入：没有 GO 就没有产物', () => {
  /**
   * 钩子挂在这一组而不是文件级：`setup()` 建库并改写连接池，且会断言池此前没有建立
   * 过任何连接，所以每个文件只能 setup 一次。挂在文件级时，建库一旦失败会把**不碰
   * 数据库**的装配器用例一起取消掉——那些用例的前提是一份报告，不是一台 Postgres。
   */
  before(async () => {
    await harness.setup();
    if (!harness.available) return;
    await seedFixture();
  });

  after(async () => {
    await harness.teardown();
  });

  it('GO 之后拿得到，产物落库冻结，第二次读的是同一份', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, LaunchKitService } = harness.services;
    const { query } = harness.db;

    const started = await DecisionService.goAndExport(OWNER, {
      opportunityId: OPP_MAIN,
      archetype: 'PSEO_SITE',
      verdictId: verdictOf(OPP_MAIN),
    });
    // GO 的返回值里带着点火包凭据 URL。这不是装饰：UI 拿它直接去下载。
    assert.strictEqual(started.launchKitUrl, `/api/v1/projects/${started.projectId}/launch-kit`);

    const first = await LaunchKitService.getOrCreate(started.projectId, OWNER);
    assert.strictEqual(first.cached, false, '首次导出被报成了缓存命中');
    assert.strictEqual(first.archetype, 'PSEO_SITE');
    assert.strictEqual(first.templateVersion, LAUNCH_KIT_TEMPLATE_VERSION);
    // 评分配置版本取自账本里那条裁决（2.3），而不是当前部署的常量：产物要说的是
    // "它由哪一版评分规则下的观测支撑"。
    assert.strictEqual(first.scoringConfigVersion, '2.3');
    assert.strictEqual(first.researchLanguage, 'en-US');
    assert.strictEqual(first.snapshotId, `snp_${OPP_MAIN}`);
    assert.match(first.contentHash, /^[0-9a-f]{64}$/);

    const snapshot = await query<{ obs_date: string }>(
      `SELECT obs_date::text FROM opportunity_snapshots WHERE id = $1`,
      [first.snapshotId]
    );
    assert.strictEqual(
      first.obsDate,
      snapshot.rows[0].obs_date,
      'obs_date 不是从快照读的（产物头部与 ZIP 时间戳都依赖它）'
    );

    assert.deepStrictEqual(
      first.files.map((file) => file.path).sort(),
      // 夹具没有簇内观测词：按 09 §5.3 第 6 条输出 KEYWORDS_UNAVAILABLE.md，不出空词表。
      // 该形态（PSEO）的路由完全由簇内词铺开，所以 routes.yaml 一并省掉。
      ['.cursorrules', 'CLAUDE.md', 'KEYWORDS_UNAVAILABLE.md', 'landing-skeleton.html', 'sections.yaml']
    );
    // 硬约束 2（R3）的端到端版本：交付物里一个未解析的占位符都不能剩。
    for (const file of first.files) {
      assert.ok(!file.content.includes('{{'), `${file.path} 里残留了未解析的占位符`);
    }

    const unavailable = first.files.find((file) => file.path === 'KEYWORDS_UNAVAILABLE.md')!.content;
    assert.match(unavailable, /Keyword list unavailable/);
    assert.match(unavailable, /invoice generator/);

    // 冻结：第二次读回来的是库里那一份，不是重新装配的。
    const second = await LaunchKitService.getOrCreate(started.projectId, OWNER);
    assert.strictEqual(second.cached, true, '第二次导出重新装配了产物');
    assert.strictEqual(second.contentHash, first.contentHash);
    assert.strictEqual(second.launchKitId, first.launchKitId);
    assert.deepStrictEqual(
      second.files.map((file) => file.content),
      first.files.map((file) => file.content)
    );

    // 复核用同一份输入重装一遍，指纹必须对得上。
    const report = await LaunchKitService.verify(started.projectId, OWNER);
    assert.strictEqual(report.verified, true, `复核没通过：${JSON.stringify(report)}`);
    assert.strictEqual(report.storedHash, report.recomputedHash);
    assert.strictEqual(report.fileCount, 5);
  });

  it('界面语言是中文时复核依然通过（语言也是装配的输入）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, LaunchKitService } = harness.services;

    const started = await DecisionService.goAndExport(OWNER, {
      opportunityId: OPP_ZH,
      archetype: 'PSEO_SITE',
      verdictId: verdictOf(OPP_ZH),
    });

    const zh = await LaunchKitService.getOrCreate(started.projectId, OWNER, { locale: 'zh-CN' });
    assert.match(
      zh.files.find((file) => file.path === 'CLAUDE.md')!.content,
      /## 1\. 项目定位/,
      '中文界面下装配出来的仍是英文说明文字'
    );

    // 复核必须用**这份产物自己的**语言重算。写死一个 en-US 会让所有中文产物永远
    // 复核不通过——那是最糟的一种错：检查存在、会说话，而它说的永远是假的。
    const report = await LaunchKitService.verify(started.projectId, OWNER);
    assert.strictEqual(report.verified, true, `中文产物复核没通过：${JSON.stringify(report)}`);
  });

  it('形态取值由 CHECK 兜底：拼错的形态写不进库里', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const row = await query<{ project_id: string; decision_id: string; snapshot_id: string }>(
      `SELECT lk.project_id, lk.decision_id, lk.snapshot_id
         FROM launch_kits lk JOIN projects p ON p.id = lk.project_id
        WHERE p.user_id = $1 LIMIT 1`,
      [OWNER]
    );
    assert.ok(row.rows[0], '夹具里应当有一份已冻结的点火包');

    // 0003 把 `LIGHTWEIGHT_TOOL` 收敛成 `TOOL` 的原因就是同一个形态分裂成两个字符串，
    // 后果是静默失效而不是报错（按 archetype 取键的查询会分成互不相交的两套）。所以
    // 这条约束的价值在于它**会响**：写入一个拼错的形态必须失败并指名道姓。
    await assert.rejects(
      () =>
        query(
          `INSERT INTO launch_kits (
             id, report_id, project_id, decision_id, archetype, schema_version,
             template_version, snapshot_id, scoring_config_version, research_language,
             files, content_hash
           )
           SELECT 'lkit_bogus', report_id, project_id, decision_id, 'LIGHTWEIGHT_TOOL',
                  schema_version, template_version, snapshot_id, scoring_config_version,
                  research_language, files, content_hash
             FROM launch_kits WHERE decision_id = $1`,
          [row.rows[0].decision_id]
        ),
      (error: any) => error?.code === '23514' && String(error?.constraint) === 'launch_kits_archetype_check',
      '拼错的形态被写进了 launch_kits'
    );
  });

  it('实验项目没有引用 GO 决策，因此拿不到点火包', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { LaunchKitService } = harness.services;

    // 实验项目走的是 POST /projects，与 GO 无关。它拿不到点火包不是因为"没做对什么"，
    // 而是因为它没有为任何一次原子立项付过账（ADR-018）。
    await harness.db.query(
      `INSERT INTO projects (id, user_id, title, status, project_kind)
       VALUES ($1, $2, 'experiment', 'IN_DEVELOPMENT', 'EXPERIMENT')`,
      [EXP_PROJECT, EXPERIMENT_USER]
    );
    await assert.rejects(
      () => LaunchKitService.getOrCreate(EXP_PROJECT, EXPERIMENT_USER),
      (error: any) => error?.code === 'NOT_FOUND' && error?.status === 404,
      '没有认领记录的实验项目拿到了点火包'
    );
  });

  it('归档不撤销点火包：v3.1 没有可释放的槽位，GO 的交付物仍归用户', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, ProjectService, LaunchKitService } = harness.services;

    const started = await DecisionService.goAndExport(ARCHIVER, {
      opportunityId: OPP_ARCHIVED,
      archetype: 'PSEO_SITE',
      verdictId: verdictOf(OPP_ARCHIVED),
    });
    // 归档前拿得到——否则这条用例证明不了任何事，只证明了"一直都不给"。
    assert.strictEqual((await LaunchKitService.getOrCreate(started.projectId, ARCHIVER)).cached, false);

    await ProjectService.updateProjectStatus(started.projectId, ARCHIVER, 'ARCHIVED');

    // 10 §4.4 的"没有资源"只剩两种：未 GO 与 非本人。v3.1 的归档只改项目状态，
    // 没有槽位回到池子里，也没有"位置给别人了"——那次 GO 花掉的配额换来的就是这份
    // 产物，归档不该把它收回。
    const afterArchive = await LaunchKitService.getOrCreate(started.projectId, ARCHIVER);
    assert.strictEqual(afterArchive.cached, true, '归档后重新装配了产物');
    assert.strictEqual(afterArchive.launchKitId, `lkit_${await decisionOf(started.projectId)}`);
  });

  it('别人的项目是 403，不存在的项目是 404', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { LaunchKitService } = harness.services;

    const owned = await harness.db.query<{ id: string }>(
      `SELECT id FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
      [OWNER, OPP_MAIN]
    );
    assert.ok(owned.rows[0], '夹具里应当有一条 OWNER 的项目');

    // 区分 403 与 404 不泄露什么（项目 id 不可枚举），而"这不是你的"与"这不存在"
    // 对用户是不同的信息。
    await assert.rejects(
      () => LaunchKitService.getOrCreate(owned.rows[0].id, OTHER),
      (error: any) => error?.code === 'FORBIDDEN' && error?.status === 403,
      '别人的项目没有被拒绝'
    );

    await assert.rejects(
      () => LaunchKitService.getOrCreate('prj_lkit_does_not_exist', OWNER),
      (error: any) => error?.code === 'NOT_FOUND' && error?.status === 404,
      '不存在的项目没有被拒绝'
    );
  });

  it('首次导出会生成报告，但不扣报告生成额度（13 §4.3）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, LaunchKitService } = harness.services;
    const { query } = harness.db;

    const started = await DecisionService.goAndExport(QUOTA_USER, {
      opportunityId: OPP_QUOTA,
      archetype: 'TOOL',
      verdictId: verdictOf(OPP_QUOTA),
    });

    await LaunchKitService.getOrCreate(started.projectId, QUOTA_USER);

    // 报告**真的**生成了：否则"没扣额度"只是因为什么都没发生。
    const reports = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM opportunity_reports WHERE user_id = $1 AND opportunity_id = $2`,
      [QUOTA_USER, OPP_QUOTA]
    );
    assert.strictEqual(reports.rows[0].count, 1, '导出点火包时没有生成报告');

    // 但没有第二笔账：Pro 的报告与点火包由 `atomic_go_export_monthly` 在 GO 时一并
    // 解锁。这里再扣一次 `generate_reports_monthly`，同一次交付就被计了两次费。
    const counters = await query<{ used: number }>(
      `SELECT used FROM usage_counters WHERE user_id = $1 AND feature = 'generate_reports_monthly'`,
      [QUOTA_USER]
    );
    assert.strictEqual(
      counters.rows[0]?.used ?? 0,
      0,
      '导出点火包扣了报告生成额度——同一次交付被计了两次费'
    );
  });
});

describe('点火包的确定性装配', () => {
  it('PSEO 形态：路由由聚类词铺开，每条都指回快照而不是编造证据 id', () => {
    const bundle = assemble(sampleReport());
    const routes = fileOf(bundle, 'routes.yaml');

    // 没有词量数据源，词表按查询词排序；slug 由查询词确定性改写。
    assert.match(routes, /^  - slug: '\/fixture-opportunity\/invoice-generator-free'$/m);
    assert.match(routes, /^  - slug: '\/fixture-opportunity\/pdf-invoice-template'$/m);
    assert.match(routes, /^    priority: 1$/m);
    // 查询词保持研究市场原文，不翻译、不外推（硬约束 4）。
    assert.match(routes, /^    target_keyword: 'invoice generator free'$/m);
    assert.match(routes, /^    intent: COMMERCIAL$/m);
    // 09 §5.3 ② 的字段集：title / h1 / meta_description 由模板确定性装配。
    assert.match(routes, /^    title: 'invoice generator free \| Fixture Opportunity'$/m);
    assert.match(routes, /^    h1: 'invoice generator free'$/m);
    assert.match(routes, /^    meta_description: '/m);
    // 没有词量来源就不输出 volume_tier。
    assert.ok(!routes.includes('volume_tier'), '路由里仍有无来源的 volume_tier');
    // 硬约束 4：指不回 evidence_id 的字段留 —，不得编造。冻结的报告投影里聚类词一级
    // 只到快照粒度，所以如实指回快照。
    assert.match(routes, /^    evidence_id: '—'$/m);
    assert.match(routes, /^    snapshot_id: 'snp_test'$/m);

    const keywords = fileOf(bundle, 'keywords.csv');
    assert.strictEqual(keywords.trim().split('\n').length, 4, `词表行数不对：\n${keywords}`);
    assert.strictEqual(
      keywords.split('\n')[0],
      'slug,target_keyword,intent,title,h1,meta_description,priority,first_observed,snapshot_id,evidence_id'
    );
    // 主词必须排最前：它是唯一每个形态都有的词。
    assert.match(keywords.split('\n')[1], /^\/fixture-opportunity,invoice generator,COMMERCIAL,/);
    assert.ok(!keywords.includes('volume_tier'), '词表里仍有无来源的 volume_tier');
  });

  it('没有簇内观测词时不输出空词表：PSEO 省掉 routes.yaml，改出 KEYWORDS_UNAVAILABLE.md', () => {
    const empty = sampleReport();
    empty.clusterQueries = [];
    const pseo = assemble(empty);
    const paths = pseo.files.map((file) => file.path).sort();
    assert.ok(!paths.includes('keywords.csv'), '无观测词时仍输出了 keywords.csv');
    assert.ok(!paths.includes('routes.yaml'), 'PSEO 形态无观测词时仍输出了空路由表');
    assert.ok(paths.includes('KEYWORDS_UNAVAILABLE.md'));
    assert.match(fileOf(pseo, 'KEYWORDS_UNAVAILABLE.md'), /keywords\.csv, routes\.yaml/);

    // 非 PSEO 形态的路由来自初始页面清单，仍然有内容，只省词表。
    const tool = assemble(empty, { archetype: 'TOOL' });
    const toolPaths = tool.files.map((file) => file.path);
    assert.ok(toolPaths.includes('routes.yaml'));
    assert.ok(!toolPaths.includes('keywords.csv'));
    assert.ok(toolPaths.includes('KEYWORDS_UNAVAILABLE.md'));
  });

  it('工具形态：主体是落地页，聚类词只作为页面文案的目标词进词表', () => {
    const bundle = assemble(sampleReport(), { archetype: 'TOOL' });
    const routes = fileOf(bundle, 'routes.yaml');

    // 该形态不该按聚类词铺路由——铺出来的路径没有对应的产品页面。
    assert.ok(!routes.includes('/fixture-opportunity/invoice-generator-free'), '工具形态仍然铺了 PSEO 路由');
    assert.match(routes, /^  - path: '\/'$/m);
    assert.match(routes, /^    target_query: 'invoice generator'$/m);
    // 但词表照旧：那些词是落地页要覆盖的文案目标。
    assert.match(fileOf(bundle, 'keywords.csv'), /invoice generator free/);
  });

  it('同一份输入两次装配得到同一个指纹与同一串 zip 字节', () => {
    const input = sampleReport();
    const a = assemble(input);
    const b = assemble(input);

    assert.strictEqual(a.contentHash, b.contentHash);
    assert.deepStrictEqual(a.files, b.files);

    // zip 内部带时间戳，而时间戳来自快照观测日而不是 now()——这是硬约束 1 在交付物
    // 这一层的样子，通过指纹是验不到的。
    const zipA = zipLaunchKit(a);
    const zipB = zipLaunchKit(b);
    assert.deepStrictEqual(zipA, zipB, '两次打包的 zip 字节不同（运行时刻泄漏进了时间戳）');
    // 本地文件头签名：确认这是一个结构完整的 zip。
    assert.strictEqual(zipA.readUInt32LE(0), 0x04034b50);
    assert.ok(zipA.indexOf(Buffer.from('CLAUDE.md', 'utf8')) > 0);
    assert.ok(zipA.indexOf(Buffer.from('sections.yaml', 'utf8')) > 0);
  });

  it('形态与界面语言都改变指纹：它们都是"同一份输入"的一部分', () => {
    const base = sampleReport();
    const pseo = assemble(base);
    const tool = assemble(base, { archetype: 'TOOL' });
    assert.notStrictEqual(tool.contentHash, pseo.contentHash, '两种形态得到了同一个指纹');

    const zh = assemble(sampleReport('zh-CN'));
    assert.notStrictEqual(zh.contentHash, pseo.contentHash, '界面语言没有进指纹');
  });

  it('数据里带 {{…}} 时拒绝导出，而不是把它交给用户（R3）', () => {
    // 叙述是 LLM 撰写的自由文本，最容易带上花括号——比如它在解释模板语法本身。
    // 一个未解析的占位符出现在用户的 CLAUDE.md 里，比一次导出失败糟糕得多。
    assert.throws(
      () =>
        assemble(sampleReport(), {
          narrative: { engineering: 'Set {{TOKEN}} in your config.', landing: '' },
        }),
      (error: any) => error?.code === 'INTERNAL' && error?.status === 500
    );
  });

  it('词表与路由保持研究市场原文，说明文字跟随界面语言（14 §5.4）', () => {
    const zh = assemble(sampleReport('zh-CN'));
    const en = assemble(sampleReport('en-US'));

    // 生成资产是**要部署到研究市场**的东西：路由、路径、查询词与界面语言无关。
    const pathLines = (content: string) =>
      content.split('\n').filter((line) => /^\s+- (path|slug):/.test(line));
    assert.deepStrictEqual(
      pathLines(fileOf(zh, 'routes.yaml')),
      pathLines(fileOf(en, 'routes.yaml')),
      '界面语言改变了生成资产的路由'
    );
    // 词表整份逐字节相同：它一个本地化的字都没有。
    assert.strictEqual(fileOf(zh, 'keywords.csv'), fileOf(en, 'keywords.csv'));

    // 说明文字（工程规范）跟随 ui_locale。
    assert.match(fileOf(zh, 'CLAUDE.md'), /## 1\. 项目定位/);
    assert.match(fileOf(en, 'CLAUDE.md'), /## 1\. Positioning/);
    // 两种语言下查询词都不译。
    assert.ok(fileOf(zh, 'CLAUDE.md').includes('invoice generator'));
  });

  it('没有叙述时用一段不含事实断言的确定性文字，而不是编一段产品描述', () => {
    const bundle = assemble(sampleReport());
    // 编出来的描述会被用户当作分析结论读，所以缺叙述时宁可说"本期没有"。
    assert.match(bundle.narrative.engineering, /No narrative was generated/);
    assert.match(fileOf(bundle, 'CLAUDE.md'), /No narrative was generated/);

    // 有叙述时它必须进产物，也必须能原样取回：复核要把同一段喂回去。
    const withNarrative = assemble(sampleReport(), {
      narrative: { engineering: 'Freeze the schema before you write the UI.', landing: 'Lead with the calculator.' },
    });
    assert.match(fileOf(withNarrative, 'CLAUDE.md'), /Freeze the schema before you write the UI\./);
    assert.strictEqual(withNarrative.narrative.engineering, 'Freeze the schema before you write the UI.');
  });

  it('模板版本是输入的一部分：换版本就是换产物', () => {
    const a = assemble(sampleReport());
    const b = assemble(sampleReport(), { templateVersion: '9.9' });
    assert.notStrictEqual(a.contentHash, b.contentHash);
    assert.match(fileOf(b, 'routes.yaml'), /^template_version: 9\.9$/m);
  });
});

// ---------------------------------------------------------------------------
// 装配器的输入：一份走真实生成器的报告
// ---------------------------------------------------------------------------

function assemble(
  input: ReportGenerationInput,
  overrides: Partial<Parameters<typeof assembleLaunchKit>[0]> = {}
): LaunchKitBundle {
  return assembleLaunchKit({
    report: generateOpportunityReport(input),
    archetype: 'PSEO_SITE',
    researchLanguage: 'en-US',
    snapshotId: 'snp_test',
    scoringConfigVersion: '1.0',
    ...overrides,
  });
}

function fileOf(bundle: LaunchKitBundle, path: string): string {
  const file = bundle.files.find((f) => f.path === path);
  assert.ok(file, `产物里没有 ${path}`);
  return file.content;
}

/**
 * 刻意不 mock `generateOpportunityReport`：装配器读的是报告的**投影**（section2/3/5），
 * 手写一个投影对象等于自己定义这份投影长什么样，那样测的是两个想象之间的差。
 */
function sampleReport(locale: 'zh-CN' | 'en-US' = 'en-US'): ReportGenerationInput {
  return {
    reportId: 'rpt_fixture',
    opportunity: {
      id: 'opp_fixture',
      title: 'Fixture Opportunity',
      slug: 'fixture-opportunity',
      marketCountry: 'US',
      researchLanguage: 'en-US',
    },
    scoring: {
      verdict: 'BUILD_NOW',
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      confidence: 'HIGH',
      confidenceScore: 0,
      dScore: 7000,
      mScore: 6000,
      wScore: 5000,
      dBand: 'HIGH',
      mBand: 'HIGH',
      wBand: 'HIGH',
      flags: [],
      explanation: {
        dReason: 'fixture demand',
        mReason: 'fixture commercial',
        wReason: 'fixture window',
        verdictReason: 'fixture verdict',
        rulesTriggered: [],
      },
      recommendedArchetype: 'PSEO_SITE',
      executionClass: 'M',
      topArchetypes: [{ archetype: 'PSEO_SITE', score: 0, executionClass: 'M', rationale: 'fixture' }],
    },
    basisState: 'RECORDED',
    hashVersion: 2,
    featuresHash: null,
    obsDate: '2026-06-01',
    locale,
    primaryQuery: 'invoice generator',
    searchIntent: 'COMMERCIAL',
    clusterQueries: [
      // HIGH 排在 MEDIUM 之前，用来验证词表与路由的排序不只是插入顺序。
      { query: 'invoice generator free', intent: 'COMMERCIAL', volumeTier: 'HIGH' },
      { query: 'pdf invoice template', intent: 'INFORMATIONAL', volumeTier: 'MEDIUM' },
    ],
    top10Serp: [
      { rank: 1, url: 'https://bigcorp.example/', domain: 'bigcorp.example', title: 'Big', resultType: 'OFFICIAL', isWeak: false },
      { rank: 2, url: 'https://blog.example/guide', domain: 'blog.example', title: 'Blog', resultType: 'EDITORIAL_MEDIA', isWeak: true, weaknessReason: 'THIN_CONTENT' },
      { rank: 3, url: 'https://forum.example/thread', domain: 'forum.example', title: 'Forum', resultType: 'UGC_THREAD', isWeak: true, weaknessReason: 'OUTDATED' },
    ],
    paidCompetitors: [
      { domain: 'paid.example', pricingModel: 'SUBSCRIPTION', priceRange: '$9/mo', paymentGateways: ['stripe'] },
      { domain: 'other.example', pricingModel: 'ONE_TIME', priceRange: 'from $19', paymentGateways: ['paddle', 'stripe'] },
    ],
    killCriteria: [
      { code: 'SERP_DOMINANCE_CONSOLIDATION', rule: 'Weak ratio under 20%.', rationale: 'fixture' },
    ],
  };
}
