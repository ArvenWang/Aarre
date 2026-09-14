import { defaultFloatingPosition, type FloatingPosition } from "./floating-geometry";
export const FLOATING_SETTINGS_KEY = "aarre:floating-settings:v1";
export interface FloatingSettings { enabled: boolean; hiddenHosts: string[]; position: FloatingPosition }
export function normalizeFloatingSettings(raw: unknown): FloatingSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<FloatingSettings>;
  const p = value.position;
  return { enabled: value.enabled !== false,
    hiddenHosts: Array.isArray(value.hiddenHosts) ? [...new Set(value.hiddenHosts.filter((host) => typeof host === "string" && /^[a-z0-9.:-]+$/i.test(host)))].slice(0, 500) : [],
    // The new ratio is vertical-only; legacy edge coordinates and height stay ignored.
    position: { width: Number.isFinite(p?.width) ? Math.max(320, Math.min(640, p!.width)) : defaultFloatingPosition.width,
      ...(typeof p?.handleRatio === "number" && Number.isFinite(p.handleRatio) ? { handleRatio: Math.max(0, Math.min(1, p.handleRatio)) } : {}) } };
}
export async function getFloatingSettings(): Promise<FloatingSettings> {
  return normalizeFloatingSettings((await chrome.storage.local.get(FLOATING_SETTINGS_KEY))[FLOATING_SETTINGS_KEY]);
}
export async function saveFloatingSettings(settings: FloatingSettings): Promise<FloatingSettings> {
  const next = normalizeFloatingSettings(settings);
  await chrome.storage.local.set({ [FLOATING_SETTINGS_KEY]: next });
  return next;
}
