import { describe, expect, it } from "vitest";
import { classifyLinkHealth } from "../src/lib/link-health";

const checkedAt = "2026-07-30T00:00:00.000Z";

describe("link health classification", () => {
  it("only treats real 404 and 410 responses as immediately dead", () => {
    expect(
      classifyLinkHealth({
        requestedUrl: "https://example.com/missing",
        checkedAt,
        status: 404,
        finalUrl: "https://example.com/missing"
      }).status
    ).toBe("dead");
    expect(
      classifyLinkHealth({
        requestedUrl: "https://example.com/private",
        checkedAt,
        status: 403,
        finalUrl: "https://example.com/login"
      }).status
    ).toBe("login_required");
  });

  it("requires three consecutive temporary failures before dead", () => {
    const first = classifyLinkHealth({
      requestedUrl: "https://example.com/outage",
      checkedAt,
      status: 503
    });
    const second = classifyLinkHealth(
      {
        requestedUrl: "https://example.com/outage",
        checkedAt,
        failed: true
      },
      first
    );
    const third = classifyLinkHealth(
      {
        requestedUrl: "https://example.com/outage",
        checkedAt,
        failed: true
      },
      second
    );
    expect(first.status).toBe("temporary");
    expect(second.status).toBe("temporary");
    expect(third.status).toBe("dead");
  });

  it("marks a content page redirected to the domain root as soft 404", () => {
    expect(
      classifyLinkHealth({
        requestedUrl: "https://example.com/articles/removed",
        checkedAt,
        status: 200,
        finalUrl: "https://example.com/"
      }).status
    ).toBe("soft_404");
  });
});

