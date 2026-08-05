import { describe, expect, it } from "vitest";
import { publicFaviconCandidates } from "../src/lib/public-favicon";

const enabled = {
  publicFaviconFallback: true,
  snapshotExcludedHosts: [] as string[]
};

describe("public favicon fallback", () => {
  it("只把普通网页的域名交给 Google 和 DuckDuckGo", () => {
    expect(
      publicFaviconCandidates("https://Docs.Example.com/private?q=secret", enabled)
    ).toEqual([
      {
        url: "https://www.google.com/s2/favicons?domain=docs.example.com&sz=256",
        source: "public-service",
        declaredSize: 256
      },
      {
        url: "https://icons.duckduckgo.com/ip3/docs.example.com.ico",
        source: "public-service"
      }
    ]);
  });

  it("关闭设置后不生成任何第三方请求", () => {
    expect(
      publicFaviconCandidates("https://example.com", {
        ...enabled,
        publicFaviconFallback: false
      })
    ).toEqual([]);
  });

  it.each([
    "http://192.168.1.2/admin",
    "https://secure.example.bank/login",
    "https://www.paypal.com/activity",
    "https://patient.example.com/record"
  ])("敏感或本地地址永不外发：%s", (url) => {
    expect(publicFaviconCandidates(url, enabled)).toEqual([]);
  });

  it("尊重用户自定义排除域名及其子域名", () => {
    expect(
      publicFaviconCandidates("https://docs.private.example.com/page", {
        ...enabled,
        snapshotExcludedHosts: ["private.example.com"]
      })
    ).toEqual([]);
  });
});
