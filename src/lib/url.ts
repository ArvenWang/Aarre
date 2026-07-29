const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^mc_(cid|eid)$/i,
  /^vero_(id|conv)$/i
];

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "igshid",
  "yclid",
  "_hsenc",
  "_hsmi",
  "ref_src"
]);

export function canonicalizeUrl(input: string, declaredCanonical?: string): string {
  const candidate = declaredCanonical?.trim() || input.trim();
  let url = new URL(candidate, input);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    url = new URL(input);
  }

  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  for (const key of [...url.searchParams.keys()]) {
    if (
      TRACKING_PARAMS.has(key.toLowerCase()) ||
      TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))
    ) {
      url.searchParams.delete(key);
    }
  }

  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  if (url.hash && !url.hash.startsWith("#/") && !url.hash.startsWith("#!")) {
    url.hash = "";
  }

  return url.toString();
}

export async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function resourceKeyForUrl(url: string): Promise<string> {
  return hashText(canonicalizeUrl(url));
}

export function isSupportedPageUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}
