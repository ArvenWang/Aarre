import type {
  BookmarkAgentProgress,
  PageCapture,
  ResourceRecord
} from "../src/lib/types";

const apiKey = process.env.AARRE_LIVE_AI_KEY?.trim() || "";
const provider = process.env.AARRE_LIVE_AI_PROVIDER?.trim() || "deepseek";
const model =
  process.env.AARRE_LIVE_AI_MODEL?.trim() || "deepseek-v4-flash";

if (!apiKey) {
  throw new Error(
    "Missing AARRE_LIVE_AI_KEY. The live verification never reads keys from the repository."
  );
}
if (provider !== "deepseek") {
  throw new Error("This verification currently supports DeepSeek only.");
}

const SETTINGS_KEY = "bookmark-layer:ai-settings";
const memory = new Map<string, unknown>([
  [
    SETTINGS_KEY,
    {
      provider,
      apiKeys: { [provider]: apiKey },
      models: { [provider]: model }
    }
  ]
]);

function storageResult(
  keys: string | string[] | Record<string, unknown> | null
): Record<string, unknown> {
  if (keys === null) return Object.fromEntries(memory);
  if (typeof keys === "string") return { [keys]: memory.get(keys) };
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, memory.get(key)]));
  }
  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [
      key,
      memory.has(key) ? memory.get(key) : fallback
    ])
  );
}

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      local: {
        async get(keys: string | string[] | Record<string, unknown> | null) {
          return storageResult(keys);
        },
        async set(values: Record<string, unknown>) {
          for (const [key, value] of Object.entries(values)) {
            memory.set(key, value);
          }
        }
      }
    }
  }
});

const { askBookmarkAgent, enrichResourceLocally } = await import(
  "../src/lib/local-ai"
);
const { validateAiApiKey } = await import("../src/lib/settings");

function resource(
  index: number,
  overrides: Partial<ResourceRecord> = {}
): ResourceRecord {
  const id = String(index + 1);
  return {
    resourceKey: `live-resource-${id}`,
    canonicalUrl: `https://example.com/resource-${id}`,
    url: `https://example.com/resource-${id}`,
    title: `普通资料 ${id}`,
    userNote: "",
    summary: "与旅行规划和日常阅读有关的普通收藏。",
    tags: ["普通资料"],
    topics: ["日常阅读"],
    aliases: ["reference"],
    useCases: ["查找普通参考资料时打开"],
    contentType: "文章",
    questions: ["有没有普通参考资料"],
    entities: [],
    contentExcerpt: "普通资料摘要。",
    contentHash: `hash-${id}`,
    selectedText: "",
    author: "Aarre Live Test",
    siteName: "example.com",
    language: "zh-CN",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [`bookmark-${id}`],
    nativeFolderPath: ["书签栏", "测试资料"],
    aiStatus: "ready",
    aiSchemaVersion: 2,
    syncStatus: "local",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides
  };
}

function targetResource(
  index: number,
  title: string,
  url: string,
  summary: string,
  tags: string[]
): ResourceRecord {
  return resource(index, {
    resourceKey: `target-${index}`,
    canonicalUrl: url,
    url,
    title,
    summary,
    tags,
    topics: ["前端开发", "组件库"],
    aliases: ["UI library", "component library", title],
    useCases: ["开发 Web 界面并复用无障碍组件时打开"],
    contentType: "工具",
    questions: ["有哪些前端组件库", "哪里能找到可复用 UI 组件"],
    contentExcerpt: summary,
    nativeFolderPath: ["书签栏", "前端代码与组件"]
  });
}

const github = resource(0, {
  resourceKey: "target-github",
  canonicalUrl: "https://github.com/",
  url: "https://github.com/",
  title: "GitHub — 代码仓库",
  summary:
    "托管 Git 代码、Issue、Pull Request 与 Actions 的软件协作平台。",
  tags: ["Git", "代码托管", "协作开发"],
  topics: ["软件开发"],
  aliases: ["GitHub", "代码仓库", "repository hosting"],
  useCases: ["查看源码、Issue 或 Pull Request 时打开"],
  contentType: "工具",
  questions: ["我的 GitHub 收藏在哪里", "哪里能找代码仓库"],
  entities: ["GitHub", "Git"],
  contentExcerpt: "GitHub helps developers build and ship software.",
  siteName: "GitHub",
  nativeFolderPath: ["书签栏", "开发工具"]
});

const quickCatalog = [
  github,
  ...Array.from({ length: 39 }, (_, index) => resource(index + 1))
];

const fullCatalog = Array.from({ length: 125 }, (_, index) => resource(index));
const expectedComponents = [
  targetResource(
    5,
    "Radix UI",
    "https://www.radix-ui.com/",
    "面向 React 的无样式、可访问 UI 组件原语库。",
    ["React", "无障碍", "组件库"]
  ),
  targetResource(
    64,
    "shadcn/ui",
    "https://ui.shadcn.com/",
    "可复制进项目并按需定制的 React 组件集合。",
    ["React", "Tailwind CSS", "组件库"]
  ),
  targetResource(
    91,
    "Material UI",
    "https://mui.com/",
    "基于 Material Design 的 React UI 组件库。",
    ["React", "Material Design", "组件库"]
  ),
  targetResource(
    123,
    "React Aria Components",
    "https://react-spectrum.adobe.com/react-aria/",
    "Adobe 提供的无障碍 React 组件和交互行为库。",
    ["React", "Adobe", "无障碍", "组件库"]
  )
];
for (const item of expectedComponents) {
  const index = Number(item.resourceKey.replace("target-", ""));
  fullCatalog[index] = item;
}

const capture: PageCapture = {
  url: "https://gradient.example.com/",
  canonicalUrl: "https://gradient.example.com/",
  title: "Smooth Gradient Overlay Generator",
  description: "生成可复制到网页中的 CSS 渐变叠加代码。",
  content:
    "这个工具帮助前端开发者生成平滑的 CSS 渐变背景，支持调整颜色、透明度和缓动曲线，并复制生成的代码。".repeat(
      8
    ),
  excerpt: "生成平滑 CSS 渐变叠加代码的在线工具。",
  selectedText: "",
  author: "",
  siteName: "Gradient Tools",
  language: "zh-CN",
  imageUrl: "",
  faviconUrl: "",
  headings: ["Smooth Gradient", "CSS Overlay", "Copy Code"]
};

const report: Record<string, unknown> = {
  provider,
  model,
  startedAt: new Date().toISOString()
};

const validationStartedAt = Date.now();
await validateAiApiKey("deepseek", apiKey, model);
report.keyValidation = { elapsedMs: Date.now() - validationStartedAt };

const enrichmentStartedAt = Date.now();
const enriched = await enrichResourceLocally(
  resource(500, {
    resourceKey: "enrichment-target",
    canonicalUrl: capture.canonicalUrl,
    url: capture.url,
    title: capture.title,
    summary: "",
    tags: [],
    topics: [],
    aliases: [],
    useCases: [],
    questions: [],
    entities: [],
    contentExcerpt: capture.excerpt,
    aiStatus: "pending"
  }),
  capture
);
report.enrichment = {
  elapsedMs: Date.now() - enrichmentStartedAt,
  ready: enriched.aiStatus === "ready",
  schemaVersion: enriched.aiSchemaVersion,
  summaryLength: enriched.summary.length,
  tags: enriched.tags,
  topics: enriched.topics,
  contentType: enriched.contentType,
  aliases: enriched.aliases?.length || 0,
  useCases: enriched.useCases?.length || 0,
  questions: enriched.questions?.length || 0
};

const quickProgress: Array<
  Pick<BookmarkAgentProgress, "stage" | "completed" | "total" | "label">
> = [];
const quickStartedAt = Date.now();
const quick = await askBookmarkAgent(
  "GitHub 那条收藏主要能帮我做什么？",
  quickCatalog,
  [],
  { bookmarks: [], folders: [] },
  {
    onProgress(progress) {
      quickProgress.push({
        stage: progress.stage,
        completed: progress.completed,
        total: progress.total,
        label: progress.label
      });
    }
  }
);
report.quickAgent = {
  elapsedMs: Date.now() - quickStartedAt,
  catalogSize: quick.catalogSize,
  sourceKeys: quick.sources.map((source) => source.resourceKey),
  answer: quick.answer.slice(0, 320),
  stages: quickProgress.map((progress) => progress.stage)
};

const fullProgress: Array<
  Pick<BookmarkAgentProgress, "stage" | "completed" | "total" | "label">
> = [];
const fullStartedAt = Date.now();
const full = await askBookmarkAgent(
  "请检查全部收藏，找出所有前端组件库，列出名称。",
  fullCatalog,
  [],
  { bookmarks: [], folders: [] },
  {
    onProgress(progress) {
      fullProgress.push({
        stage: progress.stage,
        completed: progress.completed,
        total: progress.total,
        label: progress.label
      });
    }
  }
);
const expectedComponentKeys = expectedComponents.map(
  (item) => item.resourceKey
);
const recalledComponentKeys = full.sources
  .map((source) => source.resourceKey)
  .filter((key) => expectedComponentKeys.includes(key));
report.fullAgent = {
  elapsedMs: Date.now() - fullStartedAt,
  catalogSize: full.catalogSize,
  expectedComponentKeys,
  recalledComponentKeys,
  allExpectedRecalled: expectedComponentKeys.every((key) =>
    recalledComponentKeys.includes(key)
  ),
  answer: full.answer.slice(0, 500),
  progress: fullProgress
};

const cancellationController = new AbortController();
let cancellationScheduled = false;
const cancellationStartedAt = Date.now();
try {
  await askBookmarkAgent(
    "请在全部收藏中找出所有设计和前端开发相关内容。",
    fullCatalog,
    [],
    { bookmarks: [], folders: [] },
    {
      signal: cancellationController.signal,
      onProgress(progress) {
        if (progress.stage === "scanning" && !cancellationScheduled) {
          cancellationScheduled = true;
          setTimeout(
            () =>
              cancellationController.abort(
                new DOMException("AI 请求已停止。", "AbortError")
              ),
            120
          );
        }
      }
    }
  );
  report.cancellation = {
    stopped: false,
    elapsedMs: Date.now() - cancellationStartedAt
  };
} catch (error) {
  report.cancellation = {
    stopped: cancellationController.signal.aborted,
    elapsedMs: Date.now() - cancellationStartedAt,
    message: error instanceof Error ? error.message : String(error)
  };
}

const usage = memory.get("aarre:ai-gateway-usage:v1") as
  | {
      tokens?: number;
      operations?: Record<string, number>;
    }
  | undefined;
report.usage = {
  tokens: usage?.tokens || 0,
  operations: usage?.operations || {}
};
report.finishedAt = new Date().toISOString();

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const quickPassed = quick.sources.some(
  (source) => source.resourceKey === github.resourceKey
);
const fullPassed =
  expectedComponentKeys.every((key) => recalledComponentKeys.includes(key));
const enrichmentPassed =
  enriched.aiStatus === "ready" &&
  enriched.aiSchemaVersion === 2 &&
  Boolean(enriched.summary) &&
  Boolean(enriched.tags.length) &&
  Boolean(enriched.topics.length) &&
  Boolean(enriched.aliases?.length) &&
  Boolean(enriched.useCases?.length) &&
  Boolean(enriched.questions?.length);

if (!quickPassed || !fullPassed || !enrichmentPassed) {
  process.exitCode = 1;
}
