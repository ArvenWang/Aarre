import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { highlightTextMatches } from "../src/ui/sidepanel/SidePanelApp";

function render(text: string, query: string): string {
  return renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      highlightTextMatches(text, query)
    )
  );
}

describe("highlightTextMatches", () => {
  it("highlights every case-insensitive substring match", () => {
    expect(render("Design design DESIGN", "design")).toBe(
      "<mark>Design</mark> <mark>design</mark> <mark>DESIGN</mark>"
    );
  });

  it("keeps HTML-like user text escaped by React", () => {
    expect(render("A <tag> & emoji 😀", "<tag>")).toBe(
      "A <mark>&lt;tag&gt;</mark> &amp; emoji 😀"
    );
  });

  it("leaves pinyin-only matches unhighlighted", () => {
    expect(render("哔哩哔哩", "bilibili")).toBe("哔哩哔哩");
  });

  it("supports emoji matches without breaking surrogate pairs", () => {
    expect(render("收藏😀与😀页面", "😀")).toBe(
      "收藏<mark>😀</mark>与<mark>😀</mark>页面"
    );
  });

  it("treats regular-expression characters as plain text", () => {
    expect(render("设计 [v2] 规范", "[v2]")).toBe(
      "设计 <mark>[v2]</mark> 规范"
    );
  });

  it("removes every highlight when the query is cleared", () => {
    expect(render("Design 设计", "")).toBe("Design 设计");
  });
});
