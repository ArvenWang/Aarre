import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/storage", () => ({
  getSiteBrand: vi.fn(),
  putSiteBrand: vi.fn(),
  getSiteBrands: vi.fn(),
  getLocalResources: vi.fn(),
  invalidateStaleSiteBrandIcons: vi.fn()
}));

vi.mock("../src/lib/thumbnail", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/thumbnail")>();
  return { ...actual, cacheSiteBrandIcon: vi.fn() };
});

import { getSiteBrand, putSiteBrand } from "../src/lib/storage";
import { cacheSiteBrandIcon, SITE_ICON_RENDER_VERSION } from "../src/lib/thumbnail";
import { createSiteIconHandlers } from "../src/extension/handlers/site-icons";
import type { ResourceRecord } from "../src/lib/types";

const sendMessage = vi.fn().mockResolvedValue(undefined);

function htmlResponse(body = "<html><head></head><body>ok</body></html>") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function resource(url = "https://example.com/article"): ResourceRecord {
  return {
    resourceKey: "k".repeat(64),
    canonicalUrl: url,
    url,
    title: "Example",
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "example.com",
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: ["1"],
    nativeFolderPath: ["Bookmarks bar"],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z"
  };
}

describe("ensureSiteBrandForResource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage.mockClear();
    vi.stubGlobal(
      "chrome",
      { runtime: { sendMessage } }
    );
  });

  it("skips network entirely when the cached brand is still fresh", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getSiteBrand).mockResolvedValue({
      host: "example.com",
      iconDataUrlLight: "data:image/png;base64,AA==",
      iconRenderVersion: SITE_ICON_RENDER_VERSION,
      iconSource: "conventional-favicon-ico",
      updatedAt: new Date().toISOString()
    });

    const handlers = createSiteIconHandlers({
      readLimitedText: async (response) => (await response.text()).slice(0, 300_000),
      upsertLocalResource: vi.fn()
    });

    const result = await handlers.ensureSiteBrandForResource(resource());

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(putSiteBrand).not.toHaveBeenCalled();
  });

  it("fetches the page HTML, stores the brand and notifies the UI", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://example.com/article") {
          return htmlResponse(
            '<html><head><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head><body>ok</body></html>'
          );
        }
        return new Response(null, { status: 404 });
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getSiteBrand).mockResolvedValue(undefined);
    vi.mocked(cacheSiteBrandIcon).mockResolvedValue({
      iconDataUrlLight: "data:image/png;base64,YWJj",
      iconRenderVersion: SITE_ICON_RENDER_VERSION,
      iconSource: "apple-touch-icon"
    });
    vi.mocked(putSiteBrand).mockResolvedValue(undefined);

    const handlers = createSiteIconHandlers({
      readLimitedText: async (response) => (await response.text()).slice(0, 300_000),
      upsertLocalResource: vi.fn()
    });

    const result = await handlers.ensureSiteBrandForResource(resource());

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.objectContaining({ credentials: "omit" })
    );
    expect(putSiteBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "example.com",
        iconDataUrlLight: "data:image/png;base64,YWJj"
      })
    );
    expect(sendMessage).toHaveBeenCalledWith({
      type: "SITE_BRANDS_UPDATED"
    });
  });

  it("dedupes concurrent requests for the same host", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return htmlResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getSiteBrand).mockResolvedValue(undefined);
    vi.mocked(cacheSiteBrandIcon).mockResolvedValue({
      iconDataUrlLight: "data:image/png;base64,YWJj",
      iconRenderVersion: SITE_ICON_RENDER_VERSION,
      iconSource: "apple-touch-icon"
    });
    vi.mocked(putSiteBrand).mockResolvedValue(undefined);

    const handlers = createSiteIconHandlers({
      readLimitedText: async (response) => (await response.text()).slice(0, 300_000),
      upsertLocalResource: vi.fn()
    });

    const [first, second] = await Promise.all([
      handlers.ensureSiteBrandForResource(resource()),
      handlers.ensureSiteBrandForResource(resource("https://example.com/other"))
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    const pageFetches = fetchMock.mock.calls.filter(
      ([input]) =>
        String(input) === "https://example.com/article" ||
        String(input) === "https://example.com/other"
    );
    // 两次保存并发命中同一主机时只抓取一次页面 HTML；其余请求是
    // 图标探测（常规路径 HEAD），不代表重复抓取。
    expect(pageFetches).toHaveLength(1);
    expect(putSiteBrand).toHaveBeenCalledTimes(1);
  });

  it("tries the captured favicon first and skips the HTML read", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://example.com/article") {
          return htmlResponse();
        }
        return new Response(null, { status: 404 });
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getSiteBrand).mockResolvedValue(undefined);
    vi.mocked(cacheSiteBrandIcon).mockResolvedValue({
      iconDataUrlLight: "data:image/png;base64,c2VlZA==",
      iconRenderVersion: SITE_ICON_RENDER_VERSION,
      iconSource: "capture-favicon"
    });
    vi.mocked(putSiteBrand).mockResolvedValue(undefined);

    const handlers = createSiteIconHandlers({
      readLimitedText: async (response) => (await response.text()).slice(0, 300_000),
      upsertLocalResource: vi.fn()
    });
    const faviconUrl = "https://example.com/favicon.png";

    const result = await handlers.ensureSiteBrandForResource(
      resource(),
      false,
      [{ url: faviconUrl, source: "capture-favicon" }]
    );

    expect(result).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input]) => String(input) === "https://example.com/article"
      )
    ).toBe(false);
    expect(cacheSiteBrandIcon).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ url: faviconUrl, source: "capture-favicon" })
      ]),
      expect.any(Function)
    );
    expect(putSiteBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "example.com",
        iconDataUrlLight: "data:image/png;base64,c2VlZA=="
      })
    );
  });
});

describe("save-path icon wiring guards", () => {
  it("starts the immediate icon fetch from both save paths", async () => {
    const [save, resources] = await Promise.all([
      readFile(
        new URL("../src/extension/handlers/bookmark-save.ts", import.meta.url),
        "utf8"
      ),
      readFile(
        new URL("../src/extension/handlers/resources.ts", import.meta.url),
        "utf8"
      )
    ]);

    expect(save).toContain(
      "void ensureSiteBrandForResource(resource, false, siteIconSeed)"
    );
    expect(save).toContain("!privacyBlocked");
    expect(save).toContain("capture-favicon");
    expect(resources).toContain("void ensureSiteBrandForResource(resource)");
    expect(resources).toContain("!privacyBlocked");
  });
});
