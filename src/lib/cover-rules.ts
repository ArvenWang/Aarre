export interface CoverRule {
  id: string;
  hosts: string[];
  hostSuffixes?: string[];
  brandAsset?: string | ((url: URL) => string);
  pinBrandAsset?: boolean;
  pageImage?: (url: URL) => string;
  skipPageImage?: boolean;
  listUsesPageImage?: boolean;
  categoryCoverId?: string | ((url: URL) => string);
}

function youtubeVideoId(url: URL): string {
  if (url.hostname === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] || "";
  }
  if (url.pathname === "/watch") return url.searchParams.get("v") || "";
  const match = url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
  return match?.[1] || "";
}

function originBrandAsset(path = "/apple-touch-icon.png") {
  return (url: URL): string => new URL(path, url.origin).toString();
}

function defineSiteRules(
  entries: Array<{
    id: string;
    hosts: string[];
    hostSuffixes?: string[];
    categoryCoverId: string;
    skipPageImage?: boolean;
  }>
): CoverRule[] {
  return entries.map((entry) => ({
    ...entry,
    brandAsset: originBrandAsset()
  }));
}

const CHINESE_SITE_RULES = defineSiteRules([
  {
    id: "juejin",
    hosts: ["juejin.cn", "www.juejin.cn"],
    categoryCoverId: "development-software"
  },
  {
    id: "segmentfault",
    hosts: ["segmentfault.com", "www.segmentfault.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "csdn",
    hosts: ["csdn.net", "www.csdn.net", "blog.csdn.net"],
    categoryCoverId: "development-software"
  },
  {
    id: "jianshu",
    hosts: ["jianshu.com", "www.jianshu.com"],
    categoryCoverId: "newsletter-rss"
  },
  {
    id: "douban",
    hosts: [
      "douban.com",
      "www.douban.com",
      "movie.douban.com",
      "music.douban.com"
    ],
    categoryCoverId: "entertainment-culture"
  },
  {
    id: "weibo",
    hosts: ["weibo.com", "www.weibo.com", "m.weibo.cn"],
    categoryCoverId: "news-society",
    skipPageImage: true
  },
  {
    id: "yuque",
    hosts: ["yuque.com", "www.yuque.com"],
    categoryCoverId: "documentation-api",
    skipPageImage: true
  },
  {
    id: "feishu-docs",
    hosts: ["feishu.cn", "www.feishu.cn", "docs.feishu.cn"],
    categoryCoverId: "documentation-api",
    skipPageImage: true
  },
  {
    id: "shimo",
    hosts: ["shimo.im", "www.shimo.im"],
    categoryCoverId: "documentation-api",
    skipPageImage: true
  },
  {
    id: "baidu",
    hosts: ["baidu.com", "www.baidu.com"],
    categoryCoverId: "web-tool"
  },
  {
    id: "baidu-pan",
    hosts: ["pan.baidu.com"],
    categoryCoverId: "data-cloud",
    skipPageImage: true
  },
  {
    id: "toutiao",
    hosts: ["toutiao.com", "www.toutiao.com"],
    categoryCoverId: "news-society"
  },
  {
    id: "36kr",
    hosts: ["36kr.com", "www.36kr.com"],
    categoryCoverId: "business-startup"
  },
  {
    id: "sspai",
    hosts: ["sspai.com", "www.sspai.com"],
    categoryCoverId: "news-society"
  },
  {
    id: "v2ex",
    hosts: ["v2ex.com", "www.v2ex.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "guokr",
    hosts: ["guokr.com", "www.guokr.com"],
    categoryCoverId: "education-science"
  },
  {
    id: "ifanr",
    hosts: ["ifanr.com", "www.ifanr.com"],
    categoryCoverId: "news-society"
  },
  {
    id: "huxiu",
    hosts: ["huxiu.com", "www.huxiu.com"],
    categoryCoverId: "business-startup"
  },
  {
    id: "cnblogs",
    hosts: ["cnblogs.com", "www.cnblogs.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "oschina",
    hosts: ["oschina.net", "www.oschina.net"],
    categoryCoverId: "development-software"
  },
  {
    id: "infoq-cn",
    hosts: ["infoq.cn", "www.infoq.cn"],
    categoryCoverId: "development-software"
  },
  {
    id: "gitee",
    hosts: ["gitee.com", "www.gitee.com"],
    categoryCoverId: "code-repository"
  },
  {
    id: "aliyun-developer",
    hosts: ["developer.aliyun.com", "help.aliyun.com"],
    categoryCoverId: "documentation-api"
  },
  {
    id: "tencent-cloud",
    hosts: ["cloud.tencent.com"],
    categoryCoverId: "documentation-api"
  },
  {
    id: "woshipm",
    hosts: ["woshipm.com", "www.woshipm.com"],
    categoryCoverId: "business-startup"
  },
  {
    id: "uisdc",
    hosts: ["uisdc.com", "www.uisdc.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "zcool",
    hosts: ["zcool.com.cn", "www.zcool.com.cn"],
    categoryCoverId: "design-creation"
  },
  {
    id: "ui-cn",
    hosts: ["ui.cn", "www.ui.cn"],
    categoryCoverId: "design-creation"
  },
  {
    id: "lagou",
    hosts: ["lagou.com", "www.lagou.com"],
    categoryCoverId: "job-career"
  },
  {
    id: "boss-zhipin",
    hosts: ["zhipin.com", "www.zhipin.com"],
    categoryCoverId: "job-career"
  }
]);

const PRODUCTIVITY_SITE_RULES = defineSiteRules([
  {
    id: "microsoft",
    hosts: ["microsoft.com", "www.microsoft.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "apple",
    hosts: ["apple.com", "www.apple.com"],
    categoryCoverId: "hardware-devices"
  },
  {
    id: "google",
    hosts: ["google.com", "www.google.com"],
    categoryCoverId: "web-tool"
  },
  {
    id: "gmail",
    hosts: ["mail.google.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "google-drive",
    hosts: ["drive.google.com"],
    categoryCoverId: "data-cloud"
  },
  {
    id: "dropbox",
    hosts: ["dropbox.com", "www.dropbox.com"],
    categoryCoverId: "data-cloud"
  },
  {
    id: "onedrive",
    hosts: ["onedrive.live.com"],
    categoryCoverId: "data-cloud"
  },
  {
    id: "slack",
    hosts: ["slack.com", "app.slack.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "zoom",
    hosts: ["zoom.us", "www.zoom.us"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "microsoft-teams",
    hosts: ["teams.microsoft.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "trello",
    hosts: ["trello.com", "www.trello.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "asana",
    hosts: ["asana.com", "app.asana.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "linear",
    hosts: ["linear.app", "www.linear.app"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "jira",
    hosts: ["jira.com", "www.jira.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "confluence",
    hosts: ["confluence.com", "www.confluence.com"],
    categoryCoverId: "documentation-api"
  },
  {
    id: "airtable",
    hosts: ["airtable.com", "www.airtable.com"],
    categoryCoverId: "data-chart"
  },
  {
    id: "canva",
    hosts: ["canva.com", "www.canva.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "miro",
    hosts: ["miro.com", "www.miro.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "calendly",
    hosts: ["calendly.com", "www.calendly.com"],
    categoryCoverId: "work-productivity"
  },
  {
    id: "loom",
    hosts: ["loom.com", "www.loom.com"],
    categoryCoverId: "video"
  },
  {
    id: "gitlab",
    hosts: ["gitlab.com", "www.gitlab.com"],
    categoryCoverId: "code-repository"
  },
  {
    id: "bitbucket",
    hosts: ["bitbucket.org", "www.bitbucket.org"],
    categoryCoverId: "code-repository"
  },
  {
    id: "docker",
    hosts: ["docker.com", "www.docker.com", "hub.docker.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "kubernetes",
    hosts: ["kubernetes.io", "www.kubernetes.io"],
    categoryCoverId: "documentation-api"
  },
  {
    id: "vercel",
    hosts: ["vercel.com", "www.vercel.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "netlify",
    hosts: ["netlify.com", "www.netlify.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "cloudflare",
    hosts: ["cloudflare.com", "www.cloudflare.com"],
    categoryCoverId: "security-privacy"
  },
  {
    id: "aws",
    hosts: ["aws.amazon.com", "docs.aws.amazon.com"],
    categoryCoverId: "documentation-api"
  },
  {
    id: "azure",
    hosts: ["azure.microsoft.com", "learn.microsoft.com"],
    categoryCoverId: "documentation-api"
  },
  {
    id: "heroku",
    hosts: ["heroku.com", "www.heroku.com", "devcenter.heroku.com"],
    categoryCoverId: "development-software"
  }
]);

const DESIGN_AI_SITE_RULES = defineSiteRules([
  {
    id: "openai",
    hosts: ["openai.com", "www.openai.com", "chatgpt.com"],
    categoryCoverId: "ai-automation"
  },
  {
    id: "anthropic",
    hosts: ["anthropic.com", "www.anthropic.com", "claude.ai"],
    categoryCoverId: "ai-automation"
  },
  {
    id: "google-gemini",
    hosts: ["gemini.google.com"],
    categoryCoverId: "ai-automation"
  },
  {
    id: "perplexity",
    hosts: ["perplexity.ai", "www.perplexity.ai"],
    categoryCoverId: "ai-automation"
  },
  {
    id: "midjourney",
    hosts: ["midjourney.com", "www.midjourney.com"],
    categoryCoverId: "art-creation"
  },
  {
    id: "replicate",
    hosts: ["replicate.com", "www.replicate.com"],
    categoryCoverId: "ai-automation"
  },
  {
    id: "stability-ai",
    hosts: ["stability.ai", "www.stability.ai"],
    categoryCoverId: "ai-automation"
  },
  {
    id: "runway",
    hosts: ["runwayml.com", "www.runwayml.com", "app.runwayml.com"],
    categoryCoverId: "video"
  },
  {
    id: "leonardo-ai",
    hosts: ["leonardo.ai", "app.leonardo.ai"],
    categoryCoverId: "art-creation"
  },
  {
    id: "ideogram",
    hosts: ["ideogram.ai", "www.ideogram.ai"],
    categoryCoverId: "art-creation"
  },
  {
    id: "fal-ai",
    hosts: ["fal.ai", "www.fal.ai"],
    categoryCoverId: "ai-automation"
  },
  {
    id: "civitai",
    hosts: ["civitai.com", "www.civitai.com"],
    categoryCoverId: "art-creation"
  },
  {
    id: "luma-ai",
    hosts: ["lumalabs.ai", "www.lumalabs.ai"],
    categoryCoverId: "video"
  },
  {
    id: "pika",
    hosts: ["pika.art", "www.pika.art"],
    categoryCoverId: "video"
  },
  {
    id: "elevenlabs",
    hosts: ["elevenlabs.io", "www.elevenlabs.io"],
    categoryCoverId: "audio-podcast"
  },
  {
    id: "suno",
    hosts: ["suno.com", "www.suno.com"],
    categoryCoverId: "audio-podcast"
  },
  {
    id: "udio",
    hosts: ["udio.com", "www.udio.com"],
    categoryCoverId: "audio-podcast"
  },
  {
    id: "cursor",
    hosts: ["cursor.com", "www.cursor.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "replit",
    hosts: ["replit.com", "www.replit.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "codesandbox",
    hosts: ["codesandbox.io", "www.codesandbox.io"],
    categoryCoverId: "development-software"
  },
  {
    id: "stackblitz",
    hosts: ["stackblitz.com", "www.stackblitz.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "codepen",
    hosts: ["codepen.io", "www.codepen.io"],
    categoryCoverId: "development-software"
  },
  {
    id: "dribbble",
    hosts: ["dribbble.com", "www.dribbble.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "behance",
    hosts: ["behance.net", "www.behance.net"],
    categoryCoverId: "portfolio-gallery"
  },
  {
    id: "pinterest",
    hosts: ["pinterest.com", "www.pinterest.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "framer",
    hosts: ["framer.com", "www.framer.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "webflow",
    hosts: ["webflow.com", "www.webflow.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "spline",
    hosts: ["spline.design", "www.spline.design"],
    categoryCoverId: "design-creation"
  },
  {
    id: "sketch",
    hosts: ["sketch.com", "www.sketch.com"],
    categoryCoverId: "design-creation"
  },
  {
    id: "adobe",
    hosts: ["adobe.com", "www.adobe.com"],
    categoryCoverId: "design-creation"
  }
]);

const MEDIA_LEARNING_SITE_RULES = defineSiteRules([
  {
    id: "reddit",
    hosts: ["reddit.com", "www.reddit.com", "old.reddit.com"],
    categoryCoverId: "news-society"
  },
  {
    id: "hacker-news",
    hosts: ["news.ycombinator.com"],
    categoryCoverId: "news-society"
  },
  {
    id: "medium",
    hosts: ["medium.com", "www.medium.com"],
    categoryCoverId: "newsletter-rss"
  },
  {
    id: "devto",
    hosts: ["dev.to", "www.dev.to"],
    categoryCoverId: "development-software"
  },
  {
    id: "hashnode",
    hosts: ["hashnode.com", "www.hashnode.com"],
    categoryCoverId: "development-software"
  },
  {
    id: "freecodecamp",
    hosts: ["freecodecamp.org", "www.freecodecamp.org"],
    categoryCoverId: "tutorial-course"
  },
  {
    id: "codecademy",
    hosts: ["codecademy.com", "www.codecademy.com"],
    categoryCoverId: "tutorial-course"
  },
  {
    id: "coursera",
    hosts: ["coursera.org", "www.coursera.org"],
    categoryCoverId: "tutorial-course"
  },
  {
    id: "edx",
    hosts: ["edx.org", "www.edx.org"],
    categoryCoverId: "tutorial-course"
  },
  {
    id: "udemy",
    hosts: ["udemy.com", "www.udemy.com"],
    categoryCoverId: "tutorial-course"
  },
  {
    id: "khan-academy",
    hosts: ["khanacademy.org", "www.khanacademy.org"],
    categoryCoverId: "education-science"
  },
  {
    id: "wikipedia",
    hosts: ["wikipedia.org", "www.wikipedia.org"],
    hostSuffixes: [".wikipedia.org"],
    categoryCoverId: "education-science"
  },
  {
    id: "internet-archive",
    hosts: ["archive.org", "www.archive.org"],
    categoryCoverId: "entertainment-culture"
  },
  {
    id: "researchgate",
    hosts: ["researchgate.net", "www.researchgate.net"],
    categoryCoverId: "paper-research"
  },
  {
    id: "semantic-scholar",
    hosts: ["semanticscholar.org", "www.semanticscholar.org"],
    categoryCoverId: "paper-research"
  },
  {
    id: "nature",
    hosts: ["nature.com", "www.nature.com"],
    categoryCoverId: "paper-research"
  },
  {
    id: "science",
    hosts: ["science.org", "www.science.org"],
    categoryCoverId: "paper-research"
  },
  {
    id: "new-york-times",
    hosts: ["nytimes.com", "www.nytimes.com"],
    categoryCoverId: "news-society"
  },
  {
    id: "bbc",
    hosts: ["bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk"],
    categoryCoverId: "news-society"
  },
  {
    id: "reuters",
    hosts: ["reuters.com", "www.reuters.com"],
    categoryCoverId: "news-society"
  },
  {
    id: "bloomberg",
    hosts: ["bloomberg.com", "www.bloomberg.com"],
    categoryCoverId: "finance-investing"
  },
  {
    id: "linkedin",
    hosts: ["linkedin.com", "www.linkedin.com"],
    categoryCoverId: "job-career",
    skipPageImage: true
  },
  {
    id: "product-hunt",
    hosts: ["producthunt.com", "www.producthunt.com"],
    categoryCoverId: "business-startup"
  },
  {
    id: "indie-hackers",
    hosts: ["indiehackers.com", "www.indiehackers.com"],
    categoryCoverId: "business-startup"
  },
  {
    id: "spotify",
    hosts: ["spotify.com", "www.spotify.com", "open.spotify.com"],
    categoryCoverId: "audio-podcast"
  },
  {
    id: "soundcloud",
    hosts: ["soundcloud.com", "www.soundcloud.com"],
    categoryCoverId: "audio-podcast"
  },
  {
    id: "twitch",
    hosts: ["twitch.tv", "www.twitch.tv"],
    categoryCoverId: "video"
  },
  {
    id: "vimeo",
    hosts: ["vimeo.com", "www.vimeo.com"],
    categoryCoverId: "video"
  },
  {
    id: "netflix",
    hosts: ["netflix.com", "www.netflix.com"],
    categoryCoverId: "entertainment-culture"
  },
  {
    id: "imdb",
    hosts: ["imdb.com", "www.imdb.com"],
    categoryCoverId: "entertainment-culture"
  }
]);

export const COVER_RULES: CoverRule[] = [
  {
    id: "github",
    hosts: ["github.com", "www.github.com", "gist.github.com"],
    brandAsset: "https://github.githubassets.com/favicons/favicon.svg",
    pinBrandAsset: true,
    pageImage: (url) => {
      const [owner, repository] = url.pathname.split("/").filter(Boolean);
      return owner && repository
        ? `https://opengraph.githubassets.com/aarre/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
        : "";
    },
    categoryCoverId: "code-repository"
  },
  {
    id: "youtube",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
    brandAsset: "https://www.youtube.com/apple-touch-icon.png",
    pageImage: (url) => {
      const id = youtubeVideoId(url);
      return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : "";
    },
    listUsesPageImage: true,
    categoryCoverId: "video"
  },
  {
    id: "bilibili",
    hosts: ["bilibili.com", "www.bilibili.com", "m.bilibili.com"],
    brandAsset: "https://www.bilibili.com/apple-touch-icon.png",
    listUsesPageImage: true,
    categoryCoverId: "video"
  },
  {
    id: "xiaohongshu",
    hosts: ["xiaohongshu.com", "www.xiaohongshu.com"],
    brandAsset: "https://www.xiaohongshu.com/apple-touch-icon.png",
    skipPageImage: true,
    categoryCoverId: "news-society"
  },
  {
    id: "x-twitter",
    hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
    brandAsset: (url) => `${url.origin}/apple-touch-icon.png`,
    skipPageImage: true,
    categoryCoverId: "news-society"
  },
  {
    id: "zhihu",
    hosts: ["zhihu.com", "www.zhihu.com"],
    brandAsset: "https://www.zhihu.com/apple-touch-icon.png",
    skipPageImage: true,
    categoryCoverId: "news-society"
  },
  {
    id: "zhihu-column",
    hosts: ["zhuanlan.zhihu.com"],
    brandAsset: "https://www.zhihu.com/apple-touch-icon.png",
    categoryCoverId: "news-society"
  },
  {
    id: "wechat-article",
    hosts: ["mp.weixin.qq.com"],
    categoryCoverId: "newsletter-rss"
  },
  {
    id: "npm",
    hosts: ["npmjs.com", "www.npmjs.com"],
    skipPageImage: true,
    categoryCoverId: "code-repository"
  },
  {
    id: "mdn",
    hosts: ["developer.mozilla.org"],
    skipPageImage: true,
    categoryCoverId: "documentation-api"
  },
  {
    id: "stackoverflow",
    hosts: ["stackoverflow.com", "www.stackoverflow.com"],
    skipPageImage: true,
    categoryCoverId: "development-software"
  },
  {
    id: "notion",
    hosts: ["notion.so", "www.notion.so"],
    skipPageImage: true,
    categoryCoverId: "work-productivity"
  },
  {
    id: "figma",
    hosts: ["figma.com", "www.figma.com"],
    skipPageImage: true,
    categoryCoverId: "design-creation"
  },
  {
    id: "google-docs",
    hosts: ["docs.google.com"],
    skipPageImage: true,
    categoryCoverId: (url) =>
      url.pathname.startsWith("/spreadsheets/")
        ? "data-chart"
        : url.pathname.startsWith("/presentation/")
          ? "portfolio-gallery"
          : "documentation-api"
  },
  {
    id: "arxiv",
    hosts: ["arxiv.org", "www.arxiv.org"],
    skipPageImage: true,
    categoryCoverId: "paper-research"
  },
  {
    id: "readthedocs",
    hosts: [],
    hostSuffixes: [".readthedocs.io"],
    skipPageImage: true,
    categoryCoverId: "documentation-api"
  },
  {
    id: "documentation-subdomain",
    hosts: [],
    hostSuffixes: [".docs.com", ".docs.dev"],
    skipPageImage: true,
    categoryCoverId: "documentation-api"
  },
  ...CHINESE_SITE_RULES,
  ...PRODUCTIVITY_SITE_RULES,
  ...DESIGN_AI_SITE_RULES,
  ...MEDIA_LEARNING_SITE_RULES,
  {
    id: "3dpresso",
    hosts: ["3dpresso.ai", "www.3dpresso.ai"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "animejs",
    hosts: ["animejs.com", "www.animejs.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "development-software"
  },
  {
    id: "artflow",
    hosts: ["app.artflow.ai", "artflow.ai"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "exactly-ai",
    hosts: ["app.exactly.ai", "exactly.ai"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "art-creation"
  },
  {
    id: "meshy",
    hosts: ["app.meshy.ai", "meshy.ai"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "art-creation"
  },
  {
    id: "sina-blog",
    hosts: ["blog.sina.com.cn"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "newsletter-rss"
  },
  {
    id: "douban-book",
    hosts: ["book.douban.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "entertainment-culture"
  },
  {
    id: "cli-im",
    hosts: ["cli.im", "www.cli.im"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "web-tool"
  },
  {
    id: "clipdrop",
    hosts: ["clipdrop.co", "www.clipdrop.co"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "cowtransfer",
    hosts: ["cowtransfer.com", "www.cowtransfer.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "data-cloud"
  },
  {
    id: "designsparks",
    hosts: ["designsparks.io", "www.designsparks.io"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "design-creation"
  },
  {
    id: "tencent-doc",
    hosts: ["doc.weixin.qq.com", "docs.qq.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "documentation-api"
  },
  {
    id: "generative-dynamics",
    hosts: ["generative-dynamics.github.io"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "tutorial-course"
  },
  {
    id: "blusea",
    hosts: ["home.blusea.cn", "blusea.cn"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "design-creation"
  },
  {
    id: "hugging-face",
    hosts: ["huggingface.co", "www.huggingface.co"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "iconly",
    hosts: ["iconly.pro", "www.iconly.pro"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "design-creation"
  },
  {
    id: "composio-mcp",
    hosts: ["mcp.composio.dev", "composio.dev"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "documentation-api"
  },
  {
    id: "mockuphone",
    hosts: ["mockuphone.com", "www.mockuphone.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "design-creation"
  },
  {
    id: "moonvy",
    hosts: ["moonvy.com", "www.moonvy.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "design-creation"
  },
  {
    id: "openxlab",
    hosts: ["openxlab.org.cn", "www.openxlab.org.cn"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "prompts-chat",
    hosts: ["prompts.chat", "www.prompts.chat"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "rotato",
    hosts: ["rotato.app", "www.rotato.app"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "design-creation"
  },
  {
    id: "use-your-interface",
    hosts: ["useyourinterface.com", "www.useyourinterface.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "design-creation"
  },
  {
    id: "mp3juices",
    hosts: ["v.mp3juices.click", "mp3juices.click"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "audio-podcast"
  },
  {
    id: "weavesilk",
    hosts: ["weavesilk.com", "www.weavesilk.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "art-creation"
  },
  {
    id: "aconvert",
    hosts: ["www.aconvert.com", "aconvert.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "web-tool"
  },
  {
    id: "aicpb",
    hosts: ["www.aicpb.com", "aicpb.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "future-tools",
    hosts: ["www.futuretools.io", "futuretools.io"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "ai-automation"
  },
  {
    id: "gizma",
    hosts: ["www.gizma.com", "gizma.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "consumer-fashion"
  },
  {
    id: "howzhi",
    hosts: ["www.howzhi.com", "howzhi.com"],
    brandAsset: originBrandAsset(),
    categoryCoverId: "tutorial-course"
  }
];

export function matchCoverRule(input: string): CoverRule | undefined {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return COVER_RULES.find(
      (rule) =>
        rule.hosts.includes(host) ||
        rule.hostSuffixes?.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return undefined;
  }
}

export function resolveRuleAsset(
  input: string,
  field: "brandAsset" | "pageImage"
): string {
  try {
    const url = new URL(input);
    const value = matchCoverRule(input)?.[field];
    return typeof value === "function" ? value(url) : value || "";
  } catch {
    return "";
  }
}

export function pinnedBrandAssetUrl(input: string): string {
  return matchCoverRule(input)?.pinBrandAsset
    ? resolveRuleAsset(input, "brandAsset")
    : "";
}

export function pinnedBrandAssetNeedsRefresh(
  input: string,
  iconAssetUrl: string | undefined
): boolean {
  const expectedUrl = pinnedBrandAssetUrl(input);
  return Boolean(expectedUrl && iconAssetUrl !== expectedUrl);
}
