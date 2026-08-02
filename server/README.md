# Aarre Sync API

这是 Aarre F14 的独立云端服务。它与 NexVoice 只共用腾讯云机器、Caddy 和 PostgreSQL 实例，不共用 database、role、业务密钥、CAM 身份或 COS 路径。

## 安全与数据边界

- API 只接受正式扩展 ID 的 `chrome-extension://` Origin。
- Google Web OAuth 只回跳该扩展的 `chromiumapp.org` 精确地址。
- access token 10 分钟、refresh token 30 天且单次轮换；旧 refresh token 重放会吊销整个 family。
- PostgreSQL 内容字段以每用户 DEK 做 AES-256-GCM；Alpha 的应用 KEK 使用 `/etc/aarre/aarre.env` 中的版本化 root-only keyring，企业阶段可改用腾讯云 SSM/KMS wrapper。
- 图片不经过 API JSON，浏览器用短时签名 URL 直传私有 COS；对象强制 SSE-COS AES-256、SHA-256 和尺寸校验。
- API Key、Cookie、网页正文、完整浏览历史和原生 Chrome bookmark/folder ID 被 schema 拒绝。
- 旧 revision 的备注/用户标签修改不会静默覆盖；两份内容加密写入 `conflict_versions`，由侧边栏或网页端选择、采用或合并。
- 受保护资源上传返回 423；开启保护会删除云端 metadata，并排队删除香港主桶与新加坡灾备桶的全部对象版本。

## 本地验证

需要本机 PostgreSQL。测试默认使用 `postgres://localhost/aarre_sync_test`：

```bash
createdb aarre_sync_test
cd server
npm ci
npm run typecheck
npm test
npm run build
npm audit
```

## 生产部署

1. 按 [容量与采购计划](../docs/CLOUD_CAPACITY_PLAN.md) 创建 Aarre 独立 COS、CAM、OAuth 与 DNS。腾讯资源可在已授权的生产主机上通过一次性容器运行 `node dist/cli/provision-tencent.js`；必须显式设置 `AARRE_TENCENT_PROVISION_CONFIRM='CREATE AARRE PRODUCTION RESOURCES'`，并把 `/out` 挂载为 root-only 的 `/etc/aarre`。脚本只输出资源摘要，CAM Secret 仅写入 mode 600 的 `api-cam.env` / `backup.env`。
2. 把仓库部署到 `/opt/aarre/current`。
3. 从 `.env.example` 创建 `/etc/aarre/aarre.env`，从 `infra/production/backup.env.example` 创建 `/etc/aarre/backup.env`；两者 owner 均为 root、mode 600。长期运行的 API 只加载前者，后者仅交给备份/全版本删除 Worker。`DATABASE_URL` 使用 `control-db` 内网服务名，例如 `postgres://aarre:<password>@control-db:5432/aarre_sync`。
4. 设置仅用于建库的 shell 变量 `AARRE_DB_PASSWORD`，运行 `infra/production/deploy.sh`。
5. DNS 生效后运行 `infra/production/install-caddy-site.sh`；先由 Caddy 校验配置，脚本会保留原配置备份。
6. 安装 `aarre-backup*.service/timer` 到 `/etc/systemd/system/`，执行 daemon-reload、enable --now，并手动触发一次备份。
7. 用 `AARRE_RESTORE_DATABASE_URL` 指向隔离数据库运行恢复工具；没有摘要一致和完整恢复演练，不得通过灾备门。

服务容器只监听 `127.0.0.1:8788`，公网仅由 Caddy 的 `https://sync.nexvoice.cc` 进入。生产 `ready` 会同时检查 PostgreSQL 和 COS 配置。

## COS 配置门

主桶：

- ACL 私有、禁止公有访问；
- 版本控制开启；
- 默认加密 SSE-COS AES-256；
- CORS Origin 只允许 `chrome-extension://<正式扩展 ID>`；Methods 为 PUT/GET/HEAD；Allowed-Headers 至少包含 `content-type`、`x-cos-meta-sha256`、`x-cos-server-side-encryption`、`x-cos-server-side-encryption-cos-kms-key-id`；Expose-Headers 包含 ETag 与 `x-cos-version-id`；
- 跨地域复制到新加坡灾备桶；历史版本 30 天后清理。

灾备桶：私有、版本控制、默认 SSE-COS AES-256、不配置浏览器 CORS；数据库 daily 前缀 35 天，monthly 前缀 365 天。

## 备份与恢复

```bash
docker compose --profile maintenance run --rm -e AARRE_BACKUP_CLASS=daily aarre-backup

docker compose --profile maintenance run --rm \
  -e AARRE_RESTORE_CONFIRM='RESTORE AARRE DATABASE' \
  -e AARRE_RESTORE_OBJECT_KEY='backups/database/daily/...' \
  -e AARRE_RESTORE_DATABASE_URL='postgres://aarre_restore:...@control-db:5432/aarre_restore' \
  aarre-backup node dist/cli/restore.js

docker compose --profile maintenance run --rm \
  aarre-backup node dist/cli/measure-capacity.js
```

备份和恢复会同时校验 PostgreSQL server/client major；镜像固定安装 PostgreSQL 16 client，防止新版 `pg_dump` 生成旧服务端无法恢复的参数。恢复默认拒绝覆盖当前生产 database；只有额外给出 `AARRE_ALLOW_IN_PLACE_RESTORE='YES I UNDERSTAND'` 才允许原地恢复。正常演练永远恢复到隔离库。

如果恢复演练确认某个历史备份不可用，使用 `invalidate-backup` 并给出精确对象键、原因和确认短语；工具会先把台账标记失败，再删除灾备桶中的该对象全部版本并记录结果。不得用普通 `DeleteObject` 留下不可见但仍计费、仍可恢复的旧版本。

## 恢复材料

`infra/production/export-encrypted-recovery.sh` 从服务器读取四个 root-only 配置文件，在本机生成 AES-256/PBKDF2 加密包与 SHA-256；口令放入 macOS Keychain，并首次写入独立 mode 600 恢复文件。脚本会立即做一次解密目录验证，任何明文临时包都不会留在仓库。
