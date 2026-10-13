# 新 VPS：Docker 独立部署

本方案取代旧 VPS 共享数据库方案。Compose 包含常驻的 web、PostgreSQL 16 与 worker（队列消费者），以及一次性的 migrate，使用自己的网络和数据库数据卷。

## 前置条件

- 新 VPS 已安装 Git、Docker Engine、Docker Compose 插件（支持 `up --wait`）。
- 部署目录为 `/opt/emeradar`，SSH 部署用户能执行 Docker 并拉取仓库。
- 域名为 `emeradar.com`，需要将 `@` 和 `www` 的 A/AAAA 记录指向新 VPS。Compose 内置 Caddy 自动申请和续期 HTTPS 证书，生产登录使用 Secure cookie。
- 公网只开放 80/443；PostgreSQL 不映射宿主机端口，web 只绑定 `127.0.0.1:3000`。镜像构建的资源占用不受运行时容器内存限额约束。
- 当前 VPS 为 4 核 / 7.9GB RAM / 96GB 磁盘（2026-10-11 迁移后的机器；此前那台 1 核 / 1.6GB 已停机）。Compose 已将 PostgreSQL/web/worker/Caddy 的运行时配额收紧，部署构建串行执行以降低 OOM 风险。worker 自本轮起是**常驻消费者**，与 web 同时运行（见下节）。

## 首次配置

```bash
git clone https://github.com/500wango/emeradar.git /opt/emeradar
cd /opt/emeradar
umask 077
test -f .env || cp .env.example .env
chmod 600 .env

# 分别生成数据库管理员密码、应用数据库密码、独立认证密钥
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32

nano .env
```

三次输出分别填入对应变量；不要分享或提交这些输出。DNS 先将 `emeradar.com` 和 `www.emeradar.com` 的 A/AAAA 记录指向新 VPS，证书申请前必须能从公网访问 80/443：

```dotenv
POSTGRES_PASSWORD=<第一次生成的值>
EMERADAR_DB_PASSWORD=<第二次生成的值>
NEXTAUTH_SECRET=<第三次生成的值>
NEXTAUTH_URL=https://emeradar.com
NEXT_PUBLIC_SITE_URL=https://emeradar.com
```

应用数据库密码使用十六进制，保证可直接用于连接 URL。Compose 自动生成应用 `DATABASE_URL`：主机名 `postgres`、数据库 `emeradar`、账号 `emeradar_app`。`.env` 的本地开发 `DATABASE_URL` 不会覆盖它，不再需要 `POSTGRES_NETWORK`。

按需填写采集、LLM、通知服务密钥。管理员密码仅传给 PostgreSQL 容器，应用服务使用显式配置列表，不接收管理员密码。

邮件通道（注册验证、找回密码、后台任务失败告警、备份告警）见 `.env.example`：优先 `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` + `MAIL_FROM`（自建邮件服务器或任何 SMTP 服务商），否则 `RESEND_API_KEY` + `MAIL_FROM`。`MAIL_FROM` 必须属于已配置 SPF/DKIM 的域，否则收件方会按 SPF/DMARC 判失败。未配置时发送只返回 `false` 并写日志，接口不会伪造“已送达”——所以部署后要用一次真实注册验证邮件确实到达收件箱（不只是“接口返回 200”）。

## 首次启动

逐条执行，失败时先排查：

```bash
docker compose -f docker-compose.prod.yml --profile migrate config --quiet
docker compose -f docker-compose.prod.yml --profile migrate build
docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 120 postgres
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d --no-build worker web caddy
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 web
curl --fail --retry 12 --retry-delay 5 --retry-connrefused https://emeradar.com/login
```

空数据卷首次启动时，`docker/init-db.sql` 创建独立数据库和非超级用户账号。健康检查使用 TCP，避开初始化期间仅监听 Unix socket 的临时数据库进程；部署等待 PostgreSQL 就绪后才迁移。

迁移验证连接及 DDL 权限；域名请求验证 Caddy、HTTPS 和网页服务。随后还需注册/登录一次验证应用读写。若 DNS 尚未生效，可临时请求 `http://127.0.0.1:3000/login` 验证 web。

## 持久化与备份

数据保存在 `postgres_data` 命名卷，默认项目名下为 `emeradar_postgres_data`。更新镜像、重启或重建容器不会重新初始化已有卷。保持项目名/部署目录一致。

- 不要执行 `docker compose down -v` 或删除数据卷。
- 初始化 SQL 只对空目录执行；修改 `.env` 不会修改已有数据库密码，轮换需先修改数据库账号再同步环境配置。
- 保持 PostgreSQL 主版本 16；升级主版本需要单独备份及迁移，不要直接替换镜像主版本。
- 当前生产机为 4 vCPU / 8GB。构建仍会占满 CPU，cron 执行 worker 前应确保没有手工构建正在进行。
- 初始化失败先查看日志，不要删除已有数据卷试错。

临时手工导出一份 dump：

```bash
umask 077
mkdir -p /opt/emeradar-backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d emeradar -Fc \
  > "/opt/emeradar-backups/emeradar-$(date +%F-%H%M%S).dump"
```

**这只是一次性导出，不是备份**：它留在同一台机器上，应对不了 VPS 丢失，也不会在失败时告警。异地在 R2 的每日自动备份、保留策略与恢复演练见 `25-BACKUP-AND-RESTORE.md`。

## 每日备份

`scripts/backup-to-r2.sh` 每天把数据库与 `.env` 打成加密归档上传到 Cloudflare R2。配置步骤、保留策略与恢复演练见 `25-BACKUP-AND-RESTORE.md`。

```cron
30 2 * * * cd /opt/emeradar && ./scripts/backup-to-r2.sh >> /var/log/emeradar-backup.log 2>&1
```

## 每日 worker

worker 自本轮起是**常驻消费者**（ADR-003）：排期、重试与死信策略都在 `apps/worker/src/tasks.ts` 里，随代码一起评审、一起部署。宿主机 crontab 里**不再有** worker 条目；唯一保留的 cron 是上面那条备份。

```bash
docker compose -f docker-compose.prod.yml up -d worker          # 启动/更新常驻调度器
docker compose -f docker-compose.prod.yml logs -f --tail=200 worker
docker compose -f docker-compose.prod.yml ps worker             # healthcheck 状态
```

排期（UTC，与常量同源，改动见 `tasks.ts`）：

| 任务 | cron | 说明 |
|---|---|---|
| `run-daily` | `30 3 * * *` | 采集 → 观测 → 裁决 → 账本 → 告警（S6 单写入者） |
| `discover` | `45 3 * * *` | 采集源信号 |
| `generate-intents` | `0 4 * * *` | 生成意图假设 |
| `validate-intents` | `15 4 * * *` | LLM 验证意图假设（花预算） |
| `generate-experiments` | `30 4 * * *` | 生成早期实验卡片 |
| `sync-gsc` | `0 5 * * *` | 拉取 Search Console 指标 |
| `evaluate-episodes` | `0 6 * * *` | 结算到期预测（`run-daily` 的兜底） |
| `sweep-subscriptions` | `15 6 * * *` | 取消超宽限期的 PAST_DUE 订阅 |
| `verify-ledger` | `0 7 * * *` | 验证最新账本检查点（失败即 P0，不重试） |

需要手工跑一次某个任务时，显式给命令（默认 CMD 是 `start`，不是某个任务）：

```bash
docker compose -f docker-compose.prod.yml run --rm worker verify-ledger
docker compose -f docker-compose.prod.yml run --rm worker sweep-subscriptions 14
```

任务连续失败会写 `audit_log`（`job.failed` / `job.alerted` / `job.dead_lettered`）并在达到阈值时发告警邮件（收件人取 `OPS_ALERT_EMAIL`，未配置时取库里在职的 `ADMIN`）。查询：

```sql
SELECT action, target_id, occurred_at FROM audit_log
 WHERE action LIKE 'job.%' ORDER BY occurred_at DESC LIMIT 50;
SELECT name, state, COUNT(*) FROM pgboss.job GROUP BY 1, 2;
```

> worker 每次启动先 `createQueue`，再用 `updateQueue` 对齐已有队列的重试、超时、死信和通知参数。已有 job 保留创建时的参数；不可变的 policy/partition 不符会阻止启动，需停机排空后显式迁移，不能直接改表或删掉积压任务。
>
> Compose `stop_grace_period: 150s` 给 pg-boss 的 120 秒 graceful drain 留出连接关闭余量；不是承诺一小时任务一定完成。超时、进程崩溃后的任务可能重试，业务仍须幂等。

## GitHub 自动部署

在 Settings → Secrets and variables → Actions 中配置**新 VPS**的信息：

- `VPS_HOST`：新 VPS IP 或 SSH 主机名。
- `VPS_USER`：SSH 部署用户。
- `VPS_SSH_KEY`：已获新 VPS 授权的 SSH 私钥。
- `VPS_PORT`：可选，默认 22。
- `VPS_DEPLOY_PATH`：`/opt/emeradar`。

不要沿用旧 VPS 的目标信息。先完成仓库克隆、生产 `.env` 和 SSH / Docker 权限配置。

仅推送 `master` 自动部署：串行拉取代码 → 构建全部应用镜像 → 启动并等待 PostgreSQL 健康 → 迁移 → 更新 worker（常驻调度器）→ 更新 web/Caddy → 重试 HTTPS 登录页检查。任务由 worker 内部的队列排期触发，不再依赖宿主机 cron。保留数据卷，不做全局镜像清理。

工作流会重置受 Git 管理的文件；Compose/Dockerfile 修改要提交，私有配置只放服务器 `.env`。查看 Actions 结果确认部署，push 成功不等于上线。

部署依赖**公钥**登录。生产已关闭密码登录与端口转发（见下节），`appleboy/ssh-action` 走密钥，不受影响。

## 主机加固

新 VPS 建好后必须补上这一层，当前生产状态与验证证据见 `26-SECURITY-AUDIT.md`。三条要点：

1. **SSH**：`PermitRootLogin prohibit-password` + `PasswordAuthentication no`。注意 sshd 对同名关键字**取第一个值**、`sshd_config.d/*.conf` 按文件名字典序展开，所以要改的不只是新增的 `99-hardening.conf`，还包括排在它前面的 `50-cloud-init.conf`，并加 `/etc/cloud/cloud.cfg.d/` 覆盖防止 cloud-init 在后续启动时写回。
2. **主机防火墙**：`INPUT` 默认 drop，且源站 80/443 **只放行 Cloudflare 官方网段**，否则直连源站 IP 可绕过 CDN。Docker 发布的端口经 DNAT 走 `FORWARD`、不经过 `INPUT`，必须同时写 `DOCKER-USER` 链，且每条规则用 `-i eth0` 限定，避免误伤容器出网。放行 sing-box 的全部入站端口。
3. **fail2ban**：`backend = polling`（默认 systemd 后端的 journalmatch 与本机 `ssh.service` 单元名对不上，会静默失效）、`mode = normal`。

**一体机拓扑特有的一条**：客户端流量经本机 sing-box 出网，因此连本机公网 IP 时源 IP 就是它自己。fail2ban 的 `ignoreip` **必须**包含本机公网地址，否则会把运维方自己封在门外。详见 `26-SECURITY-AUDIT.md` §6。
