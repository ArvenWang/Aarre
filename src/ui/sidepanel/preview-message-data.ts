import type { PreviewRequest } from "./preview-request";
import { PREVIEW_UNHANDLED } from "./preview-request";
import {
  PREVIEW_AI_SETTINGS_KEY, emitPreviewRuntimeMessage, findPreviewNode,
  previewAgentCatalog, previewAgentRuns, previewCapture, previewFolderOptions,
  previewMutable, previewProtectedFolderIds, previewProtectedResourceKeys,
  previewProtectionState, previewResources, previewRoot, previewSiteBrands,
  previewSnapshot, previewState, previewSuggestions,
} from "./preview-state";

export async function handlePreviewDataMessage(request: PreviewRequest, previewStorage: Record<string, unknown>) {
  switch (request.type) {
          case "GET_BOOKMARK_BAR":
            return { ok: true, data: structuredClone(previewSnapshot) };
          case "GET_BOOTSTRAP":
            return {
              ok: true,
              data: {
                appState: structuredClone(previewState),
                aiSettings: structuredClone(previewMutable.aiSettings),
                displaySettings: {
                  listCoverStyle: "site",
                  pageSnapshotsEnabled: true,
                  snapshotExcludedHosts: [],
                  scanCostLimitCny: 10
                }
              }
            };
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
              data: previewMutable.organizationNoticeDismissed
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
            previewMutable.organizationNoticeDismissed = true;
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
    default: return PREVIEW_UNHANDLED;
  }
}
