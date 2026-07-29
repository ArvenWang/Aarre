# Aarre 商店视觉材料

更新日期：2026-07-30

## 已交付

| 文件 | 规格 | 内容 |
| --- | --- | --- |
| `screenshots/00-search.jpg` | 640×400 JPEG | 侧边栏本地搜索 |
| `screenshots/01-organize.jpg` | 1280×800 JPEG | 整理提案与安全确认 |
| `screenshots/02-report.jpg` | 1280×800 JPEG | 周报、知识缺口与健康度 |
| `screenshots/03-topics.jpg` | 1280×800 JPEG | 主题图谱 |
| `promo-small.jpg` | 440×280 JPEG | Chrome Web Store 小型宣传图 |
| `aarre-overview-36s.mp4` | 1280×800、30fps、H.264/AAC、约 36 秒 | 四段中文字幕功能导览 |

`promo-small.html` 与 `video-frame.html` 是可复现的画面源文件；`video-frames/` 是最终视频使用的逐段画面。

## 数据与真实性边界

截图和视频直接来自与生产界面共用的 React 组件，但书签名称、数量与洞察使用开发期专用的代表性场景，目的是避免把私人书签带进公开素材。它们只证明界面和文案已经形成，不证明 Chrome 扩展权限、原生书签写入或真实 IndexedDB 升级已经完成安装态验收。

正式上传前须把同版本 `dist/` 加载到 Chrome，逐屏核对截图中的能力与安装版一致；若有任何差异，必须重新采集。

## 仍需外部完成

- Chrome Web Store 后台生成正式 Extension ID。
- 把隐私政策发布到公开 HTTPS 地址。
- 如果发布有声版，补录旁白并在对外页面披露 AI 配音；当前视频为可独立理解的中文字幕版。
