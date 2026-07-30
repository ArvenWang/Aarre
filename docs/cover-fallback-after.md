# Aarre 封面兜底率测量

- 样本：300 条（原始可用 URL 414 条）
- 模式：themed
- 测量时间：2026-07-30T06:23:33.163Z
- 分类封面兜底：172 条 / 57.33%
- 最大缩放比：1（要求不超过 1）

## 来源分布

| 来源 | 数量 | 占比 |
| --- | ---: | ---: |
| registry | 3 | 1% |
| apple-touch-icon | 97 | 32.33% |
| manifest | 9 | 3% |
| high-resolution-rel-icon | 17 | 5.67% |
| og-image | 2 | 0.67% |
| category-fallback | 172 | 57.33% |

## 质量闸门拒绝

### below-128px（42）

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
    "pageUrl": "https://godly.website/[path-8a5edab2]",
    "assetUrl": "http://recent.design/[path-641b7316].svg",
    "source": "svg-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://variant.ai/[path-8a5edab2]",
    "assetUrl": "https://variant.com/[path-e7e89b10].svg",
    "source": "apple-touch-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://variant.ai/[path-8a5edab2]",
    "assetUrl": "https://variant.com/[path-a1c1a05c].svg",
    "source": "apple-touch-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://artifacts.deeo.studio/[path-8a5edab2]",
    "assetUrl": "https://cdn.sanity.io/[path-2362031a].png",
    "source": "svg-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://diana.lu/[path-26223c06]",
    "assetUrl": "https://framerusercontent.com/[path-63eb4dbc].png",
    "source": "large-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://www.voxflow.studio/[path-85d8ec78]",
    "assetUrl": "https://www.voxflow.studio/[path-641b7316].svg",
    "source": "svg-icon",
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
    "pageUrl": "https://recent.design/[path-8a5edab2]",
    "assetUrl": "https://recent.design/[path-641b7316].svg",
    "source": "svg-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://github.com/[path-91e96fa8]",
    "assetUrl": "https://github.com/[path-43f0533a].png",
    "source": "registry",
    "nativeWidth": 120,
    "nativeHeight": 120
  },
  {
    "pageUrl": "https://textmotion.dev/[path-8a5edab2]",
    "assetUrl": "https://textmotion.dev/[path-a2e3916d].svg",
    "source": "svg-icon",
    "nativeWidth": 32,
    "nativeHeight": 32
  }
]
```

### non-square（0）

```json
[]
```

### low-ink-or-contrast（5）

```json
[
  {
    "pageUrl": "https://artifacts.deeo.studio/[path-8a5edab2]",
    "assetUrl": "https://artifacts.deeo.studio/[path-641b7316].svg",
    "source": "svg-icon",
    "nativeWidth": 128,
    "nativeHeight": 128
  },
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
  },
  {
    "pageUrl": "https://www.fluidfunctionalism.com/[path-8a5edab2]",
    "assetUrl": "https://www.fluidfunctionalism.com/[path-8944cfea].png",
    "source": "manifest",
    "nativeWidth": 512,
    "nativeHeight": 512
  },
  {
    "pageUrl": "https://www.fluidfunctionalism.com/[path-8a5edab2]",
    "assetUrl": "https://www.fluidfunctionalism.com/[path-597ba47b].png",
    "source": "manifest",
    "nativeWidth": 192,
    "nativeHeight": 192
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
| moonvy.com | 2 |
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
| www.iconfont.cn | 2 |
