import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z, ZodError } from "zod";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { EnvelopeEncryption } from "./encryption.js";
import type { ObjectStore } from "./object-store.js";
import { AuthService, type AuthenticatedAccount } from "./auth.js";
import { SyncService } from "./sync.js";
import { AssetService } from "./assets.js";
import { AccountService } from "./account.js";
import { captureOperationalError, sanitizeRequestLog } from "./observability.js";
import {
  renderHomePage,
  renderPrivacyPage,
  renderTermsPage
} from "./public-pages.js";

const ticketSchema = z.object({
  ticket: z.string().min(20).max(512),
  codeVerifier: z.string().min(43).max(128),
  deviceId: z.string().uuid(),
  deviceName: z.string().max(160).optional()
}).strict();

const refreshSchema = z.object({ refreshToken: z.string().min(20).max(512) }).strict();

function bearerToken(request: FastifyRequest): string {
  const value = request.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export async function buildApp(dependencies: {
  config: Config;
  database: Database;
  encryption: EnvelopeEncryption;
  objectStore: ObjectStore;
}) {
  const { config, database, encryption, objectStore } = dependencies;
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : {
      level: "info",
      serializers: {
        req: sanitizeRequestLog
      }
    },
    bodyLimit: 768 * 1024,
    requestTimeout: 30_000,
    trustProxy: "127.0.0.1"
  });
  await app.register(rateLimit, { global: false });

  const auth = new AuthService(database, config, encryption);
  const sync = new SyncService(database, encryption);
  const assets = new AssetService(database, objectStore, config, encryption);
  const account = new AccountService(database, encryption);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
    if (!match || !config.allowedExtensionIds.has(match[1])) {
      return reply.code(403).send({ error: "origin_not_allowed" });
    }
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Headers", "authorization, content-type, x-request-id");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    reply.header("Access-Control-Max-Age", "600");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof ZodError
      ? 400
      : typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
      captureOperationalError(error, "request", request.routeOptions.url);
    }
    const message = error instanceof Error ? error.message : "Request failed.";
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_error" : "request_failed",
      message: statusCode >= 500 && config.NODE_ENV === "production"
        ? "服务暂时不可用，请稍后再试。"
        : message
    });
  });

  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    const resolved = await auth.authenticateAccessToken(bearerToken(request));
    if (!resolved) throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
    return resolved;
  }

  function sendPublicPage(reply: FastifyReply, html: string) {
    return reply
      .header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .header("Cross-Origin-Opener-Policy", "same-origin")
      .header("X-Frame-Options", "DENY")
      .type("text/html; charset=utf-8")
      .send(html);
  }

  app.get("/", async (_request, reply) =>
    sendPublicPage(reply, renderHomePage(config.PUBLIC_BASE_URL))
  );
  app.get("/privacy", async (_request, reply) =>
    sendPublicPage(reply, renderPrivacyPage(config.PUBLIC_BASE_URL))
  );
  app.get("/terms", async (_request, reply) =>
    sendPublicPage(reply, renderTermsPage(config.PUBLIC_BASE_URL))
  );

  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async (_request, reply) => {
    await database.query("SELECT 1");
    if (config.NODE_ENV === "production" && !objectStore.configured) {
      return reply.code(503).send({ ok: false, dependency: "cos" });
    }
    return { ok: true };
  });

  app.get("/v1/auth/google/start", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const query = z.object({
      codeChallenge: z.string(),
      deviceId: z.string(),
      redirectUri: z.string()
    }).parse(request.query);
    return reply.redirect(await auth.beginGoogleLogin(query));
  });

  app.get("/v1/auth/google/callback", {
    config: { rateLimit: { max: 40, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    return reply.redirect(await auth.completeGoogleLogin(query.code, query.state));
  });

  app.post("/v1/auth/ticket", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
  }, async (request) => auth.exchangeTicket(ticketSchema.parse(request.body)));

  app.post("/v1/auth/refresh", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, async (request) => auth.refresh(refreshSchema.parse(request.body).refreshToken));

  app.post("/v1/auth/logout", async (request) => {
    await auth.signOut(await requireAccount(request));
    return { signedOut: true };
  });

  app.get("/v1/account", async (request) => auth.profile(await requireAccount(request)));
  app.get("/v1/account/usage", async (request) => account.usage(await requireAccount(request)));
  app.get("/v1/account/export", {
    config: { rateLimit: { max: 6, timeWindow: "1 hour" } }
  }, async (request) => {
    const query = z.object({
      resourceOffset: z.coerce.number().int().min(0).default(0),
      resourceLimit: z.coerce.number().int().min(1).max(500).default(200)
    }).parse(request.query);
    const current = await requireAccount(request);
    const [profile, usage, resources, entities, conflicts, assetManifest] = await Promise.all([
      auth.profile(current),
      account.usage(current),
      sync.bootstrapResources(current, query.resourceOffset, query.resourceLimit),
      query.resourceOffset === 0 ? sync.bootstrapEntities(current) : Promise.resolve({ entities: [] }),
      query.resourceOffset === 0 ? sync.exportConflicts(current) : Promise.resolve({ conflicts: [] }),
      query.resourceOffset === 0 ? assets.list(current) : Promise.resolve([])
    ]);
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile,
      usage,
      resources: resources.resources,
      nextResourceOffset: resources.nextOffset,
      entities: entities.entities,
      conflictVersions: conflicts.conflicts,
      assetManifest,
      assetDownloadPathTemplate: "/v1/assets/{assetId}/download"
    };
  });
  app.get("/v1/account/devices", async (request) => ({ devices: await account.devices(await requireAccount(request)) }));
  app.delete<{ Params: { deviceId: string } }>("/v1/account/devices/:deviceId", async (request) => {
    const current = await requireAccount(request);
    const deviceId = z.string().uuid().parse(request.params.deviceId);
    await account.revokeDevice(current, deviceId);
    return { revoked: true };
  });
  app.delete("/v1/account", async (request) => {
    const confirmation = z.object({ confirmation: z.literal("DELETE AARRE DATA") }).parse(request.body);
    void confirmation;
    return account.requestDeletion(await requireAccount(request));
  });

  app.put<{ Params: { resourceKey: string } }>("/v1/sync/resources/:resourceKey", {
    config: { rateLimit: { max: 600, timeWindow: "1 minute" } }
  }, async (request) => sync.upsertResource(
    await requireAccount(request),
    request.params.resourceKey,
    request.body
  ));

  app.get("/v1/sync/bootstrap", async (request) => {
    const query = z.object({
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(500).default(200)
    }).parse(request.query);
    return sync.bootstrapResources(await requireAccount(request), query.offset, query.limit);
  });

  app.get("/v1/sync/changes", async (request) => {
    const query = z.object({
      cursor: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(500).default(200)
    }).parse(request.query);
    return sync.changes(await requireAccount(request), query.cursor, query.limit);
  });

  app.put("/v1/sync/entities", {
    config: { rateLimit: { max: 600, timeWindow: "1 minute" } }
  }, async (request) => sync.upsertEntity(await requireAccount(request), request.body));

  app.get("/v1/sync/entities", async (request) => sync.bootstrapEntities(await requireAccount(request)));

  app.get("/v1/sync/conflicts", async (request) => sync.listConflicts(await requireAccount(request)));

  app.post<{ Params: { conflictId: string } }>("/v1/sync/conflicts/:conflictId/resolve", async (request) =>
    sync.resolveConflict(
      await requireAccount(request),
      request.params.conflictId,
      request.body
    )
  );

  app.post("/v1/assets/upload", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
  }, async (request) => assets.createUpload(await requireAccount(request), request.body));

  app.post<{ Params: { assetId: string } }>("/v1/assets/:assetId/complete", async (request) => {
    const assetId = z.string().uuid().parse(request.params.assetId);
    return assets.completeUpload(await requireAccount(request), assetId, request.body);
  });

  app.get<{ Params: { assetId: string } }>("/v1/assets/:assetId/download", async (request) => {
    const assetId = z.string().uuid().parse(request.params.assetId);
    return assets.downloadUrl(await requireAccount(request), assetId);
  });

  app.get("/v1/assets", async (request) => ({ assets: await assets.list(await requireAccount(request)) }));
  app.delete("/v1/assets", async (request) => assets.deleteAllForAccount(await requireAccount(request)));

  return { app, services: { auth, sync, assets, account } };
}
