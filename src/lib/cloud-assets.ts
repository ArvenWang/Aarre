import { getCloudSyncSettings } from "./cloud-settings";
import { cloudOwner } from "./cloud-owner";
import { readCloudResourceTracking } from "./cloud-resource-store";
import { commitDownloadedAsset } from "./cloud-asset-restore";
import { cloudRequest } from "./auth";
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
} from "./storage";
import { SITE_ICON_RENDER_VERSION } from "./thumbnail";
import type { ResourceRecord } from "./types";
import { resourceKeyForUrl } from "./url";

const CLOUD_ASSET_STATE_KEY = "aarre:cloud-asset-state:v1";

interface CloudAssetStateEntry {
  assetId: string;
  sha256: string;
  revision: number;
}

type CloudAssetState = Record<string, CloudAssetStateEntry>;

export interface CloudAssetDescriptor {
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
    coverOrigin?: "user" | "auto";
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

/**
 * 把本地“已上传”标记转换为与服务器一致的 identity 键。
 * site-icon 按 host 绑定，其余资产按 resourceKey 绑定。
 */
export function cloudAssetIdentity(asset: {
  kind: CloudAssetDescriptor["kind"];
  resourceKey: string;
  binding?: {
    host?: string;
    canonicalUrl?: string;
    iconRenderVersion?: number;
    iconAssetUrl?: string;
  } | null;
}): string {
  return asset.kind === "site-icon"
    ? `site-icon:${asset.binding?.host || ""}`
    : `${asset.kind}:${asset.resourceKey}`;
}

/**
 * 用服务器当前 active 资产列表对账本地“已上传”标记。
 * 服务器已删除（或从未接收）的资产，本地标记必须失效，否则上传会被
 * 误判为“已上传”而跳过，导致云端实际缺图却显示同步完成。
 */
export function reconcileCloudAssetState(
  _state: CloudAssetState,
  remoteAssets: CloudAssetDescriptor[]
): CloudAssetState {
  const reconciled: CloudAssetState = {};
  for (const asset of remoteAssets) {
    const identity = cloudAssetIdentity(asset);
    if (!identity || identity.endsWith(":")) continue;
    const current = reconciled[identity];
    if (!current || asset.revision >= current.revision) {
      reconciled[identity] = {
        assetId: asset.assetId,
        sha256: asset.sha256,
        revision: asset.revision,
      };
    }
  }
  return reconciled;
}

/**
 * 服务端资产契约只接受 1..16384 的整数。SVG viewBox 可以合法使用小数，
 * 历史缓存也可能含 0/NaN；尺寸只是元数据，统一在上传边界归一化，不能让
 * 一张图标阻断整条同步流水线。
 */
export function cloudAssetDimension(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(16_384, Math.max(1, Math.round(value)));
}

export function cloudAssetNeedsUpload(
  state: CloudAssetState,
  identity: string,
  sha256Digest: string,
): boolean {
  return state[identity]?.sha256 !== sha256Digest;
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

async function dataUrlMatchesSha256(dataUrl: string, expected: string): Promise<boolean> {
  try {
    return await sha256(dataUrlBytes(dataUrl).bytes) === expected;
  } catch {
    return false;
  }
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

async function requireAssetConsent(owner?: string) {
  if (!(await getCloudSyncSettings()).enabled || (owner && await cloudOwner() !== owner)) throw new Error("完整备份未开启或账号已变化，图片仍保留在本机。");
}

async function uploadAsset(input: {
  owner?: string;
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
    coverOrigin?: "user" | "auto";
  };
  state: CloudAssetState;
  previousState?: CloudAssetState;
  remote?: CloudAssetDescriptor;
  expectedHash?: string;
  writePreconditions?: boolean;
}): Promise<boolean> {
  const { bytes, mimeType } = dataUrlBytes(input.dataUrl);
  const digest = await sha256(bytes);
  if (!cloudAssetNeedsUpload(input.state, input.identity, digest)) return false;
  // Old releases hashed the data-URL text for hand-picked covers. Recognize that format
  // during migration, but never associate unrelated cached bytes with new metadata.
  if (input.expectedHash && input.expectedHash !== digest &&
      input.expectedHash !== await sha256(new TextEncoder().encode(input.dataUrl))) return false;
  const previous = input.previousState?.[input.identity];
  const remote = input.remote;
  if (remote && (previous?.sha256 === digest ||
      (remote.capturedAt && (!input.capturedAt || Date.parse(remote.capturedAt) > Date.parse(input.capturedAt))))) return false;
  // assetId 标识「哪个资源的哪类图」这个槽位，与图片内容无关。
  // 一旦把内容哈希编进来，换封面就会生成新 assetId，云端既积压孤儿资产，
  // 又会因为同一资源绑定了两个 id 而彼此覆盖。
  const assetId = await stableAssetId(input.identity);
  await requireAssetConsent(input.owner);
  const upload = await cloudRequest<{
    uploadUrl: string;
    uploadId?: string;
    headers: Record<string, string>;
  }>("/v1/assets/upload", {
    method: "POST",
    body: JSON.stringify({
      assetId,
      operationId: crypto.randomUUID(),
      ...(input.writePreconditions ? { baseRevision: input.state[input.identity]?.revision || 0 } : {}),
      resourceKey: input.resourceKey,
      kind: input.kind,
      sha256: digest,
      byteSize: bytes.byteLength,
      width: cloudAssetDimension(input.width),
      height: cloudAssetDimension(input.height),
      mimeType,
      capturedAt: input.capturedAt,
      binding: input.binding
    })
  }, input.owner);
  const headers = new Headers(upload.headers);
  headers.delete("content-length");
  await requireAssetConsent(input.owner);
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers,
    body: new Blob([exactArrayBuffer(bytes)], { type: mimeType }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`图片上传失败（${response.status}）。`);
  await requireAssetConsent(input.owner);
  const completed = await cloudRequest<{ revision: number }>(
    `/v1/assets/${assetId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ operationId: crypto.randomUUID(), ...(upload.uploadId ? { uploadId: upload.uploadId, sha256: digest } : {}) })
    }, input.owner
  );
  input.state[input.identity] = { assetId, sha256: digest, revision: completed.revision };
  return true;
}

export async function syncCloudAssets(maxUploads = 12): Promise<{
  uploaded: number;
  processed: number;
  total: number;
  remaining: boolean;
}> {
  const owner = await cloudOwner();
  await requireAssetConsent(owner);
  const [resources, snapshots, brands, protectionSettings, tree, storedState] = await Promise.all([
    getLocalResources(),
    getPageSnapshots(),
    getSiteBrands(),
    getProtectionSettings(),
    chrome.bookmarks.getTree(),
    readState()
  ]);
  // 云端 active 列表才是当前账号的权威上传状态。登录流程会清理本机追踪，
  // 这里必须从远端哈希重新建账；否则退出后登录同一账号会重传全部图片。
  const remoteAssets = await cloudRequest<{ assets: CloudAssetDescriptor[]; writePreconditions?: boolean }>("/v1/assets");
  const state = reconcileCloudAssetState(storedState, remoteAssets.assets);
  const remoteByIdentity = new Map(remoteAssets.assets.map((asset) => [cloudAssetIdentity(asset), asset]));
  const uploadContext = (identity: string) => ({
    owner, state, previousState: storedState, remote: remoteByIdentity.get(identity), writePreconditions: remoteAssets.writePreconditions,
  });
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
      expectedHash: resource.coverContentHash,
      capturedAt: resource.coverUpdatedAt,
      binding: {
        canonicalUrl: resource.canonicalUrl,
        ...(resource.coverOrigin ? { coverOrigin: resource.coverOrigin } : {})
      },
      ...uploadContext(`cover:${resource.resourceKey}`)
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
      binding: { canonicalUrl: snapshot.canonicalUrl, coverOrigin: resourcesByKey.get(resourceKey)?.coverOrigin || "auto" },
      ...uploadContext(`snapshot:${resourceKey}`)
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
      capturedAt: brand.updatedAt,
      binding: {
        host: brand.host,
        iconRenderVersion: SITE_ICON_RENDER_VERSION,
        ...(brand.iconAssetUrl ? { iconAssetUrl: brand.iconAssetUrl } : {}),
      },
      ...uploadContext(`site-icon:${brand.host}`)
    }));
  }

  let uploaded = 0;
  let inspected = 0;
  for (const job of jobs) {
    if (uploaded >= maxUploads) break;
    if (await job()) {
      uploaded += 1;
    }
    inspected += 1;
  }
  // 对账结果需要持久化：服务器已删除资产的本地标记必须清掉，
  // 否则下一次同步仍然会误跳过。
  await writeState(state);
  return {
    uploaded,
    processed: inspected,
    total: jobs.length,
    remaining: inspected < jobs.length,
  };
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

export async function restoreCloudAssets(maxDownloads = 24): Promise<{
  restored: number;
  processed: number;
  total: number;
  remaining: boolean;
}> {
  const tracking = await readCloudResourceTracking();
  const response = await cloudRequest<{ assets: CloudAssetDescriptor[] }>("/v1/assets");
  const state = await readState();
  let restored = 0;
  let inspected = 0;
  for (const asset of response.assets) {
    if (restored >= maxDownloads) break;
    const identity = asset.kind === "site-icon"
      ? `site-icon:${asset.binding?.host || ""}`
      : `${asset.kind}:${asset.resourceKey}`;
    // 站点图标特殊处理：本地品牌记录没有“当前渲染版本”的图标字节时
    // 必须强制下载。此前版本升级清空了本地字节，而云端 state 仍记录
    // 相同哈希，通用跳过逻辑会让图标永远无法从云端拉回。
    if (asset.kind === "site-icon") {
      const localBrand = asset.binding?.host
        ? await getSiteBrand(asset.binding.host)
        : null;
      if (
        localBrand?.iconDataUrl &&
        localBrand.iconRenderVersion === SITE_ICON_RENDER_VERSION &&
        await dataUrlMatchesSha256(localBrand.iconDataUrl, asset.sha256)
      ) {
        inspected += 1;
        continue;
      }
    } else if (asset.kind === "snapshot" && asset.binding?.canonicalUrl) {
      const localSnapshot = await getPageSnapshot(asset.binding.canonicalUrl);
      if (
        localSnapshot &&
        await dataUrlMatchesSha256(localSnapshot.imageDataUrl, asset.sha256)
      ) {
        inspected += 1;
        continue;
      }
    } else if (asset.kind === "cover" || asset.kind === "user-cover") {
      const localResource = await getLocalResource(asset.resourceKey);
      if (
        localResource?.thumbnailDataUrl &&
        await dataUrlMatchesSha256(localResource.thumbnailDataUrl, asset.sha256)
      ) {
        inspected += 1;
        continue;
      }
    }
    const bytes = await downloadAsset(asset);
    const dataUrl = bytesDataUrl(bytes, asset.mimeType);
    const applied = await commitDownloadedAsset(asset, dataUrl, tracking.generation);
    if (!applied) { inspected += 1; continue; }
    state[identity] = { assetId: asset.assetId, sha256: asset.sha256, revision: asset.revision };
    restored += 1;
    inspected += 1;
  }
  if (restored) await writeState(state);
  return {
    restored,
    processed: inspected,
    total: response.assets.length,
    remaining: inspected < response.assets.length,
  };
}
