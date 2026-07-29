# Aarre 通用分类封面基准集

本目录保存 Aarre 网站缺省封面的完整单变体基准集：16 个网页类型封面、23 个主题封面和 1 个普通网页封面，共 40 张。

这些图片目前只接入 `?preview=1` 本地开发评审页，不改变真实 Chrome 书签的封面逻辑，也不会进入正式 `dist/`。

## 视觉校准

用户对第二批素材提出两次关键修正：

1. 第一版物体过于规整、笔触太紧，像标准图标。
2. 随后的松弛版又把主体拆得过于抽象，需要猜类别。

最终统一采用“70% 明确物体 + 30% 轻隐喻”：

- 第一眼必须认出书、屏幕、硬币、心形、购物袋等主体。
- 隐喻只发生在一个局部：一条线穿过、一个角生长、一个物体轻微转化。
- 用宽头笔的松弛线条、轻微游移的轮廓、不同线宽、不完整接缝、不均匀比例和适度偏心制造手绘感。
- 不再用完美圆、笔直边、对称轴和封闭几何制造“标准图标感”。
- 也不把主体拆成孤立的点和曲线，不让用户猜谜。

共享提示词骨架：

```text
Square editorial cover for a 48px bookmark fallback. Anthropic editorial
illustration language based on the supplied references, with an original
composition. Full-bleed opaque accent field, one generous irregular ivory
#FAF9F5 carrier, near-black #141413 marks. About 70% unmistakable everyday
object and 30% gentle visual metaphor. The category must read immediately;
only one small part may transform, connect, grow, escape, or reveal a
relationship. Relaxed broad felt-marker drawing, 5–10 unhurried gestures,
wandering contours, variable thickness, rounded ends, imperfect joins,
uneven proportions, mild asymmetry and generous breathing room.
```

每张图另附自己的主体、局部隐喻、强调色和排除项。

## 16 个网页类型封面

| 分类 | 文件 | 背景色 | 主体与轻隐喻 |
| --- | --- | --- | --- |
| Web 工具 | `web-tool-v1.png` | cactus `#BCD1CA` | 浏览器窗口中的光标拉出一个软形状 |
| 工作后台 | `work-dashboard-v1.png` | oat `#E3DACC` | 控制面板后方露出一条系统管线 |
| 代码仓库 | `code-repository-v1.png` | cactus `#BCD1CA` | 文件夹中的代码括号 |
| 文档与 API | `documentation-api-v3.png` | oat `#E3DACC` | 单一插头直接表达 API 的连接能力 |
| 教程与课程 | `tutorial-course-v1.png` | sky `#6A9BCC` | 从书脊升起的步骤点通向火花 |
| 论文与研究 | `paper-research-v1.png` | heather `#CBCADB` | 放大镜让纸上的三个研究点显现 |
| PDF 与报告 | `pdf-report-v1.png` | clay `#D97757` | 报告页最下方的摘要线穿出纸边 |
| 数据与图表 | `data-chart-v1.png` | olive `#788C5D` | 图表终点离开边界成为洞察 |
| 视频 | `video-v2.png` | fig `#C46686` | 播放三角轻微穿出画面边框 |
| 音频与播客 | `audio-podcast-v1.png` | fig `#C46686` | 麦克风声波末端转成倾听耳廓 |
| Newsletter / RSS | `newsletter-rss-v1.png` | coral `#EBCECE` | 信纸一角延伸成订阅信号 |
| 购物与产品 | `shopping-products-v2.png` | clay `#D97757` | 购物袋提手与产品吊牌共用一条线 |
| 地点与地图 | `place-map-v1.png` | sky `#6A9BCC` | 地图路线自然卷成定位针 |
| 活动与票务 | `event-ticket-v1.png` | clay `#D97757` | 票券撕角释放一个庆祝火花 |
| 职位与招聘 | `job-career-v2.png` | cactus `#BCD1CA` | 公文包提手延伸成一颗机会星 |
| 作品集与画廊 | `portfolio-gallery-v2.png` | fig `#C46686` | 一只手展开三张作品卡 |

## 23 个主题封面

| 分类 | 文件 | 背景色 | 主体与轻隐喻 |
| --- | --- | --- | --- |
| AI 与自动化 | `ai-automation-v1.png` | heather `#CBCADB` | 侧面头部中的三个连接节点 |
| 开发与软件 | `development-software-v1.png` | cactus `#BCD1CA` | 代码括号间长出带节点的分支 |
| 数据与云 | `data-cloud-v1.png` | sky `#6A9BCC` | 云中的散点落入托盘后变得有序 |
| 安全与隐私 | `security-privacy-v1.png` | heather `#CBCADB` | 手形曲线保护一把闭眼的锁 |
| 硬件与设备 | `hardware-devices-v1.png` | oat `#E3DACC` | 芯片的一根引脚延伸成触碰火花 |
| 设计与创作 | `design-creation-v1.png` | fig `#C46686` | 手持铅笔画出一条线 |
| 艺术创作 | `art-creation-v2.png` | fig `#C46686` | 调色盘的一处颜料逸出为自由笔触 |
| 商业与创业 | `business-startup-v1.png` | clay `#D97757` | 店铺屋顶的一角折成起飞的纸飞机 |
| 工作与效率 | `work-productivity-v1.png` | cactus `#BCD1CA` | 清单最后一行在纸外完成勾选 |
| 教育与科学 | `education-science-v2.png` | heather `#CBCADB` | 实验烧瓶的瓶颈转化为铅笔 |
| 财经与投资 | `finance-investing-v3.png` | olive `#788C5D` | 手掌托住硬币，边缘长出一片叶子 |
| 新闻与社会 | `news-society-v1.png` | sky `#6A9BCC` | 报纸一角打开成公共对话气泡 |
| 健康与医疗 | `health-medical-v2.png` | coral `#EBCECE` | 心形脉冲末端长出一片叶子 |
| 运动与健身 | `sports-fitness-v1.png` | olive `#788C5D` | 跑鞋鞋带延伸成弹跳轨迹 |
| 美食与烹饪 | `food-cooking-v1.png` | clay `#D97757` | 锅上升起叶形蒸汽 |
| 旅行与地点 | `travel-places-v3-suitcase.png` | sky `#6A9BCC` | 带吊牌的旅行箱 |
| 居家与家庭 | `home-family-v1.png` | coral `#EBCECE` | 延长的屋顶线遮护门旁两个家庭节点 |
| 消费与时尚 | `consumer-fashion-v1.png` | fig `#C46686` | 衣架挂钩延伸成风格火花 |
| 汽车与出行 | `automotive-mobility-v1.png` | clay `#D97757` | 后轮轮廓延伸成行驶路径 |
| 房产与居住 | `real-estate-housing-v1.png` | oat `#E3DACC` | 钥匙的轴线进入房屋门槛 |
| 娱乐与文化 | `entertainment-culture-v2.png` | fig `#C46686` | 舞台幕布拉开并露出一颗星 |
| 游戏与爱好 | `games-hobbies-v1.png` | olive `#788C5D` | 手柄线缆卷成一颗玩心星星 |
| 自然与宠物 | `nature-pets-v1.png` | olive `#788C5D` | 爪印的一枚趾垫打开成叶子 |

## 中性封面

| 分类 | 文件 | 背景色 | 主体与轻隐喻 |
| --- | --- | --- | --- |
| 普通网页 | `generic-webpage-v1.png` | heather `#CBCADB` | 一条网络连接线穿过空白网页并围绕节点 |

## 验证

- 40 张基准图均为 `1254 × 1254`、sRGB、不透明 PNG。
- 每张图最终仅包含三个精确颜色：近黑、象牙白和对应强调色。
- 当前活动基准对应 40 张 `384 × 384`、无透明通道的 lossless WebP，合计 `880,546` 字节（约 `0.84 MiB`）。`webp-384/` 另保留 7 张被替换的旧版本，因此目录内共有 47 个文件；生产接入应只使用表格列出的当前版本。
- 完整标注总览为 `preview-complete-40-contact-sheet.png`。
- 真实 `48 × 48` 总览为 `preview-complete-40-48px.png`；40 张均保留可识别主体。
- 本地开发预览地址：`http://127.0.0.1:4173/sidepanel.html?preview=1`。
- `src/ui/sidepanel/preview.ts` 将 40 张封面绑定到 40 个真实公开网站示例，并置于本地预览列表最上方。
- 浏览器在 `433 × 909` 与 `390 × 844` 两种侧栏尺寸完成逐段滚动检查：40 张均从 `1254 × 1254` 源图加载并以 `48 × 48` 显示，无破图、无横向溢出，控制台和页面错误均为 0。
- 文件夹展开、收起和密集列表滚动通过真实鼠标交互检查。
- 页面截图为 `preview-local-40-top.png`、`preview-local-40-middle.png`、`preview-local-40-bottom.png`、`preview-local-40-narrow-top.png` 和 `preview-local-40-narrow-bottom.png`。
- `npm run check` 通过：13 个测试文件、54 个测试、类型检查和生产构建全部成功。
- 正式 `dist/` 中没有 `taxonomy-pilot`、40 类预览数据或分类封面引用。

## 归档与生产边界

- 用户选中的旅行图为 `travel-places-v3-suitcase.png`；其余五个旅行方案仍保留作过程记录，不进入当前 40 类预览。
- 被替换的旧版本继续保留用于版本对比；当前基准以表格中的版本号为准。文档与 API、财经与投资已更新到 `v3`；职位与招聘、作品集与画廊、艺术创作、教育与科学、娱乐与文化已更新到 `v2`。
- 过度抽象、仅剩点线关系，以及文档与 API 的两张复杂连接中间稿没有复制进工作区。
- 当前 40 张已经达到新版 PRD 的“40 类、一类一张”资产上限；3–6 个变体的旧建议已撤销，`384 × 384` WebP 也已导出。进入生产还需要接入真实封面选择管线，并由显示层按域名哈希做轻微明度偏移；不能把本次开发预览接入误报为生产管线已经完成。
