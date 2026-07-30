import { describe, expect, it } from "vitest";
import {
  isSnapshotSensitiveUrl,
  matchesSnapshotTargetUrl
} from "../src/lib/page-snapshot";
import { normalizeSnapshotExcludedHost } from "../src/lib/display-settings";

describe("page snapshot privacy", () => {
  it("blocks non-web, private, banking, payment and medical pages", () => {
    expect(isSnapshotSensitiveUrl("chrome://settings")).toBe(true);
    expect(isSnapshotSensitiveUrl("http://192.168.1.5/admin")).toBe(true);
    expect(isSnapshotSensitiveUrl("https://secure.example.bank/login")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://www.paypal.com/activity")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://patient.example.com/record")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://secure.chase.com/account")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://health.example.org/report")).toBe(
      true
    );
  });

  it("supports user-defined host exclusions without blocking normal pages", () => {
    expect(
      isSnapshotSensitiveUrl("https://docs.example.com/secret", [
        "example.com"
      ])
    ).toBe(true);
    expect(isSnapshotSensitiveUrl("https://developer.mozilla.org/docs")).toBe(
      false
    );
  });

  it("normalizes domain, wildcard and URL-shaped custom exclusions", () => {
    expect(normalizeSnapshotExcludedHost("*.Private.Example.com")).toBe(
      "private.example.com"
    );
    expect(
      normalizeSnapshotExcludedHost("https://Work.Example.com/private")
    ).toBe("work.example.com");
    expect(normalizeSnapshotExcludedHost("not a host")).toBe("");
  });

  it("matches an Aarre-opened target only after the intended URL finishes loading", () => {
    expect(
      matchesSnapshotTargetUrl(
        "https://example.com/guide#overview",
        "https://example.com/guide"
      )
    ).toBe(true);
    expect(
      matchesSnapshotTargetUrl(
        "https://example.com/guide",
        "https://example.com/login"
      )
    ).toBe(false);
    expect(matchesSnapshotTargetUrl("not a url", "https://example.com")).toBe(
      false
    );
  });
});
