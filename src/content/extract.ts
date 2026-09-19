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

// Copy only readable DOM, in short slices. An infinite feed must not first
// duplicate all scripts, SVG paths and extension interfaces into memory.
async function readableDocument(source: Document, pageUrl: string) {
  const originalUrl = source.URL;
  const clone = source.implementation.createHTMLDocument(source.title);
  clone.documentElement.lang = source.documentElement.lang;
  const base = clone.createElement("base"); base.href = source.baseURI || pageUrl; clone.head.append(base);
  for (const meta of source.head?.querySelectorAll("meta") ?? []) clone.head.append(clone.importNode(meta, false));
  if (!source.body) return clone;
  const excluded = "script,style,noscript,template,svg,canvas,iframe,form,input,textarea,select,button,nav,footer,[aria-hidden='true'],aarre-floating-host,[data-aarre-ui],#nexcatcher-ui-host,[data-layerscope-canvas-toolbar]";
  // A feed can contain many article siblings; selecting its first article
  // would discard the rest before Readability gets a chance to rank it.
  const sourceRoot = source.querySelector("main") || source.body;
  const contentRoot = sourceRoot === source.body ? clone.body : clone.body.appendChild(clone.importNode(sourceRoot, false));
  const walker = source.createTreeWalker(sourceRoot, 5, { acceptNode: node => node.nodeType === 1 && (node as Element).matches(excluded) ? 2 : 1 });
  const parents = new WeakMap<Node, Node>([[sourceRoot, contentRoot]]);
  let nodes = 0, characters = 0, started = performance.now();
  for (let node = walker.nextNode(); node && nodes < 12_000 && characters < MAX_CONTENT_LENGTH * 2; node = walker.nextNode()) {
    if (performance.now() - started >= 5) {
      await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now();
      if (source.URL !== originalUrl) throw new Error("网页已变化，请重新保存当前网页。");
    }
    const parent = node.parentNode && parents.get(node.parentNode);
    if (!parent) continue;
    const copy = clone.importNode(node, false);
    if (node.nodeType === 3) {
      const text = (node.textContent || "").replace(/\s+/g, " ");
      copy.textContent = text.slice(0, MAX_CONTENT_LENGTH * 2 - characters); characters += copy.textContent.length;
    }
    parent.appendChild(copy); parents.set(node, copy); nodes++;
  }
  return clone;
}

export interface ExtractPageOptions {
  pageUrl: string;
  selectedText?: string;
}

export async function extractPage(
  document: Document,
  options: ExtractPageOptions
): Promise<PageCapture> {
  const pageUrl = options.pageUrl;
  const clone = await readableDocument(document, pageUrl);
  const cleanFallback = normalizeText(clone.querySelector("main, article")?.textContent || clone.body?.textContent || "");

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
    cleanFallback
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

  // Readability flattens the document to prose, which drops the heading
  // hierarchy — the part that says what the page is *about* most compactly.
  const headings = [
    ...new Set(
      [
        ...clone.querySelectorAll<HTMLElement>("h1"),
        ...clone.querySelectorAll<HTMLElement>("h2")
      ]
        .map((node) => normalizeText(node.textContent || ""))
        .filter((text) => text.length > 1 && text.length <= 120)
    )
  ].slice(0, 12);

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
    faviconUrl: absoluteUrl(faviconHref || "/favicon.ico", pageUrl),
    headings
  };
}
