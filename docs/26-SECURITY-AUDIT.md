# 26 — 生产主机安全审计与加固

Status: Applied ｜ 执行日期：2026-10-12 ｜ 主机：`vmi3656019` / `85.239.236.245`

回答的问题：这台机器对外开放了什么、当时有什么问题、改了什么、怎么验证、还剩什么没解决。

主要读者：运维。

本文只管**主机层**（SSH、防火墙、内核、暴露端口）。应用层安全设计见 `17-SECURITY-PRIVACY-OPS.md`；这台机器的部署与拓扑见 `21-DOCKER-VPS-DEPLOYMENT.md`；备份见 `25-BACKUP-AND-RESTORE.md`。

## 1. 扫描方法：观察点选在哪

**观察点必须是真正的第三方，而这台笔记本不是。** 本机流量经生产 VPS 的 sing-box 出网，所以从本机发出的任何探测，在源站看来都来自 `85.239.236.245` —— 用自己的机器扫自己的机器，得到的结论是自指的。

因此外部视角一律取旧 VPS `69.164.253.108`（Linode，不在 Cloudflare 网段内），本机只用来验证真实访问路径是否正常。

这个拓扑后面还咬了我们一口，见 §6。

## 2. 结论速览

| # | 问题 | 严重度 | 处置 |
|---|---|---|---|
| 1 | SSH 允许 root 密码登录；日志里 7.5 小时内 699 次密码爆破；无 fail2ban | 高 | **已修复** §3.1 §3.3 |
| 2 | 无主机防火墙，`INPUT` 策略为 `ACCEPT`，全网可达所有本机端口 | 高 | **已修复** §3.2 |
| 3 | 源站 IP 可绕过 Cloudflare 直连并返回 `200`，CDN 的 WAF/限流可被完全绕过 | 高 | **已修复** §3.2 |
| 4 | 内核补丁已装但长期未重启生效 | 中 | **已修复** §3.4 |
| 5 | 缺少 `Content-Security-Policy`；`referrer-policy` 等四个响应头重复下发 | 中 | **未处理** §5.1 |
| 6 | sing-box 以 root 运行、入站端口对全网开放 | 中 | **接受** §4.1 |
| 7 | 未做应用层渗透、恶意软件扫描、文件完整性基线 | — | **未做** §5.2 |

扫描时 `auth.log` 覆盖 2026-10-11 18:52（迁入时刻）起约 7.5 小时：`Failed password` 699 次、`Invalid user` 289 次、来源 IP 32 个。也就是说**迁入当天平均每小时就有约 93 次密码爆破**，而这台机器当时没有任何针对性的防护。

## 3. 已修复项

### 3.1 SSH 加固

**问题。** `PermitRootLogin` 默认允许密码，且 `50-cloud-init.conf` 写着 `PasswordAuthentication yes`。

这里有个容易踩空的点：sshd 对**重复出现的同名关键字取第一个值**，而 `sshd_config.d/*.conf` 按文件名字典序展开。所以 `50-cloud-init.conf` 排在 `99-hardening.conf` 前面，**只加 99 那个文件是没用的** —— 必须同时改掉 50。cloud-init 还可能在下一次启动时按实例元数据把它写回 `yes`，所以另加了 `/etc/cloud/cloud.cfg.d/99-emeradar-ssh.cfg`（`ssh_pwauth: false`）从源头钉住。

`/etc/ssh/sshd_config.d/99-hardening.conf`：

```
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no
AllowTcpForwarding no
```

`AllowTcpForwarding no` 是按使用方明确要求关闭的。**代价**：`ssh -L/-D` 隧道、以及 VS Code Remote-SSH 这类依赖端口转发的工具会失效。若需要用，把该行改成 `yes` 后 `systemctl reload ssh` 即可，其余加固不受影响。

**验证**（不是"配置写对了"，是行为对了）：

- 公钥登录仍可用（部署流水线依赖它）。
- 密码登录：`ssh -o PreferredAuthentications=password` → `Permission denied (publickey)`，服务端只提供 publickey。
- 端口转发：穿透隧道实测被拒，服务端 `auth.log` 记录 `refused local port forward: originator 127.0.0.1 port 36452, target 127.0.0.1 port 3000`。

注意一个测法陷阱：`ssh -f -N -L` 返回 0 且本地端口在监听，**不代表服务端放行** —— 本地端口在连接建立时就会绑定，服务端要等到真有人连进来才拒绝。必须实际穿透隧道才算验证过。

### 3.2 主机防火墙：同时管住两条路径

**问题。** `INPUT` 策略是 `ACCEPT`，本机所有监听端口对全网开放；同时 `https://emeradar.com` 解析到 Cloudflare（`172.67.196.85` / `104.21.44.61`，橙云已开），但直连源站 IP 也返回 `200`，等于 CDN 的防护形同虚设。

**关键点：80/443 必须同时落在两条链上。** Docker 发布的端口在 `PREROUTING` 被 DNAT 到容器，走的是 `FORWARD`，**根本不经过 `INPUT`**。只写 `INPUT` 规则会看起来生效、实则对容器流量完全无效。所以：

- `table inet emeradar` 的 `input` 链（`policy drop`）—— 管发给主机本身的流量（ssh、sing-box、docker-proxy 自己的监听套接字）。
- `DOCKER-USER` 链 —— 管被 DNAT 到容器的流量。它是 Docker 预留的扩展点，在 `FORWARD` 里最先被求值。**每条规则都用 `-i eth0` 限定**，这样容器出网（入接口是网桥）会直接落到链尾 `RETURN`，交回 Docker 自己的链，不受影响。

放行清单（漏掉 sing-box 任何一条都会直接切断使用方自己的网络）：

| 端口 | 用途 |
|---|---|
| tcp/22 | SSH |
| tcp/80,443 | 源站，**仅限 Cloudflare 官方网段** |
| tcp/2095, 43688, 15880 | sing-box 入站 |
| udp/31139, 36343 | sing-box 入站 |
| 其余 | `lo`、已建立连接、ICMP/ICMPv6、网桥内部流量 |

实现落在 `/etc/emeradar-firewall/`：

- `apply.sh` —— 幂等应用。nft 规则一次性成文加载（文件里先 `table {}` 再 `delete table`，整份作为单个事务提交，**不存在"旧规则已删、新规则未上"的空窗**）。`DOCKER-USER` 先清空再重建，所以中途失败只会退回宽松状态，不会把 Cloudflare 挡在外面。
- `cloudflare-v4.txt` / `cloudflare-v6.txt` —— 15 个 v4 段 + 7 个 v6 段。
- `refresh-cloudflare-ips.sh` —— 每月 5 日 04:23（UTC）拉取官方网段。**先校验再安装**：任何一段格式不合规、或 v4 少于 10 段 / v6 少于 3 段，就放弃本次更新并保留旧表。这条护栏是必要的 —— 一份被截断的下载如果直接生效，就等于把 Cloudflare 全部挡在门外。
- `emeradar-firewall.service` —— `After=docker.service netfilter-persistent.service`，已 `enable`，开机自动生效。

**验证**（全部从 `69.164.253.108` 发出）：

| 检查 | 结果 |
|---|---|
| 走 Cloudflare 访问 | `HTTP 200` |
| 直连源站 443 / 80 | `HTTP 000`（已挡） |
| sing-box tcp/43688、2095、15880 | 可达 |
| tcp/22 | 可达 |
| 未开放的 tcp/2019 | 不可达（对照） |
| 容器出网（web 容器 fetch 外部 API） | 正常，出口 `85.239.236.245` |
| Caddy → web 容器反代 | 正常返回页面 |

**关于 `netfilter-persistent`。** 它已启用，`stop` 只做 flush、不 save，所以重启不会把 Docker 的动态规则快照下来再回放（那是"Docker 主机重启后容器网络坏掉"的经典成因）。但 `/etc/iptables/rules.v4` 里目前是一份只含三行策略的空规则集 —— **如果以后有人手工执行 `netfilter-persistent save`，就会把当时 Docker 的全部动态链固化进去**，下一次开机回放可能出问题。没有需要持久化的 iptables 规则（Docker 管 `FORWARD`/`NAT`，自己的单元管 `INPUT` 与 `DOCKER-USER`），不要执行那次 save。

### 3.3 fail2ban

**问题。** 无任何封禁机制，爆破可以无限次尝试。

装在 SSH 加固**之后** —— 顺序不能反，否则改密码策略期间自己的连接尝试可能先把自己封掉。

两处偏离默认值，都有具体理由：

- **`backend = polling`**。发行版默认的 systemd 后端的 journalmatch 是 `_SYSTEMD_UNIT=sshd.service + _COMM=sshd`，而这台机器的单元叫 `ssh.service`。实测该匹配**一条都读不到**：同一个过滤器用 `fail2ban-regex systemd-journal` 返回 0 条命中，换成 `/var/log/auth.log` 则命中 699 条。一个盯着空流的 jail 会永远报告 `0 failed`，看起来一切正常。
- **`mode = normal`**。曾先用了 `ddos`，它会把 `Connection closed by <HOST> ... [preauth]` 也计为失败 —— 而**一次裸的 TCP 连接后立即关闭就会产生这种行**。后果在 §6 里发生了。抛开那次事故，ddos 模式在这里也不划算：一个从不完成认证的客户端本来就进不来，封它几乎没有收益，却会让任何 22 端口的健康检查最终被误封。`normal` 模式仍然会封真实的失败登录（`Invalid user`、`Failed password`），那才是值得动作的信号。

`/etc/fail2ban/jail.d/99-emeradar.local` 要点：

```
ignoreip  = 127.0.0.1/8 ::1 85.239.236.245   # 见 §6，这一条不是可选的
bantime   = 1h
findtime  = 10m
maxretry  = 5
banaction = nftables-multiport
```

`banaction` 选 `nftables-multiport` 是为了**求值顺序**：该 action 把链挂在 `priority -1`，排在 `emeradar` 输入链（`priority 0`）之前，封禁先于放行生效。若用 iptables action，规则会落在同优先级的链里，两条链谁先求值取决于表的注册顺序 —— 今天能用，重启后可能静默失效。实测挂载结果为 `type filter hook input priority filter - 1`。

**验证。** 从旧 VPS 用 6 个不存在的用户名尝试 → 该 IP 被列入 `addr-set-sshd` 并确实连不上 22 端口；`unbanip` 后恢复。

### 3.4 内核重启

`6.8.0-139` → `6.8.0-146`，2026-10-12 02:17:58 UTC 完成，停机约 1 分钟。

这次重启也是**首次验证 `restart: unless-stopped` 能自愈**：三个容器全部自动回来（web 健康检查通过），防火墙单元自动生效，fail2ban 自动启动，sing-box 自动启动，站点恢复 `200`。

## 4. 接受的残余风险

### 4.1 sing-box

按使用方要求保持原状，未做任何改动。现状：五个入站（`vless:43688`、`vmess:2095`、`hysteria2:31139/udp`、`tuic:36343/udp`、`anytls:15880`）全部 TLS 且要求认证，但**进程以 root 运行**、端口对全网开放。

这是使用方自己的代理入口，且是本次加固中所有外部视角的依赖，动它风险大于收益。防火墙已按现状完整放行这些端口。

### 4.2 源站 IP 的白名单是 IP 制而非证书制

Cloudflare 官方推荐的更强做法是 **Authenticated Origin Pulls**（源站要求客户端证书，Cloudflare 出示），它不依赖会变化的 IP 列表。IP 白名单是当前选择，`refresh-cloudflare-ips.sh` 负责跟上变化。两者可以叠加，后者需要 Cloudflare 控制台操作，未做。

## 5. 未处理项

### 5.1 响应头（应用层）

实测线上响应：

- **缺 `Content-Security-Policy`**（也没有 `permissions-policy`）。
- **四个头重复下发**：`referrer-policy`、`strict-transport-security`、`x-content-type-options`、`x-frame-options` 各出现两次 —— Next.js 与 Caddy/Cloudflare 两处都设了。

这些属于应用层改动（`apps/web` 配置与 `docker/Caddyfile`），不在本次主机加固范围内，未动。

### 5.2 没有覆盖到的

- **应用层渗透测试**：未对 `/api/v1/*` 做鉴权绕过、越权、注入测试。
- **反滥用（PRD v2.1 F14）未在本轮审计范围内**：邮箱 Canonical 归一化、一次性邮箱黑名单、OAuth 强绑定、设备指纹 30 天限流这几项是**应用层**机制，规格见 `17-SECURITY-PRIVACY-OPS.md` §2.5 与 `13-BILLING-RBAC.md` §7.1，尚未在生产实现，因此本次主机审计既没有验证也没有覆盖。落地后需要补一次专门的应用层验证：同一邮箱的 `+` 别名与点号变体必须归一到同一账户、一次性邮箱域名在注册时即被拒、设备指纹与 IP **只以加盐哈希落库**（17 §3.5 规定了注销时的删除口径，这条必须实测而不是靠代码审查）。
- **恶意软件 / rootkit 扫描**：未做。
- **文件完整性基线**（如 AIDE）：未建立。
- 无 Cloudflare 与 R2 控制台权限，账号侧设置未经检查（R2 桶锁与生命周期规则仍待配置，见 `25-BACKUP-AND-RESTORE.md` §3）。

## 6. 必须知道的拓扑陷阱：fail2ban 会封掉主机自己的 IP

**这台机器的客户端流量经它自己的 sing-box 出网。** 因此从这些客户端连它的公网 IP 时，连接是**回环**回来的，源 IP 就是 `85.239.236.245` 自己（`auth.log` 里可以直接看到：`Accepted publickey for root from 85.239.236.245`）。

后果：**fail2ban 一旦封了 `85.239.236.245`，运维方和使用方会一起被关在门外**，而且从外部看只表现为"22 端口连上就被关闭"，极难联想到是自己封了自己。

2026-10-12 实操时确实发生了：当时用 `mode = ddos`，重启后的轮询里有约 20 次 `TCP 连接后立即关闭` 的探测，每次都被计为一次失败，累计超过 `maxretry = 5` 后触发了封禁。

**当前配置下的三重防护**：`ignoreip` 显式包含 `85.239.236.245`；`mode = normal` 不再把裸连接计为失败；规则本身也已在文档里写明理由。改 fail2ban 配置时不要删掉 `ignoreip` 里那一项。

**如果再次被锁在外面**，可用的入口（按代价从低到高）：

1. 等 `bantime`（当前 1 小时）自然过期。
2. 借其他机器跳板：`ssh -J root@<跳板机> root@85.239.236.245` —— 用 `ProxyJump` 而非把私钥复制到跳板机上。本次恢复就是走这条路。
3. 供应商控制台。

IPv6 不可用：本机只有 ULA 地址、无全局 IPv6 与默认路由，源站的 IPv6 无法作为备用入口。

## 7. 运维速查

```bash
# 防火墙
systemctl status emeradar-firewall          # 单元状态
/etc/emeradar-firewall/apply.sh             # 手工重新应用（幂等）
nft list table inet emeradar                # 查看输入规则
iptables -S DOCKER-USER                     # 查看 80/443 的 Cloudflare 白名单
journalctl -k | grep emeradar-input-drop    # 查看被丢弃的包
/etc/emeradar-firewall/refresh-cloudflare-ips.sh   # 手工刷新 CF 网段

# fail2ban
fail2ban-client status sshd                 # 当前封禁列表
fail2ban-client set sshd unbanip <IP>       # 手工解封
nft list table inet f2b-table               # 封禁集合
tail -f /var/log/fail2ban.log
```

新增服务、改动监听端口时，**必须同步更新 `apply.sh` 的放行清单并重新应用**，否则该服务对新连接不可达。

加固前的原始配置备份在 `/root/pre-hardening/`（`sshd_config`、`sshd_config.d/`、`nftables.rules`、`iptables.rules`、`crontab.txt`），回滚脚本 `revert-ssh.sh` 与 `revert-fw.sh` 也在那里。

## 8. 与其他文档的关系

- 部署流程与拓扑：`21-DOCKER-VPS-DEPLOYMENT.md`
- 备份与恢复：`25-BACKUP-AND-RESTORE.md`
- 应用层安全设计：`17-SECURITY-PRIVACY-OPS.md`
