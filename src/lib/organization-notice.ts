import type {
  BookmarkAgentCatalog,
  LibraryInsights,
  OrganizationNotice,
  OrganizationPlan,
  ResourceRecord
} from "./types";

export const ORGANIZATION_NOTICE_DISMISS_MS =
  24 * 60 * 60 * 1_000;
export const ORGANIZATION_INSIGHTS_VERSION = 2;

export interface LibraryFingerprint {
  bookmarkCount: number;
  lastUpdatedAt: string;
}

export interface StoredOrganizationInsights {
  version: typeof ORGANIZATION_INSIGHTS_VERSION;
  insights: LibraryInsights;
  fingerprint: LibraryFingerprint;
  signature: string;
  dismissedSignature?: string;
  dismissedUntil?: string;
}

export function storedOrganizationInsightsIsCurrent(
  value: unknown
): value is StoredOrganizationInsights {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { version?: unknown }).version ===
        ORGANIZATION_INSIGHTS_VERSION &&
      "insights" in value &&
      "fingerprint" in value &&
      "signature" in value
  );
}

export function buildLibraryFingerprint(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog
): LibraryFingerprint {
  return {
    bookmarkCount: catalog.bookmarks.length,
    lastUpdatedAt: resources.reduce(
      (latest, resource) =>
        resource.updatedAt > latest ? resource.updatedAt : latest,
      ""
    )
  };
}

export function sameLibraryFingerprint(
  left: LibraryFingerprint | undefined,
  right: LibraryFingerprint
): boolean {
  return (
    left?.bookmarkCount === right.bookmarkCount &&
    left.lastUpdatedAt === right.lastUpdatedAt
  );
}

export function organizationPlanSignature(
  plan: OrganizationPlan
): string {
  return JSON.stringify(
    [...plan.proposals]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        title: proposal.title,
        actions: proposal.actions
          .map((action) => action.id)
          .sort(),
        beforePaths: proposal.beforePaths,
        afterPath: proposal.afterPath || "",
        previewLines: proposal.previewLines
      }))
  );
}

export function mergeStoredOrganizationInsights(
  previous: StoredOrganizationInsights | null,
  insights: LibraryInsights,
  fingerprint: LibraryFingerprint
): StoredOrganizationInsights {
  const signature = organizationPlanSignature(
    insights.organizationPlan
  );
  const sameProposalContent = previous?.signature === signature;
  return {
    version: ORGANIZATION_INSIGHTS_VERSION,
    insights,
    fingerprint,
    signature,
    ...(sameProposalContent && previous?.dismissedSignature
      ? { dismissedSignature: previous.dismissedSignature }
      : {}),
    ...(sameProposalContent && previous?.dismissedUntil
      ? { dismissedUntil: previous.dismissedUntil }
      : {})
  };
}

export function dismissStoredOrganizationInsights(
  stored: StoredOrganizationInsights,
  dismissedAt = Date.now()
): StoredOrganizationInsights {
  return {
    ...stored,
    dismissedSignature: stored.signature,
    dismissedUntil: new Date(
      dismissedAt + ORGANIZATION_NOTICE_DISMISS_MS
    ).toISOString()
  };
}

export function organizationNoticeFromStored(
  stored: StoredOrganizationInsights | null,
  currentTime = Date.now()
): OrganizationNotice | null {
  if (!stored?.insights.organizationPlan.proposalCount) return null;

  const dismissedUntil = Date.parse(stored.dismissedUntil || "");
  if (
    stored.dismissedSignature === stored.signature &&
    Number.isFinite(dismissedUntil) &&
    dismissedUntil > currentTime
  ) {
    return null;
  }

  const counts = {
    duplicate: 0,
    dead: 0,
    largeFolder: 0
  };
  for (const proposal of stored.insights.organizationPlan.proposals) {
    if (proposal.kind === "large_folder") counts.largeFolder += 1;
    else counts[proposal.kind] += 1;
  }

  return {
    generatedAt: stored.insights.organizationPlan.generatedAt,
    signature: stored.signature,
    proposalCount: stored.insights.organizationPlan.proposalCount,
    actionableCount: stored.insights.organizationPlan.actionableCount,
    counts
  };
}

export function organizationBadgeText(proposalCount: number): string {
  if (proposalCount <= 0) return "";
  return proposalCount > 99 ? "99+" : String(proposalCount);
}
