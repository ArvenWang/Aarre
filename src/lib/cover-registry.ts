import type { ResourceRecord } from "./types";
import { canonicalizeUrl } from "./url";
import {
  COVER_RULES,
  matchCoverRule,
  resolveRuleAsset,
  type CoverRule
} from "./cover-rules";

export type CoverPipeline = "site-brand" | "page-image" | "category";

export {
  COVER_RULES,
  matchCoverRule,
  resolveRuleAsset,
  type CoverRule
} from "./cover-rules";

const coverModules = import.meta.glob<string>(
  "../assets/covers/*.webp",
  {
    eager: true,
    query: "?url",
    import: "default"
  }
);

export const CATEGORY_COVER_FILES = {
  "web-tool": "web-tool-v1.webp",
  "work-dashboard": "work-dashboard-v1.webp",
  "code-repository": "code-repository-v1.webp",
  "documentation-api": "documentation-api-v3.webp",
  "tutorial-course": "tutorial-course-v1.webp",
  "paper-research": "paper-research-v1.webp",
  "pdf-report": "pdf-report-v1.webp",
  "data-chart": "data-chart-v1.webp",
  video: "video-v2.webp",
  "audio-podcast": "audio-podcast-v1.webp",
  "newsletter-rss": "newsletter-rss-v1.webp",
  "shopping-products": "shopping-products-v2.webp",
  "place-map": "place-map-v1.webp",
  "event-ticket": "event-ticket-v1.webp",
  "job-career": "job-career-v2.webp",
  "portfolio-gallery": "portfolio-gallery-v2.webp",
  "ai-automation": "ai-automation-v1.webp",
  "development-software": "development-software-v1.webp",
  "data-cloud": "data-cloud-v1.webp",
  "security-privacy": "security-privacy-v1.webp",
  "hardware-devices": "hardware-devices-v1.webp",
  "design-creation": "design-creation-v1.webp",
  "art-creation": "art-creation-v2.webp",
  "business-startup": "business-startup-v1.webp",
  "work-productivity": "work-productivity-v1.webp",
  "education-science": "education-science-v3.webp",
  "finance-investing": "finance-investing-v3.webp",
  "news-society": "news-society-v1.webp",
  "health-medical": "health-medical-v2.webp",
  "sports-fitness": "sports-fitness-v1.webp",
  "food-cooking": "food-cooking-v1.webp",
  "travel-places": "travel-places-v3-suitcase.webp",
  "home-family": "home-family-v1.webp",
  "consumer-fashion": "consumer-fashion-v1.webp",
  "automotive-mobility": "automotive-mobility-v1.webp",
  "real-estate-housing": "real-estate-housing-v1.webp",
  "entertainment-culture": "entertainment-culture-v2.webp",
  "games-hobbies": "games-hobbies-v1.webp",
  "nature-pets": "nature-pets-v1.webp",
  "generic-webpage": "generic-webpage-v1.webp"
} as const;

export type CategoryCoverId = keyof typeof CATEGORY_COVER_FILES;

/**
 * Aarre 随扩展一同打包的完整兜底封面池。
 *
 * 排序后的文件 id 是跨渲染、排序和设备都一致的；不要在 UI 中用
 * Math.random() 选择，否则同一条收藏会在每次刷新时跳图。
 */
export const AARRE_FALLBACK_COVER_IDS = Object.freeze(
  (Object.keys(CATEGORY_COVER_FILES) as CategoryCoverId[]).sort()
);

type FallbackCoverResource = Pick<
  ResourceRecord,
  | "canonicalUrl"
  | "url"
  | "title"
  | "topics"
  | "tags"
  | "summary"
  | "categoryCoverId"
>;

function stableFallbackKey(input: string): string {
  try {
    return canonicalizeUrl(input);
  } catch {
    return input.trim().toLocaleLowerCase();
  }
}

function stableStringHash(input: string): number {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 为没有可靠语义分类的网页稳定分配一张本地 Aarre 兜底图。
 * canonical URL 相同就一定得到相同结果；跟当前列表位置和排序无关。
 */
export function stableFallbackCoverId(input: string): CategoryCoverId {
  const key = stableFallbackKey(input);
  return AARRE_FALLBACK_COVER_IDS[
    stableStringHash(key) % AARRE_FALLBACK_COVER_IDS.length
  ];
}

export function ruleCategoryCoverId(
  input: string
): CategoryCoverId | undefined {
  try {
    const url = new URL(input);
    const value = matchCoverRule(input)?.categoryCoverId;
    return (typeof value === "function" ? value(url) : value) as
      | CategoryCoverId
      | undefined;
  } catch {
    return undefined;
  }
}

const CATEGORY_KEYWORDS: Array<[CategoryCoverId, RegExp]> = [
  ["ai-automation", /(?:\b(?:ai|llm|agent|automation)\b|人工智能|机器学习|自动化)/i],
  ["security-privacy", /(?:\b(?:security|privacy|auth)\b|安全|隐私|加密)/i],
  ["data-cloud", /(?:\b(?:cloud|database|server)\b|云|数据库|后端)/i],
  ["development-software", /(?:\b(?:code|developer|software)\b|编程|开发|软件)/i],
  ["design-creation", /(?:\b(?:design|ui|ux)\b|设计|交互|产品设计)/i],
  ["art-creation", /(?:\b(?:art|illustration)\b|艺术|绘画|插画)/i],
  ["finance-investing", /(?:\b(?:finance|invest|stock)\b|财经|金融|投资|股票)/i],
  ["health-medical", /(?:\b(?:health|medical)\b|健康|医疗|医学)/i],
  ["education-science", /(?:\b(?:education|science)\b|学校|教育|科学)/i],
  ["business-startup", /(?:\b(?:business|startup)\b|商业|创业|公司)/i],
  ["work-productivity", /(?:\b(?:productivity|workflow)\b|效率|协作|工作)/i],
  ["news-society", /(?:\b(?:news|society)\b|新闻|社会|媒体)/i],
  ["sports-fitness", /(?:\b(?:sport|fitness)\b|运动|健身)/i],
  ["food-cooking", /(?:\b(?:food|cook|recipe)\b|美食|烹饪|食谱)/i],
  ["travel-places", /(?:\b(?:travel|tourism)\b|旅行|旅游|景点)/i],
  ["home-family", /(?:\b(?:home|family)\b|居家|家庭)/i],
  ["consumer-fashion", /(?:\b(?:fashion|style)\b|时尚|穿搭|消费)/i],
  ["automotive-mobility", /(?:\b(?:car|auto|mobility)\b|汽车|出行)/i],
  ["real-estate-housing", /(?:\b(?:real estate|housing)\b|房产|租房|居住)/i],
  ["entertainment-culture", /(?:\b(?:entertainment|culture)\b|娱乐|文化|电影)/i],
  ["games-hobbies", /(?:\b(?:game|gaming|hobby)\b|游戏|爱好)/i],
  ["nature-pets", /(?:\b(?:nature|pet|animal)\b|自然|宠物|动物)/i],
  ["hardware-devices", /(?:\b(?:hardware|device)\b|芯片|硬件|设备)/i]
];

const PAGE_TYPE_KEYWORDS: Array<[CategoryCoverId, RegExp]> = [
  ["pdf-report", /(?:\.pdf(?:[?#]|$)|\bpdf\b|报告)/i],
  ["code-repository", /(?:\b(?:git|repository|repo)\b|代码仓库)/i],
  ["documentation-api", /(?:\b(?:api|docs?|documentation)\b|文档|接口)/i],
  ["tutorial-course", /(?:\b(?:course|tutorial|learn)\b|教程|课程)/i],
  ["paper-research", /(?:\b(?:paper|research)\b|论文|研究)/i],
  ["data-chart", /(?:\b(?:chart|dashboard|analytics)\b|图表|数据看板)/i],
  ["video", /(?:\b(?:video|watch)\b|视频)/i],
  ["audio-podcast", /(?:\b(?:audio|podcast)\b|音乐|音频|播客)/i],
  ["newsletter-rss", /(?:\b(?:newsletter|rss)\b|订阅|邮件简报)/i],
  ["shopping-products", /(?:\b(?:shop|product|store)\b|购物|商品)/i],
  ["place-map", /(?:\b(?:map|place)\b|地图|地点)/i],
  ["event-ticket", /(?:\b(?:event|ticket)\b|活动|票务)/i],
  ["job-career", /(?:\b(?:job|career|hire)\b|职位|招聘)/i],
  ["portfolio-gallery", /(?:\b(?:portfolio|gallery)\b|作品集|画廊)/i],
  ["work-dashboard", /(?:\b(?:admin|console|workspace)\b|后台|控制台)/i],
  ["web-tool", /(?:\b(?:tool|generator|converter)\b|工具|生成器)/i]
];

export function categoryCoverForResource(
  resource: Pick<
    ResourceRecord,
    "url" | "title" | "topics" | "tags" | "summary" | "categoryCoverId"
  >
): CategoryCoverId {
  if (
    resource.categoryCoverId &&
    resource.categoryCoverId in CATEGORY_COVER_FILES
  ) {
    return resource.categoryCoverId as CategoryCoverId;
  }
  const ruleCover = ruleCategoryCoverId(resource.url);
  if (ruleCover) return ruleCover;
  const pageText = `${resource.url} ${resource.title}`;
  for (const [id, pattern] of PAGE_TYPE_KEYWORDS) {
    if (pattern.test(pageText)) return id;
  }
  const semanticText = [
    ...resource.topics,
    ...resource.tags,
    resource.summary,
    resource.title
  ].join(" ");
  for (const [id, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(semanticText)) return id;
  }
  return "generic-webpage";
}

/**
 * 管理页大卡片只允许“真实网页截图”或“本地 Aarre 兜底图”。
 *
 * 已有的可靠分类和 AI 语义优先；无法判断时使用 canonical URL
 * 的稳定哈希把资源分散到完整的 40 张本地资产中。这里不会读取
 * og:image、侧边栏图片或任何网络封面。
 */
export function aarreFallbackCoverId(
  resource: FallbackCoverResource
): CategoryCoverId {
  if (
    resource.categoryCoverId &&
    resource.categoryCoverId !== "generic-webpage" &&
    resource.categoryCoverId in CATEGORY_COVER_FILES
  ) {
    return resource.categoryCoverId as CategoryCoverId;
  }

  const semanticCover = categoryCoverForResource({
    ...resource,
    categoryCoverId: undefined
  });
  if (semanticCover !== "generic-webpage") return semanticCover;

  return stableFallbackCoverId(
    resource.canonicalUrl || resource.url
  );
}

export function categoryCoverUrl(id: string | undefined): string {
  const safeId =
    id && id in CATEGORY_COVER_FILES
      ? (id as CategoryCoverId)
      : "generic-webpage";
  const file = CATEGORY_COVER_FILES[safeId];
  return (
    coverModules[`../assets/covers/${file}`] ||
    coverModules[
      `../assets/covers/${CATEGORY_COVER_FILES["generic-webpage"]}`
    ] ||
    ""
  );
}

export function coverBrightnessForHost(input: string): number {
  let stableInput = input;
  try {
    stableInput = new URL(input).hostname;
  } catch {
    // The caller may already pass a host.
  }
  let hash = 2166136261;
  for (const character of stableInput.toLocaleLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 0.94 + ((hash >>> 0) % 121) / 1_000;
}

export function listCoverPipeline(input: string): CoverPipeline {
  return matchCoverRule(input)?.listUsesPageImage
    ? "page-image"
    : "site-brand";
}

export function registrableHost(input: string): string {
  const host = input.toLocaleLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    /^\d+(?:\.\d+){3}$/.test(host) ||
    host.includes(":")
  ) {
    return host;
  }
  const parts = host.split(".");
  const compoundSuffixes = new Set([
    "co.uk",
    "com.au",
    "com.cn",
    "com.hk",
    "co.jp",
    "co.kr"
  ]);
  const suffix = parts.slice(-2).join(".");
  const size = compoundSuffixes.has(suffix) ? 3 : 2;
  return parts.slice(-size).join(".");
}

export function recordPageImageSample(
  current: Record<string, string[]>,
  imageUrl: string,
  resourceKey: string
): {
  samples: Record<string, string[]>;
  isCommonBanner: boolean;
} {
  const key = imageUrl.slice(0, 1_000);
  const samples = { ...current };
  samples[key] = [
    ...new Set([...(samples[key] || []), resourceKey])
  ].slice(0, 3);
  return {
    samples: Object.fromEntries(Object.entries(samples).slice(-20)),
    isCommonBanner: samples[key].length >= 3
  };
}
