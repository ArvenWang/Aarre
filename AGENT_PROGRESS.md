# Aarre 项目进展

最后更新：2026-08-04（整理提案已移除主题归纳；待读队列已完整下线；用户重载验收与真实 Provider 项待完成）

> **⚠️ 下一位 Agent 必读：先读 [`docs/AUDIT_2026-08.md`](docs/AUDIT_2026-08.md)（问题分析）和 [`docs/PRD_REBUILD_2026-08.md`](docs/PRD_REBUILD_2026-08.md)（执行方案），再以本页顶部最新记录为当前事实。T-01～T-20 与 T-14c 的代码和自动化已收口，不要重做已完成项，也不要在旧架构上打补丁；真人 Chrome / Provider 验收仍是外部门。**

## 2026-08-04 · 整理提案与导航范围收缩

- **整理提案去除主题归纳。** 提案现在只保留重复书签、失效链接和大文件夹容量提醒；不再根据主题、标签或摘要生成归类、移动、拆分建议。大文件夹只报告当前位置和收藏数量，不暗示按主题整理。
- **待读队列完整下线。** 已移除管理页 Tab、路由、视图组件、数据模型、计算逻辑、样式、预览数据、截图脚本和产品文档；旧 `?view=reading` 链接会安全回退到收藏库。
- **边界保持。** 保存单条书签时的目标文件夹建议与独立的主题图谱仍保留，它们不再进入整理提案；旧本地提案缓存升级到 v2，历史主题提案不会在重载后重新出现。
- **回归门与验证。** 新增源码守卫，禁止恢复 `reading` 视图、`readingQueue` 数据或 `classify` 整理提案。Node 22 下 `npm run check` 全绿：77 个测试文件 / 408 项测试、设计令牌、TypeScript、双生产构建与 JavaScript 产物语法检查全部通过；`dist/` 已重建。真实管理页显示 5 个 Tab 和 3 张非主题提案卡片，旧 `?view=reading` 安全回退收藏库，页面无运行错误。

## 2026-08-04 · MV3 后台初始化崩溃修复 + T-14c 公共 favicon 兜底

- **后台崩溃完整根因与修复。** 首条 `document is not defined` 来自 Vite 动态模块预加载助手；用户重载后第二条 `window is not defined` 暴露了更深根因：Chrome 官方明确说明扩展 MV3 Service Worker 不支持 `import()`，而 PRD 重构把右键菜单、Agent、同步、扫描、拼音等后台路径改成了动态导入。构建现拆成两路：侧边栏/管理页继续按需分包，background 由独立 Vite 配置构建并关闭 code splitting，所有后台动态模块内联为单个合法 ESM 文件。
- **永久构建门。** `scripts/check-built-javascript.mjs` 现在会直接拒绝任何仍含 `import()` 的 `dist/background.js`；架构测试要求页面配置不再把 background 当普通 client 入口，并要求后台配置固定 `codeSplitting: false`。这从产物层阻断 `document`、`window` 与动态导入三类同根回归。
- **T-14c 云端 422 兼容修复。** 新增开关最初随完整 `DisplaySettings` 上传，生产服务端 strict schema 不认识 `publicFaviconFallback`，导致同步显示 `unrecognized_keys`。该开关现明确为设备本地隐私偏好：云端 payload 只序列化既有四个白名单字段，云端恢复也保留本机开关。失败请求没有写入本地同步 hash，用户重载后下一次重试即可恢复，无需发布服务端。
- **资产尺寸 422 修复。** 设置同步通过后，图片上传暴露 `width expected int, received number`：SVG 的合法 `viewBox` 会产生小数固有尺寸，客户端此前原样提交，而服务端只接受 1–16384 整数。统一上传入口现对所有图标、快照和封面尺寸四舍五入并限制范围；0、NaN 与缺失值直接省略，单张历史资产不会再阻断整条同步。
- **账号区块系统性重设计。** 大重构后头像 `<img>` 未挂载稳定头像容器，账号文字又依赖宽泛的 `> div` 选择器；统一 Button 新增内容层后，云状态和操作按钮的旧 CSS 也未适配，导致头像放大成方图、状态居中、操作退化为裸文字。现改为显式 avatar/identity 类，头像固定 36×36 圆形；身份、只读同步状态、常驻操作拆成三组，状态不再承担展开/收起。空闲/暂停/失败时“立即同步”和“断开账号”始终可见；同步中显示中性墨色进度并只禁用重复同步；失败错误直接展示并限制三行，高用量达到 80% 才显示。开发预览支持 `?account=signed-in&sync=active|error&usage=high`，用于永久多状态视觉回归。
- **账号身份版式定稿。** 按用户确认版式将头像与“用户名 + 同步状态”组成稳定首行：用户名使用现有 `--fs-body`，状态使用 `--fs-caption`，36px 头像与两行文字整体精确垂直居中；进度、错误、用量和两个常驻按钮均排在文字列下方，不会在状态切换时拉动头像。长用户名保持单行省略，完整错误保持三行保护。
- **重新登录不再重传图片。** 登录/退出仍会为账号安全清空本机同步追踪，但图片同步开始时会用当前账号的远端 active 资产和 SHA-256 重建权威状态；本地内容与云端哈希相同即只校验、不再 POST/PUT 图片。云端无记录或内容确有变化时才上传，账号切换不会误用上一个账号的状态；恢复阶段另外检查本机实际图片，避免把“云端已有”误当成“本机已有”。
- **图片进度改为固定总数。** 上传/下载批次现返回 `processed/total`，状态栏直接使用本轮完整任务数量，不再用“已完成 + 1”伪造未知分母；例如 121 项会稳定显示 `12/121 → 24/121 → 121/121`。拉取、推送、图片上传和图片恢复统一使用用户确认文案“正在同步数据”。
- **单一设计系统回归收口。** 六处用户截图的共同根因是共享 Button 迁移后仍叠加浏览器默认外观和页面旧绘制层：共享 Button 根部现统一 `appearance-none / border-0 / shadow-none`，tertiary/danger-quiet 再由唯一 variant 添加 1px 语义描边；文件夹和书签条目的 ghost 内层不再绘制 Hover，圆角 row 成为唯一背景；开关位移公式纳入左右 1px 边框，开启态上下右物理间距均为 3px；历史会话主按钮改为流体高度，内部内容层成为明确 Grid，长标题、时间、两行摘要、箭头和操作区不再重叠。暗色网页端另修复封面编辑按钮被 ghost 文本色覆盖的问题。
- **跨端审计能力恢复。** `ui:audit` / `ui:shots` 支持通过 `PLAYWRIGHT_CHANNEL=chrome` 使用系统 Chrome，且删除确认场景改用统一 Button 的 `data-variant`，不再依赖已删除的 legacy 类。亮色侧边栏/设置/网页端宽窄屏/编辑/删除/整理/报告审计 0 项；暗色侧边栏和修复后的网页端宽屏审计 0 项。
- **历史会话信息顺序定稿。** 历史条目按用户指定改为纯纵向“标题 → 最多两行摘要 → 时间”，标题固定单行省略，时间不再与标题争抢宽度；打开会话的右箭头已从组件和 CSS 中删除，右侧只保留改名与删除操作。420px 真实页面长标题/长摘要验证无重叠、无横向溢出、无页面错误。
- **用户隐私决策已执行。** 用户明确同意 T-14c。公共站点图标补全默认开启、可在「设置 → 显示」关闭；仅在站点自身、Manifest、固定品牌资产和主域候选全部失败后，才尝试 Google S2 / DuckDuckGo Icons，并且只发送 hostname，不发送完整 URL、正文或 Cookie。
- **强制隐私边界。** 银行、支付、医疗、内网、本地地址与用户 `snapshotExcludedHosts` 排除项永远不生成第三方候选；隐私页已如实披露服务商、数据范围和关闭入口。旧 `docs/PRD.md` 的“不做第三方图标服务”决策已标记由 2026-08-04 用户决定取代。
- **验证。** Node 22 下 `npm run check` 全绿：76 个测试文件 / 399 项测试、设计规则、TypeScript、双生产构建与 JavaScript 产物语法检查全部通过；后台最终使用 library/worker 构建，`dist/background.js` 880.08 KB（gzip 290.04 KB），动态 `import()`、`document.getElementsByTagName` 与 `window.dispatchEvent` 均为 0。设置页在系统 Chrome 真实渲染：公共图标开关默认开启且 `aria-checked=true`；登录账号头像 36×36，成功/上传中/失败三态的静态状态、常驻操作、进度、错误和高用量均符合状态矩阵且无页面错误。自动侧载仍未产生 Service Worker（系统 Chrome 忽略测试侧载参数），因此不能冒充安装态完成；用户需在 `chrome://extensions` 重载后确认后台错误、同步 422 与账号区块真机样式。

## 2026-08-04 · T-06 / T-07 审核残留修复

- **审核基线校正。** `docs/REVIEW_2026-08-04_T06_T07.md` 基于旧提交 `ae19775`；报告中的 3 项失败测试与 T-07 未拆分问题在当前 `8bc41c5` 已解决。当前 `SidePanelApp.tsx` 为 393 行，侧边栏全部 TS/TSX 单文件均不超过 500 行。
- **永久绿测试修复。** `surface-coexistence.test.ts` 不再只读取 3 行入口文件，而是递归扫描整个 `src/extension/`，确保禁止的 action click、side panel close 和 manager 协调逻辑不能迁移到其他模块后逃过检查。
- **断言有效性。** `AgentThinkingSteps` 断言改为检查 `AgentChatPage` 是否真实导入并渲染该组件，不再读取组件自身证明自身存在；同时移除未使用的 `backgroundUrl`。
- **统一源码守卫。** 新增递归源码读取工具，并把 React boot gate、已删除文案、旧 Agent 历史限制、云状态轮询和 AI 重复说明等全局禁用项扩大为整个 sidepanel 目录检查。组件和 CSS 局部约束仍保持精确文件范围。
- **架构防回归。** 新增 T-06/T-07 专项测试：`background.ts` 必须低于 400 行且同步调用 `initializeBackground()`；侧边栏任一 TS/TSX 文件超过 500 行会直接失败。
- **验证。** 专项 5 个测试文件 / 44 项通过；`npm run check` 全绿：72 个测试文件 / 381 项测试、设计规则、TypeScript、生产构建及 JavaScript 产物语法检查全部通过。`dist/background.js` 144.62 KB、首屏 sidepanel CSS 71.89 KB，版本保持 0.5.61。

## 2026-08-04 · T-18 / T-19 / T-20（UI 极简化完成）

- **文案。** 按 PRD 清单逐项删除说明性副文案并收口空状态；生产 UI 搜索 `Aarre 会`、`智能增强` 均为 0。隐私、不可逆操作和成本说明保留。
- **组件。** 两个 UI 目录已统一到 `src/ui/components/ui/`，`src/components/` 已删除；所有按钮与输入控件均通过统一组件，新增 Radix Checkbox，`variant="unstyled"`、legacy `.button` 类、相对 UI import 和 `--space-*` 均为 0。
- **规范与防回归。** 新增 `docs/UI_PRINCIPLES.md`；`check:design` 会拒绝 UI primitive 目录外的原生按钮/输入框、unstyled、相对 UI import 和硬编码颜色/尺寸。共享编辑字段样式独立为 `editor-fields.css`，侧边栏与 manager 不再互相加载整页 CSS。
- **视觉验证。** `npm run ui:shots` 完整生成侧边栏、设置、编辑器、manager 各视图与键盘焦点截图；人工检查主按钮、弹窗、表单和瀑布流未见视觉回归。修复了审查中发现的主按钮深色背景/深色文字问题。

## 2026-08-04 · X-01 ~ X-07（启动性能完成自动化收口）

> **状态校正（2026-08-04）：** 下方 background lazy chunk / 144.62 KB 结论依赖 MV3 不支持的动态 `import()`，已被本页顶部修复取代。侧边栏 CSS 与页面分包收益仍成立；后台性能需要在合法单包基线上重新测量，不能再以 144.62 KB 作为可交付指标。

- **首屏。** 侧边栏与 manager 使用独立 CSS 入口；设置/Agent/引导样式拆为 lazy CSS。侧边栏首屏 CSS 从 **94.93 KB** 降到 **71.90 KB**，满足 `<80 KB`。onboarding 用 localStorage 同步乐观读取并移除 React boot gate。
- **后台。** 首屏改为单条 `GET_BOOTSTRAP`，站点标识、重浮现、整理提示、完整 AppState 与 Agent 会话延迟 1 秒。重复视觉与过期撤销清理合并到每日 alarm。云同步、Agent、Agent 写计划、目录扫描和右键菜单重模块均通过同步注册的轻量代理动态加载。
- **主包。** `dist/background.js` 从本轮基线 **212.14 KB** 降到 **144.62 KB**，下降约 **31.8%**，满足 `>30%`，并生成独立 `sync-engine`、`agent`、`agent-actions`、`library-scan-runner`、`context-menus`、`page-snapshot`、`cover-registry` 等 lazy chunk。React、Radix、Markdown 与拼音已固定手动分包。
- **测量。** 新增 `scripts/measure-startup.mjs` 与 `docs/PERF_BASELINE.md`。当前自动化环境无法让 Chrome/Chromium 接受 MV3 side-load，15 秒内未出现 Service Worker，因此文档只确认 bundle 基线，运行时四项明确标为待真机，未伪造数据。

## 2026-08-04 · PRD 最终自动化门

- **验证。** 版本已递增为 **0.5.61**；`npm run check` 全绿：71 个测试文件 / 379 项测试、设计规则、TypeScript、生产构建和产物语法检查全部通过；`dist/manifest.json`、`public/manifest.json`、`package.json` 均为 0.5.61。`background.ts` 3 行；sidepanel 所有 TS/TSX 单文件均低于 500 行，原 1,846 行预览已拆成 8 个模块。
- **产品决策门。** T-14c 公共 favicon 服务会把域名发给 Google / DuckDuckGo；PRD 明确要求用户先同意，因此未实现、默认无外发。若用户同意，必须加设置开关、敏感站点排除和隐私说明。
- **真人验收门。** 仍需安装态 Chrome 手工验证：侧边栏/右键保存删除/登录保持、用户封面重访不变、100+ 卡片首屏与滚动内存、三家真实 Provider SSE、100+ Agent 写计划的取消/撤销、跨设备删除墓碑。自动化和截图不能替代这些门。

## 2026-08-04 · T-15 / T-16 / T-17（代码与自动化完成）

- **多轮工具 Agent。** 新增 `src/lib/agent/`：7 个立即执行的只读工具、5 个只生成待确认计划的写工具、Zod→JSON Schema、最多 12 轮 runner，以及 OpenAI/DeepSeek/Gemini tool-calling 适配器。重复组和失效链接直接复用 `library-insights` 的真实结果。生产 `askAgent` 已切换新链路；写工具不调用 Chrome API。
- **旧管线删除。** `local-ai.ts` 已删除 `repairJsonStringNewlines`、旧 `generateAgentJson` 重试循环、`scanAgentCatalog` 与 `parseAgentActions`，JSON 只保留严格基础解析；文件从约 1,700 行降到 754 行。enrichment 仍保留自己的完整字段校验，不受影响。
- **计划安全执行。** 固定顺序为建文件夹→移动→重命名→元数据→删除；自动补齐嵌套文件夹计划，执行时按路径解析新建文件夹 ID。上限 1000 项，每 50 项让出主线程并推送进度；取消后保留已完成项；单项失败继续；整批复用一个 undo batch。删除项 `selected=false`，UI 默认不选，按分组折叠预览并显示警告。
- **真实流式。** UI 通过 `runtime.connect({name:"agent-stream"})` 主动建链，SW 在同步初始化路径注册 `onConnect`；工具阶段走结构化非流式，最终回答由 Provider SSE 分块发送。20 秒无 chunk 才超时，总请求上限 5 分钟；UI 断开立即 abort。
- **验证。** `npm run check` 全绿：71 个测试文件 / 379 项测试、设计令牌、类型、构建和语法检查通过。专项覆盖 JSON Schema、只读/写工具边界、12 轮强停、完整工具场景、500 项批处理、取消、部分失败、顺序、单 undo、流式 delta 与断连取消。
- **性能处理。** Agent runner/provider/Zod 已动态加载；修正前 background 一度涨到 293.47 KB，修正后恢复为 211.75 KB，接近拆分前 211.06 KB。独立 `runner` 76.21 KB、`providers` 5.58 KB，仅首次对话加载。
- **未完成门。** 真实 Provider 的三家 SSE、100+ 条真实书签执行/取消/撤销仍需 Chrome 手工验收，自动化不能替代。当前计划卡片用了原生 checkbox，T-19 收敛组件时需迁到统一 UI 组件。

## 2026-08-04 · T-11 / T-12 / T-13 / T-14a-b（代码与自动化完成）

- **统一视觉存储。** IndexedDB 已升到 v5，新增 Blob 型 `visuals` store（`kind` / `identity` 索引）及单条、批量、按类型接口。旧 site brand、page snapshot、resource thumbnail 由独立 alarm 每批 50 条幂等迁移；损坏 dataURL 只跳过该项，不阻断全批；旧字段保留一版回滚。扩展页面直接读同源 IndexedDB，不通过 JSON 消息传 Blob。
- **用户封面保护。** 所有生产封面写入已收敛到 `putVisual` / `putCoverSnapshot`：自动来源不能覆盖用户来源，除非显式 `force`。手动更新封面标记 `user`，批量补拍/自动截图/扫描标记 `auto`，云端恢复也经过同一守卫。危险的启动即整组删除旧快照已移除，改为每日只清理重复自动封面、每组保留最新一条。
- **瀑布流。** manager 卡片同一帧请求合并为一次 IndexedDB 批量读取，使用 Blob object URL、200 项 LRU 和淘汰 revoke；滚出视口不清空，图片使用 lazy + async decode。源码不再逐卡发送 `GET_PAGE_SNAPSHOT` 消息。
- **站点标识。** 主线程与离屏解码统一引用 `ICON_MIN_SIZE=16`、`ICON_MAX_RATIO=3`、`ICON_MIN_INK=0.01`；候选按 4 条一组并行探测、严格按原优先级选择，每条 5 秒超时，第一组成功后不访问低优先级组。测量器也改为引用同一常量。
- **量化证据。** 对同一批 Chrome + Comet 真实书签、相同 300 条样本和并发 5 测量：旧规则分类兜底率 **54%**（`docs/cover-fallback-before-prd-t14.json`），新规则 **40%**（`docs/cover-fallback-after-prd-t14.json`），下降 14 个百分点，满足“改动后低于改动前”。
- **验证。** `npm run check` 全绿：68 个测试文件 / 384 项测试、设计令牌、TypeScript、构建和产物语法通过。新增 visuals store、迁移幂等、origin 守卫、LRU/直读与并行候选专项测试。
- **未完成门。** T-12 用户封面重新访问、T-13 100+ 条首屏 <500ms/滚动/Memory 及消息计数仍需真实 Chrome 手工测量。T-14c 会把访问域名交给公共 favicon 服务，PRD 明确要求用户先同意；当前没有实现、没有默认外发。

## 2026-08-04 · T-08 / T-09 / T-10（代码与自动化完成）

- **统一同步引擎。** 新增 `src/lib/sync-engine.ts`，所有触发统一进入单实例流水线：拉资源 → 拉其他实体 → 推 Outbox → 推其他实体 → 上传资产 → 下载资产。覆盖登录、启动、安装、联网、UI 打开、本地变更和 1 分钟 alarm；失败按 30 秒、1/2/5/15 分钟退避，未登录写 `paused`，状态通过 `chrome.storage.local` 持久化并用消息实时推送。旧 `cloud-progress.ts` 已删除，业务代码不再读取 `cloudSettings.enabled`，旧设置只作兼容并强制迁移为完整同步。
- **删除墓碑。** `ResourceRecord.deletedAt` 已落地。最后一个 Chrome 书签位置删除后，本地资源转为墓碑、进入 Outbox 并请求同步；上传带 `deleted: true`；确认 Outbox 版本未被并发替换后才物理删除。本机拉到云端墓碑只删除 Aarre 智能层，不调用 `chrome.bookmarks.remove`。全量 bootstrap 与增量 change feed 均处理墓碑。
- **云状态 UI。** 设置页登录态默认只显示头像/名字/一行状态；详情默认收起，用量仅达到 80% 后显示，只在 idle/error 提供立即同步，仅保留断开账号。新增 `CloudStatusRow` 与 `useSyncStatus`，状态靠消息订阅更新，没有轮询，也没有重新引入同步范围选择。
- **验证。** `npm run check` 全绿：65 个测试文件 / 375 项测试、设计令牌、TypeScript、生产构建和产物语法检查均通过。`dist/` 已更新；主 sidepanel 61.30 KB，background 207.36 KB。T-08/T-09/T-10 新增专项测试均通过。
- **下一步。** 执行 T-11～T-14 视觉资产统一。T-06/T-07 的真实 Chrome 手工清单仍是明确未完成门；受工具安全边界限制，不能用自动化冒充。T-07 生产入口已收口为 `SidePanelApp.tsx` 399 行，但开发预览 `preview.ts` 仍需在最终逐项审计前拆到单文件 <500。
- **并行占用。** T-11～T-14 收口前，不要并行修改 `src/lib/storage.ts`、视觉资产/快照路径、`src/lib/cloud-assets.ts` 或对应测试。

## 2026-08-04 · T-07 / 拆分 SidePanelApp（生产代码完成，待预览文件与真实 Chrome 门）

- **已完成。** `AgentChatPage`、`AgentHistoryPage`、`OnboardingPage`、`SettingsPage` 均已迁到 `pages/` 并通过 `React.lazy` + `Suspense fallback={null}` 加载；`AgentComposer`、`AgentThinkingSteps`、`BookmarkTree`、`SearchBar`、`LibraryHeader`、`LibraryNotices`、`RankedBookmarkResults`、`FolderSelect` 和 `BookmarkPreview` 已迁到 `components/`。设置页进一步拆出账号云同步、AI 服务、显示、扫描、更多页和扫描确认弹窗；`SettingsPage.tsx` 已降到 479 行，满足单文件 <500。侧栏滚动条与书签预览状态已迁入独立 hooks。`react-markdown` 和 `remark-gfm` 现在只由 lazy 的 `pages/AgentChatPage.tsx` 引入。主 sidepanel 产物约 55 KB，已满足 ≤150 KB，并生成独立 AgentChat、AgentHistory、Onboarding、Settings chunks。
- **验证。** TypeScript 通过；62 个测试文件 / 366 项测试及生产构建在本轮拆分过程中全绿。书签树迁出后相关源码守卫已改为读取新的权威文件，随后 highlight / preview / layout 22 项专项测试再次全绿。
- **后续收口。** `SidePanelApp.tsx` 已降到 399 行，`HomePage` 与主要 hooks 均已拆出；生产组件满足目标。开发预览 `src/ui/sidepanel/preview.ts` 仍超过 500 行，需在最终审计前拆分。真实页面切换手动清单仍未执行。
- **并行占用。** T-07 收口前不要并行修改 `src/ui/sidepanel/`、`tests/sidepanel-layout-stability.test.ts` 或相关 sidepanel 源码守卫。

## 2026-08-04 · T-06 / 拆分 background.ts（代码收口完成，待真实 Chrome 手动清单）

- **改动。** T-06 的 12 个代码拆分步骤已全部完成。`background.ts` 从 9,207 行降到 3 行，只导入并同步调用 `initializeBackground()`；同步装配位于 794 行的 `bootstrap.ts`。context menus、alarms、install、settings、site-icons、snapshots、agent、cloud、bookmarks、resources、page coordinators、enhancement queue、library scan 与各类 Chrome 事件均已分模块；消息路由已从 switch 改为 `handlers/index.ts` 表驱动。所有 `addListener` 都在 bootstrap 同步执行期间由显式注册函数注册，没有放入异步初始化。所有 extension TypeScript 文件均低于 800 行，最大文件为 `bootstrap.ts`（794 行）。
- **验证。** 每个子步骤后均运行类型检查和全量测试；最近一次为 62 个测试文件 / 366 项测试全绿。生产构建与 JavaScript 语法检查通过，`dist/background.js` 为 209.68 KB，相对拆分前 211.06 KB 减少约 0.65%，满足 T-06 的 ±5% 门。为消除工厂装配带来的体积增长，已提前完成 X-05 的 `local-ai.ts` 动态加载，产出独立 `local-ai-*.js` lazy chunk；X-05 的最终“主包下降 >30%”门仍未完成，后续还需动态拆 cover/page-snapshot。
- **遗留。** T-06 只剩真实 Chrome 手动清单（侧边栏、右键菜单、保存、删除、登录保持）；自动化证据不能冒充真人浏览器证据。完成该门后方可把 T-06 标记为完成并提交。随后进入 T-07 SidePanel 拆分。
- **PRD 技术校正（暂不改 PRD 原文）。** ① T-08 已把同步范围固定为完整备份，T-10 详情面板不得按后文示例重新加入“仅文字 / 完整备份”；② 当前最低支持 Chrome 134，而 Chrome 扩展消息在兼容范围内仍使用 JSON 序列化，T-11 不能直接通过 `runtime.sendMessage` 返回 Blob，实施前应改为扩展页面直接读取同源 IndexedDB，或另做经验证的二进制通道；③ T-17 应由 UI 调用 `runtime.connect()`、Service Worker 顶层监听 `runtime.onConnect`，不能由后台自行 `connect()` 冒充向 UI 建链。以上均已由 Chrome 官方消息机制文档核对，实施对应任务前再写专项测试。
- **并行占用。** 继续 T-06 前不要并行修改 `src/extension/background.ts`、`src/extension/lifecycle/`、`src/extension/handlers/` 或 `src/extension/snapshots/`；其他 UI 与文档文件可独立工作。

## 2026-08-04 · P0 同步根因修复（已完成，根目录 366 项 + 服务端 22 项测试与构建通过）

本轮把「另一台设备改了东西同步不过来」的四个根因全部修掉，并把冲突合并从记录级升级为字段级。

**T-01 收藏位置标识跨设备统一。** `bookmarkItemId` 过去由 Chrome 本地书签 ID 派生，而 Chrome Sync 同步书签内容却不同步本地 ID，同一条书签在每台设备上得到不同云端标识，两端互相把对方的记录当重复项删除，形成 ping-pong。现改由 `resourceKey + 规范化文件夹路径` 派生（`cloud-state.ts` 的 `bookmarkItemIdFor`），并删除了随之而来的 URL 去重逻辑。首次同步时一次性把旧标识的收藏位置推送删除（`drainLegacyBookmarkBindings`），避免新旧标识并存。

**T-01.5 字段级合并（本轮新增，取代了原计划的 T-00「以本机为准全量上传」）。** 服务端本就按字段时钟裁决冲突，但客户端把所有字段的时钟统一填成记录级 `updatedAt`，使其退化为整条记录 last-write-wins；拉取时又整包替换，本地独有字段被抹成空。现在：
- 新增 `src/lib/field-clocks.ts`，`deriveFieldClocks` 在 `upsertLocalResource` 内自动派生——只有值真正变化的字段才推进时钟，同一毫秒内连写会强制 +1ms 保证单调递增。所有写入路径无需改动即可生效。
- 上传改用真实字段时钟；空值字段本就不进 payload，因此「本机缺失」不会抹掉另一端的内容。
- 拉取与 `mergeLocalResources` 改走 `mergeResourceByFieldClocks`：云端空值不覆盖本地、用户封面（`coverOrigin: "user"`）优先于自动封面、其余字段按字段时钟裁决。本地存在云端没有的字段时记录保持 `pending`，下一轮回传，补齐是双向的。
- 结论：**多端同步不再依赖操作先后顺序**，任意顺序都收敛到并集。原 T-00 因此取消。

**T-02 / T-03 资产标识与 409/422。** `assetId` 过去把内容哈希编进去，换封面即产生新 ID，云端积压孤儿资产；为绕开服务端 409 又加了「换随机 UUID 重传」的补丁，但 complete 仍用旧 ID，这正是持续 422 的直接原因。现在 `assetId` 只代表「某资源的某类图」这一槽位；服务端不再对同槽位换内容报 409，改为把旧对象延迟 1 小时排入回收队列（给上传失败重试留窗口），回收任务只在资产仍指向该对象时才标记删除，避免误伤新图。

**T-04 图片下载链路。** 两个独立缺陷：其一，封面上传从不带 `capturedAt`，云端为 null，而恢复逻辑判断「本地时间 ≥ 云端时间」则跳过，导致任何本地有封面的机器永远不下载云端封面；其二，5 分钟定时同步只调 `syncCloudAssets`（上传）从不调 `restoreCloudAssets`（下载），另一台设备的图片永远到不了本机。现已改为按内容哈希（`coverContentHash` vs 云端 `sha256`）判断，不再依赖时间戳；定时同步双向流动；封面上传带 `capturedAt` 与 `coverOrigin`。

**T-05 测试。** 新增 `src/lib/field-clocks.test.ts`（12 项）与 `src/lib/cross-device-sync.test.ts`（9 项），覆盖标识跨设备一致性、双端互补、收敛性（谁先同步结果一致）、用户封面优先、空设备不抹数据、删除标签不复活。

**数据结构变更：** `ResourceRecord` 新增 `fieldUpdatedAt`、`coverOrigin`、`coverContentHash`；服务端 `resourcePayloadSchema` 与资产 `binding` schema 相应放行。服务端无需 migration。

**AI 重复计费防护（T-01.5 的补丁，必读）。** `aiStatus` 不参与云端同步，而字段级合并以本地记录为基底，导致从云端取回一条已增强的收藏后本机 `aiStatus` 仍停在 `not_requested`，`needsAiEnrichment` 判定为真，对同一个网页重复调用 AI（真实费用）并覆盖对方摘要。`mergeLocalResources` 现在按合并结果重算 `aiStatus`：`hasCompleteAiFields(record) ? "ready" : record.aiStatus`。**不要删这行。** 测试见 `cross-device-sync.test.ts` 的 "stops asking for AI once the cloud has supplied a complete enrichment"。

关于 AI 摘要跨设备冲突的结论：`summary` 是单字段，按字段时钟裁决，**不会出现两份并存**，只保留一份。没有改成「先到先得」，因为服务端是字段级 LWW，客户端做 FWW 会形成「拒绝云端值 → 标记 pending → 用旧时钟重传 → 服务端 LWW 拒绝 → 云端不变」的死循环。正确解法是从源头避免生成第二份，即上面的 `aiStatus` 重算 + 未来的首次同步竞态防护。

**明天在 B 机器上的操作：** 装今天这版即可，登录后正常同步，**不需要讲究与 A 机器的先后顺序**。用户手动设过的封面会被保护，两端各自缺失的内容会互相补齐。

**PRD 状态：** `docs/PRD_REBUILD_2026-08.md` 已清理为纯待办（v1.1），P0 章节整体移除，开头新增「开工前必须了解的现状」六条约束（禁止改回的实现）。可直接交付其他 agent，从 T-06 开始执行。

> **并行说明：** 本轮账号交接包、同步契约和生产发布已完成代码与服务器写入；当前没有新增的独占编辑文件。0.5.34 及此前累积的 UI / AI / icon / 云端改动已作为同一套可构建状态纳入 Git，后续 Agent 不得 reset、回退或删除 `/opt/aarre` 发布目录。完整图片备份、真实卸载重装恢复和正式 Web Store ID 仍是外部验收门，不能写成已完成。云端接管先读 `ops/README.md`。

**当前工作区最新状态：0.5.61。** 同步链路近期收口：0.5.61 服务端 0.1.11 的 PUT 增加 `x-cos-metadata-directive: Replace`（覆盖旧对象强制替换元数据，修复 422 校验失败根因），云端 236 条资产已按用户要求“以本机为准”全部标记删除并排队物理清理、用量归零，客户端对账后由本机全量重传；0.5.60 客户端上传遇 409 自动换新 ID 重试，服务器软删除 181 条 assetId 与内容不匹配的记录；0.5.59 图片封面自动应用到同站现有收藏（不再产生根目录重复书签）；0.5.58 敏感网页保护开关可点击并有明确反馈；0.5.57 编辑保护开关如实显示自动隐私保护（`autoProtected` 锁定）；0.5.56 删除卡片局部移除 + 站点图标强制云端恢复；0.5.55 编辑/删除刷新跳过全量同步 + 封面会话级缓存；0.5.54 删除保持滚动位置、favicon 质量门槛放宽（16px/3:1/0.01，图标版本 7）、Google 账号区块置顶；0.5.53 清理同图多网址快照；0.5.52 AI 格式诊断 + JSON 容错；0.5.51 AI 对话修复；0.5.50 同一网址多条收藏根因修复（确定性 bookmarkItemId + 去重）。服务器当前 0.1.11（release `20260803-metadata-v29`）。当前 `dist/` 为 cloud-enabled 0.5.60 正式构建（带 key）。F14 生产 API、数据库、COS/CAM、Google Web OAuth、DNS/TLS、定时备份、两分钟健康巡检、独立 GlitchTip project 与含 SSH Key 的加密恢复包已经部署；Google 品牌审核、卸载重装恢复和正式 Web Store ID 尚未完成。

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

### 2026-08-03 · 全面审计与重构 PRD（未改动任何代码）

- **背景。** 0.5.49 → 0.5.62 连续 13 个版本全是 bugfix，且相当一部分是在修上一个 bugfix 引入的问题（0.5.50 的去重引入了跨设备互删，0.5.60 的 409 防御引入了 422）。本轮不再打补丁，改为全面审计。
- **产出。** [`docs/AUDIT_2026-08.md`](docs/AUDIT_2026-08.md) 审计报告；[`docs/PRD_REBUILD_2026-08.md`](docs/PRD_REBUILD_2026-08.md) 执行级 PRD（20 个任务，含可直接抄的代码）。七月历史记录压缩迁出到 [`docs/ARCHIVE_PROGRESS_2026-07.md`](docs/ARCHIVE_PROGRESS_2026-07.md)。
- **找到 4 个根因（此前从未定位到）。**
  1. **`cloud-state.ts:348`** — `bookmarkItemId` 由 **Chrome 本地书签 ID** 派生。Chrome Sync 不同步本地 ID，两台设备对同一书签算出两个云端 ID；叠加 0.5.50 的「按网址去重并删除多余」逻辑，导致**两台设备每次同步都在互删对方的记录**，无限循环。这是「同步不出来、同步不上去」的首要原因。修复见 T-01。
  2. **`cloud-assets.ts:179`** — `assetId = stableAssetId(identity + ":" + sha256)`，内容哈希混进了 ID。换封面 = 内容变 = ID 变 → 服务端 409。0.5.60 记录的「181 条 assetId 与内容不匹配」不是历史脏数据，是这个设计每换一次封面就制造一条。修复见 T-02。
  3. **`cloud-assets.ts:200-229`** — 0.5.60 为修 409 加的防御代码本身有 bug：`requestUpload(crypto.randomUUID())` 的新 ID **没有赋值给任何变量**，后续 `complete` 用的还是旧 `const assetId`。服务端去校验一个对不上的对象 → **422**。**0.5.61 和 0.5.62 在服务端反复排查的 422，根因就在客户端这 6 行。** 修复见 T-03。
  4. **`background.ts:9165`** — 5 分钟定时同步只调 `syncCloudAssets()`（上传），**从不调 `restoreCloudAssets()`**（下载）。另一台设备换的封面永远拉不下来，除非重启浏览器或手动同步。另外 cover 上传时不传 `capturedAt`，下载端 `remoteCoverTime` 恒为 0，跳过分支永远命中——即使调用了下载也拉不到。修复见 T-04。
- **其他主要结论。**
  - 客户端从不发送删除墓碑（`cloud.ts:225` 写死 `deleted: false`），拉取时跳过所有 deleted（`cloud.ts:291`），跨设备删除完全不生效。
  - 图标/封面分散成 5 套主键不同的状态（host / canonicalUrl / resourceKey），且没有 `origin: "user"` 标记，用户手动设的封面随时可能被自动逻辑覆盖。
  - `icon-processor.ts:82-125` 的离屏解码路径仍是旧门槛（128px / 1.2 / 0.15），与 0.5.54 放宽后的主路径（16px / 3:1 / 0.01）不一致，ICO favicon 被误拒后直接掉兜底。
  - 侧边栏首屏加载 773 KB JS + 133 KB CSS（CSS 里含 2306 行网页端样式），首屏还有一个 `onboardingVisible === null` 门禁，SW 每次唤醒在模块顶层做快照全表扫描。
  - Agent 是四步固定管道，**没有使用任何一家的 function calling / tools API**，只用了 `response_format: json_object`。「格式不对失败」的根因是没用 strict schema，而不是模型能力。三轮 JSON 容错补丁（0.5.51/0.5.52）方向是错的。
  - `background.ts` 9184 行、`SidePanelApp.tsx` 5479 行，已超出可维护范围；本轮发现的多个 bug 本质上是「改的人看不到全貌」。
  - 现有 343 项测试全是单机单进程，而所有严重故障都是双设备场景。PRD 的 T-05 要求补双设备一致性测试。
- **需要用户决策的 4 项。** 是否接入 Google S2/DuckDuckGo favicon 兜底（隐私 trade-off）；同步范围默认值是否改成「完整备份」；`bookmarkItemId` 迁移用「清空重建」还是「原地转换」；是否接受两个巨型文件的大拆分。详见审计报告第 9 节。
- **状态。** 本轮**未改动任何源码**，只新增/整理文档。代码修复从 T-01 开始。

### 2026-08-03 · 0.5.62 / 同步 422 竞态根因修复（服务端 0.1.12）

- **现象。** 0.1.11 后重传仍报 422；实测 7 条卡住上传的对象元数据（sha/size/SSE）全部正确，排除元数据问题。
- **根因。** 云端清空后删除 worker 与客户端重传竞态：客户端 PUT 覆盖对象后，仍在队列里的旧删除任务把刚上传的对象物理删除，complete 的 head 校验（404/0 字节）失败；且 `createUpload` 的 ON CONFLICT 只更新 state、保留旧内容字段，deleted 记录复活时字段可能与新对象不一致。
- **修复（0.1.12，release `20260803-upload-race-v30`）。** ① 上传登记时取消该 object_key 仍在排队的删除任务（新上传优先于旧删除）；② ON CONFLICT 改为全字段更新（resource_key/object_key/sha256/byte_size/mime 等与本次请求一致）。旧对象删除队列已清空（待处理 0），竞态窗口关闭。
- **验证。** 服务端 22/22 测试通过；生产健康；待用户重载后重试同步验收。

### 2026-08-03 · 0.5.61 / 同步 422 校验失败的根因修复 + 云端资产以本机为准重建

- **现象。** 清理 181 条 assetId 不匹配记录后，同步仍报 `Uploaded asset failed size, digest, or server-side encryption verification.`（422，3 小时内多次）。
- **根因。** 图片恢复时直接写入的 COS 对象缺少 `x-cos-meta-sha256` 元数据；客户端重传覆盖对象时腾讯 COS 默认保留旧元数据，服务端 `completeUpload` 的 head 校验（大小/哈希/加密）读不到哈希 → 422。
- **修复。** ① 服务端 0.1.11：`signUpload` 的 PUT 头增加 `x-cos-metadata-directive: Replace`，覆盖旧对象时强制替换元数据（22/22 测试通过，release `20260803-metadata-v29` 已上线）；② 按用户要求“以本机为准”：云端全部资产（236 条 ready）标记删除并排队物理清理，用量归零，客户端对账后由本机全量重新上传（新对象带正确元数据 + Replace 头），校验通过。
- **验证。** typecheck 与 343 项测试通过；服务端 22/22；生产健康，最近 3 分钟 422 归零。用户重载后触发同步，等待本机全量重传完成验收。

### 2026-08-03 · 0.5.60 / 同步 409 “asset identifier already bound to different content” 修复

- **现象。** 用户同步持续报 `The asset identifier is already bound to different content.`（3 小时 21 次 409）。
- **根因。** 之前图片恢复时保留了旧 `asset_id` 却更新了 `sha256`/`object_key`（内容变了、ID 没变），全库审计确认 417 条 ready 资产中 **181 条 assetId 与内容不匹配**；客户端本地仍持有旧内容，上传时计算出的 assetId 命中这些记录且 object_key 不同 → 服务端 409，同步卡死。
- **修复。** ① 客户端 `uploadAsset` 遇到 409 时改用随机 UUID 重新上传（防御，不再阻塞同步）；② 服务器把这 181 条“assetId 与内容不匹配”的记录软删除（可回滚），用量已重算（ready 236 / 20.6 MB），下次同步本地内容以匹配的 assetId 重新落库。
- **验证。** typecheck 与 343 项测试通过；cloud-enabled 0.5.60 构建（带 key）通过；生产健康检查正常。

### 2026-08-03 · 0.5.59 / 图片封面应用到同站现有收藏，不再产生根目录重复书签

- 右键图片设封面时，当前页面 URL 与已收藏 URL 不一致（登录页/参数变体）会被误判“未收藏”并自动收藏到书签栏根目录（实测产生 `Moises Studio` 重复书签，原收藏仍在文件夹）。修复：自动收藏前先查找同主机现有书签，有则把封面直接应用到现有收藏（提示“已应用到该网站现有收藏”），无任何同站收藏才自动收藏。

### 2026-08-03 · 0.5.58 / 敏感网页保护开关可点击并有明确反馈

- 自动隐私保护（银行/支付/医疗）的网页，保护开关显示开启且不再灰掉禁用；点击后提示“此网页属于敏感分类，保护由安全策略自动生效，无法关闭”。

### 2026-08-03 · 0.5.57 / 受保护网页在编辑中开关未开启的修复

- **现象与根因。** 用户有银行/支付/医疗等敏感网址的收藏（自动隐私保护），但编辑界面的“受保护”开关显示关闭——开关此前只计算用户显式/继承保护（`bookmarkProtectionState`），自动隐私规则（`isSnapshotSensitiveUrl` 的 excludedHosts）没有计入，不是写死。
- **修复。** `ItemProtectionState` 新增 `autoProtected`；`getItemProtectionState` 对网页目标叠加自动隐私判定（命中敏感分类则 `protected: true, autoProtected: true`）；`ProtectionControl` 在自动保护时开关显示开启并锁定（不可关闭），描述文案说明“银行、支付、医疗等敏感分类始终受保护”。用户显式保护与文件夹继承的显示/操作不变。
- **验证。** typecheck 与 343 项测试通过；cloud-enabled 0.5.57 构建（带 key）通过。真机展示待用户重载确认。

### 2026-08-03 · 0.5.56 / 删除二次重排与图标未恢复的最终修复

- **删除仍两次重排。** 0.5.55 去掉全量同步后，剩余第二次重排来自 `refresh` 的 `loadResources`（重新导入书签树导致资源 updatedAt/排序变化）。修复：删除最后一个收藏位置时，`LibraryCardEditor` 通过 `onChanged` 上报 `{ resourceKey, kind: "removed" }`，`ManagerApp` 直接从当前 `libraryResults` 过滤掉该卡片，**完全不触发刷新**——一次变化（卡片消失），其余卡片不动。编辑/位置删除等场景仍走本地静默刷新。
- **图标仍未恢复。** 0.5.55 的云端恢复仍被“state 哈希相同”跳过（本地字节被版本升级清空，但云端记录哈希一致）。修复：`restoreCloudAssets` 对 site-icon 单独判断——**本地品牌记录没有当前渲染版本的图标字节时强制下载**，不再受 state 哈希跳过影响；本地已有当前版本图标才跳过。同步（登录/定时/手动）触发后图标即从云端拉回。
- **验证。** typecheck 与 343 项测试通过（编辑/删除 onChanged 断言更新）；cloud-enabled 0.5.56 构建（带 key）通过。

### 2026-08-03 · 0.5.55 / 删除卡片多次变化与站点标识全兜底的回退修复

- **删除后多次变化。** 根因：① 编辑/删除后 `refresh` 触发全量云同步（SYNC_NOW），完成后再次重拉资源与派生数据，造成第二次/第三次变化；② 卡片重挂后封面组件重新异步拉快照，先显示兜底再变回封面。修复：`handleLibraryResourceChanged` 刷新时跳过全量同步（删除等变更由后台定时同步推送云端）；`LibraryCardCover` 增加会话级快照缓存（模块级 Map），重挂直接用上次封面初始化，不再闪烁。
- **站点标识全变兜底。** 0.5.54 把 `SITE_ICON_RENDER_VERSION` 6→7 时，`invalidateStaleSiteBrandIcons` 会清空所有旧版本图标的渲染字节，而重新抓取是后台渐进任务，期间全部显示兜底。修复：已接受图标**保留字节只升级版本号**（新规则只影响没有图标的 reject 记录）；`restoreCloudAssets` 的 site-icon 分支不再要求云端 binding 版本等于当前渲染版本（字节有效即可恢复），保证被清空的图标能立即从云端拉回。
- **验证。** typecheck 与 343 项测试通过（storage 测试语义更新为“保留字节升级版本”）；cloud-enabled 0.5.55 构建（带 key）通过。

### 2026-08-03 · 0.5.54 / 三个 UI 细节调整

- **删除后保持瀑布流位置。** `LibraryCardEditor` 删除/更新后聚焦搜索框时加 `preventScroll`，不再把滚动位置拉回顶部；被删卡片消失、其余卡片保持原位。
- **站点标识质量门槛放宽。** `renderSiteIcon` 的闸门从 128px 下限 / 1.2 比例 / 0.15 墨迹放宽到 16px / 3:1 / 0.01 墨迹：低质真实 favicon 允许进入（侧边栏书签列表与网页端卡片下方的标识），只有完全抓不到候选或全白/全透明图才用 40 张内置兜底。`SITE_ICON_RENDER_VERSION` 6 → 7，让此前被旧门槛拒绝的站点按新规则重新生成（后台分批，不影响 UI）。
- **账号区块置顶。** “Google 账号”从“更多”页移到设置页最上方（AI 服务之前），登录/同步操作更直接。
- **验证。** typecheck 与 343 项测试通过（含新门槛与版本号相关断言更新）；cloud-enabled 0.5.54 构建（带 key）通过。

### 2026-08-03 · 0.5.53 / 清理“同一截图绑定多个网址”的重复快照

- 网页端多张卡片共用同一封面：云端 6 组（29 条）快照资产同一图片哈希绑定多个 URL（凌晨批量上传时本地就把同一截图写进多个网址的快照）。服务器已标记删除这 29 条（软删除可回滚），坏组归零；客户端新增 `duplicateSnapshotGroups`，启动时自动清理本地同图多条快照（对应资源回兜底图，访问时重新截图）。

### 2026-08-03 · 0.5.52 / AI 对话格式失败诊断与更宽 JSON 容错

- 0.5.51 后仍报“AI 返回的内容格式不正确”：在 `generateAgentJson` 失败时把模型原始输出写入 `aarre:ai-format-error`（本地存储，供后续定位）；`parseJsonObject` 容错扩展到字符串外行/块注释、尾部逗号；思考与回答提示词明确要求 JSON 内换行转义。341 项测试通过。

### 2026-08-03 · 0.5.51 / AI 对话 Markdown 渲染接续：格式解析容错与思考提速

- **接手背景。** 另一个 agent 的“AI 对话 Markdown 渲染 + 真实思考路径”已提交（7052ae3），但用户重载后回答失败（“AI 返回的内容格式不正确，请重试。”）且速度明显变慢；失败导致没有回答内容，Markdown 新样式自然看不到。
- **根因。** 新提示词要求模型输出 Markdown 格式的 `answer` 字符串；模型常在 JSON 字符串内输出**真实换行（未转义）**或代码围栏，`JSON.parse` 失败；回答生成重试 2 次后整体失败。思考阶段也走同一重试路径（最多 2 次），叠加后更慢。
- **修复。** ① `parseJsonObject` 增加字符串值内字面换行/制表符/CRLF 的修复（状态机只改字符串内，不动 JSON 结构），并导出供单测；② 思考与回答提示词明确要求“字符串内换行写成 \\n、禁止代码围栏包裹 JSON”；③ 思考阶段 `generateAgentJson` 只尝试 1 次，失败立即降级为直接回答（注释语义本就如此），回答阶段保持 2 次重试；④ 补齐 4 项解析容错单测；⑤ 顺带把另一个 agent 的 manager 封面 1:1 改动对应的布局测试断言同步（4/3 → 1/1），其未提交的 `manager.css` 本身不代提交。
- **验证。** typecheck 与 341 项测试全部通过；cloud-enabled 0.5.51 构建（带 key）通过。真实模型回答效果待用户重载后实测（本地无 BYOK key，无法离线真实验证）。

### 2026-08-03 · AI 对话 Markdown 渲染 + 真实思考路径

- **Markdown 补齐。** agent 提示词新增回答输出规范：允许小标题、加粗、有序/无序列表、引用和行内代码，明确禁止表格（侧边栏窄）、图片和长链接直贴。侧边栏引入 `react-markdown` + `remark-gfm` 真实渲染 AI 回答（链接新标签打开、代码块可横向滚动），不再把模型输出当纯文本显示。
- **思考过程不再「套路化」。** 在「筛选相关内容」和「整理并生成回答」之间新增真实思考环节：模型先基于实际候选输出 3~8 条思考路径（JSON `{steps}`，每条 ≤120 字），通过 `BOOKMARK_AGENT_THINKING` 实时推给侧边栏展示；最终回答提示词强制按该路径展开，不能跳步或新增未思考的步骤。完成后回答上方有可展开的「思考过程」卡片，步骤与回答一一对应。
- **降级与边界。** 思考调用格式重试后仍失败时降级为直接回答（提示词明确告知模型），不阻塞对话；用户取消时立即中止。每轮对话多一次思考调用（输出上限 1,024 tokens），两次调用都计入 agent 配额。
- **验证。** Node 22 下 `npm run check` 全通过（60 个测试文件 / 337 项测试、类型检查、设计 token、生产构建）。Playwright 用 mock Provider 在真实预览页走完整流程：思考中界面显示真实步骤且「整理并生成回答」进行中；完成后标题/加粗/列表/引用/行内代码均真实渲染，「思考过程」可展开且与回答一致；控制台无错误。
- **未完成。** 真人安装态复测与真实模型输出质量抽样仍需用户验收。

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

### 2026-07-29 ~ 2026-07-31 · 历史记录（已压缩）

完整原文见 [docs/ARCHIVE_PROGRESS_2026-07.md](docs/ARCHIVE_PROGRESS_2026-07.md)。57 条记录按主题归纳如下：

- **工程与基线（07-29）。** React + TypeScript + Vite + MV3 工程建立；Git 基线 `cf619df`；固定 Node 22；交付物生成与版本校验脚本；0.2.3 可靠性加固（离线队列保留全部待同步项、指数退避、revision 校验、先推后拉、删除二次确认、弹窗焦点约束）。
- **PRD 与产品评审（07-29 ~ 07-30）。** PRD 从初版迭代到 v1.3，22 个需求分四个里程碑；确认与 NexVoice 同栈；检索去 embedding 化改本地；云端从 Supabase 改自建服务器；F22 悬浮层收敛为「只有一张页面快照」。
- **封面素材体系（07-29 ~ 07-30）。** 分类封面从 v1 → v2 极简版 → 10 类中评 → 40 类基准集定稿并打包进扩展；教育与科学改为「科学优先」；按红框重绘 7 类。
- **REMEDIATION 七批整改（07-30）。** 第 1 批兑现已有能力、第 2 批整理提案主动触达、第 3 批撤销/快照/调度一致性、第 4 批封面测量与双主题站点标识、第 5 批拼音按需加载与搜索防抖、第 6 批三条高风险链路集成测试、第 7 批墨迹闸门范围修复。兜底率 58% → 51%。**结论：128px / 1.2 宽高比 / 0.15 墨迹三条阈值路线已被实测证伪，不要重复尝试。**
- **UI/视觉重构（07-30）。** `docs/UI_REDESIGN.md` 批次 A–H 完成：统一 Token、明暗主题、两档密度、基础组件；网页端六 tab 拆成独立视图；收藏库改内容型瀑布流；主题图谱升级为三维力导向 Canvas；设计防回归脚本接入 `npm run check`。
- **截图与封面链路（07-30 ~ 07-31）。** 0.3.9 真实网页截图封面；0.4.0 Chrome 原生收藏完整增强层与右键状态机；0.4.1 三条截图路径复测失败后改统一增强协调器；0.4.3 收藏卡片编辑 + 40 张兜底；0.4.4 瀑布流稳定与头部整合；0.4.5 批量补拍改 `chrome.debugger` 后台化；0.4.6 修复「内容未加载完成就截图」。7 天截图新鲜度规则确立。
- **控件与形状系统（07-31）。** Fluid 控件系统化归一；修复宽控件被拉成透镜形；稳定卡片 Hover 与统一封面比例；独立列 Hover、封面居中与编辑弹窗层级。
- **0.3.8 收口。** 隐藏 Chrome 系统根目录，路径统一从用户自建目录开始；整理提案信息精简为「来源文件夹 / 网页名 → 目标文件夹」。

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

### 当前主线：按 `docs/PRD_REBUILD_2026-08.md` 执行 T-01 → T-20

**不要再在旧架构上打补丁。** 顺序不能乱，任务之间有依赖。

| 阶段 | 任务 | 内容 | 谁来做 |
|---|---|---|---|
| P0 | T-01 ~ T-05 | 修 4 个根因 bug + 补双设备测试 | T-01/T-05 需高能力模型，其余可交接 |
| P1 | T-06 ~ T-07 | 拆分 `background.ts`（9184 行）和 `SidePanelApp.tsx`（5479 行） | 需高能力模型 |
| P2 | T-08 ~ T-10 | 同步引擎重写 + 删除墓碑 + 新的同步 UI | T-08 需高能力模型 |
| P3 | T-11 ~ T-14 | 视觉资产统一（`visuals` store / Blob / origin 标记）+ 降低图标兜底率 | T-11 需高能力模型 |
| P4 | T-15 ~ T-17 | Agent 改为 tool-calling + 计划执行 + 流式 | T-15 需高能力模型 |
| P5 | T-18 ~ T-20 | UI 极简化 + 样式系统收敛 | T-19 需高能力模型 |
| X | X-01 ~ X-07 | 启动性能，可穿插执行 | X-07 需高能力模型 |

**P0 是最紧急的**：用户当前每天都在受这 4 个 bug 影响，且改动量很小（合计不到 200 行）。

### 阻塞项：等用户决策

见审计报告第 9 节的 4 个问题。其中 **`bookmarkItemId` 的迁移方式（T-01）会影响云端数据**，必须先拿到答复再动手。

### 历史遗留：真人安装态验收与商业化规模验证

以下与本轮重构并行，不冲突：

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

**本轮审计发现的根因缺陷（全部未修，见 `docs/PRD_REBUILD_2026-08.md`）**

| 严重度 | 问题 | 位置 | 任务 |
|---|---|---|---|
| P0 | `bookmarkItemId` 由 Chrome 本地 ID 派生，两台设备互删对方记录 | `cloud-state.ts:348` | T-01 |
| P0 | `assetId` 混入内容哈希，换封面必然 409 | `cloud-assets.ts:179` | T-02 |
| P0 | 409 重试后 `complete` 用旧 assetId，导致 422（0.5.61/0.5.62 一直在找的根因） | `cloud-assets.ts:200-229` | T-03 |
| P0 | 定时同步只上传图片不下载；cover 上传缺 `capturedAt` 使下载分支永远跳过 | `background.ts:9165`、`cloud-assets.ts:267` | T-04 |
| P1 | 客户端从不发删除墓碑，拉取时跳过所有 deleted | `cloud.ts:225`、`cloud.ts:291` | T-09 |
| P1 | 用户手动设置的封面无 `origin` 保护，随时被自动逻辑覆盖 | 全局 | T-12 |
| P1 | 离屏图标解码仍用旧质量门槛（128px/1.2/0.15），与主路径不一致 | `icon-processor.ts:82-125` | T-14a |
| P1 | Agent 未使用任何 function calling API，靠正则修补 JSON | `local-ai.ts:477-492` | T-15 |
| P2 | 侧边栏首屏 773 KB JS + 133 KB CSS（含网页端样式）；SW 顶层做快照全表扫描 | 多处 | X-01 ~ X-06 |
| P2 | `background.ts` 9184 行、`SidePanelApp.tsx` 5479 行，超出可维护范围 | — | T-06、T-07 |
| P2 | 343 项测试全是单机场景，无法覆盖双设备故障 | `tests/` | T-05 |

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

**当前无人占用。** 本轮 AI 对话改动已收口；若继续改 UI，优先独占下表，做完再清。

| 文件 | 占用者 | 需求 |
| --- | --- | --- |
| （空） | — | 上一轮 AI 对话涉及 `background.ts` / `SidePanelApp.tsx` / `local-ai.ts` / `preview.ts` / `conversations.ts` / `types.ts` / `sidepanel.css`，有冲突先读「2026-08-03 · AI 对话」 |

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
