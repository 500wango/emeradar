# Docker VPS 部署

EmeRadar 在 VPS 上运行两个部署单元：`web` 是常驻的 Next.js 服务，`worker` 是按计划执行一次的采集与评分任务。PostgreSQL 复用 VPS 上已有的 Docker 实例，通过现有 Docker 网络连接；EmeRadar 使用独立数据库和账号。本配置不创建 PostgreSQL、不管理其数据卷，也不对外映射数据库端口。

## 现有 PostgreSQL 准备

当前确认的容器与网络：`citeaura-postgres-1` → `citeaura_citeaura`；`arcmux-pg` → `arcmux_arcmux-net`。以下使用前者，后者无需修改。

在 VPS 上进入数据库管理终端（读取容器配置的管理员用户名，不输出密码）：

```bash
docker exec -it citeaura-postgres-1 sh -c 'exec psql -U "${POSTGRES_USER:-postgres}" -d postgres'
```

使用现有配置的管理员身份；若初始化后改过管理员用户名，应手动替换 `-U` 参数。先用 `\du` 和 `\l` 检查是否已有同名账号/数据库。仅在不存在时执行：

```sql
CREATE ROLE emeradar_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password emeradar_app
CREATE DATABASE emeradar OWNER emeradar_app;
REVOKE CONNECT, TEMPORARY ON DATABASE emeradar FROM PUBLIC;
\q
```

`\password` 交互式设置独立密码，不把密码写入 SQL 命令历史。应用账号不是超级用户；其他应用若使用超级用户仍能管理这个数据库，独立账号不等于实例级隔离。

## 首次部署

```bash
git clone https://github.com/500wango/emeradar.git /opt/emeradar
cd /opt/emeradar
cp .env.example .env
# 仅首次创建 .env；已有配置不要覆盖
```

在服务器 `.env` 中设置下面两项，并配置独立认证密钥、正式域名及所需采集服务密钥。不要将 `.env` 提交到 Git：

```dotenv
POSTGRES_NETWORK=citeaura_citeaura
DATABASE_URL=postgresql://emeradar_app:<URL编码后的密码>@citeaura-postgres-1:5432/emeradar
```

这里的 `5432` 是 PostgreSQL 容器监听端口，`localhost` 指应用容器自身。密码中的特殊字符需要 URL 编码。三个应用服务都加入 `database` 外部网络，同时保留默认网络用于外网访问。数据库网络必须已存在；不要用其他应用的 `docker compose down` 删除它。若将来重建或改名数据库网络，需要同步配置并重建 EmeRadar 容器。

完成配置后：

```bash
docker compose -f docker-compose.prod.yml --profile jobs --profile migrate config --quiet
docker compose -f docker-compose.prod.yml --profile jobs --profile migrate build
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d --no-build web
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 web
```

迁移成功验证数据库连接及 DDL 权限；`/login` 检查只验证网页服务，随后应注册/登录一次验证应用读写。若宿主机 3000 端口已被其他应用占用，需同时调整 Compose 端口映射、反向代理和工作流健康检查地址。

## 每日 worker

worker 是一次性命令，不应配置为常驻重启服务。使用宿主机 cron：

```cron
30 3 * * * cd /opt/emeradar && docker compose -f docker-compose.prod.yml --profile jobs run --rm worker >> /var/log/emeradar-worker.log 2>&1
```

## GitHub Actions secrets

在仓库 Settings -> Secrets and variables -> Actions 中配置：

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT`（可选，默认 22）
- `VPS_DEPLOY_PATH`（例如 `/opt/emeradar`）

仅推送 `master` 会触发自动部署。工作流通过 SSH 拉取最新代码，先构建 web/worker/migrate，再执行数据库迁移并更新 web，最后重试请求 `/login` 检查启动情况。worker 镜像随部署更新，任务仍由 VPS cron 独立触发。部署串行执行，不清理其他应用的 Docker 镜像。

首次启用自动部署前应完成部署目录、数据库和 `.env` 准备，并确认 SSH 用户有 Docker 权限、VPS 可以拉取 Git 仓库。工作流会重置受 Git 管理的文件；Compose/Dockerfile 修改必须提交到仓库，服务器私有配置只放 `.env`。
