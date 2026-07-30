# Aarre 封面兜底率测量

- 样本：300 条（原始可用 URL 415 条）
- 模式：themed
- 测量时间：2026-07-30T09:38:39.940Z
- 分类封面兜底：140 条 / 46.67%
- 有候选但被拒：28 条
- 无候选：112 条
- 最大缩放比：1（要求不超过 1）

## 来源分布

| 来源 | 数量 | 占比 |
| --- | ---: | ---: |
| registry | 3 | 1% |
| apple-touch-icon | 98 | 32.67% |
| conventional-favicon-ico | 19 | 6.33% |
| manifest | 7 | 2.33% |
| high-resolution-rel-icon | 31 | 10.33% |
| og-image | 2 | 0.67% |
| category-fallback | 140 | 46.67% |

conventional-favicon-ico 命中域名：devouringdetails.com、www.voxflow.studio、uibook.art、skills.sh、icon-studio-ebon.vercel.app、easings.net、www.iconfont.cn、www.futuretools.io、huggingface.co、library.phygital.plus、3dpresso.ai、ikuuu.win、pro.xiaohongshu.com

## 质量闸门拒绝

### below-128px（29）

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
    "pageUrl": "https://detail.design/[path-8a5edab2]",
    "assetUrl": "https://detail.design/[path-b1803648].ico",
    "source": "conventional-favicon-ico",
    "nativeWidth": 64,
    "nativeHeight": 64
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
    "pageUrl": "https://beam.jakubantalik.com/[path-8a5edab2]",
    "assetUrl": "https://beam.jakubantalik.com/[path-b1803648].ico",
    "source": "conventional-favicon-ico",
    "nativeWidth": 32,
    "nativeHeight": 32
  },
  {
    "pageUrl": "https://animejs.com/[path-8a5edab2]",
    "assetUrl": "https://animejs.com/[path-379bfe54].png",
    "source": "large-icon",
    "nativeWidth": 64,
    "nativeHeight": 64
  },
  {
    "pageUrl": "https://namethatui.com/[path-8a5edab2]",
    "assetUrl": "https://namethatui.com/[path-b1803648].ico",
    "source": "conventional-favicon-ico",
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
    "pageUrl": "https://cowtransfer.com/[path-2e038bd1]",
    "assetUrl": "https://cowtransfer.com/[path-b1803648].ico",
    "source": "conventional-favicon-ico",
    "nativeWidth": 64,
    "nativeHeight": 64
  },
  {
    "pageUrl": "http://www.iconfont.cn/[path-8a5edab2]",
    "assetUrl": "https://img.alicdn.com/[path-952c2662].png",
    "source": "apple-touch-icon",
    "nativeWidth": 114,
    "nativeHeight": 114
  }
]
```

### non-square（0）

```json
[]
```

### low-ink-or-contrast（4）

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
  },
  {
    "pageUrl": "https://icones.js.org/[path-8a5edab2]",
    "assetUrl": "https://icones.js.org/[path-641b7316].svg",
    "source": "svg-icon",
    "nativeWidth": 283.46,
    "nativeHeight": 283.46
  },
  {
    "pageUrl": "https://liveportrait.org/[path-d83abd2e]",
    "assetUrl": "https://liveportrait.org/[path-b1803648].ico",
    "source": "conventional-favicon-ico",
    "nativeWidth": 1024,
    "nativeHeight": 1024
  }
]
```

## 分类兜底域名 Top 30

| 域名 | 条数 |
| --- | ---: |
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
| iconly.pro | 2 |
| mcp.composio.dev | 2 |
| openxlab.org.cn | 2 |
| prompts.chat | 2 |
| rotato.app | 2 |
| useyourinterface.com | 2 |
| v.mp3juices.click | 2 |
| weavesilk.com | 2 |
| www.aicpb.com | 2 |
| www.gizma.com | 2 |
| www.howzhi.com | 2 |
| www.jeffhandesign.com | 2 |
| www.libfabu.com | 2 |
| www.libvio.me | 2 |
| www.lookae.com | 2 |
| www.ui.cn | 2 |
| www.upscayl.org | 2 |
