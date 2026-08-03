import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import sharp from "sharp";
import {
  matchCoverRule,
  resolveRuleAsset
} from "../src/lib/cover-rules";
import {
  extractPageEssenceFromHtml,
  isInternalOrSensitiveUrl
} from "../src/lib/page-essence";
import {
  extractLargestPngFromIco,
  normalizeSvgViewport,
  normalizeSiteIconPixels,
  SITE_ICON_SURFACE
} from "../src/lib/thumbnail";
import {
  ICON_MAX_RATIO,
  ICON_MIN_INK,
  ICON_MIN_SIZE
} from "../src/lib/icon-quality";
import type {
  PageEssence,
  SiteIconCandidate
} from "../src/lib/types";

const MAX_HTML_BYTES = 600_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const ICON_SIZE = 192;
const DEFAULT_CONCURRENCY = 5;

type CompositionMode = "legacy" | "white";
type MeasuredSource =
  | "registry"
  | "apple-touch-icon"
  | "conventional-favicon-ico"
  | "manifest"
  | "high-resolution-rel-icon"
  | "og-image"
  | "category-fallback";

interface CliOptions {
  inputs: string[];
  output: string;
  composition: CompositionMode;
  limit: number;
  concurrency: number;
}

interface CandidateRejection {
  reason: string;
  pageUrl: string;
  assetUrl: string;
  source: SiteIconCandidate["source"] | "page-image";
  nativeWidth?: number;
  nativeHeight?: number;
}

interface IconResult {
  accepted: boolean;
  source?: MeasuredSource;
  rejection?: CandidateRejection;
  scale: number;
}

interface HostResult {
  source: Exclude<MeasuredSource, "og-image" | "category-fallback"> | null;
  rejections: CandidateRejection[];
  maxScale: number;
}

function usage(): never {
  console.error(
    "用法：npm run measure:covers -- --input <书签 JSON/URL 文本> [--input <另一份书签>] --output <报告.json> [--composition legacy|white] [--limit 500] [--concurrency 5]"
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  const inputs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) usage();
    const name = key.slice(2);
    if (name === "input") inputs.push(resolve(value));
    else values.set(name, value);
    index += 1;
  }
  const output = values.get("output");
  if (!inputs.length || !output) usage();
  const composition = (values.get("composition") ||
    "white") as CompositionMode;
  if (!["legacy", "white"].includes(composition)) usage();
  const limit = Number(values.get("limit") || 500);
  const concurrency = Number(
    values.get("concurrency") || DEFAULT_CONCURRENCY
  );
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 12
  ) {
    usage();
  }
  return {
    inputs,
    output: resolve(output),
    composition,
    limit,
    concurrency
  };
}

function collectUrls(value: unknown, output: string[]) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value.trim())) output.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string") collectUrls(record.url, output);
  for (const [key, child] of Object.entries(record)) {
    if (key !== "url") collectUrls(child, output);
  }
}

async function readInputUrls(path: string): Promise<string[]> {
  const source = await readFile(path, "utf8");
  const urls: string[] = [];
  try {
    collectUrls(JSON.parse(source), urls);
  } catch {
    for (const line of source.split(/\r?\n/)) collectUrls(line, urls);
  }
  const accepted: string[] = [];
  for (const input of urls) {
    try {
      const url = new URL(input);
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !isInternalOrSensitiveUrl(url.toString())
      ) {
        // 指标按书签条目计算。重复收藏在真实列表里会重复占用一个封面，
        // 因此不能在测量前按 URL 去重；抓取仍在后面按 host 共享。
        accepted.push(url.toString());
      }
    } catch {
      // Ignore invalid or unsupported bookmark entries.
    }
  }
  return accepted;
}

function interleaveByHost(urls: string[], limit: number): string[] {
  const buckets = new Map<string, string[]>();
  for (const url of urls) {
    const host = new URL(url).hostname.toLocaleLowerCase();
    const bucket = buckets.get(host) || [];
    bucket.push(url);
    buckets.set(host, bucket);
  }
  const output: string[] = [];
  while (buckets.size && output.length < limit) {
    for (const [host, bucket] of buckets) {
      const next = bucket.shift();
      if (next) output.push(next);
      if (!bucket.length) buckets.delete(host);
      if (output.length >= limit) break;
    }
  }
  return output;
}

async function readLimitedResponse(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("file-too-large");
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("file-too-large");
    return buffer;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("file-too-large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

async function fetchPageEssence(url: string): Promise<PageEssence> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2"
      },
      signal: AbortSignal.timeout(12_000)
    });
    const contentType = response.headers.get("content-type") || "";
    if (
      !response.ok ||
      (!contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml"))
    ) {
      return extractPageEssenceFromHtml("", url);
    }
    const html = (
      await readLimitedResponse(response, MAX_HTML_BYTES)
    ).toString("utf8");
    return extractPageEssenceFromHtml(html, response.url || url);
  } catch {
    return extractPageEssenceFromHtml("", url);
  }
}

function iconSize(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const sizes = [...value.matchAll(/(\d+)\s*x\s*(\d+)/gi)]
    .map((match) => Math.min(Number(match[1]), Number(match[2])))
    .filter((size) => Number.isFinite(size) && size > 0);
  return sizes.length ? Math.max(...sizes) : undefined;
}

async function manifestCandidates(
  manifestUrl: string
): Promise<SiteIconCandidate[]> {
  if (!manifestUrl) return [];
  try {
    const response = await fetch(manifestUrl, {
      redirect: "follow",
      headers: {
        Accept: "application/manifest+json,application/json"
      },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return [];
    const manifest = JSON.parse(
      (await readLimitedResponse(response, 256 * 1024)).toString("utf8")
    ) as {
      icons?: Array<{ src?: unknown; sizes?: unknown; type?: unknown }>;
    };
    if (!Array.isArray(manifest.icons)) return [];
    return manifest.icons
      .flatMap((icon): SiteIconCandidate[] => {
        if (typeof icon.src !== "string" || !icon.src.trim()) return [];
        try {
          const url = new URL(
            icon.src,
            response.url || manifestUrl
          ).toString();
          const declaredSize = iconSize(icon.sizes);
          const vector =
            icon.type === "image/svg+xml" ||
            /\.svg(?:[?#]|$)/i.test(url);
          return [
            {
              url,
              source: "manifest",
              ...(declaredSize ? { declaredSize } : {}),
              ...(vector ? { vector: true } : {})
            }
          ];
        } catch {
          return [];
        }
      })
      .sort(
        (left, right) =>
          (right.declaredSize || 0) - (left.declaredSize || 0)
      );
  } catch {
    return [];
  }
}

async function conventionalCandidates(
  pageUrl: string
): Promise<SiteIconCandidate[]> {
  const origin = new URL(pageUrl).origin;
  const candidates: SiteIconCandidate[] = [];
  const paths = [
    "/apple-touch-icon-180x180.png",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/apple-touch-icon-152x152.png"
  ];
  for (const path of paths) {
    const url = new URL(path, origin).toString();
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) {
        candidates.push({
          url,
          source: "conventional-apple-touch-icon",
          declaredSize: path.includes("152") ? 152 : 180
        });
        break;
      }
    } catch {
      // Continue through the same conventional candidates as production.
    }
  }
  const icoUrl = new URL("/favicon.ico", origin).toString();
  try {
    const response = await fetch(icoUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000)
    });
    if (response.ok) {
      candidates.push({
        url: icoUrl,
        source: "conventional-favicon-ico"
      });
    }
  } catch {
    // Continue to the same conventional SVG candidate as production.
  }
  const svgUrl = new URL("/favicon.svg", origin).toString();
  try {
    const response = await fetch(svgUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000)
    });
    if (response.ok) {
      candidates.push({
        url: svgUrl,
        source: "svg-icon",
        vector: true
      });
    }
  } catch {
    // No conventional SVG candidate.
  }
  return candidates;
}

function uniqueCandidates(
  candidates: SiteIconCandidate[]
): SiteIconCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

async function fetchImage(candidate: SiteIconCandidate): Promise<Buffer> {
  const response = await fetch(candidate.url, {
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.3"
    },
    signal: AbortSignal.timeout(12_000)
  });
  const contentType = response.headers.get("content-type") || "";
  if (
    !response.ok ||
    (candidate.source !== "conventional-favicon-ico" &&
      !contentType.toLowerCase().startsWith("image/"))
  ) {
    throw new Error("not-an-image");
  }
  return readLimitedResponse(
    response,
    candidate.vector || contentType.includes("svg")
      ? MAX_SVG_BYTES
      : MAX_IMAGE_BYTES
  );
}

function inspectLegacyPixels(
  data: Buffer,
  contentRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): number {
  const left = Math.max(0, Math.floor(contentRect.x));
  const top = Math.max(0, Math.floor(contentRect.y));
  const right = Math.min(
    ICON_SIZE,
    Math.ceil(contentRect.x + contentRect.width)
  );
  const bottom = Math.min(
    ICON_SIZE,
    Math.ceil(contentRect.y + contentRect.height)
  );
  let ink = 0;
  for (let index = 0; index < data.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % ICON_SIZE;
    const y = Math.floor(pixel / ICON_SIZE);
    if (x < left || x >= right || y < top || y >= bottom) continue;
    if ((data[index + 3] || 0) < 24) continue;
    const red = data[index] || 0;
    const green = data[index + 1] || 0;
    const blue = data[index + 2] || 0;
    if (Math.max(255 - red, 255 - green, 255 - blue) >= 28) ink += 1;
  }
  return ink / Math.max(1, (right - left) * (bottom - top));
}

async function renderedPixels(
  input: Buffer,
  background: { r: number; g: number; b: number; alpha: number }
): Promise<Buffer> {
  return (
    await sharp(input, { failOn: "warning" })
      .resize(ICON_SIZE, ICON_SIZE, {
        fit: "contain",
        withoutEnlargement: true,
        background
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  ).data;
}

async function inspectCandidate(
  candidate: SiteIconCandidate,
  pageUrl: string,
  composition: CompositionMode
): Promise<IconResult> {
  let input: Buffer;
  try {
    input = await fetchImage(candidate);
  } catch (error) {
    return {
      accepted: false,
      scale: 0,
      rejection: {
        reason: error instanceof Error ? error.message : "fetch-failed",
        pageUrl,
        assetUrl: candidate.url,
        source: candidate.source
      }
    };
  }

  const ico = extractLargestPngFromIco(input);
  let icoFrame:
    | Extract<typeof ico, { kind: "png" }>
    | undefined;
  if (ico.kind === "unsupported-ico") {
    return {
      accepted: false,
      scale: 0,
      rejection: {
        reason: "unsupported-ico-frame",
        pageUrl,
        assetUrl: candidate.url,
        source: candidate.source
      }
    };
  }
  if (ico.kind === "png") {
    icoFrame = ico;
    input = Buffer.from(ico.bytes);
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, { failOn: "warning" }).metadata();
  } catch (error) {
    return {
      accepted: false,
      scale: 0,
      rejection: {
        reason: error instanceof Error ? error.message : "decode-failed",
        pageUrl,
        assetUrl: candidate.url,
        source: candidate.source
      }
    };
  }
  // 与生产一致：矢量资产按最长边 ICON_SIZE 重新栅格化，不受位图尺寸下限约束。
  let vector = false;
  let nativeWidth = icoFrame?.width || metadata.width || 0;
  let nativeHeight = icoFrame?.height || metadata.height || 0;
  let renderWidth = metadata.width || 0;
  let renderHeight = metadata.height || 0;
  if (metadata.format === "svg") {
    const normalized = normalizeSvgViewport(
      input.toString("utf8"),
      ICON_SIZE
    );
    if (normalized.intrinsicWidth > 0) {
      vector = true;
      nativeWidth = normalized.intrinsicWidth;
      nativeHeight = normalized.intrinsicHeight;
      const vectorScale =
        ICON_SIZE / Math.max(nativeWidth, nativeHeight);
      renderWidth = Math.round(nativeWidth * vectorScale);
      renderHeight = Math.round(nativeHeight * vectorScale);
      input = Buffer.from(normalized.source, "utf8");
    }
  }
  const base = {
    pageUrl,
    assetUrl: candidate.url,
    source: candidate.source,
    nativeWidth,
    nativeHeight
  };
  if (!vector && (nativeWidth < ICON_MIN_SIZE || nativeHeight < ICON_MIN_SIZE)) {
    return {
      accepted: false,
      scale: 0,
      rejection: { ...base, reason: "below-16px" }
    };
  }
  if (
    Math.max(nativeWidth, nativeHeight) /
      Math.min(nativeWidth, nativeHeight) >
    ICON_MAX_RATIO
  ) {
    return {
      accepted: false,
      scale: 0,
      rejection: { ...base, reason: "extreme-ratio" }
    };
  }
  const scale = vector
    ? 1
    : Math.min(1, ICON_SIZE / Math.max(nativeWidth, nativeHeight));
  const drawScale = Math.min(
    1,
    ICON_SIZE / Math.max(renderWidth, renderHeight)
  );
  const drawnWidth = renderWidth * drawScale;
  const drawnHeight = renderHeight * drawScale;
  const contentRect = {
    x: (ICON_SIZE - drawnWidth) / 2,
    y: (ICON_SIZE - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
    canvasWidth: ICON_SIZE
  };
  try {
    if (composition === "legacy") {
      const pixels = await renderedPixels(input, {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0
      });
      if (inspectLegacyPixels(pixels, contentRect) < ICON_MIN_INK) {
        return {
          accepted: false,
          scale,
          rejection: { ...base, reason: "blank-image" }
        };
      }
    } else {
      const pixels = await renderedPixels(input, {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0
      });
      const sourcePixels = new Uint8ClampedArray(
        pixels.buffer,
        pixels.byteOffset,
        pixels.byteLength
      );
      if (
        normalizeSiteIconPixels(
          sourcePixels,
          SITE_ICON_SURFACE,
          contentRect
        ).inkCoverage < ICON_MIN_INK
      ) {
        return {
          accepted: false,
          scale,
          rejection: { ...base, reason: "blank-image" }
        };
      }
    }
    return { accepted: true, scale };
  } catch (error) {
    return {
      accepted: false,
      scale,
      rejection: {
        ...base,
        reason:
          error instanceof Error ? error.message : "image-processing-failed"
      }
    };
  }
}

function measuredSource(
  candidate: SiteIconCandidate
): Exclude<MeasuredSource, "og-image" | "category-fallback"> {
  if (candidate.source === "registry") return "registry";
  if (candidate.source === "conventional-favicon-ico") {
    return "conventional-favicon-ico";
  }
  if (
    candidate.source === "apple-touch-icon" ||
    candidate.source === "conventional-apple-touch-icon"
  ) {
    return "apple-touch-icon";
  }
  if (candidate.source === "manifest") return "manifest";
  return "high-resolution-rel-icon";
}

async function measureHost(
  pageUrl: string,
  essence: PageEssence,
  composition: CompositionMode
): Promise<HostResult> {
  const registryAsset = resolveRuleAsset(pageUrl, "brandAsset");
  const apple = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "apple-touch-icon"
  );
  const declaredSvg = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "svg-icon"
  );
  const largeBitmap = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "large-icon"
  );
  const tile = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "msapplication-tile"
  );
  const candidates = uniqueCandidates([
    ...(registryAsset
      ? [
          {
            url: registryAsset,
            source: "registry" as const
          }
        ]
      : []),
    ...apple,
    ...(await conventionalCandidates(pageUrl)),
    ...(await manifestCandidates(essence.manifestUrl)),
    ...declaredSvg,
    ...largeBitmap,
    ...tile
  ]);
  const rejections: CandidateRejection[] = [];
  let maxScale = 0;
  for (const candidate of candidates) {
    const result = await inspectCandidate(
      candidate,
      pageUrl,
      composition
    );
    maxScale = Math.max(maxScale, result.scale);
    if (result.accepted) {
      return {
        source: measuredSource(candidate),
        rejections,
        maxScale
      };
    }
    if (result.rejection) rejections.push(result.rejection);
  }
  return { source: null, rejections, maxScale };
}

async function validPageImage(
  pageUrl: string,
  essence: PageEssence
): Promise<boolean> {
  const imageUrl =
    resolveRuleAsset(pageUrl, "pageImage") || essence.imageUrl;
  if (!imageUrl) return false;
  try {
    const input = await fetchImage({
      url: imageUrl,
      source: "large-icon"
    });
    const metadata = await sharp(input, { failOn: "warning" }).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    return (
      width >= 200 &&
      height >= 200 &&
      Math.max(width, height) / Math.min(width, height) <= 4
    );
  } catch {
    return false;
  }
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        output[index] = await worker(values[index]!, index);
      }
    }
  );
  await Promise.all(runners);
  return output;
}

function sanitizedUrl(input: string): string {
  try {
    const url = new URL(input);
    const digest = createHash("sha256")
      .update(`${url.pathname}${url.search}`)
      .digest("hex")
      .slice(0, 8);
    return `${url.protocol}//${url.hostname}/[path-${digest}]${extname(url.pathname)}`;
  } catch {
    return "[invalid-url]";
  }
}

function percent(value: number, total: number): number {
  return total ? Number(((value / total) * 100).toFixed(2)) : 0;
}

function markdownReport(report: Record<string, unknown>): string {
  const sources = report.sources as Record<
    string,
    { count: number; percent: number }
  >;
  const fallback = report.fallback as { count: number; percent: number };
  const top = report.fallbackTopDomains as Array<{
    host: string;
    count: number;
  }>;
  const rejected = report.rejections as Record<
    string,
    { count: number; samples: unknown[] }
  >;
  const fallbackBreakdown = report.fallbackBreakdown as {
    withRejectedCandidates: number;
    withoutCandidates: number;
  };
  const sourceHostSamples = report.sourceHostSamples as Record<
    string,
    string[]
  >;
  return [
    `# Aarre 封面兜底率测量`,
    "",
    `- 样本：${report.sampleCount} 条（原始可用 URL ${report.availableUrlCount} 条）`,
    `- 模式：${report.composition}`,
    `- 测量时间：${report.measuredAt}`,
    `- 分类封面兜底：${fallback.count} 条 / ${fallback.percent}%`,
    `- 有候选但被拒：${fallbackBreakdown.withRejectedCandidates} 条`,
    `- 无候选：${fallbackBreakdown.withoutCandidates} 条`,
    `- 最大缩放比：${report.maxScale}（要求不超过 1）`,
    "",
    "## 来源分布",
    "",
    "| 来源 | 数量 | 占比 |",
    "| --- | ---: | ---: |",
    ...Object.entries(sources).map(
      ([source, value]) =>
        `| ${source} | ${value.count} | ${value.percent}% |`
    ),
    "",
    `conventional-favicon-ico 命中域名：${
      sourceHostSamples["conventional-favicon-ico"]?.join("、") || "无"
    }`,
    "",
    "## 质量闸门拒绝",
    "",
    ...Object.entries(rejected).flatMap(([reason, value]) => [
      `### ${reason}（${value.count}）`,
      "",
      "```json",
      JSON.stringify(value.samples, null, 2),
      "```",
      ""
    ]),
    "## 分类兜底域名 Top 30",
    "",
    "| 域名 | 条数 |",
    "| --- | ---: |",
    ...top.map((item) => `| ${item.host} | ${item.count} |`),
    ""
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const availableUrls = (
    await Promise.all(options.inputs.map((input) => readInputUrls(input)))
  ).flat();
  const sample = interleaveByHost(availableUrls, options.limit);
  if (sample.length < 300) {
    throw new Error(
      `有效样本只有 ${sample.length} 条；整改验收要求不少于 300 条。`
    );
  }

  const hostPromises = new Map<string, Promise<HostResult>>();
  const essencePromises = new Map<string, Promise<PageEssence>>();
  const getEssence = (url: string) => {
    const existing = essencePromises.get(url);
    if (existing) return existing;
    const promise = fetchPageEssence(url);
    essencePromises.set(url, promise);
    return promise;
  };

  const measured = await mapConcurrent(
    sample,
    options.concurrency,
    async (url, index) => {
      const page = new URL(url);
      const host = page.hostname.toLocaleLowerCase();
      const rule = matchCoverRule(url);
      const essence = await getEssence(url);
      if (rule?.listUsesPageImage && (await validPageImage(url, essence))) {
        process.stdout.write(
          `\r测量 ${String(index + 1).padStart(4)}/${sample.length}`
        );
        return {
          url,
          host,
          source: "og-image" as const,
          rejections: [] as CandidateRejection[],
          maxScale: 1
        };
      }

      let hostPromise = hostPromises.get(host);
      if (!hostPromise) {
        hostPromise = measureHost(url, essence, options.composition);
        hostPromises.set(host, hostPromise);
      }
      const hostResult = await hostPromise;
      process.stdout.write(
        `\r测量 ${String(index + 1).padStart(4)}/${sample.length}`
      );
      return {
        url,
        host,
        source: hostResult.source || ("category-fallback" as const),
        rejections: hostResult.rejections,
        maxScale: hostResult.maxScale
      };
    }
  );
  process.stdout.write("\n");

  const sourceCounts = Object.fromEntries(
    (
      [
        "registry",
        "apple-touch-icon",
        "conventional-favicon-ico",
        "manifest",
        "high-resolution-rel-icon",
        "og-image",
        "category-fallback"
      ] satisfies MeasuredSource[]
    ).map((source) => [
      source,
      measured.filter((item) => item.source === source).length
    ])
  ) as Record<MeasuredSource, number>;
  const fallbackRows = measured.filter(
    (item) => item.source === "category-fallback"
  );
  const fallbackByHost = new Map<string, number>();
  for (const row of fallbackRows) {
    fallbackByHost.set(
      row.host,
      (fallbackByHost.get(row.host) || 0) + 1
    );
  }
  const allRejections = [
    ...new Map(
      measured
        .flatMap((item) => item.rejections)
        .map((item) => [
          `${item.pageUrl}\n${item.assetUrl}\n${item.reason}`,
          item
        ])
    ).values()
  ];
  const rejectionReasons = [
    "below-128px",
    "non-square",
    "low-ink-or-contrast"
  ];
  const qualityRejectionReasons = new Set(rejectionReasons);
  const rejections = Object.fromEntries(
    rejectionReasons.map((reason) => {
      const rows = allRejections.filter((item) => item.reason === reason);
      return [
        reason,
        {
          count: rows.length,
          samples: rows.slice(0, 12).map((row) => ({
            pageUrl: sanitizedUrl(row.pageUrl),
            assetUrl: sanitizedUrl(row.assetUrl),
            source: row.source,
            nativeWidth: row.nativeWidth,
            nativeHeight: row.nativeHeight
          }))
        }
      ];
    })
  );

  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    inputLabel: options.inputs.map((input) => basename(input)).join(" + "),
    composition: options.composition,
    availableUrlCount: availableUrls.length,
    sampleCount: sample.length,
    sources: Object.fromEntries(
      Object.entries(sourceCounts).map(([source, count]) => [
        source,
        { count, percent: percent(count, sample.length) }
      ])
    ),
    fallback: {
      count: fallbackRows.length,
      percent: percent(fallbackRows.length, sample.length)
    },
    fallbackBreakdown: {
      withRejectedCandidates: fallbackRows.filter(
        (item) =>
          item.rejections.some((rejection) =>
            qualityRejectionReasons.has(rejection.reason)
          )
      ).length,
      withoutCandidates: fallbackRows.filter(
        (item) =>
          !item.rejections.some((rejection) =>
            qualityRejectionReasons.has(rejection.reason)
          )
      ).length
    },
    sourceHostSamples: {
      "conventional-favicon-ico": [
        ...new Set(
          measured
            .filter(
              (item) => item.source === "conventional-favicon-ico"
            )
            .map((item) => item.host)
        )
      ].slice(0, 30)
    },
    maxScale: Number(
      Math.max(...measured.map((item) => item.maxScale)).toFixed(4)
    ),
    zeroUpsamplePassed: measured.every((item) => item.maxScale <= 1),
    rejections,
    fallbackTopDomains: [...fallbackByHost.entries()]
      .sort(
        (left, right) =>
          right[1] - left[1] || left[0].localeCompare(right[0])
      )
      .slice(0, 30)
      .map(([host, count]) => ({ host, count }))
  };
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = options.output.replace(/\.json$/i, "") + ".md";
  await writeFile(markdownPath, markdownReport(report));
  console.log(
    `完成：${sample.length} 条，分类兜底 ${report.fallback.percent}%，报告 ${options.output}`
  );
}

await main();
