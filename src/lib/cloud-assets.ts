import { cloudRequest } from "./auth";
import { getCloudSyncSettings } from "./cloud-settings";
import { updateCloudSyncProgress } from "./cloud-progress";
import { pinnedBrandAssetNeedsRefresh } from "./cover-rules";
import {
  buildProtectionPolicy,
  getProtectionSettings,
  isResourceUserProtected
} from "./protection";
import {
  getLocalResource,
  getLocalResources,
  getPageSnapshot,
  getPageSnapshots,
  getSiteBrand,
  getSiteBrands,
  putPageSnapshot,
  putSiteBrand,
  upsertLocalResource
} from "./storage";
import { SITE_ICON_RENDER_VERSION } from "./thumbnail";
import type { PageSnapshot, ResourceRecord, SiteBrandRecord } from "./types";
import { resourceKeyForUrl } from "./url";

const CLOUD_ASSET_STATE_KEY = "aarre:cloud-asset-state:v1";

interface CloudAssetStateEntry {
  assetId: string;
  sha256: string;
  revision: number;
}

type CloudAssetState = Record<string, CloudAssetStateEntry>;

interface CloudAssetDescriptor {
  assetId: string;
  resourceKey: string;
  kind: "cover" | "snapshot" | "site-icon" | "user-cover";
  sha256: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  mimeType: string;
  capturedAt: string | null;
  binding: {
    canonicalUrl?: string;
    host?: string;
    iconRenderVersion?: number;
    iconAssetUrl?: string;
  } | null;
  revision: number;
}

export function cloudSiteIconBindingIsCurrent(
  binding:
    | {
        host?: string;
        iconRenderVersion?: number;
        iconAssetUrl?: string;
      }
    | null
    | undefined
): boolean {
  if (
    !binding?.host ||
    binding.iconRenderVersion !== SITE_ICON_RENDER_VERSION
  ) {
    return false;
  }
  return !pinnedBrandAssetNeedsRefresh(
    `https://${binding.host}/`,
    binding.iconAssetUrl
  );
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("图片缓存格式无效，无法上传云端。");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { bytes, mimeType: match[1] };
}

function bytesDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 16_384;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function stableAssetId(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readState(): Promise<CloudAssetState> {
  const stored = (await chrome.storage.local.get(CLOUD_ASSET_STATE_KEY))[CLOUD_ASSET_STATE_KEY];
  return stored && typeof stored === "object" ? (stored as CloudAssetState) : {};
}

async function writeState(state: CloudAssetState): Promise<void> {
  await chrome.storage.local.set({ [CLOUD_ASSET_STATE_KEY]: state });
}

export async function clearCloudAssetSyncState(): Promise<void> {
  await chrome.storage.local.remove(CLOUD_ASSET_STATE_KEY);
}

async function uploadAsset(input: {
  identity: string;
  resourceKey: string;
  kind: CloudAssetDescriptor["kind"];
  dataUrl: string;
  width?: number;
  height?: number;
  capturedAt?: string;
  binding?: {
    canonicalUrl?: string;
    host?: string;
    iconRenderVersion?: number;
    iconAssetUrl?: string;
  };
  state: CloudAssetState;
}): Promise<boolean> {
  const { bytes, mimeType } = dataUrlBytes(input.dataUrl);
  const digest = await sha256(bytes);
  if (input.state[input.identity]?.sha256 === digest) return false;
  const assetId = await stableAssetId(`${input.identity}:${digest}`);
  const upload = await cloudRequest<{
    uploadUrl: string;
    headers: Record<string, string>;
  }>("/v1/assets/upload", {
    method: "POST",
    body: JSON.stringify({
      assetId,
      operationId: crypto.randomUUID(),
      resourceKey: input.resourceKey,
      kind: input.kind,
      sha256: digest,
      byteSize: bytes.byteLength,
      width: input.width,
      height: input.height,
      mimeType,
      capturedAt: input.capturedAt,
      binding: input.binding
    })
  });
  const headers = new Headers(upload.headers);
  headers.delete("content-length");
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers,
    body: new Blob([exactArrayBuffer(bytes)], { type: mimeType }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`图片上传失败（${response.status}）。`);
  const completed = await cloudRequest<{ revision: number }>(
    `/v1/assets/${assetId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ operationId: crypto.randomUUID() })
    }
  );
  input.state[input.identity] = { assetId, sha256: digest, revision: completed.revision };
  return true;
}

export async function syncCloudAssets(maxUploads = 12): Promise<{ uploaded: number; remaining: boolean }> {
  const settings = await getCloudSyncSettings();
  if (!settings.enabled || settings.scope !== "complete") return { uploaded: 0, remaining: false };
  const [resources, snapshots, brands, protectionSettings, tree, state] = await Promise.all([
    getLocalResources(),
    getPageSnapshots(),
    getSiteBrands(),
    getProtectionSettings(),
    chrome.bookmarks.getTree(),
    readState()
  ]);
  const policy = buildProtectionPolicy(tree, protectionSettings);
  const unprotected = resources.filter(
    (resource) => resource.nativeBookmarkIds.length && !isResourceUserProtected(resource, policy)
  );
  const resourcesByKey = new Map(unprotected.map((resource) => [resource.resourceKey, resource]));
  const protectedHosts = new Set(
    resources
      .filter((resource) => isResourceUserProtected(resource, policy))
      .flatMap((resource) => {
        try {
          return [new URL(resource.url).hostname.toLocaleLowerCase()];
        } catch {
          return [];
        }
      })
  );
  const jobs: Array<() => Promise<boolean>> = [];
  for (const resource of unprotected) {
    if (!resource.thumbnailDataUrl) continue;
    jobs.push(() => uploadAsset({
      identity: `cover:${resource.resourceKey}`,
      resourceKey: resource.resourceKey,
      kind: "cover",
      dataUrl: resource.thumbnailDataUrl!,
      binding: { canonicalUrl: resource.canonicalUrl },
      state
    }));
  }
  for (const snapshot of snapshots) {
    const resourceKey = await resourceKeyForUrl(snapshot.canonicalUrl);
    if (!resourcesByKey.has(resourceKey)) continue;
    jobs.push(() => uploadAsset({
      identity: `snapshot:${resourceKey}`,
      resourceKey,
      kind: "snapshot",
      dataUrl: snapshot.imageDataUrl,
      width: snapshot.width,
      height: snapshot.height,
      capturedAt: snapshot.capturedAt,
      binding: { canonicalUrl: snapshot.canonicalUrl },
      state
    }));
  }
  for (const brand of brands) {
    const icon = brand.iconDataUrlLight || brand.iconDataUrl;
    if (
      !icon ||
      brand.iconRenderVersion !== SITE_ICON_RENDER_VERSION ||
      protectedHosts.has(brand.host)
    ) {
      continue;
    }
    const resourceKey = await resourceKeyForUrl(`https://${brand.host}/`);
    jobs.push(() => uploadAsset({
      identity: `site-icon:${brand.host}`,
      resourceKey,
      kind: "site-icon",
      dataUrl: icon,
      width: brand.nativeWidth,
      height: brand.nativeHeight,
      binding: {
        host: brand.host,
        iconRenderVersion: SITE_ICON_RENDER_VERSION,
        ...(brand.iconAssetUrl ? { iconAssetUrl: brand.iconAssetUrl } : {}),
      },
      state
    }));
  }

  await updateCloudSyncProgress({
    assetTotal: jobs.length,
    statusText: "正在上传图片与快照…"
  });

  let uploaded = 0;
  let inspected = 0;
  for (const job of jobs) {
    if (uploaded >= maxUploads) break;
    if (await job()) {
      uploaded += 1;
      await updateCloudSyncProgress({ assetProcessedDelta: 1 });
    }
    inspected += 1;
  }
  if (uploaded) await writeState(state);
  return { uploaded, remaining: inspected < jobs.length };
}

async function downloadAsset(asset: CloudAssetDescriptor): Promise<Uint8Array> {
  const signed = await cloudRequest<{ downloadUrl: string }>(
    `/v1/assets/${asset.assetId}/download`
  );
  const response = await fetch(signed.downloadUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`云端图片下载失败（${response.status}）。`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256(bytes)) !== asset.sha256) throw new Error("云端图片校验失败，已停止恢复。");
  return bytes;
}

export async function restoreCloudAssets(maxDownloads = 24): Promise<{ restored: number; remaining: boolean }> {
  const settings = await getCloudSyncSettings();
  if (!settings.enabled || settings.scope !== "complete") return { restored: 0, remaining: false };
  const response = await cloudRequest<{ assets: CloudAssetDescriptor[] }>("/v1/assets");
  const state = await readState();
  let restored = 0;
  let inspected = 0;
  for (const asset of response.assets) {
    if (restored >= maxDownloads) break;
    if (
      asset.kind === "site-icon" &&
      !cloudSiteIconBindingIsCurrent(asset.binding)
    ) {
      inspected += 1;
      continue;
    }
    const identity = asset.kind === "site-icon"
      ? `site-icon:${asset.binding?.host || ""}`
      : `${asset.kind}:${asset.resourceKey}`;
    if (!identity || state[identity]?.sha256 === asset.sha256) {
      inspected += 1;
      continue;
    }
    const bytes = await downloadAsset(asset);
    const dataUrl = bytesDataUrl(bytes, asset.mimeType);
    if (asset.kind === "snapshot" && asset.binding?.canonicalUrl) {
      const snapshot: PageSnapshot = {
        canonicalUrl: asset.binding.canonicalUrl,
        imageDataUrl: dataUrl,
        capturedAt: asset.capturedAt || new Date().toISOString(),
        width: asset.width || 1,
        height: asset.height || 1
      };
      await putPageSnapshot(snapshot);
    } else if (asset.kind === "site-icon" && asset.binding?.host) {
      const existing = await getSiteBrand(asset.binding.host);
      const brand: SiteBrandRecord = {
        ...(existing || { host: asset.binding.host }),
        host: asset.binding.host,
        iconDataUrl: dataUrl,
        iconDataUrlLight: dataUrl,
        iconRenderVersion: SITE_ICON_RENDER_VERSION,
        iconAssetUrl: asset.binding.iconAssetUrl,
        updatedAt: new Date().toISOString()
      };
      await putSiteBrand(brand);
    } else if (asset.kind === "cover" || asset.kind === "user-cover") {
      const resource = await getLocalResource(asset.resourceKey);
      if (resource) {
        await upsertLocalResource({
          ...resource,
          thumbnailDataUrl: dataUrl,
          coverUpdatedAt: resource.coverUpdatedAt || new Date().toISOString()
        });
      }
    }
    state[identity] = { assetId: asset.assetId, sha256: asset.sha256, revision: asset.revision };
    restored += 1;
    inspected += 1;
  }
  if (restored) await writeState(state);
  return { restored, remaining: inspected < response.assets.length };
}
