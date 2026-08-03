# Aarre 生产云端交接手册

这是后续 Agent 接管 Aarre 账号体系和腾讯云生产环境的第一入口。所有命令默认从仓库根目录执行。

## 1. 当前生产事实

| 项目 | 当前值 | 边界 |
| --- | --- | --- |
| 公网 API | `https://sync.nexvoice.cc` | 仅 Caddy 对外，API 只监听服务器 `127.0.0.1:8788` |
| 腾讯云主机 | `ubuntu@43.161.230.52`，香港 | 与 NexVoice 共机，但 Aarre 独立容器、database/role、secrets、CAM、COS 和监控 |
| SSH Key 默认路径 | `~/.ssh/nexvoice-production.pem` | 明文不进 Git；加密副本在恢复包中 |
| 生产发布 | `/opt/aarre/current` | 指向不可变 release；失败发布必须回滚旧 release |
| PostgreSQL | `aarre_sync` | 共用 PostgreSQL 16 实例，但使用独立 database 和 role |
| 香港主 COS | `aarre-private-1251806841` | 私有、版本控制、SSE-COS AES-256、仅允许扩展 CORS |
| 新加坡灾备 COS | `aarre-backup-1251806841` | 私有、版本控制、无浏览器 CORS，接收数据库备份和跨地域复制 |
| Google Cloud project | `aarre-production` | Web OAuth 回调仅为 `https://sync.nexvoice.cc/v1/auth/google/callback` |
| 腾讯 DNS | `nexvoice.cc` DNSPod | `sync` A 记录指向生产主机；根 TXT 用于 Google 域名所有权 |
| 错误监控 | `https://console.nexvoice.cc/admin/` | Aarre 使用独立 GlitchTip team/project |
| 扩展固定身份 ID | `ppjmhonejgpcdmjmcbbdjookgiagambm` | 0.5.35 起 manifest 固定公钥，所有电脑任意路径加载均为同一 ID；正式 Web Store ID 下发后必须整体替换。私钥在 `~/Documents/Aarre-Recovery/aarre-extension-identity.pem`（0600），不进 Git |

生产 API 的内容字段使用逐用户 DEK + AES-256-GCM；图片使用私有 COS + SSE-COS AES-256。这不是端到端加密，受控服务器 root 与 KEK 持有人具备恢复能力。

## 2. Git 中有什么，Git 外还需要什么

Git 中的 `ops/encrypted-secrets/aarre-production-secrets.tar.gz.enc` 是 AES-256-CBC/PBKDF2-SHA256 加密包，包含：

- 生产 `/etc/aarre/aarre.env`；
- 备份与删除 Worker 的 `backup.env`；
- API CAM 的 `api-cam.env`；
- 腾讯云资源和最小权限身份的 provision state；
- `nexvoice-production.pem` SSH 私钥；
- 不含 Secret 的恢复元数据。

加密包因此覆盖 Google OAuth client secret、Aarre Token pepper、KEK keyring、数据库连接、GlitchTip DSN、两套 Aarre CAM 和 SSH。它不包含以下内容：

- 解密口令；
- 腾讯云 Root 控制台账号、密码、扫码会话或 MFA；
- Google 账号密码、Cookie、MFA 或 Search Console 会话；
- 用户的 BYOK AI API Key；
- GitHub 登录凭据。

同一台 Mac 的恢复口令位于 macOS Keychain：service `com.aarre.production-secrets`、account `recovery-passphrase-v1`。离线副本位于 `~/Documents/Aarre-Recovery/Aarre-production-secrets-recovery-passphrase.txt`，权限必须为 0600，并应额外存入用户自己的离线密码保险库。口令永远不能加入 Git、Issue、日志或聊天。

## 3. 后续 Agent 的标准接管顺序

### 3.1 先做只读核验

```bash
ops/cloud-production/verify-production-access.sh
```

它只检查加密包校验、DNS、HTTPS、SSH、release、容器、迁移数量、计时器和最近错误，不读取或打印任何 Secret。

### 3.2 当前 Mac 缺 SSH Key 时

```bash
ops/cloud-production/restore-production-access.sh --install-ssh
ops/cloud-production/verify-production-access.sh
```

脚本优先从 Keychain 取恢复口令；新机器上会在终端安全提示输入。它只安装 SSH Key，不把服务器 Secret 永久解压到本机。

需要做整机灾难恢复时才显式导出全部材料：

```bash
AARRE_RECOVERY_TARGET="$HOME/Documents/Aarre-Recovery/restored-production" \
  ops/cloud-production/restore-production-access.sh --extract
```

目标目录会保存明文生产凭据，必须为 0700，仅在恢复窗口使用，完成后安全删除。常规开发和部署不需要解压这些文件；服务器已有 root-only `/etc/aarre`。

### 3.3 修改服务端

1. 先运行 `git status --short --branch`，完整保留用户工作区。
2. 阅读 `server/README.md`、`docs/ARCHITECTURE.md` 和 `AGENT_PROGRESS.md`。
3. 改契约时同时改客户端序列化、服务端 strict schema 和双向测试，禁止只放宽成 `passthrough`。
4. 服务端版本至少递增 `+0.0.1`；扩展有改动时 Manifest/package 同样至少递增 `+0.0.1`。
5. 在全新临时 PostgreSQL 数据库运行全部服务端测试。
6. 生产发布使用新的不可变 release 目录，健康门通过后再更新 `/opt/aarre/current`；失败必须重新部署旧 release。
7. 发布后检查公网、CORS、容器、迁移、日志、备份计时器和 NexVoice 健康。
8. 凭据、KEK 或 SSH Key 变化后重新生成并验证加密恢复包。

### 3.4 常用安全命令

重新生成恢复包：

```bash
server/infra/production/export-encrypted-recovery.sh
```

生产只读状态：

```bash
ops/cloud-production/verify-production-access.sh
```

手动日备、隔离恢复和容量测量见 `server/README.md`。任何恢复都先进入隔离 database，禁止直接覆盖 `aarre_sync`。

## 4. 权限和轮换规则

- Aarre API CAM 只允许主桶用户资产路径的最小读写，不允许管理 CAM、DNS 或灾备备份。
- Backup CAM 只给备份、跨地域历史版本清理所需权限，不进入长期 API 容器。
- Google OAuth 仅申请 `openid email profile`，不申请敏感或 restricted scope。
- 当前扩展 CORS 是精确单 ID，不得改为 `*`。正式 Web Store ID 获得后需同时更新 API allowlist、COS CORS、OAuth 回跳验收和商店构建。
- KEK 轮换时旧 version 必须保留到全部 `user_keys` 完成 rewrap，并通过新恢复包和隔离恢复演练。
- 任何 SSH、OAuth、CAM、数据库或 KEK 轮换后，旧恢复包先保留到新包完成 SHA-256、解密目录验证和实际连通性检查。

## 5. 控制台入口

- 腾讯云 DNSPod：`https://console.cloud.tencent.com/cns`
- 腾讯云 COS：`https://console.cloud.tencent.com/cos`
- 腾讯云 CAM：`https://console.cloud.tencent.com/cam`
- Google Cloud：`https://console.cloud.google.com/?project=aarre-production`
- Google Auth Platform：`https://console.cloud.google.com/auth/overview?project=aarre-production`
- GlitchTip Admin：`https://console.nexvoice.cc/admin/`

控制台登录仍由用户本人完成。Agent 不得把浏览器 Cookie、扫码结果或 MFA recovery code 导出到恢复包。

## 6. 发生同步故障时

1. 先保存侧边栏错误原文和发生时间。
2. 查 `aarre-production-aarre-api-1` 最近日志，只按路由和状态码定位，禁止输出请求正文或 Token。
3. `400 unrecognized_keys` 表示客户端与服务端 strict schema 不一致；同时修客户端白名单和服务端契约。
4. `401` 先区分 access token 过期、refresh replay 与账号不一致。
5. `403` 先检查扩展 Origin 是否属于 allowlist。
6. `423` 表示资源受保护，不能通过重试绕过。
7. `429` 遵守 `Retry-After`，不要让客户端高频重试。
8. 修复后必须以用户当前账号完成一次真实开启同步，而不只运行单元测试。
