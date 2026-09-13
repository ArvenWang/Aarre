# Aarre / NexAlign 共享 PC 入口（协议 v1）

两个扩展均升级后，在两边都允许显示快捷入口的普通 HTTP(S) 页面合并为一个右侧手柄。手柄从上到下只显示 Aarre 与 NexAlign 的正式产品图标；悬停或键盘聚焦 Aarre 后，左侧出现添加当前网页到收藏的星标；菜单顶部不增加应用切换栏；先收起当前菜单，再从手柄打开另一个应用，同一页面只展开一个应用。原有手机模拟/Chrome 原生手机侧栏保留。

## 外观与状态

- 共享手柄为 52 × 100px，两个产品按钮保持 44 × 44px，外层圆角 16px、按钮圆角 12px，保留 4px 间距；产品图标 36px / R8，距离外框 8px，三层圆角保持同心。独立 Aarre 为 52 × 52px；未安装的产品不会显示。
- Aarre 的星标在左侧 52 × 52px 的二级操作中显示，提供鼠标间隙缓冲、键盘聚焦/左右方向键与 Esc 关闭。产品图标直接点击仍然打开菜单。星标沿用原收藏流程：打开当前网页的收藏表单，取消不保存；已收藏时显示实心星标，点击管理已有收藏。产品图形来自 Aarre 的 `public/icons/icon.svg` 和 NexAlign 的 `src/assets/nexalign-icon-{light,dark}.svg`，原样内嵌在共享文件中，保留原色，不依赖网络图片或新增网页资源权限。
- 两个主菜单共用 `src/shared/suite-dock/geometry.ts`，高度为当前可用视口减去上下各 12px，窗口变化时同时遵循同一规则；收藏表单继续按内容独立计算。
- 两边宿主直接调用相同的 `src/shared/suite-dock/morph.ts`，底板展开 280ms、收起 210ms；内容平移并淡入 140ms（延后 100ms），平移并淡出 120ms。文字和 iframe 保持真实尺寸。反向操作从当前显示状态继续，重复就绪/状态消息不重启动画，过渡中视口或表单变高不会延长原截止时间；系统“减少动态效果”下立即切换。
- 共用入口使用相同中性色；界面明暗采用最后一次明确设置。NexAlign 的“跟随系统”在两边分别按同一系统设置解析；网页本身的明暗控制仍是独立功能。
- 历史版本没有记录设置时间。首次连接只做确定性迁移（同为旧记录时采用 NexAlign 的现有偏好），不会伪造历史时间；升级后在任意一边设置一次主题即可建立最新偏好。
- 共享主题记录只保存在本机，不新增云端实体。Aarre 既有主题字段仍按其现有设置同步规则处理；页面启动/旧值恢复不会被算作一次新的手动设置。

## 切换与恢复

Chrome 会限制扩展调试含有另一扩展 iframe 的页面。因此切换时需要先保存当前 UI 状态，释放其 iframe，再打开另一个扩展。仅隐藏 iframe 不够。

- NexAlign 在交接完成前暂停检查、清除覆盖层、释放调试连接；Figma 状态和菜单标签保存后可重新建立安全握手。
- Aarre 保留输入草稿、收藏表单、当前视图、收藏树展开和滚动位置。业务状态留在 Aarre 自己的存储里。
- 保存失败、仍在执行的操作以及尚未保存的 AI 设置会阻止释放页面，并显示原因；不会为了切换而丢弃它们。
- 连接按 Chrome 提供的 tabId / documentId 匹配。断连、卸载或重新加载后恢复单插件入口；重新握手成功才再次合并。快速切换按最新意图排序，已开始的清理必须先完成。
- 对方的 Port 对象并不等于对方仍然运行。协调端每两秒确认一次外部客户端存活；连续一次未回应即移除过期成员，覆盖 Chrome 在加载中页面上未及时通知卸载的情况。

## 身份与分发边界

Aarre 固定身份：`ppjmhonejgpcdmjmcbbdjookgiagambm`。

允许连接的 NexAlign 身份：
- 商店条目：`aaepppdlfiikfmomfllpghojedjkmopf`
- 当前本机开发安装：`obnemfdgnkklhbdngemomokiklpaenmj`

保留现有插件 ID 与用户数据，没有新增浏览器权限。Aarre 使用 externally_connectable 的明确扩展 ID 列表，不开放网页 matches；消息只包含可用状态、应用开关与四字段主题记录，业务数据与密钥不会传给另一扩展。

**其他机器的未打包 NexAlign 安装可能产生不同 ID。** 对外统一分发前，应从现有商店条目取得公钥并固定开发身份，再发布对应允许列表。不要随意生成新 key 改掉已安装扩展的 ID；本轮支持已知商店身份和本机开发身份，不能据此宣称任意路径的未打包副本都能自动配对。

两个仓库分别携带相同的 `src/shared/suite-dock/`，可独立构建，不依赖另一个项目在磁盘上。协议修改必须同步两份源码并执行双扩展验收。

## 验证入口

- NexAlign：`npm run check`、`npm run build:release`；已有 floating-menu / source-pause / mobile 检查。
- Aarre：类型、设计边界、Vitest、`npm run build`；新增 suite-dock 与 suite-parking 契约。
- 双插件：在 NexAlign 仓库运行 `node scripts/verify-shared-dock.mjs`。可用 `SUITE_ARTIFACT_DIR` 指定证据目录。使用单独的 Chrome 测试配置与两个真实 dist，覆盖两个产品入口与悬停收藏、无顶部切换栏、两个主菜单等高及短窗口适配、独立收藏高度、真实收藏及取消、主题、草稿、调试连接、开合关键帧一致和断连恢复，不修改日常使用的 Chrome。
- 产品把手定向验证：Aarre 仓库运行 `SUITE_VERIFY_PRODUCT_HANDLE=1 node scripts/verify-floating-save-transition.mjs`，覆盖真实产品图形、明暗状态、悬停路径、键盘、真实收藏与独立安装回退。
- 安装态仍须在用户 Chrome 重新加载两只扩展后验收。构建或隔离浏览器通过不等于已安装版本已更新。

依据：[Chrome 跨扩展通信](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#cross-extension-messaging)、[连接身份限制](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)。
