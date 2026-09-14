# Aarre · 拾集 A1 聚拢 — Figma 矢量成稿

本目录对应用户已选定的 A1 聚拢。没有调用生图 API。

已在用户指定的 DesignThinking / minitools 页面完成，位于 Align 原稿下方。原有 Align 图稿保留。

- [查看成稿、尺规构造与实际尺寸](https://www.figma.com/design/u5KlPWzuoMDQBPdO0lP6Mp/DesignThinking?node-id=7387-8839)
- [打开可编辑组件母版](https://www.figma.com/design/u5KlPWzuoMDQBPdO0lP6Mp/DesignThinking?node-id=7390-8878)

成稿包含三个独立原生矢量形状、九个原生构造圆、公切线、圆心与半径标记。2 个标志母版（Regular / Micro）和 6 个图标变体（三种配色 × 两种光学尺寸）均可编辑，样例使用真实组件实例，颜色绑定四个 Aarre 品牌变量。

建议：16–20px 使用 Micro，24px 及以上使用 Regular。Micro 将各构造圆半径减少 2u，最短间隙由约 5.6u 增至约 9.6u。图标容器为 128u / R30，内部标志 112u，四周 8u。

- 参考：`../2026-09-13-aarre-brand-refinements/A1-cabinet-cluster.png`。
- `geometry.json`：128u 标志坐标、9 个构造圆、共切线、标准和 Micro 两套路径。
- `geometry.cjs`：自主绘制的几何算法。各石形采用三个不同半径圆的凸包；圆弧按切向连续的三次 Bézier 表达，并保留原圆数据。
- `geometry-metrics.json`：边界采样得到的三处近似最短间隙，用于排列调整，不是虚构的整齐整数。
- `construction-study.svg` / `construction-study.png`：本地几何准备稿；**不是 Figma 截图**。
- `figma-*.js`：本轮实际 Figma 原生矢量、组件、构造图与排版脚本；再次执行前应先读取 `figma-state.json`，避免重复创建。
- `figma-review.png` / `figma-components.png`：最终 Figma 实际截图。
- `assets/`：Figma 原生导出的 8 个 SVG 和 7 个 Poppy PNG（16、20、24、32、48、64、128px）；没有用代码替换 Figma 导出内容。
- `exports.json`：导出尺寸与 SHA-256；`figma-verification.json`：最终结构和检查结果。

已目视检查最终展示稿与组件；实际尺寸实例与 PNG 均匹配标注，SVG 均为三个路径，新增 Figma 内容没有图片填充。辅助圆弧通过圆的公切线构造，转为三次 Bézier 时保留切向连续性；Figma 的浮点及曲线表达可能产生微小数值近似。

本轮未替换插件资源、构建或安装态；既有品牌方案保留。
