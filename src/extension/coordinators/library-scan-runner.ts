import { getAuthState } from "../../lib/auth";
import { getAiProviderPreset, getAiRuntimeSettings } from "../../lib/settings";
import { needsAiEnrichment } from "../../lib/ai-fields";
import { checkLinkHealth } from "../../lib/link-health";
import { cacheRepresentativeImage } from "../../lib/thumbnail";
import { isInternalOrSensitiveUrl } from "../../lib/page-essence";
import { categoryCoverForResource, matchCoverRule, resolveRuleAsset } from "../../lib/cover-registry";
import { costCnyForUsage, estimateScanCost } from "../../lib/ai-cost";
import { addScanAiUsage } from "../../lib/usage-stats";
import { enqueueOutbox, getLocalResource } from "../../lib/storage";
import { putCoverVisual } from "../../lib/visuals";
import { DomainRateLimiter, runConcurrentTasks } from "../../lib/scan-scheduler";
import { LIBRARY_SCAN_ALARM, scheduleLibraryScan } from "../lifecycle/alarms";
import type {
  AiTokenUsage,
  LibraryScanStatus,
  PageEssence,
  ResourceRecord,
  SiteBrandRecord
} from "../../lib/types";
import {
  getStoredLibraryScan,
  publicLibraryScan,
  setStoredLibraryScan,
  type StoredLibraryScanJob
} from "./library-scan-state";

const LIBRARY_SCAN_CONCURRENCY = 4;
const USER_PROTECTION_MESSAGE = "这条收藏受用户保护，不会读取或发送页面内容。";

interface LibraryScanRunnerDependencies {
  libraryScanCandidates(force?: boolean): Promise<{ runtime: Awaited<ReturnType<typeof getAiRuntimeSettings>>; resources: ResourceRecord[]; aiResourceCount: number }>;
  ensureStoredOrganizationInsights(force?: boolean): Promise<unknown>;
  getPrivacyProtectionContext(): Promise<unknown>;
  resourceProtectionState(resource: ResourceRecord, context: unknown): { protected: boolean; userProtected?: boolean };
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  pageEssenceForResource(resource: ResourceRecord): Promise<PageEssence | null>;
  siteIconHandlers: {
    scanSiteBrand(resource: ResourceRecord, essence: PageEssence, force: boolean): Promise<SiteBrandRecord | undefined>;
    registerPageImageSample(resource: ResourceRecord, imageUrl: string): Promise<boolean>;
  };
  syncPendingIfReady(): Promise<unknown>;
  errorMessage(error: unknown): string;
}

export function createLibraryScanRunner(dependencies: LibraryScanRunnerDependencies) {
  const {
    libraryScanCandidates,
    ensureStoredOrganizationInsights,
    getPrivacyProtectionContext,
    resourceProtectionState,
    upsertLocalResource,
    pageEssenceForResource,
    siteIconHandlers,
    syncPendingIfReady,
    errorMessage
  } = dependencies;
  const libraryScanRateLimiter = new DomainRateLimiter(1_000);
  let libraryScanRunning = false;
  const now = () => new Date().toISOString();


async function startLibraryScan(force = false): Promise<LibraryScanStatus> {
  const { runtime, resources, aiResourceCount } =
    await libraryScanCandidates(force);
  const estimate = estimateScanCost(
    aiResourceCount,
    runtime.provider,
    runtime.model,
    LIBRARY_SCAN_CONCURRENCY
  );
  const timestamp = now();
  const job: StoredLibraryScanJob = {
    id: crypto.randomUUID(),
    state: resources.length ? "running" : "completed",
    total: resources.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: resources.length ? undefined : timestamp,
    errors: [],
    resourceKeys: resources.map((resource) => resource.resourceKey),
    nextIndex: 0,
    force,
    concurrency: LIBRARY_SCAN_CONCURRENCY,
    estimatedMinutes: estimate.estimatedMinutes,
    ...(estimate.estimatedCostCny !== null
      ? { estimatedCostCny: estimate.estimatedCostCny }
      : {}),
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualCachedInputTokens: 0,
    actualCostCny: 0,
    pricingUpdatedAt: estimate.pricingUpdatedAt,
    provider: runtime.provider,
    providerName: getAiProviderPreset(runtime.provider).name,
    model: runtime.model,
    actualUsageEstimated: false,
    usageRecorded: false
  };
  await setStoredLibraryScan(job);
  if (resources.length) {
    await scheduleLibraryScan();
    void runLibraryScan();
  } else {
    await ensureStoredOrganizationInsights(true).catch(
      () => undefined
    );
  }
  return publicLibraryScan(job);
}

async function updateLibraryScanState(
  state: "paused" | "running" | "cancelled"
): Promise<LibraryScanStatus> {
  const job = await getStoredLibraryScan();
  if (!job.id) {
    throw new Error("当前没有全目录扫描任务。");
  }
  if (
    state === "running" &&
    !["paused", "failed"].includes(job.state)
  ) {
    return publicLibraryScan(job);
  }
  if (
    state !== "running" &&
    !["running", "paused"].includes(job.state)
  ) {
    return publicLibraryScan(job);
  }
  const timestamp = now();
  const next: StoredLibraryScanJob = {
    ...job,
    state,
    currentTitle: state === "running" ? job.currentTitle : "",
    updatedAt: timestamp,
    completedAt: state === "cancelled" ? timestamp : job.completedAt
  };
  await setStoredLibraryScan(next);
  if (state === "running") {
    await scheduleLibraryScan();
    void runLibraryScan();
  } else if (state === "cancelled") {
    await chrome.alarms.clear(LIBRARY_SCAN_ALARM);
  }
  return publicLibraryScan(next);
}

interface ScanResourceResult {
  resource: ResourceRecord;
  outcome: "succeeded" | "failed" | "skipped";
  message?: string;
  usage?: AiTokenUsage;
}

function removedResourcePlaceholder(resourceKey: string): ResourceRecord {
  return {
    resourceKey,
    canonicalUrl: "",
    url: "",
    title: "已移除的书签",
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "",
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [],
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: now(),
    updatedAt: now()
  };
}

async function scanOneLibraryResource(
  resource: ResourceRecord,
  job: StoredLibraryScanJob,
  knownPrivacyContext?: unknown
): Promise<ScanResourceResult> {
  const privacyContext =
    knownPrivacyContext || (await getPrivacyProtectionContext());
  const protection = resourceProtectionState(resource, privacyContext);
  if (
    isInternalOrSensitiveUrl(resource.url) ||
    protection.protected
  ) {
    const blocked = {
      ...resource,
      aiStatus: "unavailable" as const,
      enhancementBlockReason: "privacy" as const,
      enhancementBlockMessage: protection.userProtected
        ? USER_PROTECTION_MESSAGE
        : "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
      updatedAt: now()
    };
    await upsertLocalResource(blocked);
    return {
      resource: blocked,
      outcome: "skipped",
      message: "内部或受保护网址不会发起网络请求。"
    };
  }
  const stopIfProtectedNow = async (): Promise<ScanResourceResult | null> => {
    const latest = await getLocalResource(resource.resourceKey);
    if (!latest?.nativeBookmarkIds.length) {
      return {
        resource: latest || resource,
        outcome: "skipped",
        message: "书签已被移除。"
      };
    }
    const currentContext = await getPrivacyProtectionContext();
    const currentProtection = resourceProtectionState(
      latest,
      currentContext
    );
    if (!currentProtection.protected) return null;
    const blocked: ResourceRecord = {
      ...latest,
      aiStatus: latest.aiStatus === "ready" ? "ready" : "unavailable",
      enhancementBlockReason: "privacy",
      enhancementBlockMessage: currentProtection.userProtected
        ? USER_PROTECTION_MESSAGE
        : "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
      updatedAt: now()
    };
    await upsertLocalResource(blocked);
    return {
      resource: blocked,
      outcome: "skipped",
      message: "保护规则已生效，已停止当前扫描。"
    };
  };
  const runtime = await getAiRuntimeSettings();
  const needsAi =
    Boolean(runtime.apiKey) && needsAiEnrichment(resource, job.force);
  let scannedResource: ResourceRecord = {
    ...resource,
    aiStatus: needsAi ? "processing" : resource.aiStatus,
    updatedAt: now()
  };
  await upsertLocalResource(scannedResource);
  try {
    const linkHealth = await checkLinkHealth(
      resource.url,
      resource.linkHealth
    );
    scannedResource = {
      ...scannedResource,
      linkHealth,
      updatedAt: now()
    };
    await upsertLocalResource(scannedResource);
    const stoppedAfterLinkCheck = await stopIfProtectedNow();
    if (stoppedAfterLinkCheck) return stoppedAfterLinkCheck;
    if (
      ["dead", "soft_404", "login_required", "temporary"].includes(
        linkHealth.status
      )
    ) {
      scannedResource = {
        ...scannedResource,
        aiStatus: resource.aiStatus,
        updatedAt: now()
      };
      await upsertLocalResource(scannedResource);
      return { resource: scannedResource, outcome: "succeeded" };
    }

    const essence = await pageEssenceForResource(resource);
    if (!essence) {
      const waiting = {
        ...scannedResource,
        aiStatus: needsAi ? ("pending" as const) : scannedResource.aiStatus,
        updatedAt: now()
      };
      await upsertLocalResource(waiting);
      return {
        resource: waiting,
        outcome: "skipped",
        message: "未获得可信公开正文，等待用户正常访问网页后再增强。"
      };
    }
    const stoppedAfterPageRead = await stopIfProtectedNow();
    if (stoppedAfterPageRead) return stoppedAfterPageRead;
    const siteBrand = await siteIconHandlers.scanSiteBrand(
      resource,
      essence,
      job.force
    );
    const coverRule = matchCoverRule(resource.url);
    const registryPageImage = resolveRuleAsset(
      resource.url,
      "pageImage"
    );
    let thumbnailDataUrl = resource.thumbnailDataUrl || "";
    let representativeImageUrl =
      coverRule?.skipPageImage || siteBrand?.skipPageImage
        ? ""
        : registryPageImage || essence.imageUrl || resource.imageUrl;
    const commonPageImage =
      representativeImageUrl &&
      !registryPageImage &&
      (await siteIconHandlers.registerPageImageSample(
        resource,
        representativeImageUrl
      ));
    if (commonPageImage) representativeImageUrl = "";
    const coverSource = commonPageImage
      ? "category:common-banner"
      : coverRule?.skipPageImage || siteBrand?.skipPageImage
        ? `category:${coverRule?.id || "common-banner"}`
        : registryPageImage
          ? `registry:${coverRule?.id || "page-image"}`
          : representativeImageUrl
            ? "page-metadata"
            : "category";
    if (
      representativeImageUrl &&
      (!thumbnailDataUrl ||
        resource.imageUrl !== representativeImageUrl ||
        job.force)
    ) {
      try {
        thumbnailDataUrl = await cacheRepresentativeImage(
          representativeImageUrl
        );
      } catch {
        // 原图仍作为备用；个别站点防盗链不应让整条扫描失败。
      }
    }
    // 用户手动指定过封面时，自动扫描不得覆盖它，只更新非封面字段。
    let keepUserCover = resource.coverOrigin === "user";
    if (!keepUserCover && thumbnailDataUrl) {
      const visualStored = await putCoverVisual({
        resource,
        dataUrl: thumbnailDataUrl,
        width: 0,
        height: 0,
        origin: "auto",
        source: coverSource,
        updatedAt: now()
      });
      if (!visualStored) {
        keepUserCover = true;
        thumbnailDataUrl = resource.thumbnailDataUrl || "";
      }
    }
    scannedResource = {
      ...scannedResource,
      imageUrl: keepUserCover ? resource.imageUrl : representativeImageUrl,
      faviconUrl: essence.faviconUrl || resource.faviconUrl,
      ...(keepUserCover
        ? {
            coverSource: resource.coverSource,
            coverUpdatedAt: resource.coverUpdatedAt,
            coverOrigin: "user" as const,
            ...(resource.thumbnailDataUrl
              ? { thumbnailDataUrl: resource.thumbnailDataUrl }
              : {})
          }
        : {
            coverSource,
            coverUpdatedAt: now(),
            coverOrigin: "auto" as const,
            ...(thumbnailDataUrl ? { thumbnailDataUrl } : {})
          })
    };
    await upsertLocalResource(scannedResource);

    const stoppedBeforeAi = await stopIfProtectedNow();
    if (stoppedBeforeAi) return stoppedBeforeAi;

    const enrichment = needsAi
      ? await import("../../lib/local-ai").then(({ enrichResourceFromEssenceWithUsage }) =>
          enrichResourceFromEssenceWithUsage(scannedResource, essence, {
          // 增量补齐：只写入缺失字段，用户手改过的摘要和已有结果不被覆盖。
          keepExisting: !job.force
          })
        )
      : null;
    const enriched = enrichment?.resource || scannedResource;
    const auth = await getAuthState();
    const nextResource: ResourceRecord = {
      ...enriched,
      categoryCoverId: categoryCoverForResource(enriched),
      syncStatus:
        auth.signedIn && auth.accountMatches === true
          ? "pending"
          : enriched.syncStatus
    };
    await upsertLocalResource(nextResource);
    if (auth.signedIn && auth.accountMatches === true) {
      await enqueueOutbox(nextResource, nextResource.contentExcerpt);
      void syncPendingIfReady();
    }
    return {
      resource: nextResource,
      outcome: "succeeded",
      ...(enrichment ? { usage: enrichment.usage } : {})
    };
  } catch (error) {
    await upsertLocalResource({
      ...scannedResource,
      aiStatus: needsAi ? "failed" : scannedResource.aiStatus,
      updatedAt: now()
    });
    return {
      resource,
      outcome: "failed",
      message: errorMessage(error)
    };
  }
}

async function recordScanBatchResults(
  results: ScanResourceResult[]
): Promise<StoredLibraryScanJob> {
  const job = await getStoredLibraryScan();
  const timestamp = now();
  const usage = results.reduce<AiTokenUsage>(
    (total, result) => ({
      inputTokens: total.inputTokens + (result.usage?.inputTokens || 0),
      outputTokens: total.outputTokens + (result.usage?.outputTokens || 0),
      cachedInputTokens:
        total.cachedInputTokens +
        (result.usage?.cachedInputTokens || 0),
      estimated: total.estimated || Boolean(result.usage?.estimated)
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      estimated: false
    }
  );
  const batchCost =
    job.provider && job.model
      ? costCnyForUsage(job.provider, job.model, usage) || 0
      : 0;
  const nextIndex = Math.min(
    job.resourceKeys.length,
    job.nextIndex + results.length
  );
  const next: StoredLibraryScanJob = {
    ...job,
    nextIndex,
    processed: job.processed + results.length,
    succeeded:
      job.succeeded +
      results.filter((result) => result.outcome === "succeeded").length,
    failed:
      job.failed +
      results.filter((result) => result.outcome === "failed").length,
    skipped:
      job.skipped +
      results.filter((result) => result.outcome === "skipped").length,
    actualInputTokens: (job.actualInputTokens || 0) + usage.inputTokens,
    actualOutputTokens:
      (job.actualOutputTokens || 0) + usage.outputTokens,
    actualCachedInputTokens:
      (job.actualCachedInputTokens || 0) + usage.cachedInputTokens,
    actualCostCny: Number(
      ((job.actualCostCny || 0) + batchCost).toFixed(4)
    ),
    actualUsageEstimated:
      job.actualUsageEstimated || usage.estimated,
    currentTitle: "",
    updatedAt: timestamp,
    errors: [
      ...job.errors,
      ...results.flatMap((result) =>
        result.message && result.outcome !== "succeeded"
          ? [
              {
                resourceKey: result.resource.resourceKey,
                title: result.resource.title,
                message: result.message
              }
            ]
          : []
      )
    ].slice(-20)
  };
  if (nextIndex >= next.resourceKeys.length && next.state !== "cancelled") {
    next.state = "completed";
    next.completedAt = timestamp;
  }
  await setStoredLibraryScan(next);
  return next;
}

async function finalizeLibraryScanUsage(
  job: StoredLibraryScanJob
): Promise<StoredLibraryScanJob> {
  const totalTokens =
    (job.actualInputTokens || 0) + (job.actualOutputTokens || 0);
  if (
    job.usageRecorded ||
    !job.provider ||
    !job.model ||
    totalTokens === 0
  ) {
    return job;
  }
  await addScanAiUsage(job.provider, job.model, {
    inputTokens: job.actualInputTokens || 0,
    outputTokens: job.actualOutputTokens || 0,
    cachedInputTokens: job.actualCachedInputTokens || 0,
    estimated: Boolean(job.actualUsageEstimated)
  });
  const next = { ...job, usageRecorded: true, updatedAt: now() };
  await setStoredLibraryScan(next);
  return next;
}

async function runLibraryScan(): Promise<void> {
  if (libraryScanRunning) return;
  libraryScanRunning = true;
  try {
    while (true) {
      let job = await getStoredLibraryScan();
      if (job.state !== "running") break;
      if (job.nextIndex >= job.resourceKeys.length) {
        job = {
          ...job,
          state: "completed",
          currentTitle: "",
          completedAt: now(),
          updatedAt: now()
        };
        await setStoredLibraryScan(job);
        await finalizeLibraryScanUsage(job).catch(() => job);
        await ensureStoredOrganizationInsights(true).catch(
          () => undefined
        );
        break;
      }

      const keys = job.resourceKeys.slice(
        job.nextIndex,
        job.nextIndex + LIBRARY_SCAN_CONCURRENCY
      );
      const resources = await Promise.all(
        keys.map((resourceKey) => getLocalResource(resourceKey))
      );
      job = {
        ...job,
        currentTitle:
          keys.length === 1
            ? resources[0]?.title || "检查书签"
            : `并行处理 ${keys.length} 条收藏`,
        updatedAt: now()
      };
      await setStoredLibraryScan(job);
      const privacyContext = await getPrivacyProtectionContext();
      const results = await runConcurrentTasks<
        string,
        ScanResourceResult
      >(
        keys,
        async (resourceKey, index): Promise<ScanResourceResult> => {
          const resource = resources[index];
          if (!resource || !resource.nativeBookmarkIds.length) {
            return {
              resource: removedResourcePlaceholder(resourceKey),
              outcome: "skipped",
              message: "书签已被移除。"
            };
          }
          return libraryScanRateLimiter.run(resource.url, () =>
            scanOneLibraryResource(resource, job, privacyContext)
          );
        },
        {
          concurrency: LIBRARY_SCAN_CONCURRENCY,
          onError: (error, resourceKey, index) => ({
            resource:
              resources[index] ||
              removedResourcePlaceholder(resourceKey),
            outcome: "failed",
            message: errorMessage(error)
          })
        }
      );
      job = await recordScanBatchResults(results);
      const providerBlocked =
        results.length > 0 &&
        results.every(
          (result) =>
            result.outcome === "failed" &&
            /(API Key|额度不足|配额已用完|请求过于频繁)/.test(
              result.message || ""
            )
        );
      if (providerBlocked) {
        job = {
          ...job,
          state: "failed",
          currentTitle: "",
          updatedAt: now()
        };
        await setStoredLibraryScan(job);
        break;
      }
      if (job.state === "completed") {
        await finalizeLibraryScanUsage(job).catch(() => job);
        await ensureStoredOrganizationInsights(true).catch(
          () => undefined
        );
        break;
      }
    }
  } catch (error) {
    const job = await getStoredLibraryScan();
    await setStoredLibraryScan({
      ...job,
      state: "failed",
      currentTitle: "",
      updatedAt: now(),
      errors: [
        ...job.errors,
        {
          resourceKey: "",
          title: "扫描任务",
          message: errorMessage(error)
        }
      ].slice(-20)
    });
  } finally {
    libraryScanRunning = false;
    const job = await getStoredLibraryScan();
    if (job.state !== "running") {
      await chrome.alarms.clear(LIBRARY_SCAN_ALARM);
    }
  }
}

  return {
    getStoredLibraryScan,
    publicLibraryScan,
    startLibraryScan,
    updateLibraryScanState,
    runLibraryScan
  };
}
