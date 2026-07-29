import { Readability } from "@mozilla/readability";
import type { PageCapture } from "../lib/types";
import { canonicalizeUrl } from "../lib/url";

const MAX_CONTENT_LENGTH = 80_000;
const MAX_SELECTION_LENGTH = 4_000;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function metaContent(document: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = document.querySelector<HTMLMetaElement>(selector)?.content;
    if (value?.trim()) {
      return normalizeText(value);
    }
  }
  return "";
}

function absoluteUrl(value: string, pageUrl: string): string {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return "";
  }
}

export interface ExtractPageOptions {
  pageUrl: string;
  selectedText?: string;
}

export function extractPage(
  document: Document,
  options: ExtractPageOptions
): PageCapture {
  const pageUrl = options.pageUrl;
  const clone = document.cloneNode(true) as Document;

  clone
    .querySelectorAll(
      "script, style, noscript, template, form, input, textarea, select, button, nav, footer, [aria-hidden='true']"
    )
    .forEach((node) => node.remove());

  let readable:
    | {
        title?: string | null;
        textContent?: string | null;
        excerpt?: string | null;
        byline?: string | null;
        siteName?: string | null;
        lang?: string | null;
      }
    | null = null;

  try {
    readable = new Readability(clone, {
      charThreshold: 80,
      keepClasses: false
    }).parse();
  } catch {
    readable = null;
  }

  const canonicalLink =
    document
      .querySelector<HTMLLinkElement>("link[rel='canonical']")
      ?.href.trim() || "";
  const canonicalUrl = canonicalizeUrl(pageUrl, canonicalLink);

  const title =
    normalizeText(
      metaContent(document, [
        "meta[property='og:title']",
        "meta[name='twitter:title']"
      ]) ||
        readable?.title ||
        document.title
    ) || new URL(pageUrl).hostname;

  const description = normalizeText(
    metaContent(document, [
      "meta[name='description']",
      "meta[property='og:description']",
      "meta[name='twitter:description']"
    ]) ||
      readable?.excerpt ||
      ""
  );

  const fallbackContent = normalizeText(
    document.querySelector("main, article")?.textContent ||
      document.body?.textContent ||
      ""
  );
  const content = normalizeText(readable?.textContent || fallbackContent).slice(
    0,
    MAX_CONTENT_LENGTH
  );

  const selectedText = normalizeText(options.selectedText || "").slice(
    0,
    MAX_SELECTION_LENGTH
  );

  const imageUrl = absoluteUrl(
    metaContent(document, [
      "meta[property='og:image']",
      "meta[name='twitter:image']"
    ]),
    pageUrl
  );

  const faviconHref =
    document.querySelector<HTMLLinkElement>(
      "link[rel~='icon'], link[rel='shortcut icon']"
    )?.href || "";

  return {
    url: pageUrl,
    canonicalUrl,
    title,
    description,
    content,
    excerpt: (description || content).slice(0, 500),
    selectedText,
    author: normalizeText(
      readable?.byline ||
        metaContent(document, [
          "meta[name='author']",
          "meta[property='article:author']"
        ])
    ),
    siteName: normalizeText(
      readable?.siteName ||
        metaContent(document, ["meta[property='og:site_name']"]) ||
        new URL(pageUrl).hostname
    ),
    language:
      readable?.lang ||
      document.documentElement.lang ||
      metaContent(document, ["meta[property='og:locale']"]),
    imageUrl,
    faviconUrl: absoluteUrl(faviconHref || "/favicon.ico", pageUrl)
  };
}
