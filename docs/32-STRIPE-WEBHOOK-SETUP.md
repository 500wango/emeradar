# 32 — Stripe 接入：密钥、Webhook 与验证

Status: 部分实现（2026-10-17）。代码侧已就绪并通过测试；真实 Stripe 账号的 endpoint 与密钥尚未配置——
本地 `.env` 与生产 `/opt/emeradar/.env` 里的 `STRIPE_*` 目前都是占位符（长度 14 / 12，真值是
`sk_test_…` 二十位以上、`whsec_…` 二十位以上）。**未配置前生产结账是关死的，webhook 一律拒绝**。

---

## 1. 代码里已经固定的事实

| 项 | 值 |
|---|---|
| 路由 | `apps/web/src/app/api/v1/billing/webhook/route.ts` → `POST /api/v1/billing/webhook` |
| 生产 URL | `https://emeradar.com/api/v1/billing/webhook` |
| 签名 | HMAC-SHA256，`t=` + `v1=`，时间容差 300s（`StripeService.verifyWebhookSignature`） |
| secret 未配置 | 500 `Webhook endpoint not configured`（fail-closed，不处理任何事件） |
| 缺签名 / 签名错 | 400（不落库、不释放幂等占位） |
| 幂等 | `webhook_events(id)` 先占位再处理；处理抛错时删除占位以便 Stripe 重投 |
| 商品与价格 | 不读 Dashboard 的 Product/Price；Checkout 用 inline `price_data`（`stripe.service.ts` 的 `PLAN_PRICES`） |
| 无 SDK 依赖 | 全部走 `fetch` + 手写 HMAC，仓库里没有 `stripe` npm 包 |

只处理这 9 个事件类型，其余一律 200 忽略：

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
charge.refunded
charge.dispute.created
charge.dispute.closed
```

## 2. Dashboard 配置（test 与 live 各做一遍）

1. Developers → API keys，复制 Secret key（`sk_test_…` / `sk_live_…`）。
   **不需要 publishable key**：结账是跳转 Checkout 托管页，前端不加载 Stripe.js。
2. Workbench → Webhooks（旧版 Dashboard 是 Developers → Webhooks）→ Add endpoint / Add destination：
   - Endpoint URL：`https://emeradar.com/api/v1/billing/webhook`
   - Events：上面的 9 个（不要选 "all events"，制造无谓投递）
   - 不勾 connected accounts（本账号没有 Connect）
3. 建好后在该 endpoint 详情里 Reveal signing secret，得到 `whsec_…`。
   **test 与 live 各有独立 secret，混用的结果不是报错而是全部 400。**
4. 同页确认 endpoint 渲染事件所用的 API version。2025-03-31（Basil）之后
   `subscription.current_period_end` 挪到 `items.data[]`、`invoice.subscription` 挪到
   `parent.subscription_details.subscription`；两种形状都已兼容（§5），但这页是字段再变时的第一现场。

## 3. 环境变量与切换顺序

```bash
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

`docker-compose.prod.yml` 用 `${STRIPE_SECRET_KEY:?…}` / `${STRIPE_WEBHOOK_SECRET:?…}` 透传：
键**缺失**时 compose 拒绝启动，键**是占位符**时容器正常起来但所有事件 400。两种失败长得不一样，
排障先看长度而不是看有没有这个键。

```bash
cd /opt/emeradar
cp -p .env .env.$(date +%F).bak      # 不要整文件替换：里面有 DB/邮件/搜索密钥
# 只改两个 STRIPE_* 值
docker compose -f docker-compose.prod.yml up -d --no-deps web
docker compose -f docker-compose.prod.yml ps
```

只有 `web` 处理 webhook，`worker` 不需要重建。

## 4. 验证（可重跑）

探活（未配 secret 时是 500，配了占位符是 400，键正确时应为 400 缺签名）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://emeradar.com/api/v1/billing/webhook \
  -H 'content-type: application/json' -d '{"id":"evt_probe","type":"ping"}'
# 2026-10-17 实测：400 {"error":"Missing webhook signature"}
```

真实事件（test 模式走一单，卡号 `4242 4242 4242 4242`）后查落库：

```bash
ssh emeradar 'cd /opt/emeradar && docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d emeradar -c "SELECT id,event_type,processed_at,completed_at FROM webhook_events ORDER BY processed_at DESC LIMIT 10"'
```

`webhook_events` 里出现 `checkout.session.completed` 即说明签名、幂等、落库全通；
`stripe_purchases` 同时应有一行，`subscriptions.stripe_subscription_id` 有值。

本地不暴露公网入口：

```bash
curl -sL https://github.com/stripe/stripe-cli/releases/download/v1.54.0/stripe_1.54.0_linux_x86_64.tar.gz | tar xz -C /tmp
/tmp/stripe login                                   # 浏览器授权，凭据落 ~/.config/stripe
/tmp/stripe listen --forward-to http://localhost:3000/api/v1/billing/webhook
# 它打印的 whsec_… 就是本地要填的 STRIPE_WEBHOOK_SECRET；只对这次转发有效
/tmp/stripe trigger customer.subscription.deleted
```

`stripe listen` 的 secret 是会话级的，把它写进生产 `.env` 会让生产全部 400。

时钟是硬前提：签名容差 300s，生产机 2026-10-17 实测 NTP 同步正常（`timedatectl` → `System clock
synchronized: yes`）。虚拟机漂移超过 5 分钟时所有事件 400，日志里只会说 "Invalid signature"。

## 5. 已修的 API 版本兼容（2026-10-17）

`packages/services/src/stripe.service.ts` 新增并导出 `subscriptionPeriodEnd` /
`invoiceSubscriptionId` / `invoicePeriodEnd`，同时读 Basil 前后两种形状；`webhook` 路由改用它。
旧代码只读老字段的后果不是"少更新一个字段"，而是：

- 续费后 `current_period_end` 不再前移 → 付了钱的人到期被降级；
- `invoice.payment_failed` 归因失败 → `recordAttributionFailure` → 500 → Stripe 无限重投，
  而账号永远进不了 `PAST_DUE`。

测试：`packages/services/test/stripe-payload-shapes.test.ts`（11 例，两种形状 + 缺字段 → null）。

## 6. 剩下的手工步骤

- [ ] test 账号：Secret key + endpoint + `whsec_…` 写入本地 `.env`
- [ ] test 模式走一单 → `webhook_events` 有记录 → 退款一笔看 `stripe_purchases.refunded`
- [ ] live 账号：同上（需先完成账号激活与收款信息），`sk_live_…` / 第二个 `whsec_…`
- [ ] 生产 `.env` 换成真值 → `up -d --no-deps web` → 再跑 §4 探活与真单
