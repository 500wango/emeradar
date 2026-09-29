# Docker VPS 部署

EmeRadar 在 VPS 上运行两个部署单元：`web` 是常驻的 Next.js 服务，`worker` 是按计划执行一次的采集与评分任务。PostgreSQL 可以继续复用 VPS 上已有的 Docker 实例，`.env` 中的 `DATABASE_URL` 应使用宿主机可访问的地址（例如 `host.docker.internal` 配合宿主机映射端口）。

## 首次部署

```bash
git clone https://github.com/500wango/emeradar.git /opt/emeradar
cd /opt/emeradar
cp .env.example .env
# 编辑 .env，填写数据库、认证和采集服务配置
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d --build web
```

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

之后推送 `master` 会自动 SSH 到 VPS，拉取最新代码、执行数据库迁移、重建并启动 `web`，最后请求 `/login` 做健康检查。worker 仍由 VPS cron 独立触发。
