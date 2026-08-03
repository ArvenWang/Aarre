# Aarre 项目进展

最后更新：2026-08-03（0.5.50 / 修复同一网址多条收藏位置：ID 确定性 + 同步去重）

> **并行说明：** 本轮账号交接包、同步契约和生产发布已完成代码与服务器写入；当前没有新增的独占编辑文件。0.5.34 及此前累积的 UI / AI / icon / 云端改动已作为同一套可构建状态纳入 Git，后续 Agent 不得 reset、回退或删除 `/opt/aarre` 发布目录。完整图片备份、真实卸载重装恢复和正式 Web Store ID 仍是外部验收门，不能写成已完成。云端接管先读 `ops/README.md`。

**当前工作区最新状态：0.5.50。** 0.5.50 修复“同一网址多条收藏”根因：云端实测 740 条 bookmark-items / 267 资源（约 2.77 倍），本地 Chrome 书签树 265 条无重复——重复来自换扩展 ID/重装后本地绑定缓存清空，`bookmarkItemId` 用随机 UUID 重新生成并上传，服务端以 item id 为主键无法按 URL 去重，恢复逻辑又把重复灌回本地。修复：① 有 Chrome 书签 ID 的收藏位置改用确定性 UUID（`stableUuid("bookmark:"+id)`），同一书签跨重装稳定，云端按 ID upsert；② 同步构建绑定列表时按规范化网址去重（同一网址只保留一条，多余绑定标记删除并上传），云端重复自动清理；③ 云端恢复时按网址去重，不再重复灌回本地。0.5.49 网页端自动刷新封面；0.5.48 快照数据源+防回退；0.5.47 全量同步回退修复+Toast；0.5.46-0.5.44 探针与反馈；0.5.43 FileReader；0.5.42 自动收藏+菜单双注册；0.5.41 头像+GIF；0.5.40 右键图片设封面；0.5.39 完整备份循环恢复；0.5.38 构建门强制云端；服务器 active 图片 391 张。0.5.37 上传前对账；0.5.36 只有完整备份；0.5.35 manifest 固定扩展 ID。当前 `dist/` 为 cloud-enabled 0.5.50 正式构建（带 key）。F14 生产 API、数据库、COS/CAM、Google Web OAuth、DNS/TLS、定时备份、两分钟健康巡检、独立 GlitchTip project 与含 SSH Key 的加密恢复包已经部署；Google 品牌审核、卸载重装恢复和正式 Web Store ID 尚未完成。

## 当前进展

**状态校正：** 上方历史摘要中的 0.5.33 文字已由本轮 0.5.34 构建取代；当前 `dist/manifest.json` 为 0.5.34，且显式连接 `https://sync.nexvoice.cc`。本轮最终验证为 329 项测试通过。

**2026-08-03 · 0.5.34 登录卡住与完整本地体积修复。** `SIGN_IN_CLOUD` 现在在 Google 授权票据换取并保存本地会话后立即返回；云端旧数据恢复、收藏同步和图片同步由统一进度任务在后台继续，登录按钮不再等待整库完成。授权窗口增加 90 秒无回调错误边界，避免浏览器授权异常时永久显示“登录中”。新增 `GET_LOCAL_DATA_SIZE`：只读统计 IndexedDB 五个数据表、Chrome 原生书签树、`chrome.storage.local`、`chrome.storage.session` 和扩展页面存储的逻辑字节数，侧边栏明确显示“本地数据总量”，与“可上传内容进度”分开；不向 UI 或云端返回 token 内容。完整 `npm run check`、329 项测试和 cloud-enabled 0.5.34 构建均通过，真实 Chrome 重载、重新登录和本地体积数值仍待用户验收。

**2026-08-03 · 0.5.34 动态云端同步进度。** 同步设置保存后，后台会把本次实际待同步的收藏数量、成功处理数和失败数写入本地进度状态；侧边栏每秒刷新进度和云端容量。完整备份中的图片/快照上传另计新增上传数，容量数值不再被当作同步进度使用。根 `npm run check` 已通过，真实 Chrome 重载与手动点击同步仍待验收。

**2026-08-03 · 0.5.34 本地字节上传进度。** 250 MiB 是服务端给每个账号的默认硬配额，不再作为上传进度分母。侧边栏新增本地上传量估算：按当前范围统计可同步元数据、收藏位置、封面、快照和站点标识，排除受保护内容；进度条用云端当前已存字节与本地估算总量计算，并每 5 秒重新估算本地内容。`GET_CLOUD_SYNC_ESTIMATE` 仅读取本机 IndexedDB/设置，不上传数据。

**2026-08-03 · 0.5.34 refresh token 重放边界修复。** 侧边栏云端容量轮询暴露了旧 access token 收到迟到 401 后重复兑换旧 refresh token 的时序问题；客户端现在刷新前重新读取最新会话，并在发现其他请求已经完成轮换时复用新 token。重新登录后的自动恢复也进入统一同步进度状态；旧 replay 错误会转换为“请重新登录后继续同步”。类型检查、328 项测试和 cloud-enabled 构建通过。

**F14 代码、本地集成和公网技术链路已经完成。** 扩展已接入 Google Web OAuth broker + 一次性 PKCE ticket、自建 REST bootstrap/change feed、持久 Outbox、文字/完整备份范围、COS 二进制直传/懒恢复、保护 purge、稳定收藏位置/文件夹重绑定、主题/设置/会话/报告/用量/操作历史同步和账号切换清理。服务端已实现 Fastify、8 组 PostgreSQL migration、逐用户 AES-GCM 信封加密、版本化 root-file KEK、Token rotation/replay revoke、配额、资产、账户导出/删除、加密冲突版本、异地备份/恢复和独立 deletion worker。首次同步按当前账号真实 revision 补种存量 Outbox；文件夹保护使用归一化资源映射阻止旧设备复传资源、收藏位置和图片；迁移器逐条执行 SQL 并过滤 macOS AppleDouble 伪文件。两端编辑器会显示备注/标签并发冲突，并允许保留云端版、采用离线版或以当前编辑内容合并。

**当前账号与生产容量均已实测。** 当前 Mac 的 262 条原生书签、261 条 Aarre 资源可进入云端的有效数据为 5,422,378 B（5.17 MiB）。真实账号已写入 262 条资源、235 个收藏位置、4 组设置、1 个月度用量和 1 个设备；当前范围仍为文字同步，生产资产为 0。Aarre database 为 12,049,431 B，三份有效数据库备份共 158,468 B，主资产桶为 0 B；服务器仍有约 2 GiB 以上可用内存和约 40 GiB 可用磁盘。长期仍按 15–25 MiB/同类账号规划，当前不需要扩容或购买存储服务器；完整计划见 `docs/CLOUD_CAPACITY_PLAN.md`。

**NexVoice 共机方案已真实运行。** 目标服务器位于腾讯云香港 `ap-hongkong-2`，Ubuntu 24.04、2 vCPU、3.57 GiB 内存，实际 Docker 网络为 `production_default`。独立 `aarre-api` 容器使用 320 MiB / 0.75 CPU 上限，当前健康且只监听 `127.0.0.1:8788`；Aarre 使用同一 PostgreSQL 16 实例内独立 `aarre_sync` database/role，以及独立 secrets、CAM 和 COS。图片不进入服务器系统盘。当前发布指向 `/opt/aarre/releases/20260803-sync-rate-v27`，服务端 0.1.9；每日、月度备份、5 分钟删除 Worker 和两分钟健康巡检 timers 已启用。GlitchTip 已建立独立 `aarre` team、`Aarre Sync API` project 和 5 分钟首次错误告警；公开 Caddy/Let's Encrypt TLS、允许 origin CORS 和错误 origin 拒绝均已验证。

**0.5.19 站点 icon 固定纯白画布已构建到 `dist/`。** `SiteThumbnail` 不再接收或选择深色图标版本；缩略图样式增加不随主题覆盖的 `--site-icon-canvas: #FFFFFF`。生成器由浅/深双输出改为单一纯白输出，并用 `iconRenderVersion: 2` 淘汰旧缓存；旧 `iconDataUrlDark` 只为数据库兼容保留，任何界面和新生成路径都不会再使用。完整检查为 55 个测试文件 / 301 项测试全部通过。当前没有需要其他 Agent 暂停修改的独占文件。

**0.5.6 圆角与编辑操作收口已写入源码并构建到 `dist/`。** 新增 `shell → module → control` 语义化圆角 token，并将整理提示、最近更改、编辑弹层、设置模块和 Select/菜单形状统一到阶梯规则；保留搜索框内胶囊控件作为有意例外。侧边栏编辑底部按钮组补齐间距，网页端与侧边栏关闭按钮统一为 32px 透明容器。下一位 Agent 先做真机复看，不要并行重写 `tokens.css` / `shape-context.tsx` / Select 形状系统，除非用户又点名新问题。

**前一轮 UI 收口已写入源码并构建到 `dist/`。** 设置页不再刷顶部提示条；「更多」同行对齐且有内边距；卡片 hover 为冷暗色整面遮罩且可无滚动条滚完文案；Select 从 token/形状系统收紧圆角、去掉绿色焦点框与黑色 hover 描边、浮层加淡描边；网页端顶栏去掉底部分隔线。

**统一收藏增强协调器已落地。** Chrome 星标与 Aarre 保存都先创建真实原生书签，再持久登记 AI 摘要、标签和截图任务；权限、Key、网络、前台页面或 Service Worker 暂时不可用时，任务继续等待，不用伪造摘要、标签或封面冒充完成。`"<all_urls>"` 已作为必需网页权限，普通打开方式统一覆盖 Aarre、地址栏、Chrome 书签栏、历史记录和网页普通链接。

**当前截图交互以“是否已收藏、是否缺图、截图是否满 7 天”为唯一判断，不再依赖入口。** 已收藏且缺图时，页面完成并经过字体、首屏图片、DOM 稳定检查后自动补拍；从 Aarre 或正常浏览补旧图成功显示一次“封面截图已更新”，Chrome 星标与 Aarre 新收藏的首次截图静默。已有截图未满 7 天不处理，满 7 天后只在正常浏览时静默刷新，不会每次访问都重拍。后台标签页因普通路径 `captureVisibleTab()` 的能力边界只保留待办，切回前台后自动继续；收藏库新增用户显式启动的单标签、单并发「补齐缺失封面」任务，0.4.5 起改为不抢焦点的后台专用标签页 + `chrome.debugger` 截图，任务运行期间可正常使用 Chrome，支持暂停、继续和取消。

**0.4.6 修复后台补拍“内容未加载完成就截图”。** 截图前先强制触发懒加载图片与 `content-visibility` 渲染并滚动整页，再等待图片真正就绪和网络活动安静；不再把“未开始加载的懒加载图”误判为已就绪，前台截图路径行为不变。

**隐私边界已统一为同时禁止 AI 与截图。** 无痕、内部、局域网、银行、支付、医疗和用户排除页面不读取正文、不调用外部 AI、也不截图，网页端只显示 Aarre 兜底图。截图前后继续核对前台标签、聚焦窗口、最终 URL、document/navigation 身份和收藏绑定；SPA、重定向、删除、URL 修改与 Service Worker 恢复统一走持久任务和精确页面身份。

**网页端收藏库已完成 0.4.4 稳定性收口。** Aarre 品牌与六个 Tab 合并为一条头部，只保留一条整体分隔线；收藏搜索、状态、文件夹和排序维持收藏库自身工具栏。卡片悬停详情按最新批注放在现有内容下方，通过折叠文档流展示，不再覆盖封面内容。每张卡片仍可精确编辑或删除一个 Chrome 收藏位置；大封面只读取本机 `pageSnapshots`，缺图时在 40 张 Aarre 兜底图中稳定分配。

**Aarre 0.3.8 已完成 `docs/UI_REDESIGN.md` 的 UI / 视觉系统重构并通过本地交付验收。** 侧边栏与网页端现共用单一 Token、明暗主题、两档密度和基础组件；网页端六个 tab 已拆成独立视图，收藏库改为内容型瀑布流，报告补齐数据图表，主题图谱升级为可旋转缩放的三维力导向 Canvas。设计防回归脚本已接入 `npm run check`，本轮完整检查为 35 个测试文件、150 项测试全部通过。详细量测与边界见最新记录。

**Aarre 0.3.8 已统一隐藏 Chrome 系统根目录，并完成整理提案的信息精简。** 侧边栏不再把“书签栏”“其他书签”或第二个本机书签栏作为普通文件夹展示，而是直接展示这些根目录下的真实内容；所有面向用户的文件夹路径统一从用户自建目录开始，根目录直存条目显示为“根目录”。归类提案改为“来源文件夹 / 网页名 → 目标文件夹”，网页名只出现一次；同位置的完全相同副本合并为“保留 1 个、删除 N 个副本”的明确说明。内部仍保留完整 Chrome 路径，移动、撤销、同步和删除目标不受影响。此前 0.3.7 已完成 `docs/REMEDIATION.md` v2 的第 1–7 批整改；F3 同源 300 条样本分类封面兜底为 46.67%，PRD 的 ≤12% 指标仍需产品决策。

自动化与开发评审已经收口，但**不能把它说成全部上架验收完成**：当前浏览器控制工具明确禁止打开 `chrome://extensions` 和 `chrome-extension://` 页面，因此无法在本轮把最新 `dist/` 重新加载并操作安装扩展；公开隐私政策与条款已经上线，Chrome Web Store 正式 Extension ID、三条历史失败路径的安装态复测、真实 300/1,000/2,000 条书签指标与真人破坏性撤销门仍需外部环境。0.4.5 新增的 `debugger` 权限与后台截图链路尤其需要在真实 Chrome 安装态复测（后台标签是否正常渲染、调试提示条、Memory Saver 冻结行为、商店审核披露）。详见“未解决问题”和本页最新记录。

**`docs/PRD.md` 已修订到 v1.3。** 22 个需求分四个里程碑，第 12 章给出了执行顺序、文件归属和纪律。开发 Agent 请从第 12 章读起。F14 已从“只同步元数据”升级为完整持久数据与私有图片资产的同步/备份方案；F22 继续以 2026-07-30 修订后的「悬浮层只有一张页面快照」为准。

**`docs/REMEDIATION.md` v2 的第 1–7 批已全部交付。** 下一轮不要重复调低 128px、宽高比或 0.15 墨迹阈值；这三条路线已经被实测证伪。尚未完成的主要是文档列出的真机规模验收与 F3 指标本身的产品决策。

**云端方向已定：完整持久资产同步与恢复，服务端使用腾讯云轻量应用服务器并与 NexVoice 共机。** 语义检索继续本地化、AI 富化继续 BYOK 直连；文字元数据进入独立 PostgreSQL database，用户选择完整云端备份后，封面与页面快照进入 Aarre 私有 COS。Aarre 与 NexVoice 只共用机器、Caddy/PostgreSQL 实例和实现模式，不共用 API 进程、database/user、业务密钥、COS 权限或故障边界。旧 Supabase 方案已经退出，禁止重新引入。

正式产品名：`Aarre`。代码目录与内部包名暂时保留 `Bookmark-Layer`，避免无关路径迁移影响当前扩展。

当前统一项目目录：`/Users/nefish/Desktop/Coding/Aarre`。

## 最近更新

### 2026-08-03 · 0.5.50 / 同一网址多条收藏位置的根因修复

- **数据实测。** 服务器解密 bookmark_items：740 条 / 267 资源，同一 URL 关联 2-3 条收藏位置（238 个资源受影响）；本地 Chrome 书签树 265 条**无重复**；资源层面几乎不重复（仅 recent.design/?ref 一组 URL 变体）。重复形态是“同 URL 多条 bookmark-items”，不是资源重复。
- **根因链。** `bookmarkItemId` 依赖本地绑定缓存（`CLOUD_BOOKMARK_BINDINGS`）中的 `existing?.bookmarkItemId`，缺失时 `crypto.randomUUID()`；用户换扩展 ID（kplepc→ppjmhone）/重装后缓存清空 → 全部书签重新生成新 ID 上传 → 服务端按 item id 主键插入 → 同 URL 积累；恢复逻辑把云端重复全部灌回本地（unbound 绑定），且 unbound 永不删除 → 云端重复永存。
- **修复。** ① 有 `nativeBookmarkId` 的书签用 `stableUuid("bookmark:"+id)` 确定性 ID（跨重装/换 ID 稳定，云端 upsert）；② `currentBookmarkBindings` 按规范化网址去重：同一 URL 只保留一条收藏位置，其余进入 deleted 并随同步删除（云端从 740 自动清理回 ~265）；③ `restoreDurableCloudState` 恢复时按网址去重。
- **验证。** typecheck 与 335 项测试通过；cloud-enabled 0.5.50 构建（带 key）通过。用户重载后触发一次同步即可看到云端重复自动清理。

### 2026-08-03 · 0.5.49 / 右键设封面后网页端自动刷新

- **用户实测。** 0.5.48 后大部分图片设置封面生效（tokenscope 等），但用户反馈 ECC 仓库的 hero.png 曾不生效——探针确认那是 0.5.46 时代（全量同步回退 bug 未修复时）的测试结果，0.5.48 链路已保存成功；同时发现 manager 页面打开时不会自动刷新卡片封面（`PAGE_SNAPSHOT_UPDATED` 监听已存在，但右键设封面路径未广播该消息）。
- **修改。** GIF 与普通图两条保存路径在写入 `pageSnapshots` 后广播 `PAGE_SNAPSHOT_UPDATED`（canonicalUrl + capturedAt），manager 的 `LibraryView` 已有监听会更新对应卡片的 `snapshotRevision` 并重新拉取快照。
- **验证。** typecheck 与 335 项测试通过；cloud-enabled 0.5.49 构建（带 key）通过。

### 2026-08-03 · 0.5.48 / 右键设封面同步写入页面快照，网页端封面生效

- **用户实测。** 0.5.47 后 Toast 正常弹出（保存成功），但网页端（manager）卡片封面始终不变。
- **根因。** 网页端 `LibraryCardCover` 只以 `GET_PAGE_SNAPSHOT`（`pageSnapshots` 表）为封面数据源，无快照时显示分类兜底图；`thumbnailDataUrl` 不在网页端封面链路中。右键设封面此前只写 `thumbnailDataUrl`，网页端因此无感知。
- **修复。** 设置封面时同步 `putPageSnapshot`（canonicalUrl + 图片 + capturedAt=now + 尺寸；GIF 先 `createImageBitmap` 取尺寸）；`restoreCloudAssets` 快照分支增加本地优先保护（本地快照 `capturedAt` 不早于云端时跳过下载，防止定时同步回退新封面）。云端同步仍走 `syncCloudAssets` 的 snapshot 上传路径（快照已写库后自动上传为新快照资产）。
- **验证。** typecheck 与 335 项测试通过；cloud-enabled 0.5.48 构建（带 key）通过。真人浏览器验证：设置封面后刷新/滚动网页端列表应显示新封面。

### 2026-08-03 · 0.5.47 / 右键设封面“对勾出现但封面不变”的根因修复

- **探针定位。** 0.5.45/0.5.46 探针实测：Service Worker 心跳正常、菜单点击事件到达（`aarre:context-menu-debug` 记录 menuItemId/srcUrl/tabUrl），分步探针显示点击后 0.6 秒完成 `entered → bookmark-state → resource-found → privacy-ok → fetched → blob-ready → bitmap-ready → canvas-converted → saved`，徽标出现对勾；随后 `syncNow()` 全量同步的 `restoreCloudAssets` 把云端旧 cover 下载并覆盖了刚设置的新封面（与 0.5.39 的恢复下载共用同一写入路径）。
- **修复。** ① 保存后不再调用 `syncNow()`，改为只循环 `syncCloudAssets()` 上传图片资产（新封面立即上传，state 记录后后续恢复不会再覆盖）；② `restoreCloudAssets` 的 cover/user-cover 分支增加本地优先保护：本地已有封面且 `coverUpdatedAt` 不早于云端（手动封面无 capturedAt 视为 0）时跳过下载；③ 新增页面内 Toast：成功时 `chrome.scripting.executeScript` 注入轻量提示（2.6 秒淡出），不常驻页面脚本。
- **验证。** typecheck 与 335 项测试通过；cloud-enabled 0.5.47 构建（带 key）通过。真人浏览器验证：右键图片设封面后页面应弹 Toast、封面立即生效，且后续定时同步不再回退。

### 2026-08-03 · 0.5.45 / 0.5.46 / 右键设封面诊断探针

- 0.5.45 增加 Service Worker 启动心跳（`aarre:sw-heartbeat`）与右键菜单点击日志（`aarre:context-menu-debug`），从本地 storage 读取确认事件链路；0.5.46 在 `handleContextMenuImageCover` 每一步写 `aarre:image-cover-debug` 分步日志。实测结论见 0.5.47 记录。

### 2026-08-03 · 0.5.44 / 右键图片设封面：入口立即反馈 + 全程超时定位卡点

- **用户实测。** 0.5.43（FileReader 已修复）重载后点击“用此图片设为封面”仍完全无反馈（连“正在下载图片…”都不出现），且确认页面已收藏、图片无防盗链、Chrome 中仅一个扩展实例（`ppjmhone`，路径与 manifest 正确）。
- **定位手段。** 无法直接调试生产 Service Worker，改为把反馈前移到事件入口：点击菜单立即显示“正在处理…”，处理过程分步更新徽标（检查收藏 → 下载图片 → 处理图片 → 完成），并用 `Promise.race` 给整个流程加 60 秒超时，任何 await 挂起都会超时报“处理超时，请重试”；异常继续显示具体错误文案 6 秒。
- **验证。** typecheck 与 335 项测试通过；cloud-enabled 0.5.44 构建（带 key）通过。下一步由用户重载后实测：若徽标出现“正在处理…”说明事件链路正常（卡点可定位）；若仍完全无反应，则需用户打开 `chrome://extensions` 的 Service Worker 检查视图看启动错误。

### 2026-08-03 · 0.5.43 / 右键图片设封面：FileReader 不兼容 Service Worker 的根因修复

- **用户实测反馈。** 已收藏、无防盗链的图片，点击“用此图片设为封面”后完全无反馈、封面不变——排除了 0.5.42 修复的未收藏/菜单注册/防盗链因素。
- **根因。** `blobToDataUrl` 用 `FileReader.readAsDataURL` 转换图片；`FileReader` 是 Window 专属 API，Manifest V3 Service Worker 全局不存在，`new FileReader()` 直接抛错（或转换永不完成），handler 在图片转换步骤终止：成功徽标不出现、封面不写入。
- **修复。** 新增 `src/lib/image-cover.ts`：`blobToDataUrl` 改用 `blob.arrayBuffer() + btoa` 分块拼接（SW 可用），GIF 与非 GIF 两条路径共用；background 导入该模块。新增 3 项单测（GIF 类型、无类型回退、200KB 多块数据）验证 base64 输出正确。
- **验证。** typecheck 与 335 项测试通过（60 个文件）；cloud-enabled 0.5.43 构建（带 key）通过。真人浏览器右键流程待用户重载后最终验证。

### 2026-08-03 · 0.5.42 / 右键图片设封面“没反应”的修复

- **根因。** 三个叠加因素：① 未收藏页面被 `handleContextMenuImageCover` 直接拒绝（“当前页面尚未收藏”），而错误只显示在工具栏徽标上 2 秒，用户几乎看不到；② 右键菜单只在 `onInstalled` 注册，MV3 Service Worker 若在异步注册链完成前结束，菜单会丢失且失败被静默吞掉；③ 部分图片站点防盗链（无 referrer 时返回 403）。
- **修复。** 未收藏时自动收藏当前页到书签栏（`chrome.bookmarks.create` + `importNativeBookmarks`）再设置封面，徽标提示“已收藏并设为封面”；菜单注册抽为 `registerContextMenus()`，`onInstalled` 与 `onStartup` 双保险，失败写 `console.error`；`fetch` 携带 `referrer: tab.url`；封面相关徽标（进行中/成功/失败）延长到 6 秒。
- **验证。** typecheck 与 332 项测试通过；cloud-enabled 0.5.42 构建（带 key）通过。真人浏览器右键流程待用户重载后实测。

### 2026-08-03 · 0.5.41 / 右键图片设为封面支持 GIF 动图

- **需求。** 用户要求在“用此图片设为封面”中允许 GIF：封面保留动画效果。
- **实现。** `image/gif` 分支直接保存原始 GIF data URL（不经过 `createImageBitmap`/OffscreenCanvas 转码，避免只取第一帧且丢动画），15 MB 大小限制与保护规则校验保持不变；其余格式继续缩放 1600px 转 WebP。服务端 `extensionForMime` 对 GIF 只影响对象扩展名（webp），`mime_type` 原样入库，上传与下载链路均无需改动。
- **验证。** typecheck 与 332 项测试通过；cloud-enabled 0.5.41 构建（带 key）通过。GIF 动效与动画封面展示待真人浏览器验证。

### 2026-08-03 · 0.5.41 / 书签标题改为头像 + 固定文案

- **用户反馈。** 0.5.40 的“用户名 的书签”标题过长（`Arven wang (Nefish)` 被截断），要求不显示用户名，改为在“我的书签”前显示头像。
- **修改。** 登录后标题为圆形头像 + “我的书签”（22px 圆形，Google 头像；无头像时用邮箱/Chrome 账号首字母占位），整行仍可点击进入账号与同步设置；未登录显示纯文字“我的书签”。移除用户名与截断样式，新增 `.native-title-avatar` 样式。
- **验证。** typecheck 与 332 项测试通过；cloud-enabled 0.5.41 构建（带 key）通过。

### 2026-08-03 · 0.5.40 / 书签标题账号入口 + 右键图片设为封面

- **标题账号入口。** 侧边栏“我的书签”在登录后显示“用户名 的书签”（取 Google 账号名，`native-title-account` 按钮样式继承标题排版，超长截断），点击直接 `setPanelView("settings")` 打开账号与同步设置；未登录保持“我的书签”。
- **右键图片设为封面。** 新增 `image` 上下文菜单项“用此图片设为封面”：点击后先校验当前页已收藏与隐私保护规则（复用截图封面的同一套检查），再下载图片（仅 http/https、≤15 MB、30 秒超时），用 Service Worker 原生 `createImageBitmap + OffscreenCanvas` 缩放到最长边 1600px 并转 WebP 0.88，写入 `thumbnailDataUrl` + `coverUpdatedAt`，badge 提示“封面已更新”，并立即 `syncNow()` 上传云端（不等 5 分钟定时任务）。原“更新封面”（整页截图）菜单不变。
- **验证。** typecheck 与 332 项测试通过；cloud-enabled 0.5.40 构建（带 key）通过，产物含新菜单文案与云端地址。右键图片设封面属于真人浏览器交互，待用户重载后实测（含跨域图片、受保护页面拒绝、超大图限制）。

### 2026-08-03 · 0.5.39 / 云端图片全量恢复下载 + 同步按钮状态文案

- **真实现象。** 用户重载 0.5.38 同步后界面显示“同步完成：图片 41/41”，与服务器 391 张不一致；且完成态按钮仍显示“暂停同步”。根因：`restoreCloudAssets(maxDownloads=24)` 每轮最多下载 24 张，而同步流程只调用一次（41 = 24 下载 + 17 本地上传），本地并未拿全云端图片。
- **修复。** `syncNow`、`syncAfterExplicitCloudSettings`、登录恢复三处入口对 `restoreCloudAssets` 增加循环直至 `remaining=false`；恢复下载逐张计入 `assetProcessed`（含已存在跳过项与过期图标），进度文案“图片 X/Y”实时反映恢复进度。按钮文案改为：同步中“暂停同步”，完成/空闲“关闭同步”，关闭“开启同步”（“暂停”实际为关闭云端同步，云端数据保留）。
- **验证。** typecheck 与 332 项测试通过；cloud-enabled 0.5.39 构建（带 key）通过。用户重载后再次同步应看到图片进度持续增长到 391/391，本地快照/封面补齐。

### 2026-08-03 · 0.5.38 / 409 张图片资产恢复 391 张，构建机制强制云端版本

- **恢复过程。** 409 个被删资产的主/灾备 COS 对象已物理删除；恢复源为 10:16 的旧 ID 本地备份（`~/Documents/Aarre-Recovery/aarre-legacy-extension-data-kplepc/`）。由于 Chrome IndexedDB 的 leveldb 使用自定义 comparator 且 64KB 日志块，标准库无法打开；改用手写解析器（log fragment 拼接、table 块结构、LevelDB crc32c + mask）与字节级提取，从备份中获得 391 张完整图片。
- **配对恢复。** 先用 sha256 精确匹配恢复 133 张；其余采用多重锚点配对（value 内 `canonicalUrl`/`host` 字段 + `thumbnailDataUrl`/`imageDataUrl`/`iconDataUrl` 字段、resourceKey 定位、服务器解密 binding 取 host），共恢复 **241 张**（201 URL 法 + 28 resourceKey 法 + 19 host 法，含 4.92 MB），全部经 COS 上传 + 数据库记录更新（sha256/byte_size/object_key/cos_version_id）落库；配对算法用 150 张 ready 记录验证（149 命中）。最终 active 391 张、6.55 MB，deleted 仅剩 19 张（快照存于未备份的 Chrome `.blob` 外部文件，字节已丢失，Chrome 亦判定 irrecoverable）。
- **构建门。** `scripts/build.mjs` 强制云端配置，缺失即拒绝构建；`.env.production` 提交为默认配置（`AARRE_CLOUD_RELEASE=1` + `VITE_AARRE_API_BASE_URL=https://sync.nexvoice.cc`），任何环境裸构建都是云端版。验证：无环境变量 `npm run build` 自动读 `.env.production` 产出 cloud-enabled 0.5.38；typecheck 与 332 项测试通过。
- **收尾状态。** 用户 Chrome 当前仍加载无 key 的 0.5.37（旧 ID 恢复载体），正式 0.5.38 dist 已构建（带 key）；用户重载回正式版并重新登录后，`kplepc` 临时白名单可移除。恢复材料（服务器 `/tmp/aarre-restore`）待最终验证后清理。

### 2026-08-03 · 0.5.37 / 图片上传对账：云端缺图却显示“同步完成：图片 0/16”的根因修复

- **真实现象。** 用户 0.5.36 开启完整备份后显示“同步完成：0/0 条收藏，图片 0/16”，云端容量 1012 KB。实测生产库：assets 表 409 条全部 `deleted`、active 为 0（曾上传 122 封面 + 209 快照 + 78 站点标识，约 6.5 MB，之后被整体删除，删除时间与旧版“文字与设置”范围切换的资产清理吻合）；本机 `aarre:cloud-asset-state` 残留“已上传”标记。
- **根因。** `uploadAsset` 发现本地标记中 sha256 相同就直接返回“跳过”且不计数；云端资产被删除后本地标记没有失效，重新开启完整备份时 16 个图片全部被误判为“已上传”，任务直接标记完成，实际云端 0 张可用图片。
- **修复。** `syncCloudAssets` 每次上传前先请求 `GET /v1/assets`（只返回 active 资产）与本地标记对账，服务器已删除的标记立即失效并写回存储，强制重新上传；对账后仍确认在云端的图片也计入 `assetProcessed`，进度显示真实结果。新增 `cloudAssetIdentity` / `reconcileCloudAssetState` 纯函数与 3 项测试。
- **验证。** typecheck 与 332 项测试通过（59 文件）；cloud-enabled 0.5.37 构建与 JS 语法检查通过；扩展 ID 不变，无需改服务器白名单。用户重载 0.5.37 后“暂停→开启同步”应看到图片重新上传至 16/16，并可在服务器 assets 表确认 active 恢复。

### 2026-08-03 · 0.5.36 / 同步设置精简：只有完整备份，界面只留同步进度与配额

- **产品调整。** 取消“文字与设置 / 完整备份”两种范围，产品只保留完整备份：`getCloudSyncSettings()` 与 `saveCloudSyncSettings()` 一律返回/写入 `scope: "complete"`，读取时把旧的 `text` 存储迁移为 `complete`（新增迁移测试）；`SAVE_CLOUD_SETTINGS` 消息与后台 handler 收口为只传 `enabled`，云端旧 `text` 范围在恢复设置时也不再被采纳。
- **界面精简。** 侧边栏同步区删除范围切换 Tab、所有说明文字、本地数据总量、本地上传进度/估算、扫描用量区块；只保留同步进度（收藏与图片合并计数 + 进度条，`resourceTotal + assetTotal` 为总数，失败计入进度，每秒刷新）和“云端容量：已用 / 配额”一行。账号区保留邮箱/状态/退出，暂停/继续按钮保留，错误与成功提示保留。隐私页“可选的跨设备同步”文案改为只有完整备份。相应 CSS（provider-help、usage-summary、cloud-upload-progress）已清理。
- **验证。** `npm run typecheck` 与 330 项测试全部通过（含新增 text→complete 迁移用例）；cloud-enabled 0.5.36 构建与 JS 语法检查通过，产物中已无旧文案；manifest key 保留（扩展 ID 不变，无需再动服务器白名单）。真人 Chrome 重载后的界面复看待用户验收。

### 2026-08-03 · 0.5.35 / manifest 固定扩展身份，解决多机登录白名单问题

- **真实故障根因。** 用户在第二台电脑（本仓库 `WorkSpace/Coding/Aarre` 路径）点击登录出现 “Authorization page could not be loaded.”。已解压扩展的 ID 由目录绝对路径派生：本机路径 ID 为 `kplepcclbgdifiilkkbhammlmjijlkgi`，而生产服务器 `ALLOWED_EXTENSION_IDS` 登记的是旧路径 `/Users/nefish/Desktop/Coding/Aarre` 派生的 `ohhmoipbedndbffmbpdkaoplojdefcak`。`/v1/auth/google/start` 对未登记 ID 返回 403，Chrome 授权窗口收到错误页后即报 “Authorization page could not be loaded.”；用白名单 ID 走同一接口可正常 302 到 Google 登录页，排除网络与 OAuth 客户端问题。
- **修复。** 生成 RSA-2048 身份密钥，公钥写入 `public/manifest.json` 的 `key` 字段，扩展 ID 固定为 `ppjmhonejgpcdmjmcbbdjookgiagambm`，任何电脑任意路径加载（0.5.35 构建）均为同一 ID；私钥仅存本机 `~/Documents/Aarre-Recovery/aarre-extension-identity.pem`（0600，不进 Git），未来如需轮换身份从该私钥重新导出公钥即可。
- **兼容与回退。** 旧 ID 的 Chrome 本地数据（Local Extension Settings + IndexedDB，约 13 MB）已备份到 `~/Documents/Aarre-Recovery/aarre-legacy-extension-data-kplepc/`；换 ID 后旧实例数据仍留在磁盘，加载不带 key 的旧构建即可恢复视角。生产白名单计划保留 `ohhmoip...` 直到全部测试电脑升级到 0.5.35。
- **验证。** 构建前先以 Chrome 已确认的路径-ID 对照（`kplepc...`）校准了 ID 推导算法，再从公钥 DER 计算新 ID 一致；cloud-enabled 0.5.35 构建、JS 语法检查与公网 start 端点验证通过（新 ID 登记后 302 到 Google）。各电脑 `git pull` 后重载扩展、重新登录与云端恢复仍待用户实测。

### 2026-08-03 · 0.5.33 / 服务端 0.1.9 同步契约、首次 metadata 与生产交接包

- **真实故障根因。** 用户已登录并选择同步，但 `usage-period` 客户端带有成本估算所需的 `priceUpdatedAt`，服务端 strict schema 未声明该字段，生产连续返回 400 `unrecognized_keys`。这不是登录失败，也不是用户操作错误。客户端现改为显式白名单序列化；服务端正式接纳 `YYYY-MM-DD` 价格表日期并继续拒绝其他未知字段。
- **首次同步不再把工作量绑在按钮上。** 显式范围选择立即保存并返回 UI，metadata/图片在后台分批推进；用户刚选的 scope 会先单独写云端，再恢复其他设备状态，避免旧的“文字与设置”覆盖新选的“完整备份”。从完整范围降到文字范围时先确认云端图片删除请求成功，再改变本地范围。
- **限流续传。** 真实首次同步暴露单分钟 240 次写入会在约 500 个资源/收藏实体中命中 429。服务端受控同步额度提高到 600/min，客户端解析并遵守 `Retry-After`，较大收藏库会继续分批而不是把限流错误直接显示给用户。
- **真实生产结果。** 0.1.9 已发布到 `/opt/aarre/releases/20260803-sync-rate-v27`，健康门通过。生产 HTTP 探针确认带 `priceUpdatedAt` 返回 200、下载 round-trip 保留字段、额外未知字段仍为 400；临时探针账号已删除。用户账号现有 262 资源、235 收藏位置、4 设置、1 月度用量和 1 设备；新容器日志显示批量请求持续 200。当前服务器保存的 scope 为文字同步，因此 0 图片资产不等于完整备份已经完成。
- **可交接运维包。** `ops/README.md` 与 `ops/cloud-production/` 统一记录账号/资源/权限、控制台入口、SSH、部署、回滚、备份、轮换和故障定位。Git 中的 AES-256/PBKDF2 恢复包现额外包含 SSH 私钥；口令、腾讯/Google 交互账号、MFA、Cookie 和 BYOK Key 明确排除。恢复包已重新生成，SHA-256、解密路径白名单和无明文残留验证通过；只读脚本确认 release、容器、0.1.9、8 migration / 26 表、四个 timers、HTTPS 和证书。
- **验证。** 根 `npm run check` 为 59 个测试文件 / 326 项，设计 token、TypeScript、生产构建和 JavaScript 语法全部通过；随后重新生成连接 `https://sync.nexvoice.cc` 的 cloud-enabled 0.5.33 `dist/`，API 域名只在 `background.js`。服务端在全新临时 PostgreSQL 库 22/22、typecheck/build/audit 0 通过，测试库删除。浏览器控制安全策略禁止直接打开 `chrome-extension://` 和 `chrome://extensions`，因此 0.5.33 的范围 UI 仍需用户手动重载后复看；服务端修复已经对现有 0.5.32 生效。

### 2026-08-02 · 0.5.32 / 服务端 0.1.7 公网云端与首次全量同步收口

- **DNS、TLS 与公开页面。** DNSPod 已新增 `sync A 43.161.230.52`（TTL 600）和 Google Search Console 根域 TXT 所有权记录，未修改其他 DNS；Caddy 已签发 Let's Encrypt 证书并强制 HTTP → HTTPS。`/`、`/privacy`、`/terms`、`/ready` 均公网 200，主页和政策页为无脚本自包含页面。
- **真实 OAuth。** Google app 已从 Testing 切到 In production，Search Console 域名所有权通过，品牌申诉已提交并处于审核中。真实浏览器完成 Google consent → 一次性 ticket → account/bootstrap → logout → revoked token 401；临时设备行已精确删除，保留 1 个空账号、0 设备、0 资源。
- **首次同步与保护修复。** 首次全量同步不再只看可跨账号遗留的本地 `syncStatus`，而是结合当前账号 bootstrap 返回的 revision 补种所有缺失资源。受保护资源会清理本机陈旧 Outbox；文件夹保护新增 `protection_rule_resources` 映射，服务端拒绝资源 JSON、bookmark-item 和 asset 复传，并清理已有资源、收藏位置、冲突和 COS 全版本。
- **生产发布与恢复。** v22 首次发布触发 PostgreSQL `08P01 invalid message format`，健康门拒绝上线并立即回滚 v21；后续只读对比确认 macOS tar 生成的 `._001_initial.sql` 等 AppleDouble 二进制伪文件被误当成迁移。v23 使用 `COPYFILE_DISABLE=1` 后成功上线；v24 在未带该环境变量的复核发布中精确复现并再次回滚。最终 0.1.7 同时加入 `.dockerignore`、迁移文件名过滤和逐条 SQL 解析，发布目录预检 0 个 AppleDouble 后以 v25 上线；容器健康，8 个迁移登记完整。手动日备成功（PG 16，55,376 B），容量探针通过，加密恢复包重新导出并通过 SHA-256，包与离线口令均为 mode 600。
- **验证。** 根 `npm run check`：59 个测试文件 / 323 项、设计 token、TypeScript、生产构建和 JavaScript 语法全部通过；服务端最终 21/21（含真实 PostgreSQL 文件夹保护、全新空库执行全部 8 个迁移和 AppleDouble 拦截）通过，根与服务端 production audit 均为 0。最终 `dist/manifest.json` 为 0.5.32，cloud API 只出现在 `background.js`，严格 secret 扫描通过。仍需用户在 `chrome://extensions` 手动重载并执行真实首次同步/卸载重装恢复；Google 品牌审核、正式 Web Store ID 和 50 账号负载验收仍未完成。

### 2026-08-02 · 0.5.31 站点标识通用 DOM 解码后备链路

- **特例边界核对。** 内置品牌资源表只有 GitHub 一项，`pinBrandAsset` 也只有 GitHub；0.5.29 的旧资产拦截只会让 GitHub / www.github.com / gist.github.com 在迁移失败时突然显示兜底，不会把其他站点的既有 icon 批量改成兜底。其他站点仍按规则表 → Apple Touch → 约定路径 → manifest → SVG / 大图 / Tile → 注册域回退的统一管线处理。
- **真实覆盖现状。** 最近一份严格同源 300 条真实书签基线中，160 条命中真实站点标识或页面图，140 条（46.67%）使用分类兜底；其中 28 条有候选但被质量闸门拒绝，112 条没有合格静态候选。该数字不是 0.5.31 的安装态重测，且未达到 PRD ≤12% 门，不能把通用覆盖率宣称为已达标。当前安装态失败记录还出现 `unsupported-ico-frame` 与浏览器后台无法解码图片，属于可修复的技术性假兜底。
- **通用修复。** 新增 Chrome 官方 Offscreen API 隐藏处理页。普通图片继续走原 Service Worker `createImageBitmap`；只有已下载、限长并完成静态 SVG 安全处理的资源在后台解码失败，或 ICO 最大帧不是现有解析器支持的 PNG 时，才交给 DOM 图像解码器。隐藏页不打开标签、不读取网页、不新增第三方请求；输出仍通过同一套 128px、1.2 方形比例、0.15 墨迹、透明 Alpha 和 192×192 WebP 门槛，不能用它绕过质量标准。
- **版本与验证。** Manifest 新增最小范围 `offscreen` 权限并打包 `icon-processor.html`；通用后备、消息目标隔离和响应配对有专项测试。`npm run check` 全通过：59 个测试文件 / 322 项测试、TypeScript、设计 token、0.5.31 生产构建和全部 JavaScript 产物语法检查成功。真实 Chrome 重载后的 Offscreen 解码与当前 261 条目录兜底分布仍是独立安装态验收门；已有失败站点需要重新运行一次“增强书签”才会按新管线重试。

### 2026-08-02 · 0.5.30 修复 GitHub 标识迁移后只显示兜底封面

- **安装态只读证据。** Chrome `Secure Preferences` 确认实际加载路径为本仓库 `dist/`，Service Worker 登记版本为 0.5.29 且具备 `<all_urls>`；对应扩展 IndexedDB 中的 GitHub 记录仍是旧 `https://github.com/apple-touch-icon-180x180.png`。因此不是用户漏重载或路径错误，而是 0.5.29 已拒绝旧图、却没有成功写入新图。
- **代码根因。** 自动迁移依赖 Manifest V3 Service Worker 现场抓取并解码远程 GitHub SVG；生成失败时 `refreshPinnedSiteBrandIcons()` 直接 `continue`，既不更新图标，也不保存失败原因，界面只能持续显示分类兜底封面。
- **正式修复。** 将同一 GitHub 官方 mark 预栅格化为 192×192 无损透明 WebP 并随扩展内置；GitHub 固定规则在启动、读取站点标识和全库扫描时直接使用该可信资源，不再依赖远程 SVG 临时解码。缓存身份仍登记为官方 SVG URL，既有迁移和云端防回灌规则保持有效；非 GitHub 站点的候选策略不变。以后固定品牌迁移失败会写入 `iconRejectReason`，不再静默丢失现场。
- **像素与构建验证。** 内置 WebP 为 192×192 RGBA，四角透明、深色圆环不透明、Octocat 负形透明；放在固定白色承载层上即为深色圆形 + 白色 Octocat。`npm run check` 全通过：57 个测试文件 / 318 项测试、TypeScript、设计 token、0.5.30 生产构建和全部 JavaScript 产物语法检查成功。真实 Chrome 仍需重载 0.5.30 后完成最后安装态复看。

### 2026-08-02 · F14 腾讯云生产底座部署、真实灾备与容量收口

- **腾讯资源已创建。** 正式主桶 `aarre-private-1251806841`（香港）与灾备桶 `aarre-backup-1251806841`（新加坡）均为私有、版本控制、SSE-COS AES-256；主桶仅允许当前固定扩展 origin，灾备桶无浏览器 CORS。主桶 `users/` 跨地域复制已启用。`aarre-production-api` 与 `aarre-production-backup` 两个无控制台 CAM 子账号使用独立密钥和最小权限策略，API 身份实测不能调用 CAM 管理接口。
- **全版本权限修复。** 真实容量探针暴露 `GetBucketObjectVersions` 不能授权到对象路径。按腾讯云官方六段式资源改为专用桶 `/*`，并用 `cos:prefix` 限制 `users/` 与 `backups/database/`；重新实测写入、AES-256、香港→新加坡复制、历史版本列举和 `DeleteMultipleObjects` 永久清除全部通过。两轮失败探针留下的 6 个临时对象版本已精确删除并确认剩余 0。
- **生产服务。** 独立 API、`aarre_sync` database/role、8 个 migration、Caddy site block 和 systemd timers 已部署；API 健康并仅监听 `127.0.0.1:8788`。root-only `/etc/aarre` 为 mode 700，`aarre.env`、`api-cam.env`、`backup.env` 与 provision state 均为 mode 600；长期 API 不加载 backup CAM。
- **加密决策。** KMS 基础/标准版已停止新购、专业版固定成本不适合 Alpha，当前账号 SSM 也需额外购买；没有勾选、购买或开通 KMS/SSM。COS 使用 SSE-COS AES-256，数据库仍逐用户 DEK + AES-256-GCM；DEK 由服务器 root-only 的版本化 KEK keyring 包装。服务器 secrets 已导出为 `/ops/encrypted-secrets/aarre-production-secrets.tar.gz.enc`，AES-256/PBKDF2 加密、SHA-256 与解密目录验证通过；恢复口令在 macOS Keychain 和 `~/Documents/Aarre-Recovery/` mode 600 文件中。
- **灾备缺陷与修复。** 首次备份使用 PostgreSQL 17 client 对 PostgreSQL 16 服务端生成 dump，隔离恢复因 `transaction_timeout` 不兼容失败。镜像现固定 PGDG PostgreSQL 16 client，并在备份/恢复两端强制校验 dump/source/restore/target major。新日备 SHA-256 校验后已完整恢复：6 个 migration、25 张表、0 用户，临时库随后删除并确认不存在；新月备同样成功。旧不兼容备份在台账标记 failed 后从 COS 全版本永久删除，剩余有效日备/月备合计 103,092 B。
- **容量实测。** 当前 Mac 有效云端投影仍为 5.17 MiB。生产公开登录尚未完成，云端账号数为 0；Aarre database 8.39 MiB、主桶 0 B、灾备桶两版本约 100.7 KiB、API 41.75 MiB。服务器约 2.35 GiB 可用内存、42.42 GiB 可用磁盘，不需要扩容或新购存储；Docker 约 1.63 GiB 可回收构建缓存不属于用户持久数据。
- **Google OAuth。** 已创建 `Aarre Production` Google Cloud project、外部 Testing consent app 和 Web client；只登记 `https://sync.nexvoice.cc/v1/auth/google/callback`，没有 JavaScript origin；当前 Google 账号是唯一 test user。按用户明确授权只勾选了 `I agree to the Google API Services: User Data Policy.`，未勾营销或其他可选项。client secret 通过 mode 600 临时文件写入服务器后，临时文件已删除且未输出。
- **健康巡检与错误监控（该阶段基线）。** 当时不可变发布为 `20260802-f14-v18`，现已由本页顶部记录的 v25 取代。systemd 每两分钟检查一次 Aarre readiness，失败时只重启独立 Aarre API；正向巡检成功。Fastify 日志删除 OAuth query 和 Authorization，错误 SDK 禁止默认 PII、trace、breadcrumb 与 HTTP/Fastify request integration。GlitchTip 已创建独立 `aarre` team、`Aarre Sync API` project 和 5 分钟内 1 个事件邮件告警；受控生产事件真实入库并标记 Resolved。DSN 只进入 `/etc/aarre/aarre.env` mode 600 与重新导出的加密恢复包。
- **最终自动化。** 根 `npm run check` 为 57 个文件 / 317 项测试，0.5.29 构建与全部 JavaScript 语法检查通过；根和服务端依赖审计均为 0。服务端类型检查/构建通过，并在生产 PostgreSQL 实例的隔离临时库完成 15/15 测试，测试库随后删除并确认不存在。无效 OAuth state 返回 400，探针 secret 不进入日志。
- **历史阻塞（已解决）。** 当时无法访问管理 `nexvoice.cc` 的 DNSPod 账号；本轮用户登录正确账号后已完成 A 记录、TLS、Search Console 所有权和公开 OAuth。当前剩余门以本页顶部 0.5.33 记录为准。

### 2026-08-02 · F14 腾讯云生产开通：身份核验与首个外部阻塞

- **身份与安全。** 已从 NexVoice 正式恢复材料确认生产 SSH key 可用；加密包本身不包含腾讯云 CAM/DNSPod 密钥。进一步在生产容器只读核验发现现有 ASR 身份实际是腾讯云 Root，能够调用 STS/CAM，但这是 NexVoice 的高风险遗留：Aarre 不复用该长期身份，只用它一次性创建独立最小权限用户；本轮不擅自轮换 NexVoice Root key，避免中断现有语音服务。
- **正式资源脚本。** 新增 `server/src/cli/provision-tencent.ts`：显式确认后幂等创建香港主 COS、新加坡灾备 COS、版本控制、SSE-KMS、CORS、生命周期、跨地域复制、SSM KEK、API/backup 两套无控制台 CAM 身份与策略，以及 DNSPod A 记录；Secret 只写服务器 `/etc/aarre` mode 600 文件，不在 stdout、日志或仓库出现。SSM 策略资源 ARN 已修正为包含 `creatorUin`，COS 策略补齐 multipart 操作。
- **验证。** 新脚本类型检查和 Docker build 通过；服务端 11/11 测试在临时 PostgreSQL 数据库通过，随后测试库已删除；生产主机已构建 `aarre-sync:20260802-f14-v2`，源码位于 `/opt/aarre/releases/20260802-f14-v2`，但 API 容器尚未启动。
- **真实腾讯状态。** 当前账号 STS 身份为 Root，CAM 之前为 0 子用户/0 自定义策略。第一次运行只创建了空的私有桶 `aarre-private-1251806841`（香港）并开启版本控制；默认 SSE-KMS 的 PUT 返回 COS `InternalError`，读取确认加密配置并未落地，灾备桶、CAM、SSM、DNS 也尚未创建。KMS `GetServiceStatus` 在香港/新加坡均为未开通；SSM 创建真实凭据返回 `ResourceUnavailable.NotPurchased`。Chrome 的腾讯云控制台仍停在登录页，必须由用户先完成扫码/验证码登录，再购买按量 SSM 并确认 COS 云产品密钥路径；绝不能为绕过阻塞把对象或数据库降级成明文。
- **成本边界。** 公开资料显示 KMS 基础版已停止新购，不能为 Alpha 误购高价专业版。目标仍是 SSM 按量单凭据 + COS 云产品默认密钥；若控制台表明必须购买 KMS 专业版，则必须停下重新评审，不能直接下单。

### 2026-08-02 · F14 腾讯云完整同步代码与容量计划落地

- **扩展侧。** 新建真实 OAuth/Token、REST 同步、持久 Outbox、完整 bootstrap + sequence 增量、文字/完整备份范围、COS 直传/懒恢复、账号切换隔离、稳定收藏位置与保护规则重绑定、主题/设置/会话/报告/用量/操作历史同步。云端默认关闭；没有显式生产 API 构建变量时账号入口显示未配置。
- **冲突与保护。** 资源写入携带 `baseRevision`。两台设备并发修改备注/用户标签时，服务端将两份内容作为 AES-GCM 密文写入 `conflict_versions`，标签先合并集合，备注不静默覆盖；侧边栏和网页端编辑器提供三种真实解决动作。受保护资源客户端停止读取/AI/截图/上传，服务端同时拒绝旧设备写入并排队清理主/灾备 COS 全版本。
- **服务端与灾备。** `server/` 为独立 Node 22/Fastify 5 服务，含五组 SQL migration、Google OAuth broker、随机 Token rotation/replay revoke、逐用户 DEK + 腾讯云 SSM KEK、严格 payload 白名单、配额、COS 两阶段资产、账户导出/删除、备份/隔离恢复、短命高权限 deletion worker、独立 Compose/Caddy/systemd/CAM 模板。长期 API 不加载备份 CAM。
- **容量实测。** 当前 Chrome Default 账号为 262 条 URL、16 个文件夹、261 条有效 Aarre 资源；当前有效云端投影 5,422,378 B（5.17 MiB），主数据预算 7–9 MiB，含香港主桶、新加坡副本、版本和 DB 备份为 15–25 MiB。当前无需新购存储服务器；扩容只使用腾讯云，阶段与触发器见 `docs/CLOUD_CAPACITY_PLAN.md`。
- **验证。** 根 `npm run check` 全通过：设计 token、TypeScript、57 个测试文件 / 310 项测试、0.5.25 生产构建和 JavaScript 产物语法检查成功；商店素材验证通过，根/服务端依赖审计均为 0。服务端 11 项测试通过，其中 9 项使用真实 PostgreSQL覆盖跨用户隔离、幂等、Token 重放、字段时钟、冲突、保护、配额、资产和删号，另 2 项结构测试强制在线用户 SQL 带 `user_id` 且 HTTP 用户数据路由先鉴权。目标腾讯云香港服务器隔离 Docker 构建成功，镜像约 313MB、运行用户为 `node`，随后已删除验证镜像和临时目录；本机 40MB Chrome 审计临时副本与 `aarre_sync_test` 测试库也已删除。`dist/manifest.json` 为 0.5.25，未包含生产 API 域名或 secret-like 内容；云端发行缺 API URL 时构建门会按预期拒绝。
- **仍未上线。** 缺正式 Extension ID、Google OAuth Web Client、`sync.nexvoice.cc` DNS/TLS、Aarre 独立 API/backup CAM、香港主 COS、新加坡灾备 COS、SSM 凭据和真实 COS/重装/联合恢复演练。未获这些外部资产与计费授权前，不创建资源、不启动生产容器，也不把本地测试说成线上可用。

### 2026-08-02 · 0.5.26 修复缓存图片内部被改黑并隔离夜间主题

- **安装态截图证据。** DevTools 中选中 `img.site-thumbnail-image` 后，计算样式已经明确是 `background-color: rgb(255, 255, 255)`；用户标出的黑色色块属于 `color: rgb(23, 25, 28)`，不会绘制图片背景。当前黑块因此不来自列表、CSS 承载层或夜间主题，而是在 `src="data:image/webp;base64,..."` 的缓存图片内部。
- **直接根因。** 用当前真实 GitHub manifest 512×512 图标跑同一 `normalizeSiteIconPixels()` 后精确复现截图：旧逻辑把每一个与白色承载层对比不足的像素单独改为 RGB 24，导致图标内部的白色圆形负空间也被改黑，输出 36,864 个像素全部不透明、`inkCoverage = 1`，最终成为带微弱轮廓的黑方块。这和候选选择无关，也不是 `color-scheme` 把 CSS 底色切黑。
- **通用修复。** 候选来源和顺序完全不变。像素处理改为保留原始颜色与 Alpha；遇到覆盖整个方形资产的中性深色展示底时，仅剥离外围托底并保留被浅色/彩色图形包围的深色 Logo；只有整张可见图形确实几乎都是浅色单色时才整体转深，禁止再逐像素改黑内部白色区域。`.site-thumbnail` 增加 `color-scheme: only light`，`--site-icon-canvas` 仍只定义一次且固定为 `#FFFFFF`。
- **缓存与云端防回灌。** `SITE_ICON_RENDER_VERSION` 提升到 6，使已生成的版本 5 黑底 WebP 自动失效并进入正常站点标识扫描；云端站点 icon 上传绑定当前渲染版本，恢复时拒绝把缺版本或旧版本资产重新标成最新版。
- **验证。** 真实 GitHub 资产修复后 36,864 个像素中 21,125 个恢复透明，WebP 编码工具确认 `Features present: transparency`；内部白色区域和黑色 Logo 均保留。针对性 3 个测试文件 / 37 项、完整 57 个 Vitest 文件 / 312 项、设计 token、扩展与服务端 TypeScript、服务端 2 项无数据库结构测试、生产构建和 JavaScript 产物语法检查通过；暗色预览构建中承载层仍为白色，`dist/manifest.json` 为 0.5.26。服务端其余 9 项集成测试因本机按前序收口已删除 `aarre_sync_test` 而未运行，不涉及 icon 修复。真实 Chrome 安装态仍需重载最新 `dist/` 并执行一次“更新站点标识”。

### 2026-08-02 · 0.5.25 恢复透明 icon 与固定白色承载层

> 本节的固定白色 CSS 承载层继续保留，但其中“逐像素浅色对比度补偿”会把图标内部白色区域改黑，已由 0.5.26 的整体图形判断取代；后续不得恢复该逐像素逻辑。

- **历史根因。** Git 历史确认：统一 UI 重构提交 `7e58563` 把旧版 `.site-thumbnail { background: #fff; }` 改成了主题化 `var(--surface-sunken)`；提交 `6c4cad8` 又新增浅/深两份预合成缓存和按深色偏好选择的 `<picture><source>`。因此黑色托底来自样式/渲染迭代，而不是站点 icon 候选选择。
- **按产品语义恢复。** 保持 `scanSiteBrand` 原有候选顺序不变；撤回 0.5.24 的候选重排与深色边缘拒绝逻辑。站点 icon 缓存重新保留 Alpha，只有浅色前景的对比度补偿会修改前景 RGB，透明像素的 Alpha 始终保持；`SiteThumbnail → picture → site img` 三层统一继承不随主题变化的白色承载层。
- **缓存迁移。** `SITE_ICON_RENDER_VERSION` 提升到 5，淘汰此前所有已经烘焙过白底或黑底的缓存；0.5.23 的缺图扫描候选修复继续负责重新生成。
- **验证。** 针对性 3 个测试文件 / 35 项通过；透明缓存单测确认空白像素仍为 `[0,0,0,0]`，黑色图标像素保持不透明。暗色侧边栏用真实透明 SVG 复核：页面背景为 `[15,17,19,255]`，图标承载层四角和透明区域均为 `[255,255,255,255]`。设计 token、TypeScript、排除工作区既有 Node 原生测试入口后的 57 个 Vitest 文件 / 310 项测试、生产构建和 JavaScript 产物语法检查全部通过；构建 CSS 明确为 `.site-thumbnail → picture → site img` 三层继承白色背景，`dist/manifest.json` 为 0.5.25。真实 Chrome 安装态仍需重载最新 `dist/` 并执行一次“更新站点标识”。

### 2026-08-02 · 0.5.24 不透明深色 icon 托底根因与通用修复

> 本节记录的候选排序与深色边缘质量闸门已在 0.5.25 完整撤回；用户确认选择策略原本正常，当前实现不得沿用本节方案。

- **真实根因。** 用户截图中的黑块严格位于缩略图图片区域。源码和构建 CSS 的 `.site-thumbnail` / `img[data-cover-kind="site"]` 均已是 `#FFFFFF`；对实际被选中的 180×180 图标取样后，四角为 `[34, 30, 32, 255]`，说明图片文件虽带 Alpha 通道，边缘却是 100% 不透明深色像素，下面的白色托底不可能透出。反复清缓存和扫描只会重新写回同一类黑底候选。
- **通用修复。** 候选排序改为站点声明的透明/矢量 SVG优先，其次是站点声明的大尺寸位图，再到 manifest、Apple Touch 和猜测路径；新增不透明深色边缘质量闸门，颜色平坦、深色且边缘 90% 以上不透明的候选会被拒绝并继续尝试下一候选，找不到安全候选则使用 Aarre 兜底图。没有修改 GitHub 专属来源规则。
- **缓存迁移。** `SITE_ICON_RENDER_VERSION` 从 3 提升到 4，旧的黑底生成缓存会在加载站点标识时被清除；0.5.23 的缺图扫描候选修复继续生效，随后“更新站点标识”可重新生成。
- **验证。** 针对性 3 个测试文件 / 37 项通过；真实页面探针确认旧 180px 候选命中 `opaque-dark-edge-mat`，页面声明候选为 SVG/大图，新排序为 `svg-icon → large-icon → conventional-apple-touch-icon`；透明 SVG 合成后的四角为 `[255,255,255,255]`、墨迹覆盖 0.4387。设计 token、TypeScript、排除工作区既有 Node 原生测试入口后的 57 个 Vitest 文件 / 312 项测试、生产构建和 JavaScript 产物语法检查全部通过，`dist/manifest.json` 为 0.5.24。真实 Chrome 安装态仍需重载最新 `dist/` 并重新执行一次“更新站点标识”。

### 2026-08-02 · 0.5.23 旧 icon 缓存清理后的自动恢复

- **根因。** 0.5.22 的通用缓存迁移会清除旧的站点 icon 字节，让界面安全地显示兜底图；但全目录扫描候选过去只检查摘要、封面和链接健康，没有检查站点 icon 是否缺失。因此“更新站点标识”可能估算为 0 条，刷新后仍会一直显示兜底图。
- **修复。** `thumbnail.ts` 新增统一的当前 icon 缓存新鲜度判断；`libraryScanCandidates` 将没有当前 `iconRenderVersion`、没有白底 icon 或已超过 30 天的站点加入扫描；`scanSiteBrand` 与候选判断共用同一门槛。没有加入任何 GitHub 专属设置。
- **恢复方式。** 重新加载 0.5.23 的 `dist/` 后，在设置中点击“更新站点标识”；若第一次只显示待处理数量，按界面继续确认并开始，按提示允许网页读取权限，等待任务完成。不要删除扩展数据。
- **验证。** 针对性测试 3 个文件 / 35 项通过；`npm run typecheck` 通过；排除工作区既有 Node 原生测试入口 `server/test/integration.test.ts` 后，55 个 Vitest 文件 / 306 项测试、生产构建和 JavaScript 产物语法检查通过。直接运行 `npm run check` 只因 Vitest 误收这个无 Vitest suite 的 Node 测试文件失败，未涉及本次 icon 逻辑。真实 Chrome 安装态仍需用户重载最新 `dist/` 后复看。

### 2026-08-02 · 0.5.22 站点 icon 黑色背景通用链路修复

- **调查边界。** 用户已明确这不是 GitHub 单站点问题；源码中的 GitHub 专属来源改动已撤回，不把任何站点规则作为解决方案。
- **通用修复。** [base.css](src/ui/base.css) 将 `.site-thumbnail` 的基础底色从主题 `surface-sunken` 改为固定白色 `--site-icon-canvas`；透明 SVG/PNG 即使没有命中图片分类，也不会再透出暗色主题。 [thumbnail.ts](src/lib/thumbnail.ts) 的页面代表图在 WebP 编码前使用 `destination-over` 铺白底，避免透明画布携带黑色 RGB 通道。
- **验证。** `npm run check` 全通过：55 个测试文件 / 305 项测试、设计 token、TypeScript、生产构建和全部 JavaScript 产物语法检查；修复后的 `dist/` 已同步到 0.5.22。源码和构建产物均未加入 GitHub 专属来源设置。
- **待完成门。** 真实 Chrome 安装态仍需重新加载最新 `dist/` 复看；自动化本地运行态与构建检查不能替代真人安装态确认。

### 2026-08-02 · 云端 PRD v1.3 与 NexVoice 共机评估

- **完整恢复边界。** F14 从“只同步派生元数据”升级为同步全部有用户价值的持久信息，并通过私有 COS 保存用户封面、页面快照、页面代表图和站点标识；图片范围必须由用户明确选择，受保护资源始终禁止上传。
- **真实共机基线。** 已只读核对 NexVoice 源码、生产 compose/Caddy/PostgreSQL 和腾讯云主机资源；确认目标为香港 `ap-hongkong-2`、Docker 网络 `production_default`，当前余量支持独立 256MiB `aarre-api`。不允许把 Aarre 路由塞入 NexVoice `control-api` 作为退化方案。
- **隔离与恢复。** Aarre 使用独立 database/user、secrets、CAM、KMS、对象桶和错误上报 project；新增 sequence change feed、字段级冲突、两阶段对象上传、重装恢复、导入器、账户删除、联合备份恢复与 RPO/RTO 验收。Google 登录经官方流程复核后改为服务端 Web OAuth callback + 扩展一次性 PKCE ticket，避免把 Google callback、code 或 Token 直接交给扩展。
- **仍未完成。** 本轮只调整需求和架构边界，没有创建 `server/`、数据库、COS 桶、OAuth 客户端、DNS 或生产部署。`docs/ARCHITECTURE.md` 已加历史架构警示，F14 实施时再整体改写其云端章节。
- **验证。** `git diff --check` 通过；`npm run check` 全通过：设计 token、TypeScript、55 个测试文件 / 303 项测试、生产构建和全部 JavaScript 产物语法检查均成功。

### 2026-08-02 · 0.5.20 旧站点 icon 缓存不再进入显示层

- **显示门禁。** 侧边栏和网页端不再直接使用 `iconDataUrl` 兼容字段；只有 `iconRenderVersion === 3` 且存在当前白色画布 `iconDataUrlLight` 的记录才允许进入 `<img>`。
- **缓存清理。** `GET_SITE_BRANDS` 返回前清除旧版本已经生成的 `iconDataUrl`、`iconDataUrlLight`、`iconDataUrlDark` 字节，但保留 host、来源、尺寸、分类和页面图规则等诊断字段；下一次站点扫描会重新生成白底图。
- **验证。** `npm run check` 全通过：55 个测试文件 / 303 项测试、设计 token、TypeScript、生产构建和全部 JavaScript 产物语法检查；`dist/manifest.json` 已同步到 `0.5.20`。真实 Chrome 安装态仍需重新加载 `dist/` 复看。

### 2026-08-02 · 0.5.19 站点 icon 固定纯白画布

- **产品规则。** Aarre 页面与侧边栏仍支持日间/夜间主题；站点 icon 不参与主题切换，透明图标始终合成到 `#FFFFFF` 纯白画布，夜间界面也保持白底。
- **显示层。** 删除 `brandImageUrlDark`、系统/应用主题观察器及全部深色图标传参；`SiteThumbnail` 只读取白色画布版本。CSS 增加固定 `--site-icon-canvas`，不会在暗色 token 中覆盖。
- **生成与缓存。** `cacheSiteBrandIcon` 从浅/深双份 WebP 收敛为单一白底 WebP；新增 `SITE_ICON_RENDER_VERSION = 2` / `iconRenderVersion`，旧缓存下一次站点扫描时自动重建。旧 `iconDataUrlDark` 字段仅供 IndexedDB 兼容读取，不再写入新缓存或参与显示。
- **真实 GitHub 像素验证。** 读取 GitHub 官方透明 Octocat SVG，栅格化后走正式缓存生成函数；输出 192×192、render version 2，四角像素均为 `[255,255,255,255]`，且墨迹覆盖闸门通过。暗色 Aarre 运行态确认白色 icon 命中、深色画布命中 0、`source` 节点 0、CSS 画布值为 `#ffffff`。
- **验证。** `npm run check` 全通过：55 个测试文件 / 301 项测试、TypeScript、设计 token、生产构建与 JavaScript 产物语法检查；版本与最新 `dist/` 均为 `0.5.19`。`docs/PRD.md` 的透明图标规则、数据字段和验收标准已同步改为固定纯白画布。

### 2026-08-02 · 0.5.18 双端允许共存与站点图标主题修复

> 本节的双端共存行为继续有效；其中“图标跟随 Aarre 主题”的方案已在 0.5.19 改为固定纯白画布。

- **撤销全部互斥。** 删除关闭全部侧边栏、关闭网页端标签、网页端标签级禁用、标签激活协调和后台工具栏点击接管；侧边栏打开网页端只负责新建或聚焦管理页，网页端与侧边栏可以同时存在。
- **恢复 Chrome 原生打开。** `openPanelOnActionClick` 改回 `true`，点击扩展图标由 Chrome 原生行为打开侧边栏；右键收藏和显式 `OPEN_SIDE_PANEL` 仍只负责打开侧边栏，不再关闭网页端。移除 `sidePanel.close()` 后不再需要 Chrome 141，最低版本恢复为 134。
- **黑色图标根因。** `SiteThumbnail` 过去用系统 `prefers-color-scheme` 选择图标版本；当系统偏好深色、Aarre 手动设为浅色时，会把预合成在 `#242426` 深色画布上的 GitHub 等透明图标放进白色列表。现在改为跟随 Aarre 根节点的 `data-theme`，现有浅色缓存可直接恢复，无需重新扫描。
- **主题性能。** 新增共享 `useDocumentTheme` 外部存储，整页所有缩略图共用一个 `MutationObserver`；切换 Aarre 主题会更新图标，但不会为数百个列表项创建数百个观察器。
- **验证。** `npm run check` 全通过：55 个测试文件 / 301 项测试、TypeScript、设计 token、生产构建与 JavaScript 产物语法检查；模拟“系统深色 + Aarre 浅色”时运行态确认根主题为 light、浅色图标命中、深色 `<source>` 为 0；`npm run ui:audit -- 列表` 为 0 项。源码、Manifest 与 `dist/manifest.json` 均为 `0.5.18`。

### 2026-08-02 · 0.5.17 扩展图标始终打开侧边栏

> 本节记录的是历史实现；其中“打开侧边栏后关闭网页端”的互斥行为已在 0.5.18 按产品决定完整撤销。

- **点击行为。** 删除网页端点击扩展图标时的直接返回；无论当前是普通网页还是 Aarre 网页端，工具栏图标都会触发真实 `sidePanel.open()`。
- **网页端切换。** 当前标签是网页端时使用窗口级侧边栏打开，成功后关闭网页端标签；这样不会因移除作为打开目标的标签而连带关闭侧边栏，同时继续保证网页端与侧边栏不并存。
- **旧状态修复。** 网页端标签不再设为 `enabled: false`，并在协调时显式恢复 `enabled: true`，清理旧版本可能遗留的标签级禁用状态。
- **验证。** `npm run check` 全通过：55 个测试文件 / 301 项测试、TypeScript、设计 token、生产构建与 JavaScript 产物语法检查；`package.json`、源码 Manifest 和 `dist/manifest.json` 均为 `0.5.17`。真实 Chrome 安装态仍需重载扩展复看。

### 2026-08-02 · 0.5.16 受保护网页/文件夹与侧边栏互斥

> 本节记录的是历史实现；其中所有网页端/侧边栏互斥代码已在 0.5.18 撤销，受保护规则本身保留。

- **保护数据模型。** 新增本地 `aarre:protection-settings:v1`：网页按资源身份显式保护，文件夹按 Chrome 文件夹 ID 保护；实际操作前基于当前 Chrome 树动态计算后代，不会漏掉以后新增或移动进文件夹的收藏。同一网页有多个 Chrome 位置时采用最严格规则，任一受保护位置都会保护共享资源。
- **统一执行边界。** 正文读取、自动增强、页面截图、批量补拍、链接健康/全目录扫描和 AI 对话 provider 目录都复用同一保护策略。开启保护会取消相关持久增强任务和即时截图目标，并停止正在运行的 AI 收藏对话；批量扫描、重定向和截图在网络/截图提交前后继续复核，避免规则切换后的旧任务落库。关闭保护后，仍缺内容的收藏只恢复为“首次正常访问后继续”，不会立即后台开页扫描。
- **两端共用 UI。** 侧边栏与网页端编辑收藏共用 `ProtectionControl`；侧边栏编辑文件夹也使用同一控件。上级文件夹继承状态不可在子项绕过，文案明确说明关闭位置；开关尺寸、间距、色彩均使用共享 token，明暗主题编辑场景控件审计均为 0 项。
- **网页端/侧边栏互斥。** 关闭 Chrome 自动处理的 `openPanelOnActionClick`，改由后台接管工具栏点击；当前是 `manager.html` 时直接不打开侧边栏。侧边栏打开网页端会新建或聚焦已有管理页标签，并调用 `sidePanel.close()` 关闭所有窗口的侧边栏；管理页标签同时通过 `sidePanel.setOptions(... enabled: false)` 禁用侧边栏。反向打开侧边栏后会关闭后台管理页标签，保证两套主界面不同时存在。
- **兼容性与验证。** 因 `sidePanel.close()` 从 Chrome 141 开始提供，`minimum_chrome_version` 已从 134 提高到 141。`npm run check` 全通过：55 个测试文件 / 301 项测试、TypeScript、设计 token、生产构建和 JavaScript 产物语法检查；新增保护继承、并发持久化、AI 目录过滤、补拍过滤和双端互斥防回归测试。localhost 实测开关可从关闭切到开启并显示完整保护说明，浅色/深色编辑场景 `ui:audit` 均为 0 项。真实 Chrome 安装态仍需重载最新 `dist/` 验证 Side Panel API 行为。

### 2026-08-02 · 网页端瀑布流卡片淡描边与投影收口

- `.library-card` 保持无投影，`.library-card-cover-frame` 使用主题化透明度描边（浅色黑色 6%、深色白色 6%）并移除投影；封面内层仍保留独立裁切，不影响悬停详情和圆角封面。
- 删除不再使用的 `--shadow-cover` token，并同步更新布局回归测试。
- 验证：`npx vitest run tests/manager-layout-stability.test.ts tests/control-system-guardrails.test.ts` 通过（2 个文件 / 31 项）；`npm run typecheck` 和 `npm run build` 通过，最新样式已写入 `dist/`。真实 Chrome 安装态仍需用户重载最新 `dist/` 复看。

### 2026-08-02 · 0.5.15 真实 Provider 验证与 localhost AI 去伪

- **发现并移除假链路。** localhost 的 `SAVE_AI_SETTINGS` 过去只检查 Key 字符长度，`ASK_BOOKMARK_AGENT` 则固定返回“设计赏析与前端代码”及 269/269，导致看似验证成功、实际完全没有调用 Provider。现在预览设置会真实访问服务商模型接口，Key 只保留在当前预览内存；对话直接复用生产 `askBookmarkAgent`，并把真实阶段事件送回 UI。取消会终止对应的真实 `AbortController`。
- **真实 DeepSeek 基线。** 新增 `npm run verify:ai-live`，只从临时环境变量读取 Key，不把凭据写入仓库或报告。真实 `deepseek-v4-flash` 实测：Key 校验 235ms；单条增强 10.552s，八类元数据完整且 schema=2；40 条普通问答 2.620s，正确召回 GitHub；125 条全量检索 4.560s，3 批全部检查并 4/4 召回预埋组件库；取消 1.739s 内返回“AI 请求已停止”。成功调用累计记录 26,104 tokens。
- **真实 UI 证据。** 修复后的 localhost UI Key 校验约 1.0s；普通查询只显示“准备 → 筛选 → 生成”，DeepSeek 网络请求约 2.3s并正确显示 GitHub 来源；全量查询显示“正在检查收藏 0/309”，最终为“已检查 309/309”，命中 National Geographic，7 个 Provider 请求全部 HTTP 200，完成状态在 12.55s 内观测到；运行中停止按钮在 637ms 内恢复为可继续输入状态。
- **防回归。** 新增预览 AI 集成测试，断言设置必须调用真实模型校验接口、对话必须经过真实 Provider 代码路径、来源映射与阶段序列真实；不再允许写死答案回归。`npm run check` 全通过：53 个测试文件 / 294 项测试、TypeScript、设计 token、生产构建和 JavaScript 产物语法检查均通过；`npm run ui:audit -- AI` 为 0 项，版本和 `dist` 已同步到 `0.5.15`。
- **边界。** 本轮真实 Provider、真实网络和真实 UI 预览均已验证，但 localhost 使用评审数据，不等于用户真实 Chrome 收藏；浏览器控制策略拒绝接管扩展内部页，因此安装态 Service Worker、真实目录和 Gemini/OpenAI 仍是独立验收门。测试 Key 曾进入聊天上下文，必须在服务商控制台轮换。

### 2026-08-02 · 0.5.14 AI 能力全面审计与可用性修复

- **召回根因。** 新增的使用场景、内容类型、可能提问、实体和 schema 版本过去会在 IndexedDB 读取、Chrome 原生书签重建、Aarre 保存和 URL 迁移时丢失或错误沿用；现在统一通过一个检索字段复制契约持久化，新 URL 会明确清空旧页面的 AI 字段，旧 schema 记录进入一次增量补全而不会无限重复计费。
- **全量与快速查询。** “所有/全部/整个/全量”等请求按 60 条分批、3 批并发检查全部可用收藏，任何批次失败都不合成半截回答；全量筛选为空时不再用普通模糊匹配把无关收藏填回来。快速查询不再显示“分批检查收藏”，前端只渲染后台声明的真实阶段与真实完成事件。
- **稳定性。** Agent 与增强结构化输出分别提高到合适上限并在格式不完整时只重试一次；OpenAI 改用当前 `max_completion_tokens` 参数，provider 的 429/5xx 只做一次短重试；API Key 验证增加 15 秒网络边界和可见错误。增强失败会落为 `failed`，无 Key 保持“等待增强”，全目录扫描遇到整批 Key/额度错误会停止而不是继续打完整个目录。
- **隐私与安全。** 对话检索复用截图/增强的敏感网址规则，受保护资源和对应操作目标在 provider prompt 构造前删除；UI 显示排除数量，隐私页补齐实际发送字段说明。AI 修改仍只生成待确认 proposal，真实写入前继续做目标校验、撤销快照和逐项结果记录。
- **状态与界面。** 相关收藏按钮去掉默认固定高度并使用自动高度，标题/域名恢复显示；设置页的 Key 保存和扫描错误改为模块内联反馈，AI Key 字段进入真实 form，可回车提交；编辑收藏能区分分析中、等待增强、失败、暂不可用和受隐私保护。
- **数据与历史。** 并发 provider 调用的用量写入改为串行合并，有限配额会在调用前串行复核；历史会话过滤损坏记录、限制持久化长度，失败/取消消息不再回灌给下一轮模型。
- **验证。** `npm run check` 全通过：Node/设计 token、TypeScript、52 个测试文件 / 293 项测试、生产构建和全部 JavaScript 产物语法检查均通过；`npm run ui:audit -- AI` 为 0 项。本地 Playwright 在 565×1055 复核来源卡片文字与高度、输入后黑底白图标发送按钮和设置成功反馈；`package.json`、源码 Manifest 与 `dist/manifest.json` 均为 `0.5.14`。真实 Chrome 安装态和真实 provider Key 端到端仍需用户重载最新 `dist/` 后验收。

### 2026-08-02 · 0.5.13 AI 状态控件中性色收口

- 停止按钮改为 `--ink` 黑色背景，停止方块使用实心 `currentColor` SVG 图形。
- 已完成的 AI 状态图标移除青绿色，改为中性色；状态行间距从 `--sp-1` 拉开到 `--sp-2`，提高读取舒适度。
- 验证：针对性侧边栏布局测试、类型检查和设计 token 检查通过；版本与 manifest 同步到 `0.5.13`。

### 2026-08-02 · 0.5.12 首屏骨架、瀑布流阴影与 AI Agent 状态链路

- **侧边栏首屏。** 原因是 React 首次挂载前 `sidepanel.html` 没有可见内容，同时 React 还要等待持久状态与初始化请求；现在 HTML 先绘制静态品牌骨架，React 初始化期间继续显示同一套骨架，避免 2–3 秒纯白窗口。原生 Chrome 书签读取仍先于本地索引和增强信息，不把慢索引挡在首屏前。
- **瀑布流投影。** `.library-card` 与新的 `.library-card-cover-frame` 允许阴影向外绘制；内层 `.library-card-cover` 单独负责封面和 hover 内容裁切，避免外层卡片和封面同时裁掉投影。
- **AI 对话。** 每次请求有独立 request id；后台按「准备收藏库 → 分批检查收藏 → 筛选相关内容 → 整理并生成回答」发送真实进度事件。输入框在运行中变为停止按钮，停止会 AbortController 贯穿到 provider fetch；重载后遗留的 sending 会话会恢复为可重试的已停止状态。
- **全量查询可靠性。** 全量查询仍会检查完整目录，任意批次失败不会合成半截答案。模型返回被代码围栏/简短说明包裹的 JSON 可自动提取；只有 JSON 格式或字段不完整时最多重试一次，API、额度和网络错误不重复消耗请求。
- **验证。** `npm run typecheck`、`npm run check:design`、51 个测试文件（当前新增到 279 项）、`npm run build` 和 `dist` JavaScript 语法检查通过；本地 Playwright 确认提交后 50ms 仍有侧边栏骨架、约 300ms 进入书签列表，且瀑布流外框 `overflow: visible`、内层封面 `overflow: hidden`。真实 Chrome 安装态仍需用户重载最新 `dist/` 后复看；本地运行态不能替代 Service Worker/Performance 现场日志。

### 2026-08-02 · 0.5.11 AI 对话 UI 与收藏库全量检索

- **网页端卡片。** 日间管理页背景恢复为 `#FFFFFF`；每个瀑布流封面使用共享 `--shadow-cover`，以 4% 墨色、较大模糊范围提供非常淡的悬浮感。
- **AI 对话 UI。** 历史会话标题和预览允许多行并截断，改名/删除动作回到同行布局；用户气泡不再被默认段落 margin 撑高；相关收藏卡片左对齐且长标题省略；输入后发送按钮图标仍保持亮色。重复形状和间距使用 `--agent-*` token。
- **全量检索。** 对“找/搜/查询/相关”以及批量修改类请求，目录按每批 60 条、最多 3 批并发逐条检查；所有批次成功后才进行最终回答合成，返回的 `examinedCount` 为真实全量数量，UI 显示为“已检查 N/N”。任何批次失败都会终止本次回答，不返回半截结果；普通非全量请求会明确显示“已召回”。
- **验证。** `npm run typecheck`、`npm run check:design`、`npx vitest run tests/local-ai.test.ts`（13 项）和 `npm run check` 已通过；完整回归为 51 个测试文件、276 项测试，生产构建和 `dist` JavaScript 语法检查均通过，版本文件与 `dist/manifest.json` 为 `0.5.11`。侧边栏浅色/深色控件审计均为 0 项问题；真实 Chrome 安装态仍需用户重载最新 `dist/` 复看。

### 2026-08-02 · 0.5.10 瀑布流 hover 信息收口与网页端浅色底色

- **信息收口。** 收藏库卡片 hover 遮罩删除标签/匹配原因与更新时间，只渲染收藏描述；没有描述时仍使用既有的真实状态提示，不伪造内容。
- **样式清理。** 删除标签与日期元信息对应的布局规则，保留遮罩的整面覆盖、内部滚动和不改变瀑布流卡片高度的行为。
- **背景 token。** 网页端日间整体背景由 `#FCFCFC` 调整为 `#FAFAFA`，只作用于管理页的 `--page-bg-light`，卡片表面、侧边栏和夜间模式保持原样；后续 0.5.11 已恢复为白色。
- **验证。** 运行态确认遮罩只有一个描述段落，`time` 和标签元信息节点均不存在，网页端浅色背景为 `rgb(250, 250, 250)`；`npm run check` 通过（51 个测试文件、275 项测试、类型检查、设计 token、生产构建和全部 JS 产物语法检查），`dist` 已刷新为 `0.5.10`。

### 2026-08-01 · 0.5.8 网页端无轨悬浮滚动手柄与浅色底色

- **滚动条替换。** 管理页隐藏 document 的系统滚动条，新增不占布局宽度的 fixed 悬浮手柄；手柄无滑轨，滚动/悬停时出现，停止操作后渐隐，并支持鼠标/触控拖拽、键盘方向键、PageUp/PageDown、Home 和 End。
- **主题范围。** 仅网页端日间模式的页面底色改为 `#FCFCFC`；侧边栏和网页端夜间模式继续使用原主题底色。滚动手柄颜色从现有墨色 token 派生，明暗主题均保持可见对比度。
- **防回归与验证。** 新增网页端滚动手柄结构回归测试；本地运行态确认系统滚动条为 `none`、页面宽度不因手柄变化、实际拖拽能改变滚动位置、闲置后透明度归零；浅色/深色网页截图已复核。`npm run check` 通过（51 个测试文件、275 项测试、类型检查、设计 token、生产构建和全部 JS 产物语法检查）；明暗两套 `npm run ui:audit` 均为 0 项问题；`package.json` 与 `dist/manifest.json` 已同步为 `0.5.8`。真实 Chrome 安装态仍需用户重载最新 `dist/` 后复看。

### 2026-08-01 · 0.5.7 compact button 高度 token

- **高度 token。** 新增 `--control-h-button: 30px`，所有 `.button-small` 统一使用 30px 高度；没有直接把 `--control-h-md` 从 36px 改掉，因此输入框、Select 和其它中等控件继续保持原有尺寸。
- **层叠修正。** 将 compact button 规则放在按钮变体之后，覆盖 `.button-quiet` 等变体原本的 40px 最小高度；“暂不”和“去处理”运行时实测均为 30px。
- **验证与构建。** `npm run check` 通过（51 个测试文件、274 项测试、类型检查、设计 token、生产构建和全部 JS 产物语法检查）；浅色/深色 `npm run ui:audit` 均为 0 项问题；最新 `dist/manifest.json` 与源码版本为 `0.5.7`。

### 2026-08-01 · 0.5.6 圆角阶梯系统与编辑操作布局

- **圆角 token 化。** 在 `tokens.css` 增加 `--radius-shell`、`--radius-module`、`--radius-control`、`--radius-inset-module`、`--radius-compact` 和 `--radius-chip`；共享 Button、Select/菜单形状和主要外层模块改用语义 token，避免同一层级直接复用外层圆角。
- **嵌套场景收口。** 整理提示卡片内的“暂不/去处理”、设置“最近的更改”条目内的“撤销”按钮统一降到控件档；“这会儿值得重看”既有外层/内层阶梯关系保留；运行时扫描其它主要页面，仅保留搜索框内胶囊按钮这一有意例外。
- **编辑操作。** 侧边栏编辑弹层的“取消/保存修改”按钮补齐间距；侧边栏与网页端关闭按钮从 44px 触控容器收回到 32px 透明容器，图标继续居中，位置更靠右上角。
- **验证。** `npm run check` 通过（51 个测试文件、274 项测试、类型检查、设计 token、生产构建和全部 JS 产物语法检查）；浅色/深色 `npm run ui:audit` 均为 0 项问题；浅色/深色关键截图已复核；本地 `sidepanel.html` 与 `manager.html` 继续返回 200。版本文件与 `dist/manifest.json` 同步到 `0.5.6`。

### 2026-08-01 · 0.5.5 编辑弹层分隔线/关闭按钮与 Chrome 星标自动增强核查

- **编辑弹层线条。** 去掉网页端编辑弹层标题下、AI 分析模块顶部和底部操作区顶部的分隔线；侧边栏共用的 AI/操作区同步生效。
- **关闭按钮。** 网页端和侧边栏关闭按钮统一扩大到触控尺寸，取消背景和描边，保留透明点击区域与无障碍标签。
- **整理提案对齐。** “仅提示 · 不自动执行”的信息图标增加与标题文字一致的上内边距，和复选框的视觉对齐方式统一。
- **Chrome 星标行为核查。** `chrome.bookmarks.onCreated` 会为当前新建的网页收藏登记本地资源并排入 AI/封面任务；若当前活动页仍是该网址且已配置 API Key，会读取真实渲染页面并异步生成摘要/标签，首张封面截图静默执行。无 Key、页面不可读取、隐私保护页面、批量导入/Chrome Sync 或书签创建时不在当前页时，不会后台猜测或批量开页，而是等待配置或用户首次正常访问；全目录 AI 仍需用户显式启动扫描。
- **验证。** `npm run check` 通过（51 个测试文件、273 项测试、类型检查、设计 token、生产构建和全部 JS 产物语法检查）；编辑弹层浅色/深色 `npm run ui:audit -- 编辑` 均为 0 项问题；`sidepanel.html` 与 `manager.html` 本地返回 200，`dist/manifest.json` 与源码版本均为 `0.5.5`。版本文件递增到 `0.5.5`。

### 2026-08-01 · 0.5.4 编辑收藏字段层级收口

- **去掉重复位置信息。** 单个 Chrome 收藏不再显示“收藏位置 / 根目录”静态信息；文件夹选择保留为唯一的原生位置编辑入口。重复收藏仍保留必要的副本选择器，但不再额外显示位置标题。
- **隐藏主题。** 编辑弹层不再显示 AI 主题。主题是 AI 独立生成的语义字段，继续供报告、主题图谱和重新发现使用，不会因用户删除自定义标签而被错误改写。
- **标签去标题。** 自定义标签区域去掉可视标题，仅保留标签芯片、删除操作和添加输入；两端继续共享同一个编辑字段组件。
- **验证。** 暗色主题重新拍摄侧边栏和网页端编辑弹层，字段结构一致；单个收藏不再渲染重复位置、主题或标签标题，重复收藏仍保留副本选择器；`npm run check` 通过（51 个测试文件、272 项测试、类型检查、设计 token、生产构建和全部 JS 产物语法检查）。版本文件和 `dist/manifest.json` 已同步到 `0.5.4`。

### 2026-08-01 · 0.5.3 编辑弹层统一与侧边栏层级/状态样式修复

- **文件夹缩进根因。** 上一轮只把 `--tree-depth` 应用到文件夹行，普通书签行仍使用 `padding-left: 0`；现将层级变量接到普通书签行的左内边距，子项实际增加 24px。
- **编辑弹层统一。** 新增共享 `BookmarkEditorFields` 与共享 `buildBookmarkEditorModel`。侧边栏和网页端现在都显示收藏位置、名称、网址、文件夹、AI 分析、主题、自定义标签和备注，并统一使用 `UPDATE_BOOKMARK_DETAILS` 保存原生字段与 Aarre 元数据；重复 Chrome 收藏位置也可在两端选择。
- **夜间编辑按钮。** 新增 `--cover-action-bg/ink` 主题 token，网页端卡片右上角编辑按钮在暗色模式使用亮色背景和深色图标，不再被封面遮罩压成黑块。
- **网页端兜底封面。** 40 张本地 Aarre 兜底图现在在 4:3 瀑布流封面中使用 `object-fit: contain`，完整保持封面高度；左右留白使用当前封面自己的强调底色（来自封面资产基准色），不再露出管理页中性色。真实页面截图仍保持原来的铺满裁切和 hover 放大。
- **状态与重新发现。** 所有设置状态胶囊左右内边距收敛为 12px；编辑弹层状态和封面补拍状态同步采用 12px；「这会儿值得重看」条目默认使用 `--surface`，与外层 `--surface-sunken` 保持相近但可辨识的底色。
- **验证。** 侧边栏运行态确认子项 `padding-left: 24px`、编辑保存可回读备注；暗色主题确认编辑按钮背景为亮色；运行态确认兜底图为 `contain`、384×384 资产在 4:3 容器中保持高度、底色分别落为资产对应的 RGB 值；`npm run check` 通过（51 个测试文件、272 项测试、类型检查、设计 token、生产构建和全部 JS 产物语法检查）；`npm run ui:audit` 浅色列表与深色收藏库相关场景均为 0 项问题。版本文件递增到 `0.5.3`。

### 2026-08-01 · 0.5.2 侧边栏样式走查收口

- **目录层级。** 文件夹内书签的缩进刻度从 20px 调整为 24px，文件夹与子项的层级关系更清楚。
- **普通搜索。** 无结果时只保留「没有找到相关收藏」，去掉排序/AI 解释文案和 AI 配置按钮；普通搜索不再把 AI 配置当成前置条件。
- **历史会话。** 去掉底部「最多保留 50 个会话」的内部实现说明，保留用户真正需要的空状态说明。
- **图标密度。** 侧边栏普通列表和搜索结果的书签缩略图统一为 42×42px。
- **主题与标签。** 本轮不改数据模型：主题用于较高层的报告、趋势、图谱和重新发现；标签用于具体检索和用户编辑。截图里主题与标签出现同名属于生成/展示去重问题，后续可单独做去重策略。
- **本地走查。** `npm run dev` 持续提供 `http://localhost:5173/sidepanel.html` 与 `http://localhost:5173/manager.html`；`npm run ui:audit -- 列表` 为 0 项问题，`npm run ui:shots -- panel library` 已重拍两端关键状态。
- **验证。** `npm run check` 通过（51 个测试文件、271 项测试、设计 token、TypeScript、生产构建和全部 JS 产物语法检查）；版本文件同步到 `0.5.2`。

### 2026-08-01 · 0.5.1 侧边栏首屏 loading 与 AI 引导卡片修复

- **首屏顺序。** 侧边栏直接读取并渲染 Chrome 原生书签树；`GET_LOCAL_RESOURCES` 只在后台 fire-and-update 完成本地 IndexedDB 全量索引同步。此前后者逐条处理书签时会让 `snapshot` 一直为空，用户只能看到长期 loading。设计预览仍回退到消息 mock，生产侧首屏不再依赖 Service Worker 的索引响应。
- **AI 引导卡片。** 未配置 API Key 时不再在收藏列表底部挂载「配置 AI 后可以直接问你的收藏」卡片；设置页仍是配置入口，已配置 AI 的输入框不受影响。
- **回归保护。** `tests/sidepanel-layout-stability.test.ts` 新增启动顺序与 footer 渲染断言，`tests/bookmark-tree.test.ts` 覆盖根目录排序和计数；版本文件递增到 `0.5.1`。
- **验证。** `npm run check` 通过（51 个测试文件、270 项测试、类型检查、设计 token 检查、生产构建和全部 JS 产物语法检查）；本地 `sidepanel.html` 运行态确认 setup card/loading 均为 0，侧边栏列表审计为 0 项问题。Chrome 安装态重载仍需真人复看。

### 2026-08-01 晚 · UI 收口（已构建 dist）

产品在预览里连续点名后完成，变更按 token / 控件系统落地，避免页面特例：

| 项 | 处理 |
| --- | --- |
| 设置页顶部提示条 | 主设置页不再渲染 `settings-notice`；扫描确认只留弹窗 |
| 设置「更多」 | 与分区同宽；`padding: var(--sp-3)`；`size="unstyled"` |
| 卡片 hover 遮罩 | `--scrim-cover` 冷暗色整面；去掉截断；遮罩内无滚动条滚动 |
| Select 焦点/菜单 | `--focus-ring` 脱离 accent；菜单 `radius-md` + `nested-md`；无黑色描边；高亮不从 0×0 飞入 |
| Elevated 浮层 | 默认 `border-border/60` 淡描边 |
| 网页端顶栏 | 去掉 `.manager-header` 底部分隔线 |

**验证：** 相关 layout / guardrail 单测通过；设计 token 检查通过；本轮结束时执行 `npm run build` 刷新 `dist/`。真机重载扩展后请重点看：文件夹下拉圆角与淡描边、卡片 hover 文案是否滚得完、设置页是否还有顶部提示、顶栏是否还有细线。

**暂勿并行修改：** `src/ui/tokens.css`、`src/lib/shape-context.tsx`、`src/lib/elevated.tsx`、`src/components/ui/select.tsx`、`src/ui/manager.css`、`src/ui/sidepanel/SidePanelApp.tsx`（设置页段落）——除非用户又提新需求。

### 2026-08-01 · 0.5.0 控件回归修复 + 本地对照环境

用户在真机上发现批次 0 之后仍有大量控件问题。本轮先修掉点名的五条，再用截图和运行时审计做了一遍系统性排查。`npm run check` 通过（51 个测试文件、263 项测试、类型检查、生产构建）。

**本地对照环境（用户明确要求）**

- `npm run dev` 已经能同时提供 `http://localhost:5173/sidepanel.html` 和 `http://localhost:5173/manager.html`，DEV 下自动装载 `preview.ts` 的 chrome mock，无需安装扩展。主题存在 `localStorage` 的 `aarre:theme`（`light` / `dark`）。
- 新增 `npm run ui:shots [场景…]`：用 Playwright 把两端驱动到难以手动复现的状态（行 hover、设置二级页、编辑弹窗、下拉展开、删除确认、键盘焦点、六个视图），逐张写到 `.shots/`（已 gitignore）。`SHOOT_THEME=dark` 切夜间。
- 新增 `npm run ui:audit [场景关键词]`：在 10 个场景 × 明暗两套主题下遍历所有控件，报告六类问题——高度不足 24px、文字被裁切、图标偏离中线、超出视口、整行按钮未撑满，以及 **hover 反色**。当前两套主题均为 0 项。
- hover 检测用 CDP 的 `CSS.forcePseudoState` 一次性给所有控件加上 `:hover`，再比较悬停前后的实际背景亮度：静止浅色而悬停近黑（夜间反之）判为反色，另外还看悬停后文字对比度是否掉到 3:1 以下。**这条规则做过反向验证**：把 `.bookmark-main` 的 `variant="unstyled"` 去掉后立刻报出 315 项，加回去归零，所以 0 项不是规则写空了。
- 写这个检测器时踩过一个坑：`getComputedStyle` 返回的颜色语法取决于作者怎么写，`color(srgb 1 1 1 / 0.78)` 的通道是 0–1 而 `rgb()` 是 0–255，正则抓数字会把白色读成黑色。最终改成把颜色画到 canvas 再读像素，这是唯一能覆盖全部语法的解析方式。

**hover 变黑的真正根因（点名问题 1）**

批次 0 把变体背景从内层挪到按钮元素上时，只考虑了静止态的层叠顺序。静止态确实是项目 CSS 胜出（旧类 unlayered、Tailwind 在 `@layer utilities`），但 `hover:bg-foreground/90` 编译出的是 `.hover\:bg-foreground\/90:hover`——**伪类选择器的特异性比同元素上的普通类高一级，跟层和源码顺序都无关**。于是所有没写 `variant` 的 `<Button>`（默认 `primary`）在鼠标移上去的一瞬间被刷成近黑，`.bookmark-main` 首当其冲。

- `Button` 新增 `variant="unstyled"` 与 `size="unstyled"`（两者都是空类名），用于外观由项目 CSS 负责的按钮。
- `src/ui/**` 里 71 个带项目类名的 `Button` 全部改用 `variant="unstyled"`（53 个原本没有 variant，18 个原本是 `ghost`）。原先靠 `ghost` 白蹭 hover 的四处（收藏库 tab、两个弹窗关闭键、`agent-action-drop`）在 CSS 里补了自己的 hover。
- 设计检查脚本的规则同步反转：从「禁止 variant 与旧类叠加」改为「带项目类名的 Button 必须是 `variant="unstyled"`」，判据是实际扫描 5 个 CSS 文件得到的类名集合，不是关键词猜测。`tests/control-system-guardrails.test.ts` 里有同一条断言。

**其余四条点名问题**

- **文件夹下拉（问题 2）**：卡片编辑弹窗里的两个 `FluidSelect`（原生 `<select>`）换成收藏库工具栏同款 `Select`，蓝绿描边、贴边箭头和系统菜单一起消失。同时 `FluidControls` 的焦点态从「accent 边框 + 2px accent 环」改成「`--line-strong` 边框 + 仅键盘焦点的 1px `--focus-ring` 环」——点一下输入框就镶一圈蓝绿是这一族控件共同的问题，不只是下拉。
- **设置「更多」排版（问题 3）**：`Button` 会把 children 包进带 `text-box: trim-both` 的 label span，那是个普通行内盒，于是「标题块 + 右侧箭头」被竖着堆起来。改成**只有字符串 children 才包 label span**，组合 children 直接放进 flex 行；同时把该行的负外边距调好，让标题与其他分区标题左对齐。
- **AI 分析多余说明（问题 4）**：删掉侧边栏编辑弹窗里那段「主题是 AI 归纳的…」，连同只为它存在的 CSS。
- **删除按钮图标未对齐（问题 5）**：同一处 label span 修复顺带解决——图标和文字过去被塞进同一个被 trim 过的行内盒里，基线自然对不上。

**顺带排查出来并修掉的问题**

- **夜间模式的遮罩和阴影是反的**：三处模态遮罩和全部阴影都写成 `color-mix(var(--ink) N%)`，而 `--ink` 在夜间是近白色，于是遮罩把页面照亮、阴影变成白色光晕。新增 `--shade`（固定深色）和 `--scrim-modal`，遮罩和 `--shadow-*` 全部改用它。
- **焦点环有两套**：`base.css` 里 `button:focus-visible` 画 2px `--ink 42%` 外框，共享 `Button` 又画 1px `--focus-ring` 内环。统一为 `--focus-ring`，并让 `[data-slot="button"]` 只保留组件自己那一个。
- **同一个标签芯片在两端是两套尺寸**：侧边栏 28px 芯片配 22px 圆形删除键、11px 图标；网页端 32px 芯片配 26px 圆角删除键、13px 图标。收敛成 `base.css` 里共享的 `.tag-chip` / `.tag-chip-remove`（新增 `--control-h-2xs: 22px`），两端各自的重复规则删除。
- **设置账号行的姓名和状态挤在一行**，且未登录时头像会拿「尚未连接」的首字「尚」当字母头像。改为姓名在上状态在下，没有真实账号就不渲染头像。修这条时误删了 `.settings-onboarding-section` 共享的 `space-between`，已在截图复查中发现并补回——这类共享规则改动必须复查所有共用它的选择器。
- **整理提案的恢复链接**只有 20px 行高，作为独立操作行给到 `--control-h-xs` 的点击高度。
- 编辑弹窗页脚三个按钮从「删除用 small、保存用默认」统一为同一档高度。
- **设置「更多」的箭头没有推到最右边**，是修完排版后复看截图才发现的：`.settings-more-button` 写了 `justify-content: space-between`，但 button 元素的 auto 宽度即使在 `display: flex` 下也仍然收缩到内容宽度，于是没有空间可分配。补 `width: 100%`，并把「整行按钮未撑满」加进运行时审计——这类「规则写了但不生效」的问题看代码是看不出来的。
- **编辑书签的「添加标签」按钮仍有错误 hover**：它没有自己的类名，却被祖先选择器 `.tag-entry button` 画成主按钮，同时 React 上仍写着 `variant="ghost"`；静止态与 hover 态分别由两套系统控制，实测甚至出现黑底黑字。改为具名的 `tag-entry-submit` + `variant="unstyled"`，明确补齐 enabled / hover / disabled 三态；网页端相同结构同步改为 `library-card-editor-tag-submit`。此前 guardrail 只识别按钮自身的项目类名，无法识别祖先选择器，现已为这两个提交按钮补专门回归测试。
- **点击位移**：共享 `Button` 曾对所有变体加 `active:scale-[0.98]`。宽列表行会明显往里缩，用户要求所有点击都不要位移。已从全部变体移除按压缩放，点击反馈只保留颜色变化。「这会儿值得重看」条目原先用 `ghost`，被锁成 36px 高，hover 白底把两行文字紧紧包住；改为 `unstyled` + 明确内边距与最小高度。
- **表单焦点绿框**：`FluidControls` 与 `Select` 触发器曾用 `--focus-ring`（accent 青绿）画一圈外环。已统一改为只加深自身描边；绿色焦点环只留给按钮等非表单控件的键盘焦点。
- **状态提示与列表融在一起**：侧边栏 `.native-notice` / `.native-error-layout`（含预览写入失败「设计预览不执行数据写入操作」）原先是面板网格里的平铺条，背景与列表同色。已移入内容框并绝对定位浮在列表上方，白底 + 描边 + `--shadow-float`，与网页端 toast 同角色。设置页内的 `settings-notice` 与整理建议横幅仍是各自场景的内联块，不改。
- **费用展示全面改为 token 用量**：扫描确认弹窗、首次引导粗估、设置「AI 用量」都不再出现 ¥ / 费用 / 人民币；统一为输入/输出 token。后台不再按费用上限拦截启动。内部仍可累计 `estimatedCostCny` 供以后需要，但界面不再展示。
- **预览点「更新站点标识」报 `chrome.permissions.contains is not a function`**：设计预览的 permissions stub 原先只有 `request`。已补 `contains`，并让 `requestPageSnapshotPermission` 在缺少 `contains` 时不再同步抛 TypeError。
- **设置页顶部提示条全部拿掉**：点「更新站点标识」、打开扫描确认、保存 API、导出等，都不再在设置内容区顶部刷一条 `settings-notice`（原先会压在弹窗背后当“背景字”）。确认信息只留在「开始前确认」弹窗里；引导页的错误提示保留。
- **设置「更多」条目布局**：去掉负外边距（避免往左偏、右边缺一块），补 `size="unstyled"`，并恢复与同类 title+chevron 行一致的 `padding: var(--sp-3)`；外框与分区同宽，文字/箭头不再贴边。已加 `sidepanel-layout-stability` 防回归。
- **收藏库卡片 hover 遮罩**：整面冷暗色 `--scrim-cover`（不要棕色/彩色）；去掉摘要截断，内容过多时在遮罩内无滚动条滚动；点击仍打开书签。
- **焦点环与下拉菜单（token 层）**：`--focus-ring` 不再绑 `--accent` 青绿，改为冷中性色；`--color-ring` 同步。Select 菜单壳用同心圆角 `radius-md`（14）+ `nested-md`（10）；高亮层仅在已知行矩形后挂载。菜单项 hover/键盘只走浅底高亮，不再画黑色 focus 描边。
- **网页端顶栏**：去掉 `.manager-header` 底部分隔细线。
- **下拉浮层描边**：`Elevated` 默认加与 Card 相同的淡描边 `border-border/60`，不再只靠阴影。

### 2026-08-01 · 0.5.0 系统性优化（七个批次已全部完成，待真机验证）

按 `Aarre 系统性优化` 方案分七个批次执行，本地检查为 51 个测试文件、251 项测试全部通过，构建成功。版本号已提升到 0.5.0。

**批次进度**

- [x] 批次 0 控件系统归一
- [x] 批次 1a 侧边栏删除书签
- [x] 批次 1b 网页端卡片修复
- [x] 批次 2 卡片重设计
- [x] 批次 3 设置页信息架构
- [x] 批次 4 性能
- [x] 批次 5a/5b/5c/5d AI 能力
- [x] 批次 6 防回归

**批次 1a 已完成内容。** 确认按钮改用 `.button-danger`（现在是红色），入口按钮改 `.button-danger-quiet`，实心红只留给真正执行删除的那一下。确认态与常态都收敛为同一行控件布局并锁 `min-height: var(--control-h-lg)`，切换确认不再改变弹窗高度。删除改为乐观更新：新增 `removedNodeIds`，`bookmarkRoots` 在派生时剪掉这些节点（搜索结果同源派生，一并消失），请求失败再回滚并报错。`startEdit` / `startCreateFolder` 补上 `setBusy("")`，消除「已删除的条目再次打开编辑时整片变灰」。

**批次 1b 已完成内容。** 去掉 `.library-card-cover` 的 `border`（描边只在直边可见，圆角处被放大 5% 的图片盖住，本来就是半截效果）。整卡改为单一点击目标：标题链接通过 `::after` 铺满卡片，编辑按钮 `z-index` 提到其上。批次 0 删掉背景层后，卡片编辑弹窗的黑块自动消失；另外把 16 处既没有 `variant` 也没有类名的 `Button` 显式标成 `variant="ghost"`，纯图标的补上 `size="icon-sm"`，避免它们默认落到实心深色 primary。

**批次 2 已完成内容。** 摘要与标签从「展开撑高卡片」改为「盖在封面上的遮罩」，用 `--scrim` 系列 token 保证在明暗主题下都是深底白字。hover 状态只过渡 `opacity`，卡片高度恒定，同列后续卡片不再位移。hover 反馈改为封面放大 1.05→1.09 加标题墨色加深，不再有描边变化；`.library-card-link:focus-visible::after` 提供键盘焦点环。

**批次 3 已完成内容。** 一级页从 7 个分区收敛到 3 个（AI 服务 / 显示 / 书签增强）加一个「更多」入口；最近的更改、重看引导、隐私与导出、Google 账号、AI 用量移入二级页，返回键在二级页先回一级。全目录扫描默认只剩「N/M 已具备 AI 元数据 + 状态标签 + 一个按钮」，进度条只在扫描进行中出现；预计时间、并发、估算费用和费用上限全部移进点击后的确认弹窗。

**批次 4 已完成内容。** 从四个入口做可达性分析，删除 21 个零引用组件与 hook（约 12,000 行）。framer-motion 的四处用法（tab 滑块、下拉展开、卡片 proximity 高亮、tooltip 淡入）全部改为纯 CSS 过渡，依赖已卸载，`src/lib/springs.ts` 随之删除。Supabase 客户端路径清理：删除 `supabase/` 目录、`src/lib/supabase.ts` 与 SDK 依赖，`auth.ts` / `cloud.ts` 保留原有导出签名但改为本地实现（后台的云端调用点本来就全部由 `AuthState.configured` 把守，行为不变），`scripts/build.mjs` 去掉 Supabase 域名注入分支。

首屏体积（未压缩）：`styles` chunk 193.53 → 67.85 KB，样式表 132.04 → 123.33 KB，`background.js` 150.58 → 146.85 KB。

**批次 5a 已完成内容。** `ResourceRecord` 新增 `useCases` / `contentType` / `questions` / `entities` 四类字段，两条增强路径（完整正文、批量扫描）共用同一份字段契约，`contentType` 必须落在 `src/lib/ai-fields.ts` 的白名单里，编造的类型会被丢弃而不是原样落库。新字段是增量的：模型漏答只是少几个字段，不会让整条增强失败。完整正文路径补上了此前只有批量路径才有的 H1/H2（`extract.ts` 新采集 `headings`，Readability 会把标题层级压平）和 URL 路径词。Gemini 路径补上 `systemInstruction`，与 OpenAI/DeepSeek 路径共用同一条注入隔离指令。

**批次 5b 已完成内容。** 四个新字段接入本地搜索索引，`questions` 权重 34 排在标题（30）之上——它保存的是「你以后会怎么问」的原句，标题往往对不上。召回从 Top-50 提到 Top-80，并改为两级上下文：前 20 条给完整字段（含场景、提问、实体），其余只给一行摘要，提示词上限相应从 12k 提到 16k，候选翻倍而 token 只小幅上升。

**批次 5c 已完成内容。** 新增 `update_metadata` 操作，可改标签、备注、摘要，只写 Aarre 本地存储、不碰 Chrome；撤销侧新增 `restore_metadata` 快照，`bookmark-undo.ts` 通过注入的写入函数完成恢复，自身仍不依赖存储层。语义批量操作通过 `group_label` 实现：模型为每个命中对象各生成一项操作并标注同一条筛选条件，确认卡按条件分组显示「命中 N 条」，每行可单独移除，整批仍是一个撤销单元。操作上限从 8 提到 40。

**批次 5d 已完成内容。** 「这条书签还欠一次 AI 调用」收敛为 `needsAiEnrichment()` 一处定义，保存路径、全目录扫描和存量补齐共用，避免三方对「算不算完成」有分歧而重复计费。存量补齐直接复用现有扫描任务：它本来就是分批（alarm 分块）、可中断（暂停/继续/取消）的；增量部分是扫描时传 `keepExisting`，只写入缺失字段，用户手改过的摘要不被覆盖，字段齐全的收藏根本不会进候选。设置页的「N/M 已具备 AI 元数据」也改用同一判定，所以升级后计数会明显下降——这是如实反映存量缺口，不是故障。

**批次 6 已完成内容。** 设计检查脚本从「只扫 5 个 CSS 文件」扩展到同时扫描全部 tsx：新增共享按钮类的 min-height 契约（必须用 `--control-h-*`，且不得写死 height）、同心圆角配对（嵌套元素不得与外层共用同一个 `--radius-*`，胶囊除外）、禁止 Button variant 与会上色的旧 CSS 按钮类叠加、旧修饰类必须挂基类、tsx 里的硬编码圆角/高度/色值和内联样式。脚本一次跑出的存量问题已全部修掉。新增 `tests/control-system-guardrails.test.ts` 覆盖三条方案点名的回归：删除确认两态同高、整卡单一点击目标（含焦点环与编辑按钮层级）、危险按钮用 `--negative` 而不是 `--ink`。

**需要你在真实 Chrome 里确认的**：重新加载扩展后，侧边栏删除书签是否即时消失、编辑弹窗没有黑块、设置页分段控件圆角正常；以及首次进入设置页时「已具备 AI 元数据」的计数下降属于预期，点一次全目录扫描即可增量补齐。工具环境无法访问扩展管理页，这一步只能由你完成。

**批次 0 已完成内容。** 根因是项目里有两套按钮系统叠在同一个元素上：React `Button` 会渲染一个绝对定位铺满的内层背景层（默认近黑），旧 CSS 类 `.button*` 又在同一元素上设背景，于是 `<Button className="button button-quiet">` 渲染成黑块。侧边栏靠一条 `[data-slot="button-background"] { background: transparent }` 兜底掩盖了它，网页端没有对应兜底所以露馅。

- **删除内层背景层**，变体背景直接画在 button 元素上；两处兜底规则（`sidepanel.css`、`manager.css`）随之删除。旧 CSS 类是 unlayered、Tailwind utilities 在 `@layer utilities`，因此旧类稳定胜出，两套系统不再互相覆盖。
- **新增危险色控件**：`Button` 增加 `danger` / `danger-quiet` 变体，`.button-danger` 背景从 `var(--ink)` 改为 `var(--negative)`，新增 `.button-danger-quiet`、`.text-button-danger`；`.agent-action-confirm-danger` 同步改红。`--negative` 此前从未被任何按钮使用过。
- **控件高度收敛为闭合刻度**：新增 `--control-h-xs/sm/md/lg/touch`（28/32/36/40/44），把散落的 30/34/38/42 全部并入最近档位。`.button`、`.button-quiet`、`.button-danger`、`.text-button`、`.icon-button` 均获得 `min-height`，杜绝塌陷成一条文字。
- **圆角建立嵌套关系**：新增 `--radius-nested-md/lg = 外层 − --sp-1`。分段控件（设置页 provider/cover tabs、管理页 report tabs）内层改用嵌套圆角，与 `--radius-md` 外壳同心。`shape-context` 的硬编码 `rounded-[20px]` 等全部改读 `--radius-*`。
- **修掉分段控件的双重指示器**：选中态此前同时由 CSS 背景和 `TabsSubtle` 的动效滑块绘制，两个圆角不同才出现 hover 变胶囊。现在滑块是唯一指示器，其圆角与底色由 `--tabs-pill-radius` / `--tabs-pill-bg` 控制，调用方在 CSS 里设定。
- 修复 `SidePanelApp.tsx` 中漏写 `button` 前缀的取消按钮。
- 验证：`npm run check` 通过（49 个测试文件、233 项测试）。`tests/sidepanel-layout-stability.test.ts` 的像素断言改为断言 token。

### 2026-08-01 · 0.4.9 三并发后台补拍与卡片编辑按钮交互收口

- **三并发补拍。** 批量补拍改为固定 3 个 worker，每个 worker 使用独立的后台静音标签页、资源游标、尝试次数和 lease；任务状态持久保存 workers，0.4.8 的单 worker 状态会在读取时兼容迁移。单个 worker 的截图、调试协议、页面超时或标签页关闭只影响该项，其他 worker 继续执行。
- **限流与资源边界。** 同一注册域名的导航启动使用 1 秒 DomainRateLimiter；最多同时保留 3 个补拍标签页和 3 个调试连接，不把全量收藏一次性并发化。暂停、取消、完成、Service Worker 重启和旧 lease 均按 worker 清理/恢复，避免旧截图写入新任务。
- **管理页体验。** 补拍状态会显示当前并发 worker 数；卡片右上角编辑按钮默认隐藏，hover、键盘 focus 或窄屏触控设备显示，保留无障碍和移动端可用性。
- **版本与验证。** 版本文件递增到 `0.4.9`；需完成本轮 `npm run check` 和真实 Chrome 安装态三 worker 体验验证。

### 2026-08-01 · 0.4.11 手动封面截图与网页端直接导航优化

- **右键入口。** 新增“更新封面”菜单项，仅对当前 URL 已确认存在 Chrome 收藏的普通网页显示；未收藏、无法确认、受保护或不支持的页面不会显示或执行。
- **截图流程。** 点击后重新校验收藏、本地资源、隐私设置和当前前台标签页，清理同页普通自动截图目标，等待页面稳定后用现有前台截图路径截取当前视图，并覆盖 `pageSnapshots` 与资源 `snapshotAt`。
- **交互与边界。** 手动刷新使用独立 `manual_refresh` 触发状态，明确绕过“7 天内不自动重复刷新”策略，但不会顺带触发 AI 富化；成功复用网页内“封面截图已更新”提示，失败通过扩展徽标给出原因。批量补拍专用标签页不会被手动菜单打断。
- **打开与截图优化。** 手动更新封面不再执行 900ms–4s 的页面稳定等待，只保留页面身份和前台状态核对后立即截图；从网页端打开收藏改为 `chrome.tabs.create({ url, active: true })`，再补登记截图目标，避免默认首页闪现。
- **版本与验证。** 版本文件递增到 `0.4.11`；`npm run check` 通过（49 个测试文件、233 项测试、类型检查、生产构建），待真实 Chrome 安装态验证右键显示、当前视图覆盖、直接导航和失败提示。

### 2026-08-01 · 0.4.12 构建产物语法错误防回归与 AI 链路核查

- **报错调查。** 用户提供的 Chrome 扩展错误为 `background.js:91 Uncaught SyntaxError: Unexpected end of input`。当前源码、Vite 产物和所有已生成 JS 文件均通过 Node 语法解析，未复现源码语法错误；该现象符合 Chrome 曾加载旧版或不完整背景脚本后的安装态错误记录。
- **防回归修复。** 新增 `scripts/check-built-javascript.mjs`，构建结束后递归对 `dist/` 内所有 JavaScript 执行 `node --check`；任何截断或未闭合语法都阻断构建，不再让无效 `background.js` 进入可加载产物。
- **AI 链路结论。** Aarre 保存当前已打开网页时，会注入 `content-capture.js`，在真实网页 DOM 上用 Readability 提取正文、标题、描述、作者、站点名、语言、选中文本和代表图，再把最多 50,000 字正文与网页元数据发送到用户配置的 AI 提供商生成摘要、标签、主题和别名；AI 不直接读取截图。Chrome 原生书签或没有可信前台正文时，任务会等待用户正常打开网页后再读取真实渲染 DOM；显式“全库扫描”才会使用公开 HTML 的元数据/首段正文作为降级输入。
- **版本与验证。** 版本文件递增到 `0.4.12`；待完成本轮 `npm run check`、产物语法校验和真实 Chrome 重新加载验证。

### 2026-08-01 · 0.4.8 封面比例与侧边栏通知浮层 UI 收口；并发补拍可行性结论

- **网页端封面。** 收藏卡片封面从 16:9 调整为 4:3，容器继续隐藏边缘溢出；封面内容默认以 `scale(1.05)` 轻微放大，悬停/键盘聚焦时平滑到 `1.065`，避免页面边缘出现细滚动条或未填满的视觉缝隙。
- **侧边栏提示。** 收藏保存后的成功提示和错误提示统一增加明确最小高度、行高、长文案换行与关闭按钮不收缩规则；设置页通知同步有最小高度并垂直居中。网页端 `manager-toast` 也补齐固定最小高度和居中布局，避免相同问题在不同入口复现。
- **并发研究结论。** 当前批量补拍状态按单 worker 实现：任务只有一个 `currentResourceKey/currentLease/tabId`，只创建一个后台专用标签页，超时 Alarm 按单 job 清理，`SnapshotBackfillStatus.concurrency` 还是字面量 `1`。3–5 并发技术上可行，但需要多 worker、每 worker 独立标签页/lease/超时/取消恢复和结果结算的状态机重构；本轮没有改并发逻辑，也不能承诺线性 3–5 倍加速。建议后续先设计 3 worker、按 host 限流和资源上限，再做真实 Chrome 安装态基准。
- **验证。** `manager-layout-stability` 与新增的 `sidepanel-layout-stability` 专项测试通过；`npm run check` 已通过（49 个测试文件、232 项测试、类型检查、生产构建）。真实 Chrome 安装态仍需用户重新加载/安装 0.4.8 后体验确认。版本文件已递增到 `0.4.8`。

### 2026-08-01 · 0.4.7 首屏速度与批量补拍队列修复

- **首屏速度。** 管理页先加载真实书签库，整理洞察、知识仪表盘等非首屏计算改为后台准备；管理页基础请求并行执行。后台原生书签导入增加并发合并、变更版本缓存，未发生变化的资源不再重复写入 IndexedDB，避免同一次打开反复全量导入。
- **批量补拍。** 后台图片准备与稳定等待函数改为真正自包含，注入网页时不再引用外部模块辅助函数；截图重试异常统一进入单页失败结算并继续下一项，避免 rejected Promise 将队列悬在第一张。
- **版本。** `package.json`、`package-lock.json`、`public/manifest.json` 和最新 `dist/` 均为 `0.4.7`。
- **验证。** `npm run check` 通过：48 个测试文件、231 项测试、类型检查、生产构建全部通过；尚未在真实 Chrome 安装态复测，需用户重新加载/安装 0.4.7 后体验首屏速度和批量补拍。

### 2026-07-31 · 0.4.6 后台补拍封面未加载完成修复

- **症状。** 后台批量补拍的封面有时出现内容没加载出来（缩略图空白/半成品），像是在页面还没加载完成时就截了图。
- **根因（三点叠加）。**
  1. 隐藏标签页不会触发 IntersectionObserver 懒加载，`loading="lazy"` 或 `data-src` 占位的图片根本不会开始加载；而稳定等待脚本把所有 `complete === true` 的图片都当作已就绪——未开始加载的懒加载图恰好是 `complete=true` 且 `naturalWidth=0`，被直接跳过，于是“稳定检查通过”时图片区域还是空的。
  2. 批量稳定判定只有 500ms 安静 / 2 秒上限，而且只观察 DOM 变化，不观察网络请求；SPA 的 fetch/XHR 渲染、CSS 背景图还在路上时也会判定“稳定”。
  3. 隐藏标签页中 `content-visibility: auto` 的内容不会按需渲染、rAF 被抑制，进一步加重半成品截图。
- **修复。**
  - 新增 `prepareBackgroundPageForCaptureInDocument()`：批量截图前强制所有图片（含 `data-src`/`data-srcset` 占位和开放 shadow root 内图片）改为 eager 并重新写回 src/srcset 真正发起请求；临时注入 `*{content-visibility:visible!important}` 强制内容可见；滚动整页触发依赖 scroll/IO 的懒加载库后回到顶部。截图内容仍是页面顶部视口，与前台路径一致。
  - 稳定等待新增后台专用语义：`imageIsReadyForCapture()` 把未开始加载的懒加载图视为待加载并等待其 load/error；新增 resource timing 网络安静检查（600ms 安静窗口 / 6 秒上限），DOM 安静上限 2 秒放宽到 4 秒，图片等待 1.5 秒放宽到 2.5 秒，`executeScript` 硬超时 8 秒放宽到 20 秒（只是兜底，正常页面几秒内通过，45 秒就绪预算不变）。
  - Cloudflare/Turnstile 挑战页识别提前到加载等待之前，保持“快速跳过”不拖队列。
  - 前台截图路径零改动：`waitForPendingImages` 与网络安静检查仅在批量补拍开启。
- **验证。** Node.js 22.22.2 下 `npm run check` 通过：设计 Token、TypeScript、48 个测试文件 / 230 项测试（新增 3 项针对图片就绪语义、强制懒加载与批量稳定等待）和生产构建全部成功；`npm run verify:artifacts` 通过；`package.json` 与 `dist/manifest.json` 均为 0.4.6。真人安装态仍需在真实 Chrome 重载最新 `dist/` 后复测批量补拍封面完整性（工具环境无法访问 `chrome://extensions` / `chrome-extension://`）。

### 2026-07-31 · 0.4.5 批量补拍提速与后台化（不占前台）

- **症状根因（whatismyipaddress.com 复现）。** 该站对当前网络返回 Cloudflare “请稍候…”安全验证页（HTTP 403）；真实浏览器注入 Aarre 稳定等待脚本实测仅约 0.93 秒，卡点不在等待脚本，而在任务机制：45 秒超时从“开始导航”计时（页面完成前就开始倒数），超时后又强制重载重试一次，导致单页固定 45–90 秒；页面在稳定等待期间自行跳转时截图被取消后要干等下一次闹钟。200 个缺图收藏按此节奏需要 2–3 小时且必须前台挂机。
- **第一档：单页加速。** 超时改为导航兜底 45 秒，页面 `complete` 后重置为 45 秒“就绪预算”（成功页面几秒内清除闹钟，不影响正常站点）；超时不再重载重试，直接结算失败进入下一项；批量稳定等待收紧为 500ms 安静 / 2 秒上限 / 字体图片各 1.5 秒；`executeScript` 加 8 秒硬超时兜底；截图失败 2 秒后快速重试，最多 3 次后结算失败；识别 Cloudflare/Turnstile 挑战页并直接跳过；批量标签页被导航到其他网页时从“暂停等人继续”改为自动跳过。
- **第三档：后台执行。** `public/manifest.json` 新增 `debugger` 权限（商店高风险权限，用户已确认接受）；批量任务创建 `active: false` 的后台专用标签页，通过 `chrome.debugger` + `Page.captureScreenshot` 截图，不再要求窗口聚焦/标签活动；移除批量任务的失焦暂停逻辑（`waiting_focus` 仅保留类型兼容旧任务）；“继续”不再抢回焦点。普通浏览/保存/Aarre 打开路径仍用 `captureVisibleTab()` 前台截图，未受影响。
- **隐私与披露。** 后台截图仍只对 Aarre 自己创建的专用标签页执行，不附加用户正在浏览的其他页面，不读取正文、不上传；README、商店权限披露表与隐私页已同步 `debugger` 说明。
- **验证。** Node.js 22.22.2 下 `npm run check` 通过：设计 Token、TypeScript、48 个测试文件 / 227 项测试和生产构建全部成功；`verify:artifacts` 通过；`package.json` 与 `dist/manifest.json` 均为 0.4.5 且包含 `debugger`。**真人安装态验收已由用户完成一轮**：重载最新 `dist/` 后后台任务不抢焦点、可正常浏览，whatismyipaddress.com 等安全验证页快速跳过，整体进度明显提速。仍待商店侧确认：`debugger` 权限审核披露、Memory Saver 冻结个别后台标签页时是否出现空白截图（用户未反馈，属低频风险）。

### 2026-07-31 · Fluid 控件系统化归一与全视图样式回归修复

- 当前状态：
  - 已完成侧边栏、设置页和管理工作台的共享控件审计，不再用单个图标位移或页面级匿名 `span` 选择器修补问题。
  - `Button` 已提供稳定 `data-slot` 契约；纯图标按钮统一使用 icon 尺寸，SVG 通过共享内容层做几何居中。
  - `TabsSubtle` 已支持等宽单行布局；Gemini、OpenAI、DeepSeek 三向切换在侧边栏窄宽度下保持同一行。
  - 管理页搜索框、状态胶囊、下拉面板、报告周期、整理提案和卡片详情展示已按本轮批注统一归一。
- 关键改动：
  - 为 Button 的背景、内容、标签和 icon 增加稳定 slot，并在设计检查中禁止 CSS 继续依赖 `span.relative`、匿名背景层和未声明尺寸的纯 icon Button。
  - 清除迁移残留的 `!important` 与硬编码胶囊圆角；状态 Tab 的数字改为纯文本计数，不再嵌套 Badge 胶囊。
  - 搜索提交按钮相对外框的上、下、右间距统一为 7px；输入聚焦不再生成内层描边或阴影。
  - 下拉面板保留滚动能力并隐藏原生滚动条；选项面板使用实体背景。
  - 整理提案复选框与首行标题中心差收敛至 0.25px；卡片 hover 详情保持在现有内容下方的文档流中。
  - 同步更新集成测试，使其验证已确认的产品行为：不再要求已删除的“清除筛选”和顶部范围摘要，也不再要求旧的卡片覆盖层布局。
- 验证：
  - Node `22.22.2` 下 `npm run check` 通过：设计检查、TypeScript、48 个测试文件 / 225 项测试、生产构建全部通过。
  - `npm run verify:artifacts` 通过；`npm audit --audit-level=high` 为 0 个漏洞；`dist/` 已重新生成。
  - 真实浏览器：588×909 侧边栏无横向溢出，三向服务商 Tab 为 3 个等宽项 / 1 行；共检查 320 个侧边栏 icon，中心偏差均为 0px。
  - 真实浏览器：管理页 6 个视图均无横向溢出、运行警告、Tab 换行或 icon 偏移；库页检查 310 个 icon 均为 0px，搜索三边 inset 均为 7px，下拉层可滚动且滚动条隐藏。

### 2026-07-31 · 0.4.4 瀑布流稳定、头部整合与存量封面前台补拍

- **第二列闪烁根因与修复。** 收藏库使用 CSS multi-column 瀑布流，旧悬停动画把封面高度减少 89px、详情高度增加 89px。理论总高相等，但浏览器会在每一帧重新平衡各列，卡片位置改变后鼠标命中又失效，形成 hover / 非 hover 循环。现在封面与卡片高度全程固定，详情用封面内的绝对覆盖层做透明度和位移动画，不进入排版流；鼠标与键盘焦点都保留详情揭示。
- **头部进一步整合。** Aarre 品牌和六个功能 Tab 合并为一行，只保留整条头部底部的一根分隔线；收藏库次级工具区移除了原来的重复顶部分隔线，并把文件夹、排序、缺图补拍入口和当前范围说明收在同一层级。窄屏仍按内容自然换行，不制造横向滚动。
- **多个普通标签页的真实规则。** `captureVisibleTab()` 只能截当前窗口的活动标签页，因此连续打开多个缺图收藏时，最后保持前台且稳定的页面可以自动截图，先退到后台的页面不会在后台直接截图。其持久任务不会丢失；用户以后切回该页、Chrome 窗口保持前台并等待稳定后，会自动完成补拍，不需要再点一次截图。
- **存量批量补拍可行并已实现。** 收藏库仅在实际存在缺图候选时显示“补齐缺失封面”。用户确认后新建一个静音专用活动标签页，按主机交错、并发固定为 1，逐页等待加载完成、字体和首屏图片就绪、DOM 稳定，再复核窗口焦点、活动标签、最终 URL、document 与收藏绑定后截图。任务支持失焦等待、暂停、返回并继续、取消、45 秒超时、最多两次尝试、单页失败隔离和 MV3 恢复；不会抢回焦点。
- **批量任务的数据与隐私边界。** 只处理仍绑定 Chrome 原生书签、HTTP(S)、实际缺少 `pageSnapshots` 且非敏感/排除的网站；只生成本机截图，不使用 `og:image`，不上传网页或截图，也不会触发 AI 摘要/标签请求和隐藏费用。管理页初次读取和任务终态按 `pageSnapshots` 实存计算真实候选数，不再受被淘汰快照留下的陈旧 `snapshotAt` 影响。
- **竞态与重定向审查。** 每次截图分配 `jobId + lease`；落库和进度结算在同一状态锁中完成。暂停、取消、失焦会立即吊销旧 lease，快速恢复也不能让旧异步截图重新写入；超时 Alarm 同时校验 job/lease，旧 Alarm 不能推进新任务。公开页面若最终重定向到银行、支付、医疗等敏感地址会安全跳过，也不会把敏感地址登记为 alias。
- **自动化与开发预览。** Node.js 22.22.2 下 `npm run check` 通过：设计 Token、TypeScript、48 个测试文件 / 225 项测试和 0.4.4 生产构建全部成功；`npm audit --audit-level=high` 为 0 漏洞，商店素材、`git diff --check` 与产物结构检查通过。`dist/manifest.json` 为 0.4.4，40 / 40 张 WebP 完整进入产物，无 source map 或测试文件。
- **浏览器交互验证。** 1920px 下第二列目标卡片连续采样 24 帧，卡片矩形、封面高度和列位置只有 1 组值，24 帧均保持 `:hover`；页面为 4 列且横向溢出为 0。批量确认弹窗的正向/反向焦点闭环、Escape 与滚动锁通过；640px 弹窗宽 560px，360px 弹窗宽 344px，两档页面横向溢出均为 0；控制台 0 error。开发预览和自动化不能替代真实安装扩展的截图权限、Service Worker 和窗口焦点验收。

### 2026-07-31 · 0.4.3 收藏卡片编辑、40 张兜底封面与管理页极简顶部

- **卡片编辑与删除闭环。** 每张收藏库瀑布流卡片增加次级“编辑”入口，可精确修改一个 Chrome 收藏位置的名称、完整 URL 和文件夹，以及 Aarre 自定义标签和备注；AI 摘要保持只读。多位置先选位置，删除只作用于所选 `bookmarkId`，并提供二次确认、30 天恢复说明、受管理收藏门禁、Escape / 焦点陷阱和保存/删除后的焦点转移。
- **原生与增强数据分工。** Chrome 原生字段通过 `UPDATE_BOOKMARK_DETAILS` 写回并生成统一撤销批次；Aarre 元数据留在本机资源。真正跨资源改 URL 时只迁移所选绑定，其他副本留在旧资源，新资源清空旧摘要、正文、站点图、快照与 AI 状态，等待下次稳定打开后重建。追踪参数、普通 hash、尾斜杠、已知 canonical 和 redirect alias 的完整地址仍会真实写回 Chrome，但保持同一资源和全部增强信息。
- **数据安全收口。** 编辑器通过 `tagsChanged` 区分 AI 标签和用户明确编辑的标签；只改标题、文件夹或备注不会把 AI 标签误标为用户标签，跨站只保留真正的用户标签。same-key 迁移被防御性拒绝，避免丢失同资源其他 Chrome 绑定。失败恢复会执行全部本地、outbox、增强任务、Chrome undo 与重导步骤，任何一步失败都明确提示“未完整恢复”，不再虚假承诺完整回滚。
- **40 张 Aarre 兜底封面全部接入。** 收藏库大封面继续以本机真实页面截图为最高优先级；缺图或读取失败时，可靠语义映射到对应 Aarre 封面，否则按 canonical URL 的稳定 FNV-1a 哈希分配到完整 40 张本地 WebP。相同网页在刷新、筛选和排序后保持同图；普通 `og:image`、网络代表图、侧边栏图片和低清 favicon 不进入大封面。
- **管理页顶部与收藏搜索。** Tab 上方删除大标题、说明、返回侧边栏、账号和“仅保存在本机”等内容，只保留单行 Aarre 标识。搜索框进入收藏库工具栏，只搜索收藏标题、标签、摘要和文件夹；输入草稿与已提交查询分离，提交后才改变结果、高亮、排序和 URL。错误的百分比相关度改为“标题匹配”等可理解文案。
- **自动化与产物验证。** Node.js 22.22.2 下 `npm run check` 通过：设计 Token、TypeScript、45 个测试文件 / 208 项测试和 0.4.3 生产构建全部成功；`npm audit --audit-level=high` 为 0 漏洞，商店素材验证和 `git diff --check` 通过。`dist/manifest.json` 为 0.4.3，必需 `host_permissions` 为 `"<all_urls>"`，40 / 40 张 WebP 均进入约 1.9 MB 的 `dist/`，manager bundle 包含编辑、保存和删除确认功能。
- **开发预览验收。** 默认桌面、600px 与 360px 视口均无横向溢出；移动端编辑入口为 44px 触控高度，弹窗在 360×800 内可滚动；收藏搜索提交前保持 309 项、提交 `Anthropic` 后为 1 项并写入 `q`；前 80 张兜底卡片出现 34 个不同封面 ID，单元测试用 2,000 个未知 URL 覆盖完整 40 张；编辑备注、成功 toast、删除二次确认/取消和控制台 0 error 均通过。该预览只证明 UI 与 mock 交互，不冒充安装态 Chrome/IndexedDB 事务验收。
- **仍需真人安装态门。** 真实 Chrome 需要重载最新 `dist/` 后验证单/多位置编辑、managed 收藏、URL 跨资源迁移与失败恢复，以及此前截图增强矩阵；当前工具不能访问 `chrome://extensions` / `chrome-extension://`，因此本轮没有宣称安装版已通过。

### 2026-07-31 · 统一收藏增强协调器、7 天截图新鲜度与收藏库筛选排序

- **所有正常打开方式统一补缺。** Aarre、地址栏、Chrome 书签栏、历史记录和网页普通链接命中已收藏缺图页面后，都在 `complete` 之后继续等待字体、首屏图片和 DOM 稳定，再进行截图前后身份复核。新收藏首拍静默；从 Aarre 或正常浏览补旧图成功显示“封面截图已更新”。
- **截图按 7 天新鲜度刷新。** 已有图未满 7 天不重拍；满 7 天后只在正常浏览时静默刷新，不显示 toast。真实页面截图仍是网页端大封面的唯一可信来源，缺图、拒绝或读取失败统一使用 Aarre `generic-webpage` 兜底，不使用 `og:image` 或分类封面冒充。
- **新收藏和持久增强。** Chrome 星标与 Aarre 保存都创建完整增强任务；AI 摘要、标签和截图分别记账、互不阻塞。无 Key、断网、暂时没有合适前台页面或 Service Worker 重启时任务持久等待，在配置恢复或收藏下次正常打开时继续。
- **隐私边界。** 无痕、内部、局域网、银行、支付、医疗及用户排除页面统一禁止正文读取、AI 调用和截图，只显示 Aarre 兜底图。
- **收藏库文件夹筛选。** `src/ui/manager/library-collection.ts` 从真实 Chrome 书签树构建文件夹分面，隐藏“书签栏/其他书签”等系统根目录，支持根目录、嵌套目录、父目录包含全部后代、同一资源多位置去重和每个目录的真实计数。卡片显示当前目录位置，多位置显示“+N”。
- **收藏库状态筛选与排序。** `src/ui/manager/views/LibraryView.tsx` 增加“全部/已理解/待处理”、文件夹下拉、清除筛选和空状态；排序支持 Chrome 原始顺序、最近/最早收藏、最近使用、最近更新和标题 A-Z。存在搜索词且使用默认排序时保留搜索相关度，不被 Chrome 顺序覆盖。
- **筛选状态可恢复。** `src/ui/manager/ManagerApp.tsx`、`src/ui/manager/types.ts` 与 `src/ui/manager/library-collection.ts` 把状态、文件夹和排序写入管理页 URL；刷新或切换视图后可恢复，失效参数与已删除文件夹安全回退到“全部/所有文件夹/默认排序”。
- **管理页打开入口收口。** 新增 `src/ui/manager/components/ResourceLink.tsx`，并接入收藏库、整理提案、待读、报告与重新发现视图。普通左键统一通过 Aarre 导航以登记增强来源；修饰键和中键保留浏览器原生打开，由正常浏览补缺安全网继续处理。
- **本轮 UI 文件清单。** `src/ui/manager.css`、`src/ui/manager/ManagerApp.tsx`、`src/ui/manager/types.ts`、`src/ui/manager/library-collection.ts`、`src/ui/manager/components/LibraryCardCover.tsx`、`src/ui/manager/components/ResourceLink.tsx`、`src/ui/manager/views/LibraryView.tsx`、`OrganizeView.tsx`、`ReadingView.tsx`、`ReportView.tsx`、`ResurfaceView.tsx`；专项测试为 `tests/library-collection.test.ts`、`tests/library-card-cover.integration.test.tsx`、`tests/resource-link.test.tsx`。
- **验证。** 0.4.2 `npm run check` 已通过：设计 Token、TypeScript、41 个测试文件 / 183 项测试、生产构建全部成功；`package.json` 与 `dist/manifest.json` 均为 0.4.2，产物必需 `host_permissions` 为 `"<all_urls>"`。文件夹专项覆盖隐藏系统根目录、嵌套/父目录筛选、多位置去重、根目录、Chrome 顺序、收藏/使用时间排序、搜索相关度、处理状态、URL 往返和非法参数回退；封面与链接集成测试覆盖真实截图/Aarre 兜底和普通左键/修饰键行为。安装态真人门仍需在真实 Chrome 重载最新 `dist/` 后完成。

### 2026-07-31 · 历史故障基线：0.4.1 三条截图路径复测失败与统一增强架构决策（已由当前重构取代）

- **真人失败基线。** Chrome 原生星标新增、Aarre 打开安装前旧收藏、Aarre 自身新增收藏三条路径均未生成封面截图；此前 39 个测试文件 / 169 项测试及构建通过只能证明纯函数和产物结构，不能证明安装态截图链路。
- **权限根因已按 Chromium 源码核实。** `PermissionsData::CanCaptureVisiblePage()` 对 `captureVisibleTab()` 明确检查 host pattern 的 `match_all_urls()`；当前 `http://*/*` + `https://*/*` 不等于 `"<all_urls>"`。Chrome 原生星标又不会授予 `activeTab`，从管理页打开网页也没有稳定的临时授权，因此现权限方案无法支持产品承诺。
- **共同管线根因。** `schedulePageSnapshotForTab()` 用 MV3 Service Worker 内存 `setTimeout` 安排截图，并通过 `.catch(() => false)` 吞掉全部异常；没有 `waiting_page / waiting_foreground / stabilizing / capturing / blocked_permission / blocked_privacy / ready` 等状态，也没有本地诊断界面。Chrome 官方明确要求 MV3 持久化关键状态，因为 Service Worker 终止会结束计时器。
- **资源身份缺陷。** Aarre 保存优先使用页面声明 canonical 建立资源，但安排截图时拿地址栏 URL 与 canonical 严格比较，`rememberImmediateSnapshotTarget()` 又根据 URL 重算资源键；canonical 去参数、跨 `www`、语言主版本和重定向都可能导致保存成功但永不建截图任务。
- **入口覆盖缺陷。** 当前只有显式 `NAVIGATE` 才登记旧收藏补拍；管理页部分原生链接、修饰键/中键、Chrome 书签栏、地址栏、历史记录和普通网页链接均可绕过。`tabs.onUpdated` 只恢复已经存在的即时目标，不会查询“当前 URL 是否已收藏且缺图”。
- **平台边界。** 规范主方案仍是本机 `captureVisibleTab()`，它只能截指定窗口当前活动页。`bookmarks.onCreated` 只给书签节点，不提供来源 tab；因此原生星标后只能在 URL 唯一匹配且页面仍在前台时尽量即时完成，用户先切走时应持久等待下次打开，绝不能截取别的活动页。`offscreen` 只能辅助图片处理，不能加载任意外站截图；HTML/iframe 缩略图、`tabCapture`、`debugger` 和远程截图均不作为主方案。
- **统一状态机。** Chrome 原生星标、Aarre 保存、从 Aarre 打开、普通浏览已收藏缺图页、浏览器启动恢复都只创建或唤醒同一种持久增强任务。截图任务直接携带 `resourceKey`，临时绑定 `tabId + documentId + finalUrl`；页面完成后由轻量内容脚本等待字体、首屏图片和 DOM 安静，再通知后台做截图前后双重身份校验。
- **无感恢复规则。** 新收藏能即时完成则静默；用户离开则标记 `waiting_foreground`，下次该收藏以任意方式成为前台并稳定时自动补齐。旧收藏首次补拍成功只显示一次“封面截图已更新”。敏感/内部/无痕/用户排除页面标记为明确的永久跳过并使用 Aarre 兜底图，不得伪装为持续处理中。
- **AI 边界。** 摘要与标签必须同时成功才算 AI `ready`，但要与截图独立记账、独立重试。当前 BYOK 模式没有 API Key 时不可能无条件完成 AI，只能保留 `waiting_for_key` 并做一次明确配置引导；若未来要求零配置全自动，需另行提供有显著数据披露、用户同意、成本和限流治理的 Aarre 托管 AI 服务。
- **历史状态。** 上述审计发生在统一协调器实现之前；当前工作区已完成 `"<all_urls>"`、持久状态、精确 tab/document 绑定、普通浏览补缺和 7 天静默刷新。仍未完成的是最新 `dist/` 的真人 Chrome 安装态矩阵，不能把历史失败继续描述为当前源码“尚待实现”。

### 2026-07-31 · 历史记录：0.4.1 原生收藏与旧收藏截图失效修正

- **纠正 0.4.0 的错误权限假设。** Chrome 官方能力边界是：`bookmarks.onCreated` 能观察原生星标，但原生星标不是 Aarre 的用户手势，不会授予 `activeTab`；`scripting.executeScript` 和 `captureVisibleTab` 需要匹配的 host permission 或临时 `activeTab`。因此原生星标后若没有提前授予 optional 权限，0.4.0 的持久队列只能等待，无法履行“收藏后立即完成截图”的产品承诺。
- **当时的 0.4.1 行为（现已作废）：** `public/manifest.json` 曾将 `http://*/*` / `https://*/*` 从 `optional_host_permissions` 改为必需 `host_permissions`，并仍只覆盖新收藏、从 Aarre 打开缺图旧收藏和主动扫描，不支持普通浏览补缺。当前实现已改为真正的 `"<all_urls>"`、所有正常打开方式补缺和 7 天静默刷新。
- `getDisplaySettings()` 会把旧存储中 `pageSnapshotsEnabled: false` 实际迁移为 `true`；`saveDisplaySettings()` 也不再写回隐藏关闭状态，避免新版 UI 没有开关但后台永久静默禁用。
- 截图目标写入 `chrome.storage.session` 后重新 `chrome.tabs.get()`，再依据最新状态安排任务，关闭“complete 事件先到、目标后落盘”的竞态。同页重载或动态二次加载只清除当前计时器，不再无条件丢掉补拍目标；明确跳转到其他 URL 才删除。
- 后台增强队列与 Aarre 打开路径为同一资源安排任务时合并 `delayMs` / `showToast`：静默的 250ms 新收藏重试不能覆盖旧收藏路径的 1.5 秒等待和“封面截图已更新”提示。
- **当时的两条路径文档口径已作废。** 当前隐私政策、架构、PRD、整改文档与商店权限披露以“新收藏首拍 + 所有正常打开方式补缺 + 7 天静默刷新”为准。
- 版本从 0.4.0 提升到 0.4.1。完整检查、产物检查和安装态复测结果见下方“验证情况”；真实 Chrome 仍需重新加载 `dist/` 并接受权限变化后，分别验证原生星标和 Aarre 打开缺图旧收藏。

### 2026-07-31 · 历史记录：0.4.0 Chrome 原生收藏完整增强层与右键状态机

- 新增 `aarre:bookmark-enhancements:v1` 持久增强队列。Chrome `bookmarks.onCreated` 监听原生星标新增，基础资源落库后自动排入 AI 与截图任务；任务按资源键去重、指数退避、Alarm 恢复，配置 AI Key 后会主动唤醒。Chrome HTML 批量导入期间遵守 `onImportBegan/onImportEnded`，只做最终索引，不自动对整批历史书签发起昂贵增强。
- **当时的 0.4.0 恢复边界（现已扩展）：** AI 摘要和标签作为同一必选生成步骤，收藏浮层移除了 AI 勾选框；暂时无 Key、网页权限、网络或前台页面时任务保留。当时只承诺从 Aarre 打开后继续，当前已覆盖所有正常打开方式。
- 右键和侧边栏星标共用全局查重：无匹配才能直接新增；唯一完全相同记录更新原记录；canonical-only 命中必须确认复用或另存；多条命中显示位置并要求选择；受 Chrome 管理的记录只更新 Aarre 元数据。Agent 新建入口遇到已存在 URL 也拒绝制造重复。
- 当前页面右键项随活动 tab、URL 和书签事件更新为“添加到收藏…”或“管理此收藏…”，异步刷新带 revision 防止慢查询覆盖新页面。Chrome Context Menus API 只公开点击事件，不公开菜单显示前的链接目标事件，因此链接项固定使用中性文案“添加或管理此链接…”，点击后在侧边栏再次校验。
- **当时的 0.4.0 行为（现已作废）：** 新收藏和 Aarre 打开缺图旧收藏的截图目标写入 `chrome.storage.session`，普通浏览路径被移除。当前实现已恢复为所有正常打开方式统一补缺，并增加 7 天静默刷新。
- 旧收藏补拍成功后向网页注入隔离的 Shadow DOM toast，文案为“封面截图已更新”，3 秒后自动移除；新收藏的首次截图保持静默。无痕、银行、支付、医疗、内网及用户排除网站继续不截图，只使用 Aarre 兜底图。
- 没有新增 Manifest 权限；继续使用现有 `bookmarks`、`contextMenus`、`alarms`、`storage`、`scripting`、`tabs` 与按用户手势申请的 `optional_host_permissions`。
- 版本从 0.3.9 提升到 0.4.0。Node.js 22.22.2 下 `npm run check` 全通过：38 个测试文件、165 项测试、类型检查、设计 Token 检查和生产构建成功；`npm audit --audit-level=high` 为 0 漏洞，商店素材验证和 `git diff --check` 通过。`package.json` 与 `dist/manifest.json` 均为 0.4.0，`dist/` 约 1.9 MB。
- 尚未完成安装态真人门：需要在真实 Chrome 中分别验证原生星标、页面右键各状态、Key/权限恢复、动态站点稳定截图、补拍 toast、敏感/无痕拒绝和 Service Worker 暂停恢复。自动化与源码检查不能冒充这些浏览器交互证据。

### 2026-07-30 · 0.3.9 网页端真实截图封面与稳定采集

- 网页端收藏瀑布流新增独立 `LibraryCardCover`：大封面只按 canonical URL 延迟读取本机页面快照；无快照、权限拒绝、读取失败或快照图片加载失败时，统一显示 Aarre `generic-webpage-v1.webp`。普通 `thumbnailDataUrl` / `og:image`、站点标识和分类封面不再进入大封面。
- 快照只在卡片进入前后 600px 预加载区时读取，离开后释放 Base64 数据，避免上千条收藏同时占用管理页内存；后台采集成功会广播刷新，管理页重新获得焦点也会复查可见卡片。
- 管理页和侧边栏的普通点击统一走 `NAVIGATE`，首次由真实用户点击申请可选的 `http/https` 权限；拒绝权限不阻断保存或打开网页，只继续显示兜底图。用户已关闭快照设置时不会请求权限。
- 新收藏在原生书签和基础本地资源写入后立即进入快照队列，不再等待可选 AI 富化完成；从 Aarre 打开的老收藏使用 1.5 秒最短稳定等待；正常浏览已收藏 URL 保持 `complete` 后 5 秒停留。
- 截图前通过网页上下文等待字体、首屏可见图片和 DOM 900ms 安静，最长稳定观察 4 秒；等待前后都重新读取真实标签状态，必须同时满足前台、活动窗口、`status === "complete"`、URL 未变化、非无痕和非敏感地址。标签切换、窗口失焦、重新导航或关闭都会取消或放弃截图。
- 页面快照由 680×425 提升为最长边 960、16:10、WebP q0.75，满足 240–300px 瀑布流卡片在 Retina 屏幕上的显示。PRD、架构和整改文档已同步权限、稳定等待和尺寸口径。
- 版本从 0.3.8 提升到 0.3.9。Node.js 22.22.2 / npm 10.9.7 下 `npm run check` 全通过：36 个测试文件、155 项测试、类型检查、设计 Token 检查和生产构建成功；`npm audit --audit-level=high` 为 0 漏洞，商店素材验证通过，`git diff --check` 通过。`package.json` 与 `dist/manifest.json` 均为 0.3.9，`dist/` 约 1.8 MB。
- 安装态真人门仍未完成：自动化浏览器能够看到用户现有 Aarre 管理页，但安全策略禁止进入 `chrome-extension://` 页面，也禁止进入 `chrome://extensions` 重载扩展。不能据此声称真实权限弹窗、动态网页稳定采集和卡片回填已经在安装版逐项验收。

### 2026-07-30 · 拉取最新主线并完成本地生产构建

- 工作区无未提交改动后，从 `origin/main` 以 fast-forward 方式将本地 `main` 从 `4c90cb9f8de2494414db95df07ef7df29879fea3` 更新到 `7e585635ca00721017da26b3072d9f958f4c8396`。
- 使用 Node.js `22.22.2`、npm `10.9.7` 执行 `npm ci`；安装并审计 126 个依赖包，发现 0 个漏洞。
- `npm run check` 全部通过：Node 版本检查、设计 Token 检查、TypeScript 类型检查、35 个测试文件 / 150 项测试和生产构建均成功。
- 最新可加载的未压缩 Chrome 扩展已输出到 `/Users/nefish/Desktop/Coding/Aarre/dist/`，体积约 1.8 MB；`package.json` 与 `dist/manifest.json` 的版本均为 `0.3.8`。
- 本轮仅完成源码同步、自动化检查与本地构建，没有执行 Chrome 已安装扩展的真人交互验收，也没有生成 Chrome Web Store 上传包。

### 2026-07-30 · UI/视觉重构实施完成（`docs/UI_REDESIGN.md` 批次 A–H）

**统一设计地基**

- 新建 `tokens.css`、`base.css`、`sidepanel.css`、`manager.css`，原 6,152 行 `styles.css` 收口为 4 行入口；旧暖纸/冷白两套变量与别名、重复 manager 规则和全部 `!important` 已清除。
- 浅色为纯白底，深色完整接入 `prefers-color-scheme` 与手动 `data-theme`；侧边栏 `compact`、网页端 `comfortable` 共用同一套颜色、圆角与组件。
- 新增 `scripts/check-design-tokens.ts` 并接入 `npm run check`：CSS 非 token 文件中的硬编码颜色、未登记圆角/字号/字重、旧变量和 `!important` 会直接阻断提交。
- 设计维度收口结果：硬编码颜色 0、阴影 2、圆角 4 档、字号 7 个角色、字重 3 档、基础过渡时长 2 档、间距只使用 `--sp-1..8`；仅保留文档明确允许的 340ms 卡片过渡、1ms 无障碍降级和输入框 14px 几何计算。
- `--accent` / `--positive` / `--negative` 只在报告数据图表中使用；主题图谱使用专用五色调色板。按钮、焦点、搜索命中、进度和普通状态全部回到中性 `--ink` 系。

**界面与结构**

- `ManagerApp.tsx` 缩为数据与导航外壳，六个 tab 分拆到 `src/ui/manager/views/`；URL `?view=`、刷新与 tab 往返状态保持。
- 收藏库使用 `column-width: 240px` 的无壳瀑布流、真实 `SiteThumbnail`、三档封面和中性搜索高亮；悬停时封面收缩与详情展开共用 `--reveal: 89px`。
- 报告新增四项指标、环比、当前/上期主题条形对比、知识缺口 `n / 4` 和重新发现区，不使用装饰性色条。
- 主题图谱移植三维力导向、透视投影、深度排序、第二遍标签、社区分析、孤岛与低关联面板；支持拖动、0.55–2.4 缩放、悬停读数和自动旋转，无新增依赖。新增纯函数测试覆盖平方根半径关系和 60 个主题的有限布局/孤岛边界。
- 新增跨界面 `ResourceIdentity`，侧边栏和网页端共用收藏身份；搜索框、空/加载状态和危险按钮类名已统一。侧边栏结构保持不变，并补齐 AI 输入框按内容 48–112px 自动增高/删字回落。

**自我验收**

- Chromium 开发预览实测收藏库：1440 / 1120 / 900 / 600 宽度分别为 4 / 4 / 3 / 2 栏；1120 宽度悬停前后收藏区和卡片高度差均为 0，封面 `232 → 143px`、详情 `0 → 89px`。
- 侧边栏输入框实测 `48 → 112 → 48px`；长列表渐隐在顶部/中段/底部分别为 `0/52`、`52/52`、`52/0px`；浅色下 `html/body/panel` 均为 `#fff`，深色下均为 `#0f1113`，无横向溢出。
- 六个 tab 明暗模式逐一切换，URL 正确、状态保留、控制台 0 错误；主题图谱画布约 500px 高，三栏问题面板等高，拖拽、极限缩放和悬停读数均有效。
- Node 22.22.2 下 `npm run check` 全通过：35 个测试文件、150 项测试、TypeScript 与生产构建均通过；`verify:artifacts`、`verify:store-assets`、`git diff --check` 通过，`npm audit --audit-level=high` 为 0 漏洞。

### 2026-07-30 · UI/视觉系统性盘点（新方向 · 只盘点未改代码 · 基线 `1c45453` / 0.3.8）

产品负责人提出新方向：侧边栏与网页端 UI 不统一、同模块内部也大量不统一、整体不够精美，要求做出一套极简且有设计感的界面，并逐个重构网页端六个 tab（收藏库 / 整理提案 / 待读队列 / 报告 / 主题图谱 / 重新发现），其中报告与主题图谱现状「过于简陋」。

**根因：`src/ui/styles.css` 里叠着两套互相冲突的设计系统。** 第 1 行 `:root` 是暖纸柠檬绿系统（`--paper: #f5f4ed`、`--lime: #a9e85c`、Inter）；第 1729 行又出现第二个 `:root`，注释为 “Cosmos-aligned collection experience”，是冷白蓝系统（`--paper: #fff`、`--accent: #205aef`、PingFang SC）。后者覆盖前者，但前 1,728 行规则仍是照暖纸色写的。**产品负责人已确认第二套是从他的其他仓库引入的、不是想要的风格，授权整体推翻，网页端尤其可以全部重做。**

**设计维度取值实测**（正则提取声明值后去重）：

| 维度 | 现状取值种类 | 维度 | 现状取值种类 |
| --- | ---: | --- | ---: |
| 硬编码颜色 | 210 | 圆角 | 20 |
| margin 像素值 | 29 | 字号 | 19 |
| padding 像素值 | 26 | gap 像素值 | 16 |
| 阴影 | 31 | 字重 | 13 |
| 过渡时长 | 9 | 深色模式规则 | 0 |

字重同时用了 450/500/550/600/610/620/640/650/680/700/720/750/760 共 13 档，610 与 620 无可感知差别——逐处手调而非按系统取值的典型特征。另有 66 个重复定义的选择器；两个 HTML 均写死 `color-scheme: light`。

**跨界面分裂**：同一条收藏在侧边栏是 `bookmark-row`（48px 缩略图）、网页端是 `resource-card`（32px）；搜索框（`library-search` vs `search-box`）、空态（`native-empty` vs `empty-state`）、加载态、错误提示各有两套；危险按钮存在 `.danger-button` 与 `.button-danger` 同义异名；侧边栏内部另有 8 个类名前缀家族（`native-` 22 类、`agent-` 29 类、`settings-` 27 类等）各自成套。

**两个重点 tab 的具体判断**：

- **主题图谱问题最重**：`ManagerApp.tsx` 87–99 行按**数组下标**把节点均分角度排在两个同心圆上（前 8 个内圈、其余外圈），位置这一最强视觉通道不携带任何信息，导致所有连线都是穿过圆心的弦。现有数据（上限 24 节点 / 60 边）本就足以做力导向布局与社区聚类，**不需要新增任何字段**。若要额外显示每个主题的健康度，才需要给 `TopicGraphNode` 加字段。
- **报告 tab 零图表**：`LibraryReport` 已有 `topicTrends`（本期 vs 上期）、`knowledgeGaps`（`resourceCount` / `angleCount`）等成对与比例数据，却全部渲染成文字。唯一真正缺的是时间序列——现结构只有「本期/上期」两个点，但每条收藏都带 `dateAdded`，按天分桶是纯计算、不需要新采集。

**结构性成因**：`ManagerApp.tsx` 用一条覆盖约 420 行的嵌套三元渲染六个 tab（592–1015 行），没有任何按视图拆分的组件，这是各 tab 各自走样的直接原因。

**产出**：方案做成了可交互 Canvas（`~/.cursor/projects/Users-nefish-Desktop-WorkSpace-Coding-Aarre/canvases/aarre-ui-redesign.canvas.tsx`），内含主题图谱「现状 vs 力导向重构」用同一份数据的实时对照演示。

**已决策**：② 侧边栏**只接新 token、保持现有结构**（它是日常主力界面且刚被打磨过，回归风险最低）；③ 深色模式**本轮一并做进 token 层**（此时成本最低，之后补要重扫所有颜色）。① 视觉风格通过样张迭代确定，见下。

**视觉样张（`docs/design/style-samples.html`，可直接用浏览器打开）**

第一轮做了 A 墨白 / B 石墨 / C 砂岩三套。产品反馈：C 的圆角尺度合适，但背景色彩倾向太重；B 的彩色偏深；整体要更清爽；背景**必须是纯白**——网页端和侧边栏都是，侧边栏尤其，非白底会与 Chrome 侧边栏容器之间出现可见色差接缝。

据此收敛出 **D · 清爽**（当前默认方案）：

| token | 取值 | 说明 |
| --- | --- | --- |
| `--bg` / `--surface` | `#ffffff` | 纯白，层次改由发丝线与悬停底色表达 |
| `--surface-sunken` | `#f5f6f7` | 仅用于悬停与内凹 |
| `--ink` | `#17191c` | 中性近黑，无冷暖偏向 |
| `--line` / `--line-strong` | `#ebedef` / `#dadde0` | |
| `--accent` | `#12a594` | 比 B 的 `#0f766e` 提亮，深色模式为 `#2ec4b0` |
| 圆角 | 6 / 10 / 16 | 沿用 C 的尺度 |

深色模式已同步定义（`#0f1113` 底），不是事后补的。样张含网页端与侧边栏两个视图、三套风格、明暗各一版，可自由切换。

**主题图谱改为真三维**（产品明确要求「不要平面的、要更炫酷」）：纯 Canvas 2D 实现的三维力导向 + 透视投影 + 深度排序，自动旋转、可拖拽、可缩放、悬停高亮邻居，不依赖 Three.js，样张自包含。实现中踩到两个坑，均已修复并在代码里留了注释：

1. 力导向模拟的输出尺度会随节点数漂移，未归一化时透视分母可能变负，导致 `arc()` 收到负半径抛异常、画布全空。修法是模拟后把点云归一化到固定半径 `CLOUD_RADIUS`，并给分母加下界。
2. 零连接的孤岛主题只受斥力、不受任何引力约束，会被推到距中心约 4000 的位置，按最大距离归一化时反而把连通部分压成一个点。修法是给斥力加 `3.2k` 的距离截断并线性衰减，孤岛主题因而稳定停在最外圈——正好是想要的语义。

**三维的代价必须记录**：投影会压平纵深，24 个节点全部标注必然叠字，因此只固定标注最靠前的 11 个，其余靠旋转与悬停显示。静态截图是三维图谱的最差情况，动起来可读性明显更好。为此在图谱右侧加了**问题面板**（社区构成、孤岛主题、收藏多但关联少），全部由现有数据实时算出、无写死结论——三维负责空间直觉与观感，面板负责给出精确可读的结论，两者配合才同时满足「炫酷」与「真实反映问题」。

**第二轮样张反馈与修订（同日）**

产品对 D 版提了六条，除第 5 条外全部已改进样张，其中前两条改出了系统级结论：

1. **节点大小不成比例**——半径公式原为 `5.5 + sqrt(count) * 2.1`，那个常数项把量级差压平了：3 条与 31 条只差 1.9 倍。改为 `r = 3.2 * sqrt(count)`（**面积正比于条数，不允许常数项**）。同时发现透视会让近处小节点看着比远处大节点还大，直接摧毁「大小=数量」这条读法，故把纵深对半径的影响开 0.45 次方压缩（位置仍用完整透视），数量重新成为主导变量。
2. **网页端信息密度过高、像 SaaS 后台**——收敛出的结论是**密度应当是同一套 token 的一档，而不是另一套设计**：侧边栏用 `compact`（正文 13px），网页端用 `comfortable`（正文 15px / 行高 1.7 / 区块间距 72px），两边共用同一批颜色、圆角与组件，只换字号与间距变量。收藏库据此从横向条目改为**三栏卡片瀑布流**（CSS columns + `break-inside: avoid`），卡片含封面区、标题、摘要、标签，高度随内容自然错落。
3. **侧边栏 AI 输入框**——圆角 26px、默认高 56px，聚焦时自动增高到 96px。注意 `align-items: flex-end` 下必须同时把 textarea 自身高度撑起来，否则光标被顶在框底、上方留一大块空白。
4. **侧边栏头部偏小**——标题 15 → 19px，图标按钮 28 → 34px、图标 16 → 18px。
5. **报告标题前的绿色竖线**（产品指为「AI 味太浓」）——已删除。改用小字号大写 eyebrow「本周结论」+ 大字号结论句，靠字阶和留白建立层级，不加任何装饰性色条。**此条记为通用禁忌，后续所有页面不得再出现「彩色竖条 + 一句话」这种组合。**
6. **图谱右侧分析面板过密**——区块间距提到 48px、行内距 9px，三个区块各自带一句解释性说明；面板刻意不填满，留出后续扩展位。

另外修了两个样张自身的问题：点云归一化原先按**全部**节点的最大距离定标，两个孤岛主题把连通主体压在了中间，改为只按连通节点定标；标签原先与球体交错绘制，会被前排球体盖住，改为独立第二遍绘制。

**第三轮样张反馈与修订（同日）**

产品追加了一条**全局配色规则**，并指出侧边栏输入框不该被重新发明：

- **颜色分工定死**：黑白灰负责交互与结构（按钮、焦点、选中、命中高亮、品牌标记），**彩色只出现在图表与图谱这类「颜色本身在编码数据」的地方**。`--accent` 因此降级为纯图表色，不允许出现在任何按钮或焦点态上。发送键改黑底白箭头，整理建议的「查看」改黑底，搜索框聚焦边框改 `ink 32%`，命中高亮改 `ink 15%` 灰底。产品对此的描述是「有点像 OpenAI ChatGPT」——这正是目标观感。
- **输入框回到线上几何**，不再自造：`min-height 48 / max-height 112`、上方 padding 14、下方 32px 工具条、圆角 24、`box-shadow: 0 12px 32px rgba(24,26,29,.08)`。**高度由输入内容顶起来，不是聚焦就变高**（上一版做错了）。聚焦只加深边框。
- **发送键与圆角同心**：圆角的圆心在距边框盒角 24px 处，按钮半径 16、边框 1，所以右／下内边距必须是 `24 − 16 − 1 = 7`，实测右下内缩均为 8px（含边框）、圆心距边 24px。这条几何关系写成了 CSS 变量表达式而不是魔数。
- **列表渐隐遮罩保留**：沿用线上的 52px 滚动驱动遮罩（`@property` + `animation-timeline: scroll(self)`），顶部未滚动时不虚、滚到底时底部不虚。
- **图谱拖拽方向是反的**：近处的点 z 为负，`yaw` 增大会让正面往左走，所以拖拽必须取负号才符合「抓住球往右拖、正面跟着往右转」的直觉。
- **分析区从右侧移到图谱下方**：右侧结构下主题数一多面板就变长，会把图谱一起拉高。改成通栏图谱 + 下方三栏（`auto-fit minmax(260px,1fr)`），两者高度彻底解耦；每栏最多列 5 行，其余折成「还有 N 个」，主题从 24 涨到 200 也不会变高。
- **收藏库改为按列宽自适应**：`column-width: 240px` 取代 `column-count: 3`，浏览器按可用宽度决定列数，1120px 容器下自动排四栏、窄屏自动退到 3/2/1 栏，卡片宽度始终落在 240–300 之间。三栏时封面被拉得过宽的问题随之消失。

**第四轮样张反馈与修订（同日）**

产品给出参考站 <https://mesh3d.gallery/>，要求收藏库卡片默认少露文字、悬停再展开，并把圆角整体放大。实测参考站：卡片是**封面主导**，封面 `rounded-2xl`（16px）、`transition duration-300 ease-out`，封面下只有 favicon + 标题 + 作者两行，没有摘要和标签。

- **圆角整档上调**：`6/10/16/22` → `8/14/20/30`。
- **输入框圆角单独回收到 22**：先跟着放大到 30，产品认为太圆，且明确「圆心不在一起就不在一起」。因此放弃同心约束，改为固定内缩 12px。同心那条几何关系（`inset = radius − 按钮半径 − 边框`）仅在圆角 24–30 区间成立，圆角一旦收小就会把按钮顶到贴边，**不要再试图恢复它**。
- **卡片去壳**：卡片本身不再有边框和底色，只剩圆角封面 + 下方两行文字。内容型网站里再套一层卡片壳只会把注意力从内容上引开。
- **详情揭示方式（第一次做错，已按参考站截图纠正）**：不是把详情叠在封面上，而是**悬停时封面被压矮、下方内容整体上推，让出的空间里滑出详情**。这一点是硬约束：瀑布流里卡片一旦变高整列都会重排，悬停就成了页面抖动。实现上让封面收缩量与详情区展开量共用同一个变量 `--reveal`，两者严格相等，卡片总高恒定——实测悬停前后收藏库区块高度都是 1119px。骨架用 `height: var(--h)` 固定在原始高度并 `inset: 0 0 auto 0`，这样封面变矮时是从下方裁掉而不是把内容压扁。过渡 340ms。
- **`--reveal` 必须等于详情区的自然高度**，凭感觉给 78px 时标签行被切掉。改用脚本克隆节点量真实高度（89px）再回填，不是估的。
- **默认信息量**：只保留标题（15px）与站点行（favicon + 域名），标题字号从 18 降到 15——封面变大之后，标题不需要再承担吸引注意的职责。

**当前样张截图**（`docs/design/sample-*.png`）：`library-light` / `library-hover` / `library-dark` / `report-light` / `graph-light` / `graph-dark` / `sidepanel-light` / `sidepanel-focus` / `sidepanel-typing` / `sidepanel-dark` / `manager-full`。截图脚本在 `/tmp/aarre-shot/`，非仓库内容，重装环境后需重建。

**样张的已知失真**：卡片封面用的是抽象骨架，真实产品这里是 F22 采集的页面快照或站点图标（彩色）。骨架在放大后更容易被误读成加载占位，评审时请按「这里将来是真实截图」来看。

**产品已确认 D 版定稿（2026-07-30 20:57）。整改文档见 `docs/UI_REDESIGN.md`**，共 8 个批次：A token 层与 CSS 拆分 → B 侧边栏接入 token → C 拆分 `ManagerApp.tsx`（只搬不改）→ D 收藏库 / E 报告 / F 主题图谱 / G 其余三 tab（C 之后可并行）→ H 深色模式与收尾。文档里带了三条贯穿全局的硬规则（颜色分工 / 密度两档 / 悬停不得改变占位）、产品点名禁止的三种做法，以及每一批踩过的坑与验收口径。

**下一步**：由执行 Agent 按 `docs/UI_REDESIGN.md` 从批次 A 开工。

**并发提醒**：0.3.6 与 0.3.8 刚由另一 Agent 改过侧边栏样式（设置页改为无卡片分区、预览宽度、动画等）。UI 重构开工前需重新确认 `SidePanelApp.tsx` 与 `styles.css` 的最新状态，避免与其正在进行的打磨撞车。

本次只做盘点与方案，未改动任何生产代码。

### 2026-07-30 · 0.3.8 根目录隐藏与整理提案精简

- 侧边栏把 Chrome 返回的全部系统根目录统一展开，只展示其子节点；“书签栏”“其他书签”和账号/本机重复根目录不再作为一级文件夹出现，原有书签内容没有删除或迁移。
- 新增统一可见路径规则：侧边栏搜索结果、管理页待读/重新发现、整理提案、Agent 操作说明、AI 上下文和撤销提示均不再显示系统根目录名称；直接保存在根目录的条目显示为“根目录”。
- 归类预览从“来源路径 + 网页名 → 目标路径 + 网页名”精简为“来源文件夹 / 网页名 → 目标文件夹”，避免长标题重复。
- 对同一文件夹中标题、网址和位置完全一致的真实重复节点，不再展示两条看起来相同的路径，改为明确说明保留与删除的副本数量；不同文件夹的重复项只展示一次网页名和各自位置。
- 相关类型检查和 26 项专项测试通过；真实浏览器开发预览确认整理卡片无根目录前缀，侧边栏直接从真实内容与用户文件夹开始，控制台无错误。

### 2026-07-30 · 0.3.7 整改第 7 批 + 悬浮预览稳定性

**7.1 `/favicon.ico` 多帧解析与来源链路**

- 新增 `conventional-favicon-ico` 来源；约定路径按 Apple 图标 → ICO → SVG 的顺序进入同一候选链，前一个候选质量不合格时会继续降级，不会提前截断。
- `extractLargestPngFromIco` 按 ICO 目录选择最大帧，正确处理宽高字节 `0 = 256`；最大帧是 PNG 才抽取，DIB/BMP 安全放弃，非 ICO 的 PNG/SVG 继续走原图管线。
- 下载仍受 4MB 上限、12 秒超时和越界目录校验保护；生产与测量脚本复用同一解析函数。
- 真实站点验证：`huggingface.co`、`3dpresso.ai`、`futuretools.io` 均抽出 256×256 PNG；最终报告命中 19 条、13 个独立域名，三个点名站点均不再落入分类兜底。13 个独立图标已全部视觉抽查，无空白、模糊、裁切或错误解码。

**7.2 墨迹覆盖率范围修正**

- 生产代码实际执行低墨迹闸门的是 `composeSiteIconPixels`（文档中提到的 `inspectPixels` 现在只为页面封面提供主色比例）；已把分母从 192×192 整张画布改为图标实际绘制矩形，测量脚本同步。
- 128px、宽高比 1.2、墨迹阈值 0.15 均保持原值。新增 96×96、40% 自身墨迹通过和全区域低墨迹仍失败的测试。
- 同源实测中 `low-ink-or-contrast` 从 2 增至 4，并非闸门退化：原来的两个拒绝资产都是铺满画布的大图，不受分母修正影响；新增的两个来自本批新探测到的 ICO/SVG 候选。没有用调阈值掩盖这个结果。

**严格同源 300 条对照**

| 指标 | 整改前 `2bcd03b` | 0.3.7 | 变化 |
| --- | ---: | ---: | ---: |
| 分类封面兜底 | 153 / 51% | **140 / 46.67%** | **−13 / −4.33pp** |
| conventional-favicon-ico | 0 | **19 / 6.33%** | +19 |
| 有质量候选但被拒 | 未记录 | 28 | 新增口径 |
| 无合格候选 | 未记录 | 112 | 新增口径 |
| 最大缩放比 | 1 | 1 | 零上采样保持 |

输入是同一时刻 Chrome Default + Dia 的 415 条有效 HTTP(S) 书签，按 host 交错取 300 条；整改前提交在临时只读 worktree 中复测，避免旧报告 414 条输入造成样本漂移。结果见 `docs/cover-fallback-after-batch-7.md` / `.json`。

**悬浮预览闪退**

- 根因：预览已经展示后，同一行内的 `pointermove` 仍继续执行高速取消逻辑；稍快移动会清空预览，低速后又重新启动 400ms 计时器。
- 修复：速度门只在预览出现前生效；当前条目预览已经激活后，行内移动保持预览，离开条目或按 `Esc` 才清理本地意图状态。
- 真实浏览器回归：高速进入并横移后 500ms 预览数为 0；减速并重新停留 400ms 后为 1；预览出现后在同一行内快速往返，MutationObserver 全程只记录 1 个预览节点，没有消失或重建；控制台 0 错误。

**自动化**

- Node 22.22.2 下 `npm run check` 全通过：34 个测试文件、145 项测试、类型检查与生产构建均通过。
- `npm audit --audit-level=high`：0 漏洞。

### 2026-07-30 · 0.3.6 侧边栏预览、编辑与设置页收口

- 悬停 400ms 后只有存在真实页面快照时才显示预览；预览收窄到最大 286px，保留侧边栏上层信息，且继续使用 `pointer-events: none`，不阻断点击。
- 打开书签编辑、新建文件夹或收藏浮层时同步清除预览，并增加渲染闸门，异步快照晚到也不会与编辑浮层叠加。
- 编辑浮层改为视口居中；在 320×720 和 390×800 两档验证中心偏差均为 0，打开时预览节点为 0。
- 移除展开文件夹残留的内阴影，保持纯白扁平样式；移除搜索框蓝色外描边，改为中性边线。
- 历史会话与设置页入场动画改为纯透明度，不再因横向位移制造瞬时滚动条；侧边栏根容器锁定宽高与溢出。
- 设置页改为无卡片的分区排版，压缩冗余说明，封面样式选项等宽铺满；移除“页面预览快照”设置模块，并修复最近更改条目越界。
- Node 22.22.2 下 `npm run check` 全通过：34 个测试文件、136 项测试、类型检查和生产构建均通过；`npm audit --audit-level=high` 为 0 漏洞，商店素材验证通过。
- 真实浏览器回归：320px / 390px 下 `body`、`#root` 与主面板均无横向溢出；预览分别为 248px / 286px，右侧保留 12px、左侧可见 60px / 92px；设置页 320px 下滚动区 `clientWidth === scrollWidth === 270`，最近更改条目未越界；控制台无错误或警告。

### 2026-07-30 · F3 根因定位：门槛不是瓶颈，墨迹闸门算错了范围（产出第 7 批整改方案）

针对 51% 兜底率做了一轮对照实验，**推翻了「主因是长尾站点没有大图标、只能靠补规则表」这个判断**。真实原因有两条，都是可证伪的实测结论。方案已写入 `docs/REMEDIATION.md` 第 7 批，产品已确认执行范围为 7.1 + 7.2。

**实验一：调低尺寸门槛完全无效（已证伪，不要重试）**

把 `below-128px` 从 128 降到 64，同时放开 `page-essence.ts` 的 `declaredSize >= 128` 预筛，同一份 300 条样本重测：**兜底率 51% → 51%，一条没救回来。** 被拒项只是换了理由：`below-128px` 23 → 11，`low-ink-or-contrast` 2 → 9，`non-square` 0 → 2。实验用的临时改动已全部还原，工作区未残留。

**实验二：墨迹闸门的分母是整张画布，导致尺寸闸门变成死代码**

`inspectPixels` 用 `ink / (width * height)` 计算覆盖率，分母是 192×192 整张画布；但资产**从不放大**（`scale = Math.min(1, 192 / max(w,h))`），只是居中贴入、四周留透明边。于是小图标被扣两次分：

| 资产尺寸 | 在 192 画布中的覆盖率上限（纯实心） | 能否过 0.15 |
| --- | ---: | --- |
| 64px | 11.1% | **数学上不可能** |
| 80px | 17.4% | 需整块实心 |
| 128px | 44.4% | 正常可过 |

即 0.15 阈值自己就隐含了约 105–125px 的下限，与显式的 128px 闸门完全重复，**那行 `width < 128` 实际是死代码**。这解释了实验一为什么零效果。属于算错范围，不是阈值定高。

**实验三：兜底主因是「没有候选」而非「候选被拒」**

153 条兜底中，仅 **25 条**是拿到资产后被闸门拒掉，**128 条（占全样本 43%）连一个候选都没产生**。三道闸门全放开的理论天花板也只有 51% → 43%。

对这 128 条抽样 30 个域名逐一探测：

- **排除了反爬假设。** 怀疑测量脚本缺浏览器 `User-Agent` 被拦，实测带与不带结果完全一致。
- **发现真漏洞：`/favicon.ico` 从未被探测。** 约定路径只有 4 个 `apple-touch-icon` 变体和 `/favicon.svg`。30 个域名里 **3 个的 `favicon.ico` 含 ≥128px 帧**，包括 huggingface.co（9 帧，最大 256）和 futuretools.io（256）。这些旗舰站现在显示的是通用分类插画。
- **实现风险已排除**：这 3 个站点的最大帧**都是 PNG 编码**，抽帧即可复用现有管线，不需要写 DIB 解码器。
- 注意 `src/content/extract.ts` 151 行的 `|| "/favicon.ico"` 不算数——那个 `faviconUrl` 只喂小尺寸 favicon 展示，不进封面管线。

**结论与决策**

- PRD 5.9 的 ≤12% **在当前数据下不可达**：43% 的样本站点在「静态 HTML + 约定路径」下不提供任何合格图标。第 7 批做完预计到 44–46%。
- 产品已决定执行 7.1（补 ICO 来源）+ 7.2（修墨迹闸门分母，**阈值 0.15 保持不动**）。
- 暂不做、已记入「明确不做的事」：按显示尺寸分档启用图标、兜底图按域名做视觉变体、修订 F3 验收指标。这三项待第 7 批实测数字出来后再议。
- **遗留盲区**：脚本测量走后台 fetch 静态 HTML，对应批量扫描存量书签。用户当场收藏走 content script 读实时 DOM，对客户端渲染站点（如 huggingface.co 静态 HTML 里零个 `<link rel=icon>`）应更好，但**从未单独测量过**。若还要在 F3 投入，补这个测量优先于补规则表。

本次只改文档（`docs/REMEDIATION.md`、本文件），未改动任何生产代码。

### 2026-07-30 · 整改验收复核 + 矢量图标闸门修复（兜底率 58% → 51%）

对六批整改做了独立复核。**五批完全达标，第 4 批的兜底率硬指标仍未达成。** 复核中发现并修复了一个 Agent 未识别的真 bug，另修正一处量词错误。

**复核结论**

- Node 22.22.2 下 `npm run check` 全通过；工作区干净；`package.json` 与 `manifest.json` 版本一致（0.3.5）。
- 第 1 / 2 / 3 / 5 / 6 批逐条核对为已满足。第 3 批文档点名的两个坑都没踩：文件夹删除是从 `removeInfo.node` 递归序列化整棵子树，`internalBookmarkIds` 被复用做了内部删除去重。
- **曾怀疑「只处理移动类提案时指纹不变、角标不清」，追证后不成立**：`importNativeBookmarks` 的 `baseChanged` 包含 `nativeFolderPath` 比对，移动会刷新 `updatedAt`，指纹随之变化；删除改书签总数，重命名改标题。三类提案都能正确触发重算，不必额外强制刷新。
- **对新增测试做了变异验证**（这是判断测试是否只是摆设的唯一办法）：往悬浮层塞入一行文字，`sidepanel-preview.integration.test.tsx` 立即失败；把限速器改回「从任务开始计时」的旧实现，`scan-scheduler.test.ts` 两项失败。两次变异均已还原。
- 「明确不做的事」被遵守：`cloud.ts` 与 `supabase/` 零改动；`dist/background.js` 中只有 `cloud.ts` 自身的包装代码，`createClient` / `GoTrueClient` / `PostgrestClient` 均为 0 次出现，supabase 运行时仍被完全 tree-shake；128px、宽高比 1.2、墨迹 0.15 三条硬线数值未被放宽。

**修复一：矢量图标被当成位图判尺寸（真 bug，影响兜底率 7 个百分点）**

测量报告里大量 SVG 以 `nativeWidth: 32` 被 `below-128px` 拒绝。**SVG 是矢量图，`width="32"` 只是默认渲染尺寸，不是分辨率上限**——同一个 SVG 在 192px 下重绘是无损的，不构成上采样。照 32 解码再套 128px 下限，正好挡掉了 PRD 5.5 明确想放行的那批资产（原话：「否则会挡掉大量 SVG 和 `rel=icon` 资产，与压低兜底率的目标直接冲突」）。透明背景合成那半边上一轮修了，这半边还堵着。

- `src/lib/thumbnail.ts` 新增 `normalizeSvgViewport`：把根 `<svg>` 的 `width`/`height` 按最长边改写为 192（保留宽高比与 `viewBox`），让解码器直接栅格化到目标尺寸；矢量资产不再受 128px 下限约束。固有尺寸仍用于上报和方形判定，绘制改用解码后的实际位图尺寸。
- 拿不到固有宽高也拿不到 `viewBox` 时返回「未解析」，退回位图判定，避免给未知画布强加一个可能裁掉内容的 `viewBox`。
- 属性改写用 `[\s]name=` 而非 `\bname=`，`stroke-width` 一类连字符属性不会被误伤（有测试固定）。
- `scripts/measure-cover-fallback.ts` 同步同一套逻辑，保证测量与生产一致、前后可比。
- 新增 5 项 `normalizeSvgViewport` 测试：32px favicon 放大到 192、非方形保持比例、仅有 `viewBox` 时的推导、连字符属性不受影响、无法解析时原样返回。

**真实样本重测（同一组书签源，Chrome Default + Dia，414 条可用取 300 条）**

| 指标 | 修前 | 修后 | 变化 |
| --- | ---: | ---: | ---: |
| 分类封面兜底 | 174 / 58% | **153 / 51%** | **−21 条 / −7pp** |
| high-resolution-rel-icon | 17 | 35 | +18 |
| apple-touch-icon | 95 | 98 | +3 |
| below-128px 拒绝 | 42 | 23 | −19 |
| low-ink-or-contrast 拒绝 | 5 | 2 | −3 |
| 最大缩放比 | 1 | 1 | 零上采样仍通过 |

报告：`docs/cover-fallback-after-vector-svg.md` / `.json`。**质量闸门一条都没放宽，这 7 个百分点是纯收益。**

**修复二：整理提示条的量词错误**

`classify` 提案是按单条书签生成的（`library-insights.ts` 的归类循环逐个 node 产出提案），原文案写「4 组可归类」是错的，已改为「条」。`duplicate` 一条提案确实对应一组同 URL 收藏，保留「组」——没有机械替换。`docs/REMEDIATION.md` 的示例文案同步改成与实现一致。

**F3 仍未达标，且判断为目标本身不可达**

51% 距离 PRD 5.9 的 ≤12% 仍有 39 个百分点。为验证「长尾站点确实没有大图」这个归因是否成立，实测了报告中兜底 Top 30 的全部域名：**25 个确实没有任何 ≥128px 的方形资产**（`animejs.com` 最大 64px、`moonvy.com` 是 `logo_32.png`、`app.exactly.ai` 32px），只有 1 个存在被误拒的 SVG。上一轮 Agent 的归因是对的。

同时注意一个联动：128px 下限当初的部分理由是「悬浮预览信息区要用 96px」，而信息区已随 F22 修订取消，96px 的实际场景只剩卡片视图和整理提案行内。**门槛是否仍需 128，值得连同 F3 目标一起重新评估。** 待产品决策，代码侧不擅自放宽。

### 2026-07-30 · 整改第 6 批：三条最高风险链路的最小集成测试

已按 `docs/REMEDIATION.md` 为撤销、扫描和悬停预览补上直接调用正式实现的测试边界，没有复制业务逻辑，也没有重构两个大文件：

- 撤销事务抽成 `executeProtectedBookmarkMutation`，后台所有原调用点继续走同一入口。测试使用 fake `chrome.bookmarks` 与内存 IndexedDB，覆盖首次快照写入失败时 Chrome 写操作绝不执行、执行成功但 ready 状态回写失败时自动删除刚创建的节点并留下 `undone` 记录，以及删除文件夹前完整序列化嵌套子树。
- 扫描调度增加通用的有界 worker 队列，后台管线显式使用 4 路并发；单条 worker 抛错会转成该条失败结果，后续项目继续处理。自动化同时保留同注册域串行、从前一任务结束后等待 1 秒、失败后仍限速和跨域并行断言。
- 悬停预览的生产渲染门抽为 `BookmarkPreviewLayer`：快照或定位任一缺失就返回 `null`，存在快照时只渲染一张 `img`。测试分别断言单图、无快照零节点、浮层零文字。

**验证**

- Node 22.22.2 下 `npm run check` 全通过：34 个测试文件、130 项测试、类型检查与生产构建均通过。
- 按整改文档要求，曾临时故意让无快照路径渲染空 `<aside>`；`sidepanel-preview.integration.test.tsx` 准确出现 1 项失败，证明渲染门回归会被拦截。随后已恢复正式实现并重新跑完全量检查。
- 扫描管线测试以 10 条任务验证运行中最大值严格为 4，第 3 条故意失败后第 10 条仍完成；结果数组完整保留 10 条。

**仍待真机验收**

- 自动化包住的是事务与调度不变量，不能替代在解压安装的 Chrome 扩展里删除并恢复含 20 条书签的真实子树，也不能替代 300 条真实书签的并发提速和吞吐测量。

### 2026-07-30 · 整改第 5 批：拼音按需加载与搜索计算防抖

已按 `docs/REMEDIATION.md` 完成两项侧边栏搜索性能整改：

- `search.ts` 不再静态导入 `pinyin-pro`，本地索引首屏只生成词法字段和中文二元组。用户首次输入纯 ASCII 字母且长度 ≥2 时，才动态加载拼音库并原位补齐拼音索引；加载期间先呈现已有的标题、标签、摘要和中文词组结果，成功后自动重跑合并拼音结果。
- 拼音动态加载 promise 与已生成索引都会复用，第二次查询不会再次下载或计算。动态包加载失败会返回 `false`，词法结果照常保留，不向 React 抛错。
- Vite 明确把拼音库命名为独立 `pinyin-search-*` 动态 chunk。原先 298KB 的 `usage-stats` 自动共享包实际上混合了拼音字典、搜索骨架、AI 用量和会话代码；拆分后它只剩约 13KB 的跨入口共享逻辑。
- 搜索输入继续即时受控，昂贵的索引扫描和书签树递归过滤改读 140ms 防抖值。连续输入只在停顿后计算一次；清空和 Esc 会立即恢复原书签树、展开状态与滚动位置，不等待定时器。

**包体实测**

- 改动前 `dist/sidepanel.html` 首屏脚本及全部 `modulepreload` 合计 607,106 字节，其中 `usage-stats-CmSub0pD.js` 为 298,168 字节。
- 改动后首屏合计 322,732 字节，减少 284,374 字节（46.84%）；`usage-stats-Du6fIh22.js` 为 13,286 字节。
- 拼音字典独立为 `pinyin-search-C3j2QhOZ.js`，286,766 字节；`dist/sidepanel.html` 没有它的 `modulepreload`，只在首次拼音查询时读取。

**自动化与浏览器开发预览**

- Node 22.22.2 下 `npm run check` 全通过：32 个测试文件、123 项测试、类型检查与生产构建均通过；`git diff --check` 通过。
- 新增拼音延迟加载测试，确认索引初始不含拼音、首次查询后召回中文标题；注入加载失败时仍保留词法结果且不抛错。
- 新增 2,000 条模拟收藏的输入防抖测试：连续快速输入 10 个字符时输入框逐字即时更新，139ms 内不计算，第 140ms 只计算一次；清空同步生效。
- Playwright 360px 开发预览确认：首屏没有 `pinyin-pro` 请求；首次输入 `sjsx` 可召回「设计赏析」，只加载一次拼音资源；第二次输入 `gjyxl` 可召回「工具与效率」且请求数不增加。新查询 50ms 时仍显示上一批结果，160ms 时完成更新；清空与 Esc 均立即恢复完整书签树。控制台 0 error / 0 warning，无横向溢出。

**仍待真机验收**

- 解压安装最新 `dist/`，在真实 1,000 条书签库中用 Performance 面板测侧边栏首帧是否 ≤100ms；包体和计算路径已达到代码验收，但开发服务器与单元测试不能替代扩展安装态启动耗时。
- 在真实 2,000 条书签库连续输入 10 个字符，核对输入法组合输入、键盘重复和低性能设备上结果仍在停顿后 150ms 内更新。

### 2026-07-30 · 整改第 4 批：封面测量、双主题站点标识与规则表

已按 `docs/REMEDIATION.md` 的 4.1 → 4.2 → 4.3 → 4.4 顺序完成：

- 新增开发期 `measure:covers` 工具，输入 Chrome Bookmarks JSON 或 URL 清单，真实抓取并执行与生产一致的站点标识管线；不足 300 条会直接拒绝生成验收报告。报告包含来源分布、兜底率、三类质量拒绝、零上采样结果和兜底域名 Top 30，原始书签 URL 与路径不会写入仓库。
- 样本来自本机 Chrome Default 与 Dia 的真实书签库：共 414 条有效 HTTP(S) 书签记录，按 host 交错抽取 300 条；保留真实重复收藏条目，因为产品指标按列表行计算。未提交原始书签文件。
- 透明站点图标现在先合成到真实 UI 承载色，再分别生成 192×192 的浅色和深色 WebP；只对接近承载色、会消失的像素做中性对比补偿，已有品牌色保持不变。缓存同时保存 `iconDataUrlLight` / `iconDataUrlDark`，旧的单版本缓存会自动重新扫描；页面代表图也补上 `Math.min(1, …)`，保持绝不上采样。
- 显示层使用 `<picture media="(prefers-color-scheme: dark)">` 自动选择当前主题版本。单元测试固定同一张「透明底 + 深色图形」在浅色和深色承载面都通过墨迹闸门。
- 站点规则从 17 条扩到 167 条。首轮完整覆盖实测兜底 Top 30，之后按每 30 条一轮扩充；优先补齐掘金、SegmentFault、CSDN、简书、豆瓣、微博、语雀、飞书文档、腾讯文档和石墨等中文站点。每条新增规则都有品牌资产入口和分类封面结果，测试会逐 host 断言命中自己的规则。
- Agent 回答的「相关收藏」改用与书签列表相同的站点标识管线，并强制不走页面图例外；旧 `favicon.ts`、`SiteIcon.tsx` 和对应测试已删除，生产代码与测试中不再构建 Chrome 32px `_favicon`。

**真实样本测量**

- 改动前：分类兜底 `179 / 300 = 59.67%`；`low-ink-or-contrast` 拒绝 14 个；小于 128px 拒绝 42 个；最大缩放比 1。
- 仅完成双主题合成后：分类兜底 `174 / 300 = 58%`；`low-ink-or-contrast` 拒绝降到 5 个；小于 128px 拒绝 41 个；最大缩放比仍为 1。
- Top 30 规则后：`172 / 300 = 57.33%`。此后按 60 / 90 / 120 / 150 新规则节点重复测量，结果在 57.33%–58.33% 之间波动，说明真实网络可达性会造成约 1 个百分点波动，继续堆通用规则已经明显收敛。
- 最终 167 条规则：分类兜底 `172 / 300 = 57.33%`；规则表品牌资产命中 3 条，Apple touch icon 97 条，manifest 9 条，高分辨率 rel icon 17 条，页面图例外 2 条；`low-ink-or-contrast` 5 个、小于 128px 42 个、非方形 0 个，最大缩放比 1，零上采样通过。
- 未达到 ≤12% 的主因不是透明合成或规则数量，而是样本有大量只出现 1–2 次的长尾域名，且没有公开的 ≥128px 方形品牌资产；Top 30 也只有每域 2 条。若继续追到 12%，需要对约 140 个当前兜底条目逐站人工寻找、验证并长期维护专用资产 URL，预计至少再投入 3–5 个工程日，并且站点改版后仍需持续维护。未使用第三方 favicon 服务，也未降低 128px、方形和 15% 墨迹三道质量门槛。

**自动化与浏览器开发预览**

- Node 22.22.2 下 `npm run check` 全通过：31 个测试文件、121 项测试、类型检查与生产构建均通过；`git diff --check` 通过。
- 同一套测量脚本对全部 126 条被接受的站点标识行同时执行浅色、深色真实像素检查，超过「抽查 20 个」要求；没有深色图形贴在深色底上消失的通过项。
- Playwright 360px 开发预览确认：书签列表的 `<picture>` 在浅色/深色模拟下切换到不同资源，页面无横向溢出；Agent「相关收藏」显示 26×26 管线 A 标识，两种主题均切换成功，DOM 中没有 `_favicon`；预览态控制台 0 error / 0 warning。

**仍待真机验收**

- 在真实安装扩展跑一次「更新站点标识」，确认旧缓存迁移后浅色/深色 WebP 都落库，并在系统主题切换时无需重扫即可换图。
- 用真实 Agent 回答抽查「相关收藏」清晰度和分类封面兜底；开发预览已验证组件链路，但不能替代安装态 Service Worker、IndexedDB 与真实网络资产。
- 产品需决定是否接受 57.33% 的高质量分类封面兜底，或批准 3–5 个工程日逐站维护专用品牌资产；当前实现选择质量地板，不用模糊小图换数字。

### 2026-07-30 · 整改第 3 批：撤销、快照、调度与推荐一致性

已按 `docs/REMEDIATION.md` 完成第 3 批四项逻辑整改：

- Chrome 原生书签管理器删除书签或文件夹时，会直接使用删除事件携带的完整子树生成一条 30 天撤销记录；文件夹只记一条批次但保留全部层级、位置和子项。设置页会明确标注来源为「Chrome 书签管理器」。
- Aarre 自己执行删除、批量整理删除或撤销“新建项目”时，统一在 Chrome 写入前标记内部书签 ID，删除事件只更新本机资源绑定、不再重复生成第二条撤销记录。文件夹删除还会递归清理所有子书签绑定。
- 从 Aarre 打开 URL 时记录目标 tab 和 URL；页面加载完成且最终 URL 匹配时立即开始快照采集，不再等 5 秒。普通浏览仍保持 5 秒停留策略，采集仍复用原有的活动标签、前台窗口、无痕、协议、敏感域名和用户排除清单检查。
- 同域调度从「上一次任务开始」改为「上一次任务结束」后再等待 1 秒；任务抛错也会记录结束时间，避免连续失败绕开限速。不同注册域继续并行。
- 保存浮层的文件夹建议与整理提案改为共用同一个候选文件夹评分器。整理侧只在共享首选结果上叠加「至少 3 条同主题、至少 2 条相似收藏支持、不重复移动」等批量约束；搜索索引每次生成提案只构建一次，避免重复计算拼音索引。

**自动化验证**

- Node 22.22.2 下 `npm run check` 全通过：31 个测试文件、121 项测试、类型检查与生产构建均通过。
- 原生删除测试覆盖「含 5 条书签的文件夹事件 → 单条 ready 快照 → 原位置完整恢复」，并验证内部撤销删除前后的去重钩子。
- 快照目标匹配测试覆盖 URL 规范化、错误落地页不即时采集和无效 URL。
- 调度测试覆盖 3 秒慢请求结束后再等 1 秒、前一请求抛错后仍限速，以及跨域任务不互相等待。
- 文件夹一致性测试固定同一条收藏和同一份文件夹树，确认保存建议首选与整理提案目标完全一致。

**浏览器开发预览验证**

- 设置页「最近的更改」正确显示 `Chrome 书签管理器删除“产品资料”`，并附带 `Chrome 书签管理器 · 回收站` 来源标签和可用的「撤销」按钮。
- 控制台 0 error / 0 warning。

**仍待真机验收**

- 在 Chrome 原生书签管理器分别删除单条书签和含 5 条书签的文件夹，确认设置页只出现一条记录、恢复层级和顺序正确；再从 Aarre 删除一次，确认没有重复记录。
- 从 Aarre 打开无快照书签并在加载完成后立即关页，确认 1 秒内已落库；同时验证排除域名、无痕窗口不采集，普通浏览仍需停留 5 秒。
- 用真实扫描请求时间线核对同域任务的实际间隔，并用同一条真实页面对照保存浮层与整理提案的首选文件夹。

### 2026-07-30 · 整改第 2 批：让整理提案主动触达用户

已按 `docs/REMEDIATION.md` 完成第 2 批整改：

- 全目录扫描完成后自动在本机生成整理提案；提案缓存使用「Chrome 书签数 + 本机资源最后更新时间」指纹复用，整理生成失败会被隔离，不会把已经完成的扫描改成失败。
- 提案内容生成稳定签名并写入 `chrome.storage.local`。提案内容未变化时沿用「暂不」状态，24 小时后重新提示；内容变化时立即重新出现。
- 扩展图标角标持续显示待处理提案数，超过 99 条显示 `99+`；全部处理完或选择「暂不」后清空。临时错误角标结束后会恢复整理角标，不会永久覆盖。
- 侧边栏新增带文字的整理建议横幅，明确列出重复、失效、可归类和大文件夹数量；「去处理」直达全页管理器的整理提案视图，「暂不」隐藏 24 小时。
- 全页管理器六个视图的统一页头都增加「返回侧边栏」，不再只有收藏库视图能返回。
- 整理提案继续完全由本机规则生成，没有新增任何 AI 请求。

**自动化验证**

- Node 22.22.2 下 `npm run check` 全通过：31 个测试文件、115 项测试、类型检查与生产构建均通过。
- 新增 4 项整理通知缓存测试，覆盖指纹、24 小时隐藏、提案变化立即重现、稳定签名和 `99+` 角标边界。
- `git diff --check` 通过。

**浏览器开发预览验证**

- 侧边栏正确显示「发现 12 条可以整理的地方」及 `3 组重复、5 条失效、4 组可归类`；点击「暂不」后横幅立即消失。
- 管理器的收藏库、整理提案、待读队列、报告、主题图谱和重新发现六个视图均验证「返回侧边栏」可见。
- 侧边栏 320px、管理器 360px 宽度均无横向溢出；控制台 0 error / 0 warning。

**仍待真机验收**

- 在真实安装扩展中跑完整扫描，核对扫描完成后的角标、侧边栏数量和整理提案内容一致，并确认生成阶段 AI 服务商请求数为 0。
- 验证关闭再打开侧边栏仍保持「暂不」、24 小时后恢复提示、书签内容变化后立即重现，以及全部提案处理完后角标清空。
- 从六个真实管理器视图逐一返回 Chrome 侧边栏，确认 `chrome.sidePanel.open()` 的用户手势链路有效。

### 2026-07-30 · 整改第 1 批：兑现已有能力

已按 `docs/REMEDIATION.md` 完成第 1 批五项整改：

- 删除书签与文件夹的确认文案改为如实说明「30 天内可在设置页恢复」，设置页「最近的更改」同步解释会保留并恢复完整文件夹结构。
- 修正悬浮预览意图检测方向：高速移动会取消计时与已显示预览，只有低速停留才启动 400ms 计时；纯视觉快照容器改为 `aria-hidden="true"`。
- 所有 AI Composer 调用点都必须显式传入 `configured`；搜索空结果、树过滤空结果、主输入框和会话页在未配置 AI 时都只进入设置页。提交函数本身也增加未配置保护，不会向 AI 服务商发请求。
- 书签树与完整排序结果的标题子串使用现有强调色高亮；拼音召回但原文无子串时不伪造高亮。渲染继续使用 React 文本节点，不使用 HTML 注入。
- README 删除 pgvector / Gemini Embedding 的现行能力承诺，明确旧 Supabase / Google OAuth 同步未启用、F14 正在改为自建服务，并把删除行为更新为 30 天本机撤销快照。

**自动化验证**

- Node 22.22.2 下 `npm run check` 全通过：30 个测试文件、111 项测试、类型检查与生产构建均通过。
- 新增 6 项标题高亮边界断言，覆盖大小写重复命中、`<` / `&`、emoji、正则特殊字符、纯拼音命中不高亮和清空查询。
- README 定向搜索确认不再包含 `pgvector`、`Gemini Embedding`、「无法撤销」「永久删除」等过时承诺。

**浏览器开发预览验证**

- 在 309 条预览书签中搜索 `Design`，所有标题子串均渲染为 `<mark>`；无子串的结果正常出现但不高亮。
- 未配置 AI 时，两个空结果入口均显示配置引导；点击后直接进入设置页。Playwright 请求记录除静态开发资源外为空，控制台 0 error / 0 warning。
- 设置页已显示新的 30 天恢复说明。

**仍待真机验收**

- 真实 Chrome 安装态下快速划过 20 行、慢速停留 400ms、快速甩动后重新停留，以及屏幕阅读器不朗读快照容器。
- 在真实书签库删除含 5 条书签的文件夹，并核对恢复后的层级、位置与排序。
- 在真实扩展 DevTools Network 中遍历四个 AI 入口，确认未配置时服务商请求数为 0。

### 2026-07-30 · F22 决策落地 + 整改方案已出（下一个 Agent 从这里开始）

**产品负责人已就 F22 拍板：悬浮预览就是一张裸截图，不恢复信息区，也不加采集时间角标。** 代码不动，`docs/PRD.md` 改为与实现一致。已改的位置：

- F22 全节重写（第 258 行起），开头加了 2026-07-30 修订说明，写清新方案、被替换的旧论证不再保留、以及两个已被接受的代价（新用户在攒出快照前 hover 无反馈；不显示快照新旧）。
- 交互细节表：`鼠标可进入` 从「是」改为「否 / `pointer-events: none`」；意图检测一行补了「写反会变成划得越快越容易弹出」的警告；键盘可达一行补了 `aria-hidden` 要求。
- 验收标准全部重写，新增「悬浮层内除快照外没有任何元素」「没有快照时完全不渲染」「点击穿透生效」三条，并补了「缓慢停留必须触发」的反向用例。
- 5.7 存储与显示规格：显示层表格改为「没有就整个悬浮层不渲染」；`snapshotAt` 字段注释改为「仅用于容量清理时按时间淘汰，不呈现给用户」；192px 站点标识的理由里去掉了已不存在的「悬浮预览信息区 96px」。

**整改方案已写好：`docs/REMEDIATION.md`。** 六个批次、按投入产出比排序，每条都带现状、理由、改法、验收标准和涉及文件，可直接交给 Agent 执行。要点：

- 第 1 批（半天）兑现已有能力：删除确认文案、F22 意图检测方向、F4 两个漏配的 AI 入口、F1 命中高亮、README 过时描述。
- 第 2 批（1–2 天）是投入产出比最高的一批：把 F7 整理提案接到扫描完成事件上，加扩展图标角标和侧边栏带文字入口，顺带修 F5 全页各视图回侧边栏。
- 第 4 批（F3 兜底率）**必须先做测量工具再补规则表**，否则是盲改；透明背景合成排在补规则之前，因为它可能单独就能显著降低兜底率。
- 文档末尾有「明确不做的事」和「需要真机验收的清单」，用来防止范围蔓延和虚报完成。

**下一个 Agent 请先读 `docs/REMEDIATION.md`，再回来看下面这一节的原始审查依据。**

### 2026-07-30 · 独立代码审查（只读，未改动任何代码）

对照 `docs/PRD.md` v1.2 逐条核对本轮云端外交付，审查基线 `d29044d`（0.3.2）。已在 Node 22.22.2 下实跑 `npm run check`，28 个测试文件、98 项测试、类型检查与生产构建全部通过，与本文档记录一致。审查期间仓库连落两个提交，另有 agent 在并行工作。

**结论：地基扎实，缺口集中在最后一公里的产品触达，以及 PRD 点名的硬指标尚无验证手段。** 20 项在范围内的需求平均完成度约 78%。

**需要产品负责人拍板的一条：F22 的实现与 PRD 已完全对立，但 PRD 未同步修改**

> **已解决（2026-07-30）。** 产品负责人裁定：保留纯快照实现，采集时间角标也不要，PRD 改为与实现一致。详见上一节。下文保留原始审查记录，只作为决策依据，**不要据此把信息区改回来**。

`e040cac` 和 `d29044d` 把悬停预览收敛成一张裸截图：删除信息区（站点标识、标题、摘要、标签、文件夹、收藏时间、上次打开时间）、删除采集时间角标、没有快照时整张卡不渲染、卡片 `pointer-events: none`。本文档记录的理由是「用户根据安装版截图确认」，若确为产品决策则不算实现偏差，但 `docs/PRD.md` F22 一字未改，两边现在直接冲突，后续 agent 会拿到自相矛盾的依据。两条验收标准已永久无法通过：「没有快照时预览窗为纯信息卡，布局完整」「在一份从未打开过任何页面的存量书签库上，全部预览窗为纯信息卡且排版正常」。

需要确认是否接受的两个代价：

1. **刚安装的用户 hover 任何书签都没有任何反应**，快照库要靠日常使用逐渐长出来。PRD 原设计是「刚安装的用户看到的不是一个残缺的功能，而是一个没有配图的功能」。
2. **采集时间角标被一并删除。** 这与「要不要信息区」是两件事。PRD 要求「快照旁标注采集时间（如「快照 · 3 天前」），因为页面会改版」，视觉区的全部可信度建立在「这是真实的」之上。现在会把可能半年前的截图当作页面现状展示。**建议无论方向如何都把这一条加回。**

**建议立刻修的两条（改动量都很小）**

- **删除确认文案与实际能力矛盾。** `SidePanelApp.tsx` 4425–4426 行写「此操作无法撤销」，但 `runProtectedBookmarkMutation` 做了写前快照、快照失败拒绝执行、二次回写失败自动回滚，删除内容 30 天内可在设置页「最近的更改」恢复。这句文案把 F2 的全部价值对用户隐藏了。
- **F7 整理提案触达为零。** `buildLibraryInsights` 只在打开全页管理器时被调用，扫描完成没有任何回调、通知或角标；进入全页的唯一入口是侧边栏右上角一个无文字的图标按钮。PRD 要求「扫描完成后自动生成提案」并「在提案产生时主动引导用户去全页处理」，两条都未实现。逻辑本身质量不错（删除类默认不勾、失效判定严格基于 HTTP 检测、生成过程 0 次 AI 调用），缺的只是让用户看见。

**F3 达不到 PRD 硬指标，且目前无法测量**

- `cover-registry.ts` 只有 17 条规则覆盖 32 个域名，PRD 5.4 要求 150 条以上，连示例表点名的 `juejin.cn`、`segmentfault.com` 都未收录。
- PRD 5.5 为提高命中率专门放宽的「允许透明背景，合成到卡片表面色」未实现，`thumbnail.ts` 183 行只有 `clearRect` 没有 `fillRect`，等于又把 SVG 和 `rel=icon` 资产挡在门外。附带影响：墨迹闸门的对比度按白底计算，深色模式下判定不准。
- 「零上采样」代码层面做到了（缩放比硬限制 ≤ 1），但「兜底率 ≤ 12%」既无实现支撑也无任何测量手段。**建议先做一个能统计兜底率与来源分布的工具，否则这个指标只能靠猜。**

**逻辑写错或与验收标准不符**

- 悬浮预览「快速划过不触发」的判断写反：`SidePanelApp.tsx` 1757–1762 行在速度超过 0.65 的分支里反而调用 `armPreview` 启动 400ms 计时器，紧接着又调 `onPreviewLeave`，两个动作互相矛盾。
- 未配置 AI 时仍有两个入口会发出失败请求：搜索无结果的「让 AI 帮我找」按钮未检查 `aiConfigured`，聊天页的 `AgentComposer` 未传 `configured`（默认 `true`）。F4 验收标准要求「不产生任何失败请求」。
- F1 的「命中项高亮」未实现，`BookmarkTree` 不接收 query/highlight 参数。
- `scan-scheduler.ts` 68–74 行的同域限速从任务**开始**计时，单次请求超过 1 秒时下一次可立即开始，实际间隔为 0。
- Chrome 原生书签管理器里的删除不进 `undoSnapshots`，`onRemoved` 只更新了 `nativeBookmarkIds`。
- F22 三个采集时机里，「从 Aarre 打开书签」被合并进了「停留 5 秒」这条路径，存量书签补齐速度慢于设计预期。
- F9 的「AI 推荐替代链接」未实现，Web Archive 地址是直接拼 URL 而非查询 API。
- F12 的文件夹建议与 F7 的「可归类」判定各写了一套算法，PRD 说这两者「是同一套」。

**违背 PRD 原则但本轮不在范围内（记账，勿在 F14 之前擅动）**

- `cloud.ts` 147–167、222–239 行会把网页正文与 `x-bookmark-layer-ai-key` 一起发往 Supabase Edge Function，违反第 1 章第 3 条原则和第 11 章。当前构建未配置 Supabase 环境变量，已确认 `dist/` 中 `supabase-js` 被完全 tree-shake，不会触发。
- README 20、25、128 行仍在承诺 Supabase 同步、pgvector 语义搜索，以及「删除原生书签只移除本机绑定」，三处都已过时。
- `favicon.ts` 24–46 行仍构建 Chrome `_favicon` URL，`SiteIcon` 在 Agent 的「相关收藏」区域使用它。48px 书签列表已改用管线 A，这条守住了；但 PRD 5.10 把 `_favicon` 列为排除项。

**性能**

- `pinyin-pro` 的字典表（297KB 未压缩）打进了侧边栏首屏 `modulepreload` 的共享 chunk。扩展从本地磁盘读取不走网络，gzip 不起作用，每次打开侧边栏都要解析这 297KB。F1 要求 1,000 条书签下首帧 100ms 以内，这是最大的单项开销，适合改成按需加载。
- 搜索无防抖，每次按键同步跑一遍 O(n) 索引扫描加一遍整棵书签树递归过滤。

**测试覆盖是倾斜的**

98 个用例全部落在 `src/lib/` 的纯函数上。`SidePanelApp.tsx`、`background.ts`、`ManagerApp.tsx` 合计占代码量 54%，测试用例为 0，而撤销执行链、扫描调度、封面管线组装、快照采集时机、预览交互全都在这三个文件里。`thumbnail.ts` 只有 2 个用例且都在测 SVG 安全，整个质量闸门未覆盖。**0.3.1 与 0.3.2 从这两个文件删掉 209 行、移除 F22 信息区时，改动前后两次 `npm run check` 都是 98 项全绿。** 当前覆盖结构能保证不崩，保证不了行为符合预期。建议优先补撤销执行链、扫描管线、预览渲染门三条最小集成测试。

**审查确认做得好的地方**

- 撤销安全超出 PRD 要求：除写前快照和失败拒绝执行外，二次状态回写失败时会自动把书签回滚并明确告知用户。所有用户可触发的 `chrome.bookmarks` 写路径均有保护。
- IndexedDB v1→v4 按 `oldVersion` 增量建表，老用户跳级升级时三个新 store 都能建出且 `resources` / `outbox` 不被重建；PRD 12.1 的版本分配与 `undoSnapshots` / `pageSnapshots` 命名区分严格执行。
- 权限克制：`host_permissions` 只写死三个 AI 域名，`http://*/*` 确实只在 `optional_host_permissions`；快照用 `tab.incognito` 判断无痕；内网地址在发出任何请求前拦截；数据导出有测试断言不含完整 Key 与尾号。
- 预览视觉区没有拿 `og:image` 或分类封面充数，这条纪律守住了。
- 本文档对未完成项的标注是诚实的，没有伪造 Extension ID 或隐私政策地址。唯一需留意的是「当前进展」开头「均已有正式实现」的措辞，它描述的是「代码写了」，容易被读成「验收通过了」。

审查看板（含逐需求完成度与可筛选清单）：`~/.cursor/projects/Users-nefish-Desktop-WorkSpace-Coding-Aarre/canvases/aarre-code-review.canvas.tsx`。

### 2026-07-30 · 0.3.2 悬停预览进一步收敛为纯快照

- 用户根据安装版截图确认：即使存在真实快照，悬停层也只需要展示快照本身。
- 删除悬停层中的站点标识、域名、标题、摘要、标签、文件夹、收藏时间、上次打开时间、快捷键提示和“快照 · 今天”角标。
- 保留 16:10 快照画面、卡片边界、阴影、避开鼠标热区的定位和点击穿透；没有快照时仍完全不渲染。
- 开发预览临时注入快照协议响应后验证：卡片只有 1 个直接子元素和 1 张图片，文字内容为空，高度约 213px，与书签行间隔约 14.5px，点击仍穿透；该证据只覆盖 UI 渲染，不冒充真实快照采集。
- `npm run check` 通过：28 个测试文件、98 项测试、类型检查和 0.3.2 生产构建全部成功；商店素材验证通过，依赖审计为 0 个已知漏洞。

### 2026-07-30 · 0.3.1 悬停预览改为严格快照门与非阻断定位

- 悬停 400ms 后只查询本机真实页面快照；没有快照时不再显示任何信息卡或占位卡。
- 有快照时，卡片默认显示在当前鼠标所在书签行下方并保留 14px 间隔；下方空间不足时改到书签行上方，同样保留间隔，不覆盖当前鼠标热区。
- 预览卡设置为点击穿透，不再承载关闭按钮或其他可点击控件，不会阻断底层书签的正常点击和滚动。
- 离开书签行时立即取消尚未完成的异步快照展示资格，避免查询结果晚到后闪出卡片。
- 本地开发预览已验证：对没有快照的书签悬停超过 550ms，页面中预览卡数量保持为 0。
- 开发预览临时注入快照协议响应后验证：卡片位于书签行下方约 14.6px，`pointer-events` 为 `none`，命中测试落到下层元素而不是卡片；该证据只覆盖 UI 定位与点击穿透，不冒充真实扩展快照采集。
- `npm run check` 通过：28 个测试文件、98 项测试、类型检查和 0.3.1 生产构建全部成功；商店素材验证通过，依赖审计为 0 个已知漏洞。

### 2026-07-30 · 0.3.0 完成全部云端外 PRD 功能、本地上架材料与最终自动化收口

**F15 · 隐私与合规**

- 新增随扩展构建的 `privacy.html`，明确正文直达所选 AI 服务商、本机数据、未来可选同步白名单、第三方站点/图片请求、页面快照敏感域名边界、权限用途、导出和删除方式。
- 设置页新增“隐私与数据自主权”：可打开隐私政策，并一键导出完整智能层 JSON。导出包含资源、离线队列、站点标识、页面快照、撤销批次、Agent 会话、扫描状态、AI 用量、配额接口状态和安全设置。
- 导出明确排除 API Key、Key 尾号和登录令牌；新增隐私契约测试，在本机存入完整测试 Key 后确认序列化结果不含完整值或尾号。
- `docs/CHROME_WEB_STORE.md` 已写好单一用途、完整商店描述、隐私问卷和每项 Manifest 权限的审核披露文案。

**F16 · 计费与配额接口**

- 新增统一 `runAiGatewayCall`，所有 AI 富化和 Agent 请求均由该层执行；预留 `byok / free / pro` 用户等级、月 token 配额、配额前置检查与按操作用量计数。
- 当前默认仍是 BYOK，不自行发明收费方案；达到未来配额时会在服务商请求前拒绝。相关测试覆盖默认层、计数和硬拦截。
- 扫描确认页新增可持久化的“单次 AI 费用上限”；估算始终先展示，只有用户真正确认启动时才硬拦截，避免高费用误触。

**F17 · 商店素材**

- 版本提升到 0.3.0；16/32/48/128 px 正式图标继续随 Manifest 构建。
- `store-assets/` 已交付四张商店截图、440×280 小型宣传图和 35.63 秒、1280×800、30fps、H.264/AAC 的中文字幕宣传视频；源画面与真实性边界见 `store-assets/README.md`。
- 新增 `npm run verify:store-assets`，实际验证 5 张 JPEG 的文件类型与精确尺寸，以及视频时长、尺寸、帧率、视频/音频编码。
- 素材使用与生产组件相同的 UI，但书签内容是避免泄露私人数据的代表性评审场景；正式上传前必须与同版本安装扩展逐屏核对，不能用素材冒充扩展 API 真人验收。

**F18 / F19 / F20 · 本地知识入口**

- 全页新增周报/月报、主题图谱与重新发现三类正式视图。报告本机计算注意力迁移、主题趋势、90 天很少通过书签打开、知识角度缺口、死链和大文件夹健康度，不做只有数量的流水账，也不额外产生 AI 成本。
- 主题图谱从已有 `topics` 生成最多 24 个节点及共现边，使用响应式 SVG 呈现；640px 宽度实测无横向溢出。
- 遗忘曲线按收藏时间、最近使用、近期主题和当前活动页面标题/域名重排旧收藏；侧边栏新增紧凑“这会儿值得重看”，全页提供完整重新发现列表。
- 新增知识洞察测试，固定时间验证注意力迁移、90 天旧藏、主题图谱和当前语境召回。

**M2 补强与安全收口**

- 失效链接提案新增“打开原网址”和真实 Web Archive 历史版本入口；删除仍默认不选、仍需二次确认，不让 AI 编造替代网址。
- 报告的大文件夹统计从重复遍历优化为一次计数；300–2,000 条规模下避免不必要的平方级计算。
- 开发预览补齐失效链接恢复入口与数据导出协议，便于持续人工回归；预览数据不进入生产构建。

**本轮验证**

- `npm run check` 全绿：28 个测试文件、98 项测试、TypeScript 类型检查与生产构建全部通过。
- `npm run verify:store-assets` 通过：5 张 JPEG 尺寸正确；视频 35.63 秒、1280×800、30fps、H.264/AAC。
- 浏览器开发评审通过：侧边栏 `390×844` 设置页无横向溢出，隐私政策、Agent 会话导出文案和完整 JSON 下载成功；管理页 `640px` 下失效链接卡片、Web Archive 地址和响应式布局正确；报告、主题图谱、重新发现与整理二次确认已逐屏检查。
- 商店截图和视频四个关键帧已逐张目视检查，字幕没有裁切、界面没有破图。

**明确未通过 / 外部门**

- 尝试在 Chrome 内部扩展管理页加载最新 `dist/` 时，浏览器控制工具以安全策略拒绝 `chrome://extensions`，并明确禁止换通道或间接绕过。因此本轮不能声称完成 PRD 0.2 第 3 条“真实安装扩展”门；开发预览证据与安装态证据保持分开。
- 正式 Extension ID 只能由 Chrome Web Store 开发者后台生成，仓库不能伪造；公开 HTTPS 隐私政策和服务条款已经发布。
- F2 真实 20 条子树撤销、F3 真实 300 条来源分布、F7 人工合理率、F9 300 条/5 分钟、F11 相比串行与账单偏差、F1 1,000 条首帧和 F8 2,000 条真人体验仍需安装态真实数据。
- 语音制作 Skill 要求正式 TTS 使用 `OPENAI_API_KEY`；当前环境未配置，所以交付的是无需音频也能理解的中文字幕视频，不用临时系统音冒充正式旁白。
- F8 第二/三层受尚未拍板的 D7 约束，且 PRD 第 12 章明确本轮只做第一层；F14 与 F21 按用户要求排除。

### 2026-07-30 · F7 / F9 / F10 / F11 / F12 / F13 完成本地产品链路与自动化阶段

- F7 在全页管理器新增“整理提案”视图：使用既有 `topics` 本地聚类生成可归类建议，展示重复、失效和超过 150 条的大文件夹；支持分组勾选、移动前后路径预览、最多 200 项批量应用和整批撤销。移动建议默认勾选；任何删除建议默认不勾选，选中删除后还要二次确认。
- F10 直接使用 `nativeBookmarkIds` 识别同资源键重复项，读取 Chrome 的 `dateAdded` 后默认保留最早收藏；预览会逐条列出保留位置和待删除位置，执行时继续校验标题、URL 和父文件夹未被外部改动。
- F9 全目录扫描先做真实链接检查：优先 HEAD，405/501 时降级为带 `Range: bytes=0-0` 的 GET；404/410 判失效，401/403 判登录限制，内容页重定向首页判软 404，5xx/超时连续三次才升级失效。检测结果写入资源记录并进入整理提案，AI 摘要永不作为死链依据。
- F11 将扫描调度改为 4 路并发、按注册域轮转，同域任务串行且启动间隔不低于 1 秒；内部、局域网和敏感地址不会发起网络请求。开始前展示待检查数、会调用 AI 的条数、预计分钟、当前服务商/模型和人民币费用估算；未知自定义模型明确显示无法可靠估算。
- 每次富化解析服务商实际 token 用量；服务商未返回时使用显式标记的本地估算。任务状态显示实际输入/输出 token 和费用，设置页保存仅本机累计扫描用量；价格表标注 2026-07-30 更新并说明汇率与最终账单边界。
- F12 保存浮层用页面标题、描述、摘要和既有 AI 元数据进行本地相似召回，推荐最多三个现有文件夹；点击即选择真实 Chrome 目标文件夹，不增加 AI 请求。
- F13 全页新增“待读队列”，按 Chrome `dateLastUsed` 将未记录或较久未通过书签打开的内容排前；文案严格使用“很少通过书签打开”，不误称用户从未阅读。
- 新增整理规则、成本、链接健康、域调度和用量统计测试；类型检查、21 项针对性测试和正式构建已通过。
- 尚未完成：300 条真实书签的 5 分钟死链门、相比串行下降 60%、费用偏差 ≤30%、整理建议人工合理率 ≥70%、应用后真实书签树完整撤销，以及安装版保存建议/待读队列交互。这些依赖真实用户书签与已安装 `dist/`，不能由单测或开发预览冒充，统一留到最终验收。

### 2026-07-30 · F4 / F5 / F6 / F22 完成代码与本地真实 Chrome 预览验收（安装扩展端到端门待最终统一执行）

- F4 新增三步首次引导：说明直接使用 Chrome 原生书签、可配置 Gemini / OpenAI / DeepSeek BYOK、按真实书签数展示扫描耗时和费用粗估；可全程跳过，设置页可重新启动。未配置 AI 时底部输入框改成直达设置的引导态，扫描运行时标题下方持续显示进度。
- F5 采用 PRD 已推荐的双 UI 分工：侧边栏右上角可进入批量整理工作台，管理页可返回侧边栏；二者继续共用同一 IndexedDB 资源、站点标识和封面数据，不复制第二套状态。
- F6 将文件夹展开状态和滚动位置保存到 `chrome.storage.local`；关闭重开、设置页往返和重看引导后返回均恢复。历史会话支持改名、二次确认删除，并明确最多保留 50 个、按更新时间淘汰；书签树初次读取失败时提供真实重试。
- F22 将 IndexedDB 从 v3 安全升级到 v4，新增独立 `pageSnapshots` store、`by-captured-at` 索引和 2,000 张上限；按 `canonicalUrl` 共享，完全不进入同步数据结构。
- 页面快照只在已收藏的前台 `http/https` 页面采集：收藏当前页立即尝试，正常浏览或从 Aarre 打开后停留 5 秒采集；标签切换、窗口失焦和标签关闭会取消定时器。无痕、内网、本地、银行、支付、医疗以及用户自定义域名均跳过。
- `captureVisibleTab` 返回的 PNG 在后台转成 680px 长边、16:10、WebP q0.75 后落盘；设置页默认开启、可关闭，并可维护额外排除域名。开启时会在明确的用户点击下申请网页访问权限。
- 悬停预览使用 400ms 意图延迟和 200ms 消失延迟，鼠标快速移动会重置计时；支持移入卡片、键盘 P 打开、Esc 关闭和减少动态效果。视觉区只读真实页面快照；没有快照时完整退化为纯信息卡，不使用 OG 图或分类封面冒充网页。
- 真实 Chrome 在 `390 × 844` 本地评审入口完成：315 行密集书签下无横向溢出；400ms 悬停出现纯信息卡；靠近底部时卡片向上翻转且完全在视口内；设置往返前后 `scrollTop` 均为 1800；重新启动引导后页头可见且三步信息完整。新开干净标签页复验控制台 0 错误、0 警告。
- `npm run check` 通过：19 个测试文件、78 个测试、类型检查和正式构建全部成功。
- 尚未完成：真实加载当前 `dist/` 后验证全新扩展安装、真实 IndexedDB v3→v4 升级、前台停留 5 秒产生 WebP 快照、从 Aarre 打开存量书签后补齐快照、关闭开关/敏感域名/无痕三条不采集门，以及真实管理页调用 `chrome.sidePanel.open()` 返回侧栏。开发预览不能冒充这些扩展 API 验收，统一留到最终阶段。

### 2026-07-30 · F3 封面策略 v2 完成代码与自动化阶段（300 条真实样本指标待最终统一验收）

- 将用户已完成并确认的 40 张活动版 `384 × 384` WebP 从设计资产正式接入 `src/assets/covers/`；生产构建只包含这 40 张，不包含 1254px PNG 或 8 张旧版。构建产物共 40 张 WebP、磁盘占用约 936KB。
- 新建声明式 `cover-registry.ts`：覆盖 GitHub、YouTube、Bilibili、知乎、小红书、X、Google Docs、arXiv、MDN、npm、Figma、Notion 等初始规则；支持结构化页面图、跳过通用横幅、视频列表例外、URL/主题分类和注册域回退。
- IndexedDB 按 PRD 从 v2 安全升级到 v3，新增按 host 共享的 `siteBrands` store；保存 192px WebP、来源、原生尺寸、拒绝原因、通用横幅样本和运行时跳过标记，不重建现有资源、Outbox 或撤销快照。
- 管线 A 已接入：规则资产 → HTML 声明的 Apple Touch Icon → 四个约定路径 HEAD 探测 → Web App Manifest → 安全 SVG → ≥128px 位图 → Windows Tile Image → 分类封面。相同 host 命中缓存后不再重复请求，失败时回退到注册域。
- 质量闸门拒绝小于 128px、偏离方形超过 20%、低墨迹/低对比和超大文件；缩放比例硬限制为不超过 1，不对低分辨率图标上采样。SVG 拒绝脚本、事件处理器、外部资源、嵌入对象和 CSS 外部引用。
- 管线 B 改为长边 512 WebP，并拒绝任一边小于 200px、超过 4:1、低于 1KB 和近纯色图片；同域名三个不同页面出现相同图片时持久化识别为通用横幅，清除已缓存副本并回退分类封面。
- 列表和搜索结果默认只显示通过闸门的站点标识，否则使用打包分类封面；不再把未经校验的远程 OG 图或 Chrome 32px favicon 直接显示。分类封面按域名产生确定性的 ±6% 明度差，同域名保持一致。
- 设置页新增“站点标识（整齐）/页面封面（丰富）”选项，默认站点标识；未配置 AI 也可单独更新全目录站点标识，内网地址在任何页面或图片请求前跳过。
- 新增规则表、HTML 图标提取、SVG 安全、通用横幅、站点标识存储测试；`npm run check` 通过：17 个测试文件、71 个测试、类型检查和生产构建全部成功。
- 尚未完成：在不少于 300 条真实中英文书签样本上统计零上采样、分类兜底率 ≤12%、Apple/Manifest ≥65%、SVG ≥8%、请求去重和耗时占比；这些是真实数据门，不能用单元测试冒充，留到最终真实 Chrome 验收阶段。

### 2026-07-30 · F1 / F8 本地检索完成自动化阶段（真实 Chrome 交互验收待最终统一执行）

- 新增一次构建、多处复用的本地搜索索引，覆盖标题、AI 检索别名、标签、主题、摘要、用户备注、正文摘录、网址和文件夹路径；中文标题同时建立全拼与拼音首字母索引，并用中文二元词组改善描述性召回。
- AI 富化协议新增 `aliases`，要求生成中英文同义词、缩写和用户可能使用的问题描述；旧 IndexedDB 记录没有该字段时仍能安全读取，不需要清库。
- 侧边栏新增本地即时搜索：输入时保留树结构与命中项的父文件夹，回车切换相关性排序结果；Esc 或清空按钮会恢复搜索前的文件夹展开状态和滚动位置。无结果时提供“让 AI 帮我找”，进入现有真实 BYOK Agent 会话，不使用假答案。
- 管理页移除面向用户的“云端向量搜索”开关和相关术语，所有检索统一在本机完成；后台 `GET_RESOURCES` 不再触发语义云端请求。
- Agent 面对 2,000 条收藏时先做本地召回，最多只精读 Top 50；收藏上下文、最近对话和待确认操作目录分别设硬预算。新增验收测试确认 `examinedCount = 50` 且请求体不超过 20,000 字符。
- 新增 `pinyin-pro 3.28.1`（MIT、固定版本、无传递依赖）；`npm audit` 为 0 个漏洞。
- `npm run check` 通过：15 个测试文件、63 个测试、类型检查和生产构建全部成功。
- 尚未完成：真实 Chrome 中侧栏输入、拼音首字母、回车排序、Esc 状态恢复及 2,000 条性能体验验收；统一留到最终真实 Chrome 验收阶段执行。

### 2026-07-30 · F2 撤销栈与回收站完成自动化阶段（真实 Chrome 验收待最终统一执行）

- IndexedDB 从 v1 安全升级到 v2，新增 `undoSnapshots` store 和 `by-created-at` 索引；升级逻辑按 `oldVersion` 增量建表，不重建或清空现有 `resources` / `outbox`。
- 新增 30 天撤销批次模型，覆盖创建、删除、改名、网址更新和移动；删除文件夹会在写入 Chrome 前通过 `getSubTree` 保存完整递归子树、原父级和 index。
- Agent 批量操作会在任何 Chrome 写入前一次性保存整批快照，每项执行前再持久化 `applied` 状态。快照写入失败时拒绝执行；部分操作失败不会阻止其余成功项被单独撤销。
- 侧边栏手动新建文件夹、移动、编辑、删除，以及收藏当前页面的创建/改名路径都已接入撤销保护。原父文件夹不存在时恢复到主书签栏并明确告知。
- 聊天执行结果新增“撤销这批操作”；设置页新增“最近的更改”，标出回收站项目并可在 30 天内恢复。Chrome 分配新 bookmark ID 后，智能层仍按 URL 资源键重新关联。
- 扩展安装和启动时自动清理过期快照。
- 新增 `tests/bookmark-undo.test.ts`，覆盖递归恢复顺序和“创建后 ID 状态未能二次落盘”时按父级差异安全定位；存储测试覆盖快照 CRUD 与过期清理。
- `npm run check` 通过：14 个测试文件、57 个测试、类型检查和生产构建全部成功。
- 尚未完成：真实 Chrome 中删除含 20 条书签的文件夹、混合 5 项 Agent 操作及原父文件夹消失三条人工验收；统一留到最终真实 Chrome 验收阶段执行。

### 2026-07-30 · 教育与科学封面改为“科学优先”

- 用户认为烧瓶加铅笔的 `education-science-v2.png` 不够好，明确要求用“科学”作为关键词重做。
- 新版 `education-science-v3.png` 以单一显微镜为明确主体，只在镜头焦点处保留一个小火花作为“发现”隐喻；彻底移除书、铅笔、烧瓶、课程和学校语义。
- 新版仍为 `1254 × 1254`、sRGB、不透明、严格三色 PNG，并同步输出 `384 × 384` lossless WebP；旧 `v2` 保留用于对比，不进入当前映射。
- `src/ui/sidepanel/preview.ts`、40 张完整总览、48px 总览和七张专项总览已切换到 `v3`。当前活动 40 张 WebP 合计 `883,134` 字节，`webp-384/` 含 8 张旧版共有 48 个文件。
- `npm run check` 通过：14 个测试文件、57 个测试、类型检查和生产构建全部成功。
- 浏览器在 `433 × 909` 侧栏实测：`education-science-v3.png` 从 `1254 × 1254` 源图成功加载并显示为 `48 × 48`，刷新与快速往返滚动后仍正常；无横向溢出、控制台错误或页面错误。截图为 `preview-local-education-science-v3.png`。

### 2026-07-30 · 按红框重绘 7 类缺省封面并接入本地预览

- 用户在完整 40 类总览中明确圈出 7 张需要重做：文档与 API、财经与投资、职位与招聘、作品集与画廊、艺术创作、教育与科学、娱乐与文化；其余 33 张保持原样。
- 继续沿用 Anthropic 手绘三层视觉系统和“70% 明确物体 + 30% 轻隐喻”，但把本轮主体进一步收敛到缩成 48px 后仍能第一眼认出的单一物件。
- 文档与 API 按用户连续两次纠正重新定义：先彻底放弃书页，再删掉两个系统、数据点和桥接关系，最终只保留一个松手绘插头及一截短线，让类别优先读成 API 的可连接性。
- 其余六张分别采用：手掌托住带一片叶子的硬币、公文包提手延伸成机会星、手持三张作品卡、调色盘与逸出笔触、瓶颈转成铅笔的实验烧瓶、拉开幕布后露出一颗星。
- 当前活动文件更新为 `documentation-api-v3.png`、`finance-investing-v3.png`、`job-career-v2.png`、`portfolio-gallery-v2.png`、`art-creation-v2.png`、`education-science-v2.png`、`entertainment-culture-v2.png`；旧版本保留作对照，不进入当前 40 类映射。
- 七张新图均已收敛为 `1254 × 1254`、sRGB、不透明、严格三色 PNG，并同步生成 `384 × 384` lossless WebP。当前活动 40 张 WebP 合计 `880,546` 字节（约 `0.84 MiB`）；`webp-384/` 因保留 7 张旧版共有 47 个文件，生产接入只能取 README 表格中的活动版本。
- `src/ui/sidepanel/preview.ts` 仅替换上述 7 个 import；完整总览、48px 总览和七张专项总览已更新，专项图为 `preview-redone-7-contact-sheet.png`。
- `npm run check` 通过：13 个测试文件、54 个测试、类型检查和生产构建全部成功；正式 `dist/` 没有分类封面或 `taxonomy-pilot` 引用。
- 浏览器在 `433 × 909` 与 `390 × 844` 两种侧栏尺寸逐段滚动验收：40 张均从 `1254 × 1254` 源图成功加载并显示为 `48 × 48`，无破图、无横向溢出，控制台错误和页面错误均为 0；快速上下滚动、文件夹展开再收起也通过。

### 2026-07-30 · PRD 定稿到可开工状态：确认与 NexVoice 同栈，新增第 12 章开工指引（仅文档，未改动代码）

第五轮修订。本轮仍只改文档，`docs/PRD.md` 升到 v1.2。**这一轮的目标是让 PRD 可以直接交给 Agent 执行，所以补的全是「怎么做」而不是「做什么」。**

> 历史说明：本节的 OAuth、三表 schema、`updatedAt` 游标、只同步元数据和不上传快照方案已在 2026-08-02 的 PRD v1.3 中整体替换；实施只看当前 F14，不得照本节旧规格开发。

**1. 服务端技术栈已确认同栈，并实地核对了 NexVoice 的实现（`docs/PRD.md` F14）**

用户确认可以与 NexVoice 共用服务器且同栈。已实地读过 `ArvenWang/NexVoice` 的 `ControlPlane`，把 F14 从「方向描述」改写成了可实现的规格：

- **栈已确定**：Node ≥ 22 ESM、Fastify 5、PostgreSQL 16（`pg` 连接池）、zod 4 校验配置、`jose` 验 JWT、`@fastify/rate-limit` 限流、`tsc` 构建 / `tsx` 开发 / `node --test` 测试、多阶段 Dockerfile、系统级 Caddy 反代、GlitchTip 收错误。
- **可直接照搬的代码已逐个点名**：`migrations.ts` 的 `applyMigrations`（含 `pg_advisory_lock` 串行化和逐文件事务）、`db.ts` 的连接池、`config.ts` 的 zod 模式、`security.ts` 的 `tokenHash` / `generateOpaqueToken`、`app.ts` 的 `requireInstallation` 鉴权中间件和 `issueTokens` 双 Token 模式、`authenticatedRateLimitKey` 的限流键。**不要重新发明这些。**
- **Token 模型沿用 NexVoice 的不透明 Token 加 HMAC 摘要**，不改成自签 JWT——自签 JWT 无法即时吊销，而 NexVoice 这套已经验证过。
- **部署形态定为独立 `aarre-api` 容器（256M，`127.0.0.1:8788`），但复用 `control-db` 这个 Postgres 实例里的独立 database 和独立用户。** 不在 `control-api` 里加路由，因为它承载设备激活和 AI Gateway、内存限额只有 384M，Aarre 的流量尖峰不能把 NexVoice 的激活搞挂。也不新起 Postgres 容器，那是纯浪费内存。
- **服务端代码放 Aarre 仓库的 `server/`**，自带 Dockerfile 和 compose，以 `external` 网络接入 NexVoice 的 compose 网络。两个产品各自独立发布。

**2. 补齐了 F14 缺的全部实现细节**

原来 F14 只说了方向，Agent 拿到没法直接写。本轮补上：

- **完整的认证流程**：授权码 + PKCE，`client_secret` 只在服务端。扩展 `launchWebAuthFlow` 拿 code → POST 给 `/v1/auth/google` → 服务端向 Google 换 `id_token` → **用 `jose` 的 `createRemoteJWKSet` 验签并校验 `iss` / `aud` / `exp`** → 签发自己的 Token。明确写了「只解码不验签」是这类实现最常见的严重漏洞。
- **完整的建表 SQL**：`users`、`auth_tokens`、`resources` 三张表加索引，含 180 天墓碑保留期（立刻物理删除会导致离线设备上线后把已删书签同步回来）。
- **`payload` 白名单**，且**要求服务端主动剥离而不是只靠客户端自律**——一次客户端 bug 就会把几十 MB 位图写进库。附带单条 32KB 上限和对应测试。
- **7 个端点的完整契约**加各自限流额度。其中翻页游标定为 `(updated_at, resource_key)` 复合值并给了 SQL：用页码会在数据变动时漏条；**只用时间戳则会因为一次批量同步让几百条记录落在同一毫秒，`>` 静默丢数据、`>=` 直接死循环**。附带一条构造 500 条同毫秒记录的翻页测试。
- **冲突解决的完整算法**：客户端上报 `baseRevision`，服务端按字段分四类合并。AI 字段取新、**笔记两份都留进 `note_versions`**、封面来源取新、**`deletedAt` 删除优先**（删除是用户明确意图，不该被另一台设备的旧数据复活）。
- **授权强制的可执行方案**：唯一 repository 模块 + **一条会真正失败的结构测试**（扫描 `server/src/` 断言除 repository 外不出现 `FROM resources` 等字符串）。失去 RLS 后漏一个 `user_id` 就是全库泄露，光靠代码审查挡不住。
- **验收标准拆成功能 / 安全 / 运维三组**，安全组每条都对应一个自动化测试（伪造 token、过期 token、`aud` 不匹配、越权读、白名单剥离、refresh 重放）。

**3. 新增第 12 章「开工指引」——本轮对 Agent 最有用的部分**

PRD 前 11 章讲「做什么」，第 12 章讲「按什么顺序做、别碰什么」：

- **五个批次的执行顺序和真实依赖**。F2 撤销栈排最前（是所有 AI 写操作的前置条件）；F14 排最后（依赖 F16 的正式 Extension ID，因为 Google 重定向 URI 需要它）；F8 不与 F3 并行（都要改扫描流程）。
- **文件归属表**，配合原有的独占登记机制降低冲突。
- 点明 `normalizeResourceRecord` 会被多个需求同时想加字段，规定**只追加、不重排、不改已有默认值**，这样多方改动能自然合并。
- **六条既有纪律**（原生层唯一事实来源、向后兼容、不删库重建、写操作前必须有快照、`host_permissions` 写死域名、新增权限要说明理由）。
- **明确禁止的四件事**，其中最重要的是「不要为了让测试通过而放宽验收标准」——第 5 章的「零上采样」和「兜底率 ≤ 12%」是互相拉扯的硬指标，达不到要报出来而不是单独满足一个。

**4. 修掉一个会导致实现事故的命名冲突**

F2 的撤销快照和 F22 的页面快照原来都叫 `snapshots`，但前者是书签树的结构备份、后者是网页截图，含义完全不同。已改为 `undoSnapshots` 和 `pageSnapshots`，并在 PRD 三处（F2 技术备注、5.7 存储表、12.1）统一。

同时把 IndexedDB 版本号做成了显式分配表（v2 归 F2、v3 归 F3、v4 归 F22）。**版本号是共享资源，两个 Agent 同时改成 v2 会导致其中一方的 store 永远建不出来。**

**5. 给 F22 补了技术备注**

原来 F22 只有交互规格没有实现要点。补上：`captureVisibleTab` 只能截可见标签页，所以采集只能挂在 `onUpdated` 的 `complete` 加 `onActivated` 上并判断是否为活动标签；**5 秒计时器要在标签切走时清掉，否则会截到别的页面**；无痕判断用 `tab.incognito` 而不是 `chrome.extension.inIncognitoContext`（Service Worker 里拿不到正确值）；截图返回的 PNG 要用 `OffscreenCanvas` 转 WebP 后再存，原始 PNG 单张能有几 MB。

**本轮未改动任何代码。** `docs/PRD.md` 之外没有文件变化。

### 2026-07-30 · 40 类缺省封面基准集完成并接入本地预览

- 从本任务历史恢复此前确定的最终资产范围：16 个网页类型封面、23 个主题封面和 1 个普通网页封面，共 40 个 `coverKey`；不把更细的 48 个主题标签误做成 48 张图片。
- 保留用户认可的 AI、代码仓库、设计创作、美食烹饪、旅行地点五张；重新生成文档、视频、财经、健康、购物五张，并补齐剩余 30 类。
- 用户先指出原第二批“笔触太紧、太标准”，随后又中途纠正首轮松弛稿“过于抽象”。最终视觉标准收敛为“70% 明确物体 + 30% 轻隐喻”：第一眼认出主体，隐喻只发生在一个局部；线条松弛、轮廓游移、线宽不一，但不把物体拆成点线谜语。
- 首轮过度抽象的五张没有进入工作区。硬件初稿因芯片辨识度不足也被淘汰并定向重画；当前 40 张均已通过整套并排审美检查。
- 完整素材位于 `design-assets/bookmark-covers/taxonomy-pilot/`。40 张均为 `1254 × 1254`、sRGB、不透明 PNG，并收敛为近黑、象牙白和单一背景色三个精确颜色；完整总览为 `preview-complete-40-contact-sheet.png`，真实小尺寸总览为 `preview-complete-40-48px.png`。
- 已同步导出 `webp-384/` 生产规格衍生图：40 张均为 `384 × 384`、无透明通道的 lossless WebP，总体积 `864,748` 字节（约 `0.82 MiB`）。
- `src/ui/sidepanel/preview.ts` 已将完整 40 类绑定到 40 个真实公开网站示例；本地地址仍为 `http://127.0.0.1:4173/sidepanel.html?preview=1`。
- 浏览器在 `433 × 909` 与 `390 × 844` 两种侧栏尺寸完成逐段滚动验收：40 张均从 `1254 × 1254` 源图成功加载并以 `48 × 48` 显示，无破图、无横向溢出；文件夹展开/收起在密集列表下正常，控制台错误和页面错误均为 0。
- `npm run check` 通过：13 个测试文件、54 个测试、类型检查和生产构建全部成功；正式 `dist/` 没有 `taxonomy-pilot`、分类封面或预览数据引用。
- 当前交付已经满足新版 PRD 的“40 类、一类一张”资产上限；3–6 个变体的旧建议已撤销。产品化剩余工作是接入真实封面选择管线，并由显示层按域名哈希做轻微明度偏移。
- 完整分类映射、文件名、背景色、隐喻、共享提示词和验证边界记录在 `design-assets/bookmark-covers/taxonomy-pilot/README.md`。

### 2026-07-29 · 放弃吸顶毛玻璃，改为不透明实底

- 用户在真实 Chrome 书签侧栏再次验证后确认：吸顶文件夹虽有半透明背景，但后方文字和图标仍清晰透出，`backdrop-filter` 在实际扩展合成层中没有产生可靠可见的模糊效果。
- 决定停止继续调整毛玻璃参数，避免把仅在开发预览计算样式中存在的 blur 误报为真实体验完成。
- 展开的吸顶文件夹现使用完全不透明的 `#FFFFFF` 实底，彻底移除 `backdrop-filter` 和 `-webkit-backdrop-filter`；Hover / 键盘聚焦使用完全不透明的 `#F6F7FA`。
- 该方案不再依赖 Chrome 对背景采样和扩展侧栏合成层的支持，后方书签内容会被实底稳定遮挡。
- 本地 Chromium 复核普通状态为 `rgb(255,255,255)`、Hover / 聚焦状态为 `rgb(246,247,250)`、`backdrop-filter: none`，吸顶定位保持正常；控制台 0 错误、0 警告。
- `npm run check` 通过：13 个测试文件、54 个测试、类型检查和生产构建全部成功。最新侧边栏为 `assets/sidepanel-BkjtMEsz.js`，样式为 `assets/styles-CEWAqj_p.css`。

### 2026-07-30 · 通用分类封面十类中间评审（已被上面的 40 类基准集完全替代，仅存档）

十类试制轮，用于收敛视觉标准。这一轮定下了「每张只保留一个容易理解的视觉隐喻」和「避免整批呈现单一蓝色」两条原则，被 40 类正式集继承。该轮提出的「每类补 3–6 个变体」建议已被后续 PRD 撤销。细节见 `design-assets/bookmark-covers/taxonomy-pilot/README.md`。

### 2026-07-30 · 预览窗只用快照、封面重心转向来源丰富度、云端改自建服务器（仅文档，未改动代码）

第四轮反馈修订。本轮仍只改文档。

> **给正在做分类封面的 Agent**：**上一轮让你做 3–6 个变体的建议已撤销。** 总量固定在约 40 张、一个分类一张，不扩充——这是维护上限。视觉重复问题改由「把兜底率压到 12% 以下」解决，不靠加图。你只需要保证 40 个分类各一张、规格与试制版一致（`1254 × 1254`、三色、粗手绘线条、满版不透明底）。另外打包进 `dist/` 用 `384 × 384` WebP，约 40 张合计不到 1MB。同分类连续出现导致底色连成一片的问题，改由显示层按 `hash(域名)` 做 ±6% 明度偏移解决，不需要你出多张图。

**1. 悬浮预览的视觉区只用页面快照，封面资产一概不进（`docs/PRD.md` F22、5.2、5.6、5.7）**

上一轮把 `og:image` 和分类封面当作预览窗视觉区的兜底，方向错了。这两者是封面资产，属于封面位置。

- 预览窗要回答的是「这个页面真实是什么样」。`og:image` 是站点的社交宣传卡不是页面本身，分类封面是通用插画、关于这个具体页面什么信息都没有。放进去用户会误以为看到了页面。
- 更关键的是：**一旦视觉区可能真也可能假，用户就得先分辨再判断，这比没有图更糟**。所以规则改为「有快照就显示，没有就不显示视觉区」，预览窗退化为纯信息卡。
- 纯信息卡本身站得住——标题、AI 摘要、标签、文件夹路径、上次打开时间已经能回答「是不是我要找的那一条」，这本来就是 hover 的真实意图。快照是锦上添花，不是前提。
- 连带调整：页面快照不再算作管线 B 的候选，它是独立的第三类资产，单独建 `snapshots` store（按 `canonicalUrl` 索引，且是唯一不参与云端同步的资产）。管线 B 收窄为只服务卡片视图、整理提案预览、周报。

**2. 封面工作重心从「扩充兜底图」转向「丰富真实来源」（`docs/PRD.md` 5.3、5.4、5.5、5.9）**

这是本轮最重要的方向纠正。上一轮的逻辑是「兜底图质量高所以可以放宽兜底率到 40%，同时多做变体」，方向搞反了：**要做的是给封面提供高于兜底图的真实图片，而不是扩充兜底图。**

- 兜底率目标从 ≤ 40% 收紧到 **≤ 12%**。40 张图铺 1,000 条书签，兜底率 40% 时单张平均出现 10 次，必然重复；压到 12% 后平均约 3 次，视觉上不构成重复。加图解决不了这个问题（加到 200 张也只是 10 次变 2 次，维护成本翻五倍）。
- **管线 A 来源从 3 个扩到 8 个**，这是压低兜底率的全部工作。现状是只有 `og:image` 和 32px favicon 两个来源，前者不适合 48px、后者过不了质量地板，所以真实有效来源接近于零——这才是封面表现力差的根本原因。新增：
  - **约定路径直接探测**（`/apple-touch-icon-180x180.png` 等 4 条）。Apple 规范就是「没声明则试根路径」，大量站点有文件但没在 HTML 里声明,只解析 HTML 会白白漏掉。
  - **SVG 图标栅格化**（`rel=icon type=image/svg+xml`、`/favicon.svg`）。SVG 与分辨率无关，栅格化到 192px 永远锐利,质量上限比任何位图都高却完全没被利用。
  - **`msapplication-TileImage`**（144/270px），同样被普遍忽略。
  - **同品牌多域名归并**：先按完整 host 抓，失败回退到注册域（eTLD+1）。
  - **规则表升为管线 A 第 0 级**，新增 `brandAsset` 字段直接指定资产地址；规模建议做到 150 条以上而非 25 条（纯数据文件不含图片，不受维护上限约束；收藏行为高度集中在头部站点）。
- **放宽一处前版规定：允许透明背景**，合成到卡片自身的表面色（浅色纯白/深色对应表面色）。这与被否掉的做法有本质区别——不发明任何新颜色、不为图标额外造色块，只是把图标放在它本来所在的卡片底色上。否则会挡掉大量 SVG 和 `rel=icon` 资产，与压低兜底率的目标冲突。另加墨迹闸门（不透明像素占画布 < 15% 或对比度不足则判定单薄，走兜底）。
- **明确排除第三方图标服务**（Google S2 favicons、DuckDuckGo icons、unavatar）：确实能给更高分辨率，但会把用户完整书签域名列表逐个发给第三方，和排除第三方截图服务是同一条理由。
- 验收改为两条互相拉扯的硬指标必须同时满足：「零上采样」（原生 < 128px 的显示数为 0）和「兜底率 ≤ 12%」。这样既不能放松质量换覆盖，也不能加图掩盖不足。

**3. 云端从 Supabase 迁到自建腾讯云轻量应用服务器（`docs/PRD.md` F14、D2、D10）**

与 NexVoice 共用同一台机器。这不是换域名的事，PRD 里写了六点必须处理的：

- **认证要重新设计**：扩展用 `chrome.identity` 拿 Google `id_token` → POST `/auth/google` → 服务端用 JWKS 验签 → 签发自己的 access/refresh token。比在服务端实现完整 OAuth 授权码交换简单得多，也和「用 Chrome 账号登录」的承诺一致。**`id_token` 必须服务端验签，只解析不验证是这类实现最常见的漏洞。**
- **RLS 没有了，授权必须在应用层强制**。Supabase 的行级安全是数据库层兜底，忘写条件也不泄露；自建服务器上漏一个 `user_id` 条件就是全库泄露。要求所有数据访问走统一 repository 层，每个方法签名强制第一个参数是已验证的 `userId`，不提供无 `userId` 的查询入口。这是硬要求不是建议，验收里有专门的越权测试。
- **数据库必须与 NexVoice 隔离**：独立 database、独立数据库用户、独立密码。实例可共用，数据库不行。
- **备份要独立于机器快照**：增强层是用户唯一无法自行恢复的数据（书签有 Chrome Sync、封面可重抓），机器快照粒度太粗。需要定时逻辑备份到对象存储，且**实际验证过一次恢复**。
- **备案和域名要提前确认**：腾讯云国内节点对外提供 HTTP 需 ICP 备案，建议用 NexVoice 已备案域名的子域名。动手写代码前先确认，否则做完了上不了线。
- **`scripts/build.mjs` 要改**：把 Supabase 域名换成自建 API 域名，仍写死具体域名不用通配符。
- 服务端可以很薄：四个端点（`/auth/google`、`/auth/refresh`、`GET /resources?since=`、`POST /resources`）、复用 NexVoice 现有数据库实例、增量同步用 `updatedAt` 游标、不需要向量扩展。**必须有按用户和 IP 双维度的限流**，因为共用 CPU 和内存。
- 现有 `src/lib/cloud.ts` 围绕 `supabase-js` 写的需要重写为 REST 客户端，但 **Outbox、指数退避、revision 并发校验这些逻辑与后端选型无关，可以复用**——这部分代码不算白写。
- 新增 D10 待决策：服务端技术栈是否与 NexVoice 同栈（同栈能复用部署脚本、监控、备份流程；异栈会让一台机器跑两套运行时，运维负担翻倍。倾向同栈，需先确认 NexVoice 用的是什么）。

**4. 快照采集默认开启（D9 已定）**

设置页有开关但默认打开——默认关闭的话绝大多数用户永远不会去开，功能等于不存在。前提是五条同时到位：仅 `http/https`、无痕完全不采集、内置敏感域名清单（银行/支付/医疗/内网）且允许用户追加、**快照永不上传云端**、首次引导和隐私政策中明示。

**5. 其他**

- D8 已定：分类封面不扩充变体，固定约 40 张。
- 风险登记新增四项：自建服务器授权漏洞导致跨用户数据泄露、与 NexVoice 共用服务器互相影响、增强层数据丢失且无法恢复、域名未备案导致上不了线。
- 完成度看板下调：云端同步 30% → 15%，Google OAuth 30% → 20%（认证路线要重做）。

### 2026-07-30 · 封面质量地板、存量书签快照、云端职责收窄（仅文档，未改动代码）

第三轮反馈修订。本轮仍只改文档，与并行修 Bug 和生成分类封面的 Agent 无文件冲突。

> **给正在做分类封面的 Agent**：本轮为你的产出定了两条规格，请一并采纳——① 建议每个分类做 3–6 个插画变体（不只一张），按 `hash(域名)` 确定性分配，因为真实分布是长头的，一个分类只有一张图时一屏内会出现大量相同图案；② 同一分类内的变体底色拉开 8%–12% 明度差。当前试制版旅行类六个变体共用同一个 `#6A9BCC`，连续出现多条时视觉上连成一片蓝，预览截图里已能看到这个现象。另外打包进 `dist/` 请用 `384 × 384` WebP（每张约 10–20KB），原始 `1254 × 1254` PNG 留在 `design-assets/` 不打包。

**1. 废弃「色底合成」和「生成式字标」，改为质量地板机制（`docs/PRD.md` 5.3、5.5、5.10）**

上一轮提的「提取主色 + 生成浅色底 + 图标居中」被否掉了，理由成立：一个低分辨率图标叠在色底上不会变精致，只是从「一个糊图标」变成「一个糊图标加一块色」；各站点图标设计语言差异极大，套统一底后是「统一的底 + 杂乱的前景」，视觉噪音更强。

替代方案是**把兜底图当质量下限，而不是最后手段**：

- 分类封面资产规格明确（`1254 × 1254` 原生、只含三个精确颜色、粗手绘线条、满版不透明底），在 48px 下表现好是三件事叠加：26 倍下采样绝对锐利、三色高对比缩小不糊、满版不透明底自成干净色块。
- 由此得出硬规则：**任何网络抓来的真实资产达不到这个水准就不用，直接走分类封面。** 这个方向和常规做法是反的——通常兜底质量最差所以抓取逻辑拼命想用上任何东西；现在兜底有质量保证，抓取逻辑可以非常挑剔。
- 准入闸门：原生边长 ≥ 128px（推荐 ≥ 180px）、绝不允许放大、背景必须不透明满版、宽高比偏离 1:1 不超过 20%、48px 下有清晰主体轮廓。任一不通过就走分类封面。
- **Chrome 的 32px `_favicon` 服务因此退出管线 A**，`og:logo` 和 JSON-LD `Organization.logo` 也移除（横向字标裁方图会残缺）。链条收敛到 `apple-touch-icon` → manifest icons → ≥128px 不透明 PNG → 分类封面。宁可少 20% 真实品牌图标，也不要任何一个糊图标。
- 唯一的加工是裁方图 + 统一圆角。不提取主色、不生成底板、不合成、不放大。
- 验收指标改写：新增「零上采样」硬指标（显示出的图标原生尺寸 < 128px 的必须为 0 个），这是「不比兜底图差」的直接检验；兜底率上限从 20% 放宽到 40%，因为兜底质量有保证。
- 站点标识存储从 128 提到 192px，与分类封面清晰度对齐。
- `siteBrands` 新增 `iconRejectReason` 字段，记录未通过闸门的原因，这是唯一能回答「为什么这个站点没用上真实图标」的数据。

**2. 存量书签的快照问题（`docs/PRD.md` F22）**

否掉了两个方向，都是结构性的：

- **AI 批量分析生成不了截图。** 语言模型看不到网页；图像生成模型能画「看起来像网页」的图，但那是凭空编造，用户会误以为真实页面并据此判断。这比没有截图糟糕得多。预览窗的全部价值建立在「这是真实的」前提上。
- **后台批量截图技术上堵死，不只是不划算。** `chrome.tabs.captureVisibleTab` 只能截取当前**可见**的标签页，后台标签页截不到。批量截图必须把每个页面轮流切到前台，浏览器会疯狂闪烁几百次。唯一绕法是 `chrome.debugger` + `Page.captureScreenshot`，但会挂「正在调试此浏览器」黄条，且该权限在商店审核中极为敏感。

结论确认为「拿不到就不展示快照」，但补了三点让缺口不构成缺陷：

- **视觉区永远有内容**：快照 → `og:image` → 分类封面。`og:image` 在全目录扫描时就能拿到（覆盖约 45%–55%），不需要用户打开页面，所以预览窗从第一天起就是完整的。
- **快照采集时机从 1 个扩大到 3 个**：收藏当前页、**从 Aarre 点开书签时**、**浏览到已收藏 URL 停留 5 秒时**。后两条直接覆盖存量书签且零打扰，而且补齐顺序天然按访问频率排——最常用的书签最先有快照。
- 视觉区来源用轻角标区分（如「快照 · 3 天前」），让用户知道看的是真实页面还是示意图。
- 隐私边界：独立开关、无痕不采集、内置敏感域名清单（银行/支付/医疗/内网）且允许用户追加、快照永不上传云端。新增 D9 决策项待拍板默认开关状态。

**3. 云端方向定为保留，职责收窄（`docs/PRD.md` F14、D2）**

- 保留理由成立且是硬的：Chrome Sync 只同步书签树（标题、URL、文件夹），Aarre 的整个增强层（标签、摘要、主题、别名、封面来源、笔记）都在本地 IndexedDB，**Chrome Sync 一个字节都不带走**。用户换机器书签在但 AI 成果全丢，这个缺口只能自己补。
- 但职责必须收窄：**下线 pgvector 和云端 AI 富化**（F8 已把检索完全本地化，BYOK 直连不经服务端），后端收窄到「一张表 + RLS + 认证」，基本不需要 Edge Function，运维成本接近于零。
- **关键优化：只同步派生指令，不同步派生产物。** 封面和快照原样同步的话单用户约 21MB，Supabase 免费额度 1GB 只够 30 来个用户，成本模型崩掉。封面是从公开 URL 派生的，同步 `coverSource` / 原始图片 URL / `categoryCoverId` 这几百字节即可，另一台设备本地重建。**页面快照不但不该同步，而且不应该同步**——它是设备本地的浏览痕迹。载荷降到约 1.5MB/千条，免费额度可支撑数百用户。
- 补了冲突策略（现有代码有 Outbox 和 revision 校验但无明确语义）：AI 生成字段按字段 last-write-wins；**用户手写笔记冲突时保留两份不覆盖**；封面来源信息 last-write-wins（本地可重建，代价为零）。
- 验收新增「B 设备不出现任何来自 A 设备的页面快照」和「单用户千条书签云端占用 ≤ 3MB」。

**4. 决策与风险更新**

- D2 已定（保留云端并收窄职责）、D4 已定（列表默认站点标识）。
- 新增 D8（分类封面变体数量）、D9（快照采集时机默认开关）。
- 风险登记新增「云端存储成本失控」和「页面快照被视为隐私侵犯」两项。
- 第 11 章「明确不做的事」新增三条：不用 AI 生成看起来像网页的预览图、不做封面色底合成与生成式字标、不上传页面快照到云端。

### 2026-07-29 · 封面策略改版、悬浮预览、检索去 embedding 化（仅文档，未改动代码）

承接同日的产品评审，按用户三点反馈修订 `docs/PRD.md` 和评审看板。本轮仍只改文档，与并行修 Bug 的 Agent 无文件冲突。

**1. 封面策略推翻重来（`docs/PRD.md` 第 5 章）**

原方案的优先级搞反了。48×48 只有 2,304 像素，Retina 下也只有 96px，在这个尺寸下网页截图和文字型 OG 卡片都完全不可读，只有品牌标识可读。正确的参照系是 iOS 的 App 图标网格，不是文章卡片流。

- **从「五层级联」改为「两条并行管线」。** 管线 A（站点标识）服务 48px 列表，最后一级本地生成，覆盖率 100%；管线 B（页面封面）服务悬浮预览、卡片、周报等 160px 以上场景，允许为空。两条各自独立降级，互不阻塞。
- **`captureVisibleTab` 截图从「列表首选」降为「管线 B 首选」。** 它在 340px 宽的预览窗里清晰可读，在 48px 方格里毫无价值。能力照做，用途改变。
- **新增 5.3「统一画布」，这是「精致」的真正来源。** 光有高清 `apple-touch-icon` 还不够——有的透明背景、有的自带白底、有的纯黑单色、有的撑满无留白，堆在一起仍然杂乱。所有标识入库前统一走：提取主色 → 主色极浅版做圆角方形底 → 图标居中缩放到占画布 60–65% → 统一圆角。生成式字标复用同一规格，混排不突兀。
- 规则表新增 `listUsesPageImage` 例外标记，只给视频站、电商这类「页面图有明确单一主体」的站点开启。
- 页面封面不再裁方图，改为保留原始宽高比、长边 512（预览窗是横向布局）。
- 目标改写为「每条书签在 48px 列表里都有清晰、精致、可辨识的标识」，验收指标从「覆盖率」改为「`apple-touch-icon`/manifest 来源占比 ≥ 55%、favicon 占比 ≤ 15%」。
- D4 决策已定：**列表封面默认站点标识**，不再默认页面封面。
- 数据结构调整：去掉 `coverTier`，改为 `coverSource` 优先级比较 + `brandParams`；新增 `siteBrands` store（`host` 主键，含 `iconDataUrl` / `iconSource` / `dominantColor` / `skipPageImage`）。IndexedDB 仍需从 v1 依次升到 v3。

**2. 新增 F22 悬浮预览（归属 M1）**

- **实时渲染 HTML 这条路是结构性堵死的**，已明确写入 PRD：绝大多数站点有 `X-Frame-Options: DENY` 或 CSP `frame-ancestors`，iframe 直接被拒；扩展页面渲染任意外站 HTML 是安全问题；每次 hover 一次真实加载性能和隐私都不可接受。
- 但缓存方案不是妥协。用户 hover 想知道的是「这是什么」而不是「这个网页长什么样」，一张缩略截图的信息量远小于「标题 + AI 摘要 + 标签 + 站点 + 时间」。所以预览窗设计成**视觉区（管线 B 封面，为空则省略）+ 信息区**。
- 触发延迟定 400ms 而非用户提的 1–2 秒（行业惯例 300–600ms，1 秒以上用户已移开），配合鼠标移动速度阈值做意图检测。
- **硬限制**：Chrome 侧边栏是独立浏览器上下文，DOM 无法绘制到网页区域，预览窗只能在侧边栏宽度内浮起。
- 副作用收益：hover 时静默核对状态码，让悬浮预览成为死链检测的天然载体。

**3. 检索能力去 embedding 化（`docs/PRD.md` F8）**

- 新增硬约束：**用户永远不应看到「embedding」这个词，更不应配置它。** DeepSeek 没有 embedding 模型，不能让中国用户为了搜索再去申请另一家 Key。
- 改为三层自动降级，全部自动判定：
  - **第一层（主线，100% 用户，零配置）**：中文二元组切分 + 拼音首字母匹配（`jqxx` → 机器学习）+ **AI 生成的检索别名**。最后这条是关键——现有 enrichment prompt 已在返回 `summary`/`tags`/`topics`，加一个 `aliases` 字段只多几十个 token，等于用已有 AI 调用免费换来语义能力。
  - **第二层（可选，仍零配置）**：`transformers.js` 本地小模型。三个坑已记录：模型不能打包进扩展、HuggingFace CDN 国内可用性需先验证、批量推理必须走 Offscreen Document（MV3 Service Worker 会被终止）。
  - **第三层（自动隐形）**：服务商本身支持时自动用，DeepSeek 用户自动跳过且界面不出现任何相关提示。
- 验收硬指标：**仅第一层启用时**必须达到日常够用（搜「机器学习」命中标题为「Machine Learning」的条目等）。
- 新增 D6（本地语言包托管在哪，需先验证 HF CDN 国内可用性）、D7（第二层是否值得做，建议先只做第一层实测）。
- 连带影响：向量全部本地缓存后语义搜索不再需要登录和云端，D2「云端保留还是砍掉」的天平进一步倾向砍掉。

**4. 文档约定**

- `docs/PRD.md` 新增 0.3 需求编号约定：编号一经分配不再变动，新增需求顺延取号，归属里程碑以第 3 章表格为准。所以 F22 属于 M1 而非最后一个里程碑。
- 评审看板同步更新，新增「七、悬浮预览」「八、检索能力」两节，封面章节整体重写：`~/.cursor/projects/Users-nefish-Desktop-Coding-Aarre/canvases/aarre-product-review.canvas.tsx`。

### 2026-07-29 · 产品评审与 PRD 初版（仅文档，未改动代码）

- 新增 `docs/PRD.md`：完整产品需求文档，含 4 个里程碑、需求 F1–F22、7 条待决策项和风险登记。每条需求都写了「要解决什么问题 / 怎么做 / 验收标准 / 技术备注」，可由开发 Agent 独立领取执行。
- 已确认现有代码完全没有使用 `apple-touch-icon`（通常 180×180）和 Web App Manifest 图标（常有 512×512），这是当前清晰度不足的最大原因，也是最快见效的改动。
- 新增「通用横幅检测」：同域名下三个以上不同页面拿到同一张 `og:image` 时判定为站点通用横幅，该域名自动补 `skipPageImage`，消除「一个文件夹二十个书签长得一样」的失败模式。
- 建议不要把第三方 Logo 打包进扩展分发（商标风险、审核风险、维护成本），且没有必要——目标站点的 `apple-touch-icon` 公开可取。极个别取不到的站点用「主色 + 首字」生成。
- 明确排除第三方截图服务（隐私冲突）与后台批量开标签页截图（不可行）。
- 完成度评估：单机闭环约 82%，云端链路约 30%，上架就绪度约 45%。原生书签读写、单页收藏、BYOK 摘要标签、全目录扫描均在 85% 以上；本地关键词检索、Supabase 同步、Google OAuth、pgvector 语义搜索为明显短板。
- 三项发布阻塞：侧边栏缺关键词搜索框；AI 批量操作（含递归删除文件夹）没有撤销与回收站；Supabase 与 Google OAuth 整条链路零真实端到端验证但 UI 已在承诺跨设备同步。
- 两项扩展性风险：`askBookmarkAgent` 把全目录一次性塞进上下文（上限 11 万字符），书签上千条后会同时触发截断、成本上涨和响应变慢，建议改为「本地召回 Top-K → 模型精读」两段式；`searchLocalResources` 只做 substring 匹配，中文不分词导致标签同义词检索失效。
- 结构性优势确认（后续决策不应改动）：Chrome 为标题/URL/文件夹的唯一事实来源、资源键用 `SHA-256(canonical URL)` 而非跨设备不稳定的 bookmark ID、BYOK 正文不过自有服务器、`http://*/*` 仅作可选权限按需申请。
- 竞品结论：Raindrop / mymind / Marqly 等 AI 书签产品全部自建平行库；读写原生书签的 Bookmark Sidebar（30 万用户）完全没有 AI。「原生书签层 + AI」这一交集目前无人占据。
- 建议的最高优先级机会：把 Agent 从「问了才答」改为扫描后主动给出整理提案（可归类 / 重复 / 失效），配合逐条勾选、一键应用与一键撤销。执行所需的 8 种 action、目标校验与回读确认后台能力已完成，缺的只是触发方式和撤销栈。
- 建议推进顺序：① 补断口（搜索框、撤销栈、AI 未配置引导、两套 UI 二选一）② 立差异（主动整理提案、死链检测、重复合并、两段式检索、扫描并发与成本预估）③ 能上架（跑通云端、隐私政策、定价与配额、商店素材）④ 上台阶（周报月报、主题图谱、遗忘曲线、Web/PWA）。
- 待用户拍板的商业模式：纯 BYOK 获客漏斗过窄，建议改为混合三层（免费层用官方 Key 限额 / Pro 层无限量加云同步与周报 / BYOK 层永久免费无限量）。

### 2026-07-29 · AI 书签操作闭环、Hover 与吸顶方案尝试

- 定位收藏 Agent 原本只有读取本地资源并生成文字回答的能力，完全没有接入已有的 Chrome 书签写入消息；模型也没有禁止虚构执行结果，因此可能回答“已删除”但没有任何真实写入。
- Agent 现支持为添加、删除、修改、重命名和移动书签/文件夹生成最多 8 项待确认操作；模型输出的目标 ID、父文件夹、目标文件夹、名称和网址都会先与当前 Chrome 目录做白名单校验，不存在或不可写目标不会进入确认卡。
- 所有写操作先显示准确目标和影响范围，必须由用户点击“确认执行”；删除书签与递归删除文件夹使用危险色提示。取消后会明确记录“没有修改 Chrome”。
- 用户确认后，扩展后台才调用 `chrome.bookmarks`；每项操作完成后再次读取 Chrome 验证创建内容、名称、网址、父文件夹或目标已消失，最后重新导入原生书签并向会话返回逐项成功/失败结果。
- 对“失效、打不开、404”书签的判断增加明确安全边界：没有真实链接检测结果时不得只凭标题或 AI 摘要猜测，更不得声称已经批量删除。当前实现可安全执行用户明确指定目标的删除；自动失效链接检测仍需独立健康检查流程。
- 文件夹 Hover 色由约 6% 黑色混白统一为与书签一致的 `#F6F7FA`，修复 Hover 灰块过重。
- 曾尝试把半透明背景和 `blur(18px) saturate(1.2)` 直接应用到真实 sticky 元素；该方案只在开发预览的计算样式中成立，后续真实 Chrome 扩展截图证明没有形成可靠可见的背景模糊，现已由不透明实底方案替代。
- 本地 433 × 909 Chromium 当时仅验证计算样式包含 `backdrop-filter`，不能作为真实扩展视觉完成证据；文件夹 Hover 的 `rgb(246,247,250)` 验证仍有效。
- 开发预览完成“请求删除 → 展示待确认目标 → 确认 → 后台执行 → 返回核验结果 → 列表目标消失”完整交互；控制台 0 错误、0 警告。该验证使用预览 Chrome 数据，真实安装扩展后的不可逆删除仍需真人确认验收。
- `npm run check` 在 Node.js 22.22.2 下通过：13 个测试文件、54 个测试、类型检查和生产构建全部成功。最新构建侧边栏为 `assets/sidepanel-DxSD2K2V.js`，样式为 `assets/styles-CsR1_2rt.css`。

### 2026-07-29 · 书签分类封面素材 v2 极简版

- 根据用户对 v1“太复杂”的反馈，重新生成六张极简封面；每张只保留一个中心符号，不再使用手、人物、场景、动作链或多个物体。
- 六类符号分别收敛为四角灵感星、三分组件窗口、三节点闭环、笑脸、前进箭头和打开的书。
- 新素材以 `*-v2.png` 保存在 `design-assets/bookmark-covers/`；v1 完整保留，没有覆盖。
- 六张 v2 均为 `1254 × 1254` RGB、不透明 PNG，已通过 `48 × 48` 内存缩略验证；当前仍是未接入产品界面的设计资产。

### 2026-07-29 · 书签分类封面素材 v1

- 根据 `src/ui/sidepanel/preview.ts` 中的六类开发预览书签，生成了设计赏析、前端代码与组件、工作与内部系统、生活与娱乐、工具与效率、前端文章 / 教程六张方形封面；正式产品的分类仍由用户真实的 Chrome 书签树决定，并不固定为这六类。
- 素材保存在 `design-assets/bookmark-covers/`，均为 `1254 × 1254` RGB、不透明 PNG；当前只作为设计资产交付，尚未接入产品界面，也不会进入生产扩展包。
- 使用 `anthropic-art` Skill 与 Codex 内置图片生成工具，统一采用近黑粗手绘线条、象牙白不规则承载形和单一强调色背景；每张图均无文字、Logo 和水印。
- 每张图都进行了一次“只修平面填色”的定向重绘。内置模型仍保留轻微的同色明暗变化，因此不能宣称像素级纯色；在实际 `48 × 48` 缩略图尺寸下不影响主体辨识。
- 具体分类映射、提示词摘要与质量边界见 `design-assets/bookmark-covers/README.md`。

### 2026-07-29 · 本地界面部署与浏览器复核

- 使用项目固定的 Node.js 22.22.2 重新安装依赖，`npm ci` 完成且依赖审计为 0 个漏洞。
- 完整 `npm run check` 通过：13 个测试文件、52 个测试、类型检查和生产构建全部成功。
- 侧边栏开发预览已启动在 `http://127.0.0.1:4173/sidepanel.html?preview=1`；这是仅在开发环境启用、复用真实 React 组件和交互结构的本地评审入口。
- 使用真实 Chromium 加载预览页，确认“我的书签”、书签树、收藏/历史/设置入口和底部 Agent 输入框正常渲染。
- 修复侧边栏和管理页未声明 favicon 导致的本地 404；两个入口现统一复用 Aarre 的 32px 正式图标，浏览器复查为 0 个控制台错误、0 个警告。
- 本地预览数据用于开发评审，不会写入生产扩展；Chrome 原生书签读写、扩展权限与真实 BYOK 请求仍应在加载 `dist/` 后单独进行真人端到端验证。

### 2026-07-29 · GitHub 首次完整同步

- 当前 Aarre 扩展源码、AI 书签能力、Supabase 函数与迁移、自动化测试、设计验收资料和项目文档已完整提交并推送到 `ArvenWang/Aarre` 的 `main` 分支。
- 功能提交为 `9b369aa feat: build Aarre intelligent bookmark experience`；远端仓库采用现有本地 `main` 历史，没有创建额外分支，也没有包含 `.env`、本地 Key、`node_modules` 或 `dist`。
- 推送前已完成敏感信息扫描和 Git diff 检查；`npm run check` 在 Node.js 22.22.2 下通过，包含 13 个测试文件、52 个测试、类型检查和生产构建；`npm run verify:artifacts` 通过。
- 推送完成后继续核对本地 `HEAD` 与 `origin/main`，确保工作区无未提交改动、远端没有遗漏提交。

### 2026-07-29 · 编辑信息层级、GitHub 封面与毛玻璃吸顶

- 书签编辑页移除“完整简介”“已完成”和“初始由 AI 生成”等冗余标签；AI 分析说明改为明确区分：主题是 AI 归纳的内容方向，标签是可由用户自行增删的检索关键词。
- 删除书签进入确认态后，原“取消 / 保存”按钮隐藏；确认按钮简化为“取消 / 确认”，移除确认区外层红色底和描边。确认态与普通操作栏都固定为 36px，高度切换不再推动弹窗。
- Chrome `_favicon` 请求增加 `forceEmptyDefaultFavicon=1`，缺少真实 favicon 时不再返回灰色地球；全部候选失败后显示 Aarre 自己的书签品牌图标。
- 站点 favicon 改为 16 DIP、2× 位图读取，并以 16px 居中显示；在 Retina 屏上使用 32 像素源图向下采样，不再把低分辨率图标放大到 32px 造成模糊。
- 列表代表图由 56 × 56 收敛为 48 × 48，列表行继续保持 68px；代表图上下各留 10px，标题和 URL 与整行垂直中心对齐。
- GitHub 仓库优先采用仓库自己的 Open Graph 社交预览图；页面元数据不可读时使用 GitHub 仓库级 OpenGraph 地址兜底，并排除设置、搜索、登录等非仓库路径。
- 全目录扫描会主动重新处理“已有缩略图但不是 GitHub 仓库预览图”的旧记录，已有错误 GitHub 封面无需删除书签即可更新；已有完整 AI 信息时只刷新封面，不重复产生 AI 调用。
- 展开文件夹吸顶层使用独立半透明伪元素与 14px 背景模糊；有文件夹时，列表底部渐隐从会阻断背景采样的 `mask-image` 改为 52px 覆盖层，因此吸顶项可以真正模糊后方内容，抵达底部后覆盖层仍会渐隐消失。
- 本地浏览器验证编辑文案、简化删除确认、真实吸顶毛玻璃、底部渐隐、favicon 尺寸、封面尺寸与垂直居中；删除前后操作栏均为 36px、弹窗无高度跳变。
- `npm run check` 在 Node.js 22.22.2 下通过：13 个测试文件、52 个测试、类型检查和生产构建全部通过。
- 最新生产构建已写入 `dist/`：侧边栏入口为 `assets/sidepanel-BvlMJJDP.js`，样式入口为 `assets/styles-mqX6XqLO.css`。

### 2026-07-29 · 代表图补全与展开文件夹吸顶

- 列表存在文件夹时取消顶部渐隐并移除顶部 3px 内边距，避免吸顶文件夹标题被遮白或从上方露出上一条内容；底部渐隐、自定义滚动条和纯书签平铺列表的顶部渐隐保持不变。
- 代表图提取从仅支持 `og:image / twitter:image`，扩展为社交元数据、`image_src`、JSON-LD 图片和正文主图四级候选；会过滤 logo、icon、头像和追踪像素，并优先选择大尺寸 hero / cover / thumbnail。
- 代表图下载后在扩展后台中心裁切为 112 × 112 WebP，写入本机 IndexedDB；本地缓存不上传云端，云端元数据合并也不会把它覆盖，列表不再依赖站点防盗链和二次网络请求。
- 全目录扫描现在会把“已有 AI 信息但缺代表图”的书签重新纳入队列；补图无需重复调用 AI，只有简介或标签缺失时才调用当前服务商。
- 展开的文件夹标题行使用受自身文件夹范围约束的吸顶定位；向下滚动时停在列表顶部，后续文件夹到达后会自然把前一个标题推走。
- 使用用户参考图中的六个真实网站验证代表图提取，六个均取得有效图片 URL；其中 `good-web-design.com` 没有社交卡片，已通过正文缩略图回退成功提取。
- `npm run check` 在 Node.js 22.22.2 下通过：13 个测试文件、49 个测试、类型检查和生产构建全部通过；最新构建已写入 `dist/`。
- 本地 433 × 909 预览实测：滚动 650px 后展开文件夹标题仍固定在内容顶部；同时展开下一文件夹并继续滚动后，前一标题被推到顶部外、下一标题接替吸顶。

### 2026-07-29 · Chrome 代表图式书签列表

- 书签列表按 Chrome 新版侧栏的代表图结构重做：每行固定 68px，左侧 56 × 56 网页代表图，右侧只显示单行标题与域名 URL；扫描前后不再改变高度。
- 列表移除卡片描边和常驻底色，默认保持白底，Hover 使用 `#F6F7FA`、Active 使用 `#EEF0F4`。
- 编辑按钮继续在 Hover / 键盘聚焦时渐显，保留半透明毛玻璃底，但完全移除投影。
- 新增 `SiteThumbnail`：优先显示资源中的真实页面代表图，加载失败或缺失时使用 Chrome 本地 favicon 降级。
- 对照 Chromium 原生实现确认 Chrome 使用内部 `PageImageService` 和 Optimization Guide 取得页面代表图，并非整页截图；扩展无法调用该内部 Mojo 接口。
- Aarre 全目录扫描新增 `og:image` / `twitter:image` 与页面 favicon 提取，扫描完成后会写入本地资源并自动显示在列表缩略图中，不依赖第三方截图服务。
- `npm run check` 通过：13 个测试文件、44 个测试、类型检查和生产构建全部通过；本地 433 × 909 预览控制台无错误。
- 视觉对照记录见 `design-qa.md`，结果为 `passed`；生产构建已写入 `dist/`，侧边栏入口为 `assets/sidepanel-CwXVNc9W.js`，样式入口为 `assets/styles-CNzEM6a_.css`。

### 2026-07-29 · 早期功能与 UI 迭代（十余轮，已压缩为主题归档）

原文是十余条按轮次记录的迭代日志，包含大量已被后续轮次推翻的中间态色值和每轮的 `dist/` 哈希。下面按主题保留仍然有效的决定，被推翻的中间态不再列出。

**AI 与 BYOK**

- 三家服务商（Gemini / OpenAI / DeepSeek）平权预设，各自默认模型可改。**三家都必须用户自己配 Key，没有内置服务分支。** OpenAI 默认 `gpt-5.6-luna`，DeepSeek 默认 `deepseek-v4-flash`。
- 每家 Key 独立存 `chrome.storage.local`，切换服务商不互相覆盖；旧版 `geminiApiKey` 自动迁移。**UI 只回显配置状态和尾号，永不回显完整 Key。**
- Key 保存前请求服务商官方模型接口验证权限，DeepSeek 额外校验账号能否访问所选模型。
- 富化改为扩展后台直连服务商。正文按 50,000 字符上限传送，**并显式隔离网页内的 Prompt Injection**。
- Key 无效、额度不足、超时或响应结构异常时，**Chrome 书签仍然保存成功**，只在侧边栏给非破坏性提示。
- 已修一个真实 bug：生产构建配置云端时会覆盖三家 AI 官方域名的 `host_permissions`，改为保留并合并精确域名。

**全目录扫描**

- 可持久恢复的扫描任务：显式启动、实时进度、暂停、继续、取消、错误统计。
- 通过 `optional_host_permissions` 单独申请网页读取权限。**抓取不携带 Cookie，最多读 600KB HTML，跳过内网、局域网、带凭据和常见企业内部域名。**
- 先提取描述、站点、H1/H2、首段、关键词和 URL 路径词，再交给 BYOK 生成简介、标签、主题。
- 扫描会把「已有 AI 信息但缺代表图」的书签重新纳入队列，补图不重复调用 AI。

**标签的用户主权**

- `tagsSource` 字段区分 AI 生成和用户版本。**用户改过的标签，后续扫描只更新简介和主题，绝不覆盖标签。** 这条纪律要保留。

**收藏 Agent**

- `ASK_BOOKMARK_AGENT` 链路：后台从 IndexedDB 取全目录紧凑索引交给 BYOK 回答，回答在侧边栏内展示并显示最多 5 条来源，支持最近 10 轮多轮对话。
- 会话存 `chrome.storage.local`，上限 50 个会话、每个 60 条消息。

**健壮性**

- 消息层拦截「成功但无数据」的新旧版本协议错配，提示用户重新加载扩展，而不是进入损坏渲染态。这是真实 Chrome 崩溃 `c is not iterable` 的修复。
- `normalizeResourceRecord` 标准化旧数据：早期只有名称和 URL 的记录自动补齐字段，**不要求用户清库**。
- 资源列表、扫描更新、书签事件、历史会话加载全部加运行时数组校验；侧边栏有最终恢复页兜底。

**UI 规范（当前有效值）**

- 列表行 68px，代表图 48 × 48，单行标题加域名。默认白底，Hover `#F6F7FA`，Active `#EEF0F4`，无投影。
- favicon 按 16 DIP、2× 位图读取后以 16px 居中显示，不放大低分辨率图标。
- 编辑按钮为 Hover / 键盘聚焦时渐显的悬浮控件。
- 自定义滚动条：距右 8px、5px 手柄、无轨道，滚动时出现、闲置 900ms 后 240ms 渐隐，可拖动定位。
- 文件夹展开收起 320ms Grid 动画；收藏浮层 180ms 遮罩淡入加 320ms `0.97 → 1` 缩放。**全部受 `prefers-reduced-motion` 控制。**
- 同层拖拽实时乐观排序加 240ms FLIP 位移，松手后写入 Chrome。
- 输入框聚焦统一单层 1px 中性边框，无蓝色外圈。
- 自绘文件夹下拉替代原生 `<select>`，支持方向键 / Home / End / Enter / Escape。
- `sidepanel.html?preview=1` 是仅开发环境的评审画布，复用真实组件，预览数据不进生产构建。

**被推翻的尝试（不要重做）**

- 吸顶文件夹的 `backdrop-filter` 毛玻璃：在真实扩展合成层里不产生可见模糊，已改为不透明实底 `#FFFFFF`（Hover `#F6F7FA`）。
- 底部渐隐用 `mask-image`：会阻断吸顶元素的背景采样，已改为覆盖层。

### 2026-07-29 · 0.2.3 可靠性加固

- 初始化 `main` Git 仓库，基线提交为 `cf619df`。
- 离线队列改为保留全部待同步项目；元数据更新不会覆盖已排队正文。
- 同步失败使用最长六小时的指数退避，失败任务不会阻塞后续任务。
- 队列完成和失败写入增加 revision 校验，避免并发变更被旧请求删除。
- 启动同步改为先推送本地队列、再拉取云端，避免旧云端状态覆盖待同步数据。
- 已收藏页面再次点击星标时复用原书签文件夹，不再默认向书签栏创建重复项。
- 删除书签或整个文件夹前必须二次确认。
- 弹窗增加焦点约束、Escape 关闭、可见焦点样式和减少动态效果支持。
- 项目固定 Node.js 22.22.2，并补充 Node 版本前置检查。
- 增加交付物生成与版本校验脚本；历史误标解压目录已移入 `outputs/legacy-mislabeled/`，未删除。

## 已完成内容

- 建立 React、TypeScript、Vite、Manifest V3 工程。
- 实现 Chrome 原生书签栏侧边栏和完整收藏管理页。
- 侧边栏直接读取当前 Chrome 书签树，优先选择账号同步的书签栏。
- 同时展示账号书签栏、本机书签栏、其他书签和移动设备书签，避免 Chrome 星标保存位置不同导致遗漏。
- 右键收藏改为自动打开侧边栏，并预填页面或链接地址、标题和选中文字。
- 右键草稿按标签页隔离，消费后立即清理，避免跨页面串用。
- 侧边栏新增 Google 账号与 AI 同步状态入口。
- 支持原生书签与文件夹的新增、改名、URL 修改、删除和拖放移动。
- 监听原生书签新增、改名、移动、重新排序和删除并实时刷新。
- 实现统一输入框：书签、历史记录、已打开标签页联想、网址直达和 Chrome 默认搜索引擎。
- 实现当前网页正文、Canonical URL、描述、作者、站点、图片和选中文字提取。
- 正文提取排除表单、输入框、脚本、导航等高风险内容。
- 保存时创建或更新真实 Chrome 原生书签。
- 支持选择 Chrome 原生文件夹。
- 建立规范化 URL 与 SHA-256 资源键，不依赖跨设备不稳定的 Chrome bookmark ID。
- 使用 IndexedDB 建立可扩展的本地缓存和离线补同步队列。
- 实现现有 Chrome 书签自动索引，不再提供手动导入步骤。
- 实现后台自动补同步和五分钟周期重试。
- 实现云端缺失书签恢复到 Chrome。
- 实现 Supabase Google OAuth PKCE 登录代码。
- 强制产品 Google 账号与当前 Chrome 配置文件账号一致。
- 建立 Supabase 数据表、RLS、复合主键和 pgvector 索引。
- 实现认证 Edge Function：
  - Gemini 结构化摘要、标签、主题、关键点和适用场景。
  - Gemini 768 维 Embedding。
  - pgvector 语义搜索。
- AI 提示对网页内 Prompt Injection 做显式隔离。
- 模型密钥默认从服务端 Secret 读取；用户配置 BYOK 后，调用会优先使用扩展本地保存并临时转发的 Gemini Key。
- 构建时只申请实际 Supabase 项目域名，不使用 `<all_urls>` 或 Supabase 通配域名。
- 增加项目说明、架构文档和云端配置说明。
- 已保留可直接用于 Chrome“加载已解压的扩展程序”的 0.2.2 历史交付物；0.2.3 尚未生成正式交付包。
- 已生成扩展 ZIP 和完整源码 ZIP 交付包。

## 下一步计划

**最优先：重载今晚构建的 `dist/` 做真机复看。** 除原有控件回归项外，额外确认：设置无顶部提示条、「更多」不贴边、卡片冷暗遮罩可滚完文案、文件夹/排序下拉圆角与淡描边且无绿框/黑描边、顶栏无底线。仍有问题先截图/`ui:shots` 再改，不要凭记忆猜。

统一增强协调器、所有正常打开方式补缺、7 天截图新鲜度、存量前台补拍、瀑布流稳定性和收藏库筛选排序均已实现。此外的重点是**真人安装态验收与商业化规模验证**，不是继续改交互规则：

1. 在真实 Chrome 重载最新 `dist/`，逐项验证 Chrome 星标、Aarre 新增、Aarre/地址栏/普通链接打开缺图旧收藏、新收藏静默首拍、旧收藏 toast、7 天静默刷新、多个后台标签逐个切回，以及批量补拍的失焦、快速暂停/继续、关闭专用标签页、超时、重定向和 Service Worker 休眠恢复；保留实际版本、权限与后台错误证据。
2. 对收藏库第二列长时间悬停、文件夹筛选、六种排序、状态组合、搜索相关度、URL 恢复、已删除文件夹回退、移动端布局和空状态做真人管理页验收。
3. 用不少于 300 条真实中英文书签完成封面来源分布、死链耗时、整理建议合理率、扫描并发和实际费用偏差报告。
4. 在 Chrome Web Store 后台创建正式 Extension ID，把 `privacy.html` 同内容部署到公开 HTTPS 地址；核对 Google Cloud callback 为 `https://sync.nexvoice.cc/v1/auth/google/callback`，Aarre API allowlist 为该 Extension ID 的 `chromiumapp.org/auth`，并与最终 Manifest 保持一致。
5. 若决定制作有声宣传片，配置正式 TTS 凭据后生成旁白并披露 AI 配音；当前中文字幕版可直接审阅。
6. F14 代码与本地集成已完成；下一门是准备正式 Extension ID / Google OAuth、`sync.nexvoice.cc` DNS/TLS、香港/新加坡 COS、SSM、两套独立 CAM 和生产 secrets，然后执行真实 COS、重装恢复、联合灾备与共机压测。F21 继续依赖 F14 的生产门；F8 第二/三层须先拍板 D7。

**第 5 批：F14 生产外部资源与上线验收**

2026-08-02 已完成服务器只读核对与隔离镜像构建：NexVoice 运行在腾讯云香港 `ap-hongkong-2`；观测时资源允许新增独立 320MiB `aarre-api`；实际 Docker 网络为 `production_default`；PostgreSQL 16、Caddy 与 GlitchTip 均健康。服务器在香港，因此旧方案里的“中国大陆节点 ICP 备案是当前阻塞”不成立；每次部署前仍要重新核对内存、磁盘、load 和容器状态。

上线前剩余外部资产：

- **正式身份** — 在 Chrome Web Store 固定 Extension ID；Google Cloud Web client 只登记 `https://sync.nexvoice.cc/v1/auth/google/callback`，Aarre API 另行 allowlist 该 Extension ID 的 `chromiumapp.org/auth` 回跳。
- **API 入口** — 为 `sync.nexvoice.cc` 配置 DNS/TLS；未来取得 Aarre 独立域名时按双域名迁移，不改变客户端数据模型。
- **对象存储** — 创建 Aarre 独立的香港私有主 COS、新加坡私有灾备 COS、默认 SSE-KMS、版本/生命周期/跨地域复制，以及 API CAM 与 backup/deletion CAM。
- **生产密钥与恢复** — 在腾讯云 SSM 建立 Aarre envelope KEK，配置独立数据库密码、Token pepper、OAuth secret 和 root-only 环境文件，严禁复用 NexVoice 的业务密钥。

代码四门已经完成；外部资产齐备后按同一顺序做真实环境验收：认证与 metadata → COS PUT/HEAD/GET 与图片恢复 → 卸载重装/新设备 → 联合灾备与共机压测。任一门失败都不开放生产构建。旧 `supabase/` 已经删除，不要重新创建。

**待产品负责人拍板的决策**

`docs/PRD.md` 第 9 章里 D1、D3、D5、D6、D7 尚未定，Agent 遇到要停下来问，不要自行决定。D2、D9–D13 已完成产品与架构决策。

## 遇到的问题

- Chrome 原生书签只能保存标题、URL 和文件夹，不能承载摘要和标签。
- Chrome 扩展同步空间不足以存放正文和 AI 索引。
- Google OAuth 和生产扩展 ID 必须由真实 Google Cloud 与 Chrome Web Store 配置共同完成，开发期 unpacked ID 不能代替生产配置。
- Chrome 扩展不能复制地址栏未公开的计算器、站点搜索快捷词等内部逻辑。

## 已解决问题

- 使用 Chrome Sync 与自建云端的双层同步模型（原生层交给 Chrome，智能层自己同步）。
- 使用 Google 账号和 Chrome 配置文件邮箱一致性检查避免账号串库。
- ~~使用 Supabase RLS 隔离每个用户的数据。~~ **已随迁移作废。** 当前自建服务以 Auth/Sync/Asset/Account domain service 作为 repository 边界，所有在线用户数据 SQL 都从已认证账号取得 `userId`；结构测试会扫描并拒绝缺少 `user_id` 的语句，路由鉴权与跨用户资源/资产/冲突集成测试均已通过。
- 使用本地队列保证云端失败时原生书签仍能成功保存。
- 使用规范化 URL 资源键解决跨设备 Chrome bookmark ID 不可靠问题。
- Chrome 作为基础字段的唯一事实来源；智能索引自动关联，不再要求用户导入。
- 地址栏联想查询只在本机、只在用户输入时发生，不把完整历史记录上传云端。

## 未解决问题

**云端（F14，生产底座运行中、公开入口未开通）**

- 自建服务端、扩展客户端、数据库迁移、COS 协议、部署/备份脚本、香港/新加坡 COS、API 与 backup/deletion CAM、Google Web OAuth、生产 secrets、健康巡检和 GlitchTip project 均已建立并验证；公开端到端尚未完成，因此仍不能宣称云端生产可用。
- 正式 `sync.nexvoice.cc` DNS/TLS 仍待实际管理 `nexvoice.cc` 的 DNSPod 账号配置；正式 Web Store Extension ID、公开 Google OAuth、真实扩展同步、卸载重装/联合恢复和 50 用户压测仍待完成。KMS/SSM 是经成本评估后明确不购买的当前方案，不再列作“缺少配置”。
- 普通 `dist` 未注入生产 API，账号入口安全显示未配置；只有真实外部门通过后才允许用 `AARRE_CLOUD_RELEASE=1` 构建生产包。
- 生产 Google 登录需要正式 Extension ID 才能固定 Aarre API 的 `chromiumapp.org/auth` 回跳 allowlist，依赖 F17；Google Cloud 的 Web callback 则固定为 `https://sync.nexvoice.cc/v1/auth/google/callback`，两者不能混写。
- 图片资产、sequence change feed、加密冲突、重装恢复客户端、账户删除和离机备份/恢复工具已经实现；真实 COS、数据库隔离恢复和日志脱敏演练已执行，卸载重装、联合资产恢复及 50 用户压测尚未执行。
- F15 的版本化 archive 导入器尚未实现；当前只有本地/云端导出与云端登录恢复，不能把导出说成完整的离线导入闭环。

**产品与功能**

- 0.5.15 已用真实 DeepSeek Key 跑通校验、增强、普通问答、全量分批召回、进度与取消，并修复 localhost 假 AI；但 localhost 仍是评审数据，不能替代安装态 Service Worker 和用户真实收藏。Gemini/OpenAI、DeepSeek 额度错误后的 UI 恢复、以及重载 `dist/` 后的真实目录查询仍需单独验收。
- 旧版本已经丢失的 `useCases/contentType/questions/entities` 无法凭空恢复。它们会被 schema 版本识别为待补全，但为了避免未经确认消耗 BYOK，用量较大的全库补全仍由用户在设置中显式启动；日常新收藏和正常打开页面会按既有策略自动补齐。
- 删除原生书签目前不会立即永久删除云端资源。F14 的墓碑机制加 F2 的回收站会一起解决。
- 同一个 Canonical URL 的多位置、多备注模型目前合并为一个资源。
- F3 真实 300 条中英文书签样本的来源分布和质量地板指标尚未统一验收。
- 批量补拍入口和任务队列已改为按 `pageSnapshots` 实存计算，不再被陈旧 `snapshotAt` 隐藏；但页面快照库当前仍按产品既定策略最多保留 2,000 张。超过该规模时新截图会淘汰最旧截图，因此“全部长期保留”的容量策略仍需单独评估，不能把前台补拍说成无限容量。
- 0.4.1 的三条截图主路径失败属于历史安装态基线；当前工作区已补齐真正的 `"<all_urls>"`、统一持久协调器和普通浏览补缺，但尚未在真实 Chrome 重载最新 `dist/` 后逐项复测，因此只能说“源码与自动化已实现，真人安装态待验收”，不能沿用“当前源码缺少实现”或反向宣称真人已通过。
- Chrome 移动端没有扩展运行环境，后续需要 Web/PWA 管理端（F21）。
- 商店图标、截图、宣传图、中文字幕视频和文案已落盘；正式 Extension ID、公开隐私政策网址和安装版逐屏核对仍未完成。
- 浏览器控制工具明确拒绝 `chrome://extensions` 和 `chrome-extension://` 页面且禁止绕过，所以本轮无法把开发预览验收升级成安装态验收。
- 当前环境未配置正式 TTS 所需的 `OPENAI_API_KEY`；有声旁白未生成，现有视频为完整中文字幕版。

**2026-07-30 独立代码审查提出的未解决项**

完整清单见「最近更新」里的审查记录，此处只列需要优先处理的：

- ~~F22 实现与 PRD 对立、文档未同步。~~ **已解决：** PRD 已统一为纯真实快照；0.3.9 又补齐网页端截图优先 / Aarre 兜底和稳定采集口径。采集时间按产品修订继续只用于淘汰，不在封面显示。
- 删除确认文案写「此操作无法撤销」，与 F2 实际的 30 天可恢复能力矛盾。
- F7 整理提案无自动生成、无扫描完成引导，入口是一个无文字图标按钮，实际触达接近于零。
- F3 的「兜底率 ≤ 12%」既达不到（规则表 17 条 vs 目标 150+、透明背景合成未实现）也无法测量，需要先做统计工具。
- 未配置 AI 时，搜索页「让 AI 帮我找」与聊天页输入框仍会发出失败请求，违反 F4 验收标准。
- F1 命中项高亮未实现；搜索无防抖；`pinyin-pro` 297KB 进入侧边栏首屏预加载链。
- `SidePanelApp.tsx` / `background.ts` / `ManagerApp.tsx` 占代码量 54% 且测试用例为 0，建议至少补撤销执行链、扫描管线、预览渲染门三条集成测试。

**已作废，不再是待办**

- ~~尚无 Supabase 项目凭据~~ / ~~Edge Function 源码未发布~~ / ~~云端 AI 调用的按用户限流~~ — 云端 AI 富化和 pgvector 检索已整体下线，富化走 BYOK 直连、语义检索本地化，`supabase/` 目录将随 F14 删除。

## 验证情况

- **2026-08-01 · 0.5.3 编辑弹层统一与样式修复：** 类型检查通过；编辑器/侧边栏/模型专项测试通过（13 项）；设计 token 检查通过；暗色侧边栏列表与网页端收藏库编辑场景 UI 审计为 0 项问题。localhost 运行态验证：子书签 24px 内缩、状态胶囊左右 12px、重新发现条目底色分层、夜间编辑按钮亮色、侧边栏编辑保存备注后可重新读回。
- **2026-08-01 · 0.5.2 侧边栏样式走查：** `npm run check` 通过（51 个测试文件、271 项测试）；`npm run ui:audit -- 列表` 通过（0 项问题）；`npm run ui:shots -- panel library` 通过并生成侧边栏/网页端对照截图。localhost 两个页面均返回 200，开发服务器继续保留供集中走查。
- **2026-08-01 晚 UI 收口：** `manager-layout-stability` / `control-system-guardrails` / `sidepanel-layout-stability` 相关断言已更新并通过；设计 token 检查通过；`npm run build` 成功（Vite 生产构建 + `background.js` / `content-capture.js` + 全部 JS 产物语法检查）。请在 Chrome 用「加载已解压的扩展程序」指向本仓库 `dist/`。完整 `npm run check` 未在本轮末尾重跑全量。
- 当前 0.5.0 工作区此前 `npm run check`：通过；Node.js 22.22.2，包含设计 Token、TypeScript、51 个测试文件 / 263 项测试和生产构建。设计检查新增五条规则：控件高度必须走 `--control-h-*`、嵌套圆角必须成对、TSX 里禁止硬编码颜色/高度/圆角、带项目 CSS 类名的 `Button` 必须是 `variant="unstyled"`、禁止同时用变体和旧按钮类。
- 当前 0.5.0 `npm run ui:audit`：明暗两套主题 × 10 个场景共 0 项问题（检查项为高度 ≥ 24px、文字未被裁切、图标居中、无横向溢出、整行按钮撑满、hover 不反色；复选框、单选、标签删除键和正文内联链接按设计豁免高度）。hover 一项经过反向验证：故意去掉一个 `variant="unstyled"` 会报出 315 项。
- 当前 0.5.0 `npm run ui:shots`：14 个场景截图已人工逐张比对，包含行 hover、设置主页与「更多」二级页、侧边栏编辑弹窗与删除确认、网页端卡片编辑弹窗与下拉展开态、筛选下拉、键盘焦点环，以及收藏库/整理/阅读/报告/图谱/回顾六个视图。夜间模式另跑一轮，确认弹窗遮罩是变暗而不是变亮。
- **控件系统仍待真机验收。** 上述截图与审计都在 `npm run dev` 的 chrome mock 环境下完成，数据规模、真实封面和 Chrome 侧边栏的实际视口宽度都与安装态不同；用户在真机上发现的问题本轮已逐条修复，但需要重载 `dist/` 后再确认一次。
- 当前 0.4.4 工作区 `npm run check`：通过；Node.js 22.22.2，包含设计 Token、TypeScript、48 个测试文件 / 225 项测试和生产构建；`package.json` 与 `dist/manifest.json` 均为 0.4.4，产物必需 `host_permissions` 为 `"<all_urls>"`，40 / 40 张本地兜底 WebP 已进入 `dist/assets/`，共 62 个文件，无 source map 或测试文件。
- 当前 0.4.4 `npm audit --audit-level=high`：0 漏洞；`npm run verify:store-assets` 与 `git diff --check` 通过；`npm run verify:artifacts` 检测到当前没有 `outputs/` 交付包并安全跳过历史包校验。开发预览完成 1920px 第二列 24 帧悬停稳定采样、批量确认焦点闭环，以及 640px / 360px 弹窗与横向溢出检查，控制台 0 error；不替代安装态扩展验收。
- 0.4.4 批量补拍专项覆盖：真实候选筛选、主机交错、单并发、成功/失败/跳过计数、job/lease 精确提交、失焦和暂停吊销、旧 lease 不复活、前台确认文案、真实进度、暂停/继续/取消、完成关闭和实存候选数覆盖陈旧 `snapshotAt`。
- 0.4.3 历史 `npm run check`：通过；Node.js 22.22.2，包含设计 Token、TypeScript、45 个测试文件 / 208 项测试和生产构建；`package.json` 与 `dist/manifest.json` 均为 0.4.3，产物必需 `host_permissions` 为 `"<all_urls>"`，40 / 40 张本地兜底 WebP 已进入 `dist/assets/`。
- 0.4.3 历史 `npm audit --audit-level=high`：0 漏洞；`npm run verify:store-assets` 与 `git diff --check` 通过；开发预览完成默认桌面、600px、360px、编辑/保存/删除确认、收藏搜索与封面分布检查，控制台 0 error。
- 0.4.2 历史 `npm run check`：通过；Node.js 22.22.2，包含设计 Token、TypeScript、41 个测试文件 / 183 项测试和生产构建；`package.json` 与 `dist/manifest.json` 均为 0.4.2，产物必需 `host_permissions` 为 `"<all_urls>"`。
- 0.4.2 历史 `npm audit --audit-level=high`：0 漏洞；`npm run verify:store-assets` 与 `git diff --check` 通过；`npm run verify:artifacts` 检测到当前没有 `outputs/` 交付包并安全跳过历史包校验。
- 当前截图与增强专项自动化覆盖：真正的 `"<all_urls>"` Manifest 权限；持久任务分项状态；页面稳定、敏感域名、前后台/无痕/URL 与文档变化拒绝；真实截图大封面/Aarre 兜底；新收藏静默与旧收藏 toast 合并规则；7 天截图新鲜度纯函数。
- 当前收藏库 UI 专项自动化覆盖：隐藏 Chrome 系统根目录、根目录/嵌套/父目录筛选、同资源多位置去重、目录计数、Chrome 默认顺序、最近/最早收藏、最近使用、搜索相关度、已理解/待处理、URL 状态往返和非法参数回退；管理页封面与统一链接行为有集成测试。
- **最新安装态仍待复测。** 0.4.1 的三条真人失败结果保留为历史回归基线，不代表当前源码仍未实现；当前浏览器控制能力因安全策略不能读取 `chrome://extensions` 与 `chrome-extension://`，无法在本轮代替真人重载并操作最新扩展。
- 0.4.0 `npm run check`：通过；Node.js 22.22.2，包含设计 Token、TypeScript、38 个测试文件 / 165 项测试和生产构建；`package.json` 与 `dist/manifest.json` 均为 0.4.0，`dist/` 约 1.9 MB。
- 0.4.0 专项自动化覆盖：右键页面文案的无匹配/已匹配/查询失败状态；完全相同、canonical-only、多条与只读收藏识别；增强任务去重、分项完成和退避；补拍 toast 单实例与自动清理；0.3.9 的真实截图大封面与 Aarre 兜底策略继续通过。
- 0.4.0 `npm audit --audit-level=high`：0 漏洞；`npm run verify:store-assets` 与 `git diff --check` 通过。
- 0.3.9 `npm run check`：通过；Node.js 22.22.2 / npm 10.9.7，包含设计 Token、TypeScript、36 个测试文件 / 155 项测试和生产构建；`package.json` 与 `dist/manifest.json` 均为 0.3.9，`dist/` 约 1.8 MB。
- 0.3.9 专项自动化覆盖：大封面真实快照优先、无快照只用统一 Aarre 兜底图、`og:image` / 分类封面不进入大封面、loading / 后台 / 无痕 / URL 已变化的标签绝不进入截图，以及 960px 快照尺寸。
- 0.3.9 `npm audit --audit-level=high`：0 漏洞；`npm run verify:store-assets`、`npm run verify:artifacts`（当前无 outputs，安全跳过）和 `git diff --check` 通过。
- `npm run check`：通过；包含 TypeScript 类型检查、28 个测试文件 / 98 项测试和生产构建，`dist/manifest.json` 版本为 0.3.2。
- `npm run verify:store-assets`：通过；5 张 JPEG 精确尺寸正确，宣传视频为 35.63 秒、1280×800、30fps、H.264/AAC。
- `npm audit`：0 个已知漏洞。
- Playwright 浏览器视觉检查：管理页桌面/移动端、侧边栏书签树/搜索建议均通过；无控制台错误。
- 侧边栏对齐评审：六行箭头 X 坐标均为 321px、文件夹图标 X 坐标均为 345px、标题 X 坐标均为 377px；每行箭头与文件夹图标垂直中心完全一致。
- Agent 输入框提交、清空和智能管理跳转请求已在本地评审页验证；账号服务区已确认不再渲染，控制台无错误。
- 本地评审页已实际把“工作与内部系统示例收藏”从第 1 位拖到第 5 位，顺序成功持久化且无控制台错误；输入框聚焦时实测 `outline: none`，仅保留中性容器边界。
- 渐隐遮罩已验证：顶部时 `--bookmark-fade-start=1 / --bookmark-fade-end=0`，离开顶部后 start 变为 `0`，滚动到底 end 自动变为 `1`；自定义手柄实测可从 `scrollTop=220` 拖到 `453`，闲置后 `opacity=0`。展开面板使用 320ms `cubic-bezier(0.16,1,0.3,1)`，收藏浮层进入过程中实测同时存在透明度、位移和缩放。
- 设置页与自定义下拉已在本地预览验证：Key 保存后只显示 `•••• + 后四位`；下拉可用 ArrowDown + Enter 完成选择；收藏浮层和设置输入框聚焦均为 `outline: none` 与单层中性 1px 边框。
- AI 服务商预设已验证：OpenAI 切换后模型为 `gpt-5.6-luna`，DeepSeek 切换后模型为 `deepseek-v4-flash`，未填写对应 Key 时保存按钮保持禁用。
- `npm run verify:artifacts`：通过；当前没有 `outputs/` 交付包，脚本安全跳过；后续生成包时仍会校验文件名、Manifest 版本和压缩结构。
- 两个 Supabase Edge Function 已完成独立 TypeScript 打包解析检查。
- 生产构建已检查，不包含源码映射、测试数据或项目密钥。
- npm 依赖审计：0 个已知漏洞。
- 书签知识卡实测为白底、无投影、约 5.5% 中性色描边和 14px 圆角；扫描前后分别为紧凑/展开状态，内容自然换行。编辑页可查看完整 AI 简介与主题，新增“用户精选”标签保存后重新打开仍存在，并显示“采用你的版本”；浏览器控制台无错误。
- 尚未声称 Google OAuth、Supabase、Gemini、Chrome Sync 已完成真人端到端验证。
- 当前 `dist/` 已由最新工作区重新构建；自动化通过，但三条历史失败路径和新增的普通浏览/7 天刷新矩阵尚未完成真人安装态复测，因此不得把本地产物描述为已经通过全部发布验收。

## 暂不应并行修改

**当前无人占用。** 今晚收口刚落地；若继续改 UI，优先独占下表，做完再清。

| 文件 | 占用者 | 需求 |
| --- | --- | --- |
| （空） | — | 上一轮涉及 tokens / shape / Elevated / Select / manager.css / SidePanelApp 设置页，有冲突先读「晚 · UI 收口」 |

**长期规则**

- `src/extension/background.ts`（约 5,800 行）和 `src/ui/sidepanel/SidePanelApp.tsx`（约 4,900 行）是两个高冲突文件。**同一时间只允许一个 Agent 修改其中任意一个**，必须先在上表登记。
- 云端相关文件由 F14 独占改造，其他需求不要触碰：`src/lib/auth.ts`、`src/lib/cloud.ts`、`src/lib/supabase.ts`、`scripts/build.mjs`、`supabase/` 整个目录。
- **IndexedDB 版本号是共享资源，必须串行分配**：v2 归 F2 的 `undoSnapshots`、v3 归 F3 的 `siteBrands`、v4 归 F22 的 `pageSnapshots`。两个 Agent 同时改成同一个版本号会导致其中一方的 store 永远建不出来。
- `src/lib/storage.ts` 的 `normalizeResourceRecord` 会被多个需求同时加字段。**只追加，不重排，不改已有字段的默认值**，这样多方改动能自然合并。

详细的文件归属表见 `docs/PRD.md` 第 12.2 节。

### 2026-07-31：修复宽控件被拉成透镜形

- 根因：组件迁移时将胶囊圆角从固定大半径误改为 `50%`，长宽比例较大的搜索框、状态分段和操作按钮因此出现椭圆/透镜形变。
- 修复：新增统一 `--radius-pill: 999px` 设计 token，并让搜索框、搜索按钮、状态分段、报告周期切换和补齐封面按钮统一使用该 token。
- 验证：按 2048×768 宽屏场景复查；`npm run check` 全通过（设计 token、类型检查、48 个测试文件 / 225 项测试、生产构建），`dist` 已重新生成。

### 2026-07-31：稳定收藏卡片 Hover 与统一封面比例

- 根因：收藏区使用 CSS 多列布局，同时 Hover 通过修改详情区高度触发多列重新平衡；卡片还按索引随机分配三种封面高度，造成同排封面尺寸不一致和 Hover 时卡片跳动。
- 修复：收藏区改为顶端对齐的响应式 Grid；卡片封面统一为 `16:9`；移除 `short/regular/tall` 随机封面档位。Hover 详情仍位于现有内容下方，但只扩展当前卡片，同排兄弟卡片不再被拉伸。
- 验证：本地预览复查默认布局无额外空槽、首屏封面比例一致；`npm run check` 全通过（设计 token、类型检查、48 个测试文件 / 225 项测试、生产构建），并新增布局稳定性回归约束。

### 2026-07-31：独立列 Hover、封面居中与编辑弹窗层级修复

- 瀑布流：新增可复用 `StableMasonry`，按容器宽度响应式分配 1–4 个独立列。卡片展开只推动当前列下方内容，不再改变整行或其他列的位置。
- 封面：维持 `16:9`，图片裁切锚点改为正中央（`50% 50%`）。
- 编辑弹窗：通过 React Portal 挂载到 `document.body`，脱离卡片层叠上下文，遮罩和弹窗不再被后续卡片覆盖。
- 验证：真实页面测得其他三列 Hover 前后位移均为 0；遮罩父节点为 `BODY`；48 个测试文件 / 225 项测试、类型检查、设计检查、生产构建和交付物校验全部通过；`dist` 已更新。
