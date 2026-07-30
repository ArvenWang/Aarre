import { describe, expect, it } from "vitest";
import {
  buildLibraryFingerprint,
  dismissStoredOrganizationInsights,
  mergeStoredOrganizationInsights,
  organizationBadgeText,
  organizationNoticeFromStored,
  organizationPlanSignature
} from "../src/lib/organization-notice";
import type {
  BookmarkAgentCatalog,
  LibraryInsights,
  OrganizationProposal,
  ResourceRecord
} from "../src/lib/types";

function proposal(
  overrides: Partial<OrganizationProposal> = {}
): OrganizationProposal {
  return {
    id: "duplicate:resource-1",
    kind: "duplicate",
    title: "合并重复收藏",
    description: "保留最早的一条",
    destructive: true,
    selectedByDefault: false,
    actions: [
      {
        id: "delete:bookmark-2",
        type: "delete_bookmark",
        label: "删除重复书签",
        description: "重复",
        destructive: true,
        status: "pending"
      }
    ],
    resourceKeys: ["resource-1"],
    beforePaths: ["书签栏 / A", "书签栏 / B"],
    afterPath: "书签栏 / A",
    previewLines: ["保留 A", "删除 B"],
    ...overrides
  };
}

function insights(
  proposals: OrganizationProposal[] = [proposal()]
): LibraryInsights {
  return {
    organizationPlan: {
      generatedAt: "2026-07-30T00:00:00.000Z",
      proposalCount: proposals.length,
      actionableCount: proposals.filter(
        (item) => item.actions.length > 0
      ).length,
      proposals
    },
    readingQueue: []
  };
}

describe("organization notice cache", () => {
  it("fingerprints bookmark count and latest resource update", () => {
    const resources = [
      {
        updatedAt: "2026-07-30T01:00:00.000Z"
      },
      {
        updatedAt: "2026-07-30T03:00:00.000Z"
      }
    ] as ResourceRecord[];
    const catalog = {
      bookmarks: ["1", "2", "3"].map((id) => ({
        id,
        parentId: "folder",
        title: id,
        url: `https://example.com/${id}`,
        path: ["书签栏"],
        writable: true
      })),
      folders: []
    } satisfies BookmarkAgentCatalog;

    expect(buildLibraryFingerprint(resources, catalog)).toEqual({
      bookmarkCount: 3,
      lastUpdatedAt: "2026-07-30T03:00:00.000Z"
    });
  });

  it("keeps dismissal for unchanged proposals and expires after 24 hours", () => {
    const initial = mergeStoredOrganizationInsights(
      null,
      insights(),
      { bookmarkCount: 2, lastUpdatedAt: "2026-07-30T00:00:00.000Z" }
    );
    const dismissedAt = Date.parse("2026-07-30T04:00:00.000Z");
    const dismissed = dismissStoredOrganizationInsights(
      initial,
      dismissedAt
    );
    const refreshed = mergeStoredOrganizationInsights(
      dismissed,
      insights(),
      { bookmarkCount: 3, lastUpdatedAt: "2026-07-30T05:00:00.000Z" }
    );

    expect(
      organizationNoticeFromStored(refreshed, dismissedAt + 1_000)
    ).toBeNull();
    expect(
      organizationNoticeFromStored(
        refreshed,
        dismissedAt + 24 * 60 * 60 * 1_000 + 1
      )
    )?.toMatchObject({ proposalCount: 1, counts: { duplicate: 1 } });
  });

  it("shows immediately when proposal content changes", () => {
    const initial = mergeStoredOrganizationInsights(
      null,
      insights(),
      { bookmarkCount: 2, lastUpdatedAt: "2026-07-30T00:00:00.000Z" }
    );
    const dismissed = dismissStoredOrganizationInsights(initial, 1_000);
    const changed = mergeStoredOrganizationInsights(
      dismissed,
      insights([
        proposal(),
        proposal({
          id: "classify:design",
          kind: "classify",
          title: "归类设计收藏"
        })
      ]),
      { bookmarkCount: 3, lastUpdatedAt: "2026-07-30T01:00:00.000Z" }
    );

    expect(organizationNoticeFromStored(changed, 2_000)).toMatchObject({
      proposalCount: 2,
      counts: { duplicate: 1, classify: 1 }
    });
  });

  it("uses a stable signature and a four-character badge maximum", () => {
    const plan = insights([
      proposal({ id: "b" }),
      proposal({ id: "a" })
    ]).organizationPlan;
    const reversed = {
      ...plan,
      proposals: [...plan.proposals].reverse()
    };

    expect(organizationPlanSignature(plan)).toBe(
      organizationPlanSignature(reversed)
    );
    expect(organizationBadgeText(0)).toBe("");
    expect(organizationBadgeText(12)).toBe("12");
    expect(organizationBadgeText(100)).toBe("99+");
  });
});
