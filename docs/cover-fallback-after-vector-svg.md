# Aarre 封面兜底率测量

- 样本：300 条（原始可用 URL 414 条）
- 模式：themed
- 测量时间：2026-07-30T08:12:29.989Z
- 分类封面兜底：153 条 / 51%
- 最大缩放比：1（要求不超过 1）

## 来源分布

| 来源 | 数量 | 占比 |
| --- | ---: | ---: |
| registry | 3 | 1% |
| apple-touch-icon | 98 | 32.67% |
| manifest | 9 | 3% |
| high-resolution-rel-icon | 35 | 11.67% |
| og-image | 2 | 0.67% |
| category-fallback | 153 | 51% |

## 质量闸门拒绝

### below-128px（23）

```json
[
  {
    "pageUrl": "http://www.jeffhandesign.com/[path-8a5edab2]",
    "assetUrl": "https://cdn.myportfolio.com/[path-edf6e9b7].jpg",
    "source": "large-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://devouringdetails.com/[path-8a5edab2]",
    "assetUrl": "https://devouringdetails.com/[path-78108a7d].png",
    "source": "apple-touch-icon",
    "nativeWidth": 100,
    "nativeHeight": 100
  },
  {
    "pageUrl": "https://diana.lu/[path-26223c06]",
    "assetUrl": "https://framerusercontent.com/[path-63eb4dbc].png",
    "source": "large-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://collectui.com/[path-8a5edab2]",
    "assetUrl": "https://collectui.com/[path-78108a7d].png",
    "source": "large-icon",
    "nativeWidth": 80,
    "nativeHeight": 80
  },
  {
    "pageUrl": "https://github.com/[path-91e96fa8]",
    "assetUrl": "https://github.com/[path-43f0533a].png",
    "source": "registry",
    "nativeWidth": 120,
    "nativeHeight": 120
  },
  {
    "pageUrl": "https://animejs.com/[path-8a5edab2]",
    "assetUrl": "https://animejs.com/[path-379bfe54].png",
    "source": "large-icon",
    "nativeWidth": 64,
    "nativeHeight": 64
  },
  {
    "pageUrl": "https://doc.weixin.qq.com/[path-e91ca852]",
    "assetUrl": "https://wwcdn.weixin.qq.com/[path-27782040].png",
    "source": "large-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "http://mockuphone.com/[path-8a5edab2]",
    "assetUrl": "https://mockuphone.com/[path-c4e11276].png",
    "source": "large-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "http://www.iconfont.cn/[path-8a5edab2]",
    "assetUrl": "https://img.alicdn.com/[path-952c2662].png",
    "source": "apple-touch-icon",
    "nativeWidth": 114,
    "nativeHeight": 114
  },
  {
    "pageUrl": "https://www.thiings.co/[path-583f2e21]",
    "assetUrl": "https://www.thiings.co/[path-78108a7d].png",
    "source": "large-icon",
    "nativeWidth": 80,
    "nativeHeight": 80
  },
  {
    "pageUrl": "https://www.futuretools.io/[path-8a5edab2]",
    "assetUrl": "https://futuretools.io/[path-ebc7d153].png",
    "source": "apple-touch-icon",
    "nativeWidth": 134,
    "nativeHeight": 81
  },
  {
    "pageUrl": "https://www.aicpb.com/[path-ab6ff45f]",
    "assetUrl": "https://www.aicpb.com/[path-78108a7d].png",
    "source": "large-icon",
    "nativeWidth": 64,
    "nativeHeight": 64
  }
]
```

### non-square（0）

```json
[]
```

### low-ink-or-contrast（2）

```json
[
  {
    "pageUrl": "https://kasumi-docs.vercel.app/[path-8a5edab2]",
    "assetUrl": "https://kasumi-docs.vercel.app/[path-78108a7d].png",
    "source": "large-icon",
    "nativeWidth": 1024,
    "nativeHeight": 1024
  },
  {
    "pageUrl": "https://www.fluidfunctionalism.com/[path-8a5edab2]",
    "assetUrl": "https://www.fluidfunctionalism.com/[path-ea055fc9].png",
    "source": "apple-touch-icon",
    "nativeWidth": 180,
    "nativeHeight": 180
  }
]
```

## 分类兜底域名 Top 30

| 域名 | 条数 |
| --- | ---: |
| 3dpresso.ai | 2 |
| animejs.com | 2 |
| app.artflow.ai | 2 |
| app.exactly.ai | 2 |
| app.meshy.ai | 2 |
| blog.sina.com.cn | 2 |
| book.douban.com | 2 |
| cli.im | 2 |
| clipdrop.co | 2 |
| cowtransfer.com | 2 |
| designsparks.io | 2 |
| doc.weixin.qq.com | 2 |
| generative-dynamics.github.io | 2 |
| home.blusea.cn | 2 |
| huggingface.co | 2 |
| iconly.pro | 2 |
| mcp.composio.dev | 2 |
| mockuphone.com | 2 |
| openxlab.org.cn | 2 |
| prompts.chat | 2 |
| rotato.app | 2 |
| useyourinterface.com | 2 |
| v.mp3juices.click | 2 |
| weavesilk.com | 2 |
| www.aicpb.com | 2 |
| www.futuretools.io | 2 |
| www.gizma.com | 2 |
| www.howzhi.com | 2 |
| www.jeffhandesign.com | 2 |
| www.libfabu.com | 2 |
