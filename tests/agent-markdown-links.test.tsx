import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMarkdown } from "../src/ui/sidepanel/pages/AgentChatPage";
import type { BookmarkAgentSource } from "../src/lib/types";

const citedSource: BookmarkAgentSource = {
  resourceKey: "source-only-bookmark",
  title: "Source-only bookmark",
  url: "https://example.com/bookmark",
  siteName: "Example",
  faviconUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
};

describe("Agent Markdown bookmark links", () => {
  it("renders a cited bookmark source as the same pill when the resource map is temporarily missing it", () => {
    const markup = renderToStaticMarkup(
      <AgentMarkdown
        content={
          "[收藏来源](https://example.com/bookmark/) 和 [普通网页](https://outside.example/page)"
        }
        resourceByUrl={new Map()}
        siteBrandByHost={new Map()}
        sources={[citedSource]}
      />,
    );

    expect(markup.match(/class="agent-inline-source"/g)).toHaveLength(1);
    expect(markup).toContain('href="https://example.com/bookmark"');
    expect(markup).toContain('href="https://outside.example/page"');
  });
});
