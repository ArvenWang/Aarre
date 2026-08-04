# Aarre 启动性能基线

测量时间：2026-08-04T15:13:39.692Z

## 构建产物

- Service Worker 主包：326404 bytes
- 侧边栏首屏 CSS：72835 bytes
- 侧边栏入口 JS：65983 bytes

## 真实 Chrome 运行时

当前环境未能启动可加载 MV3 扩展的真实 Chrome；运行时数据待真机验收。

失败原因：browserContext.waitForEvent: Timeout 15000ms exceeded while waiting for event "serviceworker"

运行命令：`npm run measure:startup`
