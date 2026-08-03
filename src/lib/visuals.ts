import {
  deleteVisual,
  getLocalResources,
  getPageSnapshots,
  getSiteBrands,
  getVisual,
  getVisualsByKind,
  putPageSnapshot,
  writeVisual
} from "./storage";
import type {
  PageSnapshot,
  ResourceRecord,
  SiteBrandRecord,
  VisualAsset
} from "./types";

export function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("无效的视觉资产 data URL。");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = header.match(/^data:([^;,]+)/)?.[1] || "image/webp";
  const binary = header.includes(";base64")
    ? atob(body)
    : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { blob: new Blob([bytes], { type: mime }), mime };
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 自动来源永远不能覆盖用户手动设置的视觉资产。 */
export async function putVisual(
  next: VisualAsset,
  options: { force?: boolean } = {}
): Promise<boolean> {
  const existing = await getVisual(next.key);
  if (
    existing?.origin === "user" &&
    next.origin === "auto" &&
    !options.force
  ) {
    return false;
  }
  await writeVisual(next);
  return true;
}

function resourceByCanonicalUrl(resources: ResourceRecord[]): Map<string, ResourceRecord[]> {
  const result = new Map<string, ResourceRecord[]>();
  for (const resource of resources) {
    const values = result.get(resource.canonicalUrl) || [];
    values.push(resource);
    result.set(resource.canonicalUrl, values);
  }
  return result;
}

async function visualFromDataUrl(
  input: Omit<VisualAsset, "blob" | "mime" | "contentHash"> & {
    dataUrl: string;
    contentHash?: string;
  }
): Promise<VisualAsset> {
  const { blob, mime } = dataUrlToBlob(input.dataUrl);
  return {
    key: input.key,
    kind: input.kind,
    identity: input.identity,
    blob,
    mime,
    width: input.width,
    height: input.height,
    origin: input.origin,
    source: input.source,
    contentHash: input.contentHash || await sha256(blob),
    updatedAt: input.updatedAt,
    renderVersion: input.renderVersion
  };
}

export async function putCoverVisual(input: {
  resource: Pick<ResourceRecord, "resourceKey" | "coverOrigin" | "coverSource">;
  dataUrl: string;
  width: number;
  height: number;
  origin: VisualAsset["origin"];
  source?: string;
  updatedAt: string;
  contentHash?: string;
  force?: boolean;
}): Promise<boolean> {
  const visual = await visualFromDataUrl({
    key: `cover:${input.resource.resourceKey}`,
    kind: "cover",
    identity: input.resource.resourceKey,
    dataUrl: input.dataUrl,
    width: input.width,
    height: input.height,
    origin: input.origin,
    source: input.source || input.resource.coverSource || "screenshot",
    contentHash: input.contentHash,
    updatedAt: input.updatedAt,
    renderVersion: 1
  });
  return putVisual(visual, { force: input.force });
}

export async function putSiteBrandVisual(brand: SiteBrandRecord): Promise<boolean> {
  const dataUrl = brand.iconDataUrlLight || brand.iconDataUrl;
  if (!dataUrl) return false;
  const visual = await visualFromDataUrl({
    key: `site-icon:${brand.host}`,
    kind: "site-icon",
    identity: brand.host,
    dataUrl,
    width: brand.nativeWidth || 0,
    height: brand.nativeHeight || 0,
    origin: "auto",
    source: brand.iconSource || "site-icon",
    updatedAt: brand.updatedAt,
    renderVersion: brand.iconRenderVersion || 0
  });
  return putVisual(visual);
}

/** 新 store 写入成功后才更新旧快照，避免旧读取路径绕过用户封面保护。 */
export async function putCoverSnapshot(
  resource: Pick<ResourceRecord, "resourceKey" | "coverOrigin" | "coverSource">,
  snapshot: PageSnapshot,
  origin: VisualAsset["origin"],
  options: { source?: string; contentHash?: string; force?: boolean } = {}
): Promise<boolean> {
  const stored = await putCoverVisual({
    resource,
    dataUrl: snapshot.imageDataUrl,
    width: snapshot.width,
    height: snapshot.height,
    origin,
    source: options.source,
    updatedAt: snapshot.capturedAt,
    contentHash: options.contentHash,
    force: options.force
  });
  if (stored) await putPageSnapshot(snapshot);
  return stored;
}

export interface VisualMigrationResult {
  migrated: number;
  remaining: boolean;
}

/**
 * 分批搬迁旧视觉字段。旧字段暂不删除；重复运行会跳过已存在的 key。
 */
export async function migrateLegacyVisualsBatch(limit = 50): Promise<VisualMigrationResult> {
  const [brands, snapshots, resources] = await Promise.all([
    getSiteBrands(),
    getPageSnapshots(),
    getLocalResources()
  ]);
  const candidates: Array<() => Promise<VisualAsset>> = [];
  for (const brand of brands) {
    const dataUrl = brand.iconDataUrlLight || brand.iconDataUrl;
    if (!dataUrl) continue;
    candidates.push(() => visualFromDataUrl({
      key: `site-icon:${brand.host}`,
      kind: "site-icon",
      identity: brand.host,
      dataUrl,
      width: brand.nativeWidth || 0,
      height: brand.nativeHeight || 0,
      origin: "auto",
      source: brand.iconSource || "legacy-site-brand",
      updatedAt: brand.updatedAt,
      renderVersion: brand.iconRenderVersion || 0
    }));
  }
  const byUrl = resourceByCanonicalUrl(resources);
  const snapshotResourceKeys = new Set<string>();
  for (const snapshot of snapshots) {
    for (const resource of byUrl.get(snapshot.canonicalUrl) || []) {
      snapshotResourceKeys.add(resource.resourceKey);
      candidates.push(() => visualFromDataUrl({
        key: `cover:${resource.resourceKey}`,
        kind: "cover",
        identity: resource.resourceKey,
        dataUrl: snapshot.imageDataUrl,
        width: snapshot.width,
        height: snapshot.height,
        origin: resource.coverOrigin || "auto",
        source: resource.coverSource || "screenshot",
        contentHash: resource.coverContentHash,
        updatedAt: resource.coverUpdatedAt || snapshot.capturedAt,
        renderVersion: 1
      }));
    }
  }
  for (const resource of resources) {
    if (!resource.thumbnailDataUrl || snapshotResourceKeys.has(resource.resourceKey)) continue;
    candidates.push(() => visualFromDataUrl({
      key: `cover:${resource.resourceKey}`,
      kind: "cover",
      identity: resource.resourceKey,
      dataUrl: resource.thumbnailDataUrl!,
      width: 0,
      height: 0,
      origin: resource.coverOrigin || "auto",
      source: resource.coverSource || "legacy-thumbnail",
      contentHash: resource.coverContentHash,
      updatedAt: resource.coverUpdatedAt || resource.updatedAt,
      renderVersion: 1
    }));
  }

  let migrated = 0;
  let pending = 0;
  for (const candidate of candidates) {
    let visual: VisualAsset;
    try {
      visual = await candidate();
    } catch {
      // 损坏的历史 dataURL 不应阻断其余资产迁移，也不应无限重试。
      continue;
    }
    if (await getVisual(visual.key)) continue;
    pending += 1;
    if (migrated >= limit) continue;
    await putVisual(visual);
    migrated += 1;
  }
  return { migrated, remaining: pending > migrated };
}

/** 每组同内容自动封面只留最新一条；用户封面永不参与自动清理。 */
export async function cleanupDuplicateAutomaticVisuals(): Promise<number> {
  const visuals = (await getVisualsByKind("cover")).filter(
    (visual) => visual.origin === "auto" && Boolean(visual.contentHash)
  );
  const groups = new Map<string, VisualAsset[]>();
  for (const visual of visuals) {
    const group = groups.get(visual.contentHash) || [];
    group.push(visual);
    groups.set(visual.contentHash, group);
  }
  let removed = 0;
  for (const group of groups.values()) {
    group.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    for (const duplicate of group.slice(1)) {
      await deleteVisual(duplicate.key);
      removed += 1;
    }
  }
  return removed;
}
