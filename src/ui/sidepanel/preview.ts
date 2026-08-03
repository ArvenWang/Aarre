import { previewEvent, previewRuntimeMessageEvent } from "./preview-state";
import { PREVIEW_UNHANDLED, type PreviewRequest } from "./preview-request";
import { handlePreviewDataMessage } from "./preview-message-data";
import { handlePreviewServiceMessage } from "./preview-message-service";
import { handlePreviewMutationMessage } from "./preview-message-mutations";

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
      async sendMessage(request: PreviewRequest) {
        for (const handler of [handlePreviewDataMessage, handlePreviewServiceMessage, handlePreviewMutationMessage]) {
          const result = await handler(request, previewStorage);
          if (result !== PREVIEW_UNHANDLED) return result;
        }
        return { ok: false, error: "设计预览不执行数据写入操作。" };
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
