export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bookmark-layer-gemini-key, x-bookmark-layer-ai-provider, x-bookmark-layer-ai-model, x-bookmark-layer-ai-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
