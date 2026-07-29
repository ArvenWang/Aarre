import type { AuthState } from "./types";
import { getSupabase, isCloudConfigured } from "./supabase";

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

export async function getAuthState(): Promise<AuthState> {
  const redirectUrl = chrome.identity.getRedirectURL("auth");
  const chromeProfileEmail = await getChromeProfileEmail();
  const supabase = getSupabase();

  if (!supabase) {
    return {
      configured: false,
      signedIn: false,
      chromeProfileEmail,
      accountMatches: null,
      redirectUrl
    };
  }

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  const userEmail = user?.email;
  const accountMatches =
    chromeProfileEmail && userEmail
      ? chromeProfileEmail.toLowerCase() === userEmail.toLowerCase()
      : null;

  return {
    configured: isCloudConfigured,
    signedIn: Boolean(user),
    userEmail,
    userName:
      typeof user?.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : undefined,
    userAvatarUrl:
      typeof user?.user_metadata?.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : undefined,
    chromeProfileEmail,
    accountMatches,
    redirectUrl
  };
}

export async function signInWithGoogle(): Promise<AuthState> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("云端尚未配置，无法发起 Google 登录。");
  }

  const chromeProfileEmail = await getChromeProfileEmail();
  if (!chromeProfileEmail) {
    throw new Error(
      "请先在当前 Chrome 配置文件中登录 Google 账号，再连接 Aarre。"
    );
  }

  const redirectTo = chrome.identity.getRedirectURL("auth");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: "select_account"
      }
    }
  });

  if (error || !data.url) {
    throw new Error(error?.message || "无法创建 Google 登录请求。");
  }

  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url: data.url,
    interactive: true
  });

  if (!redirectedTo) {
    throw new Error("Google 登录未完成。");
  }

  const callbackUrl = new URL(redirectedTo);
  const code = callbackUrl.searchParams.get("code");

  if (code) {
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      throw new Error(exchangeError.message);
    }
  } else {
    const fragment = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");

    if (!accessToken || !refreshToken) {
      throw new Error("Google 登录回调缺少有效会话。");
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (sessionError) {
      throw new Error(sessionError.message);
    }
  }

  const state = await getAuthState();
  if (state.accountMatches !== true) {
    await supabase.auth.signOut();
    throw new Error(
      `登录账号与当前 Chrome 配置文件不一致。请使用 ${state.chromeProfileEmail} 登录。`
    );
  }

  return state;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (supabase) {
    await supabase.auth.signOut();
  }
}
