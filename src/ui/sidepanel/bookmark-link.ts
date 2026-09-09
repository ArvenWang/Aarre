import { canonicalizeUrl } from "../../lib/url";
import { registrableHost } from "../../lib/cover-registry";
import type { ResourceRecord, SiteBrandRecord, BookmarkAgentSource } from "../../lib/types";

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

export function resourceForUrl(resourceByUrl: Map<string, ResourceRecord>, url: string) {
  const direct = resourceByUrl.get(url);
  if (direct) return direct;
  try { return resourceByUrl.get(canonicalizeUrl(url)); } catch { return undefined; }
}

export function siteBrandForUrl(siteBrandByHost: Map<string, SiteBrandRecord>, input: string) {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return siteBrandByHost.get(host) || siteBrandByHost.get(registrableHost(host));
  } catch { return undefined; }
}
