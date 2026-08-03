import { extractPageEssenceFromHtml } from "../../lib/page-essence";
import { getAiProviderPreset, getAiRuntimeSettings } from "../../lib/settings";
import { needsAiEnrichment } from "../../lib/ai-fields";
import { getLocalResource, getPageSnapshot } from "../../lib/storage";
import { isPageSnapshotStale } from "../../lib/page-snapshot";
import {
  isEnhancementJobDue,
  type AiEnhancementProgress,
  type BookmarkEnhancementJob,
  type BookmarkEnhancementPart,
  type SnapshotEnhancementProgress
} from "../../lib/bookmark-enhancement";
import {
  BOOKMARK_ENHANCEMENT_ALARM,
  scheduleBookmarkEnhancements
} from "../lifecycle/alarms";
import type { ResourceRecord } from "../../lib/types";

const MAX_SCAN_HTML_BYTES = 600_000;
const SAVED_PAGE_SNAPSHOT_DELAY_MS = 250;
const USER_PROTECTION_MESSAGE = "这条收藏受用户保护，不会读取或发送页面内容。";

interface EnhancementQueueDependencies {
  cancelEnhancementForResource(resourceKey: string): Promise<void>;
  getPrivacyProtectionContext(): Promise<{ pageSnapshotsEnabled: boolean }>;
  resourceProtectionState(resource: ResourceRecord, context: unknown): { protected: boolean; userProtected?: boolean };
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  updateStoredAiProgress(resourceKey: string, progress: Omit<AiEnhancementProgress, "updatedAt">): Promise<void>;
  updateStoredSnapshotProgress(resourceKey: string, progress: Omit<SnapshotEnhancementProgress, "updatedAt">): Promise<void>;
  completeStoredEnhancementPart(resourceKey: string, part: BookmarkEnhancementPart): Promise<void>;
  deferStoredEnhancementJob(resourceKey: string, message: string): Promise<void>;
  getStoredEnhancementJobs(): Promise<Record<string, BookmarkEnhancementJob>>;
  hasPageAccess(url: string): Promise<boolean>;
  resourceMatchesLoadedUrl(resource: ResourceRecord, url: string): boolean;
  rememberImmediateSnapshotTarget(tab: chrome.tabs.Tab, targetUrl: string, delayMs: number, showToast: boolean, resourceKey?: string, documentId?: string, trigger?: SnapshotEnhancementProgress["trigger"]): Promise<void>;
  errorMessage(error: unknown): string;
}

export function createEnhancementQueue(dependencies: EnhancementQueueDependencies) {
  const {
    cancelEnhancementForResource,
    getPrivacyProtectionContext,
    resourceProtectionState,
    upsertLocalResource,
    updateStoredAiProgress,
    updateStoredSnapshotProgress,
    completeStoredEnhancementPart,
    deferStoredEnhancementJob,
    getStoredEnhancementJobs,
    hasPageAccess,
    resourceMatchesLoadedUrl,
    rememberImmediateSnapshotTarget,
    errorMessage
  } = dependencies;
  let bookmarkEnhancementRunning = false;
  const now = () => new Date().toISOString();
async function readLimitedText(
  response: Response,
  maxBytes = MAX_SCAN_HTML_BYTES
): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      const chunk = value.byteLength > remaining
        ? value.slice(0, remaining)
        : value;
      size += chunk.byteLength;
      result += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) break;
    }
    result += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return result;
}

async function pageEssenceForResource(resource: ResourceRecord) {
  try {
    const response = await fetch(resource.url, {
      credentials: "omit",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2"
      },
      signal: AbortSignal.timeout(15_000)
    });
    const contentType = response.headers.get("content-type") || "";
    if (
      !response.ok ||
      /(?:^|\/)(?:login|signin|sign-in|auth)(?:\/|$)/i.test(
        new URL(response.url || resource.url).pathname
      ) ||
      (!contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml"))
    ) {
      return null;
    }
    const essence = extractPageEssenceFromHtml(
      await readLimitedText(response),
      response.url || resource.url
    );
    return essence.description ||
      essence.h1 ||
      essence.firstParagraph ||
      essence.keywords.length
      ? essence
      : null;
  } catch {
    // 登录墙、失效链接或网络失败不能伪装成完整增强。保留任务，等用户
    // 正常访问该网页后再从真实渲染 DOM 读取正文。
    return null;
  }
}

async function processOneBookmarkEnhancement(
  job: BookmarkEnhancementJob
): Promise<void> {
  let resource = await getLocalResource(job.resourceKey);
  if (!resource?.nativeBookmarkIds.length) {
    await cancelEnhancementForResource(job.resourceKey);
    return;
  }

  const privacyContext = await getPrivacyProtectionContext();
  const protection = resourceProtectionState(resource, privacyContext);
  const privacyBlocked = protection.protected;
  let enhancementDeferred = false;
  if (job.pending.includes("ai")) {
    if (privacyBlocked) {
      resource = {
        ...resource,
        aiStatus: "unavailable",
        enhancementBlockReason: "privacy",
        enhancementBlockMessage: protection.userProtected
          ? USER_PROTECTION_MESSAGE
          : "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
        updatedAt: now()
      };
      await upsertLocalResource(resource);
      await updateStoredAiProgress(job.resourceKey, {
        state: "privacy_blocked",
        lastError: resource.enhancementBlockMessage
      });
      await completeStoredEnhancementPart(job.resourceKey, "ai");
    } else if (!needsAiEnrichment(resource)) {
      await completeStoredEnhancementPart(job.resourceKey, "ai");
    } else {
      const runtime = await getAiRuntimeSettings();
      if (!runtime.apiKey) {
        if (resource.aiStatus !== "pending") {
          resource = {
            ...resource,
            aiStatus: "pending",
            updatedAt: now()
          };
          await upsertLocalResource(resource);
        }
        await deferStoredEnhancementJob(
          job.resourceKey,
          `等待配置 ${getAiProviderPreset(runtime.provider).name} API Key。`
        );
        await updateStoredAiProgress(job.resourceKey, {
          state: "waiting_for_key",
          lastError: `等待配置 ${getAiProviderPreset(runtime.provider).name} API Key。`
        });
        enhancementDeferred = true;
      } else {
        resource = {
          ...resource,
          aiStatus: "pending",
          updatedAt: now()
        };
        await upsertLocalResource(resource);
        await deferStoredEnhancementJob(
          job.resourceKey,
          "等待用户正常访问网页后读取真实渲染正文。"
        );
        await updateStoredAiProgress(job.resourceKey, {
          state: "waiting_for_content",
          lastError: "等待真实网页访问后读取渲染正文。"
        });
        enhancementDeferred = true;
      }
    }
  }

  const latestJobs = await getStoredEnhancementJobs();
  const latestJob = latestJobs[job.resourceKey];
  if (!latestJob?.pending.includes("snapshot")) return;
  resource = (await getLocalResource(job.resourceKey)) || resource;
  const existingSnapshot = await getPageSnapshot(resource.canonicalUrl);
  if (
    existingSnapshot &&
    (!latestJob.snapshot?.refreshExisting ||
      !isPageSnapshotStale(existingSnapshot))
  ) {
    await completeStoredEnhancementPart(job.resourceKey, "snapshot");
    return;
  }
  if (
    !privacyContext.pageSnapshotsEnabled ||
    privacyBlocked
  ) {
    // 受保护网站按隐私规则永远使用 Aarre 兜底图，不进行后台窥探。
    await updateStoredSnapshotProgress(job.resourceKey, {
      state: "privacy_blocked",
      trigger: job.snapshot?.trigger || "recovery",
      lastError: "隐私保护网站不生成页面截图。"
    });
    await completeStoredEnhancementPart(job.resourceKey, "snapshot");
    return;
  }
  if (!(await hasPageAccess(resource.url))) {
    if (!enhancementDeferred) {
      await deferStoredEnhancementJob(
        job.resourceKey,
        "等待截图权限；从 Aarre 打开该收藏后会继续。"
      );
    }
    return;
  }
  const focusedWindow = await chrome.windows.getLastFocused();
  const tabs = await chrome.tabs.query({
    active: true,
    ...(typeof focusedWindow.id === "number"
      ? { windowId: focusedWindow.id }
      : { lastFocusedWindow: true })
  });
  const matchingTab = tabs.find(
    (tab) => tab.url && resourceMatchesLoadedUrl(resource!, tab.url)
  );
  if (matchingTab) {
    await rememberImmediateSnapshotTarget(
      matchingTab,
      resource.canonicalUrl,
      SAVED_PAGE_SNAPSHOT_DELAY_MS,
      job.snapshot?.showToast === true,
      resource.resourceKey,
      job.snapshot?.documentId,
      job.snapshot?.trigger || "recovery"
    );
  } else {
    await updateStoredSnapshotProgress(job.resourceKey, {
      state: "waiting_foreground",
      trigger: job.snapshot?.trigger || "recovery",
      ...(job.snapshot?.showToast ? { showToast: true } : {}),
      ...(job.snapshot?.refreshExisting ? { refreshExisting: true } : {})
    });
  }
  if (!enhancementDeferred) {
    await deferStoredEnhancementJob(
      job.resourceKey,
      "等待目标网页处于前台并加载稳定。"
    );
  }
}

async function processBookmarkEnhancements(): Promise<void> {
  if (bookmarkEnhancementRunning) return;
  bookmarkEnhancementRunning = true;
  try {
    const jobs = await getStoredEnhancementJobs();
    const due = Object.values(jobs)
      .filter((job) => isEnhancementJobDue(job))
      .sort((left, right) =>
        left.nextAttemptAt.localeCompare(right.nextAttemptAt)
      )
      .slice(0, 4);
    for (const job of due) {
      await processOneBookmarkEnhancement(job).catch((error) =>
        deferStoredEnhancementJob(job.resourceKey, errorMessage(error))
      );
    }
  } finally {
    bookmarkEnhancementRunning = false;
    const remaining = Object.values(
      await getStoredEnhancementJobs()
    );
    if (remaining.length) {
      const nextAttempt = Math.min(
        ...remaining.map((job) => {
          const parsed = Date.parse(job.nextAttemptAt);
          return Number.isFinite(parsed) ? parsed : Date.now();
        })
      );
      await scheduleBookmarkEnhancements(
        Math.max(0.5, (nextAttempt - Date.now()) / 60_000)
      );
    } else {
      await chrome.alarms.clear(BOOKMARK_ENHANCEMENT_ALARM);
    }
  }
}

  return {
    readLimitedText,
    pageEssenceForResource,
    processBookmarkEnhancements
  };
}
