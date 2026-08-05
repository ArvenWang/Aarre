import type {
  PageEssence,
  SiteIconCandidate,
  SiteIconSource
} from "./types";
import { registrableHost } from "./cover-registry";

const MAX_HTML_LENGTH = 600_000;

function decodeHtml(value: string): string {
  if (typeof DOMParser === "undefined") {
    return value
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }
  const doc = new DOMParser().parseFromString(value, "text/html");
  return doc.documentElement.textContent || "";
}

function compact(value: string, limit: number): string {
  return decodeHtml(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstTag(html: string, tag: string, limit: number): string {
  const match = html.match(
    new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, "i")
  );
  return compact(match?.[1]?.replace(/<[^>]+>/g, " ") || "", limit);
}

function allTags(
  html: string,
  tag: string,
  limit: number,
  count: number
): string[] {
  const pattern = new RegExp(
    `<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`,
    "gi"
  );
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const value = compact(match[1]?.replace(/<[^>]+>/g, " ") || "", limit);
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= count) break;
  }
  return values;
}

function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const patterns = [
      new RegExp(
        `<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`,
        "i"
      ),
      new RegExp(
        `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`,
        "i"
      )
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return compact(match[1], 500);
    }
  }
  return "";
}

function absoluteUrl(value: string, pageUrl: string): string {
  if (!value) return "";
  try {
    const resolved = new URL(value, pageUrl);
    return ["http:", "https:", "data:"].includes(resolved.protocol)
      ? resolved.toString()
      : "";
  } catch {
    return "";
  }
}

/**
 * 页面声明的图标必须与当前站点同可注册域，或为 data:。
 * 否则停放页/注入脚本里的第三方图标（例如搜狗导航）会被当成该站标识缓存。
 */
export function isAcceptableSiteIconUrl(href: string, pageUrl: string): boolean {
  try {
    const icon = new URL(href);
    if (icon.protocol === "data:") return true;
    if (icon.protocol !== "http:" && icon.protocol !== "https:") return false;
    const page = new URL(pageUrl);
    return (
      registrableHost(icon.hostname) === registrableHost(page.hostname)
    );
  } catch {
    return false;
  }
}

function attribute(tag: string, name: string): string {
  const escaped = escapeRegExp(name);
  const quoted = tag.match(
    new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, "i")
  )?.[1];
  if (quoted !== undefined) return compact(quoted, 2_000);
  return compact(
    tag.match(new RegExp(`\\b${escaped}\\s*=\\s*([^\\s>]+)`, "i"))?.[1] || "",
    2_000
  );
}

function linkHref(html: string, relName: string): string {
  for (const match of html.matchAll(/<link\s+[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, "rel").toLowerCase().split(/\s+/);
    if (!rel.includes(relName)) continue;
    const href = attribute(tag, "href");
    if (href) return href;
  }
  return "";
}

function faviconHref(html: string): string {
  for (const match of html.matchAll(/<link\s+[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, "rel").toLowerCase();
    if (!rel.split(/\s+/).some((value) => value === "icon")) continue;
    const href = attribute(tag, "href");
    if (href) return compact(href, 500);
  }
  return "";
}

function declaredIconSize(tag: string): number | undefined {
  const sizes = attribute(tag, "sizes").toLowerCase();
  const values = [...sizes.matchAll(/(\d+)\s*x\s*(\d+)/g)]
    .map((match) => Math.min(Number(match[1]), Number(match[2])))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : undefined;
}

function iconCandidates(
  html: string,
  pageUrl: string
): SiteIconCandidate[] {
  const apple: SiteIconCandidate[] = [];
  const svg: SiteIconCandidate[] = [];
  const bitmap: SiteIconCandidate[] = [];
  for (const match of html.matchAll(/<link\s+[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, "rel").toLowerCase().split(/\s+/);
    const href = absoluteUrl(attribute(tag, "href"), pageUrl);
    if (!href || !isAcceptableSiteIconUrl(href, pageUrl)) continue;
    const declaredSize = declaredIconSize(tag);
    const candidate = (
      source: SiteIconSource,
      vector = false
    ): SiteIconCandidate => ({
      url: href,
      source,
      ...(declaredSize ? { declaredSize } : {}),
      ...(vector ? { vector: true } : {})
    });
    if (
      rel.includes("apple-touch-icon") ||
      rel.includes("apple-touch-icon-precomposed")
    ) {
      apple.push(candidate("apple-touch-icon"));
      continue;
    }
    if (!rel.includes("icon")) continue;
    const vector =
      attribute(tag, "type").toLowerCase() === "image/svg+xml" ||
      /\.svg(?:[?#]|$)/i.test(href);
    if (vector) {
      svg.push(candidate("svg-icon", true));
    } else if (!declaredSize || declaredSize >= 128) {
      bitmap.push(candidate("large-icon"));
    }
  }
  const sortLargest = (
    left: SiteIconCandidate,
    right: SiteIconCandidate
  ) => (right.declaredSize || 0) - (left.declaredSize || 0);
  const tileUrl = absoluteUrl(
    metaContent(html, ["msapplication-TileImage"]),
    pageUrl
  );
  return [
    ...apple.sort(sortLargest),
    ...svg.sort(sortLargest),
    ...bitmap.sort(sortLargest),
    ...(tileUrl && isAcceptableSiteIconUrl(tileUrl, pageUrl)
      ? [
          {
            url: tileUrl,
            source: "msapplication-tile" as const
          }
        ]
      : [])
  ];
}

function jsonLdImages(html: string): string[] {
  const images: string[] = [];
  const visit = (value: unknown, imageContext = false): void => {
    if (typeof value === "string") {
      if (imageContext && value.trim()) images.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, imageContext);
      return;
    }
    if (!value || typeof value !== "object") return;
    const entries = Object.entries(value);
    if (imageContext) {
      for (const [key, item] of entries) {
        if (
          ["url", "contenturl", "thumbnailurl", "image"].includes(
            key.toLowerCase()
          )
        ) {
          visit(item, true);
        }
      }
      return;
    }
    for (const [key, item] of entries) {
      if (
        ["image", "thumbnailurl", "contenturl"].includes(key.toLowerCase())
      ) {
        visit(item, true);
      } else {
        visit(item, false);
      }
    }
  };

  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      visit(JSON.parse(match[1] || ""));
    } catch {
      // 单个站点的无效 JSON-LD 不应阻断其他代表图候选。
    }
    if (images.length >= 12) break;
  }
  return [...new Set(images)].slice(0, 12);
}

function largestSrcsetUrl(value: string): string {
  let best = "";
  let bestWidth = 0;
  for (const candidate of value.split(",")) {
    const [url, descriptor = ""] = candidate.trim().split(/\s+/);
    if (!url) continue;
    const width = Number.parseFloat(descriptor) || 1;
    if (width >= bestWidth) {
      best = url;
      bestWidth = width;
    }
  }
  return best;
}

function bodyImage(html: string): string {
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  let index = 0;

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const rawUrl =
      largestSrcsetUrl(
        attribute(tag, "srcset") ||
          attribute(tag, "data-srcset")
      ) ||
      attribute(tag, "src") ||
      attribute(tag, "data-src") ||
      attribute(tag, "data-original") ||
      attribute(tag, "data-lazy-src");
    if (!rawUrl) continue;

    const width = Number.parseInt(attribute(tag, "width"), 10) || 0;
    const height = Number.parseInt(attribute(tag, "height"), 10) || 0;
    if ((width > 0 && width < 180) || (height > 0 && height < 100)) {
      continue;
    }

    const context = [
      rawUrl,
      attribute(tag, "alt"),
      attribute(tag, "class"),
      attribute(tag, "id")
    ]
      .join(" ")
      .toLowerCase();
    if (
      /\b(logo|icon|avatar|emoji|sprite|badge|favicon|pixel|tracker|tracking|qr)\b/.test(
        context
      )
    ) {
      continue;
    }

    let score = 10 - Math.min(index, 20) * 0.18;
    index += 1;
    if (
      /\b(hero|cover|thumbnail|featured|article|post|preview|screenshot|banner|card)\b/.test(
        context
      )
    ) {
      score += 24;
    }
    if (width >= 600) score += 14;
    else if (width >= 320) score += 8;
    if (height >= 300) score += 10;
    else if (height >= 180) score += 5;
    if (width && height) {
      const ratio = width / height;
      if (ratio >= 1.15 && ratio <= 2.4) score += 8;
      if (ratio > 4 || ratio < 0.35) score -= 16;
    }

    if (score > bestScore) {
      best = rawUrl;
      bestScore = score;
    }
  }
  return best;
}

function githubRepositoryImage(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      return "";
    }
    const [owner, rawRepository] = url.pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 2);
    const reservedOwners = new Set([
      "about",
      "apps",
      "collections",
      "codespaces",
      "enterprise",
      "events",
      "explore",
      "features",
      "issues",
      "login",
      "marketplace",
      "new",
      "notifications",
      "orgs",
      "organizations",
      "pricing",
      "search",
      "settings",
      "signup",
      "site",
      "sponsors",
      "topics",
      "users"
    ]);
    if (!owner || !rawRepository || reservedOwners.has(owner.toLowerCase())) {
      return "";
    }
    const repository = rawRepository.replace(/\.git$/i, "");
    if (!repository) return "";
    return `https://opengraph.githubassets.com/aarre/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  } catch {
    return "";
  }
}

function representativeImage(html: string, pageUrl: string): string {
  const candidates = [
    metaContent(html, [
      "og:image:secure_url",
      "og:image",
      "twitter:image",
      "twitter:image:src"
    ]),
    githubRepositoryImage(pageUrl),
    linkHref(html, "image_src"),
    ...jsonLdImages(html),
    bodyImage(html)
  ];
  for (const candidate of candidates) {
    const resolved = absoluteUrl(candidate, pageUrl);
    if (resolved) return resolved;
  }
  return "";
}

export function extractPageEssenceFromHtml(
  html: string,
  url: string
): PageEssence {
  const source = html.slice(0, MAX_HTML_LENGTH);
  let pathTokens: string[] = [];
  try {
    pathTokens = new URL(url).pathname
      .split(/[\/_-]+/)
      .map((item) => decodeURIComponent(item).trim())
      .filter((item) => item.length > 1)
      .slice(0, 8);
  } catch {
    // Invalid URLs are already rejected before a scan starts.
  }

  return {
    description: metaContent(source, [
      "description",
      "og:description",
      "twitter:description"
    ]),
    siteName: metaContent(source, ["og:site_name", "application-name"]),
    imageUrl: representativeImage(source, url),
    faviconUrl: absoluteUrl(faviconHref(source), url),
    manifestUrl: absoluteUrl(linkHref(source, "manifest"), url),
    siteIconCandidates: iconCandidates(source, url),
    keywords: metaContent(source, ["keywords"])
      .split(/[,，、|]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12),
    ogType: metaContent(source, ["og:type"]),
    h1: firstTag(source, "h1", 260),
    h2: allTags(source, "h2", 180, 5),
    firstParagraph: firstTag(source, "p", 700),
    pathTokens
  };
}

export function isInternalOrSensitiveUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (url.username || url.password) return true;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.endsWith(".home") ||
      host.endsWith(".corp") ||
      host.endsWith(".oa.com") ||
      host.endsWith(".woa.com") ||
      host.endsWith(".tencent.com")
    ) {
      return true;
    }
    return (
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return true;
  }
}
