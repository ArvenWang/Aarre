# 第三轮审核与详细设计方案（2026-08-05）

审核对象：上一轮（ROUND2 报告）之后的全部改动 + 用户实测反馈的 13 个问题。
本文档同时是**执行说明书**：每一项都给出精确文件、行号、现有代码、目标代码、验收标准。执行者请逐条照做，不要自由发挥。

---

## 第一部分：上一轮修复的审核结论

**结论：7 项全部修复且质量合格，实测数据超出预期。可以合并。**

| # | ROUND2 提出的问题 | 实测结果 | 判定 |
|---|---|---|---|
| 1 | `background.js` 因关闭代码分割膨胀到 856 KB | 现为 **319 KB**（降 63%） | 通过 |
| 2 | JSX runtime 被错误打进 markdown chunk，首屏拖 161 KB | markdown chunk 已从首屏依赖中消失 | 通过 |
| 3 | `modulePreload: false` 导致串行瀑布下载 | 已恢复，`sidepanel.html` 中 9 个 preload 并行 | 通过 |
| 4 | 首屏 `Promise.all` 把书签树绑死在 SW 冷启动上 | 已拆成两条独立 promise（`use-app-state.ts:62-86`） | 通过 |
| 5 | 网页端 `await SYNC_NOW` 阻塞列表渲染 | 已改 fire-and-forget（`ManagerApp.tsx:197-199`） | 通过 |
| 6 | Agent 末轮重复调用 LLM，延迟和费用翻倍 | 已修（`runner.ts:126-137`），有 `response.text` 就直接返回 | 通过 |
| 7 | `sources` 恒为空数组，书签卡片渲染不出来 | 已接通（`runner.ts:132`） | 通过 |

**首屏体积三轮对比**

| 版本 | 首屏必载 JS | 加载方式 |
|---|---|---|
| 拆分前基线 | 642 KB | 并行 |
| 上一轮（回退状态） | 594 KB | **串行瀑布** |
| 本轮 | **446 KB** | 并行预加载 |

质量门禁：`tsc --noEmit` 无错误；`vitest` 78 个文件 / 416 个用例全部通过。

---

## 第二部分：本轮发现的三个根因缺陷（必须最先修）

这三个问题都不是"某个页面样式没调好"，而是**一处配置/一个属性引发的系统性故障**。修根因即可一次性解决用户看到的全部现象，**严禁逐个页面打补丁**。

---

### R1【P0】所有下拉面板全透明 —— Tailwind 扫描范围漏了一个文件

**用户现象**：网页端文件夹筛选、排序下拉、编辑收藏里的文件夹下拉，展开后是一块全透明的板子，背后的卡片和文字全部透出来（截图 2、5）。

**根因链条**（已逐环验证）：

1. 下拉面板 `SelectContent` 自身不带背景色，背景由 `<Elevated>` 组件提供
   → `src/ui/components/ui/select.tsx:433`
2. `Elevated` 通过 `surfaceClasses(level, shadowLevel)` 拼出 `bg-surface-2 shadow-surface-3`
   → `src/lib/elevated.tsx:48`
3. 这两个类名的字符串字面量定义在查找表里
   → `src/lib/surface-classes.ts:1-21`
4. 两个 CSS 入口都写了 `@import "tailwindcss/utilities.css" source(none)`，`source(none)` 表示**关闭自动扫描，只认显式 `@source`**
   → `src/ui/styles-sidepanel.css:2`、`src/ui/styles-manager.css:2`
5. 显式 `@source` 只声明了 `./sidepanel`、`./manager`、`./components`、`../lib/shape-context.tsx`
   → **`../lib/surface-classes.ts` 不在其中**
6. 于是 `bg-surface-1..8`、`shadow-surface-1..8` 共 16 个类**从未被生成**

**实测证据**（在 `dist/assets/sidepanel-*.css` 中查找）：

| 类名 | 是否存在于产物 |
|---|---|
| `bg-surface-2` | **缺失** |
| `shadow-surface-3` | **缺失** |
| `border-border` | 存在（因其他文件也用到，蹭到了生成） |

注意 `@theme inline` 里 `--color-surface-1..8` 和 `--shadow-surface-1..8` **变量本身是定义好的**（`src/ui/styles.css:34-49`），问题纯粹是工具类没被生成。**不要去改 styles.css 的变量。**

#### 修复（改两行，不要改别的）

`src/ui/styles-sidepanel.css` 第 5 行之后加一行：

```css
@source "../lib/shape-context.tsx";
@source "../lib/surface-classes.ts";
```

`src/ui/styles-manager.css` 第 5 行之后加同样一行：

```css
@source "../lib/shape-context.tsx";
@source "../lib/surface-classes.ts";
```

#### 验收标准

1. 执行 `npm run build`
2. 执行 `grep -c "bg-surface-2" dist/assets/sidepanel-*.css` → 结果必须 **≥ 1**
3. 同样检查 `shadow-surface-3` → 必须 ≥ 1
4. 同样检查 `dist/assets/manager-*.css` 两个类 → 都必须 ≥ 1
5. 打开网页端，展开"所有文件夹"下拉 → 面板为**不透明白底 + 柔和投影**，背后内容完全看不见
6. 打开编辑收藏对话框，展开文件夹下拉 → 同样不透明

#### 防回归（必须加）

在 `tests/` 下新建 `tests/tailwind-source-coverage.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// surface-classes.ts 里的类名是通过查找表间接引用的，Tailwind 的
// source(none) 模式扫不到未声明的文件，漏掉就会让所有弹层失去背景。
describe("tailwind @source coverage", () => {
  for (const entry of ["src/ui/styles-sidepanel.css", "src/ui/styles-manager.css"]) {
    it(`${entry} 覆盖 surface-classes.ts`, () => {
      const css = readFileSync(entry, "utf8");
      expect(css).toContain('@source "../lib/surface-classes.ts"');
    });
  }
});
```

---

### R2【P0】侧边栏吸顶文件夹条半透明 + 毛玻璃从未生效 —— 同一个 `mask-image` 造成

**用户现象**：文件夹展开后表头吸顶，但这一条是半透明的，背后书签标题透出来；之前加过的毛玻璃始终看不到效果（截图 3、10）。

**用户的判断是对的**：毛玻璃确实没生效，半透明是残留。但半透明的来源不是他以为的背景色，而是另一处。

**根因**：滚动容器 `.native-content` 上有 `mask-image`（`src/ui/sidepanel.css:420-433`）：

```css
.native-content {
  --bookmark-fade-start: 0px;   /* 滚动时由 scroll-driven animation 变成 52px */
  --bookmark-fade-end: 52px;
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    var(--ink) var(--bookmark-fade-start),
    var(--ink) calc(100% - var(--bookmark-fade-end)),
    transparent 100%
  );
}
```

这一个属性同时造成两个症状：

**症状一（半透明）**：`--bookmark-fade-start` 在滚动时被动画推到 **52px**，即容器顶部 52px 高度内容被渐隐。而吸顶条正好 `position: sticky; top: 0`（`sidepanel.css:548-556`），行高约 36px，**整条都落在渐隐区里**，于是被 mask 淡化。这就是半透明的真正来源——注意它只在滚动后出现，因为不滚动时 `fade-start` 是 0。

**症状二（毛玻璃失效）**：按 CSS Filter Effects Level 2 规范，设置了 `mask` / `mask-image` 的元素会成为 **backdrop root**。子元素的 `backdrop-filter` 只能采样这个 root 内部已合成的内容，实际表现就是模糊完全不出现。所以 `sidepanel.css:554-555` 那两行 `backdrop-filter: blur(14px)` 一直是死代码。

#### 修复方案（二选一，**推荐方案 A**）

##### 方案 A：去掉半透明，吸顶条用实色（推荐）

理由：侧边栏宽度只有 380–400px，毛玻璃的视觉收益极小；而 `backdrop-filter` 在长列表滚动时每帧都要重新采样模糊，是实打实的掉帧来源，与"提升启动和滚动流畅度"的目标冲突。

改 `src/ui/sidepanel.css:548-556`：

```css
.bookmark-row[data-folder="true"][data-expanded="true"] {
  position: sticky;
  top: 0;
  z-index: 7;
  overflow: hidden;
  background: var(--bg);
  /* mask 会把整条吸顶头吃进渐隐区，这里补一段自身遮罩把它顶掉 */
  mask-image: none;
  -webkit-mask-image: none;
}
```

**关键**：删掉 `backdrop-filter` 和 `-webkit-backdrop-filter` 两行（死代码），背景从 `color-mix(... 92% ...)` 换成实色 `var(--bg)`。

但仅这样还不够——父级 mask 依然会淡化它。必须同时把顶部渐隐关掉，见下方"共同步骤"。

##### 方案 B：真正做出毛玻璃

若一定要毛玻璃，必须**移除滚动容器的 mask**，改用不影响 backdrop root 的遮罩层：

1. 删除 `src/ui/sidepanel.css:420-433` 的 `mask-image` / `-webkit-mask-image` 两段
2. 同时删除 `animation` / `animation-timeline` / `animation-range`（434-440 行，它们只服务于 mask 变量）
3. 在滚动容器的父元素（`sidepanel.css:405-407` 那个 `overflow: hidden` 的壳）上加伪元素做渐隐：

```css
.native-shell {           /* 405 行那个容器，按实际类名替换 */
  position: relative;
}

.native-shell::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 52px;
  z-index: 6;             /* 必须低于吸顶条的 z-index: 7 */
  pointer-events: none;
  background: linear-gradient(to top, var(--bg), transparent);
}
```

4. 吸顶条保留 `backdrop-filter: blur(14px)`，背景改为 `color-mix(in srgb, var(--bg) 72%, transparent)`（92% 太实，看不出模糊）

**方案 B 的取舍要讲清楚**：顶部渐隐效果会消失（因为吸顶条必须清晰，两者在同一位置无法共存），且滚动性能会下降。

##### 共同步骤（两个方案都要做）

把 `--bookmark-fade-start` 的滚动动画去掉，只保留底部渐隐。改 `src/ui/sidepanel.css:434-440`：

```css
  animation: bookmark-reveal-scroll-end linear both;
  animation-timeline: scroll(self);
  animation-range: calc(100% - var(--bookmark-scroll-fade)) 100%;
```

即删除 `bookmark-reveal-scroll-start` 那一条。顶部不再渐隐，吸顶条就不会被淡化。

#### 验收标准

1. 侧边栏展开任一文件夹，向下滚动到表头吸顶
2. 吸顶条**完全不透明**，背后书签标题一个字都不透出来（方案 A）；或呈现明显的模糊虚化（方案 B）
3. 列表底部仍有渐隐效果
4. 快速滚动 200 条书签，无明显掉帧

---

### R3【P0】历史会话丢失 AI 答案 —— 云端拉取无条件覆盖本地

**用户现象**：历史会话里 8/4 的三条都显示"尚未生成回答"，但打开会话能看到完整答案（截图 1 对比截图 6）。8/3 及更早的会话正常。

**这是真实的数据丢失，不是显示问题。**

**根因**：`src/lib/cloud-state.ts:900-902`

```ts
} else if (entity.entityType === "conversation") {
  await saveAgentConversation(entity.payload as AgentConversation);
  restored += 1;
}
```

从云端恢复会话时**直接覆盖本地，没有任何时间戳比较**。

**触发时序**：

1. 用户提问 → `use-agent-chat.ts:115` 调 `persist(pending)` 保存一份"assistant 消息 content 为空"的会话
2. `SAVE_AGENT_CONVERSATION` handler 触发 `syncDurableCloudState()`，把这份**空答案版本**推上云
3. AI 回答完成 → `use-agent-chat.ts:162` 再 `persist(completed)` 保存完整版本，再次推云
4. 下一次同步拉取时，若云端返回的仍是第 1 步那份（推送乱序、或该实体在服务端尚未更新），**第 900 行会无条件把空答案写回本地**
5. 结果：会话内容被抹掉，列表回退成"尚未生成回答"

**为什么 8/3 的正常**：8/3 云同步尚未真正跑通，没有拉取覆盖发生；8/4 修好同步后立刻暴露。时间线完全吻合。

#### 修复（三处都要改，缺一不可）

**修复点 1：拉取时比较时间戳，本地更新则跳过**

改 `src/lib/cloud-state.ts:900-902`：

```ts
} else if (entity.entityType === "conversation") {
  const incoming = entity.payload as AgentConversation;
  const local = (await getAgentConversations()).find((item) => item.id === incoming.id);
  // 云端可能仍持有提问瞬间那份空答案，本地更新就不能被它盖掉。
  if (!local || local.updatedAt < incoming.updatedAt) {
    await saveAgentConversation(incoming);
    restored += 1;
  }
}
```

注意：`getAgentConversations()` 已在该文件第 7 行导入，直接用。若担心循环里反复读取的开销，可在 `for` 循环外先取一次存成 `Map<string, AgentConversation>`，推荐这么做。

**修复点 2：不要把"空答案"推上云**

改 `src/lib/cloud-state.ts:647-655`，跳过没有任何已完成回答的会话：

```ts
for (const conversation of conversations) {
  if (!/^[0-9a-f-]{36}$/i.test(conversation.id)) continue;
  // 提问瞬间那份占位会话不值得占用云端版本号，等答案落地再推。
  const hasAnswer = conversation.messages.some(
    (message) => message.role === "assistant" && message.content.trim().length > 0
  );
  if (!hasAnswer) continue;
  await queueEntity({ /* 原样保留 */ });
}
```

**修复点 3：提问瞬间不触发云同步**

`persist(pending)` 会连带触发一次整库同步，既浪费又制造上面的竞态。在 `SAVE_AGENT_CONVERSATION` handler 中，仅当会话已有非空 assistant 回答时才调 `syncDurableCloudState()`。定位方式：在 `src/extension/handlers/` 下搜索 `SAVE_AGENT_CONVERSATION`。

#### 验收标准

1. 新建 `tests/conversation-sync-guard.test.ts`，覆盖三个用例：
   - 云端 `updatedAt` 较旧 → 本地内容**保持不变**
   - 云端 `updatedAt` 较新 → 本地被更新
   - assistant 消息全为空的会话 → **不进入** outbox
2. 手动验证：提问 → 等答案生成完 → 点"立即同步" → 返回历史会话列表 → 摘要显示答案首行，**不是**"尚未生成回答"
3. 已经损坏的历史记录无法找回（本地和云端都只剩空版本），需要向用户说明

---

## 第三部分：Agent 对话内联引用书签（P0 体验重构）

**用户诉求**：正文和卡片现在是泾渭分明的两块，没有对应关系；而且卡片数量比正文提到的多，无法一一对应。理想是把卡片直接插进正文，退一步至少让正文里的收藏链接可点。

### 先解释"卡片比正文多"的原因

`src/lib/agent/runner.ts:80-101` 的 `collectToolSources` 收集的是**工具搜索命中的全部书签**，不是 AI 在回答里实际引用的那些：

```ts
if (toolName !== "search_bookmarks" && toolName !== "get_bookmarks") return [];
// ...把结果里出现的每一个 resourceKey 都加进 sources
```

AI 搜"配色"可能召回 20 条，正文只讲了 6 条，底部却把 20 条都摆出来（受 `saveAgentConversation` 限制截断到 20 条）。所以数量对不上是**必然**的，不是偶发。

更关键的是，system prompt 第 66 行**明确禁止**了正文出现链接：

```
"命中的收藏会由界面以卡片展示；正文不要重复罗列书签标题、域名或链接，只需归类、比较和解释结论。"
```

正文里的书签名因此只是加粗文本，天然不可点。这条规则必须反转。

### 必须先说明的技术约束

**HTML 规范不允许 `<p>` 内出现 `<div>`。** Markdown 的段落文字会渲染成 `<p>`，如果在段落中间插入块级卡片 `<div>`，浏览器会强行拆分 DOM，导致布局塌陷和 React hydration 警告。

因此"把卡片插进去"必须分两种形态实现，**执行者不得混用**：

| 位置 | 渲染形态 | 元素 |
|---|---|---|
| 段落文字中间提到 | 内联 chip（favicon + 标题，一行内） | `<span>` / `<a>` |
| 列表项开头 | 完整横向卡片（favicon + 标题 + 域名） | `<a>` 内含 `<span>`，用 flex 布局 |

列表项 `<li>` 允许包含块级内容，所以卡片形态放在列表里是安全的；而 AI 回答本来就以列表居多（见截图 1），覆盖了绝大多数场景。

### 实施步骤

#### 步骤 1：反转 system prompt

改 `src/lib/agent/runner.ts:66`，把那一行替换为：

```ts
"提到收藏库里的具体条目时，必须写成 Markdown 链接 [标题](该收藏的原始网址)，界面会自动渲染成可点击的书签卡片。",
"只为真正讨论到的条目加链接，不要为了凑数把搜索结果全部列出。"
```

#### 步骤 2：sources 只保留正文引用的条目

改 `src/lib/agent/runner.ts` 的返回处（第 129-136 行附近）。在返回前按正文出现的 URL 过滤：

```ts
function sourcesCitedIn(answer: string, all: BookmarkAgentSource[]): BookmarkAgentSource[] {
  // 正文用 Markdown 链接引用收藏，未被引用的召回结果不进入卡片区，
  // 否则卡片数量会比正文多，用户无法对应。
  return all.filter((source) => answer.includes(source.url));
}
```

返回时 `sources: sourcesCitedIn(response.text, [...sources.values()])`。

**注意**：URL 可能因规范化不一致而匹配失败，比较前对两侧都用 `canonicalizeUrl`（`src/lib/url.ts` 已有），并做 try/catch 兜底。

#### 步骤 3：正文链接渲染成书签 chip / 卡片

改 `src/ui/sidepanel/pages/AgentChatPage.tsx:22-37` 的 `AgentMarkdown`。该文件已经具备全部所需能力，**不要新建文件**：

- `resourceForUrl(resourceByUrl, url)` — 第 39-43 行，已有
- `siteBrandForUrl(siteBrandByHost, input)` — 第 45 行，已有
- `SiteThumbnail` 组件 — 第 17 行已导入
- `hostFromUrl` — 第 20 行已导入

改造后：

```tsx
function AgentMarkdown({
  content,
  resourceByUrl,
  siteBrandByHost,
}: {
  content: string;
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
}) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const resource = href ? resourceForUrl(resourceByUrl, href) : undefined;
            if (!resource) {
              return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
            }
            return (
              <a
                className="agent-inline-source"
                href={resource.url}
                target="_blank"
                rel="noreferrer noopener"
                title={resource.title}
              >
                <SiteThumbnail
                  resource={resource}
                  siteBrand={siteBrandForUrl(siteBrandByHost, resource.url)}
                  size={16}
                />
                <span>{children}</span>
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

`SiteThumbnail` 的实际 props 以该组件定义为准，照抄文件内已有的调用写法。

调用处需要把两个 Map 传进去——它们在该文件中已经构造好，找到 `<AgentMarkdown content={...} />` 补上参数即可。

#### 步骤 4：样式

在 `src/ui/sidepanel-lazy.css` 末尾追加：

```css
/* 段落中提到的收藏：内联 chip，不打断文字流 */
.agent-inline-source {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 6px 1px 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
  vertical-align: baseline;
  line-height: 1.4;
}

.agent-inline-source:hover {
  background: var(--surface-sunken);
  border-color: var(--line-strong);
}

.agent-inline-source > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 列表项里独占一行的引用：升级成横向卡片 */
.agent-markdown li > .agent-inline-source:only-child {
  display: flex;
  width: 100%;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border-radius: var(--radius-md);
}
```

#### 步骤 5：底部"相关收藏"区块

正文已有内联卡片后，底部重复列表就是冗余。处理规则：

- 若 `sources` 全部已在正文中出现 → **不渲染**底部区块
- 若存在正文未引用但工具召回的条目 → 底部保留，标题从"相关收藏"改为"其他相关收藏"

对应改 `AgentChatPage.tsx` 中 `message.sources?.length ? (...)` 那段的渲染条件。

#### 验收标准

1. 问"帮我找配色相关的收藏" → 正文里每个被提到的书签都是**带图标的可点 chip**，点击在新标签打开
2. 底部若仍出现列表，其中**不含**正文已经提到的条目
3. 正文提到的外部链接（非收藏库内）仍渲染为普通链接，不带图标框
4. React 控制台**无** `<div> cannot appear as a descendant of <p>` 警告
5. 长标题的 chip 不撑破侧边栏宽度，超出部分省略号

---

## 第四部分：UI 细节任务清单

以下每一项都是独立任务，可并行执行。**改动范围严格限制在指定文件的指定行**。

---

### T-1 设置 · Google 账号：按钮移到用户名右侧

用户口述的"立体臀部"为语音输入误差，实指**"立即同步"**按钮。

**现状**：`src/ui/sidepanel/components/settings/AccountCloudSection.tsx:41-54` 中 `CloudStatusRow` 嵌在 `.settings-account-identity` 内部，两个按钮位于用户名下方（截图 4）。按钮定义在 `src/ui/sidepanel/components/CloudStatusRow.tsx:71-92`。

**目标布局**：

```
[头像]  Arven wang (Nefish)              [立即同步] [断开]
        ● 已同步 · 刚刚
```

**改法**：

1. `CloudStatusRow.tsx` 增加 `actionsSlot?: "inline"` 属性，或更简单：把第 71-92 行的 `.cloud-status-actions` 整块提取成导出的 `CloudStatusActions` 组件
2. `AccountCloudSection.tsx` 结构调整为：

```tsx
<div className="settings-account-row">
  {/* 头像保持不变 */}
  <div className="settings-account-identity">
    <strong>{identity || "尚未连接"}</strong>
    {appState?.auth.signedIn ? <CloudStatusRow ... showActions={false} /> : <small>...</small>}
  </div>
  {appState?.auth.signedIn ? (
    <CloudStatusActions busy={Boolean(action)} syncing={syncing} onSync={onSync} onDisconnect={onSignOut} />
  ) : null}
</div>
```

3. `.settings-account-row` 已是横向 flex，给 actions 加 `margin-left: auto` 靠右

**"断开账号"按钮样式重做**（当前红框描边过于扎眼）：

在 `src/ui/sidepanel.css` 添加：

```css
.cloud-status-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-left: auto;
  flex-shrink: 0;
}

/* 断开是低频破坏性操作，默认收敛成中性文字按钮，
   只在悬停时透出警示色。 */
.cloud-status-disconnect {
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  padding-inline: var(--sp-2);
}

.cloud-status-disconnect:hover {
  color: var(--negative);
  background: color-mix(in srgb, var(--negative) 8%, transparent);
}
```

同时把 `CloudStatusRow.tsx:84` 的 `variant="danger-quiet"` 改为 `variant="ghost"`。

**文案精简**："断开账号" → **"断开"**（右侧空间有限）。

**验收**：两个按钮与用户名同行右对齐；断开按钮默认无红框，悬停才变红；窄侧边栏下不换行、不溢出。

---

### T-2 设置 · 显示模块重排

**现状**：`src/ui/sidepanel/components/settings/DisplaySettingsSection.tsx:27-36` 有"站点标识 / 页面封面"切换（截图 7），用户要求移除。移除后该模块只剩一个开关。

**改法**：

1. 删除第 27-36 行整个 `<TabsSubtle>` 块
2. 删除第 1 行 `TabsSubtle` / `TabsSubtleItem` 导入
3. 删除 props 中的 `value` 和 `onChange`（第 6、9 行），以及 `ListCoverStyle` 类型导入
4. 到调用处（`SettingsPage.tsx` 内搜索 `DisplaySettingsSection`）删掉对应传参
5. `src/lib/display-settings.ts` 中的 `ListCoverStyle` 若无其他引用则一并清理，**若仍被网页端使用则保留**（先全局搜索确认）

**重排后的目标结构**：由于只剩一项，取消独立的"显示"标题层级，把开关直接并入上一个区块的节奏。具体为：

```tsx
<section className="settings-section" aria-labelledby="display-settings-title">
  <div className="settings-section-heading">
    <div><h2 id="display-settings-title">显示</h2></div>
  </div>
  <div className="settings-toggle-row">
    <div>
      <strong>公共站点图标补全</strong>
      <small>站点图标不可用时，向 Google 或 DuckDuckGo 请求非敏感域名。</small>
    </div>
    {/* 开关保持不变 */}
  </div>
</section>
```

副文案从"站点自身图标不可用时，将非敏感域名发送给 Google 或 DuckDuckGo。"精简为上面的写法（去掉"自身"、"发送"改"请求"）。

**验收**：显示模块内只有一行开关；无多余空白；开关行上下间距与其他区块一致。

---

### T-3 设置 · "更多"改造为"最近动作"

**现状**：`src/ui/sidepanel/components/settings/SettingsMoreContent.tsx` 内含三个区块——最近的更改、首次使用引导、隐私与数据自主权（截图 8）。入口标题在 `SettingsPage.tsx:357` 和 `423`。

**目标**：

1. "更多"改名为 **"最近动作"**（比"历史消息"准确：内容是可撤销的书签操作记录，不是消息）
2. 该页只保留"最近的更改"区块
3. "首次使用引导"和"隐私与数据自主权"移到设置主页，各占一行

**改法**：

`SettingsMoreContent.tsx`：删除第 58-100 行（引导 + 隐私两个 section），只保留第 22-56 行。同时删除不再使用的 `onRestartOnboarding`、`onExport` props。

`SettingsPage.tsx`：
- 第 357 行 `{settingsPage === "more" ? "更多" : "设置"}` → `{settingsPage === "more" ? "最近动作" : "设置"}`
- 第 423 行 `<strong>更多</strong>` → `<strong>最近动作</strong>`
- 在该入口行**下方**追加两行同构的导航行：

```tsx
<div className="settings-link-row">
  <strong>首次使用引导</strong>
  <Button variant="ghost" size="sm" type="button" onClick={onRestartOnboarding}>
    重新查看
  </Button>
</div>
<div className="settings-link-row">
  <strong>隐私与数据</strong>
  <Button variant="ghost" size="sm" asChild>
    <a href={chrome.runtime.getURL("privacy.html")} target="_blank" rel="noreferrer">查看</a>
  </Button>
</div>
```

"导出全部本地数据"按钮迁移到隐私页面内部，或作为隐私行的次要操作。**推荐前者**，设置主页每行只留一个操作。

新增样式（`sidepanel.css`）：

```css
.settings-link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-height: var(--control-h-lg);
  padding-block: var(--sp-2);
}
```

**验收**：设置主页出现三行并列入口（最近动作 / 首次使用引导 / 隐私与数据），高度一致；进入"最近动作"页只有撤销列表。

---

### T-4 设置 · AI 服务：Key 显示与编辑态

**现状**（截图 11）：`src/ui/sidepanel/components/settings/AiServiceSection.tsx`
- 第 68-72 行在输入框上方单独显示"已保存 Key：•••• 7e27"
- 第 50-52 行标题右侧还有"已配置"徽标
- 第 77-87 行 API Key 输入框始终可编辑

**重要技术约束**：真实的 API Key **不会下发到前端**，前端只有 `apiKeyConfigured`（布尔）和 `apiKeySuffix`（后 4 位）。因此输入框里只能显示**伪装占位文本**，不可能显示真 key。执行者不要试图去后台取真 key。

**目标交互**：

| 状态 | 输入框 | 按钮 |
|---|---|---|
| 未配置 | 空，可输入，placeholder 为服务商示例 | "验证并保存" |
| 已配置且未进入编辑 | 显示 `••••••••••••7e27`，**只读**，禁用状态样式 | "编辑" |
| 已配置且点了编辑 | 清空、聚焦、可输入 | "验证并保存" |

**改法**：

1. 组件内新增状态 `const [editingKey, setEditingKey] = useState(false);`
2. 删除第 68-72 行整个 `<p className="settings-provider-help">`
3. 删除第 50-52 行的"已配置"徽标（信息已由按钮态表达）
4. 输入框改为：

```tsx
<label className="settings-field">
  <span>API Key</span>
  <FluidInput
    type="password"
    value={showMasked ? `••••••••••••${settings?.apiKeySuffix ?? ""}` : apiKey}
    onChange={(event) => onApiKeyChange(event.target.value)}
    readOnly={showMasked}
    autoComplete="off"
    spellCheck={false}
    placeholder={preset.apiKeyPlaceholder}
    ref={keyInputRef}
  />
</label>
```

其中 `const showMasked = Boolean(configured) && !editingKey;`

5. 按钮区改为：

```tsx
{showMasked ? (
  <Button
    variant="tertiary" size="sm" type="button"
    onClick={() => {
      setEditingKey(true);
      onApiKeyChange("");
      requestAnimationFrame(() => keyInputRef.current?.focus());
    }}
  >
    编辑
  </Button>
) : (
  <Button variant="primary" size="sm" type="submit" disabled={!canSave || Boolean(action)}>
    {action === "save-key" ? "正在验证…" : "验证并保存"}
  </Button>
)}
```

6. 保存成功后 `setEditingKey(false)`；切换服务商时也重置为 `false`
7. 只读态样式：

```css
.settings-field input[readonly] {
  color: var(--ink-muted);
  background: var(--surface-sunken);
  cursor: default;
}
```

**验收**：已保存 Key 时输入框内显示掩码且点击无法输入；点"编辑"后输入框清空并获得焦点，按钮变回"验证并保存"；标题右侧不再有"已配置"徽标。

---

### T-5 编辑收藏：去掉冗余文案与多余空隙

**现状**（截图 5、6 红框）：`src/ui/components/BookmarkEditorFields.tsx`
- 第 203-205 行："摘要由网页内容生成，因此这里保持只读，避免把人工文字误标为 AI 结果。"
- 主标题下方、"AI 分析"标题上下均有过大空隙

**改法**：

1. 删除第 203-205 行整个 `<small>` 元素
2. 收紧间距，在 `src/ui/editor-fields.css` 中调整（若无对应规则则新增）：

```css
.library-card-editor-ai {
  margin-block-start: var(--sp-4);   /* 原先更大 */
}

.library-card-editor-ai-heading {
  margin-block-end: var(--sp-2);
}

.library-card-editor-ai > div > p {
  margin: 0;
}
```

3. 对话框主标题下方的说明文字"Chrome 保存名称、网址和文件夹；Aarre 保存备注与自定义标签。"（截图 6 顶部）一并删除——这是典型的解释性废话，用户已明确要求精简这类内容。位置在 `BookmarkEditorDialog.tsx` 中搜索"Chrome 保存名称"。

**验收**：AI 分析区块下方无灰色说明；标题与正文间距紧凑；对话框顶部无副标题说明。

---

### T-6 "添加到收藏"：支持新建文件夹 + 去掉自动摘要提示

**现状**（截图 12）：`src/ui/sidepanel/components/BookmarkEditorDialog.tsx`
- 第 216-221 行有"自动生成摘要"勾选行
- 第 222 行 `captureWarning` 提示（"此页面受 Chrome 保护…"）
- 文件夹下拉（第 192 行 `FolderSelect`）没有新建入口

**改法 A：删除多余提示**

删除第 216-221 行整个 `.native-check` 块。摘要本就是自动生成，无需告知。

第 222 行的 `captureWarning` **保留**——它承载的是"此页受保护，无法读取正文"这类真实约束信息，不是废话。但仅在真正受限时才渲染（现有逻辑已如此）。

**改法 B：新建文件夹能力**

后端能力**已经具备**，无需新增：消息类型 `CREATE_NATIVE_FOLDER`，参数 `{ parentId: string; title: string }`，返回 `NativeBookmarkNode`（见 `src/lib/messages.ts:137-139`、`241`）。

在 `src/ui/sidepanel/components/FolderSelect.tsx` 的下拉面板底部追加固定项：

1. 选项列表末尾加一个 `＋ 新建文件夹` 行（与普通选项同高，图标用 `+`）
2. 点击后该行原地变成输入框（inline 编辑，不弹二级对话框），placeholder "文件夹名称"
3. 回车或点确认 → 调用：

```ts
const created = await sendExtensionRequest({
  type: "CREATE_NATIVE_FOLDER",
  payload: { parentId: currentParentId, title: name.trim() },
});
```

4. `parentId` 取当前选中项的 id；若当前选中的是"根目录"则取根 id
5. 成功后：刷新 `options`（重新请求 `GET_FOLDERS`）→ `onChange(created.id)` 选中新文件夹 → 关闭下拉
6. 失败（重名、无权限）→ 输入框下方显示红色错误文字，不关闭

**边界处理**：空名称禁用确认按钮；名称去首尾空格；长度上限 100 字符。

**验收**：下拉底部有"新建文件夹"入口；输入名称回车后文件夹被创建、自动选中、下拉关闭；在 Chrome 书签管理器中能看到新文件夹；"自动生成摘要"勾选行消失。

---

### T-7 侧边栏搜索框：去掉回车角标

**现状**：`src/ui/sidepanel/components/SearchBar.tsx:52-54`

```tsx
) : (
  <kbd>↵</kbd>
)}
```

**改法**：删除 `: (<kbd>↵</kbd>)` 分支，即把三元表达式改为：

```tsx
{query ? (
  <Button /* 清空按钮，原样保留 */ />
) : null}
```

同时清理 `sidepanel.css` 中该 `kbd` 的样式规则（搜索 `.search-` 相关的 `kbd` 选择器）。

**验收**：搜索框右侧在无输入时为空白，有输入时显示清空按钮；输入框内边距不因移除而失衡（右侧 padding 需保持，避免文字贴边）。

---

### T-8 Toast 重做：暗色半透明 + 自动消失

**现状**：`src/ui/sidepanel/pages/HomePage.tsx:106-113` 渲染 `.native-notice`，样式在 `src/ui/sidepanel.css:329-349`——白底、绝对定位在**顶部**、必须手动点 × 关闭。

**目标**：暗色半透明、浮在 AI 输入框上方、2 秒自动消失、无关闭按钮。

**我必须提出的一个修正**：错误信息不应该 2 秒就消失。同步失败、保存失败这类信息用户需要时间阅读，甚至需要据此操作。建议区分：

| 类型 | 停留时长 | 关闭按钮 |
|---|---|---|
| 普通提示（notice） | 2 秒自动消失 | 无 |
| 错误（error） | 6 秒自动消失 | 保留 × |

以下方案按此实现。若坚持全部 2 秒，把 error 分支的时长改成 2000 即可，其余不变。

**改法 1：自动消失逻辑**

在 `HomePage.tsx` 中，`status.notice` 变化时启动定时器：

```tsx
useEffect(() => {
  if (!status.notice) return;
  const timer = window.setTimeout(status.onDismissNotice, 2_000);
  return () => window.clearTimeout(timer);
}, [status.notice, status.onDismissNotice]);
```

对 `status.error` 用同样写法，时长 `6_000`。

**关键**：`onDismissNotice` 必须是稳定引用（`useCallback` 包裹），否则每次渲染都会重置定时器导致永不消失。执行者需到其定义处确认，未包裹则补上。

**改法 2：移除关闭按钮**

删除 `HomePage.tsx:109-111` 的 `<Button>` 及其 `CloseIcon`（仅 notice 分支；error 分支的保留）。

**改法 3：位置与样式**

`.native-notice` 需要定位到 AI 输入框上方。AI 输入框组件为 `AgentComposer`，位于侧边栏底部。将 notice 移出滚动区，作为底部固定层的兄弟节点，然后：

```css
.native-notice {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--composer-height, 64px) + var(--sp-3));
  top: auto;                                  /* 覆盖原来的 top */
  z-index: 20;
  width: max-content;
  max-width: calc(100% - var(--sp-6) * 2);
  padding: var(--sp-2) var(--sp-4);
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, #000 78%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #fff;
  font-size: var(--fs-caption);
  line-height: 1.45;
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  animation: toast-in var(--dur-base) var(--ease) both;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(6px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
```

暗色在浅色和深色主题下都用同一套（暗色 toast 是跨主题通用做法，不需要做主题适配）。

**注意**：这里的 `backdrop-filter` 能生效，因为 toast 的祖先没有 mask（与 R2 不同）。若实测仍不生效，去掉 blur、把背景改为 `rgb(0 0 0 / 88%)` 实色即可，不要为此改动祖先结构。

**验收**：触发提示（例如在 chrome:// 页面点添加收藏）→ 深色胶囊出现在 AI 输入框正上方 → 约 2 秒后自动淡出 → 无关闭按钮；错误提示停留 6 秒且带关闭按钮。

---

## 第五部分：执行顺序与优先级

| 顺序 | 任务 | 理由 |
|---|---|---|
| 1 | R1 下拉透明 | 一行配置，影响所有弹层，收益最大 |
| 2 | R3 历史丢答案 | 正在持续丢数据，越晚修丢得越多 |
| 3 | R2 吸顶半透明 | 视觉硬伤，方案已定 |
| 4 | 第三部分 Agent 内联引用 | 体验重构，工作量最大 |
| 5 | T-1 ~ T-8 | 可并行，互不冲突 |

**每完成一项都必须执行**：

```bash
npx tsc --noEmit && npm test && npm run build
```

三者全绿才算完成。当前基线：78 个测试文件 / 416 个用例全通过，不允许下降。

---

## 第六部分：需要向用户说明的两点

1. **已损坏的历史会话无法恢复**。R3 的空答案已经覆盖了本地和云端两份数据，修复只能防止今后再发生。8/4 那三条会话的答案永久丢失。

2. **毛玻璃与滚动渐隐无法共存**（R2）。吸顶条要清晰就不能被顶部渐隐覆盖，两者在同一位置互斥。方案 A 保留渐隐、吸顶条用实色；方案 B 做出毛玻璃、牺牲顶部渐隐并承担滚动性能损耗。推荐方案 A。
