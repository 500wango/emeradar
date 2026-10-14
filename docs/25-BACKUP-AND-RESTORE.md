# 备份与恢复

回答的问题：生产数据多久备份一次、备份放在哪、怎么确认备份可用、真出事时怎么恢复。

主要读者：运维。

## 1. 目标与边界

要防的是三类事故，代价依次升高：

| 事故 | 备份能否应对 | 说明 |
|---|---|---|
| 误删数据、迁移写坏、schema 变更出错 | 能 | 用最近一次备份恢复 |
| VPS 磁盘/宿主机损坏 | 能 | 备份在 Cloudflare R2，不在同一台机器 |
| 备份脚本一直失败但没人发现 | **不能** | 所以脚本每次失败都会告警并写日志 |

同机备份不能应对 VPS 丢失，所以 `pg_dump` 落在本机只是过程产物，真正的备份目标是异地的 Cloudflare R2。

**备份包含什么。**`scripts/backup-to-r2.sh` 每次产出一个加密归档，内含三样东西：

- `db.dump`：`pg_dump -Fc`（`pg_restore` 格式），业务数据全量。
- `app.env`：部署目录的 `.env`。**没有它，光有 dump 也起不来**——数据库密码、JWT 密钥、各类 API key 都在里面。
- `MANIFEST.txt`：时间戳、git SHA、PostgreSQL 版本、表数量、各文件大小与 sha256。

因为带了 `.env`，归档在客户端先做对称加密（GPG，AES256）再上传，口令只存在于服务器和你的密码管理器里，R2 上存的是不可读的密文。

## 2. 一次性配置

### 2.1 建 R2 桶与令牌

1. Cloudflare 控制台 → R2 → 建桶，例如 `emeradar-backups`。位置选默认（服务器在美国，不需要 EU 辖区）。
2. R2 → Manage API Tokens → 建一个 token，权限给 **Object Read & Write**，范围限定到这**一个桶**。
3. 记下 Account ID、Access Key ID、Secret Access Key。

**创建结果页上会出现三个值，只有两个是 S3 凭据**，这一步很容易拿错：

| 页面上的字段 | 填到哪 | 形态 |
|---|---|---|
| Access Key ID | `R2_ACCESS_KEY_ID` | 32 位十六进制 |
| Secret Access Key | `R2_SECRET_ACCESS_KEY` | 64 位，**只显示这一次** |
| Token value | **不用** | `cfat_` 开头，那是给 Cloudflare REST API 的 |

把 `cfat_…` 填进 `R2_ACCESS_KEY_ID` 的话，R2 只回一个 `400 BadRequest`，看着像桶名或权限问题，实际是凭据类型不对（想确证可以手工跑一次 `rclone lsd`，它会直说 `Credential access key has length 53, should be 32`）。脚本现在会前置拦下这一种，直接告诉你是拿错了值。

注意：**R2 的 token 没有"只写"这个选项**，它能读也能删。所以它是一把有实权的钥匙，不要进 git，泄露了就轮换。

### 2.2 配置加密口令

```bash
openssl rand -base64 32
```

存进密码管理器。**这是唯一一份**：口令丢了，R2 上的归档就等于一堆随机字节，没有任何后门。

### 2.3 在服务器上落配置

```bash
cp .backup.env.example /opt/emeradar/.backup.env
chmod 600 /opt/emeradar/.backup.env     # 保持 root 独占
vi /opt/emeradar/.backup.env            # 填 R2_* 与 BACKUP_GPG_PASSPHRASE
```

`.backup.env` 与 `.env` 分开是刻意的：`.env` 给容器用，备份脚本不读它，避免存储凭据混进应用进程。

### 2.4 手工跑一次再挂 cron

```bash
cd /opt/emeradar && ./scripts/backup-to-r2.sh
```

配置文件不存在时脚本只打一行日志并退出 0（不会往 cron 里灌错误），配置存在但字段缺失时才会报错退出。**先看到一次 `OK` 再挂 cron。**

确认通过后加入 crontab：

```cron
30 2 * * * cd /opt/emeradar && ./scripts/backup-to-r2.sh >> /var/log/emeradar-backup.log 2>&1
```

时间选在 worker 任务（03:30 起）之前，这样当天备份的是管线改动之前的状态。

### 2.5 日志轮转

```bash
cat > /etc/logrotate.d/emeradar-backup <<'EOF'
/var/log/emeradar-backup.log {
  su root syslog
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF
```

`su root syslog` 不是可选项。Ubuntu 的 `/var/log` 是 `root:syslog` 且组可写，logrotate 会把"父目录组可写但没声明用哪个身份轮转"当成不安全配置**直接跳过**——看着装好了，其实永远不轮转，日志会一直涨。验证方式是干跑一次：

```bash
logrotate -d /etc/logrotate.d/emeradar-backup 2>&1 | grep -iE "error|considering"
```

没看到 `error:` 才算成。

## 3. 保留与防篡改

两处保留策略，各管一段：

- **R2 侧**：给桶加生命周期规则（Bucket → Settings → Object lifecycle rules），例如 `daily/` 前缀保留 90 天后删除。规则在 24 小时内生效。
- **本机侧**：`LOCAL_KEEP_DAYS`（默认 7 天）控制 `/opt/emeradar-backups` 下的加密包。本机这份是为了快速回滚，不是备份，可以短。

**建议开启桶锁（Bucket lock）**：设成 prevent-delete + prevent-overwrite，前缀限定 `daily/`。这样即使凭据泄露，攻击者也无法删掉历史备份或覆盖成自己的内容——这条是勒索软件场景下唯一真正有用的防线。开了锁之后**覆盖写会失败**，所以脚本是按日期命名、已存在就跳过；`--force` 也只会另起一个带时间戳的新对象，从不覆盖。

桶锁一旦开启无法绕过（这正是它的意义），删除旧对象只能等生命周期规则。

## 4. 恢复演练

**没演练过的备份不算备份。**下面这套流程在测试机上跑一遍，确认整条链路可用。

### 4.1 取回并解密

```bash
# 服务器上
cp /opt/emeradar-backups/emeradar-2026-10-11.tar.zst.gpg /tmp/
printf '%s' '<口令>' | gpg --batch --pinentry-mode loopback --passphrase-fd 0 \
  --output /tmp/restore.tar.zst --decrypt /tmp/emeradar-2026-10-11.tar.zst.gpg
mkdir -p /tmp/restore && tar --zstd -xf /tmp/restore.tar.zst -C /tmp/restore
cat /tmp/restore/MANIFEST.txt
sha256sum /tmp/restore/db.dump      # 与 MANIFEST 里的 db.dump_sha256 比对
```

校验和不一致就不要往下走，换一份备份。

### 4.2 恢复到一个临时数据库

**不要直接往生产库恢复。**先起一个独立的 postgres 容器：

```bash
docker run -d --name restore-drill -e POSTGRES_PASSWORD=drill postgres:16-alpine
sleep 8
docker cp /tmp/restore/db.dump restore-drill:/tmp/db.dump
docker exec -i restore-drill psql -U postgres -c 'CREATE DATABASE emeradar'

# dump 里带着 `ALTER FUNCTION ... OWNER TO emeradar_app` 这类语句，角色不存在时
# pg_restore 会在第一个就中止。演练容器是空的，必须先把这个角色建出来。
docker exec -i restore-drill psql -U postgres -c \
  "CREATE ROLE emeradar_app LOGIN PASSWORD 'drill'"

docker exec -i restore-drill pg_restore -U postgres -d emeradar \
  --single-transaction --exit-on-error /tmp/db.dump
```

`--exit-on-error` 很重要：它保证要么整库恢复成功，要么明确失败，不会留下一个"看起来恢复了但少了一半表"的库。

生产环境里 `emeradar_app` 由 `docker/init-db.sql` 在初始化空数据卷时创建，所以正式恢复不会遇到这一步；只有演练用的空容器需要手工补。

### 4.3 核对

```bash
docker exec -i restore-drill psql -U postgres -d emeradar -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
```

与 `MANIFEST.txt` 里的 `tables` 对比，再抽查几张关键表的行数：

```bash
docker exec -i restore-drill psql -U postgres -d emeradar -tAc \
  "SELECT 'opportunities', count(*) FROM opportunities
   UNION ALL SELECT 'verdicts', count(*) FROM verdicts
   UNION ALL SELECT 'users', count(*) FROM users
   UNION ALL SELECT 'opportunity_slots', count(*) FROM opportunity_slots
   UNION ALL SELECT 'slot_claims', count(*) FROM slot_claims
   UNION ALL SELECT 'stealth_locks', count(*) FROM stealth_locks"
```

对得上就 `docker rm -f restore-drill` 收尾。

> **PRD v2.1 新增的表不需要改备份脚本。** 归档走的是整库 `pg_dump -Fc`，因此 `opportunity_slots`、`slot_claims`、`stealth_locks`、`stealth_lock_displays`、`launch_kits`、`project_credentials`、`project_serp_rankings`、`usage_carryovers`、`email_identities`、`disposable_email_domains`、`device_fingerprints`、`lifetime_scan_grants`（03 §2/§8/§12/§13/§15）都会自动进入 `db.dump`，`MANIFEST.txt` 的表数量也会随之变化。上面抽查里加的三张是**有状态、丢了无法重算**的（槽位占用、认领历史、买断窗口）：账本能从快照重算，这三张不能，所以恢复演练必须核对它们。若某次演练里这三张表存在但为空，先确认是"当时确实没有认领"，而不是恢复到了一份早于业务开始的归档。

### 4.4 真出事时的生产恢复

演练流程之外，只有两点不同：

1. 先 `docker compose -f docker-compose.prod.yml stop web worker` 停掉写入方，避免恢复过程中有新写入。
2. 用 `app.env` 还原 `/opt/emeradar/.env`——**先还原它**，因为它决定了容器连的是哪个库、用什么密码。

数据库本身建议恢复到**新建的空库**而不是覆盖现有库，确认无误后再切换 `.env` 里的库名。

## 5. 脚本行为速查

| 情形 | 行为 |
|---|---|
| `.backup.env` 不存在 | 打一行日志，退出 0（未配置，不污染 cron） |
| `.backup.env` 存在但缺字段 | 报错退出 1 并告警 |
| 当天对象已存在 | 跳过上传，退出 0 |
| `--force` | 另起一个带时间戳的对象，不覆盖 |
| R2 不可达 | 快速失败（单次尝试、短超时），不长时间挂起 |
| 上传后字节数对不上 | 报错退出 1 并告警 |
| 任一环节失败 | 若配了 SMTP 或 Resend 则邮件告警 |
| 成功 | 默认静默；`BACKUP_ALERT_ON_SUCCESS=1` 时才发信 |

退出码与 `/var/log/emeradar-backup.log` 记录每次运行结果。

成功默认静默是刻意的：每天一封"一切正常"的邮件，效果是让你开始忽略它，包括真正报错的那封。要覆盖"cron 压根没跑"这种情况，看日志时间戳比看收件箱更可靠。

## 6. 与其他文档的关系

- 部署流程见 `21-DOCKER-VPS-DEPLOYMENT.md`。
- 安全与凭据管理见 `17-SECURITY-PRIVACY-OPS.md`。
- 数据库结构见 `03-DATA-MODEL.md`。
