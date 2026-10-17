# Google Search Console OAuth 配置指南

重构后的 GSC OAuth 使用**统一的回调端点**，不再依赖项目 ID 路径参数。

---

## 🎯 新架构（2026-10-17 重构）

### 旧版（已废弃）
```
/api/v1/projects/[id]/gsc/callback
```
- ❌ 每个项目需要单独注册回调 URL
- ❌ Google OAuth 不支持通配符

### 新版（当前）
```
/api/v1/oauth/gsc/callback
```
- ✅ 固定端点，只需注册一次
- ✅ 项目 ID 编码在 OAuth `state` 参数中

---

## ⚙️ 配置步骤

### 1️⃣ 创建 Google Cloud 项目

1. 访问 [Google Cloud Console](https://console.cloud.google.com)
2. 创建新项目：`Emeradar Production`

---

### 2️⃣ 启用 Search Console API

1. 左侧菜单：**APIs & Services** → **Library**
2. 搜索 `Google Search Console API`
3. 点击 **Enable**

---

### 3️⃣ 配置 OAuth 同意屏幕

1. 进入 **APIs & Services** → **OAuth consent screen**
2. 选择 **User Type**: `External`
3. 填写：
   - **Application name**: `Emeradar`
   - **User support email**: 您的邮箱
   - **Developer contact**: 您的邮箱
4. **Scopes**: 点击 **Add or Remove Scopes**，搜索并添加：
   ```
   https://www.googleapis.com/auth/webmasters.readonly
   ```
5. **Test users**: 添加您的 Google 账号（可选，发布前测试用）
6. 保存并继续

---

### 4️⃣ 创建 OAuth 凭据

1. 进入 **APIs & Services** → **Credentials**
2. 点击 **Create Credentials** → **OAuth client ID**
3. 选择 **Application type**: `Web application`
4. **Name**: `Emeradar Production`
5. **Authorized redirect URIs** 添加：

   **生产环境：**
   ```
   https://emeradar.com/api/v1/oauth/gsc/callback
   ```

   **本地开发：**
   ```
   http://localhost:3000/api/v1/oauth/gsc/callback
   ```

6. 点击 **Create**
7. **复制** Client ID 和 Client Secret

---

### 5️⃣ 生成加密密钥

在终端执行：

```bash
openssl rand -hex 32
```

这会生成一个 64 位的十六进制字符串（32 字节）。

⚠️ **重要：** 这个密钥用于加密存储的 Google tokens。**一旦设置，不要更改**，否则所有用户的 GSC 连接会失效。

---

### 6️⃣ 配置环境变量

在生产服务器的 `.env` 文件中添加：

```bash
# Google Search Console OAuth
GOOGLE_CLIENT_ID="123456789-abcdefghijk.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-abcdefghijk123456789"
GSC_REDIRECT_URI="https://emeradar.com/api/v1/oauth/gsc/callback"
GSC_TOKEN_ENCRYPTION_KEY="a1b2c3d4e5f6789...（64位十六进制）"
```

---

## 🔍 OAuth 流程说明

### 授权流程

1. **用户点击「连接 GSC」**
   ```
   GET /api/v1/projects/{id}/gsc/connect
   ```

2. **后端生成 OAuth URL**
   - `state` 格式：`base64url(projectId:randomSecret)`
   - 项目 ID 编码在 state 中

3. **重定向到 Google**
   ```
   https://accounts.google.com/o/oauth2/v2/auth?
     client_id=...&
     redirect_uri=https://emeradar.com/api/v1/oauth/gsc/callback&
     state=cHJval8xMjM6cmFuZG9tU2VjcmV0...&
     scope=https://www.googleapis.com/auth/webmasters.readonly
   ```

4. **用户授权后，Google 回调**
   ```
   GET /api/v1/oauth/gsc/callback?code=...&state=...
   ```

5. **后端处理回调**
   - 从 `state` 解码项目 ID
   - 验证 state（防 CSRF）
   - 用 `code` 换取 access token 和 refresh token
   - 加密后存入 `gsc_connections` 表

6. **重定向回项目页面**
   ```
   /projects/{id}?gsc=select-property
   ```

---

## 🔐 安全机制

### State 参数（防 CSRF）

- **格式**：`base64url(projectId:randomSecret)`
- **生成**：`ProjectService.getGscAuthorizationUrl()`
- **验证**：`ProjectService.consumeGscOAuthState()` - 检查 SHA-256 哈希
- **有效期**：10 分钟
- **一次性**：验证后立即删除

### Token 加密

- **算法**：AES-256-GCM
- **密钥**：`GSC_TOKEN_ENCRYPTION_KEY`（32 字节）
- **存储**：`gsc_connections.token_encrypted`

---

## 🧪 测试

### 本地测试

1. 配置 `.env.local`：
   ```bash
   GOOGLE_CLIENT_ID="..."
   GOOGLE_CLIENT_SECRET="..."
   GSC_REDIRECT_URI="http://localhost:3000/api/v1/oauth/gsc/callback"
   GSC_TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
   ```

2. 在 Google Cloud Console 添加回调 URL：
   ```
   http://localhost:3000/api/v1/oauth/gsc/callback
   ```

3. 启动开发服务器：
   ```bash
   pnpm dev
   ```

4. 访问 `/projects/{id}` 并点击「连接 Search Console」

---

## 📋 数据库表

### `gsc_oauth_states`（临时 state 存储）

```sql
CREATE TABLE gsc_oauth_states (
  id SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
```

### `gsc_connections`（加密的 token 存储）

```sql
CREATE TABLE gsc_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  property_url TEXT,
  token_encrypted TEXT NOT NULL
);
```

---

## ⚠️ 常见问题

### Q: 回调返回 400 "Invalid OAuth state"

**原因：**
- state 已过期（>10 分钟）
- state 被重复使用
- 浏览器清除了 cookies

**解决：**
重新发起授权流程。

---

### Q: 授权成功但没有看到 Search Console 属性

**原因：**
- Google 账号没有 Search Console 权限
- 授权时选错了账号

**解决：**
1. 访问 [Google Search Console](https://search.google.com/search-console)
2. 确认该账号有网站权限
3. 断开 Emeradar 的 GSC 连接后重新授权

---

### Q: 生产环境 token 加密失败

**原因：**
- `GSC_TOKEN_ENCRYPTION_KEY` 未设置
- 密钥不是 64 位十六进制

**解决：**
```bash
# 生成新密钥
openssl rand -hex 32

# 添加到 .env
GSC_TOKEN_ENCRYPTION_KEY="生成的密钥"
```

---

## 🚀 发布检查清单

- [ ] Google Cloud Console 配置完成
  - [ ] Search Console API 已启用
  - [ ] OAuth 同意屏幕已配置
  - [ ] OAuth Client ID 已创建
  - [ ] 回调 URL 已添加：`https://emeradar.com/api/v1/oauth/gsc/callback`
- [ ] 生产 `.env` 配置完成
  - [ ] `GOOGLE_CLIENT_ID` 已设置
  - [ ] `GOOGLE_CLIENT_SECRET` 已设置
  - [ ] `GSC_REDIRECT_URI` 已设置
  - [ ] `GSC_TOKEN_ENCRYPTION_KEY` 已生成并设置（32字节）
- [ ] 数据库表已迁移
  - [ ] `gsc_oauth_states` 表存在
  - [ ] `gsc_connections` 表存在
- [ ] 端到端测试通过
  - [ ] 授权流程正常
  - [ ] 可以列出 Search Console 属性
  - [ ] 可以选择属性并保存

---

## 📚 相关代码

- **统一回调端点**：`apps/web/src/app/api/v1/oauth/gsc/callback/route.ts`
- **旧版端点**（兼容）：`apps/web/src/app/api/v1/projects/[id]/gsc/callback/route.ts`
- **OAuth 逻辑**：`packages/services/src/project.service.ts`
  - `getGscAuthorizationUrl()` - 生成授权 URL，state 编码项目 ID
  - `extractProjectIdFromState()` - 从 state 解码项目 ID
  - `consumeGscOAuthState()` - 验证并消费 state（一次性）
  - `completeGscAuthorization()` - 完成 token 交换并加密存储

---

## 🔄 迁移说明（从旧版升级）

如果您已经在 Google Cloud Console 注册了旧版的项目级回调 URL：

1. **添加新的统一端点**（不要删除旧的）：
   ```
   https://emeradar.com/api/v1/oauth/gsc/callback
   ```

2. **部署新代码** - 旧端点仍然存在，向后兼容

3. **验证新流程正常** - 创建新项目并测试 GSC 连接

4. **（可选）清理旧端点** - 确认所有用户都迁移到新流程后，可以删除旧的回调 URL

---

**重构完成日期**：2026-10-17  
**作者**：Claude (Opus 5.5)
