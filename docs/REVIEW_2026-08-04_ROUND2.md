# 第二轮审核：性能回退与 AI Agent 收口

审核时间：2026-08-04 22:20–22:40
审核基线：`244ea83`（工作区干净，全部已提交）
上一轮审核：`docs/REVIEW_2026-08-04_T06_T07.md`
审核方式：只读审核 + 实测构建产物。未修改任何源码。

---

## 一句话结论

**架构方向是对的，但引入了两处严重的性能回退，用户已经能直接感知到。** `dist/background.js` 从 209 KB 涨到 856 KB（4.2 倍），首屏因 chunk 划分事故被迫加载 161 KB 用不到的 markdown 解析器。用户报告的「白屏 5 秒」「同步卡 1 分钟」「网页端转几分钟」三个现象都能追到确定的代码位置，**全部可修**。

上一轮我提的守卫失效问题已正确修复（`readAllSources` 目录级扫描，实测扫到 373,823 字符真实代码，非空扫）。类型检查通过，测试 366 → 408 项全绿。

---

## 一、性能回退（相对上一轮审核，必须优先处理）

### R1 🔴 `background.js` 体积暴涨 4.2 倍 — 这是三个慢问题的共同放大器

| | 上轮审核（`ae19775`） | 本轮实测（`244ea83`） | 变化 |
|---|---|---|---|
| `dist/background.js` | 214,590 B（209 KB） | **876,954 B（856 KB）** | **+308%** |

Service Worker **每次冷启动**都要下载并解析这 856 KB。MV3 的 SW 会被频繁回收，这个成本会反复付出，而不是一次性的。

成因：新增的 `vite.background.config.ts` 设了 `codeSplitting: false`，把所有后台代码全量内联。上一轮 `local-ai` 等模块是独立 lazy chunk（当时还专门为 X-05 做过动态拆分，产出 `local-ai-*.js` 28.95 KB），现在这些拆分全部失效。

**这条同时放大了另外两个问题**：首屏要等 SW 响应 `GET_BOOTSTRAP`，SW 冷启动慢 → 首屏白屏更久；同步也在 SW 里跑，冷启动慢 → 同步启动更久。

**修复方向**：恢复后台的代码分割。至少把冷启动路径（消息路由 + `GET_BOOTSTRAP`/`GET_APP_STATE_LIGHT`）与重模块（`local-ai`、cover/page-snapshot、agent runner/providers）分开，重模块保持 `import()` 动态加载。如果 `codeSplitting: false` 是为了规避 MV3 对 SW 的模块限制，注意 Chrome 已支持 `"type": "module"` 的 SW 动态 import，需要确认 manifest 配置后再决定，**不要为了绕开一个未验证的限制而牺牲 4 倍体积**。

**验收**：`dist/background.js` ≤ 300 KB；SW 冷启动到首条消息响应的时间有实测数据。

---

### R2 🔴 JSX 运行时被误打包进 `markdown` chunk，把 161 KB 解析器拖进首屏

`vite.config.ts:37-41` 的 `manualChunks` 把 `react-markdown` / `remark-*` / `micromark` 归入 `markdown` chunk。但实际产物里，**React 的 JSX 运行时也被打了进去**：

```
dist/assets/markdown-Byz-PhMo.js 开头：
  var t=Symbol.for(`react.transitional.element`), n=Symbol.for(`react.portal`) ...
```

后果是每个使用 JSX 的首屏组件都必须加载这个 chunk。实测依赖关系：

| 首屏 chunk | 是否依赖 markdown chunk |
|---|---|
| `sidepanel`（入口） | 是（`import{i as t,r as n}`，只取 2 个符号） |
| `SiteThumbnail` | 是 |
| `input` | 是 |
| `theme` | 是 |

`SiteThumbnail`、`input`、`theme` 显然不需要 markdown 解析器，它们要的是 JSX 运行时。**161,551 B 里绝大部分是首屏永远用不到的 micromark/remark 解析器。**

上一轮审核时 `react-markdown` 是干净地隔离在 lazy 的 `AgentChatPage` chunk 里的，这是本轮新引入的回退。

**修复方向**：在 `manualChunks` 中显式把 `react/jsx-runtime`、`react/jsx-dev-runtime` 归入 `react-vendor`（在 markdown 判断之前拦截）。修完后验证 `sidepanel` 入口的静态依赖里不再出现 markdown chunk。

**验收**：首屏一级静态依赖中不含 markdown chunk；首屏必载 JS ≤ 350 KB。

---

### R3 🟡 `modulePreload: false` 让首屏变成串行瀑布

`vite.config.ts:18` 关闭了 `modulePreload`，注释写的是「避免无意义的脚本预取」。但实测 `dist/sidepanel.html` 现在只有一个 `<script>` 和一个 CSS，**没有任何 preload**。

这意味着浏览器必须：下载 `sidepanel.js` → 解析 → 才发现它依赖 `react-vendor`/`markdown`/`input` → 再去下载。**依赖不是被省掉了，只是被推迟到串行发现**，总字节数一样，但多了一轮往返。

首屏一级依赖实测 **507,840 B（496 KB）**，这些全部是必载的，preload 能让它们并行下载。

**修复方向**：页面端（sidepanel/manager）恢复 `modulePreload`。它预加载的是**静态依赖图上必然要加载的**模块，不是投机预取；lazy chunk 不会被 preload。这里当初的判断依据可能有误。

---

## 二、首屏白屏 5 秒的完整链条

用户描述：重新载入扩展后首次打开侧边栏，白屏 5 秒以上。

拆解成四段，每段都有确定位置：

**第 1 段｜脚本加载解析（有骨架保护）**
`sidepanel.html` 内嵌了静态骨架，这段用户能看到内容。但它是 `#root` 的子元素，React 一挂载就被 `createRoot().render()` 清空。

**第 2 段｜骨架被清空，数据未到（视觉上就是白屏）**
这是真正的白屏窗口。首屏必载 496 KB + 串行瀑布（R2、R3）拉长了这一段。

**第 3 段｜首屏数据被 `Promise.all` 绑死 🔴**

```64:74:src/ui/sidepanel/hooks/use-app-state.ts
    void Promise.all([
      readNativeBookmarkSnapshot(),
      sendExtensionRequest({ type: "GET_BOOTSTRAP" }),
    ])
      .then(([nextSnapshot, bootstrap]) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
```

`readNativeBookmarkSnapshot()` 走的是 `chrome.bookmarks.getTree()`，**在侧边栏本地直接读，毫秒级返回，根本不需要 Service Worker**。这个设计本身是对的。

但 `Promise.all` 把它和 `GET_BOOTSTRAP` 绑在一起，而 `GET_BOOTSTRAP` 要等 SW 冷启动解析完 856 KB（R1）。**快的那个被慢的完全拖住了。**

**修复**：拆开两个请求。`getTree()` 返回就立即 `setSnapshot` 渲染书签树；`GET_BOOTSTRAP` 单独更新 `appState`/`displaySettings`，不 gate 书签列表。这是本文档里**性价比最高的单点修复**，改动小、见效直接。

**第 4 段｜SW 线程竞争（需实测确认）**
扩展重载会触发 `onInstalled` → `void importNativeBookmarks()`，228 条书签逐条 SHA-256 + IndexedDB 读写，与首屏的 `GET_BOOTSTRAP` 争抢同一个 SW。建议加时间戳埋点确认，再决定是否分片。

---

## 三、同步卡「0/1」超过 1 分钟

### 3.1 为什么是「0/1」，为什么看起来不动

```131:141:src/lib/sync-engine.ts
      const outboxTotal = await dependencies.countOutbox();
      await status("pushing", 0, outboxTotal + 1);
      // ... outbox 批次循环有进度上报 ...
      await dependencies.pushEntities();     // ← 228 条实体全在这一步，中间零上报
      await status("pushing", outboxTotal + 1, outboxTotal + 1);
```

Outbox 为空时 `total = 0 + 1 = 1`，所以显示 `0/1`。那个 `+1` 代表 `pushEntities()` **整整一步**，而这一步内部要推 228 条书签实体。**从写下 `0/1` 到这步结束，中间没有任何进度上报**，所以 UI 就停在 `0/1` 一分多钟。

不是「同步卡住」，也不是「UI 没刷新」（`writeSyncStatus` 的广播机制是正常的），而是**进度模型把一个包含数百次网络请求的阶段计成了 1 步**。

### 3.2 为什么这一步要一分钟

```660:669:src/lib/cloud-state.ts
  for (const binding of [...bookmarkBindings.current, ...bookmarkBindings.deleted]) {
    const deleted = bookmarkBindings.deleted.includes(binding);
    if (await putEntity(state, { entityType: "bookmark-item", ... })) synced += 1;
  }
```

纯 `for` + `await`，**228 条书签 = 228 次串行 `PUT /v1/sync/entities`**，没有并发、没有批量。按每次往返 200–300 ms 估算，仅这一步就是 45–70 秒，与用户实测吻合。

后端也只有单条写入接口（`server/src/app.ts:235`），**没有批量端点**。资源推送（`cloud.ts:365-394`，25 条一批但批内串行）和资产同步（`cloud-assets.ts`，每张 2–3 次 HTTP，串行）是同样的模式。

**修复方向**（按收益排序）：

1. **后端新增批量写入端点**，如 `PUT /v1/sync/entities/batch` 接收数组。这是根治手段，能把 228 次往返压到个位数。需要同时保证幂等（现有 `operationId` 机制可复用）。
2. 客户端加并发限制（8–16 并发）。**在批量接口就绪前，这是见效最快的临时手段**，能把耗时压到约 1/10。
3. 进度分母改成真实任务数（outbox 条数 + 实体条数），循环内逐条上报。这不提速，但消除「假死」观感 —— 用户能看到 `37/228` 在动，主观体验完全不同。

---

## 四、网页端「正在读取你的收藏库」几分钟 🔴

这条最值得优先修，因为**文案在说谎**：

```190:202:src/ui/manager/ManagerApp.tsx
        if (runSync && state.auth.configured && state.auth.signedIn && ...) {
          try {
            await sendExtensionRequest({ type: "SYNC_NOW" });
          } catch { ... }
        }
        await loadResources();
```

`setLoading(false)` 在 `finally` 里。所以顺序是：显示「正在读取你的收藏库」→ **等一整轮云同步跑完**（即上面那 228 次串行请求）→ 才开始真正读收藏库 → 关闭 loading。

**用户盯着「正在读取你的收藏库」的那几分钟里，程序根本没在读收藏库，而是在等网络同步。本地数据其实早就可以显示了。**

更糟的是 `SYNC_NOW` 会挂到已在运行的同步轮次上（`sync-engine.ts:171-174` 单实例），登录后自动同步正在跑时，网页端要等那一整轮结束。

**修复**：首屏只读本地（`loadResources()` 先跑，立即关 loading），`SYNC_NOW` 改为 fire-and-forget，同步完成后通过既有的 `SYNC_STATUS` 广播做增量刷新。这符合项目一直强调的本地优先原则。

**验收**：登录状态下打开网页端，收藏列表在 1 秒内出现，同步在后台进行且有可见状态。

---

## 五、AI Agent（用户指定的重点）

架构方向是对的 —— 已是真正的工具调用循环，7 个只读工具 + 5 个 `plan_*` 写工具（写操作只生成待确认计划，不直接执行）。以下是需要收口的问题。

### 5.1 🔴 每次提问都白白多跑一次完整生成

```66:82:src/lib/agent/runner.ts
    if (!response.toolCalls.length) {
      const streamed = input.onDelta && input.provider.streamFinal
        ? await input.provider.streamFinal({ messages, signal: input.signal, onDelta: input.onDelta })
        : null;
      return {
        answer: streamed?.text || response.text || ...
```

当模型不再调用工具时，说明它**已经生成了完整答案**（就在 `response.text` 里）。这段代码丢弃它，再调一次 `streamFinal` 从头重新生成。

**这条路径 100% 触发**，不是边缘情况：`lifecycle/agent-stream.ts:34` 总是传入 `onDelta`，UI 侧（`use-agent-chat.ts:119`）优先走 port 连接。

后果：**每次提问的时间和 API 费用都翻倍**，其中一次生成的结果被直接扔掉。

**修复方向**：让最后一轮本身就是流式的。可行做法是每轮都用带 tools 的流式接口（三家都支持）：有 tool_calls 就照常处理，没有就直接把流式输出转给 UI。退而求其次，至少在 `response.text` 非空时直接返回，不再重复调用。

**验收**：一次问答的 provider 调用次数 = 工具轮次数，不额外 +1；新增测试断言这一点。

### 5.2 🔴 书签卡片：UI 完好，数据被写死为空

`AgentChatPage.tsx:199-235` 有完整的卡片渲染（图标 / 标题 / 域名 / 点击打开），`BookmarkAgentSource` 类型也齐全（`types.ts:382-388`）。但两处后端返回都硬编码了空数组：

- `src/extension/handlers/agent.ts:312` → `sources: []`
- `src/lib/local-ai.ts:663` → `sources: []`（预览模式路径，同样要改）

**修复方向**：在 `runAgent` 执行期间收集 `search_bookmarks` / `get_bookmarks` 命中的书签（去重，保留顺序，上限 8–10 条），随结果返回填入 `sources`。

**连带效果**：卡片补上后，应在 system prompt 里要求模型**不要在正文里重复罗列书签标题和链接**，改为只做归类和说明。用户反馈「markdown 不美观」的主因就是模型被迫把书签信息全塞进正文（因为卡片是空的），产生了大段 emoji 标题 + 加粗标题 + 链接的密集排版。**这不是 CSS 问题**（样式规则有 41 条，覆盖完整）。

### 5.3 🔴 底部那行文案：不只是冗余，数字是假的

`DeepSeek · 已检查 228/228 条收藏 · 12 条受隐私保护`

```314:317:src/extension/handlers/agent.ts
      catalogSize: linkedResources.length,
      examinedCount: linkedResources.length,
      catalogScanComplete: true
```

`examinedCount` 直接等于 `catalogSize`，永远显示 `228/228`；`catalogScanComplete` 硬编码 `true`。这是旧的「每次全量扫描」架构留下的字段，**在按需搜索的新架构下已经不存在「检查了 228 条」这回事**。

**修复**：按用户要求整体移除该行（`use-agent-chat.ts:154`）。同时把 `examinedCount` / `catalogScanComplete` 这两个已无意义的字段从响应类型中清理掉，不要留着误导后续开发。

### 5.4 🟡 进度「2/12」制造虚假的缓慢感

`agent.ts:271,297` 把 `total` 写成 12，这是 `MAX_TOOL_ROUNDS`（轮次**上限**），不是预期工作量。多数问题 3–4 轮结束，进度条永远走不满。标签写「分批检查收藏」，暗示在逐批扫描全部收藏，**实际并没有**。

**修复**：不要显示分数。改为显示当前实际动作（复用已有的 `正在使用 xxx` 文案即可），或用不确定态指示器。

### 5.5 🟡 真正影响速度的是往返次数，不是工具并行

需要向后续开发者说明清楚：**工具执行是内存操作（几十毫秒），LLM 往返是网络操作（秒级），差两个数量级。** 并行执行同一轮的工具收益有限；而多轮之间**本质无法并行**（下一轮的查询依赖上一轮的结果）。

按收益排序的优化：

1. 去掉 5.1 的重复生成 —— 直接省一整轮，收益最大
2. **把文件夹树和收藏统计预置进 system prompt** —— 省掉 `list_folders`、`get_library_stats` 的往返。用户截图里那一轮就调了 `list_folders`，可以完全消除
3. **`search_bookmarks` 支持关键词数组** —— 现在一次只收一个 query（`tools.ts:17-21`），模型只能连调 4 次（截图实证）。改成数组后一次调用完成
4. 同轮工具并行（`runner.ts:86-120` 的 for-await 改 `Promise.all`）—— 顺手做，别指望它是解药
5. **搜索索引缓存** —— `searchLocalResourcesWithPinyin` 每次调用都 `buildLocalSearchIndex(resources)` 重建全量索引（`search.ts:267`），一轮 4 次搜索就重建 4 次。在单次 agent run 内缓存即可
6. `insights()` 缓存 —— `tools.ts:77` 每次调用重算全量洞察，`get_library_stats` / `find_duplicates` / `find_dead_links` 都会触发

### 5.6 🟡 system prompt 过于简陋

```52:src/lib/agent/runner.ts
      content: "你是 Aarre 收藏助手。先用只读工具核实，再用 plan_* 工具生成待确认计划。写工具绝不代表已经执行。最终用中文简洁回答。"
```

一句话，没有输出格式约束、没有库上下文、没有工具使用策略。这是模型滥用 emoji 标题、反复试探关键词的直接原因。

**修复方向**：扩写为结构化 prompt，包含：库规模与文件夹树概览（省往返）、输出格式约束（不堆 emoji、不重复罗列已在卡片中展示的书签、控制标题层级）、工具使用策略（先 `list_folders` 类信息已预置故无需调用、搜索一次给足关键词）、以及计划类操作的表述规范。

### 5.7 🟡 两套重复实现

`handlers/agent.ts:235 askAgent` 与 `local-ai.ts:602 askBookmarkAgent` 是两套几乎相同的封装，都调 `runAgent`，都有 `sources: []`、`examinedCount = 长度`、`total: 12` 这三个相同缺陷。后者服务于侧边栏预览模式（`preview-message-service.ts:223`），不是死代码。

**修复时两处都要改**，或抽出共用封装。

### 5.8 🟡 缺少消息级操作

对标 ChatGPT / Gemini 侧边栏，现有能力只到会话级（删除、重命名、停止、确认/撤销操作）。缺：

- **重新生成**（最常用）
- **复制回答**
- **编辑问题重发**
- **失败后重试** —— 目前失败只把消息改成「这次没有完成：xxx」（`use-agent-chat.ts:171`），没有任何重试入口，用户只能手动重打问题

前三项需要在 `use-agent-chat.ts` 暴露对应方法并在 `AgentChatPage` 加入消息级操作区。

---

## 六、上一轮审核意见的落实情况 ✅

| 上轮提出 | 落实 |
|---|---|
| 3 项失败测试（守卫指向已搬走的代码） | 已修，408 项全绿 |
| 4 条 `not.toContain` 守卫永真失效 | **已正确修复**：新增 `tests/source-test-utils.ts` 的 `readAllSources` 做目录级递归扫描。我反向验证过实际扫描 373,823 字符、能读到真实符号，不是空扫 |
| `expect(thinking).toContain("AgentThinkingSteps")` 断言退化 | 已处理 |
| PRD 三条平台校正（Blob 不能过消息通道、流式必须 UI 发起连接） | 已按修正后的 PRD 实现，`lifecycle/agent-stream.ts` 由 UI 发起 `connect`、SW 顶层监听 `onConnect`，正确 |

MV3 生命周期依然稳固：`background.ts` 3 行，`initializeBackground()` 同步、无顶层 `await`。

---

## 七、建议执行顺序

按「用户感知收益 / 改动成本」排序：

1. **拆开 `use-app-state.ts:64` 的 `Promise.all`** — 改动最小，直接消除首屏主要白屏窗口
2. **网页端 `SYNC_NOW` 改 fire-and-forget** — 几分钟 loading 变 1 秒
3. **修 `manualChunks` 的 JSX 运行时归属** — 首屏减重约 150 KB
4. **恢复 background 代码分割** — 856 KB → 目标 300 KB 以内，同时改善首屏和同步启动
5. **恢复页面端 `modulePreload`** — 消除串行瀑布
6. **Agent：去掉重复生成 + 接上 sources + 删假文案 + 改进度显示** — 这四项一起做，用户感知最强
7. **同步并发化**（客户端并发先行，后端批量端点随后）+ 进度粒度细化
8. **Agent 二阶段**：system prompt 扩写、搜索支持关键词数组、索引与洞察缓存、消息级操作（重新生成/复制/重试）

---

## 附：本次审核的验证命令

```bash
# 构建产物实测
npm run build
ls -l dist/background.js
rg -o '(src|href)="/assets/[^"]*"' dist/sidepanel.html

# 首屏一级静态依赖与总量
rg -o 'from"\./([A-Za-z0-9_.-]+\.js)"' -r '$1' dist/assets/sidepanel-*.js | sort -u

# 确认 JSX 运行时误打包
head -c 400 dist/assets/markdown-*.js          # 开头是 react.transitional.element 即为误打包
rg -c 'markdown-' dist/assets/SiteThumbnail-*.js dist/assets/input-*.js

# 守卫有效性反向验证
# 用 vite-node 调 readAllSources("src/extension/")，确认字符数与已知符号命中
```
