import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROTECTION_SETTINGS_KEY,
  bookmarkProtectionState,
  buildProtectionPolicy,
  folderProtectionState,
  getProtectionSettings,
  isResourceUserProtected,
  setFolderProtection,
  setResourceProtection,
} from "../src/lib/protection";

let values: Record<string, unknown>;

beforeEach(() => {
  values = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values[key] }),
        set: async (next: Record<string, unknown>) => {
          Object.assign(values, next);
        },
      },
    },
  });
});

const tree = [
  {
    id: "root",
    children: [
      {
        id: "private-folder",
        children: [
          {
            id: "nested-folder",
            children: [
              { id: "private-page", url: "https://private.example/page" },
            ],
          },
        ],
      },
      { id: "public-page", url: "https://public.example/page" },
    ],
  },
];

describe("bookmark protection", () => {
  it("让受保护文件夹动态覆盖所有后代，而不是复制当前网址", () => {
    const policy = buildProtectionPolicy(tree, {
      resourceKeys: [],
      folderIds: ["private-folder"],
    });

    expect([...policy.protectedFolderIds]).toEqual([
      "private-folder",
      "nested-folder",
    ]);
    expect([...policy.protectedBookmarkIds]).toEqual(["private-page"]);
    expect(folderProtectionState("private-folder", policy)).toEqual({
      protected: true,
      explicit: true,
      inherited: false,
    });
    expect(folderProtectionState("nested-folder", policy)).toEqual({
      protected: true,
      explicit: false,
      inherited: true,
    });
  });

  it("以资源身份保护网页，并与文件夹继承采用最严格规则", () => {
    const policy = buildProtectionPolicy(tree, {
      resourceKeys: ["resource-public"],
      folderIds: ["private-folder"],
    });

    expect(
      isResourceUserProtected(
        {
          resourceKey: "resource-public",
          nativeBookmarkIds: ["public-page"],
        },
        policy,
      ),
    ).toBe(true);
    expect(
      isResourceUserProtected(
        {
          resourceKey: "resource-private",
          nativeBookmarkIds: ["private-page"],
        },
        policy,
      ),
    ).toBe(true);
    expect(
      bookmarkProtectionState(
        "resource-private",
        "private-page",
        policy,
      ),
    ).toEqual({ protected: true, explicit: false, inherited: true });
  });

  it("串行保存网页和文件夹开关，避免快速点击互相覆盖", async () => {
    await Promise.all([
      setResourceProtection("resource-a", true),
      setFolderProtection("folder-a", true),
    ]);

    expect(await getProtectionSettings()).toEqual({
      resourceKeys: ["resource-a"],
      folderIds: ["folder-a"],
    });
    expect(values[PROTECTION_SETTINGS_KEY]).toEqual({
      resourceKeys: ["resource-a"],
      folderIds: ["folder-a"],
    });
  });
});
