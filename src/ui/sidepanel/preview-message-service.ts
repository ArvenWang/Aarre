import type { PreviewRequest } from "./preview-request";
import type { AiProviderId } from "../../lib/types";
import { PREVIEW_UNHANDLED } from "./preview-request";
import {
  PREVIEW_AI_SETTINGS_KEY, emitPreviewRuntimeMessage, findPreviewNode,
  previewAgentCatalog, previewAgentRuns, previewCapture, previewFolderOptions,
  previewMutable, previewProtectedFolderIds, previewProtectedResourceKeys,
  previewProtectionState, previewResources, previewRoot, previewSiteBrands,
  previewSnapshot, previewState, previewSuggestions,
} from "./preview-state";
import { askBookmarkAgent } from "../../lib/local-ai";
import { validateAiApiKey } from "../../lib/settings";
import { executePreviewAgentAction } from "./preview-actions";

export async function handlePreviewServiceMessage(request: PreviewRequest, previewStorage: Record<string, unknown>) {
  switch (request.type) {
          case "GET_SITE_BRANDS":
            return {
              ok: true,
              data: structuredClone(previewSiteBrands)
            };
          case "GET_PAGE_SNAPSHOT":
            return { ok: true, data: null };
          case "GET_AGENT_CONVERSATIONS":
            return { ok: true, data: structuredClone(previewMutable.conversations) };
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
            previewMutable.conversations = [
              request.conversation,
              ...previewMutable.conversations.filter(
                (item) => item.id !== request.conversation?.id
              )
            ];
            return {
              ok: true,
              data: structuredClone(request.conversation)
            };
          case "DELETE_AGENT_CONVERSATION":
            previewMutable.conversations = previewMutable.conversations.filter(
              (item) => item.id !== request.id
            );
            return { ok: true, data: { deleted: true } };
          case "GET_AI_SETTINGS":
            return { ok: true, data: previewMutable.aiSettings };
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
              previewMutable.aiSettings.providerModels[provider];
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
            previewMutable.aiSettings = {
              ...previewMutable.aiSettings,
              provider,
              providerName,
              model,
              apiKeyConfigured: true,
              apiKeySuffix: apiKey.slice(-4),
              configuredProviders: [
                ...new Set([
                  ...previewMutable.aiSettings.configuredProviders,
                  provider
                ])
              ],
              providerModels: {
                ...previewMutable.aiSettings.providerModels,
                [provider]: model
              },
              usingBuiltInService: false
            };
            return { ok: true, data: previewMutable.aiSettings };
          }
          case "GET_PENDING_SAVE":
            return { ok: true, data: null };
          case "GET_FOLDERS":
            return { ok: true, data: previewFolderOptions() };
          case "GET_BOOKMARK_SAVE_STATE":
            // 预览里当前页面视为尚未收藏，让“添加到收藏”弹窗走新建流程。
            return { ok: true, data: { status: "none", matches: [] } };
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
                  },
                  onThinking(steps) {
                    emitPreviewRuntimeMessage({
                      type: "BOOKMARK_AGENT_THINKING",
                      requestId,
                      steps
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
    default: return PREVIEW_UNHANDLED;
  }
}
