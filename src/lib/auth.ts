import type { AuthState } from "./types";

const CLOUD_SESSION_KEY = "aarre:cloud-session:v1";
const CLOUD_DEVICE_ID_KEY = "aarre:cloud-device-id:v1";
const CONFIGURED_CLOUD_API_BASE_URL = import.meta.env.VITE_AARRE_API_BASE_URL || "";

export const CLOUD_API_BASE_URL = CONFIGURED_CLOUD_API_BASE_URL.replace(/\/+$/, "");
export const CLOUD_AUTH_CONFIGURED = /^https:\/\/[^/]+$/i.test(CLOUD_API_BASE_URL);

function requireCloudConfiguration(): void {
  if (!CLOUD_AUTH_CONFIGURED) {
    throw new Error("这个构建尚未连接 Aarre 生产云端。");
  }
}

interface CloudSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  userId: string;
  profile: {
    email: string;
    name: string;
    avatarUrl: string;
  };
}

let refreshPromise: Promise<CloudSession> | null = null;

async function getChromeProfileEmail(): Promise<string | undefined> {
  try {
    const profile = await chrome.identity.getProfileUserInfo({
      accountStatus: "ANY"
    });
    return profile.email || undefined;
  } catch {
    return undefined;
  }
}

async function readSession(): Promise<CloudSession | null> {
  const stored = (await chrome.storage.local.get(CLOUD_SESSION_KEY))[CLOUD_SESSION_KEY];
  if (!stored || typeof stored !== "object") return null;
  const candidate = stored as Partial<CloudSession>;
  if (
    typeof candidate.accessToken !== "string" ||
    typeof candidate.refreshToken !== "string" ||
    typeof candidate.accessExpiresAt !== "string" ||
    typeof candidate.refreshExpiresAt !== "string" ||
    typeof candidate.userId !== "string" ||
    !candidate.profile ||
    typeof candidate.profile.email !== "string"
  ) {
    return null;
  }
  if (Date.parse(candidate.refreshExpiresAt) <= Date.now()) {
    await chrome.storage.local.remove(CLOUD_SESSION_KEY);
    return null;
  }
  return candidate as CloudSession;
}

async function saveSession(session: CloudSession): Promise<CloudSession> {
  await chrome.storage.local.set({ [CLOUD_SESSION_KEY]: session });
  return session;
}

async function deviceId(): Promise<string> {
  const stored = (await chrome.storage.local.get(CLOUD_DEVICE_ID_KEY))[CLOUD_DEVICE_ID_KEY];
  if (typeof stored === "string" && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ [CLOUD_DEVICE_ID_KEY]: created });
  return created;
}

function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function challengeForVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message || body.error || `云端服务返回 ${response.status}`;
  } catch {
    return `云端服务返回 ${response.status}`;
  }
}

export function retryAfterMilliseconds(
  headers: Pick<Headers, "get">,
  now = Date.now()
): number {
  const value = headers.get("retry-after")?.trim() || "";
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : Math.max(0, Date.parse(value) - now);
  const fallback = 5_000;
  return Math.min(65_000, Math.max(1_000, parsed || fallback));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson<T>(path: string, init: RequestInit): Promise<T> {
  requireCloudConfiguration();
  const response = await fetch(`${CLOUD_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw Object.assign(new Error(await responseError(response)), { status: response.status });
  return (await response.json()) as T;
}

async function refreshSession(session: CloudSession): Promise<CloudSession> {
  if (!refreshPromise) {
    refreshPromise = fetchJson<Omit<CloudSession, "profile" | "userId">>(
      "/v1/auth/refresh",
      {
        method: "POST",
        body: JSON.stringify({ refreshToken: session.refreshToken })
      }
    )
      .then((tokens) =>
        saveSession({
          ...session,
          ...tokens
        })
      )
      .catch(async (error) => {
        await chrome.storage.local.remove(CLOUD_SESSION_KEY);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function cloudRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  requireCloudConfiguration();
  let session = await readSession();
  if (!session) throw new Error("请先登录 Aarre 云端。");
  if (Date.parse(session.accessExpiresAt) <= Date.now() + 30_000) {
    session = await refreshSession(session);
  }
  const send = (current: CloudSession) =>
    fetch(`${CLOUD_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${current.accessToken}`,
        ...(init.headers || {})
      },
      signal: AbortSignal.timeout(30_000)
    });
  let refreshed = false;
  let rateLimitRetries = 0;
  while (true) {
    const response = await send(session);
    if (response.status === 401 && !refreshed) {
      session = await refreshSession(session);
      refreshed = true;
      continue;
    }
    if (response.status === 429 && rateLimitRetries < 2) {
      rateLimitRetries += 1;
      await wait(retryAfterMilliseconds(response.headers));
      continue;
    }
    if (!response.ok) {
      throw Object.assign(new Error(await responseError(response)), {
        status: response.status
      });
    }
    return (await response.json()) as T;
  }
}

export async function hardenCloudTokenStorage(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

export async function getAuthState(): Promise<AuthState> {
  const [session, chromeProfileEmail] = await Promise.all([
    readSession(),
    getChromeProfileEmail()
  ]);
  const signedIn = Boolean(session);
  const accountMatches = !session
    ? null
    : chromeProfileEmail
      ? session.profile.email.toLocaleLowerCase() === chromeProfileEmail.toLocaleLowerCase()
      : true;
  return {
    configured: CLOUD_AUTH_CONFIGURED,
    signedIn,
    ...(session?.profile.email ? { userEmail: session.profile.email } : {}),
    ...(session?.profile.name ? { userName: session.profile.name } : {}),
    ...(session?.profile.avatarUrl ? { userAvatarUrl: session.profile.avatarUrl } : {}),
    chromeProfileEmail,
    accountMatches,
    redirectUrl: chrome.identity.getRedirectURL("auth")
  };
}

export async function signInWithGoogle(): Promise<AuthState> {
  requireCloudConfiguration();
  const verifier = randomVerifier();
  const codeChallenge = await challengeForVerifier(verifier);
  const redirectUri = chrome.identity.getRedirectURL("auth");
  const currentDeviceId = await deviceId();
  const start = new URL(`${CLOUD_API_BASE_URL}/v1/auth/google/start`);
  start.searchParams.set("codeChallenge", codeChallenge);
  start.searchParams.set("deviceId", currentDeviceId);
  start.searchParams.set("redirectUri", redirectUri);
  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: start.toString(),
    interactive: true
  });
  if (!callbackUrl) throw new Error("登录已取消。");
  const callback = new URL(callbackUrl);
  const ticket = callback.searchParams.get("ticket") ||
    new URLSearchParams(callback.hash.replace(/^#/, "")).get("ticket");
  if (!ticket) throw new Error("登录回调缺少一次性票据。");
  const session = await fetchJson<CloudSession>("/v1/auth/ticket", {
    method: "POST",
    body: JSON.stringify({
      ticket,
      codeVerifier: verifier,
      deviceId: currentDeviceId,
      deviceName: `${navigator.platform || "Chrome"} · Aarre`
    })
  });
  await saveSession(session);
  return getAuthState();
}

export async function signOut(): Promise<void> {
  const session = await readSession();
  try {
    if (session) {
      await cloudRequest<{ signedOut: true }>("/v1/auth/logout", { method: "POST", body: "{}" });
    }
  } finally {
    await chrome.storage.local.remove(CLOUD_SESSION_KEY);
  }
}
