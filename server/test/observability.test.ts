import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeRequestLog,
  sanitizeTelemetryEvent
} from "../src/observability.js";

test("request logs remove OAuth query parameters and authorization headers", () => {
  const logged = sanitizeRequestLog({
    method: "GET",
    url: "/v1/auth/google/callback?code=secret-code&state=secret-state",
    headers: { host: "sync.example.test" },
    ip: "127.0.0.1",
    authorization: "Bearer secret-token"
  } as Parameters<typeof sanitizeRequestLog>[0] & { authorization: string });
  assert.deepEqual(logged, {
    method: "GET",
    url: "/v1/auth/google/callback",
    host: "sync.example.test",
    remoteAddress: "127.0.0.1"
  });
  assert.equal(JSON.stringify(logged).includes("secret"), false);
});

test("telemetry drops request context, user data and secret-like text", () => {
  const sanitized = sanitizeTelemetryEvent({
    request: { url: "https://example.test/private?token=secret" },
    user: { email: "owner@example.test" },
    extra: { bookmarkTitle: "private" },
    contexts: { runtime: { databaseUrl: "secret" } },
    server_name: "production-host",
    message: "Failed https://example.test/private?token=secret Bearer abc.def.ghi sk-test-secret-value",
    exception: { values: [{ value: "Fetch https://example.test/private?q=secret" }] }
  });
  assert.equal("request" in sanitized, false);
  assert.equal("user" in sanitized, false);
  assert.equal("extra" in sanitized, false);
  assert.equal("contexts" in sanitized, false);
  assert.equal("server_name" in sanitized, false);
  assert.equal(sanitized.message, "Failed [redacted-url] Bearer [redacted] [redacted-api-key]");
  assert.equal(sanitized.exception?.values?.[0]?.value, "Fetch [redacted-url]");
});
