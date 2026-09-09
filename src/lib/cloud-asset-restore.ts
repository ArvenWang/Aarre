import { database } from "./storage";
import { dataUrlToBlob } from "./visuals";
import { SITE_ICON_RENDER_VERSION } from "./thumbnail";
import type { CloudAssetDescriptor } from "./cloud-assets";
import type { CloudResourceTracking } from "./cloud-resource-store";

/** Apply a verified download to the latest local rows, together with its binary asset. */
export async function commitDownloadedAsset(asset: CloudAssetDescriptor, dataUrl: string, generation: string): Promise<boolean> {
  const blob = dataUrlToBlob(dataUrl).blob;
  const db = await database();
  const transaction = db.transaction(["resources","pageSnapshots","siteBrands","visuals","syncMetadata"], "readwrite");
  const tracking = await transaction.objectStore("syncMetadata").get("cloud-resources:v2") as CloudResourceTracking | undefined;
  if (tracking?.generation !== generation) { await transaction.done; throw new Error("云端账号已变化，已忽略旧图片下载。"); }
  const updatedAt = asset.capturedAt || new Date().toISOString();
  if (asset.kind === "site-icon") {
    const host = asset.binding?.host;
    if (!host) { await transaction.done; return false; }
    const current = await transaction.objectStore("siteBrands").get(host);
    if (current?.iconDataUrlLight && asset.capturedAt && current.updatedAt > updatedAt) { await transaction.done; return false; }
    const next = { ...current, host, iconDataUrl: dataUrl, iconDataUrlLight: dataUrl, iconRenderVersion: SITE_ICON_RENDER_VERSION, iconAssetUrl: asset.binding?.iconAssetUrl, updatedAt };
    await transaction.objectStore("siteBrands").put(next);
    await transaction.objectStore("visuals").put({ key:`site-icon:${host}`,kind:"site-icon",identity:host,blob,mime:blob.type,width:asset.width||0,height:asset.height||0,origin:"auto",source:"cloud-site-icon",contentHash:asset.sha256,renderVersion:SITE_ICON_RENDER_VERSION,updatedAt });
  } else {
    const resource = await transaction.objectStore("resources").get(asset.resourceKey);
    if (!resource || resource.deletedAt) { await transaction.done; return false; }
    const visual = await transaction.objectStore("visuals").get(`cover:${asset.resourceKey}`);
    const remoteUser = asset.kind === "user-cover" || asset.binding?.coverOrigin === "user";
    const localUser = resource.coverOrigin === "user" || visual?.origin === "user";
    const newer = asset.capturedAt && ((resource.thumbnailDataUrl && resource.coverUpdatedAt && resource.coverUpdatedAt > updatedAt) || (visual && visual.updatedAt > updatedAt));
    if ((localUser && !remoteUser) || newer) { await transaction.done; return false; }
    if (asset.kind === "snapshot") {
      const url = asset.binding?.canonicalUrl;
      if (!url || url !== resource.canonicalUrl) { await transaction.done; return false; }
      const snapshot = await transaction.objectStore("pageSnapshots").get(url);
      if (snapshot && (!asset.capturedAt || snapshot.capturedAt > updatedAt)) { await transaction.done; return false; }
      await transaction.objectStore("pageSnapshots").put({canonicalUrl:url,imageDataUrl:dataUrl,width:asset.width||1,height:asset.height||1,capturedAt:updatedAt});
    }
    const origin = remoteUser ? "user" : "auto";
    await transaction.objectStore("visuals").put({key:`cover:${asset.resourceKey}`,kind:"cover",identity:asset.resourceKey,blob,mime:blob.type,width:asset.width||0,height:asset.height||0,origin,source:`cloud-${asset.kind}`,contentHash:asset.sha256,updatedAt,renderVersion:1});
    // Do not call whole-record upsert with the pre-download row: notes may have changed meanwhile.
    await transaction.objectStore("resources").put({...resource,thumbnailDataUrl:dataUrl,coverContentHash:asset.sha256,coverOrigin:origin,coverUpdatedAt:updatedAt,...(asset.kind === "snapshot" ? {snapshotAt:updatedAt} : {})});
  }
  await transaction.done;
  return true;
}
