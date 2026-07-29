# Bookmark Layer 项目进展

最后更新：2026-07-29

## 当前进展

Chrome 原生书签增强产品已完成 0.2.2 右键收藏交互修复。侧边栏读取 Chrome 的全部原生书签根目录；右键菜单会携带页面或链接上下文自动打开侧边栏编辑表单，用户确认后再创建真实书签。Google OAuth、Supabase 和 Gemini 代码已实现，但真实服务尚无项目凭据，不能宣称上线完成。

开发期工作名：`Bookmark Layer`。正式品牌尚未确定。

当前统一项目目录：`/Users/nefish/Desktop/Coding/Bookmark-Layer`。

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
- 模型密钥只在服务端 Secret 中读取。
- 构建时只申请实际 Supabase 项目域名，不使用 `<all_urls>` 或 Supabase 通配域名。
- 增加项目说明、架构文档和云端配置说明。
- 已生成可直接用于 Chrome“加载已解压的扩展程序”的 `outputs/Bookmark-Layer-0.2.2-unpacked/`。
- 已生成扩展 ZIP 和完整源码 ZIP 交付包。

## 下一步计划

1. 获得用户授权后创建正式 Supabase 项目并应用数据库迁移。
2. 创建 Google Auth Platform Web OAuth Client，启用 Supabase Google Provider。
3. 将实际扩展回调 URL 加入 Supabase Redirect URLs。
4. 配置 Gemini 服务端密钥并部署两个 Edge Function。
5. 在 Chrome 扩展管理页重新加载 0.2.2，并验证右键拉起编辑表单、Chrome 星标和完整书签根目录。
6. 进行真实端到端验证：
   - Google 账号匹配和错账号拦截。
   - 书签树实时读取、网址打开、默认搜索、历史与标签页联想。
   - 新建、改名、拖放移动、删除和保存后原生书签落盘。
   - Chrome Sync 跨设备出现。
   - 摘要、标签和语义搜索结果。
   - 离线保存、恢复网络后补同步。
   - 云端恢复缺失原生书签。
7. 设计删除传播、回收站和冲突解决策略。
8. 根据真实体验决定是否替换 `chrome://bookmarks`。

## 遇到的问题

- Chrome 原生书签只能保存标题、URL 和文件夹，不能承载摘要和标签。
- Chrome 扩展同步空间不足以存放正文和 AI 索引。
- Google OAuth 和生产扩展 ID 必须由真实 Google Cloud、Supabase 和 Chrome Web Store 配置共同完成。
- Chrome 扩展不能复制地址栏未公开的计算器、站点搜索快捷词等内部逻辑。

## 已解决问题

- 使用 Chrome Sync 与 Supabase 双层同步模型。
- 使用 Google 账号和 Chrome 配置文件邮箱一致性检查避免账号串库。
- 使用 Supabase RLS 隔离每个用户的数据。
- 使用本地队列保证云端失败时原生书签仍能成功保存。
- 使用规范化 URL 资源键解决跨设备 Chrome bookmark ID 不可靠问题。
- Chrome 作为基础字段的唯一事实来源；智能索引自动关联，不再要求用户导入。
- 地址栏联想查询只在本机、只在用户输入时发生，不把完整历史记录上传云端。

## 未解决问题

- 尚无 Supabase、Google OAuth 和 Gemini 的真实项目凭据。
- 已完成 0.1.0 真实 Chrome 解压安装；0.2.2 重载和交互验收待进行。
- 删除原生书签目前不会立即永久删除云端资源，需要回收站产品规则。
- 同一个 Canonical URL 的多位置、多备注模型目前合并为一个资源。
- Chrome 移动端没有扩展运行环境，后续需要 Web/PWA 管理端。
- 正式品牌名、图标和商店素材尚未确定。

## 验证情况

- `npm run typecheck`：通过。
- `npm run test`：6 个测试文件、17 个测试通过。
- `npm run build`：通过，已生成 `dist/`。
- 两个 Supabase Edge Function 已完成独立 TypeScript 打包解析检查。
- 生产构建已检查，不包含源码映射、测试数据或项目密钥。
- npm 依赖审计：0 个已知漏洞。
- 尚未声称 Google OAuth、Supabase、Gemini、Chrome Sync 已完成真人端到端验证。

## 暂不应并行修改

在真实云端联调完成前，其他 Agent 不应同时修改以下核心协议文件：

- `src/lib/auth.ts`
- `src/lib/cloud.ts`
- `src/extension/background.ts`
- `supabase/migrations/202607290001_initial.sql`
- `supabase/functions/`
