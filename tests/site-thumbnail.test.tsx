import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteThumbnail } from "../src/ui/components/SiteThumbnail";

describe("SiteThumbnail", () => {
  it("renders separate light and dark site-brand sources", () => {
    const markup = renderToStaticMarkup(
      <SiteThumbnail
        url="https://example.com/article"
        brandImageUrl="data:image/webp;base64,LIGHT"
        brandImageUrlDark="data:image/webp;base64,DARK"
      />
    );

    expect(markup).toContain(
      'media="(prefers-color-scheme: dark)"'
    );
    expect(markup).toContain("data:image/webp;base64,DARK");
    expect(markup).toContain("data:image/webp;base64,LIGHT");
  });

  it("can force the site-brand pipeline for agent sources", () => {
    const markup = renderToStaticMarkup(
      <SiteThumbnail
        url="https://www.youtube.com/watch?v=abc"
        imageUrl="data:image/webp;base64,PAGE"
        brandImageUrl="data:image/webp;base64,BRAND"
        forceSiteBrand
      />
    );

    expect(markup).toContain("data:image/webp;base64,BRAND");
    expect(markup).not.toContain("data:image/webp;base64,PAGE");
  });
});
