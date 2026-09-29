# 新 VPS：Docker 独立部署

本方案取代旧 VPS 共享数据库方案。Compose 包含常驻的 web、PostgreSQL 16，以及一次性的 worker / migrate，使用自己的网络和数据库数据卷。

## 前置条件

- 新 VPS 已安装 Git、Docker Engine、Docker Compose 插件（支持 `up --wait`）。
- 部署目录为 `/opt/emeradar`，SSH 部署用户能执行 Docker 并拉取仓库。
- 正式访问需要域名和 HTTPS 反向代理，转发到本机 3000 端口；生产登录使用 Secure cookie。反向代理/证书根据新 VPS 环境另行配置，不包含在当前 Compose 中。
- PostgreSQL 不映射宿主机端口。限制公网端口，只允许反向代理或受控调试访问 3000。镜像构建的资源占用不受运行时容器内存限额约束。

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

三次输出分别填入对应变量；不要分享或提交这些输出：

```dotenv
POSTGRES_PASSWORD=<第一次生成的值>
EMERADAR_DB_PASSWORD=<第二次生成的值>
NEXTAUTH_SECRET=<第三次生成的值>
NEXTAUTH_URL=https://你的域名
NEXT_PUBLIC_SITE_URL=https://你的域名
```

应用数据库密码使用十六进制，保证可直接用于连接 URL。Compose 自动生成应用 `DATABASE_URL`：主机名 `postgres`、数据库 `emeradar`、账号 `emeradar_app`。`.env` 的本地开发 `DATABASE_URL` 不会覆盖它，不再需要 `POSTGRES_NETWORK`。

按需填写采集、LLM、通知服务密钥。管理员密码仅传给 PostgreSQL 容器，应用服务使用显式配置列表，不接收管理员密码。

## 首次启动

逐条执行，失败时先排查：

```bash
docker compose -f docker-compose.prod.yml --profile jobs --profile migrate config --quiet
docker compose -f docker-compose.prod.yml --profile jobs --profile migrate build
docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 120 postgres
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d --no-build web
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 web
curl --fail --retry 12 --retry-delay 5 --retry-connrefused http://127.0.0.1:3000/login
```

空数据卷首次启动时，`docker/init-db.sql` 创建独立数据库和非超级用户账号。健康检查使用 TCP，避开初始化期间仅监听 Unix socket 的临时数据库进程；部署等待 PostgreSQL 就绪后才迁移。

迁移验证连接及 DDL 权限；登录页检查只验证网页服务。配置 HTTPS 后还需注册/登录一次验证应用读写。

## 持久化与备份

数据保存在 `postgres_data` 命名卷，默认项目名下为 `emeradar_postgres_data`。更新镜像、重启或重建容器不会重新初始化已有卷。保持项目名/部署目录一致。

- 不要执行 `docker compose down -v` 或删除数据卷。
- 初始化 SQL 只对空目录执行；修改 `.env` 不会修改已有数据库密码，轮换需先修改数据库账号再同步环境配置。
- 保持 PostgreSQL 主版本 16；升级主版本需要单独备份及迁移，不要直接替换镜像主版本。
- 初始化失败先查看日志，不要删除已有数据卷试错。

在部署目录备份：

```bash
umask 077
mkdir -p /opt/emeradar-backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d emeradar -Fc \
  > "/opt/emeradar-backups/emeradar-$(date +%F-%H%M%S).dump"
```

备份包含业务数据，应另存到受控的异地存储；同机备份不能应对 VPS 丢失。

## 每日 worker

worker 是一次性任务，由宿主机 cron 调度，不配置常驻重启。时间按宿主机时区执行；日志接入宿主机日志轮转：

```cron
30 3 * * * cd /opt/emeradar && docker compose -f docker-compose.prod.yml --profile jobs run --rm worker >> /var/log/emeradar-worker.log 2>&1
```

## GitHub 自动部署

在 Settings → Secrets and variables → Actions 中配置**新 VPS**的信息：

- `VPS_HOST`：新 VPS IP 或 SSH 主机名。
- `VPS_USER`：SSH 部署用户。
- `VPS_SSH_KEY`：已获新 VPS 授权的 SSH 私钥。
- `VPS_PORT`：可选，默认 22。
- `VPS_DEPLOY_PATH`：`/opt/emeradar`。

不要沿用旧 VPS 的目标信息。先完成仓库克隆、生产 `.env` 和 SSH / Docker 权限配置。

仅推送 `master` 自动部署：串行拉取代码 → 构建全部应用镜像 → 启动并等待 PostgreSQL 健康 → 迁移 → 更新 web → 重试登录页检查。worker 镜像同步更新，任务由 cron 触发。保留数据卷，不做全局镜像清理。

工作流会重置受 Git 管理的文件；Compose/Dockerfile 修改要提交，私有配置只放服务器 `.env`。查看 Actions 结果确认部署，push 成功不等于上线。
