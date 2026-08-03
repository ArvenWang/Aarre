import type { PreviewRequest } from "./preview-request";
import { PREVIEW_UNHANDLED } from "./preview-request";
import {
  PREVIEW_AI_SETTINGS_KEY, emitPreviewRuntimeMessage, findPreviewNode,
  previewAgentCatalog, previewAgentRuns, previewCapture, previewFolderOptions,
  previewMutable, previewProtectedFolderIds, previewProtectedResourceKeys,
  previewProtectionState, previewResources, previewRoot, previewSiteBrands,
  previewSnapshot, previewState, previewSuggestions,
} from "./preview-state";
import type { NativeBookmarkNode } from "../../lib/types";
import { canonicalizeUrl } from "../../lib/url";
import { movePreviewNode, removePreviewNode } from "./preview-state";

export async function handlePreviewMutationMessage(request: PreviewRequest, previewStorage: Record<string, unknown>) {
  switch (request.type) {
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
    default: return PREVIEW_UNHANDLED;
  }
}
