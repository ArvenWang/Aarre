import { database } from "./storage";
import { getAgentConversations } from "./conversations";
import { getDisplaySettings } from "./display-settings";
import { getProtectionSettings } from "./protection";
import { dataUrlToBlob, hashImageDataUrl } from "./visuals";
import type { AgentConversation, NativeBookmarkNode, PageSnapshot, ResourceRecord, SiteBrandRecord, VisualAsset } from "./types";

export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export interface ArchiveVisual extends Omit<VisualAsset, "blob"> { dataUrl: string }
export interface ArchivePayload {
  bookmarks: NativeBookmarkNode[];
  resources: ResourceRecord[];
  pageSnapshots: PageSnapshot[];
  siteBrands: SiteBrandRecord[];
  visuals: ArchiveVisual[];
  conversations: AgentConversation[];
  display: Awaited<ReturnType<typeof getDisplaySettings>>;
  protection: Awaited<ReturnType<typeof getProtectionSettings>>;
}
export interface AarreArchive {
  format: "aarre-data-export"; schemaVersion: 2; appVersion: string; exportedAt: string;
  privacy: { includesApiKeys: false; includesCloudTokens: false; includesLocalPageSnapshots: true };
  data: ArchivePayload;
  integrity: { algorithm: "SHA-256"; payload: string; images: Record<string, string> };
}
export interface ArchivePreview { bookmarks: number; folders: number; resources: number; images: number; conversations: number; duplicateUrls: number; unsupportedUrls: number }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item ?? null)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function archiveHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function archiveUrlSupported(url: string): boolean {
  try { return ["https:", "http:", "ftp:", "file:", "chrome:", "about:"].includes(new URL(url).protocol); } catch { return false; }
}
function imageEntries(data: ArchivePayload): Array<[string, string]> {
  return [
    ...data.resources.flatMap((item, index) => item.thumbnailDataUrl ? [[`resources/${index}`, item.thumbnailDataUrl] as [string,string]] : []),
    ...data.pageSnapshots.map((item, index) => [`snapshots/${index}`, item.imageDataUrl] as [string,string]),
    ...data.siteBrands.flatMap((item, index) => ["iconDataUrl", "iconDataUrlLight", "iconDataUrlDark"].flatMap((key) => (item as any)[key] ? [[`brands/${index}/${key}`, (item as any)[key]] as [string,string]] : [])),
    ...data.visuals.map((item, index) => [`visuals/${index}`, item.dataUrl] as [string,string]),
  ];
}
async function blobUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
function bookmarkData(node: chrome.bookmarks.BookmarkTreeNode): NativeBookmarkNode {
  return { id: node.id, title: node.title, ...(node.url ? { url: node.url } : {}), ...(node.dateAdded ? { dateAdded: node.dateAdded } : {}),
    ...((node as any).folderType ? { folderType: (node as any).folderType } : {}), ...(node.children ? { children: node.children.map(bookmarkData) } : {}) };
}
export async function createArchive(): Promise<AarreArchive> {
  const db = await database();
  const transaction = db.transaction(["resources", "pageSnapshots", "siteBrands", "visuals"]);
  const [resources, pageSnapshots, siteBrands, visuals] = await Promise.all([
    transaction.objectStore("resources").getAll(), transaction.objectStore("pageSnapshots").getAll(),
    transaction.objectStore("siteBrands").getAll(), transaction.objectStore("visuals").getAll(),
  ]);
  await transaction.done;
  const [tree, conversations, display, protection] = await Promise.all([chrome.bookmarks.getTree(), getAgentConversations(), getDisplaySettings(), getProtectionSettings()]);
  const liveIds = new Set<string>();
  const visit = (node: chrome.bookmarks.BookmarkTreeNode) => { liveIds.add(node.id); node.children?.forEach(visit); };
  tree.forEach(visit);
  const data: ArchivePayload = {
    bookmarks: tree.map(bookmarkData), resources: resources.filter((resource) => !resource.deletedAt).map((resource) => ({ ...resource, nativeBookmarkIds: resource.nativeBookmarkIds.filter((id) => liveIds.has(id)) })), pageSnapshots, siteBrands,
    visuals: await Promise.all(visuals.map(async ({ blob, ...item }) => ({ ...item, dataUrl: await blobUrl(blob) }))), conversations, display, protection,
  };
  const images: Record<string, string> = {};
  for (const [key, url] of imageEntries(data)) images[key] = await hashImageDataUrl(url);
  return { format: "aarre-data-export", schemaVersion: 2, exportedAt: new Date().toISOString(), appVersion: chrome.runtime.getManifest().version,
    privacy: { includesApiKeys: false, includesCloudTokens: false, includesLocalPageSnapshots: true }, data,
    integrity: { algorithm: "SHA-256", payload: await archiveHash(data), images } };
}
function object(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
const validDate = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
export async function parseArchive(text: string): Promise<{ archive: AarreArchive; preview: ArchivePreview }> {
  if (new Blob([text]).size > MAX_ARCHIVE_BYTES) throw new Error("备份超过 512 MB，请分批整理后再导出。");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("文件不是有效的 JSON 备份。"); }
  if (!object(value) || value.format !== "aarre-data-export") throw new Error("请选择 Aarre 导出的备份文件。");
  if (value.schemaVersion === 1) throw new Error("这是旧版数据导出，缺少完整书签目录。请用原设备升级到 0.6.0 后重新导出；原文件未被修改。");
  if (value.schemaVersion !== 2 || !object(value.data) || !object(value.integrity) || value.integrity.algorithm !== "SHA-256") throw new Error("不支持此备份格式或校验信息缺失。");
  if (!validDate(value.exportedAt) || typeof value.appVersion !== "string") throw new Error("备份日期或版本无效。");
  const data = value.data;
  for (const key of ["bookmarks", "resources", "pageSnapshots", "siteBrands", "visuals", "conversations"]) {
    if (!Array.isArray(data[key]) || data[key].length > 50_000) throw new Error("备份结构或数据数量无效。");
  }
  if (!object(data.display) || !object(data.protection) || !Array.isArray(data.protection.resourceKeys) || !Array.isArray(data.protection.folderIds)) throw new Error("备份设置结构无效。");
  if (await archiveHash(data) !== value.integrity.payload) throw new Error("备份校验失败，文件可能不完整或已被修改。");
  const preview: ArchivePreview = { bookmarks: 0, folders: 0, resources: data.resources.length, images: 0, conversations: data.conversations.length, duplicateUrls: 0, unsupportedUrls: 0 };
  const ids = new Set<string>(), urls = new Set<string>();
  function visit(node: unknown, depth: number) {
    if (!object(node) || typeof node.id !== "string" || !node.id || ["__proto__", "constructor", "prototype"].includes(node.id) || ids.has(node.id) || typeof node.title !== "string" || depth > 100 || ids.size >= 50_000) throw new Error("书签目录无效、重复或层级过深。");
    ids.add(node.id);
    if (node.url !== undefined) {
      if (typeof node.url !== "string" || node.children?.length) throw new Error("书签网址结构无效。");
      preview.bookmarks++;
      if (urls.has(node.url)) preview.duplicateUrls++; urls.add(node.url);
      if (!archiveUrlSupported(node.url)) preview.unsupportedUrls++;
    } else {
      if (!Array.isArray(node.children)) throw new Error("文件夹内容缺失。");
      if (depth > 0) preview.folders++;
      node.children.forEach((child: unknown) => visit(child, depth + 1));
    }
  }
  data.bookmarks.forEach((node: unknown) => visit(node, 0));
  const resourceKeys = new Set<string>();
  for (const resource of data.resources) {
    if (!object(resource) || typeof resource.resourceKey !== "string" || !resource.resourceKey || resourceKeys.has(resource.resourceKey) || typeof resource.url !== "string" || typeof resource.canonicalUrl !== "string" || !Array.isArray(resource.nativeBookmarkIds) || !validDate(resource.updatedAt)) throw new Error("收藏记录结构无效。");
    resourceKeys.add(resource.resourceKey);
    if (resource.nativeBookmarkIds.some((id: unknown) => typeof id !== "string" || !ids.has(id))) throw new Error("收藏与书签目录不匹配，请在原设备刷新收藏库后重新导出。");
  }
  for (const item of data.pageSnapshots) if (!object(item) || typeof item.canonicalUrl !== "string" || !validDate(item.capturedAt) || !(item.width > 0 && item.height > 0)) throw new Error("快照记录无效。");
  for (const item of data.siteBrands) if (!object(item) || typeof item.host !== "string" || !validDate(item.updatedAt)) throw new Error("网站图标记录无效。");
  for (const item of data.visuals) if (!object(item) || !["cover", "site-icon"].includes(item.kind) || item.key !== `${item.kind}:${item.identity}` || !validDate(item.updatedAt) || !["auto", "user"].includes(item.origin)) throw new Error("视觉资产记录无效。");
  for (const conversation of data.conversations) if (!object(conversation) || typeof conversation.id !== "string" || typeof conversation.title !== "string" || !validDate(conversation.updatedAt) || !Array.isArray(conversation.messages) || conversation.messages.some((m: any) => !object(m) || !["user","assistant"].includes(m.role) || typeof m.content !== "string")) throw new Error("AI 会话记录无效。");
  if ([...data.protection.resourceKeys, ...data.protection.folderIds].some((id) => typeof id !== "string")) throw new Error("隐私保护规则无效。");
  const images = imageEntries(data as ArchivePayload);
  if (!object(value.integrity.images) || Object.keys(value.integrity.images).length !== images.length) throw new Error("图片校验清单不完整。");
  for (const [key, url] of images) {
    if (typeof url !== "string" || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 48 * 1024 * 1024) throw new Error("备份含有不支持或过大的图片。");
    if (await hashImageDataUrl(url) !== value.integrity.images[key]) throw new Error("图片内容校验失败，已停止恢复。");
    // Validate the binary data URL representation; image rendering is verified separately.
    dataUrlToBlob(url);
  }
  preview.images = images.length;
  return { archive: value as AarreArchive, preview };
}
