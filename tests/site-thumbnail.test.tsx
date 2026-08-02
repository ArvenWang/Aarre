// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SiteThumbnail } from "../src/ui/components/SiteThumbnail";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = "";
});

describe("SiteThumbnail", () => {
  it("uses one transparent site icon over the fixed white carrier in every theme", async () => {
    document.documentElement.dataset.theme = "dark";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SiteThumbnail
          url="https://github.com/example/repository"
          brandImageUrl="data:image/webp;base64,TRANSPARENT_ICON"
        />,
      );
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/webp;base64,TRANSPARENT_ICON",
    );
    expect(container.querySelector("source")).toBeNull();

    await act(async () => root.unmount());
  });

  it("can force the site-brand pipeline for agent sources", () => {
    const markup = renderToStaticMarkup(
      <SiteThumbnail
        url="https://www.youtube.com/watch?v=abc"
        imageUrl="data:image/webp;base64,PAGE"
        brandImageUrl="data:image/webp;base64,BRAND"
        forceSiteBrand
      />,
    );

    expect(markup).toContain("data:image/webp;base64,BRAND");
    expect(markup).not.toContain("data:image/webp;base64,PAGE");
  });
});
