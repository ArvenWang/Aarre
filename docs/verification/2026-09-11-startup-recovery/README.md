# 0.6.3 · 实际 Chrome 菜单启动恢复

2026-09-11。用户报告悬浮菜单长时间停留在“正在打开收藏”。本次直接在用户已经安装的 Chrome 扩展上复现与验收，没有用开发预览替代安装态。

## 原因与改动

实际扩展 ID 为 `ppjmhonejgpcdmjmcbbdjookgiagambm`，原版本 0.6.2，加载目录 `/Users/nefish/Desktop/Coding/Aarre/dist`。在公开网页 `https://quaily.com/dingyi/p/363` 上，菜单 iframe 收到“此菜单已失效”。

只读诊断发现：`webNavigation.getAllFrames` 没有扩展 iframe，按帧和文档分别调用 `getFrame` 均返回 null，但 `runtime.getContexts` 返回了该菜单。会话没有绑定成功。旧测试把扩展 iframe 放进网页框架列表，未代表这项真实浏览器行为。

0.6.3 使用 `runtime.getContexts` 查询扩展自己的活动文档。顶层宿主向它实际持有的 iframe 发出随机挑战，iframe 通过扩展消息回复，由 Chrome 提供回复者的身份。全部核对成功后才绑定来源网页。保留网页导航、会话、帧、文档、URL 和一次性挑战检查；不会因为修复启动而放开嵌套或复制菜单的权限。挑战全过程最长 5 秒，超时释放等待记录。

首次连接失败时，即使业务上下文尚未建立，菜单也能向真实父网页报告错误。宿主立即显示原因与“重新打开”，另保留 15 秒加载兜底。成功的迟到响应仍可恢复原 iframe。

官方接口依据：[扩展活动上下文](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getContexts)、[网页导航与框架接口](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)。具体的 iframe 缺失是本机实际观察，不假定网页框架接口完整列出了扩展上下文。

## 可复查验收

| 目标 | 结果与证据 |
| --- | --- |
| 点击悬浮球进入真实收藏与对话区 | 最终构建点击后的首个原生界面读取（1196 ms 内）已有收藏搜索、列表和输入框，无加载或错误遮罩。该时间包含工具开销，不是性能基准。 |
| 合法菜单通过来源绑定 | 后台读取：`version=0.6.3`、`extensionFramePresent=true`、`sourceSessionBound=true`。同时 `webNavigationIncludesExtensionFrame=false`，证明已覆盖原故障条件。 |
| 搜索可用 | 输入 Interfaces，出现真实匹配收藏，包括 Interfaces › Cheat Sheet；随后清空搜索。 |
| 收起/重开保留输入 | 中文验证草稿保留，焦点回到输入框；设置打开再返回后仍保留。验证草稿已清除，没有发送问题。 |
| 设置可进入 | 更多 → 设置打开实际配置；关闭返回原工作区。没有更改设置。 |
| 失败不长期停留加载态 | 回归检查覆盖即时错误、15 秒兜底、重新打开、旧帧迟到消息及恢复。 |
| 保留身份隔离 | 覆盖未连接即执行业务、无活动上下文、伪造 nonce、嵌套/复制帧、父页导航、子帧重载、替换帧、挑战期间换会话、超时、宿主拒绝和确认丢失。 |
| 实际画面 | 本次对话内有两次原生 Chrome 截图并经目视复核：列表、搜索、菜单工具栏及底部输入框正常可见。未另行导出图片文件，不以旧图集冒充本次截图。 |

[安装态脱敏记录](installed-chrome.json)、[40 项专项回归](startup-regression.txt)、[类型检查](typecheck.txt)、[最终构建](build.txt)。`checks.txt` 为收尾前完整检查（536 项）；随后新增宿主确认丢失用例，最终正式封装完整检查 **100 个文件 / 537 项通过**，见[正式检查日志](../../../outputs/Bookmark-Layer-0.6.3-checks.txt)。

## 交付状态

产品版本为 0.6.3，正式封装及独立校验已完成。最终后台文件 299,806 bytes，低于 330,000-byte 限制。

- [解压加载目录](../../../outputs/Bookmark-Layer-0.6.3-unpacked)、[扩展 ZIP](../../../outputs/Bookmark-Layer-0.6.3.zip)（1,612,151 bytes）、[源码 ZIP](../../../outputs/Bookmark-Layer-0.6.3-source.zip)（42,641,381 bytes）。没有覆盖 0.6.2 或更早版本。
- [构建清单](../../../outputs/Bookmark-Layer-0.6.3-build.json)对应干净提交 `edba4d69822a64d581091b5bad47cd6c6cb2be43`，源码树 `e6fd5721d823092d1d3bad0d7623069b2d9497f2`。北京时间 2026-09-11 13:16:25 构建、13:16:29 封装。
- `npm run verify:artifacts` 通过。[独立校验](../../../outputs/Bookmark-Layer-0.6.3-verification.json)：97 项记录的大小/SHA-256 一致，95 个解压文件与扩展 ZIP 一致；源码 ZIP 与 git archive 一致，iframe 公开资源无缺失。
- 当前 Chrome 加载的 `dist` 与封装目录 95 个文件逐字节一致。正式封装后再次重载、刷新原网页、点击悬浮球，首个原生界面读取（1245 ms 内）显示搜索与输入框，无加载遮罩，输入框为空。前述实际交互验证在同一最终产品代码上进行。
- 本次打开的调试窗口已关闭；浏览器保留可使用的实际菜单。最后文档提交只补充这些结果，不重新封装或改变产品代码。

已在原网页刷新后确认正常。更新前一直打开的其他旧网页需要刷新一次，以替换旧的网页脚本。本次未修改用户收藏、未发送 AI 问题、未更改服务配置；只输入并清除了验证草稿。

真实 AI 回复、云同步、其他系统/最低 Chrome 版本及商店发布仍是独立验证范围。本次没有推送、部署或发布。
