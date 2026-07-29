import { z } from "npm:zod@4.4.3";
import {
  embedWithGemini,
  enrichWithGemini
} from "../_shared/gemini.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { authenticatedClient } from "../_shared/supabase.ts";

const requestSchema = z.object({
  resource_key: z.string().min(32).max(128),
  content: z.string().min(80).max(80_000),
  selected_text: z.string().max(4_000).optional().default(""),
  user_note: z.string().max(2_000).optional().default("")
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let resourceKey: string | undefined;
  let supabase: Awaited<ReturnType<typeof authenticatedClient>>["supabase"] | undefined;
  let userId: string | undefined;

  try {
    const auth = await authenticatedClient(request);
    supabase = auth.supabase;
    userId = auth.user.id;

    const body = requestSchema.parse(await request.json());
    resourceKey = body.resource_key;

    const { data: resource, error: readError } = await supabase
      .from("resources")
      .select("*")
      .eq("user_id", userId)
      .eq("resource_key", resourceKey)
      .single();

    if (readError || !resource) {
      return jsonResponse({ error: "Resource not found" }, 404);
    }

    await supabase
      .from("resources")
      .update({ ai_status: "processing" })
      .eq("user_id", userId)
      .eq("resource_key", resourceKey);

    const enrichment = await enrichWithGemini({
      title: resource.title,
      url: resource.url,
      userNote: body.user_note,
      selectedText: body.selected_text,
      content: body.content
    });

    const embeddingText = [
      resource.title,
      enrichment.summary,
      enrichment.tags.join(", "),
      enrichment.topics.join(", "),
      enrichment.key_points.join(" "),
      enrichment.use_cases.join(" "),
      body.user_note,
      body.selected_text
    ]
      .filter(Boolean)
      .join("\n");

    const embedding = await embedWithGemini(
      embeddingText,
      "RETRIEVAL_DOCUMENT",
      resource.title
    );

    const { data: updated, error: updateError } = await supabase
      .from("resources")
      .update({
        summary: enrichment.summary,
        tags: enrichment.tags,
        topics: enrichment.topics,
        ai_metadata: {
          content_type: enrichment.content_type,
          key_points: enrichment.key_points,
          use_cases: enrichment.use_cases,
          model:
            Deno.env.get("GEMINI_SUMMARY_MODEL") ||
            "gemini-2.5-flash-lite"
        },
        embedding,
        ai_status: "ready"
      })
      .eq("user_id", userId)
      .eq("resource_key", resourceKey)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return jsonResponse({ resource: updated });
  } catch (error) {
    if (supabase && userId && resourceKey) {
      await supabase
        .from("resources")
        .update({ ai_status: "failed" })
        .eq("user_id", userId)
        .eq("resource_key", resourceKey);
    }

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

    console.error("enrich-bookmark failed", message);
    return jsonResponse({ error: "AI enrichment failed" }, 502);
  }
});
