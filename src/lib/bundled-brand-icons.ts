import githubMarkDataUrl from "../assets/site-icons/github-mark.webp?inline";
import { matchCoverRule, pinnedBrandAssetUrl } from "./cover-rules";

export interface BundledBrandIcon {
  dataUrl: string;
  assetUrl: string;
  nativeWidth: number;
  nativeHeight: number;
}

const BUNDLED_BRAND_ICONS: Record<
  string,
  Omit<BundledBrandIcon, "assetUrl">
> = {
  github: {
    dataUrl: githubMarkDataUrl,
    nativeWidth: 32,
    nativeHeight: 32
  }
};

/**
 * A pinned brand must never disappear merely because its remote SVG cannot be
 * decoded inside a Manifest V3 service worker. The bundled file is a trusted,
 * lossless 192px raster of the same declared brand asset; assetUrl remains the
 * registry identity so existing cache and cloud migration rules stay stable.
 */
export function bundledPinnedBrandIcon(
  input: string
): BundledBrandIcon | undefined {
  const rule = matchCoverRule(input);
  if (!rule?.pinBrandAsset) return undefined;
  const bundled = BUNDLED_BRAND_ICONS[rule.id];
  const assetUrl = pinnedBrandAssetUrl(input);
  return bundled && assetUrl ? { ...bundled, assetUrl } : undefined;
}
