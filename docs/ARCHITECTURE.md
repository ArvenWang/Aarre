# Aarre 架构

最后更新：2026-08-03
实现版本：0.5.62

> 自建云端已部署到与 NexVoice 共用的腾讯云香港服务器：独立 API、数据库/用户、两只私有 COS、两套最小权限 CAM、Google Web OAuth client、每日/月度备份、两分钟健康巡检、Aarre 独立 GlitchTip project 和加密恢复材料均已建立，真实 COS 复制/全版本删除、PostgreSQL 隔离恢复及脱敏错误上报演练通过。当前生产发布指向 `/opt/aarre/releases/20260803-sync-rate-v27`，服务端版本 0.1.9；`sync.nexvoice.cc` 的 DNS、公开 TLS、隐私/条款页面、真实 OAuth 登录/登出和 262 条资源 metadata 首次同步均已通过。0.5.33 将显式范围选择改为本地立即保存、云端后台续传，并修复价格版本字段契约与 429 `Retry-After`。Google 品牌、完整图片备份、卸载重装恢复和正式 Web Store ID 仍是发布门。旧 Supabase / Edge Function / pgvector 路径已删除，不属于现状。

## 1. 不可动摇的边界

1. Chrome 原生书签是标题、URL、文件夹和顺序的唯一事实来源。
2. 未登录、断网或云端故障时，本地收藏、检索、AI 和截图仍可使用。
3. 网页正文、Cookie、完整浏览历史、BYOK API Key、Chrome 原生 ID 和运行时任务不进入 Aarre 云端。
4. 云端默认关闭。用户连接账号后仍需明确选择“仅文字与设置”或“完整云端备份”。
5. 页面快照只在“完整云端备份”下加密上传；受保护网页和文件夹在任何模式下都不上传。
6. 云端加密是服务端信封加密，不宣传成端到端加密。

## 2. 三层数据模型

### 2.1 Chrome 原生层

保存标题、URL、文件夹、顺序和创建时间。Aarre 通过 `chrome.bookmarks` 直接读取和修改，并监听创建、改名、移动、排序和删除事件。Chrome Sync 是否开启仍由用户在 Chrome 中控制。

### 2.2 Aarre 本地智能层

IndexedDB 与 `chrome.storage.local` 保存：

- URL 级摘要、标签、主题、别名、内容类型、链接健康和用户备注；
- 收藏位置绑定、页面快照、站点标识和封面；
- AI 用量、会话、报告、保护规则、操作历史和持久任务；
- 用户的 AI Key 与云端 Token。

本地层始终优先写入。Service Worker 被暂停、网络失败或云端未配置时，持久 Outbox 继续保留待同步变更。

### 2.3 可选云端层

云端只保存恢复后仍有用户价值的白名单数据：

- PostgreSQL：加密后的资源、收藏位置、设置、保护规则、会话、报告、用量、操作历史、冲突版本和墓碑；
- 腾讯云 COS：页面快照、页面封面、站点标识和用户封面；
- 不保存本地全文检索向量，语义检索继续在设备端完成；
- 不运行 AI 富化，Gemini / OpenAI / DeepSeek 请求继续由扩展使用用户自己的 Key 直连。

## 3. 稳定身份与重装恢复

- URL 级资源键：规范化 URL 的 SHA-256。
- 收藏位置：Aarre 生成跨设备稳定的 `bookmarkItemId`；Chrome bookmark ID 只保存在当前设备。
- 文件夹保护：云端保存 `protectedFolderRuleId` 与路径提示，本机保存它和 Chrome folder ID 的绑定。
- 新设备先由 Chrome Sync 恢复书签树，再用 URL、标题和文件夹路径重绑定智能层。唯一匹配自动绑定；歧义项保持待确认，不静默绑定到错误书签。

恢复顺序是“原生书签首屏 → 文字元数据 → 当前可见图片懒下载”。已有完整 AI 信息的条目不重新消耗用户的 AI 额度；API Key 必须在新设备重新配置。

## 4. 认证与 Token

Google 登录使用服务端 Web OAuth broker 与扩展一次性 PKCE ticket：

1. 扩展生成 verifier/challenge 和 `deviceId`，通过 `chrome.identity.launchWebAuthFlow` 打开 Aarre API。
2. 服务端只接受正式 Extension ID 对应的精确 `chromiumapp.org/auth` 回跳。
3. Google 只回调 `https://sync.nexvoice.cc/v1/auth/google/callback`；服务端验证 state、nonce、签名、issuer、audience、有效期和 `email_verified`。
4. Google access token 立即丢弃，不保存 refresh token。
5. 服务端通过 URL fragment 交付 60 秒单次 ticket；扩展用 verifier 换取 Aarre 自己的随机不透明 Token。
6. access token 10 分钟、refresh token 30 天并每次轮换；旧 refresh 重放会吊销整个 family。

Token 仅由 Service Worker 读取，`chrome.storage.local` access level 固定为 `TRUSTED_CONTEXTS`。侧边栏、网页端和 content script 只能发送类型化消息，拿不到 Token 或 COS 短签名 URL。

## 5. 同步协议与冲突

- 第一次登录按 200 条分页 bootstrap；现有本地资源按“当前账号是否真的返回过云端 revision”补种 Outbox，避免旧版本的 `synced` 标记让换账号或升级后的记录被漏传；以后使用单调递增的 `sync_changes.sequence` 拉增量。
- 每个写入携带 UUID `operationId`，重试返回第一次结果，避免重复写入和重复计量。
- durable entities 使用 `PUT /v1/sync/entities/batch` 每批最多 100 条；同一账号的配额计数行是天然串行点，服务端在单次 HTTP 批次内依次提交，并对 PostgreSQL 死锁/序列化冲突做有限重试。逐项仍沿用相同的 `operationId` 幂等、配额、加密和用户隔离边界。
- URL 级 AI 字段使用字段时钟合并，改一个字段不会覆盖整条资源。
- 备注和用户标签携带 `baseRevision`。旧 revision 的不同内容不会静默覆盖：服务端把两份内容写入加密的 `conflict_versions`，备注保留当前权威值、标签先取并集；侧边栏和网页端编辑器可选择云端版、离线版或用当前编辑内容合并。
- 删除写墓碑；游标落后于 180 天变更保留窗口时，服务端要求 full resync。
- 保护规则优先于普通同步。文件夹规则同时写入该文件夹当前覆盖的资源身份映射；服务端会拒绝旧设备对这些资源的资源 JSON、收藏位置和图片写入，并清理既有元数据与 COS 全版本。

## 6. 图片资产协议

图片二进制不经过 Fastify JSON body：

1. Service Worker 计算 WebP bytes、SHA-256、尺寸与绑定信息。
2. API 校验账号、范围、保护规则和配额，分配 `users/<userId>/<assetId>/<sha256>.webp`。
3. API 签发 5 分钟单对象 PUT URL；浏览器直接上传到香港私有 COS。
4. `complete` 后服务端 HEAD 校验大小、hash metadata、MIME 和 SSE-COS AES-256，再把对象标记为可见。
5. 新设备只拉 manifest，当前可见资产按需用短时 GET URL 下载，并在客户端再次校验 SHA-256。

普通替换和误删通过 COS 版本控制保留 30 天。开启保护或删除账号时，独立 deletion worker 枚举并删除香港主桶与新加坡灾备桶的全部对象版本，不能只写 delete marker。

## 7. 加密与授权

- 每个用户有独立 32-byte DEK，内容使用 AES-256-GCM。
- Alpha 的应用 KEK 使用最多 8 个版本的 keyring，保存在服务器 `/etc/aarre/aarre.env`（root-only、mode 600）；`user_keys` 只存 wrapped DEK 和 KEK version，轮换期间旧版本继续可读。
- COS 使用腾讯云默认 SSE-COS AES-256。KMS/SSM wrapper 接口仍保留给未来高合规阶段，但当前没有购买高固定成本 KMS/SSM，也不会把缺服务降级成数据库明文。
- `/etc/aarre` secrets 已导出为 AES-256/PBKDF2 加密恢复包；恢复口令同时保存在当前 Mac Keychain 和独立 mode 600 恢复文件。获得服务器 root 与 KEK 的受控后端仍能解密，因此不宣传为端到端加密。
- 所有查询从认证结果取得 `userId`，并在 SQL 中显式限定；跨用户资源与不存在统一返回 404。
- payload 使用 zod 严格白名单，正文、base64 图片、API Key、Token 与原生 ID 会被拒绝。

## 8. 腾讯云部署

Alpha 与 NexVoice 共用腾讯云香港轻量应用服务器，但只共用机器、Caddy 和 PostgreSQL 实例：

```text
Caddy :443
  └─ sync.nexvoice.cc → 127.0.0.1:8788
       └─ aarre-api（独立容器，320 MiB / 0.75 CPU）
            ├─ control-db:5432 / aarre_sync（独立 database + role）
            ├─ 香港私有 COS 主桶（SSE-COS AES-256）
            └─ root-only 版本化 KEK keyring

短命 backup/deletion worker（独立高权限 CAM）
  └─ 新加坡私有 COS 灾备桶
```

Compose project 固定为 `aarre-production`，仅以 external network 方式加入已存在的 `production_default`。Aarre 不读取 NexVoice ASR 密钥、业务 database 或对象路径，API 容器也不加载 backup/deletion 凭据。

生产机每两分钟只检查 `127.0.0.1:8788/ready`；失败时只重启 `aarre-api`，绝不重启 NexVoice 容器。错误上报复用现有 GlitchTip 实例，但使用独立 `aarre` team、`Aarre Sync API` project 和“5 分钟内首次错误”邮件告警。SDK 禁止默认 PII、trace、breadcrumb 和 HTTP/Fastify request integration；Fastify 日志删除 query 与 Authorization，GlitchTip 事件再删除 request、user、extra、contexts 和 URL/API Key 样式文本。受控生产事件已真实入库并标记为已解决。

## 9. 备份、容量与扩容

- 每日 `pg_dump -Fc` 上传新加坡 COS，日备保留 35 天、月备保留 12 个月；容器强制使用与服务端一致的 PostgreSQL 16 client，备份对象记录 source/client major 与 SHA-256。
- 香港主资产桶启用版本控制并跨地域复制到新加坡。
- restore 默认只允许隔离数据库，先核 SHA-256 和 dump/source/restore/target major；覆盖生产需要额外精确确认。2026-08-02 首次正式演练恢复了 6 个 migration、25 张表并删除演练库。
- 每季度联合恢复数据库与资产 manifest，验证数量、sequence、对象 version/bytes/hash 和图片解码。
- 当前账号实测有效云端投影 5.17 MiB；加数据库/加密开销后主数据 7–9 MiB，含主桶、异地副本、历史版本和数据库备份约 15–25 MiB。
- 完整腾讯云价格、1/1,000/10,000 用户模型、购买清单和 50/70/85 扩容阈值见 [CLOUD_CAPACITY_PLAN.md](CLOUD_CAPACITY_PLAN.md)。

## 10. 构建与上线门

- 普通 `npm run build` 不配置云端 URL，账号入口保持不可连接状态。
- 生产云端构建必须显式设置 `AARRE_CLOUD_RELEASE=1` 和根 HTTPS `VITE_AARRE_API_BASE_URL`；脚本拒绝 localhost、URL path、query 和 fragment。
- COS/CAM、版本/生命周期、SSE-COS、跨地域复制、真实 PUT/HEAD/GET/全版本删除、数据库灾备演练、DNS/TLS 和公开 OAuth 技术链路已完成。完整发布验收前仍必须完成 Google 品牌审核、正式 Web Store Extension ID、真实扩展首次同步、卸载重装恢复和 50 账号并发压测。
- 生产健康巡检、错误状态映射、OAuth query 日志脱敏和独立 GlitchTip 事件链已经验收；它们不能替代真实扩展首次同步与卸载重装恢复门。
- 当前自动化通过不等于上述外部资源已上线；最终状态以 `AGENT_PROGRESS.md` 的生产门记录为准。
