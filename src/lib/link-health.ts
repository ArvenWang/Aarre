import type { LinkHealthRecord } from "./types";

const LINK_CHECK_TIMEOUT_MS = 12_000;

export interface LinkCheckObservation {
  requestedUrl: string;
  checkedAt: string;
  status?: number;
  finalUrl?: string;
  failed?: boolean;
  reason?: string;
}

function redirectedToHomepage(
  requestedUrl: string,
  finalUrl: string
): boolean {
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    const requestedHasContentPath =
      requested.pathname.replace(/\/+$/, "") !== "";
    const finalIsHomepage =
      final.pathname.replace(/\/+$/, "") === "" &&
      !final.search &&
      !final.hash;
    return (
      requestedHasContentPath &&
      finalIsHomepage &&
      requested.href !== final.href
    );
  } catch {
    return false;
  }
}

export function classifyLinkHealth(
  observation: LinkCheckObservation,
  previous?: LinkHealthRecord
): LinkHealthRecord {
  const status = observation.status;
  const failure =
    observation.failed ||
    status === undefined ||
    status >= 500;
  const consecutiveFailures = failure
    ? (previous?.status === "temporary"
        ? previous.consecutiveFailures
        : 0) + 1
    : 0;
  const base = {
    checkedAt: observation.checkedAt,
    consecutiveFailures,
    ...(typeof status === "number" ? { httpStatus: status } : {}),
    ...(observation.finalUrl
      ? { finalUrl: observation.finalUrl }
      : {}),
    ...(observation.reason
      ? { reason: observation.reason.slice(0, 240) }
      : {})
  };

  if (status === 404 || status === 410) {
    return {
      ...base,
      status: "dead",
      consecutiveFailures: 0,
      reason: `服务器返回 ${status}`
    };
  }
  if (status === 401 || status === 403) {
    return {
      ...base,
      status: "login_required",
      consecutiveFailures: 0,
      reason: `需要登录或访问授权（${status}）`
    };
  }
  if (
    status &&
    status >= 200 &&
    status < 400 &&
    observation.finalUrl &&
    redirectedToHomepage(
      observation.requestedUrl,
      observation.finalUrl
    )
  ) {
    return {
      ...base,
      status: "soft_404",
      consecutiveFailures: 0,
      reason: "原页面重定向到了站点首页，内容可能已删除"
    };
  }
  if (failure) {
    return {
      ...base,
      status: consecutiveFailures >= 3 ? "dead" : "temporary",
      reason:
        consecutiveFailures >= 3
          ? "连续三次无法访问"
          : observation.reason ||
            (status ? `服务器暂时异常（${status}）` : "请求超时或网络不可用")
    };
  }
  return {
    ...base,
    status: "healthy",
    consecutiveFailures: 0,
    reason: status ? `服务器返回 ${status}` : "访问正常"
  };
}

async function fetchHeaders(
  url: string,
  method: "HEAD" | "GET"
): Promise<Response> {
  const response = await fetch(url, {
    method,
    redirect: "follow",
    cache: "no-store",
    ...(method === "GET"
      ? { headers: { Range: "bytes=0-0" } }
      : {}),
    signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS)
  });
  if (method === "GET") {
    void response.body?.cancel().catch(() => undefined);
  }
  return response;
}

export async function checkLinkHealth(
  url: string,
  previous?: LinkHealthRecord,
  checkedAt = new Date().toISOString()
): Promise<LinkHealthRecord> {
  try {
    let response = await fetchHeaders(url, "HEAD");
    if (response.status === 405 || response.status === 501) {
      response = await fetchHeaders(url, "GET");
    }
    return classifyLinkHealth(
      {
        requestedUrl: url,
        checkedAt,
        status: response.status,
        finalUrl: response.url || url
      },
      previous
    );
  } catch (error) {
    return classifyLinkHealth(
      {
        requestedUrl: url,
        checkedAt,
        failed: true,
        reason:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "请求超时"
            : "网络请求失败"
      },
      previous
    );
  }
}

