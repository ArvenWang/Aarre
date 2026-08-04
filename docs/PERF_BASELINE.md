# Aarre 启动性能基线

> **2026-08-04 校正：** 原 144625 bytes 后台主包通过动态 `import()` 把代码移到 lazy chunks，但 Chrome 官方明确说明扩展 MV3 Service Worker 不支持 `import()`。该产物会在运行时失败，不能作为有效性能基线。当前合法 library/worker 构建把后台模块内联为单个 ESM 文件：880080 bytes（gzip 290040 bytes），`import()` 与 Vite client 预加载助手均为 0；真实冷启动时间仍待安装态 Chrome 重新测量。侧边栏 CSS/JS 数据不受影响。

测量时间：2026-08-03T21:27:29.802Z

## 构建产物

- Service Worker 主包：880080 bytes（已校正；原 144625 bytes 无效）
- 侧边栏首屏 CSS：71899 bytes
- 侧边栏入口 JS：62485 bytes

## 真实 Chrome 运行时

当前环境未能启动可加载 MV3 扩展的真实 Chrome；运行时数据待真机验收。

失败原因：browserContext.waitForEvent: Timeout 15000ms exceeded while waiting for event "serviceworker"

运行命令：`npm run measure:startup`
