import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { decisionSchema, parseInput } from '@emeradar/core';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 原子 GO 与配额（Epic 1.10、01 §1.8 第 5 条、ADR-018、13 §4）。
 *
 * v3.1 的 GO 只剩三件事：预占一次 `atomic_go_export_monthly` → 建 Project 壳 →
 * 授权点火包。这套用例要验的是只有并发与跨期才显形的部分：
 *   1. 并发 GO **不再抢任何东西**——没有槽位、没有容量上限、没有活跃 GO 上限。
 *      四个各余一次额度的用户同时 GO，四条裁决都该落地。
 *   2. 重复 GO 是幂等的：同一 decision 再点一次是 409 ALREADY_GO，配额不再扣。
 *   3. 结转封顶：上月没用完可以带过来，但"面额 + 结转"不超过 6。
 *
 * 判据分散在 `projects`、`decisions`、`usage_counters`、`usage_carryovers` 上，
 * 只看任何一张都会得出"没问题"，所以这里自建一次性数据库、直接操练服务层。
 *
 * 每个用例用**自己的**用户与机会。配额是会累积的状态，共用夹具会让"谁先跑"决定
 * 结果——那样的用例会在改测试顺序时红，而原因与被测行为无关。
 */

const harness = makeDisposableDb("emeradar_atomic_go_test");

/** 每月只允许立项一次的套餐：用来验"自己的额度用完了"。 */
const PLAN_ONE_SHOT = 'TEST_GO_ONE_SHOT';
/** 每月 3 次、允许结转的套餐（对齐 v3.1 的 Pro）。 */
const PLAN_THREE = 'TEST_GO_THREE';

/** 各余 1 次额度的四个并发用户。 */
const CONTENDERS = ['usr_go_c1', 'usr_go_c2', 'usr_go_c3', 'usr_go_c4'];
/** 建完一条项目后额度用尽的用户。 */
const QUOTA_USER = 'usr_go_quota';
/** 重复 GO 的用户。 */
const DUP_USER = 'usr_go_dup';
/** 跨期与结转的用户。 */
const CARRY_USER = 'usr_go_carry';
/** 上月用满、本月也用满的用户。 */
const SPENT_USER = 'usr_go_spent';
/** GO 之后补交凭证的用户。 */
const CRED_USER = 'usr_go_cred';
/** 免费层：**没有** subscriptions 行，entitlementPlanJoin 会把它落到 FREE。 */
const FREE_USER = 'usr_go_free';

const OPP_CONTEND = ['opp_go_c1', 'opp_go_c2', 'opp_go_c3', 'opp_go_c4'] as const;
const OPP_QUOTA_FIRST = 'opp_go_quota_first';
const OPP_QUOTA_SECOND = 'opp_go_quota_second';
const OPP_DUP = 'opp_go_dup';
const OPP_SPENT = 'opp_go_spent';
const OPP_CRED = 'opp_go_cred';
/** 结转用例要连续 GO 六次，所以准备七个落点。 */
const OPP_CARRY = Array.from({ length: 7 }, (_, i) => `opp_go_carry_${i + 1}`);

const PLAN_CODES = [
  [PLAN_ONE_SHOT, '{"atomic_go_export_monthly":1,"max_projects":50}'],
  [PLAN_THREE, '{"atomic_go_export_monthly":3,"max_projects":50}'],
] as const;

/**
 * 探针的解析器替身。真实 DNS 没法按需返回内网地址或空结果，而"拦住了没有"恰恰是
 * 这道闸唯一值得测的东西（见 `public-url.ts` 的 `lookupImpl` 说明）。
 */
const isIpLiteral = (hostname: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');

const resolvePublic = async (hostname: string) =>
  isIpLiteral(hostname)
    ? [{ address: hostname, family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }];
const resolvePrivate = async () => [{ address: '10.0.0.7', family: 4 }];
const resolveNothing = async () => [];

/** 可编程的 fetch 替身：按 URL 返回预置响应。 */
function stubFetch(routes: Record<string, { status?: number; html?: string; location?: string }>): typeof fetch {
  return (async (input: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes[url];
    if (!route) throw new Error(`stub fetch: no route for ${url}`);
    return new Response(route.html ?? '', {
      status: route.status ?? 200,
      headers: route.location ? { location: route.location } : {},
    });
  }) as typeof fetch;
}

const TERMS = ['invoice generator', 'pdf invoice'];

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seedFixture();
});

after(async () => {
  await harness.teardown();
});

async function seedOpportunity(id: string): Promise<string> {
  const { query } = harness.db;
  const slug = id.replace(/_/g, '-');
  const verdictId = `vdt_${id}`;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
    [id, slug, slug]
  );
  // 主词就是探针要匹配的那个词（`opportunityTerms` 读的是这个字段）。
  await query(
    `INSERT INTO opportunity_cards (
       opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
       confidence, recommended_archetype, execution_class, why_now_summary,
       top_idea, first_observed_at
     ) VALUES ($1, $2, 'invoice generator', 'BUILD_NOW', 'EARLY_WINDOW',
       7000, 6000, 5000, 'HIGH', 'HIGH', 'HIGH',
       'HIGH', 'TOOL', 'WEEKEND', 'fixture', 'fixture', NOW())`,
    [id, slug]
  );
  // verdicts 挂着只追加触发器，所以一次性数据库是唯一能造裁决的地方。
  await query(
    `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
       lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
       prev_hash, row_hash)
     VALUES ($1, $2, CURRENT_DATE, '1.0', 'BUILD_NOW', 'EARLY_WINDOW',
       7000, 6000, 5000, 'HIGH', $3, $4)`,
    [verdictId, id, '0'.repeat(64), verdictId.padEnd(64, '0')]
  );
  return verdictId;
}

async function seedFixture() {
  const { query } = harness.db;

  for (const [code, entitlements] of PLAN_CODES) {
    await query(
      `INSERT INTO plans (code, name, price_usd_monthly, entitlements)
       VALUES ($1, $1, 0.00, $2::jsonb) ON CONFLICT (code) DO NOTHING`,
      [code, entitlements]
    );
  }

  const subscribers: Array<[string, string]> = [
    ...CONTENDERS.map((id) => [id, PLAN_ONE_SHOT] as [string, string]),
    [QUOTA_USER, PLAN_ONE_SHOT],
    [DUP_USER, PLAN_THREE],
    [CARRY_USER, PLAN_THREE],
    [SPENT_USER, PLAN_THREE],
    [CRED_USER, PLAN_THREE],
  ];
  for (const [id, plan] of subscribers) {
    await query(
      `INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $2, $3, 'USER', 'PRO')`,
      [id, `${id}@emeradar.test`, id]
    );
    // 结转用例要有"上一期"：把计费锚点放到两个月前，本期与上一期才会分开。
    // 其他用户从当月开始，结转量自然是 0。
    const anchor = id === CARRY_USER || id === SPENT_USER ? 'NOW() - INTERVAL \'2 months\'' : 'NOW()';
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, 'ACTIVE', ${anchor}, NOW() + INTERVAL '30 days')`,
      [`sub_${id}`, id, plan]
    );
  }
  await query(
    `INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $2, $3, 'USER', 'FREE')`,
    [FREE_USER, `${FREE_USER}@emeradar.test`, FREE_USER]
  );

  for (const id of [
    ...OPP_CONTEND,
    OPP_QUOTA_FIRST,
    OPP_QUOTA_SECOND,
    OPP_DUP,
    OPP_SPENT,
    OPP_CRED,
    ...OPP_CARRY,
  ]) {
    await seedOpportunity(id);
  }
}

/** 该用户累计的原子立项次数（跨期求和：`used` 是按期分行的）。 */
async function quotaUsed(userId: string): Promise<number> {
  const res = await harness.db.query<{ used: number }>(
    `SELECT COALESCE(SUM(used), 0)::int AS used FROM usage_counters
      WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'`,
    [userId]
  );
  return res.rows[0]?.used ?? 0;
}

/** 一次 GO 的最短写法。 */
function go(userId: string, opportunityId: string) {
  return harness.services.DecisionService.goAndExport(userId, {
    opportunityId,
    archetype: 'TOOL',
    verdictId: `vdt_${opportunityId}`,
  });
}

describe('原子 GO：并发、配额与幂等', () => {
  it('四个各余一次额度的用户并发 GO 四条不同裁决，全部落地（没有槽位可抢）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const results = await Promise.allSettled(
      CONTENDERS.map((userId, index) => go(userId, OPP_CONTEND[index]))
    );

    const failures = results.filter((result) => result.status === 'rejected');
    assert.deepStrictEqual(
      failures.map((result: any) => result.reason?.code),
      [],
      'v3.1 的并发 GO 之间不该有竞争：没有槽位、没有容量上限'
    );

    for (const [index, userId] of CONTENDERS.entries()) {
      const project = await query<{ id: string; credential_status: string }>(
        `SELECT id, credential_status FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
        [userId, OPP_CONTEND[index]]
      );
      assert.strictEqual(project.rows.length, 1, `${userId} 没有落地项目`);
      assert.strictEqual(project.rows[0].credential_status, 'UNVERIFIED');
      assert.strictEqual(await quotaUsed(userId), 1, `${userId} 的配额没有被扣一次`);
    }

    // GO 不再写任何槽位状态：认领表与汇总缓存都该保持为空。
    const claims = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM slot_claims WHERE opportunity_id = ANY($1::text[])`,
      [[...OPP_CONTEND]]
    );
    assert.strictEqual(claims.rows[0].count, 0, 'GO 仍然在写槽位认领');
  });

  it('免费层没有 GO 权限：403 PLAN_REQUIRED，且不留下任何痕迹', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await assert.rejects(
      () => go(FREE_USER, OPP_QUOTA_FIRST),
      (error: any) => {
        assert.strictEqual(error?.code, 'PLAN_REQUIRED');
        assert.strictEqual(error?.status, 403);
        // 升级引导必须随错误一起回来：免费层要做的下一步是"换套餐"，不是"重试"。
        assert.deepStrictEqual(error?.upgrade, { required_plan: 'FREE', url: '/pricing' });
        return true;
      },
      '免费层被允许 GO'
    );

    // 配额是**第一道**闸：它必须在建项目、写决策之前就把事务推出去。
    assert.deepStrictEqual((await query(`SELECT id FROM projects WHERE user_id = $1`, [FREE_USER])).rows, []);
    assert.deepStrictEqual((await query(`SELECT id FROM decisions WHERE user_id = $1`, [FREE_USER])).rows, []);
    assert.deepStrictEqual((await query(`SELECT * FROM usage_counters WHERE user_id = $1`, [FREE_USER])).rows, []);
  });

  it('配额用尽后第二次 GO 是 403 QUOTA_EXCEEDED，第二个项目不会被建出来', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const first = await go(QUOTA_USER, OPP_QUOTA_FIRST);
    assert.ok(first.projectId);
    assert.strictEqual(first.launchKitUrl, `/api/v1/projects/${first.projectId}/launch-kit`);

    await assert.rejects(
      () => go(QUOTA_USER, OPP_QUOTA_SECOND),
      (error: any) => {
        assert.strictEqual(error?.code, 'QUOTA_EXCEEDED');
        assert.strictEqual(error?.status, 403);
        assert.strictEqual(error?.details?.limit, 1);
        return true;
      },
      '配额用尽后仍然立出了第二个项目'
    );

    const projects = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1`,
      [QUOTA_USER]
    );
    assert.strictEqual(projects.rows[0].count, 1, '失败的 GO 增加了项目数');

    const decisions = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE user_id = $1`,
      [QUOTA_USER]
    );
    assert.strictEqual(decisions.rows[0].count, 1, '失败的 GO 留下了决策行');
    assert.strictEqual(await quotaUsed(QUOTA_USER), 1, '失败的 GO 改动了配额');
  });

  it('同一 decision 再 GO：409 ALREADY_GO，配额不再增加', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const first = await go(DUP_USER, OPP_DUP);

    await assert.rejects(
      () => go(DUP_USER, OPP_DUP),
      (error: any) => {
        assert.strictEqual(error?.code, 'ALREADY_GO');
        assert.strictEqual(error?.status, 409);
        assert.strictEqual(error?.details?.project_id, first.projectId);
        return true;
      },
      '重复 GO 没有被识别为 ALREADY_GO'
    );

    assert.strictEqual(await quotaUsed(DUP_USER), 1, '重复 GO 又扣了一次配额');
    const decisions = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE user_id = $1 AND opportunity_id = $2 AND decision = 'GO'`,
      [DUP_USER, OPP_DUP]
    );
    assert.strictEqual(decisions.rows[0].count, 1, '重复 GO 造出了第二条决策');
  });

  it('结转封顶 6：上月 3 次没用过，本期可用 6，第 7 次 403', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    const usageBefore = await EntitlementService.getAtomicGoUsage(CARRY_USER);
    assert.strictEqual(usageBefore.limit, 6, `本期上限应为 6（3 面额 + 3 结转），实得 ${usageBefore.limit}`);
    assert.strictEqual(usageBefore.carryover_available, 3);

    for (const opportunityId of OPP_CARRY.slice(0, 6)) {
      const result = await go(CARRY_USER, opportunityId);
      assert.ok(result.projectId);
    }

    await assert.rejects(
      () => go(CARRY_USER, OPP_CARRY[6]),
      (error: any) => {
        assert.strictEqual(error?.code, 'QUOTA_EXCEEDED');
        assert.strictEqual(error?.status, 403);
        assert.strictEqual(error?.details?.limit, 6);
        return true;
      },
      '第 7 次 GO 被放行（结转把余额撑过了 6）'
    );

    assert.strictEqual(await quotaUsed(CARRY_USER), 6);
    const usageAfter = await EntitlementService.getAtomicGoUsage(CARRY_USER);
    assert.deepStrictEqual(
      { limit: usageAfter.limit, used: usageAfter.used, remaining: usageAfter.remaining },
      { limit: 6, used: 6, remaining: 0 }
    );

    // 结转账不是永远 NULL 的摆设：它记下了"被哪一期消费"。
    const carryover = await harness.db.query<{ units: number; consumed_in_period: string | null }>(
      `SELECT units, to_char(consumed_in_period, 'YYYY-MM-DD') AS consumed_in_period
         FROM usage_carryovers WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'`,
      [CARRY_USER]
    );
    assert.strictEqual(carryover.rows[0]?.units, 3);
    assert.strictEqual(carryover.rows[0]?.consumed_in_period, usageBefore.period);
  });

  it('当月 3 次用满、上月也 3 次用满：累计第 7 次 403（余额 6）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;
    const { query } = harness.db;

    const usage = await EntitlementService.getAtomicGoUsage(SPENT_USER);

    // 把"上月 3 次"与"本月 3 次"直接写进计数器：这是跨月之后的状态，等一个月
    // 才能造出来，而它只是一行数字。
    const dayBefore = new Date(`${usage.period}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const anchorRow = await query<{ current_period_start: Date }>(
      `SELECT current_period_start FROM subscriptions WHERE user_id = $1`,
      [SPENT_USER]
    );
    const previous = EntitlementService.quotaPeriodStart(anchorRow.rows[0].current_period_start, dayBefore);
    await query(
      `INSERT INTO usage_counters (user_id, feature, period_start, used)
       VALUES ($1, 'atomic_go_export_monthly', $2, 3), ($1, 'atomic_go_export_monthly', $3, 3)`,
      [SPENT_USER, previous, usage.period]
    );

    const spentUsage = await EntitlementService.getAtomicGoUsage(SPENT_USER);
    assert.strictEqual(spentUsage.limit, 3, '上月用满时不该有结转');

    await assert.rejects(
      () => go(SPENT_USER, OPP_SPENT),
      (error: any) => {
        assert.strictEqual(error?.code, 'QUOTA_EXCEEDED');
        assert.strictEqual(error?.details?.limit, 3);
        return true;
      },
      '累计第 7 次 GO 被放行'
    );

    assert.strictEqual(await quotaUsed(SPENT_USER), 6);
  });

  it('POST /decisions 不收 GO：schema 拒绝，服务层也拒绝，且不产生项目与配额', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;
    const { query } = harness.db;

    // 路由层：请求体在进服务之前就被 schema 挡下（4xx）。
    assert.throws(
      () => parseInput(decisionSchema, { opportunityId: OPP_CRED, verdictId: 'vdt_opp_go_cred', decision: 'GO' }),
      (error: any) => error?.status === 400,
      'decision schema 收下了 GO'
    );

    // 服务层：即使绕过 schema 直接调用，也必须是 4xx，而不是记一条不扣配额的 GO。
    await assert.rejects(
      () =>
        DecisionService.record(CRED_USER, {
          opportunityId: OPP_CRED,
          verdictId: 'vdt_opp_go_cred',
          decision: 'GO',
        }),
      (error: any) => error?.code === 'VALIDATION_ERROR' && error?.status === 400,
      '服务层收下了 GO'
    );

    assert.deepStrictEqual((await query(`SELECT id FROM projects WHERE user_id = $1`, [CRED_USER])).rows, []);
    assert.strictEqual(await quotaUsed(CRED_USER), 0);
  });
});

describe('凭证核验：GO 之后的可选动作', () => {
  it('GO 不再做凭证门禁；提交失败只记 REJECTED，通过后置 VERIFIED_OWNER', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { CredentialService } = harness.services;
    const { query } = harness.db;

    // 不带任何凭证也能 GO——v3.1 的凭证是"之后再说"，不是入场券。
    const started = await go(CRED_USER, OPP_CRED);
    const row = await query<{ credential_status: string }>(
      `SELECT credential_status FROM projects WHERE id = $1`,
      [started.projectId]
    );
    assert.strictEqual(row.rows[0].credential_status, 'UNVERIFIED');

    const status = await CredentialService.getCredentials(started.projectId, CRED_USER);
    assert.strictEqual(status.credentialStatus, 'UNVERIFIED');
    assert.deepStrictEqual(status.credentials, []);

    // 探针打不开/内容不符只影响这次提交的结论：不释放资源、不退配额。
    await assert.rejects(
      () =>
        CredentialService.submitCredential(
          started.projectId,
          CRED_USER,
          { credentialType: 'DOMAIN_URL', url: 'https://unrelated.example/' },
          {
            lookupImpl: resolvePublic as any,
            fetchImpl: stubFetch({
              'https://unrelated.example/': { status: 200, html: '<title>Handmade candles</title>' },
            }),
          }
        ),
      (error: any) => {
        assert.strictEqual(error?.code, 'CREDENTIAL_UNVERIFIED');
        assert.strictEqual(error?.status, 422);
        assert.strictEqual(error?.details?.probe?.title, 'Handmade candles');
        return true;
      },
      '无关内容的凭证被接受了'
    );

    const afterFailure = await query<{ credential_status: string }>(
      `SELECT credential_status FROM projects WHERE id = $1`,
      [started.projectId]
    );
    assert.strictEqual(afterFailure.rows[0].credential_status, 'REJECTED', '失败没有如实记下');
    assert.strictEqual(await quotaUsed(CRED_USER), 1, '凭证失败动了配额');
    // 资源没有被释放：项目还在，凭证状态只是 REJECTED。v3.1 的凭证失败不触发任何
    // 回收（点火包的准入另外在 launch-kit.test.ts 里验）。
    const stillThere = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE id = $1 AND user_id = $2`,
      [started.projectId, CRED_USER]
    );
    assert.strictEqual(stillThere.rows[0].count, 1, '凭证失败把项目弄丢了');

    // 补交一张对得上的：状态落到 VERIFIED_OWNER，仍不需要任何期限。
    const verified = await CredentialService.submitCredential(
      started.projectId,
      CRED_USER,
      { credentialType: 'DOMAIN_URL', url: 'https://built.example/' },
      {
        lookupImpl: resolvePublic as any,
        fetchImpl: stubFetch({
          'https://built.example/': {
            status: 200,
            html: '<title>Invoice Generator</title><h1>PDF invoice</h1>',
          },
        }),
      }
    );
    assert.strictEqual(verified.verified, true);
    const afterVerify = await query<{ credential_status: string; credential_verified_at: Date | null }>(
      `SELECT credential_status, credential_verified_at FROM projects WHERE id = $1`,
      [started.projectId]
    );
    assert.strictEqual(afterVerify.rows[0].credential_status, 'VERIFIED_OWNER');
    assert.ok(afterVerify.rows[0].credential_verified_at, '核验时刻没有落库');
  });
});

describe('凭证探针的网络边界', () => {
  it('拒绝解析到内网地址的目标（SSRF 闸本身）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    await assert.rejects(
      () =>
        probeCredential({
          url: 'https://internal.example/',
          credentialType: 'DOMAIN_URL',
          terms: TERMS,
          lookupImpl: resolvePrivate as any,
          fetchImpl: stubFetch({}),
        }),
      (error: any) => error?.code === 'VALIDATION_ERROR' && error?.status === 400,
      '内网地址没有被拦下'
    );
  });

  it('拒绝解析不出地址的目标', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    await assert.rejects(
      () =>
        probeCredential({
          url: 'https://nxdomain.example/',
          credentialType: 'DOMAIN_URL',
          terms: TERMS,
          lookupImpl: resolveNothing as any,
          fetchImpl: stubFetch({}),
        }),
      (error: any) => error?.code === 'VALIDATION_ERROR',
      '解析不出的域名没有被拦下'
    );
  });

  it('拒绝跳向内网的重定向', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    // 第一跳是公网，Location 指向云元数据端点。只校验入口 URL 的实现会跟过去，
    // 而 169.254.169.254 上放的是实例凭证。
    await assert.rejects(
      () =>
        probeCredential({
          url: 'https://public.example/',
          credentialType: 'DOMAIN_URL',
          terms: TERMS,
          lookupImpl: resolvePublic as any,
          fetchImpl: stubFetch({
            'https://public.example/': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
          }),
        }),
      (error: any) => error?.code === 'VALIDATION_ERROR',
      '重定向到内网没有被拦下'
    );
  });

  it('占位页不算上线，哪怕主词全中', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://parked.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      // 域名停放页会把主词写满标题（它靠这个吃自然流量），所以"命中主词"本身
      // 不足以证明上线——必须先过占位页这一关。
      fetchImpl: stubFetch({
        'https://parked.example/': { status: 200, html: '<title>invoice generator — buy this domain</title>' },
      }),
    });
    assert.strictEqual(probe.ok, false);
    assert.match(String(probe.reason), /placeholder|parking/i);
  });

  it('通篇无关的页面不算上线，并返回实际取到的内容', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://candles.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({
        'https://candles.example/': { status: 200, html: '<title>Handmade candles</title><h1>Our shop</h1>' },
      }),
    });
    assert.strictEqual(probe.ok, false);
    assert.strictEqual(probe.title, 'Handmade candles');
    assert.deepStrictEqual(probe.matchedTerms, []);
  });

  it('命中主词与簇内词的页面通过', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://built.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({
        'https://built.example/': {
          status: 200,
          html:
            '<title>Invoice Generator</title>' +
            '<h1>PDF invoice in one click</h1>' +
            '<meta name="description" content="Generate a PDF invoice">',
        },
      }),
    });
    assert.strictEqual(probe.ok, true);
    assert.strictEqual(probe.relevance, 1);
    assert.strictEqual(probe.matchedTerms.length, 2);
    assert.strictEqual(probe.reason, null);
  });

  it('HTTP 错误码不算上线', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://broken.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({ 'https://broken.example/': { status: 503 } }),
    });
    assert.strictEqual(probe.ok, false);
    assert.strictEqual(probe.httpStatus, 503);
  });

  it('重定向超过上限后放弃，而不是无限跟下去', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://loop.example/1',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({
        'https://loop.example/1': { status: 302, location: 'https://loop.example/2' },
        'https://loop.example/2': { status: 302, location: 'https://loop.example/3' },
        'https://loop.example/3': { status: 302, location: 'https://loop.example/4' },
        'https://loop.example/4': { status: 302, location: 'https://loop.example/5' },
        'https://loop.example/5': { status: 302, location: 'https://loop.example/6' },
      }),
    });
    assert.strictEqual(probe.ok, false);
    assert.match(String(probe.reason), /redirect/i);
  });
});
