# Bookmark Layer

Bookmark Layer 是一个 Chrome 原生书签增强层。它把标题、URL 和文件夹写入真实的 Chrome 书签，同时将网页正文理解、摘要、标签、语义索引等扩展信息同步到用户自己的产品账户。

当前名称是开发期工作名，正式品牌尚未确定。

## 已实现的关键闭环

- 侧边栏默认直接展示当前 Chrome 配置文件的原生书签栏及完整文件夹树。
- 同时覆盖账号书签栏、本机书签栏、其他书签和移动设备书签，避免遗漏 Chrome 星标保存到非默认目录的内容。
- 新增、改名、移动、拖放和删除操作直接写入 `chrome.bookmarks`，界面监听原生变更并实时刷新。
- 网页右键“添加当前页面到收藏…”和链接右键“添加此链接到收藏…”会自动打开侧边栏，并预填目标地址、名称和选中文字；用户确认文件夹、备注和 AI 选项后再写入真实原生书签。
- 顶部统一输入框可搜索书签、浏览历史和已打开标签页，也可输入网址直达或调用 Chrome 当前默认搜索引擎。
- 使用 Chrome 侧边栏按需分析和收藏当前页面。
- 提取正文、描述、作者、站点、Canonical URL、图片和用户选中文字。
- 用户可编辑收藏名称、收藏原因和原生 Chrome 文件夹。
- 保存时创建或更新真实 Chrome 原生书签。
- 监听原生书签的新增、改名、移动和删除。
- 离线保存与持久补同步队列；元数据更新不会覆盖待同步正文。
- 同步失败按指数退避重试，不会让失败任务阻塞后续收藏。
- 使用 Google OAuth 登录，并校验产品账号与当前 Chrome 配置文件账号一致。
- 通过 Supabase Auth、Postgres RLS 和云端函数同步每个用户的智能信息。
- 使用 Gemini 生成中文摘要、标签、主题、关键点和适用场景。
- 使用 Gemini Embedding 与 pgvector 完成语义搜索。
- 现有 Chrome 书签自动进入本地智能索引，无需手动导入；不会因此在后台批量打开网页或读取正文。
- 原生书签始终以 Chrome 为唯一事实来源，智能层不会用云端副本覆盖 Chrome 的标题、URL 或文件夹结构。

## 数据边界

| 数据 | 真实来源 | 同步方式 |
| --- | --- | --- |
| 标题、URL、文件夹 | Chrome 原生书签 | Chrome Sync |
| 收藏原因、摘要、标签、正文索引 | Bookmark Layer | Supabase |
| AI 模型密钥 | Supabase Edge Function Secret | 不进入扩展 |
| 未同步内容 | 当前 Chrome 配置文件本地 | 登录或恢复网络后补同步 |

统一输入框只在用户输入时查询 Chrome History API 生成本机联想，不会把完整浏览历史写入产品数据库。网页正文只在用户主动收藏时读取，且只有勾选 AI 处理时才进入云端处理队列。

## 本地开发

要求 Node.js 22 或更高版本。

```bash
nvm use
npm ci
npm run check
```

生产构建输出在 `dist/`。在 `chrome://extensions` 打开开发者模式，选择“加载已解压的扩展程序”，然后选择 `dist/`。

## 配置 Supabase 与 Google 登录

### 1. 创建 Supabase 项目

运行迁移：

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 2. 配置 Google OAuth

在 Google Auth Platform 创建 Web application 类型的 OAuth 客户端：

1. 将 Supabase 提供的 Google Callback URL 加入 Google 的 Authorized redirect URIs。
2. 在 Supabase Auth 中启用 Google Provider。
3. 将扩展的回调地址加入 Supabase Redirect URLs：

```text
https://EXTENSION_ID.chromiumapp.org/auth
```

扩展实际回调地址会显示在收藏管理页的“云端尚未连接”区域。正式发布时应使用 Chrome Web Store 分配的固定 Extension ID，并完成 Google 品牌验证。

### 3. 配置扩展构建环境

复制 `.env.example` 为 `.env.local`，填写：

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

构建脚本只会把实际 Supabase 项目域名加入扩展权限，不会申请 `*.supabase.co` 或 `<all_urls>`。

### 4. 配置和部署 AI 云端函数

```bash
supabase secrets set GEMINI_API_KEY=YOUR_SERVER_SIDE_KEY
supabase secrets set GEMINI_SUMMARY_MODEL=gemini-2.5-flash-lite
supabase functions deploy enrich-bookmark
supabase functions deploy search-bookmarks
```

模型密钥必须只保存在 Supabase Secret 中，禁止写入 `.env.local` 或扩展包。

## 验证

```bash
npm run typecheck
npm run test
npm run build
```

当前自动化覆盖 URL 规范化、跟踪参数清理、本地检索排序、IndexedDB 缓存与队列、正文提取和敏感表单排除。Google OAuth、Chrome Sync、Supabase 和 Gemini 的端到端验证需要真实项目凭据和解压安装后的 Chrome 扩展。

生成交付物前必须先提交全部源码，并运行：

```bash
npm run package:artifacts
```

脚本会拒绝覆盖已有版本，并校验 `package.json`、Manifest、ZIP 与解压目录的版本一致性。已有交付物可用 `npm run verify:artifacts` 复核。

## 已知边界

- 扩展不能修改 Chrome 原生书签栏或原生星标弹窗。
- 扩展不能接管 Chrome 地址栏内部实现；当前覆盖书签、历史记录、已打开标签页、网址直达和默认搜索引擎，无法复制 Chrome 未公开的计算器、站点搜索快捷词等内部能力。
- 扩展不能替用户开启 Chrome Sync；它会优先显示 Chrome 标记为账号同步的书签栏，实际同步开关仍由 Chrome 设置控制。
- Chrome 内部页、Chrome Web Store 等受保护页面不能读取正文。
- 旧书签会自动出现在侧边栏和关键词索引中；需要再次访问并主动收藏，才能获得正文级 AI 理解。
- Chrome 移动端不能运行扩展；原生书签仍可由 Chrome Sync 到手机，智能管理端后续需要 Web/PWA。
- 当前删除原生书签只移除本机绑定，云端记录保留，以避免同步延迟导致误删；正式删除与回收站策略仍需补充。

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
