import { registrableHost } from "../../lib/cover-registry";
import type { SiteBrandRecord } from "../../lib/types";

export function displayDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function displayTimestamp(value?: number): string {
  if (!value) return "从未记录到通过书签打开";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function brandForUrl(
  brands: Map<string, SiteBrandRecord>,
  input: string
): SiteBrandRecord | undefined {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return brands.get(host) || brands.get(registrableHost(host));
  } catch {
    return undefined;
  }
}
