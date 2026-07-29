import { z } from "npm:zod@4.4.3";
import { embedWithGemini } from "../_shared/gemini.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { authenticatedClient } from "../_shared/supabase.ts";

const requestSchema = z.object({
  query: z.string().min(2).max(1_000),
  limit: z.number().int().min(1).max(50).optional().default(20)
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { supabase } = await authenticatedClient(request);
    const body = requestSchema.parse(await request.json());
    const embedding = await embedWithGemini(
      body.query,
      "RETRIEVAL_QUERY"
    );

    const { data, error } = await supabase.rpc("match_resources", {
      query_embedding: embedding,
      match_threshold: 0.28,
      match_count: body.limit
    });

    if (error) {
      throw new Error(error.message);
    }

    const results = (data || []).map((row: any) => {
      const { similarity, ...resource } = row;
      const tagHint = Array.isArray(resource.tags)
        ? resource.tags.slice(0, 3).join("、")
        : "";
      return {
        resource,
        score: similarity,
        match_reason: tagHint ? `相关主题：${tagHint}` : "内容语义相近"
      };
    });

    return jsonResponse({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: "Invalid request" }, 400);
    }
    if (message === "GEMINI_NOT_CONFIGURED") {
      return jsonResponse({ error: "AI service is not configured" }, 503);
    }

    console.error("search-bookmarks failed", message);
    return jsonResponse({ error: "Semantic search failed" }, 502);
  }
});
