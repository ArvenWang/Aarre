// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BookmarkBarSnapshot,
  ResourceRecord
} from "../src/lib/types";
import { LibraryCardEditor } from "../src/ui/manager/components/LibraryCardEditor";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const resource: ResourceRecord = {
  resourceKey: "shared",
  canonicalUrl: "https://example.com/shared",
  url: "https://example.com/shared",
  title: "Shared",
  userNote: "read later",
  summary: "AI summary",
  tags: ["design"],
  tagsSource: "user",
  topics: ["design"],
  contentExcerpt: "",
  contentHash: "",
  selectedText: "",
  author: "",
  siteName: "Example",
  language: "en",
  imageUrl: "",
  faviconUrl: "",
  nativeBookmarkIds: ["bookmark-a", "bookmark-b"],
  nativeFolderPath: [],
  aiStatus: "ready",
  syncStatus: "local",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const snapshot: BookmarkBarSnapshot = {
  root: { id: "bar", title: "书签栏" },
  roots: [
    {
      id: "bar",
      title: "书签栏",
      children: [
        {
          id: "folder-a",
          parentId: "bar",
          title: "设计",
          children: [
            {
              id: "bookmark-a",
              parentId: "folder-a",
              title: "First copy",
              url: resource.url
            }
          ]
        },
        {
          id: "folder-b",
          parentId: "bar",
          title: "稍后阅读",
          children: [
            {
              id: "bookmark-b",
              parentId: "folder-b",
              title: "Second copy",
              url: resource.url
            }
          ]
        }
      ]
    }
  ],
  primaryRootId: "bar",
  bookmarkCount: 2,
  folderCount: 2,
  syncing: true
};

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

function buttonWithText(container: ParentNode, text: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text
  ) as HTMLButtonElement | undefined;
}

function editorTrigger(container: ParentNode) {
  return container.querySelector(
    'button[aria-label^="编辑 "]'
  ) as HTMLButtonElement | null;
}

function setControlValue(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    control,
    value
  );
  control.dispatchEvent(
    new Event(control instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true
    })
  );
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("LibraryCardEditor", () => {
  it("saves edits only to the explicitly selected duplicate location", async () => {
    const sendMessage = vi.fn(async () => ({
      ok: true,
      data: { urlChanged: true }
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const onChanged = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <LibraryCardEditor
          resource={resource}
          bookmarkSnapshot={snapshot}
          onChanged={onChanged}
        />
      );
    });
    await act(async () => {
      editorTrigger(container)?.click();
    });
    expect(
      document.body.querySelector(".library-card-editor-backdrop")
        ?.parentElement
    ).toBe(document.body);

    const selects = document.body.querySelectorAll(
      ".library-card-editor-field select"
    );
    const locationSelect = selects[0] as HTMLSelectElement;
    const folderSelect = selects[1] as HTMLSelectElement;
    await act(async () => {
      setControlValue(locationSelect, "bookmark-b");
    });

    const nativeInputs = document.body.querySelectorAll(
      ".library-card-editor-grid input"
    );
    await act(async () => {
      setControlValue(
        nativeInputs[0] as HTMLInputElement,
        "Second copy revised"
      );
      setControlValue(
        nativeInputs[1] as HTMLInputElement,
        "https://new.example/page"
      );
      setControlValue(folderSelect, "folder-a");
    });
    await act(async () => {
      (document.body.querySelector("button[aria-label='添加标签']") as HTMLButtonElement)?.click();
    });
    await act(async () => {
      const tagInput = document.body.querySelector("input[aria-label='输入新标签']") as HTMLInputElement;
      setControlValue(tagInput, "research");
      tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      setControlValue(
        document.body.querySelector("textarea") as HTMLTextAreaElement,
        "updated note"
      );
    });
    await act(async () => {
      buttonWithText(document.body, "保存修改")?.click();
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: "UPDATE_BOOKMARK_DETAILS",
      payload: {
        bookmarkId: "bookmark-b",
        resourceKey: "shared",
        title: "Second copy revised",
        url: "https://new.example/page",
        parentId: "folder-a",
        tags: ["design", "research"],
        tagsChanged: true,
        userNote: "updated note"
      }
    });
    expect(onChanged).toHaveBeenCalledWith(
      "收藏信息已更新；新网址将在下次打开时重新生成摘要和封面。",
      { resourceKey: resource.resourceKey, kind: "updated" },
    );
  });

  it("does not claim AI tags as user tags when only the note changes", async () => {
    const aiTaggedResource: ResourceRecord = {
      ...resource,
      tagsSource: "ai"
    };
    const sendMessage = vi.fn(async () => ({
      ok: true,
      data: { urlChanged: false }
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <LibraryCardEditor
          resource={aiTaggedResource}
          bookmarkSnapshot={snapshot}
          onChanged={() => undefined}
        />
      );
    });
    await act(async () => {
      editorTrigger(container)?.click();
    });
    await act(async () => {
      setControlValue(
        document.body.querySelector("textarea") as HTMLTextAreaElement,
        "note only"
      );
    });
    await act(async () => {
      buttonWithText(document.body, "保存修改")?.click();
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: "UPDATE_BOOKMARK_DETAILS",
      payload: {
        bookmarkId: "bookmark-a",
        resourceKey: "shared",
        title: "First copy",
        url: "https://example.com/shared",
        parentId: "folder-a",
        tags: ["design"],
        tagsChanged: false,
        userNote: "note only"
      }
    });
  });

  it("deletes only the explicitly selected duplicate location", async () => {
    const sendMessage = vi.fn(async (request: { type: string }) => ({
      ok: true,
      data:
        request.type === "DELETE_NATIVE_BOOKMARK"
          ? { deleted: true }
          : {}
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const onChanged = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <LibraryCardEditor
          resource={resource}
          bookmarkSnapshot={snapshot}
          onChanged={onChanged}
        />
      );
    });
    await act(async () => {
      editorTrigger(container)?.click();
    });

    const locationSelect = document.body.querySelector(
      ".library-card-editor-field select"
    ) as HTMLSelectElement;
    await act(async () => {
      locationSelect.value = "bookmark-b";
      locationSelect.dispatchEvent(
        new Event("change", { bubbles: true })
      );
    });
    await act(async () => {
      buttonWithText(document.body, "删除")?.click();
    });
    expect(document.body.textContent).toContain(
      "只删除当前选中的收藏位置？"
    );
    expect(document.body.textContent).toContain(
      "其他位置与 Aarre 智能信息保留"
    );

    await act(async () => {
      buttonWithText(document.body, "确认删除")?.click();
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: "DELETE_NATIVE_BOOKMARK",
      payload: { id: "bookmark-b", recursive: false }
    });
    expect(onChanged).toHaveBeenCalledWith(
      "已删除所选收藏位置，其余位置仍然保留。",
      { resourceKey: resource.resourceKey, kind: "location-removed" },
    );
  });

  it("uses Escape to cancel confirmation before closing the dialog", async () => {
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn() }
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <LibraryCardEditor
          resource={resource}
          bookmarkSnapshot={snapshot}
          onChanged={() => undefined}
        />
      );
    });
    await act(async () => {
      editorTrigger(container)?.click();
    });
    await act(async () => {
      buttonWithText(document.body, "删除")?.click();
    });
    const dialog = document.body.querySelector(
      '[role="dialog"]'
    ) as HTMLElement;
    await act(async () => {
      dialog.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true
        })
      );
    });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(buttonWithText(document.body, "确认删除")).toBeUndefined();

    await act(async () => {
      dialog.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true
        })
      );
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps managed Chrome fields read-only while saving Aarre tags and notes", async () => {
    const managedResource: ResourceRecord = {
      ...resource,
      resourceKey: "managed-resource",
      canonicalUrl: "https://managed.example/policy",
      url: "https://managed.example/policy",
      title: "Managed resource",
      nativeBookmarkIds: ["bookmark-managed"]
    };
    const managedSnapshot: BookmarkBarSnapshot = {
      root: {
        id: "managed-root",
        title: "组织收藏",
        unmodifiable: true
      },
      roots: [
        {
          id: "managed-root",
          title: "组织收藏",
          unmodifiable: true,
          children: [
            {
              id: "bookmark-managed",
              parentId: "managed-root",
              title: "Managed copy",
              url: managedResource.url,
              unmodifiable: true
            }
          ]
        }
      ],
      primaryRootId: "managed-root",
      bookmarkCount: 1,
      folderCount: 0,
      syncing: true
    };
    const sendMessage = vi.fn(async () => ({
      ok: true,
      data: { urlChanged: false }
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <LibraryCardEditor
          resource={managedResource}
          bookmarkSnapshot={managedSnapshot}
          onChanged={() => undefined}
        />
      );
    });
    await act(async () => {
      editorTrigger(container)?.click();
    });

    const nativeInputs = document.body.querySelectorAll(
      ".library-card-editor-grid input"
    );
    const folderSelect = document.body.querySelector(
      ".library-card-editor-grid select"
    ) as HTMLSelectElement;
    const deleteButton = buttonWithText(document.body, "删除")!;
    const addTagButton = document.body.querySelector(
      "button[aria-label='添加标签']"
    ) as HTMLButtonElement;
    const note = document.body.querySelector("textarea") as HTMLTextAreaElement;
    const saveButton = buttonWithText(document.body, "保存修改")!;

    expect(document.body.textContent).toContain(
      "名称、网址、文件夹和删除操作不可用"
    );
    expect(
      [...nativeInputs].every(
        (input) => (input as HTMLInputElement).disabled
      )
    ).toBe(true);
    expect(folderSelect.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);
    expect(addTagButton.disabled).toBe(false);
    expect(note.disabled).toBe(false);
    expect(saveButton.disabled).toBe(false);

    await act(async () => {
      addTagButton.click();
    });
    await act(async () => {
      const tagInput = document.body.querySelector("input[aria-label='输入新标签']") as HTMLInputElement;
      setControlValue(tagInput, "policy");
      tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      setControlValue(note, "managed bookmark note");
    });
    await act(async () => {
      saveButton.click();
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: "UPDATE_BOOKMARK_DETAILS",
      payload: {
        bookmarkId: "bookmark-managed",
        resourceKey: "managed-resource",
        title: "Managed copy",
        url: "https://managed.example/policy",
        parentId: "managed-root",
        tags: ["design", "policy"],
        tagsChanged: true,
        userNote: "managed bookmark note"
      }
    });
  });
});
