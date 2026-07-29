import { getAuthState } from "./auth";
import {
  getOutbox,
  mergeLocalResources,
  updateOutbox,
  upsertLocalResource
} from "./storage";
import { getSupabase } from "./supabase";
import type {
  OutboxItem,
  ResourceRecord,
  SearchResult
} from "./types";

interface CloudResourceRow {
  resource_key: string;
  canonical_url: string;
  url: string;
  title: string;
  user_note: string | null;
  summary: string | null;
  tags: string[] | null;
  topics: string[] | null;
  content_excerpt: string | null;
  content_hash: string | null;
  selected_text: string | null;
  author: string | null;
  site_name: string | null;
  language: string | null;
  image_url: string | null;
  favicon_url: string | null;
  native_folder_path: string[] | null;
  ai_status: ResourceRecord["aiStatus"];
  created_at: string;
  updated_at: string;
}

function fromCloudRow(row: CloudResourceRow): ResourceRecord {
  return {
    resourceKey: row.resource_key,
    canonicalUrl: row.canonical_url,
    url: row.url,
    title: row.title,
    userNote: row.user_note || "",
    summary: row.summary || "",
    tags: row.tags || [],
    topics: row.topics || [],
    contentExcerpt: row.content_excerpt || "",
    contentHash: row.content_hash || "",
    selectedText: row.selected_text || "",
    author: row.author || "",
    siteName: row.site_name || "",
    language: row.language || "",
    imageUrl: row.image_url || "",
    faviconUrl: row.favicon_url || "",
    nativeBookmarkIds: [],
    nativeFolderPath: row.native_folder_path || [],
    aiStatus: row.ai_status || "not_requested",
    syncStatus: "synced",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSyncedAt: new Date().toISOString()
  };
}

function mutableFields(resource: ResourceRecord) {
  return {
    canonical_url: resource.canonicalUrl,
    url: resource.url,
    title: resource.title,
    user_note: resource.userNote,
    content_excerpt: resource.contentExcerpt,
    content_hash: resource.contentHash,
    selected_text: resource.selectedText,
    author: resource.author,
    site_name: resource.siteName,
    language: resource.language,
    image_url: resource.imageUrl,
    favicon_url: resource.faviconUrl,
    native_folder_path: resource.nativeFolderPath,
    updated_at: new Date().toISOString()
  };
}

async function assertCloudSession() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("云端尚未配置。");
  }

  const auth = await getAuthState();
  if (!auth.signedIn) {
    throw new Error("请先使用 Google 账号登录。");
  }
  if (auth.accountMatches !== true) {
    throw new Error("无法确认产品账号与 Chrome 当前账号一致。");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) {
    throw new Error(error?.message || "登录会话已失效。");
  }

  return {
    supabase,
    user: data.session.user
  };
}

export async function syncOneResource(
  resource: ResourceRecord,
  content: string
): Promise<ResourceRecord> {
  const { supabase, user } = await assertCloudSession();
  const { data: existing, error: readError } = await supabase
    .from("resources")
    .select("*")
    .eq("user_id", user.id)
    .eq("resource_key", resource.resourceKey)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  let row: CloudResourceRow;

  if (existing) {
    const { data, error } = await supabase
      .from("resources")
      .update(mutableFields(resource))
      .eq("user_id", user.id)
      .eq("resource_key", resource.resourceKey)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }
    row = data as CloudResourceRow;
  } else {
    const { data, error } = await supabase
      .from("resources")
      .insert({
        user_id: user.id,
        resource_key: resource.resourceKey,
        ...mutableFields(resource),
        summary: resource.summary,
        tags: resource.tags,
        topics: resource.topics,
        ai_status: resource.aiStatus,
        created_at: resource.createdAt
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }
    row = data as CloudResourceRow;
  }

  if (
    content.trim().length >= 80 &&
    (resource.aiStatus === "pending" ||
      resource.aiStatus === "failed" ||
      resource.aiStatus === "not_requested")
  ) {
    const { data, error } = await supabase.functions.invoke(
      "enrich-bookmark",
      {
        body: {
          resource_key: resource.resourceKey,
          content,
          selected_text: resource.selectedText,
          user_note: resource.userNote
        }
      }
    );

    if (error) {
      const failed = {
        ...fromCloudRow(row),
        aiStatus: "failed" as const,
        syncStatus: "synced" as const
      };
      await upsertLocalResource(failed);
      throw new Error(`书签已同步，但 AI 处理失败：${error.message}`);
    }

    if (data?.resource) {
      row = data.resource as CloudResourceRow;
    }
  }

  const synced = {
    ...resource,
    ...fromCloudRow(row),
    nativeBookmarkIds: resource.nativeBookmarkIds,
    syncStatus: "synced" as const,
    lastSyncedAt: new Date().toISOString()
  };
  await upsertLocalResource(synced);
  return synced;
}

export async function pullCloudResources(): Promise<ResourceRecord[]> {
  const { supabase, user } = await assertCloudSession();
  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const incoming = (data as CloudResourceRow[]).map(fromCloudRow);
  return mergeLocalResources(incoming);
}

export async function processOutbox(): Promise<{
  synced: number;
  failed: number;
}> {
  const outbox = await getOutbox();
  const batch = outbox.slice(0, 10);
  const untouched = outbox.slice(10);
  let synced = 0;
  let failed = 0;
  const remaining: OutboxItem[] = [];

  for (const item of batch) {
    try {
      await syncOneResource(item.resource, item.content);
      synced += 1;
    } catch (error) {
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : "同步失败"
      });
      failed += 1;
    }
  }

  await updateOutbox([...remaining, ...untouched]);
  return { synced, failed };
}

export async function semanticSearch(
  query: string
): Promise<SearchResult[]> {
  const { supabase } = await assertCloudSession();
  const { data, error } = await supabase.functions.invoke("search-bookmarks", {
    body: { query, limit: 20 }
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data?.results || []) as Array<{
    resource: CloudResourceRow;
    score: number;
    match_reason?: string;
  }>).map((item) => ({
    resource: fromCloudRow(item.resource),
    score: item.score,
    matchReason: item.match_reason
  }));
}
