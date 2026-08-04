# Aarre 重构 PRD（执行版）

版本：v1.1　日期：2026-08-04　基线：工作区 0.5.62 / 服务端 0.1.12

**本文档中的每一个任务都是待办。** 从 T-06 开始按编号顺序执行。同步链路的根因修复（原 T-01 ~ T-05）已于 2026-08-04 完成并从本文档移除，不要去找、不要重做。

---

## 阅读须知（所有执行 Agent 必读）

### 开工前必须了解的现状

同步链路刚做过一轮根因修复，下面这些是**已经生效的现状**，不是待办。改动涉及的文件你在后续任务里会碰到，改错会把它们打回原形：

1. **`bookmarkItemId` 由 `resourceKey + 规范化文件夹路径` 派生**（`src/lib/cloud-state.ts` 的 `bookmarkItemIdFor`），跨设备一致。**禁止改回用 Chrome 本地书签 ID 派生**——Chrome Sync 不同步本地 ID，那样会让两台设备互删对方记录。
2. **冲突裁决是字段级的，不是整条记录级的。** 核心在 `src/lib/field-clocks.ts`：
   - `deriveFieldClocks` 挂在 `upsertLocalResource` 内部自动派生，只为真正变化的字段推进时钟。**新增可同步字段时，必须同时加进 `SYNCED_FIELDS`**，否则该字段会退回记录级裁决。
   - `mergeResourceByFieldClocks` 的三条规则：云端空值不覆盖本地、`coverOrigin: "user"` 的封面优先于 `"auto"`、其余按字段时钟。
   - `mergeLocalResources` 会在合并后重算 `aiStatus`。**不要删这行**：`aiStatus` 不参与同步而合并以本地为基底，漏掉重算会让收到云端摘要的设备重复调用 AI，产生真实费用。
3. **`assetId` 代表「某资源的某类图」这一槽位，不含内容哈希。** 服务端对同槽位换内容不再报 409，改为把旧对象延迟 1 小时排入回收队列。**禁止把内容哈希编回 assetId**。
4. **图片是否需要下载按内容哈希判断**（`coverContentHash` 对比云端 `sha256`），不看时间戳。定时同步上传和下载都做。
5. **`ResourceRecord` 新增字段：** `fieldUpdatedAt`、`coverOrigin`、`coverContentHash`。服务端 `resourcePayloadSchema` 与资产 `binding` schema 已相应放行。
6. **同步范围恒为完整备份**，没有选项，`getCloudSyncSettings` 会把旧值强制迁移为 `complete`。不要重新引入范围选择。

相关测试在 `src/lib/field-clocks.test.ts` 和 `src/lib/cross-device-sync.test.ts`（共 23 项）。**这两个文件的测试不允许改成通过，它们描述的是正确行为**；如果你的改动让它们失败，是你的改动错了。

### 你必须遵守的纪律

1. **严格按任务编号顺序执行。** 任务之间有依赖，跳着做会失败。
2. **一次只做一个任务。** 做完一个，跑通验收，提交，再做下一个。
3. **不要自由发挥。** 本文档给出的代码是可以直接抄的。如果你觉得有更好的写法，先在 `AGENT_PROGRESS.md` 里写下你的理由，**不要直接改**。
4. **不要降级需求。** 如果某个任务你做不到，写清楚卡在哪，不要用 mock、假数据、TODO 注释蒙混过关。
5. **每个任务完成后必须运行：**
   ```bash
   npm run typecheck && npm run test
   ```
   全绿才算完成。任务里额外要求的测试也必须写。
6. **每完成一个任务，更新 `AGENT_PROGRESS.md`**，写清楚：改了什么、验证了什么、还有什么没做。
7. **禁止 `git reset`、`git checkout --force`、删除 `dist/`、删除 `/opt/aarre` 发布目录。**
8. **禁止修改 `server/migrations/` 里已存在的 SQL 文件。** 需要改表结构就新增 `009_xxx.sql`。

### 标记说明

- 🔴 **必须由高能力模型执行**（Opus / GPT-5 级别）。低能力模型请跳过并报告。
- 🟢 可由任意 agent 执行，本文档已给出可抄的代码。
- ⚠️ 有数据丢失风险，执行前必须先备份。

### 名词对照

| 名词 | 含义 |
|---|---|
| resourceKey | `SHA-256(规范化URL)`，一个网址的全局唯一标识，跨设备一致 |
| bookmarkItemId | 「收藏位置」的云端 ID，由 `resourceKey + 文件夹路径` 派生 |
| assetId | 图片资产的云端 ID，代表「某资源的某类图」这一槽位，与内容无关 |
| 字段时钟 | `ResourceRecord.fieldUpdatedAt`，记录每个字段最后一次真正变化的时间 |
| Outbox | 待同步队列，存在 IndexedDB 的 `outbox` store |
| SW | Service Worker，即 `src/extension/background.ts` |

---

# 阶段 P1：拆分巨型文件

> **目标：让代码可被理解和并行修改。** 不做这一步，后面每个任务都会互相踩踏。
> **预计：2–3 天。** 🔴 **建议由高能力模型执行。**

---

## T-06 🔴 拆分 `src/extension/background.ts`（9184 行）

### 目标结构

```
src/extension/
├── background.ts              ← 只保留：import、监听器注册、消息路由分发。目标 < 400 行
├── handlers/
│   ├── index.ts               ← 消息路由表：Record<MessageType, Handler>
│   ├── bookmarks.ts           ← 书签 CRUD、导入、树读取
│   ├── resources.ts           ← 本地资源读写、增强队列
│   ├── snapshots.ts           ← 截图、补拍任务、debugger 路径
│   ├── site-icons.ts          ← 图标扫描
│   ├── cloud.ts               ← 同步相关消息
│   ├── agent.ts               ← AI 对话
│   └── settings.ts            ← 设置、保护规则
├── lifecycle/
│   ├── alarms.ts              ← 所有 alarm 注册与调度
│   ├── install.ts             ← onInstalled / onStartup
│   └── context-menus.ts       ← 右键菜单
└── coordinators/
    ├── page-coordinator.ts    ← tabs/webNavigation 监听与页面协调
    └── enhancement-queue.ts   ← 书签增强任务队列
```

### 拆分规则（严格遵守）

1. **一次只搬一个模块。** 搬完跑 `npm run typecheck && npm run test`，绿了再搬下一个。
2. **搬运时不改任何逻辑。** 只做移动 + 补 import/export。逻辑优化留到后面的任务。
3. **模块级共享变量**（比如 `activeAgentRuns`、各种 Map 缓存）统一提取到 `src/extension/state.ts`，其他模块 import 使用。**不要在多个文件里各自声明。**
4. **所有 `chrome.*.addListener` 调用必须留在 `background.ts` 顶层**，或者由 `background.ts` 显式调用的注册函数里。MV3 要求监听器在 SW 启动的同步阶段就注册完，放到异步路径里会丢事件。
5. 消息路由改成表驱动：

```ts
// src/extension/handlers/index.ts
type Handler = (request: any, sender: chrome.runtime.MessageSender) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  GET_APP_STATE: getAppState,
  GET_LOCAL_RESOURCES: getLocalResources,
  // ...
};
```

```ts
// background.ts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request?.type];
  if (!handler) return false;
  void handler(request, sender).then(sendResponse).catch((error) => {
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
```

### 拆分顺序（按依赖从少到多）

1. `lifecycle/context-menus.ts`（最独立）
2. `lifecycle/alarms.ts`
3. `handlers/settings.ts`
4. `handlers/site-icons.ts`
5. `handlers/snapshots.ts`
6. `handlers/agent.ts`
7. `handlers/cloud.ts`
8. `handlers/bookmarks.ts`
9. `handlers/resources.ts`
10. `coordinators/*`
11. `lifecycle/install.ts`
12. 最后收敛 `background.ts` 本体

### 验收标准

1. 每一步之后 `npm run typecheck && npm run test` 都全绿。
2. `background.ts` 最终行数 < 400。
3. 没有任何单个文件超过 800 行。
4. `npm run build` 成功，`dist/background.js` 体积变化不超过 ±5%。
5. 手动验证清单（在真实 Chrome 里加载 dist）：
   - 侧边栏能打开并显示书签
   - 右键菜单出现且可点击
   - 保存一个书签成功
   - 删除一个书签成功
   - 登录状态保持

### 禁止事项

- ❌ 不要在拆分过程中"顺手优化"任何逻辑
- ❌ 不要把 `addListener` 放进 `async` 函数或 `.then()` 回调里
- ❌ 不要产生循环 import（用 `state.ts` 打破环）

---

## T-07 🔴 拆分 `src/ui/sidepanel/SidePanelApp.tsx`（5479 行）

### 目标结构

```
src/ui/sidepanel/
├── SidePanelApp.tsx           ← 路由 + 全局状态。目标 < 400 行
├── pages/
│   ├── HomePage.tsx           ← 书签列表主界面
│   ├── SettingsPage.tsx       ← 设置（lazy）
│   ├── AgentChatPage.tsx      ← AI 对话（lazy）
│   ├── AgentHistoryPage.tsx   ← 会话历史（lazy）
│   └── OnboardingPage.tsx     ← 首次引导（lazy）
├── components/
│   ├── BookmarkTree.tsx
│   ├── SearchBar.tsx
│   ├── AgentComposer.tsx
│   ├── AgentThinkingSteps.tsx
│   ├── AgentMarkdown.tsx
│   └── CloudStatusRow.tsx     ← 新的同步状态行（T-10）
└── hooks/
    ├── use-app-state.ts
    ├── use-bookmarks.ts
    └── use-sync-status.ts
```

### 关键要求

**Settings / AgentChat / AgentHistory / Onboarding 必须用 `React.lazy`：**

```tsx
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AgentChatPage = lazy(() => import("./pages/AgentChatPage"));
const AgentHistoryPage = lazy(() => import("./pages/AgentHistoryPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
```

`Suspense` 的 fallback **不要放 loading 动画**，放 `null` 或一个和最终布局同高的空容器。（用户明确要求不要 loading 图）

`react-markdown` 和 `remark-gfm` 只能在 `AgentChatPage.tsx` 里 import，**不能出现在任何非 lazy 的文件里**。

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. `npm run build` 后，`dist/assets/sidepanel-*.js` 的体积 **≤ 150 KB**（当前 233 KB）。
3. 产物里出现独立的 settings / agent chunk。
4. 没有任何单个文件超过 500 行。
5. 手动验证：切到设置页、切到 AI 对话页、返回首页，都正常。

---

# 阶段 P2：同步引擎重写

> 依赖：P0、P1 完成。
> **预计：3–4 天。**

---

## T-08 🔴 建立统一同步引擎

### 目标

把散落在 `background.ts` 各处的同步触发逻辑收敛成一个状态机。

### 新建 `src/lib/sync-engine.ts`

```ts
export type SyncPhase =
  | "idle"          // 空闲，已同步
  | "pulling"       // 拉取云端变更
  | "pushing"       // 推送本地变更
  | "assets-up"     // 上传图片
  | "assets-down"   // 下载图片
  | "error"         // 上次失败，等待重试
  | "paused";       // 账号不匹配 / 未登录

export interface SyncStatus {
  phase: SyncPhase;
  /** 当前阶段的进度。total 为 0 表示不适用。 */
  current: number;
  total: number;
  /** 上次成功完成同步的时间。 */
  lastSyncedAt: string | null;
  /** 失败时的用户可读信息。 */
  error: string | null;
  /** 失败时的下次重试时间。 */
  nextRetryAt: string | null;
}
```

### 核心约束

1. **同一时刻只允许一个同步在跑。** 用模块级的 `let running: Promise<void> | null` 做互斥。重入时直接返回正在跑的那个 Promise。
2. **同步是一个完整循环**，顺序固定：
   ```
   pull 资源变更 → pull 实体变更 → push Outbox → push 实体 → 上传图片 → 下载图片
   ```
3. **每个阶段结束都写一次状态**，通过两个通道广播：
   - `chrome.storage.local` 的 `aarre:sync-status:v1`（持久，UI 挂载时读）
   - `chrome.runtime.sendMessage({ type: "SYNC_STATUS", status })`（实时，UI 订阅）
4. **失败用指数退避**：30s → 1min → 2min → 5min → 15min，上限 15 分钟。不要用现在的 6 小时。
5. **触发时机**：
   | 场景 | 行为 |
   |---|---|
   | 登录成功 | 立即完整同步 |
   | 本地数据变更 | debounce 3 秒后同步 |
   | 定时 alarm | 每 1 分钟检查一次（现在是 5 分钟） |
   | 浏览器启动 | 立即完整同步 |
   | 网络恢复（`navigator.onLine`） | 立即同步 |
   | 侧边栏/网页端打开 | 触发一次（但不阻塞 UI） |

6. **删除"停止同步"的概念。** 登录 = 同步，只保留"断开账号"。**不要重新引入同步范围选择**——范围已恒为完整备份，`getCloudSyncSettings` 会把旧值强制迁移为 `complete`，UI 上不该再出现这个选项。

### 需要删除的旧代码

- `src/extension/background.ts` 里的 `syncNow`、`syncPendingIfReady`、`drainOutbox`、`syncAfterExplicitCloudSettings` 全部合并进 sync-engine
- `src/lib/cloud-progress.ts` 整个文件删除，被 `SyncStatus` 取代
- `cloudSettings.enabled` 这个开关删除（保留字段兼容旧数据，但代码里不再读）

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 新增 `tests/sync-engine.test.ts`：
   - 并发调用 5 次 `sync()`，只执行一次
   - 失败后按退避时间重试，不会立即重试
   - 每个阶段都写入了状态
   - 未登录时 phase 为 `paused` 且不发任何请求
3. 手动验证：登录后无需任何操作，同步自动开始并完成。

---

## T-09 🟢 实现删除墓碑（tombstone）

### 问题定位

- `src/lib/cloud.ts:236` — 上传时永远 `deleted: false`
- `src/lib/cloud.ts:302` — 拉取时跳过所有 deleted 的变更

> 行号仅供定位，以实际代码为准（同步链路刚改过，行号可能再次偏移）。用 `rg -n "deleted: false" src/lib/cloud.ts` 确认。

### 具体改法

#### 上传侧

在 `ResourceRecord` 上新增字段（`src/lib/types.ts`）：

```ts
  /** 本地已删除，等待推送墓碑到云端。 */
  deletedAt?: string;
```

`src/lib/cloud.ts` 的 `syncOneResource`，把 `deleted: false` 改成：

```ts
        deleted: Boolean(resource.deletedAt)
```

#### 删除侧

`background.ts` 的 `handleRemovedNativeBookmark`（约第 9051–9094 行）：当一个 resource 的 `nativeBookmarkIds` 变空时，除了现有逻辑，还要：

```ts
  if (!next.nativeBookmarkIds.length) {
    const tombstoned = {
      ...next,
      deletedAt: new Date().toISOString(),
      syncStatus: "pending" as const
    };
    await upsertLocalResource(tombstoned);
    await enqueueOutbox(tombstoned);
    void syncEngine.requestSync("bookmark-removed");
  }
```

#### 拉取侧

`src/lib/cloud.ts` 里 `pullIncrementalCloudResources` 的 `for (const change of page.changes)` 循环（约 298-315 行）改成：

> 该循环现在会把云端的 `fieldUpdatedAt` 透传给 `responseToLocal`，用于字段级合并。**改写时必须保留这个透传**，否则冲突裁决会退回整条记录级，两台设备互相覆盖。

```ts
    for (const change of page.changes) {
      if (change.entityType !== "resource") continue;
      revisions[change.entityId] = change.revision;
      if (change.deleted) {
        // 另一台设备删除了这条收藏，本地也要删除。
        // 只删除 Aarre 的智能层数据，不动 Chrome 原生书签
        // ——Chrome 书签由 Chrome Sync 自己同步。
        await removeLocalResource(change.entityId);
        continue;
      }
      if (!change.payload) continue;
      // ... 现有的 merge 逻辑
    }
```

**重要边界：** 云端删除信号只清理 Aarre 的本地资源记录（摘要、标签、封面），**绝不调用 `chrome.bookmarks.remove()`**。Chrome 原生书签的删除由 Chrome Sync 负责。这是项目的核心数据边界，不能破。

#### 墓碑清理

本地 resource 的 `deletedAt` 在成功推送后就可以物理删除。在 `completeOutboxItem` 成功路径里加：

```ts
  if (resource.deletedAt) {
    await removeLocalResource(resource.resourceKey);
  }
```

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 新增测试 `tests/cloud-deletion.test.ts`：
   - 本地删除最后一个书签位置 → resource 被标记 `deletedAt` 且进入 Outbox
   - 推送 payload 里 `deleted === true`
   - 拉取到 `deleted` 变更 → 本地 resource 被移除
   - 拉取到 `deleted` 变更 → **不会**调用 `chrome.bookmarks.remove`（用 spy 断言）
3. 双设备测试补充一条：A 删除 → B 同步后本地也没有该 resource。

---

## T-10 🟢 重做同步的 UI 呈现

### 设计目标

日常状态**只占一行**。用户不需要知道配额、不需要按钮、不需要进度条。

### 具体设计

在设置页 Google 账号区块下方，用一行文本 + 一个状态点：

```
● 已同步 · 2 分钟前
◐ 正在同步 · 12/48
◐ 正在下载封面 · 3/20
▲ 同步失败 · 网络超时（45 秒后重试）
○ 未登录
```

状态点颜色：
- `●` 绿（`--positive`）：idle 且 lastSyncedAt 存在
- `◐` 蓝（`--accent`）：任何进行中阶段，加一个缓慢脉冲动画
- `▲` 红（`--negative`）：error
- `○` 灰（`--ink-faint`）：paused / 未登录

**点击这一行**展开详情面板（默认收起），里面才显示：
- 分项进度（收藏 / 封面 / 站点标识）
- 最近一次错误的完整信息
- 云端用量（仅当 > 80% 时显示，否则不显示）
- 同步范围选择（仅文字 / 完整备份）
- 「立即同步」按钮（只在 error 或 idle 时可点）
- 「断开账号」（红色文字链接，不是按钮）

### 需要删除的 UI

`src/ui/sidepanel/SidePanelApp.tsx`（拆分后在 `pages/SettingsPage.tsx`）：

| 行号（拆分前） | 内容 | 操作 |
|---|---|---|
| 1118–1131 | `<progress>` 进度条 | 删除 |
| 1133–1137 | `云端容量：X / Y` | 移入详情面板，且加 80% 条件 |
| 1139–1161 | 开启/关闭/暂停同步按钮 | 删除 |
| 142–166 | `cloudSyncProgressLabel` | 重写为新状态文案 |

### 新组件

新建 `src/ui/sidepanel/components/CloudStatusRow.tsx`：

```tsx
export function CloudStatusRow({ status }: { status: SyncStatus }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="cloud-status">
      <button
        type="button"
        className="cloud-status-row"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="cloud-status-dot" data-phase={status.phase} />
        <span className="cloud-status-text">{statusText(status)}</span>
      </button>
      {expanded ? <CloudStatusDetail status={status} /> : null}
    </div>
  );
}
```

文案函数：

```ts
function statusText(status: SyncStatus): string {
  switch (status.phase) {
    case "paused":
      return "未登录";
    case "error":
      return `同步失败 · ${status.error}${
        status.nextRetryAt ? `（${relativeTime(status.nextRetryAt)}后重试）` : ""
      }`;
    case "pulling":
    case "pushing":
      return status.total
        ? `正在同步 · ${status.current}/${status.total}`
        : "正在同步";
    case "assets-up":
      return `正在上传封面 · ${status.current}/${status.total}`;
    case "assets-down":
      return `正在下载封面 · ${status.current}/${status.total}`;
    case "idle":
    default:
      return status.lastSyncedAt
        ? `已同步 · ${relativeTime(status.lastSyncedAt)}`
        : "等待同步";
  }
}
```

### 实时更新

用一个 hook 订阅：

```ts
// src/ui/sidepanel/hooks/use-sync-status.ts
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    void readSyncStatus().then(setStatus);
    const listener = (message: unknown) => {
      if ((message as { type?: string })?.type === "SYNC_STATUS") {
        setStatus((message as { status: SyncStatus }).status);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  return status;
}
```

**不要用轮询。** 当前代码每秒刷新一次，改成消息推送。

### 验收标准

1. `npm run typecheck && npm run test && npm run check:design` 全绿。
2. 设置页默认状态下，云端区块只有：头像 + 名字 + 一行状态。**不超过 3 个视觉元素。**
3. 展开后才出现详情。
4. 同步中时状态文字每次进度变化都实时更新（不靠轮询）。
5. 用量 < 80% 时界面上**看不到任何配额数字**。

---

# 阶段 P3：视觉资产统一

> 依赖：P2 完成。
> **预计：3–4 天。**

---

## T-11 🔴 建立统一的 `visuals` store

### 目标

把现在分散的 5 套图片状态合并成 1 套。

### 数据结构

在 `src/lib/types.ts` 新增：

```ts
export interface VisualAsset {
  /** 主键："site-icon:<host>" | "cover:<resourceKey>" */
  key: string;
  kind: "site-icon" | "cover";
  /** host 或 resourceKey */
  identity: string;
  /** 二进制。禁止再用 dataURL 存储。 */
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  /** user = 用户手动设置，任何自动逻辑都不得覆盖。 */
  origin: "user" | "auto";
  /** 来源标记，用于诊断："apple-touch-icon" | "screenshot" | "user-image" | "og-image" | "s2" ... */
  source: string;
  /** 内容 SHA-256，用于云端对账。 */
  contentHash: string;
  updatedAt: string;
  renderVersion: number;
}
```

### IndexedDB 迁移

`src/lib/storage.ts` 数据库版本 4 → 5，新增 `visuals` store（keyPath `key`，索引 `kind`、`identity`）。

**迁移逻辑（在 `upgrade` 回调里）：**

```ts
if (oldVersion < 5) {
  const visuals = db.createObjectStore("visuals", { keyPath: "key" });
  visuals.createIndex("kind", "kind");
  visuals.createIndex("identity", "identity");
  // 旧数据的搬迁在 SW 启动后异步进行，不在 upgrade 里做
  // （upgrade 里做重活会阻塞所有 IDB 操作）
}
```

**搬迁任务**放在一个独立的 alarm handler 里，分批执行：
- `siteBrands[host].iconDataUrlLight` → `visuals["site-icon:<host>"]`，`origin: "auto"`
- `pageSnapshots[canonicalUrl].imageDataUrl` → `visuals["cover:<resourceKey>"]`，`origin` 取对应 `resource.coverOrigin`，缺省 `"auto"`
- `resource.thumbnailDataUrl` → 只在没有对应 snapshot 时才搬，`origin` 取 `resource.coverOrigin`，缺省 `"auto"`

> ⚠️ **不要把封面一律搬成 `origin: "auto"`。** `ResourceRecord.coverOrigin` 已经记录了封面是用户手动指定的还是自动采集的，同步链路靠它保护用户封面不被自动封面覆盖。搬迁时丢掉这个标记，等于把用户设过的封面降级，下一轮同步就可能被自动封面顶掉。
>
> 同理，`contentHash` 优先继承已有的 `resource.coverContentHash`，只有缺失时才重新计算——它是同步端判断图片是否需要下载的依据。

dataURL → Blob 用：

```ts
function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/webp";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}
```

**搬迁完成后不要立即删除旧 store**，保留一个版本作为回滚保险，在下一版才删。

### 读取接口

新增批量接口，`src/extension/handlers/visuals.ts`：

```ts
// 消息：GET_VISUALS { keys: string[] }
// 返回：Record<string, { blob: Blob; mime: string; width: number; height: number }>
```

> ⚠️ **更正（2026-08-04）：Blob 不能通过 `chrome.runtime.sendMessage` 传递。** 本文档早前写"结构化克隆支持 Blob"是错的——扩展消息通道走的是 JSON 序列化，Blob 会被降级成空对象 `{}`，而且不会报错，只会在渲染时静默变成坏图。
>
> 正确做法：**扩展页面直接读同源 IndexedDB，不过消息通道。** `sidepanel.html` 和 `manager.html` 与 Service Worker 同源，可以自己开库把 `Blob` 读出来再 `URL.createObjectURL()`，既避开序列化限制，又省掉一次进程间往返，比经消息通道更快。
>
> 只有在确实需要经过 SW 的场景下，才退回传 dataURL 字符串。

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 新增 `tests/visuals-store.test.ts`：读写、按 kind 查询、dataURL 转 Blob 正确性。
3. 迁移测试：构造一批旧格式数据，跑迁移，断言全部出现在 `visuals` 里且内容一致。
4. 迁移是幂等的（跑两次结果一样）。

---

## T-12 🟢 用户自定义封面永不丢失

### 问题

标记机制已经建立，但**保护是分散的**：目前有三处各自判断（字段级合并、云端资产恢复、扫描路径），任何新增的写封面路径都可能绕过它们。本任务要把它收敛成一道统一守卫，并补齐尚未覆盖的写入路径。

**已完成（不要重做）：**
- `ResourceRecord.coverOrigin: "user" | "auto"` 与 `coverContentHash` 已存在。
- 右键图片/GIF 设封面已写 `coverOrigin: "user"` 并记录内容哈希。
- 自动扫描路径已写 `coverOrigin: "auto"`，且遇到 `coverOrigin === "user"` 会整体跳过封面更新。
- 云端 binding 已带 `coverOrigin`，恢复时用户封面不被自动封面覆盖。

### 具体改法

#### 写入侧

搬进 `visuals` store 后，`origin` 由 `ResourceRecord.coverOrigin` 继承而来，不要重新推断。仍需补齐的路径：

1. 右键「更新封面」（`handleContextMenuUpdateSnapshot`）→ 用户主动要求重拍，写 `origin: "user"`。**当前这条路径没有标记，是已知缺口。**
2. 批量补拍任务 → 写 `origin: "auto"`，且遇到已有 `origin: "user"` 的封面必须跳过。**当前也没有保护。**
3. 自动路径（`schedulePageSnapshotForTab` 的非 manual trigger）→ `origin: "auto"`。

#### 保护侧

在**所有**会写 cover 的地方加统一守卫。新建 `src/lib/visuals.ts`：

```ts
/**
 * 写入视觉资产。自动来源永远不能覆盖用户手动设置的资产。
 * 这是"用户封面丢失"的唯一防线，任何写入路径都必须经过这里。
 */
export async function putVisual(
  next: VisualAsset,
  options: { force?: boolean } = {}
): Promise<boolean> {
  const existing = await getVisual(next.key);
  if (
    existing &&
    existing.origin === "user" &&
    next.origin === "auto" &&
    !options.force
  ) {
    return false;
  }
  await writeVisual(next);
  return true;
}
```

**所有写封面的代码必须改成调用 `putVisual`，禁止直接写 store。**

需要改的调用点（拆分后按新文件找）：
- 自动截图完成后的写入
- 批量补拍的写入
- 云端资产恢复（`restoreCloudAssets`）
- 扫描时的代表图缓存

#### 云端同步

**这部分已经生效，不要重做，也不要改字段名。** 云端 binding 里的字段叫 `coverOrigin`（不是 `origin`），服务端 `assetUploadSchema` 只放行了这个名字，改名会被 `.strict()` 拒绝：

```ts
binding: {
  canonicalUrl: resource.canonicalUrl,
  ...(resource.coverOrigin ? { coverOrigin: resource.coverOrigin } : {})
}
```

下载端已实现：远端是 `auto` 而本地是 `user` 时跳过；是否需要下载按内容哈希判断，**不要改回按时间戳比较**（上传方长期不带 `capturedAt`，时间比较会让下载被永远跳过，这是刚修掉的 bug）。

搬进 `visuals` store 后，把这段判断的数据源从 `ResourceRecord` 换成 `VisualAsset`，语义保持不变。

#### 去掉危险的清理任务

`background.ts:7977-7989` 的"同图多网址快照清理"每次 SW 启动都跑，且会整组删除。改成：
- 移到每日 alarm
- 只删 `origin === "auto"` 的
- 每组保留最新的一条，不是全删

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 新增 `tests/visual-origin.test.ts`：
   - 已有 `origin: "user"` 时，写入 `origin: "auto"` 返回 false 且不改变存储
   - `force: true` 时可以覆盖
   - 用户写用户可以覆盖
3. 手动验证：右键设一张封面 → 重新访问该页面（触发自动截图）→ 封面**不变**。

---

## T-13 🟢 加速网页端瀑布流

### 问题定位

`src/ui/manager/components/LibraryCardCover.tsx:124-168`

三个问题：每张卡片一次消息往返、传 dataURL、滚出视口就清空。

### 具体改法

#### 改法 1：批量请求

在 `LibraryView` 层面收集可见卡片的 key，批量请求：

```tsx
// LibraryView.tsx
const [visualCache, setVisualCache] = useState<Map<string, string>>(new Map());
const pendingKeys = useRef<Set<string>>(new Set());

const requestVisual = useCallback((key: string) => {
  pendingKeys.current.add(key);
  scheduleFlush();
}, []);

// 用 requestIdleCallback 或 16ms debounce 批量发送
const flush = async () => {
  const keys = [...pendingKeys.current];
  pendingKeys.current.clear();
  if (!keys.length) return;
  const result = await sendExtensionRequest({ type: "GET_VISUALS", keys });
  setVisualCache((prev) => {
    const next = new Map(prev);
    for (const [key, visual] of Object.entries(result)) {
      next.set(key, URL.createObjectURL(visual.blob));
    }
    return next;
  });
};
```

#### 改法 2：objectURL 而非 dataURL

`URL.createObjectURL(blob)` 生成的 URL 是零拷贝引用，`<img src>` 用它解码走浏览器原生路径，不占主线程。

**必须管理生命周期**：用一个 LRU（上限 200 张），淘汰时调 `URL.revokeObjectURL()`。写一个小工具：

```ts
// src/ui/manager/visual-url-cache.ts
const MAX_ENTRIES = 200;
const cache = new Map<string, string>();

export function objectUrlFor(key: string, blob: Blob): string {
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const url = URL.createObjectURL(blob);
  cache.set(key, url);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string;
    URL.revokeObjectURL(cache.get(oldest)!);
    cache.delete(oldest);
  }
  return url;
}
```

#### 改法 3：滚出视口不清空

删掉 `LibraryCardCover.tsx:138-143` 里 `!nearViewport` 时 `setSnapshotImageUrl("")` 的逻辑。由 LRU 统一控制内存。

#### 改法 4：解码提示

给 `<img>` 加 `decoding="async"`，配合已有的 `loading="lazy"`。

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 手动测量（在真实 Chrome 里，收藏库至少 100 条）：
   - 首屏封面出现时间 **< 500ms**（当前需要数秒）
   - 快速滚动 5 屏再滚回来，封面**不闪烁**、不重新加载
   - DevTools Memory 面板：滚动 20 屏后 JS 堆内存不持续增长（证明 revoke 生效）
3. 消息数量：打开收藏库时 `GET_VISUALS` 的调用次数 **≤ 卡片数 / 20**。

---

## T-14 🟢 降低站点标识兜底率

三个独立改动。

### T-14a：统一质量门槛（必做）

`src/extension/icon-processor.ts` 还在用旧门槛，与主路径不一致。

改 `src/extension/icon-processor.ts:82-90`：

```ts
  if (!request.vector && (nativeWidth < 16 || nativeHeight < 16)) {
    return { iconRejectReason: "below-16px", ... };
  }
  if (Math.max(nativeWidth, nativeHeight) / Math.min(nativeWidth, nativeHeight) > 3) {
    return { iconRejectReason: "extreme-ratio", ... };
  }
```

改 `src/extension/icon-processor.ts:120-125`：

```ts
  if (normalized.inkCoverage < 0.01) {
    return { iconRejectReason: "blank-image", ... };
  }
```

**这三个常量必须与 `src/lib/thumbnail.ts:843-915` 主路径完全一致。** 建议直接把它们提取到 `src/lib/icon-quality.ts` 里共享，避免再次漂移：

```ts
export const ICON_MIN_SIZE = 16;
export const ICON_MAX_RATIO = 3;
export const ICON_MIN_INK = 0.01;
```

### T-14b：候选并行探测

`src/lib/thumbnail.ts:943-958` 当前串行 for 循环。改成：按优先级分成 2 组，组内并行，第一组全失败才试第二组。

```ts
export async function cacheSiteBrandIcon(
  candidates: SiteIconCandidate[],
  decodeFallback?: SiteIconDecodeFallback
): Promise<CachedSiteIcon> {
  const highPriority = candidates.slice(0, 4);
  const rest = candidates.slice(4);
  for (const group of [highPriority, rest]) {
    if (!group.length) continue;
    const results = await Promise.allSettled(
      group.map((candidate) => tryCandidate(candidate, decodeFallback))
    );
    // 按原始优先级顺序取第一个成功的，不是取最快的
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      if (result.status === "fulfilled" && result.value.iconDataUrlLight) {
        return result.value;
      }
    }
  }
  return { iconRejectReason: "no-candidate" };
}
```

**注意：按优先级顺序取，不是取最快返回的。** 否则会用低质量图标覆盖高质量的。

每个候选加 5 秒超时，避免一个卡住拖累整组。

### T-14c：公共 favicon 服务兜底 ✅ 用户已同意并完成

> **2026-08-04 决策：** 用户已明确同意。实现默认开启、设置可关闭、敏感站点强制排除，并已同步隐私说明。公共服务只在全部站点自身候选失败后调用，进一步减少不必要的域名外发。

已采用的实现方式：

在 `scanSiteBrand` 的候选列表末尾（分类兜底之前）追加：

```ts
    ...(await publicFaviconCandidates(resource.url))
```

```ts
async function publicFaviconCandidates(url: string): Promise<SiteIconCandidate[]> {
  const settings = await getDisplaySettings();
  if (!settings.publicFaviconFallback) return [];
  if (await isSensitiveUrl(url)) return [];   // 敏感站点绝不外发
  const host = new URL(url).hostname;
  return [
    { url: `https://www.google.com/s2/favicons?domain=${host}&sz=128`, source: "public-service" },
    { url: `https://icons.duckduckgo.com/ip3/${host}.ico`, source: "public-service" }
  ];
}
```

设置里加一个开关，默认开。隐私说明页如实补充这一条。

### 验收标准

1. `npm run typecheck && npm run test && npm run check:design` 全绿。
2. 质量常量在 `icon-processor.ts` 和 `thumbnail.ts` 里引用同一个来源（用 grep 确认没有重复的数字字面量）。
3. 跑 `npm run measure:covers -- --input <书签JSON> --output report.json`，记录改动前后的兜底率，写进 `AGENT_PROGRESS.md`。**改动后必须低于改动前。**
4. 新增测试：并行探测时，高优先级候选成功则不使用低优先级结果。

---

# 阶段 P4：Agent 重写

> 依赖：P1 完成（需要 `handlers/agent.ts` 已拆出）。可与 P3 并行。
> **预计：4–5 天。** 🔴 **T-15 必须由高能力模型做，T-16/T-17 可以交接。**

---

## T-15 🔴 设计并实现工具层

### 目标

从"单轮 JSON 管道"改成"多轮 tool calling agent"。

### 工具定义

新建 `src/lib/agent/tools.ts`。用 zod 定义 schema，运行时转 JSON Schema 传给各家 API。

#### 只读工具（自动执行，无需确认）

```ts
export const readTools = {
  list_folders: {
    description: "列出完整的文件夹树，包含每个文件夹的路径、条目数量。用于了解当前的组织结构。",
    parameters: z.object({}),
    execute: async () => ({ folders: await getFolderTree() })
  },

  search_bookmarks: {
    description: "按关键词搜索书签。支持中文、拼音、标签、摘要。",
    parameters: z.object({
      query: z.string().describe("搜索关键词"),
      limit: z.number().int().min(1).max(100).default(30),
      folderPath: z.string().optional().describe("限定在某个文件夹内搜索")
    }),
    execute: async (args) => ({ results: await searchLocalResources(args) })
  },

  get_folder_contents: {
    description: "分页读取某个文件夹的直接内容。用于逐个文件夹检查。",
    parameters: z.object({
      folderPath: z.string(),
      cursor: z.number().int().default(0),
      limit: z.number().int().min(1).max(100).default(50)
    }),
    execute: async (args) => ({ items: [], nextCursor: null })
  },

  get_bookmarks: {
    description: "按 ID 批量获取书签详情，包含标题、网址、摘要、标签、所在文件夹。",
    parameters: z.object({ ids: z.array(z.string()).max(200) }),
    execute: async (args) => ({ bookmarks: [] })
  },

  get_library_stats: {
    description: "获取收藏库整体统计：总数、文件夹数、无标签数、重复组数、失效链接数、最大文件夹。",
    parameters: z.object({}),
    execute: async () => buildLibraryStats()
  },

  find_duplicates: {
    description: "找出重复的收藏（相同或高度相似的网址）。",
    parameters: z.object({ threshold: z.number().min(0).max(1).default(0.9) }),
    execute: async (args) => ({ groups: await findDuplicateGroups(args.threshold) })
  },

  find_dead_links: {
    description: "找出已经失效的收藏。结果来自真实网络检测。",
    parameters: z.object({ limit: z.number().int().default(100) }),
    execute: async (args) => ({ links: await findDeadLinks(args.limit) })
  }
};
```

**`find_duplicates` 和 `find_dead_links` 必须接到现有的 `src/lib/library-insights.ts` 和 `src/lib/link-health.ts` 上**，不要重新实现。这是当前 Agent 拿不到的能力，接上去价值很大。

#### 写工具（产出计划，不直接执行）

```ts
export const writeTools = {
  plan_create_folders: {
    description: "计划创建文件夹。支持一次创建多层嵌套。",
    parameters: z.object({
      folders: z.array(z.object({
        path: z.string().describe("完整路径，用 / 分隔，例如 '技术/前端'"),
        reason: z.string().max(100)
      })).max(100)
    })
  },

  plan_move_bookmarks: {
    description: "计划移动书签到目标文件夹。可以一次移动大量书签。",
    parameters: z.object({
      moves: z.array(z.object({
        bookmarkId: z.string(),
        targetFolderPath: z.string()
      })).max(1000)
    })
  },

  plan_rename: {
    description: "计划重命名书签或文件夹。",
    parameters: z.object({
      renames: z.array(z.object({
        id: z.string(),
        kind: z.enum(["bookmark", "folder"]),
        newTitle: z.string().max(200)
      })).max(1000)
    })
  },

  plan_delete: {
    description: "计划删除书签或文件夹。这是破坏性操作，必须给出理由。",
    parameters: z.object({
      deletions: z.array(z.object({
        id: z.string(),
        kind: z.enum(["bookmark", "folder"]),
        reason: z.string().min(1).max(200)
      })).max(500)
    })
  },

  plan_update_metadata: {
    description: "计划修改 Aarre 的标签、备注或摘要。不影响 Chrome 书签本身。",
    parameters: z.object({
      updates: z.array(z.object({
        resourceKey: z.string(),
        tags: z.array(z.string()).optional(),
        userNote: z.string().max(2000).optional(),
        summary: z.string().max(2000).optional()
      })).max(1000)
    })
  }
};
```

### 多轮循环

```ts
const MAX_TOOL_ROUNDS = 12;

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const messages = buildInitialMessages(input);
  const plan: PlanBuilder = new PlanBuilder();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callProviderWithTools(messages, allTools, input.signal);

    if (!response.toolCalls?.length) {
      return { answer: response.text, plan: plan.build() };
    }

    reportProgress(input.requestId, {
      round,
      calls: response.toolCalls.map((call) => call.name)
    });

    for (const call of response.toolCalls) {
      if (call.name in writeTools) {
        plan.add(call.name, call.arguments);
        messages.push(toolResult(call, { accepted: true, queued: true }));
      } else {
        const result = await readTools[call.name].execute(call.arguments);
        messages.push(toolResult(call, truncateForContext(result)));
      }
    }
    messages.push(response.assistantMessage);
  }

  return {
    answer: "分析步骤过多，已停在当前结果。",
    plan: plan.build()
  };
}
```

**关键点：**
- 只读工具**立即执行**，结果喂回模型
- 写工具**只记录到计划**，不执行，返回给模型一个"已加入计划"的确认
- 每轮都通过 `BOOKMARK_AGENT_PROGRESS` 推给 UI，用户能看到"正在查看文件夹结构…""正在搜索…"
- 工具结果喂回去之前必须截断（单个结果不超过 8000 字符），避免爆上下文

### 各家 API 的 tool calling 接入

三家都支持，格式不同：

**OpenAI / DeepSeek：**
```ts
{
  model,
  messages,
  tools: toolDefs.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
      strict: true
    }
  })),
  tool_choice: "auto"
}
```

**Gemini：**
```ts
{
  contents,
  tools: [{
    functionDeclarations: toolDefs.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters)
    }))
  }]
}
```

用一个适配层 `src/lib/agent/providers.ts` 把三家的差异隔离，对外暴露统一的 `callProviderWithTools`。

### 必须删除的旧代码

- `src/lib/local-ai.ts` 里的 `repairJsonStringNewlines`（第 238–299 行）
- `parseJsonObject` 的容错分支（保留基础的 JSON.parse）
- `scanAgentCatalog`（第 899–978 行）— 被 `search_bookmarks` + `get_folder_contents` 取代
- `parseAgentActions`（第 1204–1424 行）— 被 tool schema 取代
- `generateAgentJson` 的重试循环 — strict schema 后不需要

**这些代码删掉是本任务的一部分，不是可选项。** 留着会和新路径冲突。

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 新增 `tests/agent-tools.test.ts`：
   - 每个工具的 zod schema 能正确转成 JSON Schema
   - 只读工具执行后结果正确
   - 写工具不执行任何 Chrome API（用 spy 断言）
   - 多轮循环在 12 轮后强制停止
3. 用 mock provider 跑一个完整场景：`"把我的书签重新整理一下"` → 模型调用 `get_library_stats` → `list_folders` → `search_bookmarks` → `plan_create_folders` → `plan_move_bookmarks` → 产出计划。
4. `local-ai.ts` 里不再存在 `repairJsonStringNewlines`。

---

## T-16 🟢 计划预览与分批执行

### 目标

大批量操作（几百条）能安全执行、能看进度、能取消、能整体撤销。

### UI：计划预览

Agent 返回计划后，展示成一个可折叠的摘要卡片，不是一长串列表：

```
整理计划

  新建文件夹        8 个        [展开]
  移动书签        342 条        [展开]
  重命名           15 条        [展开]
  删除重复         12 条  ⚠️    [展开]  ← 默认不勾选

  ────────────────────────────
  [ 执行 ]   [ 取消 ]
```

每个分组可展开查看明细。**破坏性操作（删除）默认不勾选**，用户必须主动勾。

### 执行：分批 + 进度 + 可取消

```ts
const BATCH_SIZE = 50;

export async function executePlan(
  plan: AgentPlan,
  options: { signal: AbortSignal; onProgress: (done: number, total: number) => void }
): Promise<ExecutionResult> {
  const steps = flattenPlan(plan);   // 顺序：建文件夹 → 移动 → 改名 → 改元数据 → 删除
  const undoBatch = await prepareUndoBatch(steps);
  let done = 0;
  const failures: ExecutionFailure[] = [];

  for (let i = 0; i < steps.length; i += BATCH_SIZE) {
    if (options.signal.aborted) break;
    const batch = steps.slice(i, i + BATCH_SIZE);
    for (const step of batch) {
      try {
        await executeStep(step);
      } catch (error) {
        failures.push({ step, error: String(error) });
      }
      done += 1;
    }
    options.onProgress(done, steps.length);
    // 让出主线程，避免长时间阻塞 SW
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { done, total: steps.length, failures, undoBatchId: undoBatch.id };
}
```

**执行顺序必须固定：建文件夹 → 移动 → 改名 → 改元数据 → 删除。** 否则会出现"移动到还不存在的文件夹"。

### 撤销

复用现有的 `src/lib/bookmark-undo.ts`。整个计划是**一个** undo batch，用户点一次「撤销这次整理」就全部回滚。

### 部分失败的处理

失败不中断，收集起来。执行完显示：

```
已完成 340/342 · 2 项失败  [查看]  [重试失败项]
```

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 新增 `tests/agent-plan-execution.test.ts`：
   - 500 条移动操作分批执行，全部成功
   - 中途 abort，已执行的保留，未执行的不执行
   - 部分失败时其余继续
   - 执行顺序正确（文件夹先建）
   - 整个计划是一个 undo batch
3. 手动验证：让 Agent 整理 100+ 条书签，观察进度、取消、撤销都正常。

---

## T-17 🟢 流式输出

### 目标

回答部分边生成边显示，消除"等 45 秒什么都没有"的体验。

### 实现

三家都支持 SSE 流式。在 `providers.ts` 里加 `stream: true`，用 `ReadableStream` 逐块读。

从 SW 推到 UI 用 `chrome.runtime.connect` 长连接（不是 sendMessage）。

> ⚠️ **更正（2026-08-04）：连接必须由 UI 侧发起，Service Worker 侧只能监听。** 本文档早前的示例让 background 也调用 `chrome.runtime.connect()`，那是错的——SW 无法主动向扩展页面建链，那样只会连到它自己。

```ts
// UI 侧：由这里发起连接
const port = chrome.runtime.connect({ name: "agent-stream" });
port.postMessage({ type: "start", query, history });
port.onMessage.addListener((message) => {
  if (message.type === "delta") setAnswer((prev) => prev + message.text);
});
```

```ts
// Service Worker 侧：顶层同步注册 onConnect，不要放进任何 async 初始化
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "agent-stream") return;
  port.onMessage.addListener(async (message) => {
    if (message.type !== "start") return;
    for await (const chunk of streamResponse(message)) {
      port.postMessage({ type: "delta", text: chunk });
    }
    port.postMessage({ type: "done", plan });
  });
});
```

注册位置遵循与其他监听器一致的约束：`onConnect` 必须在 `initializeBackground()` 的同步路径上注册，否则 SW 唤醒后连接会丢失。

**工具调用阶段不流式**（那是结构化数据），只有最终的自然语言回答流式。

### 超时调整

有了流式之后，超时按"多久没收到新 chunk"算，不是总时长：

```ts
const IDLE_TIMEOUT_MS = 20_000;   // 20 秒没有新内容才算超时
```

总时长上限放宽到 5 分钟（多轮工具调用本来就慢）。

### 验收标准

1. `npm run typecheck && npm run test` 全绿。
2. 用 mock provider 验证：文字逐块出现，不是一次性出现。
3. 中途取消能立即停止。
4. 工具调用阶段 UI 显示当前在调什么工具。

---

# 阶段 P5：UI 极简化

> 依赖：P1 完成。放最后做，因为前面会改动 UI 结构。
> **预计：3–4 天。**

---

## T-18 🟢 删除冗余文案

### 执行方式

**逐条按下表操作。不要自由发挥，不要"顺便优化"其他文案。**

| 文件 | 位置（拆分前行号） | 原文案 | 操作 |
|---|---|---|---|
| `ReportView.tsx` | 159 | `满分 4 分别代表入门、实践、对比和深入…` | 删除整行 |
| `ReportView.tsx` | 97–100 | `本期新增 N 条；有 M 条超过 90 天…` | 删除整段 |
| `ReportView.tsx` | 118 | `这段时间，你在关注什么` | 改为 `主题变化` |
| `ReportView.tsx` | 149 | `本期还没有形成明显的主题变化。` | 改为 `暂无数据` |
| `ReportView.tsx` | 179 | `当前还没有足够密集的同主题收藏…` | 改为 `数据不足` |
| `ReportView.tsx` | 215 | `目前没有同时满足"足够久"和"与近期主题相关"…` | 改为 `暂无推荐` |
| `TopicsView.tsx` | 756 | `名称取该社区里收藏最多的主题。` | 删除整行 |
| `TopicsView.tsx` | 780 | `可能是独立兴趣…` | 删除整行 |
| `TopicsView.tsx` | 797 | `当前主题都已形成至少一条联系。` | 改为 `无孤岛主题` |
| `TopicsView.tsx` | 806 | `优先补充跨主题内容…` | 删除整行 |
| `OrganizeView.tsx` | 49–51 | `规则和相似度计算均在本机完成；失效链接来自实际网络检测。` | 删除整段 |
| `OrganizeView.tsx` | 175–176 | `完成一次全目录扫描后…` | 改为 `暂无建议` |
| `LibraryView.tsx` | 374 | `尚未读取网页正文。再次打开该网页，Aarre 会在页面稳定后自动补全。` | 改为 `尚未读取正文` |
| `LibraryView.tsx` | 462–478 | 5 组空状态的第二行副文案 | 全部删除，只留标题 |
| `ManagerApp.tsx` | 491–493 | `本地索引、主题关系与收藏健康度会一起准备好。` | 删除整行 |
| `SettingsPage` | 1187 | `生成摘要与标签，增强本地检索。` | 删除整行 |
| `SettingsPage` | 1232 | `选择服务商并填写自己的 API Key。` | 删除整行 |
| `SettingsPage` | 1291 | `列表中优先显示的图片类型。` | 删除整行 |
| `SettingsPage` | 1469 | `最近的更改、导出数据、隐私、引导与账号` | 删除副标题 |
| `SettingsPage` | 1526 | `重新查看主要功能说明。` | 删除整行 |
| `SettingsPage` | 1592–1597 | 扫描弹窗的 3 段说明 | 合并为一行：`{n} 条将调用 {provider}，已完成的不会重复。` |
| `SettingsPage` | 1604–1605 | `并发 / N 条任务` | 删除整个 `<dl>` 项 |
| `SettingsPage` | 1615–1619 | 3 段免责声明 | 合并为一行：`用量为估算值，数据保存在本机。` |
| `SnapshotBackfillControl.tsx` | 367–382 | 弹窗 4 段说明 | 合并为一行 + 一行隐私说明 |
| `ResurfaceView.tsx` | 30–31 | 空状态第二行 | 删除 |

### 必须保留（不要删）

| 位置 | 文案 | 原因 |
|---|---|---|
| `SettingsPage:1263` | `Key 仅保存在当前 Chrome 配置文件。` | 隐私承诺 |
| `SettingsPage:1546` | `导出本地数据，不包含 API Key 或登录信息。` | 导出前必要说明 |
| `SettingsPage:1484` | `删除的书签和文件夹保留 30 天。` | 影响用户决策 |
| `SettingsPage:1323–1329` | `{n}/{m} 条已增强 · {k} 条受保护` | 数据，不是废话 |
| `ManagerApp:663–665` | 账号不一致警告 | 影响功能可用性 |
| `SettingsPage:1608–1612` | 预计 token 用量 | 涉及用户成本 |

### 术语统一

全局替换：

| 原 | 改为 |
|---|---|
| `备注（智能增强层）` | `备注` |
| `自动完成智能增强` | `自动生成摘要` |
| `智能增强` | `AI 摘要` |
| 任何 `Aarre 会…` 句式 | 删除该句 |

### 验收标准

1. `npm run typecheck && npm run test && npm run check:design` 全绿。
2. 全局搜索 `Aarre 会`，结果为 0（README 和 docs 除外）。
3. 全局搜索 `智能增强`，结果为 0。
4. 所有空状态都是**单行**。

---

## T-19 🔴 收敛样式系统

### 问题

现在有 4 套按钮实现并存，最常见的写法是把两套叠在一起：

```tsx
<Button variant="unstyled" className="button button-dark">
```

### 目标

**只保留一套：shadcn/ui + Tailwind + tokens.css 变量。**

### 步骤 1：合并两个 ui 目录

`src/components/ui/` 和 `src/ui/components/ui/` 合并到 **`src/ui/components/ui/`**（与 `components.json` 声明一致）。

统一用路径别名 import，禁止相对路径：

```ts
// tsconfig.json 里已有 "@/*": ["src/*"]，确认 vite.config.ts 也配了 alias
import { Button } from "@/ui/components/ui/button";
```

**全局替换所有 `../../components/ui/` 为 `@/ui/components/ui/`。**

### 步骤 2：修复无效的 CSS 变量

`src/ui/styles.css:97-141` 用了 `--space-3` 等，但 `tokens.css` 只定义了 `--sp-*`。

全局替换：`--space-1` → `--sp-1`，以此类推。用 grep 确认替换干净。

### 步骤 3：消除双轨按钮

把 `base.css:176-263` 的 legacy 按钮类映射到 shadcn variant：

| legacy 类 | shadcn variant |
|---|---|
| `.button.button-dark` | `variant="default"` |
| `.button.button-quiet` | `variant="ghost"` |
| `.button.button-small` | `size="sm"` |
| `.button` (裸) | `variant="secondary"` |

逐个文件替换，**一次改一个文件，改完跑一次 `npm run check:design`**。

全部替换完后删除 `base.css` 里的 legacy 按钮样式。

### 步骤 4：加防回归检查

在 `scripts/check-design-tokens.ts` 新增规则：

```ts
// 禁止 variant="unstyled" 与 className 里的 button 类同时出现
if (/variant=["']unstyled["']/.test(line) && /className=["'][^"']*\bbutton\b/.test(line)) {
  fail(file, index, "禁止双轨按钮：使用 shadcn variant，不要叠加 legacy .button 类");
}
// 禁止相对路径 import ui 组件
if (/from ["']\.\.\/.*components\/ui\//.test(line)) {
  fail(file, index, "使用 @/ui/components/ui/ 别名，不要用相对路径");
}
```

### 验收标准

1. `npm run typecheck && npm run test && npm run check:design && npm run build` 全绿。
2. 全局搜索 `variant="unstyled"`，结果为 0。
3. `src/components/` 目录不再存在。
4. 全局搜索 `--space-`，结果为 0。
5. `npm run ui:shots` 生成截图，人工对比前后无视觉回归。

---

## T-20 🟢 写下极简规范并强制执行

新建 `docs/UI_PRINCIPLES.md`，内容如下（直接抄）：

```markdown
# Aarre UI 原则

## 文案

1. 每个控件最多一行说明，且只在"不说会出错"时才写。
   可以写：隐私边界、不可逆操作、涉及成本的估算。
   不要写：功能怎么用、产品怎么工作、鼓励性描述。
2. 空状态只有一行。格式：`还没有 XXX`。不加第二行解释。
3. 不出现"Aarre 会…""我们会…"这类产品自述。
4. 能显示数字就不要用形容词。写 `12/48`，不写"正在处理中"。
5. 错误信息说清楚"发生了什么"和"接下来会怎样"，不说"请稍后重试"。

## 布局

6. 一个页面最多一个主按钮（`variant="default"`），其余用 ghost 或文字链接。
7. 破坏性操作用文字链接，不用按钮，且必须与主操作分开放置。
8. 详细信息默认收起。日常界面只显示状态，不显示细节。
9. 分区之间只用间距区分，不加分隔线。整页最多一条分隔线。

## 组件

10. 只使用 `@/ui/components/ui/` 下的组件，禁止手写按钮/输入框。
11. 禁止 `variant="unstyled"` + legacy CSS 类的双轨写法。
12. 所有颜色、间距、字号、圆角必须用 `tokens.css` 的变量。

## 检查

违反 10–12 会被 `npm run check:design` 拦截。
违反 1–9 靠 review，新增文案时请对照本文件。
```

---

# 阶段 X：启动性能（穿插执行）

> 这些是独立小任务，可以在任何阶段之间穿插做。按性价比排序。

---

## X-01 🟢 侧边栏不再加载网页端 CSS

`src/ui/styles.css:5-6`：

```css
@import "./sidepanel.css";
@import "./manager.css";
```

拆成两个入口文件：

- `src/ui/styles-sidepanel.css`：Tailwind + tokens + base + sidepanel.css
- `src/ui/styles-manager.css`：Tailwind + tokens + base + manager.css

`src/ui/sidepanel/main.tsx` import 前者，`src/ui/manager/main.tsx` import 后者。

**收益：侧边栏 CSS 减少约 60 KB。**

验收：`npm run build` 后，sidepanel 引用的 CSS 文件体积 < 80 KB。

---

## X-02 🟢 去掉首屏门禁

`SidePanelApp.tsx:2843-2845` 的 `onboardingVisible` 初始值是 `null`，要等 3 次 `chrome.storage` 读完。

改成用 `localStorage`（同步读，0 延迟）做乐观初始值：

```tsx
const [onboardingVisible, setOnboardingVisible] = useState<boolean>(() => {
  // localStorage 是同步 API，不阻塞首帧。
  // 真实值稍后由 chrome.storage 修正。
  return localStorage.getItem("aarre:onboarding-done") !== "1";
});
```

在 onboarding 完成时同时写两处：

```ts
localStorage.setItem("aarre:onboarding-done", "1");
await saveOnboardingState({ done: true });
```

storage 读完后如果与乐观值不一致，再修正（老用户几乎不会不一致）。

**同时删掉 `SidePanelApp.tsx:4459-4472` 的 boot screen 分支。**

**收益：50–200 ms。**

---

## X-03 🟢 SW 顶层不做全表扫描

`background.ts:7979-7994` 每次 Service Worker 唤醒都执行 `getPageSnapshots()`（读出全部快照）。

改成每日 alarm：

```ts
// lifecycle/alarms.ts
chrome.alarms.create("daily-maintenance", { periodInMinutes: 24 * 60 });

// handler
if (alarm.name === "daily-maintenance") {
  void cleanupDuplicateSnapshots();
  void cleanupExpiredUndoSnapshots();
}
```

从模块顶层删除这段。

**收益：SW 冷启动 100–500 ms。**

---

## X-04 🟢 首屏消息合并

侧边栏挂载时发 6–7 条消息。合并成一条：

```ts
// handlers/index.ts
GET_BOOTSTRAP: async () => {
  const [appState, aiSettings, displaySettings] = await Promise.all([
    getAppStateLight(),      // 精简版：只要 auth + activeTab
    getAiSettings(),
    getDisplaySettings()
  ]);
  return { appState, aiSettings, displaySettings };
}
```

**从首屏移除的调用**（改成挂载后延迟 1 秒再单独请求）：
- `GET_SITE_BRANDS`（会触发网络请求）
- `GET_CONTEXT_RESURFACING`（会重跑一遍书签导入）
- `GET_ORGANIZATION_NOTICE`
- `GET_AGENT_CONVERSATIONS`

新增 `getAppStateLight()`，不做 IndexedDB 查询，只读 `chrome.storage`。

**收益：200–800 ms。**

---

## X-05 🔴 background 动态 import 方案已撤销

`background.ts` 顶层静态 import 了 `local-ai.ts`（1744 行）、`cover-rules.ts`（1014 行）、`page-snapshot.ts`。

原方案要求在需要时动态 import：

```ts
// handlers/agent.ts
export async function askAgent(request, sender) {
  const { runAgent } = await import("../../lib/agent/runner");
  return runAgent(...);
}
```

```ts
// handlers/site-icons.ts
async function scanSiteBrand(resource) {
  const { coverRuleFor } = await import("../../lib/cover-rules");
  // ...
}
```

**2026-08-04 纠错：上述判断错误。** Chrome 官方扩展文档明确说明 MV3 Service Worker 支持静态 `import`，但不支持动态 `import()`。实际安装态已连续出现 `document is not defined` 与 `window is not defined`，它们均来自 Vite 为失败的动态导入生成的 client 预加载助手。

当前构建采用页面与后台双入口：页面继续动态分包；后台独立构建为单个 ESM 文件并设置 `codeSplitting: false`。若未来要继续降低 SW 冷启动成本，应把重计算迁到 offscreen document 或扩展页面，通过消息通信调用，不能再次向 background 引入 `import()`。

修订验收：`dist/background.js` 中 `import()` 必须为 0；构建产物检查永久守卫；在真实安装态 Chrome 完成启动、右键菜单、同步、搜索和 Agent 回归。原“主包下降 >30% 且产生 lazy chunk”指标作废。

---

## X-06 🟢 Vite 手动分包

`vite.config.ts:25-29` 目前只拆了 `pinyin-pro`。补充：

```ts
manualChunks(id) {
  if (id.includes("pinyin-pro")) return "pinyin-search";
  if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react-vendor";
  if (id.includes("@radix-ui") || id.includes("@base-ui")) return "ui-vendor";
  if (id.includes("react-markdown") || id.includes("remark") || id.includes("micromark")) return "markdown";
}
```

好处：React 和 Radix 的 chunk 内容不常变 → 哈希稳定 → Chrome 能跨版本复用缓存。

**收益：解析时间 10–20%，以及版本升级后的重复加载减少。**

---

## X-07 🔴 建立性能基线测量

新建 `scripts/measure-startup.mjs`，用 Playwright 加载 dist 扩展，打开侧边栏，记录：

- HTML 首字节到 React 首次 commit 的时间
- 首次出现书签列表的时间
- 首屏 JS 总字节数
- Service Worker 冷启动到第一条消息响应的时间

把结果写入 `docs/PERF_BASELINE.md`，每次性能改动后重跑并对比。

**注意：这个脚本必须在真实 Chrome 里跑。** 如果当前环境的工具限制打不开 `chrome://extensions`，就退而求其次：只测 bundle 体积和模块解析时间，并在文档里标注"运行时数据待真机验收"。

---

# 附录 A：全局禁止事项

无论做哪个任务，以下都禁止：

1. ❌ 用 mock / 假数据 / TODO 注释代替真实实现
2. ❌ `git reset`、`git checkout --force`、`git push --force`
3. ❌ 删除 `dist/`、`ops/`、`server/migrations/` 里的已有文件
4. ❌ 修改已存在的 migration SQL（要改就新增文件）
5. ❌ 重新引入 Supabase
6. ❌ 用云端副本覆盖 Chrome 原生书签的标题、URL、文件夹结构
7. ❌ 让扩展把网页正文、Cookie、完整浏览历史、API Key 上传到 Aarre 服务器
8. ❌ 对受保护 / 敏感（银行、支付、医疗、内网、无痕）页面做截图、AI 调用或上传
9. ❌ 在没有用户确认的情况下执行删除类操作
10. ❌ 为了让测试通过而放宽断言

---

# 附录 B：每个任务的提交格式

```
<type>: <一句话说明改了什么>

- 问题：<原来是什么行为>
- 修改：<现在是什么行为>
- 验证：<跑了什么、结果如何>

任务：T-XX
```

`type` 用 `fix` / `feat` / `refactor` / `perf` / `docs` / `test`。

---

# 附录 C：进度文档要求

每完成一个任务，在 `AGENT_PROGRESS.md` 顶部的「最近更新」下新增一条：

```markdown
### YYYY-MM-DD · T-XX / <任务名>

- **改动。** <具体改了哪些文件的哪些行为>
- **验证。** <typecheck / test 数量 / 手动验证项>
- **遗留。** <没做完的、需要用户验收的>
```

如果某个任务你只做了一部分，**必须写清楚做到哪一步、下一个 agent 从哪继续**。

文档只保留最近 3 天的详细记录，更早的压缩成一行摘要。
