import {
  bookmarkPageMenuPresentation,
  bookmarkSnapshotMenuPresentation
} from "../../lib/bookmark-save-state";
import { syncCloudAssets } from "../../lib/cloud-assets";
import { blobToDataUrl } from "../../lib/image-cover";
import {
  isLoadedSnapshotTab,
  isSnapshotSensitiveUrl
} from "../../lib/page-snapshot";
import { putCoverSnapshot } from "../../lib/visuals";
import type {
  BookmarkSaveState,
  PendingSaveDraft,
  ResourceRecord
} from "../../lib/types";
import { hashText, isSupportedPageUrl } from "../../lib/url";
import {
  CONTEXT_MENU_IMAGE_COVER_ID,
  CONTEXT_MENU_LINK_ID,
  CONTEXT_MENU_PAGE_ID,
  CONTEXT_MENU_UPDATE_SNAPSHOT_ID,
  pendingSaveKey
} from "./context-menu-core";

interface ContextMenuProtectionContext {
  pageSnapshotsEnabled: boolean;
  excludedHosts: string[];
}

interface ContextMenuLifecycleDependencies<
  TProtectionContext extends ContextMenuProtectionContext
> {
  activeTab(): Promise<chrome.tabs.Tab | null>;
  getBookmarkSaveState(url: string): Promise<BookmarkSaveState>;
  getPrivacyProtectionContext(): Promise<TProtectionContext>;
  bookmarkedResourceForLoadedUrl(
    url: string
  ): Promise<ResourceRecord | undefined>;
  resourceProtectionState(
    resource: Pick<
      ResourceRecord,
      "resourceKey" | "nativeBookmarkIds" | "url"
    >,
    context: TProtectionContext,
    loadedUrl?: string
  ): { protected: boolean; userProtected: boolean };
  buildPendingSaveDraft(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ): PendingSaveDraft;
  rememberPendingSaveDraft(draft: PendingSaveDraft): void;
  flashActionBadge(
    tabId: number | undefined,
    text: string,
    color: string,
    title: string,
    durationMs?: number
  ): void;
  errorMessage(error: unknown): string;
  importNativeBookmarks(): Promise<unknown>;
  prepareManualSnapshotTarget(tabId: number): Promise<void>;
  scheduleManualSnapshot(
    tab: chrome.tabs.Tab,
    resource: ResourceRecord
  ): Promise<boolean>;
  markNativeBookmarksDirty(): void;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
}

export interface ContextMenuLifecycle {
  register(): Promise<void>;
  refresh(knownTab?: chrome.tabs.Tab): Promise<void>;
  handleSave(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ): Promise<void>;
  handleUpdateSnapshot(tab?: chrome.tabs.Tab): Promise<void>;
  handleImageCover(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ): Promise<void>;
}

export function createContextMenuLifecycle<
  TProtectionContext extends ContextMenuProtectionContext
>(
  dependencies: ContextMenuLifecycleDependencies<TProtectionContext>
): ContextMenuLifecycle {
  let pageContextMenuRevision = 0;

  async function update(
    state: BookmarkSaveState | null,
    snapshotAvailable = false
  ): Promise<void> {
    await Promise.all([
      chrome.contextMenus.update(
        CONTEXT_MENU_PAGE_ID,
        bookmarkPageMenuPresentation(state)
      ),
      chrome.contextMenus.update(
        CONTEXT_MENU_UPDATE_SNAPSHOT_ID,
        bookmarkSnapshotMenuPresentation(state, snapshotAvailable)
      )
    ]).catch(() => undefined);
  }

  async function refresh(knownTab?: chrome.tabs.Tab): Promise<void> {
    const revision = ++pageContextMenuRevision;
    const tab = knownTab || (await dependencies.activeTab());
    if (!tab?.url || !isSupportedPageUrl(tab.url)) {
      if (revision !== pageContextMenuRevision) return;
      await update(null);
      return;
    }
    try {
      const state = await dependencies.getBookmarkSaveState(tab.url);
      const [context, resource] = await Promise.all([
        dependencies.getPrivacyProtectionContext(),
        dependencies.bookmarkedResourceForLoadedUrl(tab.url)
      ]);
      const snapshotAvailable = Boolean(
        !tab.incognito &&
          context.pageSnapshotsEnabled &&
          (resource
            ? !dependencies.resourceProtectionState(
                resource,
                context,
                tab.url
              ).protected
            : !isSnapshotSensitiveUrl(tab.url, context.excludedHosts))
      );
      if (revision !== pageContextMenuRevision) return;
      await update(state, snapshotAvailable);
    } catch {
      if (revision !== pageContextMenuRevision) return;
      await update(null);
    }
  }

  async function register(): Promise<void> {
    await chrome.contextMenus.removeAll().catch((error) => {
      console.error("清除右键菜单失败", error);
    });
    try {
      await Promise.all([
        chrome.contextMenus.create({
          id: CONTEXT_MENU_PAGE_ID,
          title: "添加到收藏…",
          contexts: ["page", "selection"]
        }),
        chrome.contextMenus.create({
          id: CONTEXT_MENU_LINK_ID,
          title: "添加或管理此链接…",
          contexts: ["link"]
        }),
        chrome.contextMenus.create({
          id: CONTEXT_MENU_UPDATE_SNAPSHOT_ID,
          title: "更新封面",
          contexts: ["page"],
          enabled: false,
          visible: false
        }),
        chrome.contextMenus.create({
          id: CONTEXT_MENU_IMAGE_COVER_ID,
          title: "用此图片设为封面",
          contexts: ["image"]
        })
      ]);
      await refresh();
    } catch (error) {
      console.error("右键菜单注册失败", error);
    }
  }

  async function handleSave(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ): Promise<void> {
    if (
      info.menuItemId !== CONTEXT_MENU_PAGE_ID &&
      info.menuItemId !== CONTEXT_MENU_LINK_ID
    ) {
      return;
    }
    try {
      const draft = dependencies.buildPendingSaveDraft(info, tab);
      dependencies.rememberPendingSaveDraft(draft);
      // 必须在右键用户手势仍有效时立即调用 sidePanel.open；持久化与打开
      // 同步发起，随后等草稿落盘后再通知已存在的侧边栏实例。
      const storeDraft = chrome.storage.session.set({
        [pendingSaveKey(draft.tabId)]: draft
      });
      const openPanel = chrome.sidePanel.open({ tabId: draft.tabId });
      await storeDraft;
      await openPanel.catch((error) => {
        dependencies.flashActionBadge(
          tab?.id,
          "!",
          "#a33b34",
          dependencies.errorMessage(error)
        );
      });
      await chrome.runtime
        .sendMessage({
          type: "PENDING_SAVE_READY",
          tabId: draft.tabId
        })
        .catch(() => undefined);
    } catch (error) {
      dependencies.flashActionBadge(
        tab?.id,
        "!",
        "#a33b34",
        dependencies.errorMessage(error)
      );
    }
  }

  async function handleUpdateSnapshot(tab?: chrome.tabs.Tab): Promise<void> {
    if (
      typeof tab?.id !== "number" ||
      !tab.url ||
      !isLoadedSnapshotTab(tab)
    ) {
      throw new Error("当前页面还没有加载完成，暂时无法更新封面。");
    }

    const bookmarkState = await dependencies.getBookmarkSaveState(tab.url);
    if (bookmarkState.status === "none") {
      throw new Error("当前页面尚未收藏，无法更新封面。");
    }

    let resource = await dependencies.bookmarkedResourceForLoadedUrl(tab.url);
    if (!resource?.nativeBookmarkIds.length) {
      // 右键菜单状态和本地索引可能在 Chrome 刚完成收藏时存在极短的
      // 时间差。这里补一次原生书签导入，避免用户需要重新打开页面。
      await dependencies.importNativeBookmarks();
      resource = await dependencies.bookmarkedResourceForLoadedUrl(tab.url);
    }
    if (!resource?.nativeBookmarkIds.length) {
      throw new Error("收藏信息还没有同步完成，请稍后再试。");
    }

    const context = await dependencies.getPrivacyProtectionContext();
    if (
      !context.pageSnapshotsEnabled ||
      dependencies.resourceProtectionState(resource, context, tab.url).protected
    ) {
      throw new Error("此页面受隐私保护规则限制，不能生成封面截图。");
    }

    await dependencies.prepareManualSnapshotTarget(tab.id);
    dependencies.flashActionBadge(
      tab.id,
      "…",
      "#205aef",
      "正在更新封面…"
    );
    if (!(await dependencies.scheduleManualSnapshot(tab, resource))) {
      throw new Error("当前页面未能稳定完成截图，请保持页面打开后重试。");
    }
    dependencies.flashActionBadge(tab.id, "✓", "#2c7a52", "封面已更新");
  }

  async function handleImageCover(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ): Promise<void> {
    const probe = (stage: string, extra?: unknown) => {
      void chrome.storage.local
        .set({
          "aarre:image-cover-debug": {
            stage,
            time: new Date().toISOString(),
            ...(extra !== undefined
              ? { extra: String(extra).slice(0, 300) }
              : {})
          }
        })
        .catch(() => undefined);
    };
    probe("entered");
    const srcUrl = info.srcUrl;
    if (!srcUrl || !/^https?:/i.test(srcUrl)) {
      throw new Error("这张图片不是可访问的网页图片，无法设为封面。");
    }
    if (typeof tab?.id !== "number" || !tab.url) {
      throw new Error("无法确认当前标签页。");
    }

    const bookmarkState = await dependencies.getBookmarkSaveState(tab.url);
    probe("bookmark-state", bookmarkState.status);
    let autoBookmarked = false;
    let appliedToExistingSite = false;
    let resource: ResourceRecord | undefined;
    if (bookmarkState.status === "none") {
      // 当前页面 URL 与已收藏 URL 不一致（参数/路径变体）时会被判为
      // “未收藏”。先看同主机是否已有收藏：有则直接应用到现有收藏，
      // 避免自动收藏在根目录产生重复书签。
      const sameHostBookmark = await findExistingBookmarkForHost(tab.url);
      if (sameHostBookmark) {
        appliedToExistingSite = true;
        const existingResource =
          await dependencies.bookmarkedResourceForLoadedUrl(
            sameHostBookmark.url
          );
        if (existingResource?.nativeBookmarkIds.length) {
          resource = existingResource;
        }
      }
      if (!resource) {
        // 该网站完全没有任何收藏：自动收藏到书签栏，避免“未收藏就
        // 拒绝”让用户以为功能失效。
        const [bar] = await chrome.bookmarks.get("1").catch(() => []);
        if (!bar || bar.url || bar.unmodifiable === "managed") {
          throw new Error("书签栏不可写入，无法自动收藏当前页面。");
        }
        dependencies.markNativeBookmarksDirty();
        await chrome.bookmarks.create({
          parentId: bar.id,
          title: tab.title || tab.url,
          url: tab.url
        });
        autoBookmarked = true;
        await dependencies.importNativeBookmarks();
        probe("auto-bookmarked");
      }
    }
    resource =
      resource ||
      (await dependencies.bookmarkedResourceForLoadedUrl(tab.url));
    if (!resource?.nativeBookmarkIds.length) {
      // 本地索引可能在 Chrome 刚完成收藏时存在极短的时间差。
      await dependencies.importNativeBookmarks();
      resource = await dependencies.bookmarkedResourceForLoadedUrl(tab.url);
    }
    if (!resource?.nativeBookmarkIds.length) {
      throw new Error("收藏信息还没有同步完成，请稍后再试。");
    }
    probe("resource-found", resource.resourceKey.slice(0, 12));

    const context = await dependencies.getPrivacyProtectionContext();
    if (
      !context.pageSnapshotsEnabled ||
      dependencies.resourceProtectionState(resource, context, tab.url).protected
    ) {
      throw new Error("此页面受隐私保护规则限制，不能修改封面。");
    }
    probe("privacy-ok");

    dependencies.flashActionBadge(
      tab.id,
      "…",
      "#205aef",
      "正在下载图片…",
      60_000
    );
    const response = await fetch(srcUrl, {
      credentials: "omit",
      // 部分图片服务会校验来源页（防盗链），带上当前页面地址提高成功率。
      referrer: tab.url,
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      throw new Error(`图片下载失败（${response.status}）。`);
    }
    probe(
      "fetched",
      `${response.status} ${(response.headers.get("content-type") || "").slice(0, 40)}`
    );
    const blob = await response.blob();
    if (blob.size > 15 * 1024 * 1024) {
      throw new Error("图片超过 15 MB，无法作为封面。");
    }
    dependencies.flashActionBadge(
      tab.id,
      "…",
      "#205aef",
      "正在处理图片…",
      60_000
    );
    probe("blob-ready", `${blob.type} ${blob.size}`);

    // GIF 保留原始动图（不转码、不缩放），封面以动画形式展示；
    // 其余格式统一缩放到最长边 1600px 并转 WebP。
    if (blob.type.toLowerCase() === "image/gif") {
      const gifDataUrl = await blobToDataUrl(blob);
      probe("gif-converted");
      let gifWidth = 1;
      let gifHeight = 1;
      try {
        const gifBitmap = await createImageBitmap(blob);
        gifWidth = gifBitmap.width;
        gifHeight = gifBitmap.height;
        gifBitmap.close();
      } catch {
        // 尺寸解码失败时用占位尺寸，不影响封面显示。
      }
      await dependencies.upsertLocalResource({
        ...resource,
        thumbnailDataUrl: gifDataUrl,
        coverUpdatedAt: new Date().toISOString(),
        coverOrigin: "user",
        coverContentHash: await hashText(gifDataUrl)
      });
      // 网页端卡片封面以页面快照为数据源，必须同步写入，
      // 否则网页端永远显示旧快照/兜底图。
      const gifSnapshotAt = new Date().toISOString();
      await putCoverSnapshot(resource, {
        canonicalUrl: resource.canonicalUrl,
        imageDataUrl: gifDataUrl,
        capturedAt: gifSnapshotAt,
        width: gifWidth,
        height: gifHeight
      }, "user", {
        source: "user-image",
        contentHash: await hashText(gifDataUrl)
      });
      void chrome.runtime
        .sendMessage({
          type: "PAGE_SNAPSHOT_UPDATED",
          canonicalUrl: resource.canonicalUrl,
          capturedAt: gifSnapshotAt
        })
        .catch(() => undefined);
      dependencies.flashActionBadge(
        tab.id,
        "✓",
        "#2c7a52",
        autoBookmarked
          ? "已收藏并设为封面"
          : appliedToExistingSite
            ? "已应用到该网站现有收藏"
            : "封面已更新",
        6_000
      );
      void showCoverToastAndUpload(
        tab.id,
        autoBookmarked,
        appliedToExistingSite
      );
      return;
    }

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new Error("无法解析这张图片，请换一张试试。");
    }
    probe("bitmap-ready", `${bitmap.width}x${bitmap.height}`);
    try {
      // 统一缩放到最长边 1600px，避免原图过大挤占本地与云端容量。
      const maxEdge = 1600;
      const scale = Math.min(
        1,
        maxEdge / Math.max(bitmap.width, bitmap.height)
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("当前环境无法处理图片。");
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      const out = await canvas.convertToBlob({
        type: "image/webp",
        quality: 0.88
      });
      probe("canvas-converted", `${out.type} ${out.size}`);
      const dataUrl = await blobToDataUrl(out);
      await dependencies.upsertLocalResource({
        ...resource,
        thumbnailDataUrl: dataUrl,
        coverUpdatedAt: new Date().toISOString(),
        coverOrigin: "user",
        coverContentHash: await hashText(dataUrl)
      });
      const snapshotAt = new Date().toISOString();
      await putCoverSnapshot(resource, {
        canonicalUrl: resource.canonicalUrl,
        imageDataUrl: dataUrl,
        capturedAt: snapshotAt,
        width,
        height
      }, "user", {
        source: "user-image",
        contentHash: await hashText(dataUrl)
      });
      void chrome.runtime
        .sendMessage({
          type: "PAGE_SNAPSHOT_UPDATED",
          canonicalUrl: resource.canonicalUrl,
          capturedAt: snapshotAt
        })
        .catch(() => undefined);
      probe("saved");
      dependencies.flashActionBadge(
        tab.id,
        "✓",
        "#2c7a52",
        autoBookmarked
          ? "已收藏并设为封面"
          : appliedToExistingSite
            ? "已应用到该网站现有收藏"
            : "封面已更新",
        6_000
      );
      void showCoverToastAndUpload(
        tab.id,
        autoBookmarked,
        appliedToExistingSite
      );
    } finally {
      bitmap.close();
    }
  }

  /** 在当前页面未命中收藏时，查找同一主机下已存在的书签（URL 变体，
   * 如登录页/参数差异），避免自动收藏产生重复。 */
  async function findExistingBookmarkForHost(
    pageUrl: string
  ): Promise<{ url: string } | null> {
    let pageHost = "";
    try {
      pageHost = new URL(pageUrl).hostname
        .toLocaleLowerCase()
        .replace(/^www\./, "");
    } catch {
      return null;
    }
    const tree = await chrome.bookmarks.getTree();
    const matches: Array<{ url: string; dateAdded: number }> = [];
    const visit = (node: chrome.bookmarks.BookmarkTreeNode) => {
      if (node.url) {
        try {
          const host = new URL(node.url).hostname
            .toLocaleLowerCase()
            .replace(/^www\./, "");
          if (host === pageHost) {
            matches.push({
              url: node.url,
              dateAdded: node.dateAdded || 0
            });
          }
        } catch {
          // 忽略无法解析的旧书签。
        }
      }
      for (const child of node.children || []) visit(child);
    };
    for (const root of tree) visit(root);
    if (!matches.length) return null;
    // 多个同站书签时优先最近添加的（通常更接近当前浏览意图）。
    matches.sort((a, b) => b.dateAdded - a.dateAdded);
    return { url: matches[0].url };
  }

  async function showCoverToastAndUpload(
    tabId: number,
    autoBookmarked: boolean,
    appliedToExistingSite = false
  ): Promise<void> {
    const message = autoBookmarked
      ? "已收藏并设为封面"
      : appliedToExistingSite
        ? "已应用到该网站现有收藏"
        : "封面已更新";
    // 页面内 Toast：动态注入轻量提示，不常驻任何页面脚本。
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: (toastText: string) => {
          const id = "aarre-cover-toast";
          let el = document.getElementById(id) as HTMLDivElement | null;
          if (!el) {
            el = document.createElement("div");
            el.id = id;
            el.style.cssText =
              "position:fixed;left:50%;bottom:36px;transform:translateX(-50%);" +
              "z-index:2147483647;background:rgba(18,20,24,.92);color:#fff;" +
              "font:500 14px/1.4 -apple-system,BlinkMacSystemFont,'PingFang SC'," +
              "'Microsoft YaHei',sans-serif;padding:10px 16px;border-radius:10px;" +
              "box-shadow:0 6px 24px rgba(0,0,0,.24);pointer-events:none;" +
              "opacity:0;transition:opacity .25s ease;";
            document.documentElement.appendChild(el);
          }
          el.textContent = toastText;
          el.style.opacity = "1";
          clearTimeout((el as HTMLDivElement & { __t?: number }).__t);
          (el as HTMLDivElement & { __t?: number }).__t = window.setTimeout(
            () => {
              el!.style.opacity = "0";
            },
            2_600
          );
        },
        args: [message]
      })
      .catch(() => undefined);

    // 只上传图片资产（含刚设置的新封面）。不能调用全量同步：
    // 全量同步的“从云端恢复图片”阶段会把云端旧封面下载回来覆盖新封面。
    try {
      let assets = await syncCloudAssets();
      while (assets.remaining) assets = await syncCloudAssets();
    } catch {
      // 上传失败时下一次定时同步会补传，封面仍保留在本地。
    }
  }

  return {
    register,
    refresh,
    handleSave,
    handleUpdateSnapshot,
    handleImageCover
  };
}
