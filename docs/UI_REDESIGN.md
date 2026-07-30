# Aarre UI / 视觉重构方案（可执行）

- 版本：v1 · 2026-07-30
- 基线提交：`1c45453`（0.3.8）
- 视觉样张：`docs/design/style-samples.html`（浏览器直接打开，可切风格 / 明暗 / 界面）
- 样张截图：`docs/design/sample-*.png`
- 盘点结论与决策过程：`AGENT_PROGRESS.md` 中「2026-07-30 · UI/视觉系统性盘点」

---

## 0. 开工前必读

### 0.1 这次要解决的是什么

不是「把界面调好看一点」。当前 `src/ui/styles.css` 里叠着**两套互相冲突的设计系统**：第 1–20 行的 `:root` 是暖纸柠檬绿（`--paper: #f5f4ed`、`--lime: #a9e85c`），第 1729–1748 行又出现第二个 `:root`，是冷白蓝（`--paper: #fff`、`--accent: #205aef`）。后者覆盖前者，但前 1,728 行的规则仍是照暖纸色写的。manager 样式也有两套（旧版约 469–915，新版 1796+），靠加载顺序覆盖。

产品负责人已确认第二套是从其他仓库引入的、不是想要的风格，**授权整体推翻**。所以这份方案的第一件事是建立单一 token 源，而不是在现有值上微调。

### 0.2 三条贯穿全局的硬规则

违反其中任何一条的改动都要打回重做。

**规则一：颜色分工。** 黑白灰负责交互与结构——按钮、焦点态、选中态、搜索命中高亮、品牌标记，一律用 `--ink` 系。彩色只允许出现在**颜色本身在编码数据**的地方：报告的图表、主题图谱的社区着色、涨跌数字。`--accent` 是图表色，出现在任何按钮或焦点边框上都是错的。

**规则二：密度是同一套系统的两档，不是两套设计。** 侧边栏 `compact`（正文 13px），网页端 `comfortable`（正文 15px、行高 1.7）。两边共用同一批颜色、圆角、组件，**只换字号与间距变量**。不允许为网页端另建一套组件类名。

**规则三：悬停不得改变元素占位。** 瀑布流里卡片一旦变高，整列都会重排，悬停就成了页面抖动。任何「悬停展开更多信息」的交互，展开量必须与收缩量严格相等，且用同一个 CSS 变量表达，不能是两个凑出来的数字。

### 0.3 明确禁止的做法（产品点名）

- **彩色竖条 + 一句话**。原 `.report-lead` 的 `border-left: 2px solid var(--accent)` 已被点名为「AI 味太浓」。层级一律靠字阶和留白建立，不加装饰性色条。这条适用于所有页面，不只是报告。
- **把详情叠在封面上的深色遮罩**。第一版这么做过，产品明确否掉了。正确做法见 D.3。
- **给按钮上主题色**。见规则一。

### 0.4 并发占用

`src/ui/sidepanel/SidePanelApp.tsx` 与 `src/ui/styles.css` 在 0.3.6–0.3.8 被另一 Agent 连续改过（设置页无卡片分区、预览宽度、动画）。**开工前先 `git log --oneline -5` 确认基线，并重新读这两个文件的当前内容**，不要照本文档里的行号盲改。本文档引用的行号基于 `1c45453`。

---

## 1. Token 定义（唯一事实来源）

全部写进新文件 `src/ui/tokens.css`，由 `styles.css` 在最顶部 `@import`。**除本节列出的值以外，代码里不允许再出现任何色值、圆角、字号字面量。**

### 1.1 颜色

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--bg` | `#ffffff` | `#0f1113` | 页面底色 |
| `--surface` | `#ffffff` | `#16181b` | 卡片/面板 |
| `--surface-sunken` | `#f5f6f7` | `#1d2023` | 悬停底、内凹块 |
| `--ink` | `#17191c` | `#eef0f2` | 正文、**所有实心按钮底色** |
| `--ink-muted` | `#6c7278` | `#949a9f` | 次要文字 |
| `--ink-faint` | `#a0a5aa` | `#676d72` | 占位、计数 |
| `--line` | `#ebedef` | `#24272a` | 发丝线 |
| `--line-strong` | `#dadde0` | `#34383c` | 输入框边框 |
| `--accent` | `#12a594` | `#2ec4b0` | **仅图表** |
| `--positive` | `#12a594` | `#2ec4b0` | 涨跌数据 |
| `--negative` | `#d2493a` | `#e0776a` | 涨跌数据 |

图表/图谱调色板（社区着色，按序取用）：

- 浅色 `#12a594` `#5b7cd8` `#c2762e` `#7b6bc4` `#4d9c5a`
- 深色 `#2ec4b0` `#7d9ce8` `#dba05a` `#a394e0` `#6fbf7c`

背景**必须是纯白**。侧边栏尤其：非白底会与 Chrome 侧边栏容器之间出现一条可见的色差接缝，面板看起来像「贴」在浏览器里而不是浏览器的一部分。层次全部靠发丝线和悬停底色表达。

### 1.2 圆角、间距、动效

```
--radius-sm: 8px    小图标底、缩略图
--radius-md: 14px   通知条、浮层
--radius-lg: 20px   卡片封面、图谱容器
--radius-xl: 30px   搜索框

--sp-1..8: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72

--fw-regular: 400   --fw-medium: 500   --fw-strong: 650
--dur-fast: 120ms   --dur-base: 200ms
--ease: cubic-bezier(0.2, 0, 0, 1)
```

字重只保留三档。现状用了 450/500/550/600/610/620/640/650/680/700/720/750/760 共 13 档，610 与 620 没有可感知差别，是逐处手调而非按系统取值的典型特征。

卡片与图谱的过渡用 300–340ms（比 `--dur-base` 慢，因为位移距离大），单独在组件里写明，不新增 token。

### 1.3 密度两档

```css
[data-density="compact"] {      /* 侧边栏 */
  --fs-caption: 11px; --fs-small: 12px; --fs-body: 13px; --fs-lead: 15px;
  --fs-h3: 17px; --fs-h2: 20px; --fs-h1: 26px; --lh-body: 1.55;
}
[data-density="comfortable"] {  /* 网页端 */
  --fs-caption: 12px; --fs-small: 13px; --fs-body: 15px; --fs-lead: 18px;
  --fs-h3: 21px; --fs-h2: 27px; --fs-h1: 40px; --lh-body: 1.7;
}
```

在两个 HTML 的根容器上分别挂 `data-density`。两个 HTML 现在都写死了 `color-scheme: light`，改为 `light dark`。

---

## 批次 A · Token 层与 CSS 拆分

**这一批不允许出现任何视觉之外的行为变化。** 目的是把地基换掉，为后面每一批提供单一改动点。

### A.1 建立 `src/ui/tokens.css`

按第 1 节写全部 token，含 `[data-theme="dark"]` 与 `@media (prefers-color-scheme: dark)` 两条路径（用户可手动覆盖，默认跟随系统）。

### A.2 删除两个冲突的 `:root`

删掉 `styles.css` 第 1–20 行和第 1729–1748 行两个 `:root`。原有变量名（`--paper` `--card` `--lime` `--component` 等）建立一张一次性映射表逐个替换为新 token，替换完删除映射表——**不要保留别名层**，否则下一个 Agent 会继续往旧名字上加规则。

### A.3 拆分 `styles.css`

6,152 行拆成：

```
src/ui/tokens.css      token（本方案第 1 节）
src/ui/base.css        reset、字体、滚动条、通用表单元素
src/ui/sidepanel.css   .native-* .bookmark-* .agent-* .settings-* 等侧边栏族
src/ui/manager.css     .manager-* .library-* .resource-* .report-* 等网页端族
```

拆分时顺手清掉 66 个重复定义的选择器和 9 处 `!important`。两套 manager 样式（旧 469–915 / 新 1796+）只保留会被实际渲染到的那套。

### A.4 硬编码值防回归

加一个脚本 `scripts/check-design-tokens.ts`，扫描 `src/ui/*.css`，命中以下情况就报错退出：

- 十六进制色值 / `rgb()` / `hsl()` 字面量（`tokens.css` 与图表调色板白名单除外）
- `border-radius` / `font-size` 出现不在 token 表里的字面量

接进 `npm run check`。**没有这个脚本，token 层三周内必然重新长回 200 个硬编码色值**——现状的 210 个就是这么来的。

### A.5 验收

- `npm run check` 通过。
- `rg -c ':root' src/ui/*.css` 结果只在 `tokens.css` 中命中。
- 扫描脚本对当前代码零报错。
- 浏览器实机打开侧边栏与网页端，逐屏对照改动前截图：允许颜色整体变化，**不允许出现布局错位、元素消失、交互失效**。

---

## 批次 B · 侧边栏接入 token

**只换 token，不动 DOM 结构。** 侧边栏是日常主力界面且刚被打磨过（0.3.6–0.3.8），回归风险最高。

### B.1 头部尺度

标题 `收藏` 15px → **19px**；右侧图标按钮 28px → **34px**、图标 16px → **18px**、圆角 12px。

### B.2 AI 输入框几何

沿用线上实现（`.agent-composer`，`styles.css` 3107–3122、3277–3306），只改以下三项：

| 项 | 现状 | 改为 |
| --- | --- | --- |
| `border-radius` | 24px | **22px** |
| 发送键右／下内缩 | 14px / 12px | **各 12px** |
| `:focus-within` 边框 | `--ink` 17% | `--ink` 28% |

**保持不变的部分（写在这里是因为容易被误改）：** textarea `min-height: 48px` / `max-height: 112px`；上方 padding 14px；下方 32px 工具条；`box-shadow: 0 12px 32px rgba(36,36,36,0.08)`。

两条容易做错的：

1. **高度由输入内容顶起来，不是聚焦就变高。** 用 `input` 事件先把 `height` 置 `auto` 再读 `scrollHeight` 回填，否则删字时不会回落。聚焦只加深边框。
2. **不要给焦点态上主题色。** 现状 `:focus-within` 已经是中性的，保持。

曾经尝试过让发送键圆心与圆角圆心重合（`内缩 = 圆角 − 按钮半径 − 边框`）。产品评估后选择了更小的圆角并明确「圆心不在一起就不在一起」。**这条几何关系只在圆角 24–30 区间成立，圆角一收小就会把按钮顶到贴边，不要再试图恢复它。**

### B.3 必须保留的线上细节

- 列表上下溢出的 **52px 渐隐遮罩**（`styles.css` 2944–2962、3801–3830、3874–3880）。它由滚动位置驱动（`@property` + `animation-timeline: scroll(self)`），顶部未滚动时不虚、滚到底时底部不虚。拆分 CSS 时 `@property` 声明容易被漏掉，漏了遮罩会直接失效而不报错。
- 输入框的投影。
- 0.3.8 的根目录隐藏与路径精简逻辑。

### B.4 验收

- 侧边栏纯白，与 Chrome 侧边栏容器之间无可见接缝。
- 输入长文本时输入框逐行增高至 112px 后内部滚动；删字时回落。
- 列表滚动时上下渐隐随位置变化。
- 现有侧边栏测试全部通过，无新增快照差异之外的失败。

---

## 批次 C · 拆分 `ManagerApp.tsx`（只搬不改）

`ManagerApp.tsx` 用一条覆盖 423 行的嵌套三元渲染六个视图（592–1015 行），没有任何按视图拆分的组件。**这是各 tab 各自走样的直接原因**，也是后面每一批无法并行的原因。

拆成：

```
src/ui/manager/ManagerApp.tsx        外壳：数据加载、view 状态、header、tabs
src/ui/manager/views/LibraryView.tsx
src/ui/manager/views/OrganizeView.tsx
src/ui/manager/views/ReadingView.tsx
src/ui/manager/views/ReportView.tsx
src/ui/manager/views/TopicsView.tsx
src/ui/manager/views/ResurfaceView.tsx
```

`refresh()`（200–241）、`view` 状态（165）、URL `?view=` 解析（150–161）留在外壳；每个视图组件接收它需要的数据作为 props。

**这一批不改任何视觉。** 拆完的渲染结果必须与拆之前逐像素一致。先拆再改，是为了让 D–G 四批可以独立回滚。

验收：`npm run check` 通过；六个 tab 逐个切换，与拆分前截图比对无差异。

---

## 批次 D · 收藏库（`LibraryView`）

现状是单条横向条目（`.resource-card`），信息密度接近 SaaS 后台。产品要求网页端「比侧边栏优质很多，更像内容型网站」。参考站：<https://mesh3d.gallery/>（实测其卡片封面 `rounded-2xl` 16px、`transition duration-300 ease-out`，封面下只有 favicon + 标题 + 作者两行）。

### D.1 自适应分栏

```css
.masonry { column-width: 240px; column-gap: var(--sp-5); }
.card    { break-inside: avoid; margin-bottom: var(--sp-6); }
```

用 `column-width` 而不是 `column-count`：浏览器按可用宽度决定列数，1120px 容器下自动排四栏，窄屏自动退到 3/2/1 栏，卡片宽度始终落在 240–300 之间。**不要写死列数**——产品明确要求「如果横向空间允许就可以变成四栏或更多」。

### D.2 卡片去壳

卡片本身不做边框和底色，只有：圆角封面（`--radius-lg`，1px `--line` 边框）+ 下方标题（`--fs-body`、`--fw-strong`）+ 站点行（favicon + 域名，`--fs-caption`、`--ink-faint`）。

封面三档高度制造瀑布错落：`short 200px` / 默认 `232px` / `tall 272px`。封面内容取 `ResourceRecord.thumbnailDataUrl`，无快照时走现有的分类兜底封面（`categoryCoverId`），复用 `src/ui/components/SiteThumbnail`。

### D.3 悬停揭示（重点，第一版做错过）

**封面被压矮、下方内容整体上推，让出的空间里滑出详情。**不是把详情叠在封面上。

```css
.card  { --reveal: 89px; }
.cover { --h: 232px; height: var(--h); transition: height 340ms var(--ease); }
.card:hover .cover { height: calc(var(--h) - var(--reveal)); }

.card-extra { height: 0; overflow: hidden; opacity: 0;
              transition: height 340ms var(--ease), opacity 200ms var(--ease); }
.card:hover .card-extra { height: var(--reveal); opacity: 1; }
```

三个必须做对的点：

1. **收缩量与展开量共用 `--reveal`**，卡片总高恒定。验收时量：悬停前后收藏库区块 `getBoundingClientRect().height` 必须完全相等。
2. **`--reveal` 必须等于详情区的自然高度**。凭感觉给值会切掉标签行。做法是渲染后克隆节点、置 `height: auto` 量真实高度再回填，或在实现时固定详情区结构（摘要 2 行截断 + 标签行）并按字号推算。样张里量出来是 89px。
3. **封面内容用 `height: var(--h)` 固定在原始高度并 `inset: 0 0 auto 0`**，这样封面变矮时是从下方裁掉，而不是把内容压扁。

详情区内容：`summary`（`-webkit-line-clamp: 2`）+ `tags` + `updatedAt`。

### D.4 搜索命中高亮

`<mark>` 用 `color-mix(in srgb, var(--ink) 15%, transparent)` 灰底，不用主题色。

### D.5 验收

- 1440 / 1120 / 900 / 600 四个宽度下分别自动排出 4 / 4 / 3 / 2 栏，卡片宽度不越界。
- 悬停任一卡片，区块总高不变（脚本量测，不靠肉眼）。
- 悬停动画流畅，无跳变。

---

## 批次 E · 报告（`ReportView`）

现状零图表：`LibraryReport` 已有成对与比例数据，却全部渲染成文字。**不需要新增任何采集字段**，本批全部用现有数据。

### E.1 结论区

- 小字号大写 eyebrow「本周结论」（`--fs-caption`、`letter-spacing: 0.12em`、`--ink-faint`）
- `--fs-h3` 的结论句，取 `attentionShift`
- 下方一行 `--fs-small` 补充，取 `createdCount` 与 `rarelyOpenedOver90Days`

**不加左侧色条。** 见 0.3。

### E.2 指标条

四格等宽，数值 `--fs-h1`、`font-variant-numeric: tabular-nums`，下方 label 与环比。数据源：`createdCount`、`rarelyOpenedOver90Days`、`health.deadLinks`、`health.largeFolders`。环比数字用 `--positive` / `--negative`——这是本页少数允许用彩色的地方，因为颜色在编码「变好还是变坏」。

### E.3 主题变化图

`TopicTrend[]`（`topic` / `current` / `previous`）画成条形对比：上层细条是 `previous`（`--line-strong`），下层粗条是 `current`（`--accent`），右侧对齐数值。加图例说明两条分别是什么。

### E.4 知识缺口

`KnowledgeGap[]` 的 `angleCount` 是已覆盖的内容角度数（满分 4：入门/实践/对比/深入）。渲染成 `主题 —— n / 4` 的列表，块副标题里写明 4 的含义，否则读者不知道分母是什么。

### E.5 唯一真正缺的数据

时间序列。现结构只有「本期/上期」两个点。每条收藏都带 `dateAdded`，**按天分桶是纯计算、不需要新采集**。本批可做可不做，做的话在 `knowledge-insights.ts` 的 `report()`（330–383）里加一个 `dailyCounts` 字段。

---

## 批次 F · 主题图谱（`TopicsView`）

### F.1 现状问题

`TopicGraphView`（80–147）在 87–99 行按**数组下标**把节点均分角度排在两个同心圆上（前 8 个内圈、其余外圈）。**位置这一最强视觉通道不携带任何信息**，导致所有连线都是穿过圆心的弦。产品评价「过于简陋」，并明确要求「不要平面的、要更炫酷」。

### F.2 技术选型：Canvas 2D，不引入 Three.js

三维力导向 + 透视投影 + 深度排序，约 200 行，无新依赖。Three.js 压缩后约 600KB，对一个扩展的包体积是显著代价，而这里只需要点、线和深度排序，用不到材质、光照、场景图。样张 `docs/design/style-samples.html` 里是完整可运行的实现，**直接移植，不要重写**。

现有数据（`TopicGraphNode{id,label,count}`、`TopicGraphEdge{source,target,weight}`，上限 24 节点 / 60 边）足够，不需要新增字段。

### F.3 移植时必须带走的四个修正

这四个都是踩过的坑，样张代码里留了注释：

1. **半径公式不能有常数项。** 球体面积正比于收藏条数，即 `r = 3.2 * sqrt(count)`。原型早期写成 `5.5 + sqrt(count) * 2.1`，那个常数把量级差压平了——3 条与 31 条只差 1.9 倍，产品直接看出来「大部分看起来都差不多大」。
2. **透视对半径的影响要压缩。** 完整透视下近处的小节点会比远处的大节点还大，直接摧毁「大小=数量」这条读法。做法是 `screenRadius = baseRadius * pow(scale, 0.45) * 1.3`，位置仍用完整透视。
3. **斥力要加距离截断。** 零连接的孤岛主题只受斥力、不受任何引力约束，会被推到距中心约 4000 的位置。加 `3.2k` 截断并线性衰减后，孤岛主题稳定停在最外圈——正好是想要的语义。
4. **点云归一化只按连通节点定标。** 按全部节点的最大距离定标时，两个孤岛主题会把连通主体压在中间一小团。

另外两个必须做对的细节：模拟输出未归一化时透视分母可能变负，导致 `arc()` 收到负半径抛异常、画布全空，所以归一化到固定 `CLOUD_RADIUS = 205` 并给分母加下界；标签要**独立第二遍绘制**，与球体交错绘制时会被前排球体盖住。

### F.4 三维的代价与配套

投影会压平纵深，24 个节点全部标注必然叠字，因此只固定标注最靠前的 11 个，其余靠旋转与悬停显示。**静态截图是三维图谱的最差情况，动起来可读性明显更好。**

为此配一个**问题面板**，全部由现有数据实时算出、无写死结论：

- 主题社区（标签传播算法做社区发现，命名取该社区里收藏最多的主题）
- 孤岛主题（`degree === 0`）
- 收藏多但关联少（`count / degree` 排序取前三）

三维负责空间直觉与观感，面板负责给出精确可读的结论，两者配合才同时满足「炫酷」与「真实反映问题」。

### F.5 面板必须放在图谱下方，不能放右侧

右侧结构下主题数一多面板就变长，会把图谱一起拉高。改成通栏图谱（高 500px）+ 下方三栏 `repeat(auto-fit, minmax(260px, 1fr))`，两者高度彻底解耦。**每栏最多列 5 行，其余折成一行「还有 N 个」**，主题数从 24 涨到 200 也不会改变面板高度。

### F.6 交互

拖动旋转、滚轮缩放、悬停高亮邻居并显示读数浮层、无操作时自动缓慢旋转。

**拖拽方向容易做反：** 近处的点 z 为负，`yaw` 增大会让正面往左走。要符合「抓住球往右拖、正面跟着往右转」的直觉，`yaw` 必须减去横向位移（`yaw -= dx * 0.006`）。俯仰方向不需要取负。

### F.7 验收

- 拖拽方向符合直觉，缩放范围 0.55–2.4 内不出现负半径异常。
- 节点半径与 `count` 的平方根成正比：取最大和最小两个节点量屏幕半径，比值应接近 `sqrt(countMax / countMin)`。
- 主题数扩到 60 时面板高度不变、图谱不被拉高。
- 控制台无报错。

---

## 批次 G · 其余三个 tab

整理提案 / 待读队列 / 重新发现。这三个的内容结构本身没有大问题，主要是接 token、去掉 SaaS 感的密度、统一空态与加载态。

同时收掉跨界面分裂：

- 同一条收藏在侧边栏是 `bookmark-row`（48px 缩略图）、网页端是 `resource-card`（32px）→ 合并为一个组件，靠密度档区分。
- 搜索框（`library-search` vs `search-box`）、空态（`native-empty` vs `empty-state`）、加载态、错误提示各有两套 → 各留一套。
- 危险按钮 `.danger-button` 与 `.button-danger` 同义异名 → 留 `.button-danger`。

---

## 批次 H · 深色模式与收尾

深色模式在批次 A 就已经进 token 层——**此时成本最低，之后补要重扫所有颜色**。本批只做验证与修补：

- 两个 HTML 的 `color-scheme` 改为 `light dark`。
- 逐屏检查深色下的对比度，重点是图表调色板与 `--surface-sunken` 的区分度。
- 检查 `box-shadow`：深色底上黑色阴影不可见，需要的地方改用边框区分。

最后重跑第 1 节的设计维度实测，与现状对照记录进 `AGENT_PROGRESS.md`：

| 维度 | 现状 | 目标 |
| --- | ---: | ---: |
| 硬编码颜色 | 210 | 0 |
| 阴影 | 31 | 2 |
| 圆角 | 20 | 4 |
| 字号 | 19 | 7（两档密度各 7 档） |
| 字重 | 13 | 3 |
| 过渡时长 | 9 | 2 |
| margin / padding / gap 取值 | 29 / 26 / 16 | 各 ≤ 8（`--sp-1..8`） |

---

## 明确不做的事

- **不做侧边栏的结构重构。** 只接 token（批次 B）。它是日常主力界面且刚被打磨过，结构性改动的回归风险与收益不成比例。
- **不引入 Three.js 或任何新的 UI 依赖。** 理由见 F.2。
- **不新增任何数据采集字段。** 报告和图谱要的数据全都已经在 `LibraryReport` / `TopicGraph` 里，只是被渲染成了文字。唯一的例外是 E.5 的时间序列，那也是对 `dateAdded` 的纯计算。
- **不在这一轮碰 F14 云端同步相关的界面。**

---

## 需要真机验收的清单

单元测试覆盖不到的，必须在真实 Chrome 里逐条确认：

1. 侧边栏纯白与 Chrome 容器无接缝（浅色、深色各一次）。
2. 输入框随内容增高至 112px 后内部滚动，删字回落。
3. 列表滚动时上下渐隐随位置变化。
4. 收藏库四个宽度下的列数，以及悬停时区块总高不变（用脚本量，不靠肉眼）。
5. 图谱拖拽方向、缩放边界、悬停高亮。
6. 六个 tab 之间来回切换不丢状态、不报错。
7. 深色模式下逐屏对比度。

---

## 建议的执行顺序与并行边界

A → B → C 必须串行，C 完成后 D / E / F / G 可以并行（各自只碰 `src/ui/manager/views/` 下的一个文件加 `manager.css` 的一段），H 最后收口。

**并行时在 `AGENT_PROGRESS.md` 的「并发占用登记」里写明自己持有哪个文件。** 这个项目已经发生过两次多 Agent 同时改 `SidePanelApp.tsx` 和 `styles.css` 导致互相覆盖的情况。
