import type { DisplaySettings } from "./display-settings";
import { isSnapshotSensitiveUrl } from "./page-snapshot";
import type { SiteIconCandidate } from "./types";

type PublicFaviconSettings = Pick<
  DisplaySettings,
  "publicFaviconFallback" | "snapshotExcludedHosts"
>;

/**
 * 公共服务只能看到域名，不能收到完整 URL；敏感站点和用户排除项始终
 * 返回空列表。调用方必须先穷尽站点自身候选，避免不必要的第三方请求。
 */
export function publicFaviconCandidates(
  input: string,
  settings: PublicFaviconSettings
): SiteIconCandidate[] {
  if (!settings.publicFaviconFallback) return [];
  if (isSnapshotSensitiveUrl(input, settings.snapshotExcludedHosts)) return [];

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    const host = parsed.hostname.toLocaleLowerCase().replace(/\.$/, "");
    if (!host) return [];
    return [
      {
        url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
        source: "public-service",
        declaredSize: 128
      },
      {
        url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
        source: "public-service"
      }
    ];
  } catch {
    return [];
  }
}
