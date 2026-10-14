-- 0007 — 处女地独占买断（Epic 1.14、PRD §1.7 第 5/7 条、03 §12/§15/§17）。
--
-- 两张表都不存在于任何既有迁移，所以这条迁移是纯新增。但有三处**不是照抄规格**，
-- 每一处都对应一个会让功能悄悄坏掉的坑，写在这里以免后来者以为是笔误：
--
--   1. `status` 多了 `VOID`（00-INDEX §4.3 已同步）。规格原本只有 ACTIVE/EXPIRED，
--      但"先占位、后付款"必然产生第三种结局：占位了、钱没到。把它并进 EXPIRED 会让
--      "买了没买成"和"买了到期了"变成同一档，买断的成单率从此无法统计；而删行则
--      会让「钱到了但占位已作废」这条路径只能靠"查不到行"去推断（03 §17 I15）。
--
--   2. `stealth_lock_displays` 的主键按**锁**而不是按机会。按 (opportunity_id, locale)
--      做主键时，同一机会的第二笔买断（第一笔 EXPIRED 之后 Σclaimed 又回到 0，合法）
--      会撞主键，唯一出路是删掉第一笔的显示行——于是第一笔的锁永远失去了"有且仅有
--      一条显示行"的性质。键选错会把一次不变量的破坏伪装成一次主键冲突。
--
--   3. 三列结账会话状态。没有会话 id 就无法回答"这个用户是不是已有一笔待付占位"，
--      于是防滥用闸（同时至多一笔）要么无法实现，要么退化成"重复 POST 直接报错"——
--      而用户丢了结账标签页时，报错等于把他锁在门外 45 分钟。
--
-- 与 0001–0006 一样是前向迁移。

-- ---------------------------------------------------------------------------
-- 1. stealth_locks（03 §12）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stealth_locks (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  -- ACTIVE：生效中（已付款，或仍在待付窗口内）
  -- EXPIRED：60 天保护期满，自动解密
  -- VOID：待付窗口内未付款，占位作废（不是期满）
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','EXPIRED','VOID')),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 在**下单那一刻**就已确定，不等付款后重算：投影要能当场说出解密时刻，而付款
  -- 落账不该让一个已经对外可见的期限悄悄平移。
  unlock_at TIMESTAMPTZ NOT NULL,
  amount_usd NUMERIC(10,2),
  -- **它是"已付款"的唯一标记。** 待付占位与已成交买断共用 ACTIVE，区别只在这一列
  -- 是否为 NULL。用一个新状态值去表达同一件事，就是同一事实的第二种表示，必然会漂。
  provider_payment_id TEXT,
  -- 托管的结账会话。落库是为了让"同时至多一笔待付占位"这条闸能**续付**。
  provider_checkout_session_id TEXT,
  provider_checkout_url TEXT,
  checkout_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- I13 的"防多"：同一机会至多一个 ACTIVE。待付占位与已成交买断同属 ACTIVE，因此
-- 一条待付占位也会挡住第二笔下单——这正是要的：机会已经被占住了。
CREATE UNIQUE INDEX IF NOT EXISTS stealth_locks_one_active
  ON stealth_locks (opportunity_id) WHERE status = 'ACTIVE';

-- 作废扫描（`status='ACTIVE' AND provider_payment_id IS NULL AND locked_at < ...`）。
-- 部分索引带上 `provider_payment_id IS NULL`：已成交的行永远不进这条扫描，而它们是
-- 表里绝大多数，所以这个谓词不只是选择性，它把"会不会误动作废一笔付过钱的买断"
-- 从"代码写对了没有"变成了"索引里根本没有这些行"。
CREATE INDEX IF NOT EXISTS idx_stealth_locks_void_scan
  ON stealth_locks (locked_at) WHERE status = 'ACTIVE' AND provider_payment_id IS NULL;

-- 到期解密扫描（`status='ACTIVE' AND unlock_at <= now()`）。
CREATE INDEX IF NOT EXISTS idx_stealth_locks_expiry_scan
  ON stealth_locks (unlock_at) WHERE status = 'ACTIVE';

-- 同一用户同时至多一笔待付占位（10 §4.5b 的防滥用闸）。
-- 做成部分唯一索引而不是靠应用层先查后写：先查后写在两个并发请求下会双双通过，
-- 而这条闸挡的恰恰是"同一个人反复点"这种天然并发的行为。
CREATE UNIQUE INDEX IF NOT EXISTS stealth_locks_one_pending_per_user
  ON stealth_locks (user_id)
  WHERE status = 'ACTIVE' AND provider_payment_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. stealth_lock_displays（03 §15）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stealth_lock_displays (
  stealth_lock_id TEXT NOT NULL REFERENCES stealth_locks(id) ON DELETE CASCADE,
  -- 冗余存一份只为读路径少一次 join；不参与主键（见文件头第 2 条）。
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  masked_label TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en-US',
  -- 与 stealth_locks.unlock_at 逐字一致（I14）。冗余是刻意的：读路径只 join 这一张
  -- 表就能同时拿到"打什么码"与"什么时候解密"，不必再去查锁表。
  unmasked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (stealth_lock_id, locale)
);

-- 按机会反查显示行：公开投影是"这条机会现在该打什么码"，入口是机会而不是锁。
CREATE INDEX IF NOT EXISTS idx_stealth_lock_displays_opportunity
  ON stealth_lock_displays (opportunity_id, unmasked_at DESC);

-- ---------------------------------------------------------------------------
-- 3. plans.entitlements 补 `stealth_buyout`（13 §3.1/§3.2）
-- ---------------------------------------------------------------------------
-- 只加不删，且 FREE 显式写 `false` 而不是省略：读侧是 `!!ent.stealth_buyout`，
-- 省略会静默落到 false，看起来"对"，但那份"对"来自一个没写下来的默认值——
-- 下次谁把读侧的兜底改成 `?? true`，免费层就悄悄获得了买断权。
-- 与 0004 同样按扁平键追加（信封重构属 Epic 1.6，届时键名不变）。
UPDATE plans
   SET entitlements = entitlements
     || CASE code
          WHEN 'FREE' THEN '{"stealth_buyout": false}'::jsonb
          WHEN 'PRO'  THEN '{"stealth_buyout": true}'::jsonb
          WHEN 'TEAM' THEN '{"stealth_buyout": true}'::jsonb
          ELSE '{}'::jsonb
        END
 WHERE code IN ('FREE','PRO','TEAM');
