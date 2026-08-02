import * as Sentry from "@sentry/node";
import type { Config } from "./config.js";

const unsafeUrl = /https?:\/\/[^\s"'<>]+/gi;
const bearerToken = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const apiKey = /\bsk-[A-Za-z0-9_-]{12,}\b/g;

export function scrubTelemetryText(value: string): string {
  return value
    .replace(unsafeUrl, "[redacted-url]")
    .replace(bearerToken, "Bearer [redacted]")
    .replace(apiKey, "[redacted-api-key]")
    .slice(0, 2_000);
}

type SanitizableEvent = {
  request?: unknown;
  user?: unknown;
  extra?: unknown;
  contexts?: unknown;
  server_name?: string;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
};

export function sanitizeTelemetryEvent<T extends SanitizableEvent>(event: T): T {
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.contexts;
  delete event.server_name;
  if (event.message) event.message = scrubTelemetryText(event.message);
  for (const exception of event.exception?.values || []) {
    if (exception.value) exception.value = scrubTelemetryText(exception.value);
  }
  return event;
}

export function sanitizeRequestLog(request: {
  method?: string;
  url?: string;
  headers?: { host?: string };
  ip?: string;
}): Record<string, string | undefined> {
  return {
    method: request.method,
    url: typeof request.url === "string" ? request.url.split("?", 1)[0] : "",
    host: request.headers?.host,
    remoteAddress: request.ip
  };
}

export function initializeErrorReporting(config: Config): void {
  if (!config.SENTRY_DSN) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    release: config.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    integrations: (integrations) => integrations.filter((integration) => (
      !["Fastify", "Http", "RequestData"].includes(integration.name)
    )),
    beforeSend: sanitizeTelemetryEvent
  });
}

export function captureOperationalError(
  error: unknown,
  operation: "startup" | "request" | "maintenance" | "retention",
  route?: string
): void {
  Sentry.withScope((scope) => {
    scope.setTag("operation", operation);
    if (route) scope.setTag("route", route);
    Sentry.captureException(error);
  });
}

export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  await Sentry.flush(timeoutMs);
}
