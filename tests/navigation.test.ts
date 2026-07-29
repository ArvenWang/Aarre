import { describe, expect, it } from "vitest";
import {
  matchesNavigationText,
  parseNavigationInput
} from "../src/lib/navigation";

describe("parseNavigationInput", () => {
  it("opens explicit and domain-like URLs directly", () => {
    expect(parseNavigationInput("https://example.com/a")).toEqual({
      kind: "url",
      url: "https://example.com/a"
    });
    expect(parseNavigationInput("example.com/docs")).toEqual({
      kind: "url",
      url: "https://example.com/docs"
    });
    expect(parseNavigationInput("localhost:5173")).toEqual({
      kind: "url",
      url: "http://localhost:5173"
    });
    expect(parseNavigationInput("file:///Users/me/page.html")).toEqual({
      kind: "url",
      url: "file:///Users/me/page.html"
    });
  });

  it("sends ordinary text to the browser default search provider", () => {
    expect(parseNavigationInput("shader inspiration")).toEqual({
      kind: "search",
      query: "shader inspiration"
    });
    expect(parseNavigationInput("javascript:alert(1)")).toEqual({
      kind: "search",
      query: "javascript:alert(1)"
    });
  });
});

describe("matchesNavigationText", () => {
  it("matches all query terms across title and URL", () => {
    expect(
      matchesNavigationText(
        "shader weekly",
        "DEX Weekly: shaders",
        "https://example.com"
      )
    ).toBe(true);
    expect(matchesNavigationText("shader video", "Shader list")).toBe(false);
  });
});
