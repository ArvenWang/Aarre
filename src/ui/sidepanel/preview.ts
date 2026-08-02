import type {
  AgentConversation,
  AiProviderId,
  AiSettingsStatus,
  AppState,
  BookmarkAgentCatalog,
  BookmarkAgentActionExecutionResult,
  BookmarkAgentActionProposal,
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  NavigationSuggestion,
  ResourceRecord,
  SiteBrandRecord
} from "../../lib/types";
import { askBookmarkAgent } from "../../lib/local-ai";
import { validateAiApiKey } from "../../lib/settings";
import { categoryCoverForResource } from "../../lib/cover-registry";
import { canonicalizeUrl } from "../../lib/url";
import aiAutomationCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/ai-automation-v1.png";
import artCreationCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/art-creation-v2.png";
import audioPodcastCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/audio-podcast-v1.png";
import automotiveMobilityCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/automotive-mobility-v1.png";
import businessStartupCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/business-startup-v1.png";
import codeRepositoryCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/code-repository-v1.png";
import consumerFashionCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/consumer-fashion-v1.png";
import dataChartCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/data-chart-v1.png";
import dataCloudCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/data-cloud-v1.png";
import designCreationCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/design-creation-v1.png";
import developmentSoftwareCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/development-software-v1.png";
import documentationApiCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/documentation-api-v3.png";
import educationScienceCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/education-science-v3.png";
import entertainmentCultureCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/entertainment-culture-v2.png";
import eventTicketCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/event-ticket-v1.png";
import financeInvestingCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/finance-investing-v3.png";
import foodCookingCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/food-cooking-v1.png";
import gamesHobbiesCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/games-hobbies-v1.png";
import genericWebpageCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/generic-webpage-v1.png";
import hardwareDevicesCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/hardware-devices-v1.png";
import healthMedicalCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/health-medical-v2.png";
import homeFamilyCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/home-family-v1.png";
import jobCareerCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/job-career-v2.png";
import naturePetsCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/nature-pets-v1.png";
import newsletterRssCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/newsletter-rss-v1.png";
import newsSocietyCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/news-society-v1.png";
import paperResearchCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/paper-research-v1.png";
import pdfReportCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/pdf-report-v1.png";
import placeMapCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/place-map-v1.png";
import portfolioGalleryCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/portfolio-gallery-v2.png";
import realEstateHousingCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/real-estate-housing-v1.png";
import securityPrivacyCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/security-privacy-v1.png";
import shoppingProductsCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/shopping-products-v2.png";
import sportsFitnessCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/sports-fitness-v1.png";
import travelPlacesSuitcaseCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/travel-places-v3-suitcase.png";
import tutorialCourseCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/tutorial-course-v1.png";
import videoCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/video-v2.png";
import webToolCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/web-tool-v1.png";
import workDashboardCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/work-dashboard-v1.png";
import workProductivityCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/work-productivity-v1.png";

const previewEvent = {
  addListener() {},
  removeListener() {}
};

type PreviewRuntimeListener = (message: unknown) => void;
const previewRuntimeListeners = new Set<PreviewRuntimeListener>();
const previewProtectedResourceKeys = new Set<string>();
const previewProtectedFolderIds = new Set<string>();
const previewRuntimeMessageEvent = {
  addListener(listener: PreviewRuntimeListener) {
    previewRuntimeListeners.add(listener);
  },
  removeListener(listener: PreviewRuntimeListener) {
    previewRuntimeListeners.delete(listener);
  }
};

function emitPreviewRuntimeMessage(message: unknown) {
  for (const listener of previewRuntimeListeners) {
    try {
      listener(message);
    } catch {
      // A broken preview listener must not interrupt the provider request.
    }
  }
}

const previewFolders = [
  ["设计赏析", 40],
  ["前端代码与组件", 58],
  ["工作与内部系统", 36],
  ["生活与娱乐", 45],
  ["工具与效率", 52],
  ["前端文章 / 教程", 38]
] as const;

// 使用真实公开页面验证代表图布局；仅存在于 ?preview=1 开发评审页。
const previewCoverSamples = [
  {
    title: "Sticker Forge — Interactive Sticker Maker",
    url: "https://sticker.oooo.so/",
    imageUrl: "https://sticker.oooo.so/og.png"
  },
  {
    title: "UIBook — Find your next UI idea",
    url: "https://uibook.art/",
    imageUrl:
      "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8acce6a3-1c71-4036-abf0-82e190df5c47/id-preview-95323c3b--354d2877-50f8-4d3f-8761-1963e91ae9ec.lovable.app-1771515272725.png"
  },
  {
    title: "Good Web Design",
    url: "https://good-web-design.com/",
    imageUrl:
      "https://good-web-design.com/wp/wp-content/uploads/2026/07/newcreators2026-960x624.jpg"
  },
  {
    title: "60fps — UI/UX animation inspiration",
    url: "https://60fps.design/",
    imageUrl:
      "https://framerusercontent.com/images/mB8WqomRNWMwPrMEL90Vtl8JGrE.png"
  },
  {
    title: "Recent — Design Inspiration",
    url: "https://recent.design/",
    imageUrl: "https://recent.design/og.png"
  },
  {
    title: "Collect UI — Daily Design Inspiration",
    url: "https://collectui.com/",
    imageUrl: "https://collectui.com/og-image.jpg"
  }
] as const;

// 通用分类封面评审：绑定真实公开网站，仅存在于 ?preview=1。
const previewGeneratedCovers = [
  {
    title: "Anthropic — AI 与自动化",
    url: "https://www.anthropic.com/",
    imageUrl: aiAutomationCover,
    category: "AI 与自动化"
  },
  {
    title: "GitHub — 代码仓库",
    url: "https://github.com/",
    imageUrl: codeRepositoryCover,
    category: "代码仓库"
  },
  {
    title: "Figma — 设计与创作",
    url: "https://www.figma.com/",
    imageUrl: designCreationCover,
    category: "设计与创作"
  },
  {
    title: "Serious Eats — 美食与烹饪",
    url: "https://www.seriouseats.com/",
    imageUrl: foodCookingCover,
    category: "美食与烹饪"
  },
  {
    title: "Booking.com — 旅行与地点",
    url: "https://www.booking.com/",
    imageUrl: travelPlacesSuitcaseCover,
    category: "旅行与地点"
  },
  {
    title: "MDN Web Docs — 文档与 API",
    url: "https://developer.mozilla.org/",
    imageUrl: documentationApiCover,
    category: "文档与 API"
  },
  {
    title: "YouTube — 视频",
    url: "https://www.youtube.com/",
    imageUrl: videoCover,
    category: "视频"
  },
  {
    title: "Yahoo Finance — 财经与投资",
    url: "https://finance.yahoo.com/",
    imageUrl: financeInvestingCover,
    category: "财经与投资"
  },
  {
    title: "Mayo Clinic — 健康与医疗",
    url: "https://www.mayoclinic.org/",
    imageUrl: healthMedicalCover,
    category: "健康与医疗"
  },
  {
    title: "Amazon — 购物与产品",
    url: "https://www.amazon.com/",
    imageUrl: shoppingProductsCover,
    category: "购物与产品"
  },
  {
    title: "Photopea — Web 工具",
    url: "https://www.photopea.com/",
    imageUrl: webToolCover,
    category: "Web 工具"
  },
  {
    title: "Linear — 工作后台",
    url: "https://linear.app/",
    imageUrl: workDashboardCover,
    category: "工作后台"
  },
  {
    title: "Khan Academy — 教程与课程",
    url: "https://www.khanacademy.org/",
    imageUrl: tutorialCourseCover,
    category: "教程与课程"
  },
  {
    title: "arXiv — 论文与研究",
    url: "https://arxiv.org/",
    imageUrl: paperResearchCover,
    category: "论文与研究"
  },
  {
    title: "Adobe Acrobat — PDF 与报告",
    url: "https://www.adobe.com/acrobat/",
    imageUrl: pdfReportCover,
    category: "PDF 与报告"
  },
  {
    title: "Our World in Data — 数据与图表",
    url: "https://ourworldindata.org/",
    imageUrl: dataChartCover,
    category: "数据与图表"
  },
  {
    title: "Spotify — 音频与播客",
    url: "https://open.spotify.com/",
    imageUrl: audioPodcastCover,
    category: "音频与播客"
  },
  {
    title: "Substack — Newsletter / RSS",
    url: "https://substack.com/",
    imageUrl: newsletterRssCover,
    category: "Newsletter / RSS"
  },
  {
    title: "OpenStreetMap — 地点与地图",
    url: "https://www.openstreetmap.org/",
    imageUrl: placeMapCover,
    category: "地点与地图"
  },
  {
    title: "Eventbrite — 活动与票务",
    url: "https://www.eventbrite.com/",
    imageUrl: eventTicketCover,
    category: "活动与票务"
  },
  {
    title: "Indeed — 职位与招聘",
    url: "https://www.indeed.com/",
    imageUrl: jobCareerCover,
    category: "职位与招聘"
  },
  {
    title: "Behance — 作品集与画廊",
    url: "https://www.behance.net/",
    imageUrl: portfolioGalleryCover,
    category: "作品集与画廊"
  },
  {
    title: "Stack Overflow — 开发与软件",
    url: "https://stackoverflow.com/",
    imageUrl: developmentSoftwareCover,
    category: "开发与软件"
  },
  {
    title: "Google Cloud — 数据与云",
    url: "https://cloud.google.com/",
    imageUrl: dataCloudCover,
    category: "数据与云"
  },
  {
    title: "1Password — 安全与隐私",
    url: "https://1password.com/",
    imageUrl: securityPrivacyCover,
    category: "安全与隐私"
  },
  {
    title: "Arduino — 硬件与设备",
    url: "https://www.arduino.cc/",
    imageUrl: hardwareDevicesCover,
    category: "硬件与设备"
  },
  {
    title: "Artsy — 艺术创作",
    url: "https://www.artsy.net/",
    imageUrl: artCreationCover,
    category: "艺术创作"
  },
  {
    title: "Y Combinator — 商业与创业",
    url: "https://www.ycombinator.com/",
    imageUrl: businessStartupCover,
    category: "商业与创业"
  },
  {
    title: "Todoist — 工作与效率",
    url: "https://todoist.com/",
    imageUrl: workProductivityCover,
    category: "工作与效率"
  },
  {
    title: "MIT OpenCourseWare — 教育与科学",
    url: "https://ocw.mit.edu/",
    imageUrl: educationScienceCover,
    category: "教育与科学"
  },
  {
    title: "BBC — 新闻与社会",
    url: "https://www.bbc.com/",
    imageUrl: newsSocietyCover,
    category: "新闻与社会"
  },
  {
    title: "Strava — 运动与健身",
    url: "https://www.strava.com/",
    imageUrl: sportsFitnessCover,
    category: "运动与健身"
  },
  {
    title: "The Spruce — 居家与家庭",
    url: "https://www.thespruce.com/",
    imageUrl: homeFamilyCover,
    category: "居家与家庭"
  },
  {
    title: "Vogue — 消费与时尚",
    url: "https://www.vogue.com/",
    imageUrl: consumerFashionCover,
    category: "消费与时尚"
  },
  {
    title: "Car and Driver — 汽车与出行",
    url: "https://www.caranddriver.com/",
    imageUrl: automotiveMobilityCover,
    category: "汽车与出行"
  },
  {
    title: "Zillow — 房产与居住",
    url: "https://www.zillow.com/",
    imageUrl: realEstateHousingCover,
    category: "房产与居住"
  },
  {
    title: "Netflix — 娱乐与文化",
    url: "https://www.netflix.com/",
    imageUrl: entertainmentCultureCover,
    category: "娱乐与文化"
  },
  {
    title: "Steam — 游戏与爱好",
    url: "https://store.steampowered.com/",
    imageUrl: gamesHobbiesCover,
    category: "游戏与爱好"
  },
  {
    title: "National Geographic — 自然与宠物",
    url: "https://www.nationalgeographic.com/animals/",
    imageUrl: naturePetsCover,
    category: "自然与宠物"
  },
  {
    title: "Example Domain — 普通网页",
    url: "https://example.com/",
    imageUrl: genericWebpageCover,
    category: "普通网页"
  }
] as const;

const previewGeneratedCoverNodes: NativeBookmarkNode[] =
  previewGeneratedCovers.map((sample, index) => ({
    id: `preview-generated-cover-${index}`,
    parentId: "preview-root",
    title: sample.title,
    url: sample.url
  }));

function previewFolder(
  title: string,
  count: number,
  index: number
): NativeBookmarkNode {
  const id = `preview-folder-${index}`;
  return {
    id,
    parentId: "preview-root",
    title,
    children: Array.from({ length: count }, (_, childIndex) => {
      const coverSample =
        index === 0 ? previewCoverSamples[childIndex] : undefined;
      return {
        id: `${id}-${childIndex}`,
        parentId: id,
        title:
          coverSample?.title ||
          (childIndex === 0
            ? `${title}示例收藏`
            : `${title}收藏 ${childIndex + 1}`),
        url:
          coverSample?.url ||
          `https://example.com/${index}/${childIndex}`
      };
    })
  };
}

const previewRoot: NativeBookmarkNode = {
  id: "preview-root",
  title: "书签栏",
  folderType: "bookmarks-bar",
  syncing: true,
  children: [
    ...previewGeneratedCoverNodes,
    ...previewFolders.map(([title, count], index) =>
      previewFolder(title, count, index)
    )
  ]
};

const previewSnapshot: BookmarkBarSnapshot = {
  root: previewRoot,
  roots: [previewRoot],
  primaryRootId: previewRoot.id,
  bookmarkCount: 309,
  folderCount: previewFolders.length,
  syncing: true
};

const previewState: AppState = {
  auth: {
    configured: false,
    signedIn: false,
    accountMatches: null
  },
  activeTab: {
    id: 1,
    url: "https://example.com/design-review",
    title: "侧边栏设计评审",
    faviconUrl: "",
    supported: true
  },
  localResourceCount: 309,
  aiReadyResourceCount: 48,
  aiEligibleResourceCount: 297,
  aiPrivacyProtectedCount: 12,
  pendingSyncCount: 0,
  libraryScan: {
    id: "",
    state: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    errors: []
  }
};

const previewGeneratedCoverResources: ResourceRecord[] =
  previewGeneratedCoverNodes.map((node, index) => {
    const sample = previewGeneratedCovers[index];
    const timestamp = "2026-07-30T08:00:00.000Z";
    return {
      resourceKey: `preview-resource-${node.id}`,
      canonicalUrl: sample.url,
      url: sample.url,
      title: sample.title,
      userNote: "",
      summary: `用于评审“${sample.category}”通用缺省封面的真实网页示例。`,
      tags: [sample.category, "缺省封面", "视觉评审"],
      tagsSource: "ai",
      topics: [sample.category],
      aliases: [sample.category, sample.title],
      useCases: [`查找${sample.category}参考资料时打开`],
      contentType: "产品",
      questions: [`有哪些${sample.category}参考资料`],
      entities: [],
      aiSchemaVersion: 2,
      contentExcerpt: "",
      contentHash: "",
      selectedText: "",
      author: "",
      siteName: new URL(sample.url).hostname,
      language: "zh-CN",
      imageUrl: sample.imageUrl,
      categoryCoverId: categoryCoverForResource({
        url: sample.url,
        title: sample.title,
        topics: [sample.category],
        tags: [sample.category],
        summary: ""
      }),
      faviconUrl: "",
      nativeBookmarkIds: [node.id],
      nativeFolderPath: ["书签栏"],
      aiStatus: "ready",
      syncStatus: "local",
      createdAt: timestamp,
      updatedAt: timestamp
    } satisfies ResourceRecord;
  });

const previewResources: ResourceRecord[] = [
  ...previewGeneratedCoverResources,
  ...(previewRoot.children || []).flatMap((folder) =>
    (folder.children || []).map((node, index) => {
      const ready = index < 2;
      const timestamp = "2026-07-29T08:00:00.000Z";
      const coverSample = previewCoverSamples.find(
        (sample) => sample.url === node.url
      );
      return {
        resourceKey: `preview-resource-${node.id}`,
        canonicalUrl: node.url || "",
        url: node.url || "",
        title: node.title,
        userNote: "",
        summary: ready
          ? `这是一份关于${folder.title}的参考资料，可用于后续方案研究与设计落地。`
          : "",
        tags: ready ? [folder.title, "参考资料", "待实践"] : [],
        tagsSource: ready ? "ai" : undefined,
        topics: ready ? ["知识管理"] : [],
        ...(ready
          ? {
              aliases: [folder.title, node.title],
              useCases: [`查找${folder.title}资料时打开`],
              contentType: "文章",
              questions: [`有哪些${folder.title}资料`],
              entities: [],
              aiSchemaVersion: 2,
            }
          : {}),
        contentExcerpt: "",
        contentHash: "",
        selectedText: "",
        author: "",
        siteName: node.url ? new URL(node.url).hostname : "",
        language: "zh-CN",
        imageUrl: coverSample?.imageUrl || "",
        faviconUrl: "",
        nativeBookmarkIds: [node.id],
        nativeFolderPath: ["书签栏", folder.title],
        aiStatus: ready ? "ready" : "not_requested",
        syncStatus: "local",
        createdAt: timestamp,
        updatedAt: timestamp
      } satisfies ResourceRecord;
    })
  )
];

function previewBrandDataUrl(foreground: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">',
    `<path fill="${foreground}" d="M48 142 83 50h27l35 92h-27l-7-21H80l-7 21H48Zm40-44h16L96 73l-8 25Z"/>`,
    "</svg>"
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function previewSiteBrand(host: string): SiteBrandRecord {
  return {
    host,
    iconDataUrl: previewBrandDataUrl("#18191c"),
    iconDataUrlLight: previewBrandDataUrl("#18191c"),
    iconRenderVersion: 6,
    iconSource: "registry",
    nativeWidth: 192,
    nativeHeight: 192,
    updatedAt: "2026-07-30T08:00:00.000Z"
  };
}

const previewSiteBrands: SiteBrandRecord[] = [
  previewSiteBrand("anthropic.com"),
  previewSiteBrand("example.com")
];

let previewConversations: AgentConversation[] = [];
let previewOrganizationNoticeDismissed = false;
const PREVIEW_AI_SETTINGS_KEY = "bookmark-layer:ai-settings";
const previewAgentRuns = new Map<string, AbortController>();

let previewAiSettings: AiSettingsStatus = {
  provider: "gemini",
  providerName: "Gemini",
  model: "gemini-2.5-flash-lite",
  apiKeyConfigured: false,
  configuredProviders: [],
  providerModels: {
    gemini: "gemini-2.5-flash-lite",
    openai: "gpt-5.6-luna",
    deepseek: "deepseek-v4-flash"
  },
  usingBuiltInService: false
};

const previewCapture = {
  url: "https://example.com/design-review",
  canonicalUrl: "https://example.com/design-review",
  title: "侧边栏设计评审",
  description: "用于验证收藏浮层与动效的本地页面。",
  content:
    "这是本地设计评审页面的模拟正文，只用于开发环境中的收藏浮层交互验证。",
  excerpt: "本地设计评审页面",
  selectedText: "",
  author: "",
  siteName: "example.com",
  language: "zh-CN",
  imageUrl: "",
  faviconUrl: ""
};

function previewFolderOptions() {
  return [
    {
      id: previewRoot.id,
      name: previewRoot.title,
      path: [previewRoot.title],
      depth: 0
    },
    ...(previewRoot.children || [])
      .filter((node) => !node.url)
      .map((node) => ({
        id: node.id,
        name: node.title,
        path: [previewRoot.title, node.title],
        depth: 1
      }))
  ];
}

function previewAgentCatalog(): BookmarkAgentCatalog {
  const catalog: BookmarkAgentCatalog = { bookmarks: [], folders: [] };
  const visit = (node: NativeBookmarkNode, parentPath: string[]) => {
    const path = node.title ? [...parentPath, node.title] : parentPath;
    if (!node.url) {
      catalog.folders.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        path,
        writable: true
      });
    }
    for (const child of node.children || []) {
      if (child.url) {
        catalog.bookmarks.push({
          id: child.id,
          parentId: child.parentId || node.id,
          title: child.title,
          url: child.url,
          path,
          writable: true
        });
      } else {
        visit(child, path);
      }
    }
  };
  visit(previewRoot, []);
  return catalog;
}

const previewSuggestions: NavigationSuggestion[] = [
  {
    id: "preview-tab",
    kind: "tab",
    title: "侧边栏设计评审",
    url: "https://example.com/design-review",
    subtitle: "已打开 · example.com",
    tabId: 1,
    windowId: 1
  }
];

function findPreviewNode(
  id: string,
  parent: NativeBookmarkNode = previewRoot
): { node: NativeBookmarkNode; parent: NativeBookmarkNode } | null {
  for (const child of parent.children || []) {
    if (child.id === id) return { node: child, parent };
    const nested = findPreviewNode(id, child);
    if (nested) return nested;
  }
  return null;
}

function previewProtectionState(target: {
  kind: "bookmark" | "folder";
  id: string;
}) {
  const match = findPreviewNode(target.id);
  if (!match) return { protected: false, explicit: false, inherited: false };
  let parent: NativeBookmarkNode | undefined = match.parent;
  let inherited = false;
  while (parent) {
    if (previewProtectedFolderIds.has(parent.id)) {
      inherited = true;
      break;
    }
    parent = parent.parentId ? findPreviewNode(parent.parentId)?.node : undefined;
  }
  if (target.kind === "folder") {
    const explicit = previewProtectedFolderIds.has(target.id);
    return { protected: explicit || inherited, explicit, inherited };
  }
  const resource = previewResources.find((item) =>
    item.nativeBookmarkIds.includes(target.id)
  );
  const explicit = Boolean(
    resource && previewProtectedResourceKeys.has(resource.resourceKey)
  );
  return { protected: explicit || inherited, explicit, inherited };
}

function movePreviewNode(
  id: string,
  parentId: string,
  index?: number
): NativeBookmarkNode | null {
  const source = findPreviewNode(id);
  const destination =
    parentId === previewRoot.id
      ? previewRoot
      : findPreviewNode(parentId)?.node;
  if (!source || !destination || destination.url) return null;

  const sourceChildren = source.parent.children || [];
  const sourceIndex = sourceChildren.findIndex((node) => node.id === id);
  if (sourceIndex < 0) return null;
  sourceChildren.splice(sourceIndex, 1);

  const destinationChildren = destination.children || [];
  destination.children = destinationChildren;
  const nextIndex = Math.max(
    0,
    Math.min(index ?? destinationChildren.length, destinationChildren.length)
  );
  destinationChildren.splice(nextIndex, 0, source.node);
  source.node.parentId = destination.id;

  sourceChildren.forEach((node, nodeIndex) => {
    node.index = nodeIndex;
  });
  destinationChildren.forEach((node, nodeIndex) => {
    node.index = nodeIndex;
  });
  return source.node;
}

function removePreviewNode(id: string): NativeBookmarkNode | null {
  const source = findPreviewNode(id);
  if (!source) return null;
  const children = source.parent.children || [];
  const index = children.findIndex((node) => node.id === id);
  if (index < 0) return null;
  children.splice(index, 1);
  children.forEach((node, nodeIndex) => {
    node.index = nodeIndex;
  });
  return source.node;
}

function executePreviewAgentAction(
  action: BookmarkAgentActionProposal
): BookmarkAgentActionExecutionResult {
  const success = (message: string): BookmarkAgentActionExecutionResult => ({
    actionId: action.id,
    success: true,
    message
  });
  const target = action.targetId
    ? findPreviewNode(action.targetId)
    : null;
  const destination =
    action.destinationId === previewRoot.id ||
    action.parentId === previewRoot.id
      ? previewRoot
      : findPreviewNode(
          action.destinationId || action.parentId || ""
        )?.node;

  switch (action.type) {
    case "create_bookmark":
    case "create_folder": {
      if (!destination || destination.url || !action.title) {
        throw new Error("预览目标文件夹无效。");
      }
      const created: NativeBookmarkNode = {
        id: `preview-agent-${Date.now()}-${Math.random()}`,
        parentId: destination.id,
        title: action.title,
        ...(action.type === "create_bookmark" && action.url
          ? { url: action.url }
          : { children: [] })
      };
      destination.children = [...(destination.children || []), created];
      return success(`已在 Chrome 预览数据中创建「${created.title}」。`);
    }
    case "delete_bookmark":
    case "delete_folder": {
      if (!target) throw new Error("预览目标已不存在。");
      target.parent.children = (target.parent.children || []).filter(
        (node) => node.id !== target.node.id
      );
      return success(`已从 Chrome 预览数据中删除「${target.node.title}」。`);
    }
    case "update_bookmark":
    case "rename_folder": {
      if (!target) throw new Error("预览目标已不存在。");
      target.node.title = action.title || target.node.title;
      if (action.type === "update_bookmark" && action.url) {
        target.node.url = action.url;
      }
      return success(`已修改「${target.node.title}」。`);
    }
    case "move_bookmark":
    case "move_folder": {
      if (!action.targetId || !action.destinationId) {
        throw new Error("预览移动信息不完整。");
      }
      const moved = movePreviewNode(
        action.targetId,
        action.destinationId
      );
      if (!moved) throw new Error("预览移动失败。");
      return success(`已移动「${moved.title}」。`);
    }
    case "update_metadata": {
      // Preview mode has no Aarre storage, so there is nothing to write; the
      // point is only to show the confirmation flow.
      return success("已更新预览数据中的标签与备注。");
    }
  }
}

export function installSidePanelPreview() {
  const previewStorage: Record<string, unknown> = {
    "aarre:onboarding:v1": {
      completed: true,
      skipped: false,
      completedAt: new Date().toISOString()
    }
  };
  const previewChrome = {
    runtime: {
      getManifest() {
        return {
          manifest_version: 3,
          name: "Aarre Preview",
          version: "0.0.0"
        };
      },
      getURL(path: string) {
        return new URL(path, window.location.origin).toString();
      },
      onMessage: previewRuntimeMessageEvent,
      async sendMessage(request: {
        type?: string;
        apiKey?: string;
        query?: string;
        requestId?: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        force?: boolean;
        id?: string;
        batchId?: string;
        tabId?: number;
        canonicalUrl?: string;
        conversation?: AgentConversation;
        actions?: BookmarkAgentActionProposal[];
        target?: { kind: "bookmark" | "folder"; id: string };
        protected?: boolean;
        payload?: {
          id?: string;
          parentId?: string;
          index?: number;
          folderId?: string;
          title?: string;
          url?: string;
          bookmarkId?: string;
          resourceKey?: string;
          tags?: string[];
          tagsChanged?: boolean;
          userNote?: string;
          provider?: AiProviderId;
          model?: string;
          apiKey?: string;
        };
      }) {
        switch (request.type) {
          case "GET_BOOKMARK_BAR":
            return { ok: true, data: structuredClone(previewSnapshot) };
          case "GET_APP_STATE":
          case "AUTH_CHANGED":
            return { ok: true, data: previewState };
          case "GET_LOCAL_RESOURCES":
            return {
              ok: true,
              data: structuredClone(
                previewResources.filter(
                  (resource) => resource.nativeBookmarkIds.length
                )
              )
            };
          case "GET_ITEM_PROTECTION":
            return {
              ok: true,
              data: previewProtectionState(
                request.target || { kind: "bookmark", id: "" }
              )
            };
          case "SET_ITEM_PROTECTION": {
            const target = request.target || { kind: "bookmark" as const, id: "" };
            const match = findPreviewNode(target.id);
            if (!match) return { ok: false, error: "没有找到预览保护目标。" };
            if (target.kind === "folder") {
              if (request.protected) previewProtectedFolderIds.add(target.id);
              else previewProtectedFolderIds.delete(target.id);
            } else {
              const resource = previewResources.find((item) =>
                item.nativeBookmarkIds.includes(target.id)
              );
              if (!resource) {
                return { ok: false, error: "没有找到预览网页资源。" };
              }
              if (request.protected) {
                previewProtectedResourceKeys.add(resource.resourceKey);
              } else {
                previewProtectedResourceKeys.delete(resource.resourceKey);
              }
            }
            return { ok: true, data: previewProtectionState(target) };
          }
          case "GET_RESOURCES":
            return {
              ok: true,
              data: structuredClone(
                previewResources.filter(
                  (resource) => resource.nativeBookmarkIds.length
                )
              ).map((resource) => ({ resource }))
            };
          case "GET_LIBRARY_INSIGHTS":
            return {
              ok: true,
              data: {
                organizationPlan: {
                  generatedAt: new Date().toISOString(),
                  proposalCount: 4,
                  actionableCount: 3,
                  proposals: [
                    {
                      id: "preview-classify",
                      kind: "classify",
                      title: "把“前端性能”主题归到一起",
                      description:
                        "8 条同主题收藏已在「前端代码」，建议移动 2 条散落收藏。",
                      destructive: false,
                      selectedByDefault: true,
                      actions: [
                        {
                          id: "preview-move",
                          type: "move_bookmark",
                          label: "移动 Web Vitals 实践",
                          description: "稍后读 → 前端代码",
                          destructive: false,
                          status: "pending",
                          targetId: "preview-folder-0-0",
                          destinationId: "preview-folder-1"
                        }
                      ],
                      resourceKeys: ["preview-0"],
                      beforePaths: ["稍后读 / Web Vitals 实践"],
                      afterPath: "前端代码",
                      previewLines: [
                        "稍后读 / 「Web Vitals 实践」 → 前端代码"
                      ]
                    },
                    {
                      id: "preview-duplicate",
                      kind: "duplicate",
                      title: "合并 3 个重复收藏",
                      description:
                        "同一网页收藏了 3 次。将保留较早的一条，其余副本需你确认后才会删除。",
                      destructive: true,
                      selectedByDefault: false,
                      actions: [
                        {
                          id: "preview-delete-duplicate",
                          type: "delete_bookmark",
                          label: "删除重复收藏",
                          description: "保留更早版本",
                          destructive: true,
                          status: "pending",
                          targetId: "preview-folder-3-0"
                        }
                      ],
                      resourceKeys: ["preview-duplicate"],
                      beforePaths: [
                        "书签栏 / 设计 / 示例",
                        "书签栏 / 稍后 / 示例"
                      ],
                      afterPath: "书签栏 / 设计 / 示例",
                      previewLines: [
                        "网页：「示例」",
                        "保留位置：设计",
                        "删除副本：稍后"
                      ]
                    },
                    {
                      id: "preview-dead",
                      kind: "dead",
                      title: "失效链接待确认",
                      description:
                        "服务器返回 404。删除项默认不勾选，建议先打开原网址或网页时光机复核。",
                      destructive: true,
                      selectedByDefault: false,
                      actions: [
                        {
                          id: "preview-delete-dead",
                          type: "delete_bookmark",
                          label: "删除失效收藏",
                          description: "服务器返回 404",
                          destructive: true,
                          status: "pending",
                          targetId: "preview-dead-bookmark"
                        }
                      ],
                      resourceKeys: ["preview-dead"],
                      beforePaths: ["书签栏 / 稍后 / 旧版性能指南"],
                      previewLines: [
                        "网址：https://example.com/old-guide",
                        "检测：服务器返回 404",
                        "待删除：稍后 / 旧版性能指南"
                      ],
                      recoveryLinks: [
                        {
                          label: "打开原网址",
                          url: "https://example.com/old-guide"
                        },
                        {
                          label: "在 Web Archive 中查找历史版本",
                          url: "https://web.archive.org/web/*/https://example.com/old-guide"
                        }
                      ]
                    },
                    {
                      id: "preview-large",
                      kind: "large_folder",
                      title: "大文件夹需要拆分",
                      description:
                        "「设计赏析」有 182 条收藏；只展示主题分布，不自动移动。",
                      destructive: false,
                      selectedByDefault: false,
                      actions: [],
                      resourceKeys: [],
                      beforePaths: ["书签栏 / 设计赏析"],
                      previewLines: ["交互设计 54 条", "设计系统 39 条"]
                    }
                  ]
                },
                readingQueue: previewResources.slice(0, 12).map(
                  (resource, index) => ({
                    nodeId: `reading-${index}`,
                    resourceKey: resource.resourceKey,
                    title: resource.title,
                    url: resource.url,
                    path: resource.nativeFolderPath,
                    dateAdded: Date.now() - (index + 30) * 86_400_000
                  })
                )
              }
            };
          case "GET_ORGANIZATION_NOTICE":
            return {
              ok: true,
              data: previewOrganizationNoticeDismissed
                ? null
                : {
                    generatedAt: new Date().toISOString(),
                    signature: "preview-organization-notice",
                    proposalCount: 12,
                    actionableCount: 9,
                    counts: {
                      duplicate: 3,
                      dead: 5,
                      classify: 4,
                      largeFolder: 0
                    }
                  }
            };
          case "DISMISS_ORGANIZATION_NOTICE":
            previewOrganizationNoticeDismissed = true;
            return { ok: true, data: { dismissed: true } };
          case "GET_KNOWLEDGE_DASHBOARD":
            return {
              ok: true,
              data: {
                weekly: {
                  period: "week",
                  startAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
                  endAt: new Date().toISOString(),
                  createdCount: 14,
                  attentionShift:
                    "你的关注重点从“React 生态”转向“AI Agent 架构”：本期分别为 2 条和 9 条。",
                  topicTrends: [
                    { topic: "AI Agent", current: 9, previous: 3 },
                    { topic: "前端性能", current: 4, previous: 2 },
                    { topic: "React 生态", current: 2, previous: 8 }
                  ],
                  rarelyOpenedOver90Days: 34,
                  knowledgeGaps: [
                    {
                      topic: "RAG",
                      resourceCount: 12,
                      angleCount: 2,
                      message:
                        "你在“RAG”上收了 12 条，但内容角度集中；下一篇可以刻意寻找评测或上线实践。"
                    }
                  ],
                  resurfacing: previewResources.slice(0, 3).map(
                    (resource, index) => ({
                      resourceKey: resource.resourceKey,
                      title: resource.title,
                      url: resource.url,
                      path: resource.nativeFolderPath,
                      ageDays: 120 + index * 24,
                      score: 50 - index,
                      reason: "与你本周关注的主题直接相关"
                    })
                  ),
                  health: {
                    deadLinks: 7,
                    newlyDetectedDeadLinks: 2,
                    largeFolders: 1
                  }
                },
                monthly: {
                  period: "month",
                  startAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
                  endAt: new Date().toISOString(),
                  createdCount: 47,
                  attentionShift:
                    "本月最集中的关注点是“产品设计”，共新增 18 条。",
                  topicTrends: [
                    { topic: "产品设计", current: 18, previous: 11 },
                    { topic: "AI Agent", current: 16, previous: 7 }
                  ],
                  rarelyOpenedOver90Days: 34,
                  knowledgeGaps: [],
                  resurfacing: previewResources.slice(3, 6).map(
                    (resource, index) => ({
                      resourceKey: resource.resourceKey,
                      title: resource.title,
                      url: resource.url,
                      path: resource.nativeFolderPath,
                      ageDays: 156 + index * 31,
                      score: 46 - index,
                      reason: "与本月持续关注的主题相关"
                    })
                  ),
                  health: {
                    deadLinks: 7,
                    newlyDetectedDeadLinks: 4,
                    largeFolders: 1
                  }
                },
                topicGraph: {
                  nodes: [
                    { id: "AI Agent", label: "AI Agent", count: 28 },
                    { id: "产品设计", label: "产品设计", count: 23 },
                    { id: "前端性能", label: "前端性能", count: 18 },
                    { id: "React", label: "React", count: 16 },
                    { id: "RAG", label: "RAG", count: 12 },
                    { id: "动画", label: "动画", count: 9 }
                  ],
                  edges: [
                    {
                      source: "AI Agent",
                      target: "RAG",
                      weight: 8
                    },
                    {
                      source: "产品设计",
                      target: "动画",
                      weight: 5
                    },
                    {
                      source: "前端性能",
                      target: "React",
                      weight: 7
                    }
                  ]
                },
                resurfacing: previewResources.slice(0, 9).map(
                  (resource, index) => ({
                    resourceKey: resource.resourceKey,
                    title: resource.title,
                    url: resource.url,
                    path: resource.nativeFolderPath,
                    ageDays: 98 + index * 17,
                    score: 60 - index,
                    reason:
                      index % 2
                        ? "很少通过书签重新打开"
                        : "与你最近关注的“产品设计”相关"
                  })
                )
              }
            };
          case "GET_SITE_BRANDS":
            return {
              ok: true,
              data: structuredClone(previewSiteBrands)
            };
          case "GET_PAGE_SNAPSHOT":
            return { ok: true, data: null };
          case "GET_AGENT_CONVERSATIONS":
            return { ok: true, data: structuredClone(previewConversations) };
          case "GET_UNDO_SNAPSHOTS":
            return {
              ok: true,
              data: [
                {
                  batchId: "preview-chrome-removal",
                  source: "chrome",
                  label: "Chrome 书签管理器删除“产品资料”",
                  destructive: true,
                  createdAt: new Date().toISOString(),
                  expiresAt: new Date(
                    Date.now() + 30 * 86_400_000
                  ).toISOString(),
                  status: "ready",
                  mutations: []
                }
              ]
            };
          case "UNDO_BOOKMARK_BATCH":
            return {
              ok: true,
              data: {
                batch: {
                  batchId: request.batchId || "preview-undo",
                  source: "agent",
                  label: "预览撤销",
                  destructive: false,
                  createdAt: new Date().toISOString(),
                  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
                  status: "undone",
                  mutations: []
                },
                restored: 1,
                failed: 0,
                messages: ["已撤销预览操作。"]
              }
            };
          case "SAVE_AGENT_CONVERSATION":
            if (!request.conversation) {
              return { ok: false, error: "会话内容无效。" };
            }
            previewConversations = [
              request.conversation,
              ...previewConversations.filter(
                (item) => item.id !== request.conversation?.id
              )
            ];
            return {
              ok: true,
              data: structuredClone(request.conversation)
            };
          case "DELETE_AGENT_CONVERSATION":
            previewConversations = previewConversations.filter(
              (item) => item.id !== request.id
            );
            return { ok: true, data: { deleted: true } };
          case "GET_AI_SETTINGS":
            return { ok: true, data: previewAiSettings };
          case "SAVE_AI_SETTINGS": {
            const provider = request.payload?.provider || "gemini";
            const providerName = {
              gemini: "Gemini",
              openai: "OpenAI",
              deepseek: "DeepSeek"
            }[provider];
            const stored = (previewStorage[PREVIEW_AI_SETTINGS_KEY] || {}) as {
              provider?: AiProviderId;
              apiKeys?: Partial<Record<AiProviderId, string>>;
              models?: Partial<Record<AiProviderId, string>>;
            };
            const model =
              request.payload?.model ||
              stored.models?.[provider] ||
              previewAiSettings.providerModels[provider];
            const providedKey = request.payload?.apiKey?.trim() || "";
            const existingKey = stored.apiKeys?.[provider]?.trim() || "";
            const apiKey = providedKey || existingKey;
            if (apiKey.length < 12) {
              return {
                ok: false,
                error: `请输入完整的 ${providerName} API Key。`
              };
            }
            try {
              await validateAiApiKey(provider, apiKey, model);
            } catch (error) {
              return {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : `无法验证 ${providerName} API Key。`
              };
            }
            previewStorage[PREVIEW_AI_SETTINGS_KEY] = {
              provider,
              apiKeys: {
                ...stored.apiKeys,
                [provider]: apiKey
              },
              models: {
                ...stored.models,
                [provider]: model
              }
            };
            previewAiSettings = {
              ...previewAiSettings,
              provider,
              providerName,
              model,
              apiKeyConfigured: true,
              apiKeySuffix: apiKey.slice(-4),
              configuredProviders: [
                ...new Set([
                  ...previewAiSettings.configuredProviders,
                  provider
                ])
              ],
              providerModels: {
                ...previewAiSettings.providerModels,
                [provider]: model
              },
              usingBuiltInService: false
            };
            return { ok: true, data: previewAiSettings };
          }
          case "GET_PENDING_SAVE":
            return { ok: true, data: null };
          case "GET_FOLDERS":
            return { ok: true, data: previewFolderOptions() };
          case "CAPTURE_ACTIVE_PAGE":
            return { ok: true, data: previewCapture };
          case "GET_FOLDER_SUGGESTIONS":
            return {
              ok: true,
              data: [
                {
                  folderId: "preview-folder-0",
                  name: "设计赏析",
                  path: ["书签栏", "设计赏析"],
                  score: 32,
                  reason: "与 3 条相似收藏同目录"
                },
                {
                  folderId: "preview-folder-1",
                  name: "前端代码",
                  path: ["书签栏", "前端代码"],
                  score: 19,
                  reason: "与 1 条相似收藏同目录"
                }
              ]
            };
          case "GET_CONTEXT_RESURFACING":
            return {
              ok: true,
              data: [
                {
                  resourceKey: "preview-resurface",
                  title: "三个月前收藏的交互性能实践",
                  url: "https://example.com/resurface",
                  path: ["书签栏", "前端代码"],
                  ageDays: 128,
                  score: 62,
                  reason: "与你当前浏览的内容相关，且已收藏 128 天"
                }
              ]
            };
          case "GET_NAVIGATION_SUGGESTIONS":
            return { ok: true, data: previewSuggestions };
          case "NAVIGATE":
          case "OPEN_SIDE_PANEL":
            return { ok: true, data: { opened: true } };
          case "OPEN_MANAGER":
            return { ok: true, data: { opened: true, reused: false } };
          case "CANCEL_BOOKMARK_AGENT": {
            const requestId = request.requestId || "";
            const controller = previewAgentRuns.get(requestId);
            controller?.abort(
              new DOMException("AI 请求已停止。", "AbortError")
            );
            return {
              ok: true,
              data: { cancelled: Boolean(controller) }
            };
          }
          case "ASK_BOOKMARK_AGENT": {
            const query = request.query?.trim() || "";
            const requestId = request.requestId || crypto.randomUUID();
            const controller = new AbortController();
            previewAgentRuns.set(requestId, controller);
            try {
              const resources = previewResources.filter(
                (resource) => resource.nativeBookmarkIds.length
              );
              const response = await askBookmarkAgent(
                query,
                resources,
                request.history || [],
                previewAgentCatalog(),
                {
                  signal: controller.signal,
                  onProgress(progress) {
                    emitPreviewRuntimeMessage({
                      type: "BOOKMARK_AGENT_PROGRESS",
                      requestId,
                      ...progress
                    });
                  }
                }
              );
              return { ok: true, data: response };
            } catch (error) {
              return {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "AI 暂时无法回答。"
              };
            } finally {
              if (previewAgentRuns.get(requestId) === controller) {
                previewAgentRuns.delete(requestId);
              }
            }
          }
          case "EXECUTE_BOOKMARK_AGENT_ACTIONS": {
            const results = (request.actions || []).map((action) => {
              try {
                return executePreviewAgentAction(action);
              } catch (error) {
                return {
                  actionId: action.id,
                  success: false,
                  message:
                    error instanceof Error
                      ? error.message
                      : "预览操作失败。"
                };
              }
            });
            return {
              ok: true,
              data: { results, batchId: "preview-agent-undo" }
            };
          }
          case "APPLY_ORGANIZATION_ACTIONS": {
            const results = (request.actions || []).map((action) => ({
              actionId: action.id,
              success: true,
              message: `已执行「${action.label}」。`
            }));
            return {
              ok: true,
              data: { results, batchId: "preview-organize-undo" }
            };
          }
          case "GET_LIBRARY_SCAN":
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "GET_LIBRARY_SCAN_ESTIMATE":
            return {
              ok: true,
              data: {
                total: 261,
                aiResourceCount: 206,
                concurrency: 4,
                estimatedMinutes: 16,
                estimatedInputTokens: 185_400,
                estimatedOutputTokens: 37_080,
                estimatedCostCny: 0.1946,
                pricingUpdatedAt: "2026-07-30",
                providerName: "DeepSeek",
                model: "deepseek-v4-flash",
                priceAvailable: true
              }
            };
          case "GET_AI_USAGE":
            return {
              ok: true,
              data: {
                inputTokens: 48200,
                outputTokens: 9600,
                cachedInputTokens: 0,
                estimatedTokens: 0,
                estimatedCostCny: 0.0679,
                scanCount: 2,
                priceUpdatedAt: "2026-07-30",
                updatedAt: new Date().toISOString()
              }
            };
          case "START_LIBRARY_SCAN":
            previewState.libraryScan = {
              id: "preview-scan",
              state: "running",
              total: 261,
              processed: 47,
              succeeded: 45,
              failed: 1,
              skipped: 1,
              currentTitle: "前端组件交互设计",
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              errors: []
            };
            previewState.aiReadyResourceCount = 55;
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "PAUSE_LIBRARY_SCAN":
            previewState.libraryScan = {
              ...previewState.libraryScan,
              state: "paused",
              currentTitle: ""
            };
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "RESUME_LIBRARY_SCAN":
            previewState.libraryScan = {
              ...previewState.libraryScan,
              state: "running",
              currentTitle: "前端组件交互设计"
            };
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "CANCEL_LIBRARY_SCAN":
            previewState.libraryScan = {
              ...previewState.libraryScan,
              state: "cancelled",
              currentTitle: ""
            };
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "MOVE_NATIVE_BOOKMARK": {
            const id = request.payload?.id || "";
            const parentId = request.payload?.parentId || "";
            const moved = movePreviewNode(
              id,
              parentId,
              request.payload?.index
            );
            return moved
              ? { ok: true, data: structuredClone(moved) }
              : { ok: false, error: "无法移动这个预览书签。" };
          }
          case "UPDATE_RESOURCE_TAGS": {
            const resource = previewResources.find(
              (item) =>
                item.resourceKey === request.payload?.resourceKey
            );
            if (!resource) {
              return { ok: false, error: "没有找到预览元数据。" };
            }
            resource.tags = request.payload?.tags || [];
            resource.tagsSource = "user";
            resource.updatedAt = new Date().toISOString();
            return { ok: true, data: structuredClone(resource) };
          }
          case "UPDATE_NATIVE_BOOKMARK": {
            const match = findPreviewNode(request.payload?.id || "");
            if (!match) {
              return { ok: false, error: "没有找到预览书签。" };
            }
            match.node.title =
              request.payload?.title || match.node.title;
            match.node.url = request.payload?.url || match.node.url;
            const resource = previewResources.find((item) =>
              item.nativeBookmarkIds.includes(match.node.id)
            );
            if (resource) {
              resource.title = match.node.title;
              resource.url = match.node.url || resource.url;
              resource.updatedAt = new Date().toISOString();
            }
            return {
              ok: true,
              data: structuredClone(match.node)
            };
          }
          case "UPDATE_BOOKMARK_DETAILS": {
            const bookmarkId = request.payload?.bookmarkId || "";
            const match = findPreviewNode(bookmarkId);
            const resource = previewResources.find(
              (item) =>
                item.resourceKey === request.payload?.resourceKey &&
                item.nativeBookmarkIds.includes(bookmarkId)
            );
            if (!match || !resource) {
              return { ok: false, error: "没有找到这条预览收藏。" };
            }
            const previousUrl = match.node.url || resource.url;
            const previousTags = [...resource.tags];
            const previousTagsSource = resource.tagsSource;
            match.node.title = request.payload?.title || match.node.title;
            match.node.url = request.payload?.url || previousUrl;
            const requestedParentId =
              request.payload?.parentId || match.node.parentId || "";
            const moved =
              requestedParentId &&
              requestedParentId !== match.node.parentId
                ? movePreviewNode(bookmarkId, requestedParentId)
                : match.node;
            if (!moved) {
              return { ok: false, error: "无法移动这条预览收藏。" };
            }
            const bookmarkUrlChanged = match.node.url !== previousUrl;
            const resourceIdentityChanged =
              bookmarkUrlChanged &&
              ![
                resource.url,
                resource.canonicalUrl,
                ...(resource.aliases || [])
              ].some((candidate) => {
                try {
                  return (
                    canonicalizeUrl(candidate) ===
                    canonicalizeUrl(match.node.url || previousUrl)
                  );
                } catch {
                  return false;
                }
              });
            resource.title = match.node.title;
            resource.url = match.node.url || resource.url;
            resource.userNote = request.payload?.userNote || "";
            if (request.payload?.tagsChanged) {
              resource.tags = request.payload.tags || [];
              resource.tagsSource = resource.tags.length
                ? "user"
                : undefined;
            }
            resource.updatedAt = new Date().toISOString();
            if (resourceIdentityChanged) {
              resource.canonicalUrl = resource.url;
              resource.summary = "";
              resource.topics = [];
              resource.snapshotAt = undefined;
              resource.aiStatus = "pending";
              if (!request.payload?.tagsChanged) {
                resource.tags =
                  previousTagsSource === "user" ? previousTags : [];
                resource.tagsSource = resource.tags.length
                  ? "user"
                  : undefined;
              }
            }
            return {
              ok: true,
              data: {
                bookmark: structuredClone(moved),
                resource: structuredClone(resource),
                urlChanged: resourceIdentityChanged
              }
            };
          }
          case "DELETE_NATIVE_BOOKMARK": {
            const id = request.payload?.id || "";
            if (!removePreviewNode(id)) {
              return { ok: false, error: "没有找到这条预览收藏。" };
            }
            const resource = previewResources.find((item) =>
              item.nativeBookmarkIds.includes(id)
            );
            if (resource) {
              resource.nativeBookmarkIds =
                resource.nativeBookmarkIds.filter(
                  (bookmarkId) => bookmarkId !== id
                );
            }
            return { ok: true, data: { deleted: true } };
          }
          case "SAVE_BOOKMARK": {
            const destination =
              request.payload?.folderId === previewRoot.id
                ? previewRoot
                : findPreviewNode(request.payload?.folderId || "")?.node;
            if (!destination || destination.url) {
              return { ok: false, error: "请选择一个预览文件夹。" };
            }
            const savedNode: NativeBookmarkNode = {
              id: `preview-saved-${Date.now()}`,
              parentId: destination.id,
              index: destination.children?.length || 0,
              title: request.payload?.title || previewCapture.title,
              url: previewCapture.url
            };
            destination.children = [...(destination.children || []), savedNode];
            return {
              ok: true,
              data: {
                resource: null,
                nativeBookmarkCreated: true,
                cloudSyncAttempted: false
              }
            };
          }
          default:
            return { ok: false, error: "设计预览不执行数据写入操作。" };
        }
      }
    },
    bookmarks: {
      onCreated: previewEvent,
      onChanged: previewEvent,
      onMoved: previewEvent,
      onRemoved: previewEvent,
      onChildrenReordered: previewEvent
    },
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        return true;
      }
    },
    storage: {
      local: {
        async get(key: string) {
          return { [key]: previewStorage[key] };
        },
        async set(values: Record<string, unknown>) {
          Object.assign(previewStorage, values);
        },
        async remove(key: string) {
          delete previewStorage[key];
        }
      }
    }
  };

  const previewGlobals = [
    globalThis as unknown as { chrome?: Record<string, unknown> },
    window as unknown as { chrome?: Record<string, unknown> }
  ];
  const previewChromeTargets = [
    ...(typeof chrome !== "undefined"
      ? [chrome as unknown as Record<string, unknown>]
      : []),
    ...previewGlobals
      .map((previewGlobal) => previewGlobal.chrome)
      .filter((value): value is Record<string, unknown> => Boolean(value))
  ];

  // 普通 Chrome 网页与内置预览浏览器可能暴露不同的全局对象；
  // 开发预览同时补齐两侧，避免依赖具体浏览器的全局对象实现。
  for (const existingChrome of previewChromeTargets) {
    for (const [namespace, previewApi] of Object.entries(previewChrome)) {
      const existingApi = existingChrome[namespace];
      try {
        Object.defineProperty(existingChrome, namespace, {
          configurable: true,
          enumerable: true,
          value: previewApi,
          writable: true
        });
      } catch {
        if (
          existingApi &&
          typeof existingApi === "object" &&
          typeof previewApi === "object"
        ) {
          Object.assign(existingApi, previewApi);
        } else {
          try {
            existingChrome[namespace] = previewApi;
          } catch {
            // Some browser shells expose a non-configurable `chrome` object;
            // the normal development preview path still uses the object above.
          }
        }
      }
    }
  }

  for (const previewGlobal of previewGlobals) {
    if (previewGlobal.chrome) continue;
    Object.defineProperty(previewGlobal, "chrome", {
      configurable: true,
      value: previewChrome,
      writable: true
    });
  }
}
