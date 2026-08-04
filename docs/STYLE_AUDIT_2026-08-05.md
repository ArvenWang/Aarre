# Aarre 样式系统审计 · 2026-08-05

审计范围：侧边栏、设置、Agent、书签编辑、网页端收藏库、整理与报告。重点检查 icon、按钮、输入框、下拉框、列表行、主题 token、响应式与可访问性。

## 结论

**Anti-pattern verdict：通过，但设计系统仍处于“统一了一半”的阶段。** 当前界面已经没有明显的 AI 紫色、渐变文字、无意义毛玻璃或常驻卡片堆叠；本轮也把历史会话和最近动作收敛成“透明行、整行 hover”。主要问题已经不是视觉方向，而是底层仍有两套 icon、过多页面级控件样式和未被 token 检查覆盖的几何常量。

- 综合质量：**82 / 100**
- 高优先级：2 项
- 中优先级：4 项
- 低优先级：2 项
- 自动运行态审计：亮色 **0 项**，暗色 **0 项**
- 设计 token 自动检查：通过
- 窄屏运行态：未发现横向溢出或控件文字裁切

## 高优先级

### H1 · icon 存在两套事实源

- 位置：`src/ui/components/Icons.tsx`、`src/lib/icon-context.tsx`
- 类别：一致性 / 可维护性
- 现状：侧边栏使用约 20 个手写 SVG，另一套组件通过 `icon-context.tsx` 使用 Lucide。两套系统有不同的默认尺寸、strokeWidth 和 hover 加粗方式。
- 影响：同一个“关闭、添加、设置、历史”等语义可能出现不同轮廓、视觉重量和尺寸；每次修 icon 都需要同时检查 JSX、Button utility 和页面 CSS。
- 建议：以 `icon-context.tsx` 的 Lucide map 为唯一事实源；侧边栏逐步改用 `useIcon` 或 Button 的 `leadingIcon/trailingIcon`，迁移完成后删除 `Icons.tsx`。尺寸统一使用 `--icon-xs/sm/md/lg`。

### H2 · `--ink-faint` 用于正文型辅助信息时不满足 WCAG AA

- 位置：`src/ui/tokens.css` 及 33 个 CSS 使用点
- 类别：可访问性 / 主题
- 证据：浅色 `#a0a5aa` 对白色对比度约 **2.48:1**；暗色 `#676d72` 对 `#16181b` 约 **3.39:1**，低于普通文本 4.5:1。
- 影响：时间、摘要、占位符和次级说明对低视力用户过淡；截图中历史摘要和时间已经能观察到这个问题。
- 建议：新增满足 AA 的 `--ink-subtle`，正文型辅助信息改用它；`--ink-faint` 只保留给装饰、禁用态和非必要提示。随后增加真实计算后的对比度测试。

## 中优先级

### M1 · 几何尺寸尚未真正收敛到 token

- 类别：主题 / 一致性
- 证据：静态扫描发现根 CSS 中约 **198** 行仍直接使用 px 几何值，其中 **127** 处是常见 width/height 常量。现有 `check-design-tokens.ts` 只强制颜色、圆角、字号和字重，没有覆盖 icon 尺寸、控件宽高与常用间距。
- 影响：设计检查显示“通过”，但 14/15/16/18px icon、30/32/34/36px 控件仍会继续漂移。
- 建议：扩展检查器：SVG 尺寸必须使用 icon token；交互控件高度必须使用 `--control-h-*`；间距只允许 `--sp-*` 或少量登记过的布局尺寸。响应式画布、图表和动态测量值加入明确白名单。

### M2 · 共享组件之外仍有大量页面级控件配方

- 类别：可维护性 / 一致性
- 证据：约 **71** 个 `.button/.input/.select/.control/.trigger/.action` 类规则，约 **100** 个直接针对 button/input/select/textarea 的 CSS 选择器；Button 使用中 ghost 74 次，很多页面再用 CSS 覆盖 ghost 自带 hover。
- 影响：一个控件最终外观由 Button variant、ShapeContext、Tailwind utility 和页面 CSS 四层共同决定，容易再次出现“子按钮 hover 与整行 hover 打架”。
- 建议：建立四个正式 recipe：`InteractiveRow`、`FieldControl`、`QuietDangerAction`、`SettingsAction`。页面只负责布局，不再重绘 hover、边框和 icon 尺寸。

### M3 · 触控命中区普遍小于 44px

- 类别：响应式 / 可访问性
- 证据：运行态抽样中，侧边栏大量 header/icon action 为 32px，输入框为 36px；管理页编辑按钮也为 32px。桌面鼠标没有操作问题，但不满足 WCAG 2.5.8 的 24px 最低目标之外更稳妥的 44px 触控建议。
- 影响：触屏 Chromebook、缩放环境和运动控制较弱用户更容易误触。
- 建议：视觉尺寸保持 32–36px，但通过伪元素或外层 hit-area 把主要 icon action 的可点击区域扩到 `--control-h-touch`；密集卡片内的次级操作至少达到 32px，并保留整卡主命中区。

### M4 · 相同 AI 配置在 onboarding 与设置页使用不同控件模型

- 位置：`OnboardingPage.tsx` 使用 TabsSubtle；`AiServiceSection.tsx` 使用“服务 + 模型”下拉。
- 类别：产品一致性
- 影响：用户首次配置时学习的是“先选服务商、再填模型”，进入设置后变成一个合并下拉；同一概念有两种操作心智。
- 建议：将合并下拉提取为 `AiModelSelect`，onboarding 与设置共用；只读/编辑状态由外部 props 控制。

## 低优先级

### L1 · 存在明确的无引用 CSS

候选包括：

- `settings-onboarding-section`
- `settings-cloud-controls` / `settings-cloud-status` / `settings-sync-progress*`
- `sidepanel-boot-*`
- `native-check` / `smart-layer-required`
- `text-button-danger`
- `snapshot-backfill-foreground-note`

这些选择器在当前源码和静态页面中没有引用。建议在下一轮 token/recipe 迁移时删除，并用源码守卫阻止已删除类回流。

### L2 · token 与 Button variant 有未使用项

- 未使用 token 共 9 个，包括 `--radius-xl`、`--radius-nested-lg`、`--radius-inset-module`、`--radius-compact`、`--scrim-strong`、`--scrim-ink-muted`、`--control-h-button`、`--icon-md`、`--icon-lg`。
- `danger-quiet` Button variant 在本轮删除按钮统一后已无调用方。
- 建议：先确认未来 roadmap 是否需要；无明确近期用途的删除，避免 token 表成为历史仓库。

## 正向发现

- 颜色、圆角、字号、字重已经有自动 token 门，且本轮保持全绿。
- Button、FluidInput、Radix Select 已覆盖绝大多数业务控件；业务组件没有重新引入裸 button/input。
- icon-only Button 的尺寸与 aria-label 有源码守卫，本次扫描未发现无名称 icon 按钮。
- 亮色/暗色运行态 hover 审计均为 0 项。
- `prefers-reduced-motion`、键盘 focus-visible、hover-none 和窄屏规则均已存在。
- 侧边栏与 480px 管理页没有横向溢出。

## 优化方案

### P0 · 本轮后立即做

1. 把 `--ink-subtle` 和对比度自动测试落地，替换正文型 `--ink-faint`。
2. 扩展 token 检查器，覆盖 icon 尺寸和控件高度。
3. 删除无引用 CSS、无引用 token 和无调用方的 `danger-quiet`。

### P1 · 下一轮设计系统收口

1. 统一到 Lucide / IconContext，删除手写 `Icons.tsx`。
2. 提取 `InteractiveRow`、`QuietDangerAction` 和 `AiModelSelect`。
3. onboarding 与设置页共用 AI 模型下拉。
4. 把 FolderSelect 的 trigger/popover 外观接入共享 Select surface recipe，同时保留“新建文件夹”业务能力。

### P2 · 可访问性与触控

1. 为 header icon action、row menu 和卡片编辑按钮增加 44px hit-area。
2. 对侧边栏、管理页宽窄屏运行 axe/WCAG 自动检查。
3. 加入 200% 字体缩放、键盘全流程和触控设备真人验收。

## 建议使用的后续命令

- `/normalize`：统一 icon、控件 recipe 和 token 使用。
- `/harden`：补可访问性、键盘与触控边界。
- `/optimize`：处理大列表 DOM 与多实例 backdrop-filter 的性能成本。
- `/audit`：完成 P0/P1 后重新审计，确保删除的样式没有回流。
