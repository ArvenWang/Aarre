import type { ExtensionRequest } from "../../lib/messages";
import {
  getAiSettingsStatus,
  saveAiSettings
} from "../../lib/settings";

export type ExtensionHandler = (
  request: ExtensionRequest,
  sender?: chrome.runtime.MessageSender
) => Promise<unknown>;

type SaveAiSettingsRequest = Extract<
  ExtensionRequest,
  { type: "SAVE_AI_SETTINGS" }
>;
type GetProtectionRequest = Extract<
  ExtensionRequest,
  { type: "GET_ITEM_PROTECTION" }
>;
type SetProtectionRequest = Extract<
  ExtensionRequest,
  { type: "SET_ITEM_PROTECTION" }
>;

interface SettingsHandlerDependencies {
  activeTab(): Promise<chrome.tabs.Tab | null>;
  coordinateActivePage(tab: chrome.tabs.Tab): Promise<unknown>;
  getItemProtectionState(
    target: GetProtectionRequest["target"]
  ): Promise<unknown>;
  setItemProtection(
    target: SetProtectionRequest["target"],
    enabled: boolean
  ): Promise<unknown>;
}

export function createSettingsHandlers(
  dependencies: SettingsHandlerDependencies
): Partial<Record<ExtensionRequest["type"], ExtensionHandler>> {
  return {
    GET_AI_SETTINGS: async () => getAiSettingsStatus(),
    SAVE_AI_SETTINGS: async (request) => {
      if (request.type !== "SAVE_AI_SETTINGS") {
        throw new Error("设置消息类型不匹配。");
      }
      const status = await saveAiSettings(
        (request as SaveAiSettingsRequest).payload
      );
      // Key 就绪后只处理用户当前正在看的真实页面。其他 waiting_for_content
      // 任务继续等首次访问，不能因为有 Key 就在后台全库制造空转与退避。
      const current = await dependencies.activeTab();
      if (current?.status === "complete") {
        await dependencies.coordinateActivePage(current);
      }
      return status;
    },
    GET_ITEM_PROTECTION: async (request) => {
      if (request.type !== "GET_ITEM_PROTECTION") {
        throw new Error("保护状态消息类型不匹配。");
      }
      return dependencies.getItemProtectionState(request.target);
    },
    SET_ITEM_PROTECTION: async (request) => {
      if (request.type !== "SET_ITEM_PROTECTION") {
        throw new Error("保护设置消息类型不匹配。");
      }
      return dependencies.setItemProtection(
        request.target,
        request.protected
      );
    }
  };
}
