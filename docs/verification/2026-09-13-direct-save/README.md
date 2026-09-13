# Aarre 0.6.12 收藏直接展开

已复现两个独立原因：宿主先使用 448px 占位高度；外层弹窗淡入让收藏首页透出。图片来自真实扩展与隔离 Chrome，本地网页仅作为来源，不替代产品流程。

修复：确认当前请求的实际表单已提交且内容尺寸就绪后再显示，禁用收藏页的底板拉伸及外层透明/缩放动画；取消和关闭立即收起；主菜单仍使用既有共享动画。准备中取消、晚到回执、重复点击及超时有针对性覆盖。没有等待 AI 返回才开表单。

验证：最终 25 项真实浏览器检查、6 文件 43 项针对性回归通过，类型/设计/构建通过。最早出现的实际表单截图已经目视确认；未重新验证联网 AI、手机、云同步、日常安装态。测试不修改日常 Chrome 数据。

复现脚本：`node scripts/verify-floating-save-transition.mjs`，需要本项目和相邻 LayerScope 项目的 dist。可用 SUITE_ARTIFACT_DIR 指定输出目录。首次排查的运行日志和完整前后备份保存在 `work/save-transition-20260913/`，最终有效记录为 `verified-final/`；其他目录为排查中间态，不代表最终通过。

渲染时序参考：[requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)、[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)。
