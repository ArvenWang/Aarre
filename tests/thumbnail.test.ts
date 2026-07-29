import { describe, expect, it } from "vitest";
import { sanitizeStaticSvg } from "../src/lib/thumbnail";

describe("thumbnail safety", () => {
  it("allows a self-contained static SVG", () => {
    expect(
      sanitizeStaticSvg(
        '<svg viewBox="0 0 192 192"><path fill="#111" d="M0 0h192v192H0z"/></svg>'
      )
    ).toContain("<path");
  });

  it("rejects scripts, event handlers and external references", () => {
    expect(() =>
      sanitizeStaticSvg("<svg><script>alert(1)</script></svg>")
    ).toThrow("unsafe-svg");
    expect(() =>
      sanitizeStaticSvg('<svg onload="alert(1)"></svg>')
    ).toThrow("unsafe-svg");
    expect(() =>
      sanitizeStaticSvg(
        '<svg><use href="https://tracker.example/icon.svg#x"/></svg>'
      )
    ).toThrow("unsafe-svg");
  });
});
