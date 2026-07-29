export type ExtensionUrlResolver = (path: string) => string;

function runtimeUrlResolver(): ExtensionUrlResolver | undefined {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime ||
    typeof chrome.runtime.getURL !== "function"
  ) {
    return undefined;
  }

  return (path) => chrome.runtime.getURL(path);
}

export function aarreIconUrl(
  resolveExtensionUrl: ExtensionUrlResolver | undefined =
    runtimeUrlResolver()
): string {
  return resolveExtensionUrl
    ? resolveExtensionUrl("/icons/icon.svg")
    : "/icons/icon.svg";
}

export function chromeFaviconUrl(
  pageUrl: string,
  size = 32,
  resolveExtensionUrl: ExtensionUrlResolver | undefined =
    runtimeUrlResolver()
): string {
  if (!pageUrl || !resolveExtensionUrl) {
    return "";
  }

  try {
    const faviconUrl = new URL(resolveExtensionUrl("/_favicon/"));
    faviconUrl.searchParams.set("pageUrl", pageUrl);
    faviconUrl.searchParams.set("size", String(size));
    faviconUrl.searchParams.set("scaleFactor", "2x");
    // Chrome 缺少真实 favicon 时默认返回灰色地球；改为空响应，
    // 让图片加载失败后进入 Aarre 自己的品牌兜底。
    faviconUrl.searchParams.set("forceEmptyDefaultFavicon", "1");
    return faviconUrl.toString();
  } catch {
    return "";
  }
}

export function siteIconCandidates(
  pageUrl: string,
  preferredUrl = "",
  size = 32,
  resolveExtensionUrl: ExtensionUrlResolver | undefined =
    runtimeUrlResolver()
): string[] {
  const candidates = [
    preferredUrl,
    chromeFaviconUrl(pageUrl, size, resolveExtensionUrl)
  ];

  // 普通网页预览环境没有 Chrome 扩展 favicon 服务时，仍尝试站点根图标。
  if (!resolveExtensionUrl) {
    try {
      const url = new URL(pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        candidates.push(new URL("/favicon.ico", url.origin).toString());
      }
    } catch {
      // 无效或浏览器内部网址不追加网络候选，容器保持为空。
    }
  }

  candidates.push(aarreIconUrl(resolveExtensionUrl));

  return [
    ...new Set(
      candidates.filter(
        (candidate): candidate is string => Boolean(candidate?.trim())
      )
    )
  ];
}
