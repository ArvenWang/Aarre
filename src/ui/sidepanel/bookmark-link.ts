import { canonicalizeUrl } from "../../lib/url";
import type { BookmarkAgentSource } from "../../lib/types";

export function bookmarkSourceForUrl(
  sources: BookmarkAgentSource[] | undefined,
  url: string,
): BookmarkAgentSource | undefined {
  const direct = (sources || []).find((source) => source.url === url);
  if (direct) return direct;
  try {
    const canonical = canonicalizeUrl(url);
    return (sources || []).find((source) => {
      try {
        return canonicalizeUrl(source.url) === canonical;
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
}
