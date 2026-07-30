import { describe, expect, it } from "vitest";
import {
  buildSelectableFolderOptions,
  initialSaveFolderId,
  visibleFolderPath
} from "../src/lib/folder-options";

describe("buildSelectableFolderOptions", () => {
  it("hides Chrome system roots and promotes user folders", () => {
    const options = buildSelectableFolderOptions([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "书签栏",
            children: [
              {
                id: "10",
                title: "设计赏析",
                children: [
                  { id: "11", title: "案例" },
                  {
                    id: "12",
                    title: "Example",
                    url: "https://example.com"
                  }
                ]
              }
            ]
          },
          {
            id: "2",
            title: "其他书签",
            children: [{ id: "20", title: "待复查" }]
          }
        ]
      }
    ]);

    expect(options).toEqual([
      {
        id: "10",
        name: "设计赏析",
        path: ["书签栏", "设计赏析"],
        depth: 0
      },
      {
        id: "11",
        name: "案例",
        path: ["书签栏", "设计赏析", "案例"],
        depth: 1
      },
      {
        id: "20",
        name: "待复查",
        path: ["其他书签", "待复查"],
        depth: 0
      }
    ]);
  });
});

describe("initialSaveFolderId", () => {
  const options = [
    {
      id: "10",
      name: "设计赏析",
      path: ["书签栏", "设计赏析"],
      depth: 0
    }
  ];

  it("keeps an existing user-created folder", () => {
    expect(initialSaveFolderId(options, "10")).toBe("10");
  });

  it("does not keep a hidden Chrome root selected", () => {
    expect(initialSaveFolderId(options, "1")).toBe("10");
  });

  it("returns no selection when no user folder exists", () => {
    expect(initialSaveFolderId([], "1")).toBe("");
  });
});

describe("visibleFolderPath", () => {
  it("removes the hidden Chrome root from recommendation labels", () => {
    expect(
      visibleFolderPath(["书签栏", "设计赏析", "案例"])
    ).toEqual(["设计赏析", "案例"]);
  });
});
