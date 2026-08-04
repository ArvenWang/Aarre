import { describe, expect, it } from "vitest";
import { cloudDisplaySettingsPayload } from "../src/lib/cloud-state";

describe("cloud display settings contract", () => {
  it("keeps the public favicon privacy choice device-local", () => {
    expect(
      cloudDisplaySettingsPayload({
        listCoverStyle: "site",
        publicFaviconFallback: false,
        pageSnapshotsEnabled: true,
        snapshotExcludedHosts: ["private.example.com"],
        scanCostLimitCny: 10
      })
    ).toEqual({
      listCoverStyle: "site",
      pageSnapshotsEnabled: true,
      snapshotExcludedHosts: ["private.example.com"],
      scanCostLimitCny: 10
    });
  });
});
