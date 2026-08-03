# Aarre 启动性能基线

测量时间：2026-08-03T21:27:29.802Z

## 构建产物

- Service Worker 主包：144625 bytes
- 侧边栏首屏 CSS：71899 bytes
- 侧边栏入口 JS：62485 bytes

## 真实 Chrome 运行时

当前环境未能启动可加载 MV3 扩展的真实 Chrome；运行时数据待真机验收。

失败原因：browserContext.waitForEvent: Timeout 15000ms exceeded while waiting for event "serviceworker"

运行命令：`npm run measure:startup`
