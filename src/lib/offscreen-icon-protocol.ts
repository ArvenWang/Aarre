import type { CachedSiteIcon } from "./thumbnail";

export const OFFSCREEN_SITE_ICON_TARGET = "aarre-offscreen-site-icon";
export const OFFSCREEN_SITE_ICON_REQUEST = "AARRE_DECODE_SITE_ICON";
export const OFFSCREEN_SITE_ICON_RESPONSE = "AARRE_DECODE_SITE_ICON_RESULT";

export interface OffscreenSiteIconRequest {
  type: typeof OFFSCREEN_SITE_ICON_REQUEST;
  target: typeof OFFSCREEN_SITE_ICON_TARGET;
  requestId: string;
  dataUrl: string;
  vector: boolean;
  nativeWidth?: number;
  nativeHeight?: number;
}

export interface OffscreenSiteIconResponse {
  type: typeof OFFSCREEN_SITE_ICON_RESPONSE;
  target: typeof OFFSCREEN_SITE_ICON_TARGET;
  requestId: string;
  ok: boolean;
  result?: CachedSiteIcon;
  error?: string;
}

export function isOffscreenSiteIconRequest(
  value: unknown
): value is OffscreenSiteIconRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OffscreenSiteIconRequest>;
  return (
    record.type === OFFSCREEN_SITE_ICON_REQUEST &&
    record.target === OFFSCREEN_SITE_ICON_TARGET &&
    typeof record.requestId === "string" &&
    typeof record.dataUrl === "string" &&
    typeof record.vector === "boolean"
  );
}

export function isOffscreenSiteIconResponse(
  value: unknown,
  requestId: string
): value is OffscreenSiteIconResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OffscreenSiteIconResponse>;
  return (
    record.type === OFFSCREEN_SITE_ICON_RESPONSE &&
    record.target === OFFSCREEN_SITE_ICON_TARGET &&
    record.requestId === requestId &&
    typeof record.ok === "boolean"
  );
}
