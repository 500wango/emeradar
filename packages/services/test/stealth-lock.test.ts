import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Epic 1.14 处女地独占买断（Stealth Lock）的验收用例。
 *
 * 这条功能的价值全在**边界**上，不在"能不能买"上。四个边界各自对应一种"看起来
 * 正常但产品已经坏了"的结局，所以这里每条都单独立一个用例：
 *
 *   1. **判据必须自愈**（D1）。若"是否隐藏"依赖作业是否跑过，那么一次被遗弃的
 *      结账页会把机会挡住，直到 24 小时后的定时任务——而作业停摆一天就是一天的
 *      全网遮蔽。用例 3 直接改 `locked_at` 而不跑任何作业，验的就是这件事。
 *   2. **买断与 GO 抢的必须是同一把锁**（D2）。两侧各用各的锁时，"下单时
 *      `Σclaimed == 0`"只是一个瞬间为真的判断，买断会被卖给一条已被认领的机会。
 *   3. **打码只动投影、必须保留账本行**（06 §6.1、15 §3.1）。少一行就是买断者
 *      用钱买走了平台的败绩；而词根若还能从公开响应里扫出来，就是 P0 泄露。
 *   4. **未付款的占位不能变成一把免费的遮黑枪**。一个付费账号若能反复对整网下单
 *      再关掉标签页，他花 0 就能让所有人看不见 Feed。
 *
 * 每个用例用自己的用户与机会：买断会改机会的可见性，共用夹具会让"谁先跑"决定
 * 结果——那样的用例会在改测试顺序时红，而原因与被测行为无关。
 */

const harness = makeDisposableDb('emeradar_stealth_lock_test');

const BUYER = 'usr_slk_buyer';
const OTHER = 'usr_slk_other';
const FREE_USER = 'usr_slk_free';
/** 同一个人下单的第二条机会：用来验"同时至多一笔待付占位"是按人算的。 */
const SAME_PERSON_OPP = 'opp_slk_pending_b';
/** 付款回填用例的落点。 */
const OPP_CONFIRM = 'opp_slk_confirm';

/** 一条干净的机会：`Σclaimed == 0`，买断开放。 */
const OPP_PRISTINE = 'opp_slk_pristine';
/** 已经被认领过：处女地条件不成立。 */
const OPP_CLAIMED = 'opp_slk_claimed';
/** 并发用例：买断与 GO 同时打这一条。 */
const OPP_RACE = 'opp_slk_race';
/** 持有者自己 GO 的落点。 */
const OPP_HOLDER_GO = 'opp_slk_holder_go';
/** 打码投影用例。 */
const OPP_PROJECTED = 'opp_slk_projected';
/** 打码时机用例：下单（未付款）时公开页**不得**被打码。 */
const OPP_RESERVED = 'opp_slk_reserved';
/** 未付款窗口用例。 */
const OPP_ABANDONED = 'opp_slk_abandoned';
/** 待付占位的第二条机会（同一个人、不同机会）。 */
const OPP_PENDING_A = 'opp_slk_pending_a';
/** 公开战报打码用例。 */
const OPP_EPISODE = 'opp_slk_episode';
/** 专供作业用例：一条独立的机会，避免与别的用例抢同一把 I13 唯一索引。 */
const OPP_SWEEP = 'opp_slk_sweep';
const OPP_TRACKED = 'opp_slk_tracked';

/**
 * 一个词根独特到可以被子串扫描的词。用普通词组会让"扫不到"变成一句空话——
 * 随便一段英文文本都可能偶然包含它。
 */
const KEYWORD = 'quixotic-zebra-undertaking';
const OTHER_KEYWORD = 'sombre-basilisk-invoicing';

const VERDICT_OF: Record<string, string> = {
  [OPP_PRISTINE]: 'vdt_slk_pristine',
  [OPP_CLAIMED]: 'vdt_slk_claimed',
  [OPP_RACE]: 'vdt_slk_race',
  [OPP_HOLDER_GO]: 'vdt_slk_holder_go',
  [OPP_PROJECTED]: 'vdt_slk_projected',
  [OPP_RESERVED]: 'vdt_slk_reserved',
  [OPP_ABANDONED]: 'vdt_slk_abandoned',
  [OPP_PENDING_A]: 'vdt_slk_pending_a',
  [OPP_EPISODE]: 'vdt_slk_episode',
  [OPP_SWEEP]: 'vdt_slk_sweep',
  [SAME_PERSON_OPP]: 'vdt_slk_pending_b',
  [OPP_CONFIRM]: 'vdt_slk_confirm',
  [OPP_TRACKED]: 'vdt_slk_tracked',
};

const ALL_OPPS = Object.keys(VERDICT_OF);

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;

  for (const [id, tier] of [
    [BUYER, 'PRO'],
    [OTHER, 'PRO'],
    [FREE_USER, 'FREE'],
  ] as const) {
    await query(
      `INSERT INTO users (id, email, display_name, role, tier, email_verified_at)
       VALUES ($1, $2, $3, 'USER', $4, NOW())`,
      [id, `${id}@emeradar.test`, id, tier]
    );
  }
  // 订阅挂 PRO：`stealth_buyout` 是 PRO 权益（0007 迁移写进 `plans.entitlements`）。
  for (const id of [BUYER, OTHER]) {
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, 'PRO', 'ACTIVE', NOW() + INTERVAL '30 days')`,
      [`sub_${id}`, id]
    );
  }

  for (const opportunityId of ALL_OPPS) {
    const slug = opportunityId.replace(/_/g, '-');
    // 每条机会的标题里带上它自己的词根，这样"公开响应里扫不到"才有意义。
    const keyword = opportunityId === OPP_TRACKED ? OTHER_KEYWORD : KEYWORD;
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
      [opportunityId, slug, `${keyword} title`]
    );
    await query(
      `INSERT INTO opportunity_slots (opportunity_id, archetype, capacity)
       VALUES ($1, 'TOOL', 2)`,
      [opportunityId]
    );
    await query(
      `INSERT INTO opportunity_cards (
         opportunity_id, slug, primary_query, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
         confidence, recommended_archetype, execution_class, why_now_summary,
         top_idea, first_observed_at
       ) VALUES ($1, $2, $3, 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', 'HIGH', 'HIGH',
         'HIGH', 'TOOL', 'WEEKEND', $3, $3, NOW())`,
      [opportunityId, slug, keyword]
    );
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         raw_verdict, explanation, d_band, m_band, w_band, hash_version,
         prev_hash, row_hash)
       VALUES ($1, $2, CURRENT_DATE, '1.0', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH',
         'BUILD_NOW', '{}'::jsonb, 'HIGH', 'HIGH', 'HIGH', 2,
         $3, $4)`,
      [VERDICT_OF[opportunityId], opportunityId, '0'.repeat(64), VERDICT_OF[opportunityId].padEnd(64, '0')]
    );
  }
});

after(async () => {
  await harness.teardown();
});

/** 直接落库一条生效中的买断，绕开 Stripe。多数用例只关心"锁在不在"。 */
async function seedLock(input: {
  lockId: string;
  opportunityId: string;
  userId: string;
  paid: boolean;
  lockedAtSql?: string;
  unlockAtSql?: string;
}): Promise<void> {
  const { query } = harness.db;
  await query(
    `INSERT INTO stealth_locks (id, opportunity_id, user_id, status, locked_at, unlock_at, amount_usd, provider_payment_id)
     VALUES ($1, $2, $3, 'ACTIVE',
             ${input.lockedAtSql ?? 'NOW()'},
             ${input.unlockAtSql ?? "NOW() + INTERVAL '60 days'"},
             199.00, $4)`,
    [input.lockId, input.opportunityId, input.userId, input.paid ? 'pi_test_paid' : null]
  );
  await query(
    `INSERT INTO stealth_lock_displays (stealth_lock_id, opportunity_id, masked_label, locale, unmasked_at)
     SELECT $1, $2, '[Stealth Locked #' || RIGHT($1, 6) || ']', 'en-US', unlock_at
       FROM stealth_locks WHERE id = $1`,
    [input.lockId, input.opportunityId]
  );
}

const lockId = (suffix: string) => `slk_${suffix.padEnd(16, '0')}`;

describe('买断：下单资格由数据决定，不由套餐决定', () => {
  it('Σclaimed > 0 的机会不可买断，报 422 而不是 409', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    // 有人在这条机会上认领过一个槽位——处女地已经没了。
    await query(
      `UPDATE opportunity_slots SET claimed = 1 WHERE opportunity_id = $1`,
      [OPP_CLAIMED]
    );

    const availability = await harness.services.StealthLockService.getAvailability(OPP_CLAIMED, BUYER);
    assert.strictEqual(availability.available, false);
    assert.strictEqual(availability.claimedTotal, 1);

    await assert.rejects(
      () => harness.services.StealthLockService.purchase(BUYER, OPP_CLAIMED),
      (error: any) => {
        // 422 而不是 409：没有任何可选的替代形态能提示他，所以不是"换个形态"。
        assert.strictEqual(error.code, 'STEALTH_LOCK_UNAVAILABLE');
        assert.strictEqual(error.status, 422);
        return true;
      }
    );
    // 被拒绝的下单不该留下任何痕迹。
    const locks = await query(`SELECT id FROM stealth_locks WHERE opportunity_id = $1`, [OPP_CLAIMED]);
    assert.strictEqual(locks.rows.length, 0);
  });

  it('FREE 套餐买不了：403 PLAN_REQUIRED，因为 stealth_buyout 是 PRO 权益', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    await assert.rejects(
      () => harness.services.StealthLockService.purchase(FREE_USER, OPP_PRISTINE),
      (error: any) => {
        assert.strictEqual(error.code, 'PLAN_REQUIRED');
        assert.strictEqual(error.status, 403);
        return true;
      }
    );
  });
});

describe('买断：下单即写锁与打码行', () => {
  it('成功的下单写出锁与显示行，且 unmasked_at 与 unlock_at 逐字一致（I14）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const { lockId: id } = await harness.services.StealthLockService.purchase(BUYER, OPP_PRISTINE);
    assert.match(id, /^slk_/);

    const lock = await query<any>(
      `SELECT status, provider_payment_id, amount_usd, locked_at, unlock_at
         FROM stealth_locks WHERE id = $1`,
      [id]
    );
    assert.strictEqual(lock.rows[0].status, 'ACTIVE');
    // 占位先于付款：此刻还没有凭据。
    assert.strictEqual(lock.rows[0].provider_payment_id, null);
    assert.strictEqual(Number(lock.rows[0].amount_usd), 199);

    const displays = await query<any>(
      `SELECT locale, masked_label, unmasked_at FROM stealth_lock_displays WHERE stealth_lock_id = $1`,
      [id]
    );
    assert.strictEqual(displays.rows.length, 1);
    assert.strictEqual(displays.rows[0].locale, 'en-US');
    // 「有且仅有一条」不只是行数：unmasked_at 若与 unlock_at 不同，公开页说出的
    // 解密时刻与账本说的就不是一回事，而两者都自称是权威。
    assert.strictEqual(
      new Date(displays.rows[0].unmasked_at).toISOString(),
      new Date(lock.rows[0].unlock_at).toISOString()
    );
    // 标签不含词根。
    assert.ok(!String(displays.rows[0].masked_label).includes(KEYWORD));

    // 立刻付款。不是为了让本用例"过"，而是因为 `stealth_locks_one_pending_per_user`
    // 是一条**真的**约束：一个用户同时只能有一笔待付占位，留着它会与后面所有
    // 以 BUYER 名义下单的用例打架。那正是它该有的行为——把夹具的形态迁就它。
    await harness.services.StealthLockService.confirmCheckout({
      paymentIntentId: 'pi_slk_activated',
      metadata: { stealthLockId: id, userId: BUYER },
    });
  });

  it('同一个人同时至多一笔待付占位：第二次下单是 409 并附续付链接', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await seedLock({
      lockId: lockId('pendA'),
      opportunityId: OPP_PENDING_A,
      userId: OTHER,
      paid: false,
    });
    await query(
      `UPDATE stealth_locks SET provider_checkout_url = 'https://checkout.test/resume' WHERE id = $1`,
      [lockId('pendA')]
    );

    await assert.rejects(
      () => harness.services.StealthLockService.purchase(OTHER, SAME_PERSON_OPP),
      (error: any) => {
        assert.strictEqual(error.code, 'STEALTH_LOCK_PENDING');
        assert.strictEqual(error.status, 409);
        // 用户丢了结账标签页时，报错等于把他锁在门外 45 分钟——所以必须给出续付入口。
        assert.strictEqual(error.details?.checkoutUrl, 'https://checkout.test/resume');
        return true;
      }
    );

    // 第二次下单没有写成任何东西：机会仍然是处女地。
    const locks = await query(`SELECT id FROM stealth_locks WHERE opportunity_id = $1`, [SAME_PERSON_OPP]);
    assert.strictEqual(locks.rows.length, 0);
    await query(`DELETE FROM stealth_lock_displays WHERE stealth_lock_id = $1`, [lockId('pendA')]);
    await query(`DELETE FROM stealth_locks WHERE id = $1`, [lockId('pendA')]);
  });
});

describe('买断：判据自愈，不依赖调度器（D1）', () => {
  it('未付款占位超过待付窗口后**不跑任何作业**即不再隐藏', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    // 窗口之内：占位与已成交的买断对外没有区别。
    await seedLock({
      lockId: lockId('fresh'),
      opportunityId: OPP_ABANDONED,
      // 用 FREE_USER 只是因为"同时至多一笔待付占位"是按人算的，而 BUYER 在别的
      // 用例里已经有一笔。占位属于谁不影响本用例要验的东西（隐藏判据）。
      userId: FREE_USER,
      paid: false,
      lockedAtSql: "NOW() - INTERVAL '5 minutes'",
    });
    assert.strictEqual(
      await harness.services.StealthLockService.getAvailability(OPP_ABANDONED, OTHER).then(
        () => 'visible',
        (error: any) => (error.code === 'NOT_FOUND' ? 'hidden' : 'other')
      ),
      'hidden',
      '窗口内的占位必须隐藏机会'
    );

    // 把 locked_at 拨到窗口之外——**不跑 `expire-stealth-locks`，也不改 status**。
    // 这正是这条设计的全部意义：正确性挂在数据上，不挂在调度器上。
    await query(
      `UPDATE stealth_locks SET locked_at = NOW() - INTERVAL '50 minutes' WHERE id = $1`,
      [lockId('fresh')]
    );

    const availability = await harness.services.StealthLockService.getAvailability(OPP_ABANDONED, OTHER);
    assert.strictEqual(availability.available, true, '超窗口的未付款占位不该再挡住机会');
    assert.strictEqual(availability.locked, false);

    // 状态列本身**没有**被谁改过：自愈是读侧的事，作业只负责记账。
    const row = await query<any>(`SELECT status FROM stealth_locks WHERE id = $1`, [lockId('fresh')]);
    assert.strictEqual(row.rows[0].status, 'ACTIVE');

    await query(`DELETE FROM stealth_lock_displays WHERE stealth_lock_id = $1`, [lockId('fresh')]);
    await query(`DELETE FROM stealth_locks WHERE id = $1`, [lockId('fresh')]);
  });

  it('已付款的买断不受待付窗口影响，unlock_at 到点才解密', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await seedLock({
      lockId: lockId('paid'),
      opportunityId: OPP_ABANDONED,
      userId: BUYER,
      paid: true,
      // 付过钱、而且 locked_at 早于窗口：它必须仍然隐藏。
      lockedAtSql: "NOW() - INTERVAL '10 days'",
    });

    await assert.rejects(
      () => harness.services.StealthLockService.getAvailability(OPP_ABANDONED, OTHER),
      (error: any) => {
        assert.strictEqual(error.code, 'NOT_FOUND');
        return true;
      }
    );

    // 拨到 unlock_at 之后：即便 `expire-stealth-locks` 还没跑，投影也已经解密。
    await query(
      `UPDATE stealth_locks SET unlock_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [lockId('paid')]
    );
    const availability = await harness.services.StealthLockService.getAvailability(OPP_ABANDONED, OTHER);
    assert.strictEqual(availability.available, true);

    await query(`DELETE FROM stealth_lock_displays WHERE stealth_lock_id = $1`, [lockId('paid')]);
    await query(`DELETE FROM stealth_locks WHERE id = $1`, [lockId('paid')]);
  });
});

describe('买断：与 GO 抢同一把机会级锁（D2）', () => {
  it('并发下单与 GO，恰好一个赢，且输家不留痕迹', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const [purchase, go] = await Promise.allSettled([
      harness.services.StealthLockService.purchase(BUYER, OPP_RACE),
      harness.services.DecisionService.goAndExport(OTHER, {
        opportunityId: OPP_RACE,
        archetype: 'TOOL',
        verdictId: VERDICT_OF[OPP_RACE],
      }),
    ]);

    const winners = [purchase, go].filter((r) => r.status === 'fulfilled');
    assert.strictEqual(winners.length, 1, `买断与 GO 同时成功了 ${winners.length} 次`);

    // 无论谁赢，结果都必须是自洽的：要么锁在且没人占槽，要么有人占槽且没有锁。
    const claimed = await query<any>(
      `SELECT COALESCE(SUM(claimed), 0)::int AS claimed FROM opportunity_slots WHERE opportunity_id = $1`,
      [OPP_RACE]
    );
    const locks = await query<any>(
      `SELECT status FROM stealth_locks WHERE opportunity_id = $1 AND status = 'ACTIVE'`,
      [OPP_RACE]
    );
    if (locks.rows.length > 0) {
      assert.strictEqual(claimed.rows[0].claimed, 0, '买断成立而已有人占槽——独占价卖给了公共机会');
    } else {
      assert.strictEqual(claimed.rows[0].claimed, 1, 'GO 成立而已有生效中的锁');
    }

    // 买断赢了的话，它留下的是一笔**未付款**占位，而"同时至多一笔待付占位"是按人
    // 算的——不清掉它，下一个以同一用户名义下单的用例会撞唯一索引，失败信息与它要
    // 验的东西毫无关系。
    await query(
      `DELETE FROM stealth_lock_displays WHERE stealth_lock_id IN
         (SELECT id FROM stealth_locks WHERE opportunity_id = $1)`,
      [OPP_RACE]
    );
    await query(`DELETE FROM stealth_locks WHERE opportunity_id = $1 AND provider_payment_id IS NULL`, [
      OPP_RACE,
    ]);
  });

  it('非持有者对已被买断的机会下单，回 404 而不是 422（10 §7：不许当存在性判据）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await harness.services.StealthLockService.purchase(BUYER, OPP_HOLDER_GO);

    await assert.rejects(
      () => harness.services.StealthLockService.purchase(OTHER, OPP_HOLDER_GO),
      (error: any) => {
        // 422 会说"这条存在、而且正被独占"——那正是 404 想挡住的信息。而 422 的
        // 适用场合是调用者本来就看得见的机会（`Σclaimed > 0`，它还在 Feed 里）。
        assert.strictEqual(error.code, 'NOT_FOUND');
        assert.strictEqual(error.status, 404);
        return true;
      }
    );
    // 与"这条机会根本不存在"完全同形。
    await assert.rejects(
      () => harness.services.StealthLockService.purchase(OTHER, 'opp_does_not_exist'),
      (error: any) => error.code === 'NOT_FOUND' && error.status === 404
    );

    // 自己重复下单不是 404 —— 持有者看得见它，所以给他准确的话。
    await assert.rejects(
      () => harness.services.StealthLockService.purchase(BUYER, OPP_HOLDER_GO),
      (error: any) => error.code === 'STEALTH_LOCK_PENDING' && error.status === 409
    );

    await query(
      `DELETE FROM stealth_lock_displays WHERE stealth_lock_id IN
         (SELECT id FROM stealth_locks WHERE opportunity_id = $1)`,
      [OPP_HOLDER_GO]
    );
    await query(`DELETE FROM stealth_locks WHERE opportunity_id = $1`, [OPP_HOLDER_GO]);
  });

  it('SlotService.claim 的闸本身会拒非持有者（D2 的另一半，不靠上层预检）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    await harness.services.StealthLockService.purchase(BUYER, OPP_HOLDER_GO);

    /**
     * 直接打 `claim`，绕过 `goAndExport` 的预检。
     *
     * 上层的预检对非持有者回 404（读路径口径），所以走完整流程的用例**永远不会**
     * 碰到这道闸 —— 而这道闸恰恰是 D2 的另一半。它一旦失效（谓词写错、忘了取
     * `opp:` 锁），买断就挡不住 GO，而买断者付的是一份不再成立的价格，且没有任何
     * 一条既有用例会红。
     */
    await assert.rejects(
      () =>
        harness.db.transaction((client: any) =>
          harness.services.SlotService.claim(client, {
            opportunityId: OPP_HOLDER_GO,
            archetype: 'TOOL',
            userId: OTHER,
            projectId: 'prj_not_real',
            claimedAt: new Date(),
            deadlineAt: new Date(Date.now() + 7 * 86400000),
          })
        ),
      (error: any) => {
        assert.strictEqual(error.code, 'STEALTH_LOCK_UNAVAILABLE');
        assert.strictEqual(error.status, 422);
        return true;
      }
    );

    // 持有者过同一道闸时不被拦（他会被后面的检查挡下，但**不是**被这道闸）。
    await assert.rejects(
      () =>
        harness.db.transaction((client: any) =>
          harness.services.SlotService.claim(client, {
            opportunityId: OPP_HOLDER_GO,
            archetype: 'TOOL',
            userId: BUYER,
            projectId: 'prj_not_real',
            claimedAt: new Date(),
            deadlineAt: new Date(Date.now() + 7 * 86400000),
          })
        ),
      (error: any) => {
        assert.notStrictEqual(
          error.code,
          'STEALTH_LOCK_UNAVAILABLE',
          '持有者被买断闸拦住了——他买的就是"一人独享"'
        );
        return true;
      }
    );

    // 清掉这笔待付占位：它是按人计数的，留着会让下面所有以 BUYER 名义下单的用例
    // 撞上唯一索引。
    const { query } = harness.db;
    await query(
      `DELETE FROM stealth_lock_displays WHERE stealth_lock_id IN
         (SELECT id FROM stealth_locks WHERE opportunity_id = $1)`,
      [OPP_HOLDER_GO]
    );
    await query(
      `DELETE FROM stealth_locks WHERE opportunity_id = $1 AND provider_payment_id IS NULL`,
      [OPP_HOLDER_GO]
    );
  });

  it('买断者自己可以 GO（买的是独享窗口期，不是"不许开发"）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await harness.services.StealthLockService.purchase(BUYER, OPP_HOLDER_GO);

    // 持有者：放行。`Σclaimed` 从 0 变成 1 是对的——`Σclaimed == 0` 约束的是
    // **下单那一刻**，不含之后。
    await harness.services.DecisionService.goAndExport(BUYER, {
      opportunityId: OPP_HOLDER_GO,
      archetype: 'TOOL',
      verdictId: VERDICT_OF[OPP_HOLDER_GO],
    });

    // 付掉，理由同上面那条：留着一笔待付占位会让后面所有以 BUYER 名义下单的用例
    // 撞上"同时至多一笔待付占位"。
    const held = await query<any>(
      `SELECT id FROM stealth_locks WHERE opportunity_id = $1 AND status = 'ACTIVE'`,
      [OPP_HOLDER_GO]
    );
    await harness.services.StealthLockService.confirmCheckout({
      paymentIntentId: 'pi_slk_holder',
      metadata: { stealthLockId: held.rows[0].id, userId: BUYER },
    });

    // 别人：拒绝，而且是 422 STEALTH_LOCK_UNAVAILABLE。
    await assert.rejects(
      () =>
        harness.services.DecisionService.goAndExport(OTHER, {
          opportunityId: OPP_HOLDER_GO,
          archetype: 'TOOL',
          verdictId: VERDICT_OF[OPP_HOLDER_GO],
        }),
      (error: any) => {
        // 预检读路径与详情同口径：对非持有者与"不存在"完全同形。
        assert.strictEqual(error.code, 'NOT_FOUND');
        assert.strictEqual(error.status, 404);
        return true;
      }
    );
  });
});

describe('买断：可见性矩阵（D3）', () => {
  before(async () => {
    if (!harness.available) return;
    await seedLock({
      lockId: lockId('visib'),
      opportunityId: OPP_PROJECTED,
      userId: BUYER,
      paid: true,
    });
  });

  it('详情：买断者 200，其他人 404（与"不存在"完全同形）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const mine = await harness.services.OpportunityService.getOpportunityDetail(OPP_PROJECTED, {
      viewerId: BUYER,
    });
    assert.strictEqual(mine.opportunity.id, OPP_PROJECTED);

    await assert.rejects(
      () =>
        harness.services.OpportunityService.getOpportunityDetail(OPP_PROJECTED, { viewerId: OTHER }),
      (error: any) => {
        assert.strictEqual(error.code, 'NOT_FOUND');
        assert.strictEqual(error.status, 404);
        return true;
      }
    );

    // 未登录（没有 viewerId）必须按"陌生人"处理，而不是放行。
    await assert.rejects(
      () => harness.services.OpportunityService.getOpportunityDetail(OPP_PROJECTED),
      (error: any) => error.code === 'NOT_FOUND'
    );
  });

  it('Feed / 比较：对所有人排除，买断者本人也在内（16 §3.3）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const feed = await harness.services.OpportunityService.listFeedCards({ limit: 200 });
    assert.ok(
      !feed.items.some((item: any) => item.opportunityId === OPP_PROJECTED),
      '被买断的机会仍然出现在 Feed 里'
    );

    // 比较要求 2–3 条，所以配一条没被锁的。
    await assert.rejects(
      () =>
        harness.services.OpportunityService.compareOpportunities([OPP_PROJECTED, OPP_TRACKED]),
      (error: any) => {
        assert.strictEqual(error.code, 'NOT_FOUND');
        return true;
      }
    );
  });

  it('槽位与买断资格：买断者可用，其他人 404', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const slots = await harness.services.SlotService.getSlots(OPP_PROJECTED, BUYER);
    assert.ok(slots.slots.length > 0, '买断者必须能读到槽位，否则他点不到 GO');

    await assert.rejects(
      () => harness.services.SlotService.getSlots(OPP_PROJECTED, OTHER),
      (error: any) => error.code === 'NOT_FOUND'
    );
    await assert.rejects(
      () => harness.services.SlotService.getSlots(OPP_PROJECTED),
      (error: any) => error.code === 'NOT_FOUND'
    );

    // 持有者自己看到的是"已持有"，不是"可以买"——他还没 GO 时 `Σclaimed` 正是 0。
    const mine = await harness.services.StealthLockService.getAvailability(OPP_PROJECTED, BUYER);
    assert.strictEqual(mine.locked, true);
    assert.strictEqual(mine.heldByMe, true);
    assert.strictEqual(mine.available, false);
  });

  it('告警规则的创建入口不是存在性判据', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    await assert.rejects(
      () =>
        harness.services.AlertService.createAlertRule(OTHER, {
          opportunityId: OPP_PROJECTED,
          ruleType: 'VERDICT_CHANGE',
          frequency: 'DAILY',
        } as any),
      (error: any) => {
        assert.strictEqual(error.code, 'NOT_FOUND');
        return true;
      }
    );
  });

  /**
   * 研报是**另一条入口**，而且比详情漏得更多：详情只给卡片字段，研报给全文。
   *
   * 这条用例是补出来的：端到端演练时发现，详情端点已经正确 404，而研报端点对
   * 同一个非持有者原样返回 21 KB（真实标题、slug、121 处词根）。原因是判据只加在
   * `getOpportunityDetail` 那条查询上，研报自己按 `o.id = $1 OR o.slug = $1` 直取。
   * 光看"我接线了哪几个函数"是查不出这个的——所以这条断言必须钉在服务层，
   * 而不是路由层：路由挡得住 HTTP，挡不住点火包那条服务层直调。
   */
  it('研报：买断者读得到，其他人 404（与"不存在"完全同形）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    await assert.rejects(
      () =>
        harness.services.ReportService.getOrGenerateReport(OPP_PROJECTED, OTHER, 'en-US', {
          viewerId: OTHER,
        }),
      (error: any) => {
        assert.strictEqual(error.code, 'NOT_FOUND');
        assert.strictEqual(error.status, 404);
        return true;
      }
    );

    // 不传 viewerId 必须按"陌生人"处理（fail-closed），否则漏掉一个调用点就等于开一扇门。
    await assert.rejects(
      () => harness.services.ReportService.getOrGenerateReport(OPP_PROJECTED, OTHER, 'en-US'),
      (error: any) => error.code === 'NOT_FOUND'
    );

    // 持有者方向：判据必须放行。报告是否能生成出来与可见性无关（本夹具未必喂足了
    // 生成所需的证据），所以这里断言的是"没被买断判据挡住"，不是"生成成功"。
    try {
      await harness.services.ReportService.getOrGenerateReport(OPP_PROJECTED, BUYER, 'en-US', {
        viewerId: BUYER,
      });
    } catch (error: any) {
      assert.notStrictEqual(error.code, 'NOT_FOUND', '持有者被买断判据挡住了自己的研报');
    }
  });

  /**
   * 反向断言：**用户自己已经建好的项目不参与打码**（10 §7 的第二处例外）。
   *
   * 这条不是"漏了一处"，是刻意的，而且必须钉住——否则下一次"把漏网之鱼扫一遍"
   * 会顺手把它一起打码，用户自己的看板就此失去上下文、`stake` 的相关性探针拿不到词，
   * 换到的是零额外保护：这条路径的读者早就掌握了该机会（他先认领了槽位、在项目上
   * 投入过），而他能做的每个动作都已经堵死（Feed / 搜索 / 比较 / 详情 / 研报 /
   * 槽位 / 告警，以及 `SlotService.claim` 拒非持有者）。买断卖的是**向前**的
   * 「不被发现、不被别人占用」，不是「取消知道」——后者做不到，也不该假装做到。
   */
  it('用户自己的项目上，机会标题照常可见（10 §7 的例外，不是漏网）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await query(
      `INSERT INTO projects (id, user_id, opportunity_id, title, build_type, stake_deadline_at)
       VALUES ('prj_slk_other', $1, $2, 'my own build', 'TOOL', NOW() + INTERVAL '7 days')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER, OPP_PROJECTED]
    );

    const projects = await harness.services.ProjectService.listUserProjects(OTHER);
    const mine = projects.find((project: any) => project.id === 'prj_slk_other');
    assert.ok(mine, '自己的项目不该从自己的列表里消失');
    assert.ok(
      mine.opportunity_title && !mine.opportunity_title.startsWith('[Stealth'),
      '自己的项目上不该把机会标题打码——那不是保护，是把用户的看板弄坏'
    );

    const detail = await harness.services.ProjectService.getProjectDetail('prj_slk_other', OTHER);
    assert.ok(detail?.project ?? detail, '自己的项目详情必须读得到');
  });

  /**
   * 列表类入口的第二条规矩：`createAlertRule` 挡的是"现在去建一条"，挡不住
   * "买断之前就建好了"。规则与通知都是用户自己在机会还可见时留下的行，锁生效之后
   * 它们照样在库里，而这两条查询原样带出 `o.title` / `o.slug`。
   *
   * 断言用的是"行消失"，不是"标题被打码"：行里带着 `opportunity_id`，而本库的机会 id
   * 直接嵌了 slug，只换标题会把词根留在同一行的另一个字段上。
   */
  it('告警规则与通知列表：非持有者看不到被买断的机会，持有者照常看到', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await query(
      `INSERT INTO alert_rules (id, user_id, opportunity_id, rule_type, frequency) VALUES
         ('alr_slk_other', $1, $3, 'VERDICT_CHANGE', 'IMMEDIATE'),
         ('alr_slk_buyer', $2, $3, 'VERDICT_CHANGE', 'IMMEDIATE')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER, BUYER, OPP_PROJECTED]
    );
    await query(
      `INSERT INTO notifications (id, user_id, opportunity_id, title, body) VALUES
         ('ntf_slk_other', $1, $2, 'leaked title', 'leaked body'),
         ('ntf_slk_system', $1, NULL, 'system notice', 'no opportunity attached')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER, OPP_PROJECTED]
    );

    const othersRules = await harness.services.AlertService.listAlertRules(OTHER);
    assert.ok(
      !othersRules.some((rule: any) => rule.opportunity_id === OPP_PROJECTED),
      '非持有者的规则列表里仍然带着被买断的机会'
    );
    const buyerRules = await harness.services.AlertService.listAlertRules(BUYER);
    assert.ok(
      buyerRules.some((rule: any) => rule.opportunity_id === OPP_PROJECTED),
      '持有者自己的规则反而被隐藏了'
    );

    const othersNotes = await harness.services.AlertService.listNotifications(OTHER);
    assert.ok(
      !othersNotes.some((note: any) => note.opportunity_id === OPP_PROJECTED),
      '非持有者的通知列表里仍然带着被买断的机会'
    );
    // `opportunity_id IS NULL` 的系统通知不该被这条判据误伤。
    assert.ok(
      othersNotes.some((note: any) => note.id === 'ntf_slk_system'),
      '系统通知被买断判据误伤了'
    );
  });
});

describe('买断：下单本身不动公开投影（15 §3.1 第 7 条）', () => {
  it('未付款占位期间，API 已隐藏，但公开页照常是真实 slug（刻意，不是漏网）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    // 这条机会在买断**之前**就已经有公开页了——这是最常见的情形：它是处女地
    // （`Σclaimed == 0`），不等于它还没被发布过。
    const realSlug = OPP_RESERVED.replace(/_/g, '-');
    await query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable, content, published_at)
       VALUES ($1, $2, 'en-US', 'OPPORTUNITY', $3, 'PUBLISHED', true, $4, NOW())`,
      [`pg_real_${OPP_RESERVED}`, realSlug, OPP_RESERVED, JSON.stringify({ title: `${KEYWORD} title` })]
    );

    // 下单但不付款：留下一笔待付占位。
    const { lockId: id } = await harness.services.StealthLockService.purchase(BUYER, OPP_RESERVED);
    const lock = await query<any>(`SELECT provider_payment_id FROM stealth_locks WHERE id = $1`, [id]);
    assert.strictEqual(lock.rows[0].provider_payment_id, null, '本用例的前提是"还没收到钱"');

    // ① API 侧：占位那一刻就已经对所有人隐藏（10 §7）。
    await assert.rejects(
      () => harness.services.OpportunityService.getOpportunityDetail(OPP_RESERVED, { viewerId: OTHER }),
      (error: any) => error.code === 'NOT_FOUND'
    );

    // ② 公开投影侧：**不得**被打码。这条契约的方向与别处相反——要断言"没被打码"。
    // 打码会把真实 slug 那行翻成 `DRAFT`（第 6 条末），也就是把该页踢出 sitemap；
    // 若触发条件只是"有人下了单"，一个不付款的 Pro 用户就拿到一根免费杠杆：
    // 对任意机会下单再关掉标签页，即可让一个已经积累权重的公开页下线。
    // `STEALTH_LOCK_PENDING` 是限流（一次只遮一条），不是授权。
    const pages = await query<any>(`SELECT slug, status FROM public_pages WHERE opportunity_id = $1`, [
      OPP_RESERVED,
    ]);
    assert.ok(
      !pages.rows.some((r) => r.slug.startsWith('stealth-lock-')),
      '下单就写了打码页——那等于把"下线任意公开页"做成了一根免费的杠杆'
    );
    assert.strictEqual(
      pages.rows.find((r) => r.slug === realSlug).status,
      'PUBLISHED',
      '钱还没到，公开页必须照常在线'
    );

    // ③ 口径是"永不欠打码"，不是"永不打码"：转折点在**付款**。钱一到，同一页必须
    // 立刻变成打码态（这一侧另有专门用例，这里只钉住转折点是付款而不是下单）。
    await harness.services.StealthLockService.confirmCheckout({
      paymentIntentId: 'pi_slk_reserved',
      metadata: { stealthLockId: id, userId: BUYER },
    });
    const after = await query<any>(`SELECT slug, status FROM public_pages WHERE opportunity_id = $1`, [
      OPP_RESERVED,
    ]);
    assert.ok(after.rows.some((r) => r.slug.startsWith('stealth-lock-') && r.status === 'PUBLISHED'));
    assert.strictEqual(after.rows.find((r) => r.slug === realSlug).status, 'DRAFT');
  });
});

describe('买断：公开投影打码（D4、15 §3.1）', () => {
  it('打码页换 slug、indexable=false，原页翻 DRAFT，正文扫不到词根', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    // 先让这条机会有一张真实的公开页。
    await query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable, content, published_at)
       VALUES ($1, $2, 'en-US', 'OPPORTUNITY', $3, 'PUBLISHED', true, $4, NOW())`,
      [`pg_real_${OPP_PROJECTED}`, OPP_PROJECTED.replace(/_/g, '-'), OPP_PROJECTED, JSON.stringify({ title: `${KEYWORD} title` })]
    );

    await harness.services.PublicPublicationService.publishOpportunity(OPP_PROJECTED);

    const rows = await query<any>(
      `SELECT slug, status, indexable, content FROM public_pages
        WHERE opportunity_id = $1 ORDER BY slug`,
      [OPP_PROJECTED]
    );
    const original = rows.rows.find((r) => r.slug === OPP_PROJECTED.replace(/_/g, '-'));
    const masked = rows.rows.find((r) => r.slug.startsWith('stealth-lock-'));

    assert.ok(original, '原页被删了——期满就再也恢复不回来');
    assert.strictEqual(original.status, 'DRAFT', '原页必须离线，否则真实词根仍然可读');
    assert.ok(masked, '没有写出打码页：机会会变成 404，而 15 §3.1 要求它是 200');
    assert.strictEqual(masked.status, 'PUBLISHED');
    // 打码页不进 sitemap、不被索引（sitemap 过滤 `indexable = true`）。
    assert.strictEqual(masked.indexable, false);
    // slug 自己就是泄露面，所以它必须由锁 id 派生。
    assert.ok(!masked.slug.includes(KEYWORD));
    // 正文里扫不到词根——包括所有键值，不只是 title。
    assert.ok(
      !JSON.stringify(masked.content).includes(KEYWORD),
      `打码页正文里仍有真实词根：${JSON.stringify(masked.content)}`
    );
    assert.strictEqual(masked.content.isStealthMasked, true);
    assert.ok(masked.content.maskedLabel);
    assert.ok(masked.content.unmaskedAt);
  });

  it('期满后撤掉打码页，原页恢复为 PUBLISHED', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const lock = await query<any>(
      `SELECT id FROM stealth_locks WHERE opportunity_id = $1 AND status = 'ACTIVE'`,
      [OPP_PROJECTED]
    );
    await query(`UPDATE stealth_locks SET unlock_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
      lock.rows[0].id,
    ]);

    await harness.services.PublicPublicationService.publishOpportunity(OPP_PROJECTED);

    const rows = await query<any>(
      `SELECT slug, status FROM public_pages WHERE opportunity_id = $1`,
      [OPP_PROJECTED]
    );
    assert.ok(
      !rows.rows.some((r) => r.slug.startsWith('stealth-lock-')),
      '占位已失效，打码页却还留在站点里'
    );
  });
});

describe('买断：公开战报必须打码，但**一行都不许少**（06 §11、15 §8）', () => {
  before(async () => {
    if (!harness.available) return;
    const { query } = harness.db;

    await seedLock({
      lockId: lockId('eps'),
      opportunityId: OPP_EPISODE,
      userId: BUYER,
      paid: true,
    });

    // 一条已过公开禁售期的 Episode。买断不能改变它是否被计入。
    for (const [id, opportunityId, outcome] of [
      ['eps_slk_locked', OPP_EPISODE, 'MISS'],
      ['eps_slk_open', OPP_TRACKED, 'HIT'],
    ] as const) {
      await query(
        `INSERT INTO prediction_episodes (id, verdict_id, opportunity_id, published_verdict, predicted_at, outcome_30d)
         VALUES ($1, $2, $3, 'BUILD_NOW', (NOW() - INTERVAL '120 days')::date, $4)`,
        [id, VERDICT_OF[opportunityId], opportunityId, outcome]
      );
    }
  });

  it('打码：真实词根扫不到，三个字段齐备', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const record = await harness.services.TrackRecordService.getPublicTrackRecord();
    const body = JSON.stringify(record);

    assert.ok(!body.includes(KEYWORD), '公开战报里仍有被买断机会的真实词根');
    // 反向对照：没被买断的那条**必须**照常露出真实词根。少了这条对照，"扫不到"
    // 可能只是因为整个响应是空的。
    assert.ok(body.includes(OTHER_KEYWORD), '未被买断的机会不该被打码');

    const masked = record.episodes.find((e: any) => e.id === 'eps_slk_locked');
    assert.ok(masked, '被买断的 Episode 从公开战报里整条消失了——那等于用钱买走败绩');
    assert.strictEqual(masked.is_stealth_masked, true);
    assert.ok(String(masked.masked_label).includes('Stealth Locked'));
    assert.ok(masked.unmasked_at);
    assert.ok(!String(masked.opportunity_slug).includes(KEYWORD));

    // 未被买断的那条照常给真实标题与 slug。
    const open = record.episodes.find((e: any) => e.id === 'eps_slk_open');
    assert.strictEqual(open.is_stealth_masked, false);
  });

  it('口径：买断机会仍然计入分子与分母', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const record = await harness.services.TrackRecordService.getPublicTrackRecord();

    // 一条 HIT、一条 MISS —— 两条都算。少算任何一条都会让"命中与失误都公开"
    // 变成一句只在没人买断时成立的话。
    assert.strictEqual(record.stats.totalPredictions, 2);
    assert.strictEqual(record.stats.evaluatedEpisodes, 2);
    assert.strictEqual(record.stats.hitsCount, 1);
    assert.strictEqual(record.stats.hitRate30d, '50%');
  });
});

describe('买断：作废与回填', () => {
  it('webhook 回填凭据时同步刷新公开投影（不等 S8）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const id = lockId('confirm');
    await seedLock({
      lockId: id,
      opportunityId: OPP_CONFIRM,
      userId: BUYER,
      paid: false,
    });
    await query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable, content, published_at)
       VALUES ($1, $2, 'en-US', 'OPPORTUNITY', $3, 'PUBLISHED', true, '{}'::jsonb, NOW())`,
      [`pg_real_${OPP_CONFIRM}`, OPP_CONFIRM.replace(/_/g, '-'), OPP_CONFIRM]
    );

    const outcome = await harness.services.StealthLockService.confirmCheckout({
      paymentIntentId: 'pi_slk_direct',
      metadata: { stealthLockId: id, userId: BUYER, purchaseKind: 'STEALTH_BUYOUT' },
    });
    assert.strictEqual(outcome.status, 'ACTIVATED');

    const lock = await query<any>(`SELECT provider_payment_id FROM stealth_locks WHERE id = $1`, [id]);
    assert.strictEqual(lock.rows[0].provider_payment_id, 'pi_slk_direct');

    // 归因行：没有它，一次拒付会变成一条永久 500 的重试循环。
    const purchaseRow = await query<any>(
      `SELECT id FROM stripe_purchases WHERE stripe_payment_intent_id = 'pi_slk_direct'`
    );
    assert.strictEqual(purchaseRow.rows.length, 1);

    // 投影必须在**付款那一刻**就已经打码，否则最长一整天真实词根还挂在公开页上。
    const pages = await query<any>(
      `SELECT slug, status FROM public_pages WHERE opportunity_id = $1`,
      [OPP_CONFIRM]
    );
    assert.ok(pages.rows.some((r) => r.slug.startsWith('stealth-lock-') && r.status === 'PUBLISHED'));
    assert.strictEqual(
      pages.rows.find((r) => r.slug === OPP_CONFIRM.replace(/_/g, '-')).status,
      'DRAFT'
    );

    // 同一笔重复投递是幂等的。
    const again = await harness.services.StealthLockService.confirmCheckout({
      paymentIntentId: 'pi_slk_direct',
      metadata: { stealthLockId: id, userId: BUYER },
    });
    assert.strictEqual(again.status, 'DUPLICATE');

    // 元数据缺块（不是我们发出去的会话）不许静默 200 放过。
    const orphan = await harness.services.StealthLockService.confirmCheckout({
      paymentIntentId: 'pi_slk_orphan',
      metadata: {},
    });
    assert.strictEqual(orphan.status, 'UNATTRIBUTED');
  });

  it('退款/拒付把锁置 VOID，机会立即回到公共池（13 §4.3）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const before = await query<any>(
      `SELECT id FROM stealth_locks WHERE opportunity_id = $1 AND status = 'ACTIVE'`,
      [OPP_CONFIRM]
    );
    const id = before.rows[0].id;

    await harness.services.StealthLockService.voidForReversal(id, 'PAYMENT_REFUNDED');

    const after = await query<any>(`SELECT status FROM stealth_locks WHERE id = $1`, [id]);
    // 翻 VOID 而不是删行：删掉会让「钱到了但占位已作废」只能靠"查不到行"去推断
    // （03 §17 I15）。
    assert.strictEqual(after.rows[0].status, 'VOID');

    const availability = await harness.services.StealthLockService.getAvailability(OPP_CONFIRM, OTHER);
    assert.strictEqual(availability.available, true, '退款后机会必须立即回到公共池');
  });

  it('作业：`releaseExpired` 翻 EXPIRED，`voidUnpaid` 只收超窗口的未付款行', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    // OPP_PROJECTED 上那把锁的 `unlock_at` 已被上一个用例拨到过去，但 `status`
    // 仍是 ACTIVE —— 这正是"到期解密不依赖作业"之后作业要补上的那一步记账。
    // 这里不另起一把锁：I13 的部分唯一索引会让同一机会的第二把 ACTIVE 直接撞上，
    // 而那种失败与"作业对不对"毫无关系。
    await seedLock({
      lockId: lockId('unpaid'),
      opportunityId: OPP_SWEEP,
      userId: FREE_USER,
      paid: false,
      lockedAtSql: "NOW() - INTERVAL '2 hours'",
    });

    const expired = await harness.services.StealthLockService.releaseExpired();
    assert.ok(
      expired.some((row) => row.opportunityId === OPP_PROJECTED),
      '期满的锁没有被翻成 EXPIRED'
    );
    const expiredRow = await query<any>(
      `SELECT status FROM stealth_locks WHERE opportunity_id = $1`,
      [OPP_PROJECTED]
    );
    assert.strictEqual(expiredRow.rows[0].status, 'EXPIRED');

    // `isPaid` 的返回值说了算：作业不许靠时间猜钱到没到。
    let asked = 0;
    const voided = await harness.services.StealthLockService.voidUnpaid(async () => {
      asked++;
      return false;
    });
    assert.ok(voided.some((row) => row.lockId === lockId('unpaid')));
    assert.strictEqual(asked, 1, '只该对超窗口的那一行去问供应商');
    const voidedRow = await query<any>(`SELECT status FROM stealth_locks WHERE id = $1`, [lockId('unpaid')]);
    assert.strictEqual(voidedRow.rows[0].status, 'VOID');
  });

  it('`/me/stealth-locks` 只列自己的，且 VOID 行不出现', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    const mine = await harness.services.StealthLockService.getMyLocks(BUYER);
    assert.ok(mine.length > 0);
    // 持有者看到的是**真实标题**：他买的就是这个。
    assert.ok(mine.some((lock) => lock.opportunityTitle.includes(KEYWORD)));
    assert.ok(mine.every((lock) => lock.status !== 'VOID'));

    const theirs = await harness.services.StealthLockService.getMyLocks(OTHER);
    assert.ok(
      theirs.every((lock) => !mine.some((m) => m.lockId === lock.lockId)),
      '一个人看到了另一个人的买断'
    );
  });

  it('同一机会至多一把 ACTIVE 锁（I13 的防多，由部分唯一索引兜底）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    // 退款用例已把 OPP_CONFIRM 的锁置为 VOID，所以这里能再写一把。
    await seedLock({
      lockId: lockId('dup1'),
      opportunityId: OPP_CONFIRM,
      userId: OTHER,
      paid: true,
    });
    await assert.rejects(
      () =>
        seedLock({
          lockId: lockId('dup2'),
          opportunityId: OPP_CONFIRM,
          userId: BUYER,
          paid: true,
        }),
      (error: any) => {
        assert.strictEqual(error.code, '23505');
        return true;
      }
    );
  });
});

describe('买断：30 天内 2 次未付款作废后取消下单资格（PRD v2.2 Q8）', () => {
  const STRIKER = 'usr_slk_striker';
  const OPP_STRIKE = 'opp_slk_strike';

  async function voidedLock(id: string) {
    await harness.db.query(
      `INSERT INTO stealth_locks (id, opportunity_id, user_id, status, locked_at, unlock_at, amount_usd)
       VALUES ($1, $2, $3, 'VOID', NOW() - INTERVAL '1 day', NOW() + INTERVAL '59 days', 199.00)`,
      [id, OPP_STRIKE, STRIKER]
    );
  }

  it('一次作废仍可下单，第二次作废后被拒绝且不留新锁', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await query(
      `INSERT INTO users (id, email, display_name, role, tier, email_verified_at)
       VALUES ($1, $2, $1, 'USER', 'PRO', NOW())`,
      [STRIKER, `${STRIKER}@emeradar.test`]
    );
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, 'PRO', 'ACTIVE', NOW() + INTERVAL '30 days')`,
      [`sub_${STRIKER}`, STRIKER]
    );
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, 'opp-slk-strike', 'strike title', 'TRACKED', '2026-01-01')`,
      [OPP_STRIKE]
    );
    await query(
      `INSERT INTO opportunity_slots (opportunity_id, archetype, capacity) VALUES ($1, 'TOOL', 2)`,
      [OPP_STRIKE]
    );

    await voidedLock(lockId('strike1'));
    const first = await harness.services.StealthLockService.purchase(STRIKER, OPP_STRIKE);
    assert.ok(first.lockId, '只有一次作废时不该被拦');
    // 把这笔占位也变成作废，凑满第二次。
    await query(`DELETE FROM stealth_lock_displays WHERE stealth_lock_id = $1`, [first.lockId]);
    await query(`UPDATE stealth_locks SET status = 'VOID' WHERE id = $1`, [first.lockId]);

    await assert.rejects(
      () => harness.services.StealthLockService.purchase(STRIKER, OPP_STRIKE),
      (error: any) => {
        assert.strictEqual(error.code, 'STEALTH_BUYOUT_SUSPENDED');
        assert.strictEqual(error.status, 403);
        return true;
      }
    );
    const active = await query(
      `SELECT id FROM stealth_locks WHERE user_id = $1 AND status = 'ACTIVE'`,
      [STRIKER]
    );
    assert.strictEqual(active.rows.length, 0);
  });
});
