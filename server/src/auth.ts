import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { EnvelopeEncryption } from "./encryption.js";
import {
  generateOpaqueToken,
  sha256Base64Url,
  tokenHash
} from "./security.js";

const googleTokenSchema = z.object({
  id_token: z.string().min(1),
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional()
});

function authError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

type AuthenticatedAccount = {
  userId: string;
  deviceId: string;
  familyId: string;
};

type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

type AccountProfile = {
  email: string;
  name: string;
  avatarUrl: string;
};

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

export class AuthService {
  private readonly database: Database;
  private readonly config: Config;
  private readonly encryption: EnvelopeEncryption;

  constructor(database: Database, config: Config, encryption: EnvelopeEncryption) {
    this.database = database;
    this.config = config;
    this.encryption = encryption;
  }

  private allowedRedirect(redirectUri: string): boolean {
    try {
      const url = new URL(redirectUri);
      if (url.protocol !== "https:" || url.pathname !== "/auth") return false;
      const match = /^([a-p]{32})\.chromiumapp\.org$/.exec(url.hostname);
      return Boolean(match && this.config.allowedExtensionIds.has(match[1]));
    } catch {
      return false;
    }
  }

  async beginGoogleLogin(input: {
    codeChallenge: string;
    deviceId: string;
    redirectUri: string;
  }): Promise<string> {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
      throw authError("Invalid PKCE challenge.", 400);
    }
    if (!z.string().uuid().safeParse(input.deviceId).success) {
      throw authError("Invalid device identifier.", 400);
    }
    if (!this.allowedRedirect(input.redirectUri)) {
      throw authError("The extension redirect is not allowed.", 403);
    }
    const state = generateOpaqueToken();
    const nonce = generateOpaqueToken();
    await this.database.query(
      `INSERT INTO oauth_requests
        (state_hash, nonce_hash, code_challenge, device_id, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '5 minutes')`,
      [
        tokenHash(state, this.config.TOKEN_PEPPER),
        tokenHash(nonce, this.config.TOKEN_PEPPER),
        input.codeChallenge,
        input.deviceId,
        input.redirectUri
      ]
    );
    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.searchParams.set("client_id", this.config.GOOGLE_CLIENT_ID);
    google.searchParams.set("redirect_uri", this.config.GOOGLE_REDIRECT_URI);
    google.searchParams.set("response_type", "code");
    google.searchParams.set("scope", "openid email profile");
    google.searchParams.set("state", state);
    google.searchParams.set("nonce", nonce);
    google.searchParams.set("prompt", "select_account");
    return google.toString();
  }

  async completeGoogleLogin(code: string, state: string): Promise<string> {
    if (!code || !state) throw authError("Google did not return an authorization code.", 400);
    const stateHash = tokenHash(state, this.config.TOKEN_PEPPER);
    const request = await this.database.query<{
      nonce_hash: string;
      code_challenge: string;
      device_id: string;
      redirect_uri: string;
    }>(
      `UPDATE oauth_requests
       SET consumed_at = now()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING nonce_hash, code_challenge, device_id, redirect_uri`,
      [stateHash]
    );
    const pending = request.rows[0];
    if (!pending) throw authError("The login request expired or was already used.", 400);

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.GOOGLE_CLIENT_ID,
        client_secret: this.config.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.config.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code"
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw authError("Google token exchange failed.", 502);
    const tokens = googleTokenSchema.parse(await response.json());
    const verified = await jwtVerify(tokens.id_token, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: this.config.GOOGLE_CLIENT_ID
    });
    const subject = verified.payload.sub;
    const email = typeof verified.payload.email === "string" ? verified.payload.email : "";
    const nonce = typeof verified.payload.nonce === "string" ? verified.payload.nonce : "";
    if (
      !subject ||
      !email ||
      verified.payload.email_verified !== true ||
      tokenHash(nonce, this.config.TOKEN_PEPPER) !== pending.nonce_hash
    ) {
      throw authError("Google identity verification failed.", 401);
    }
    const profile: AccountProfile = {
      email,
      name: typeof verified.payload.name === "string" ? verified.payload.name.slice(0, 240) : "",
      avatarUrl: typeof verified.payload.picture === "string" ? verified.payload.picture.slice(0, 2_048) : ""
    };
    const userId = await this.upsertUser(subject, profile);
    const ticket = generateOpaqueToken();
    await this.database.query(
      `INSERT INTO auth_tickets
        (ticket_hash, user_id, device_id, code_challenge, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '60 seconds')`,
      [
        tokenHash(ticket, this.config.TOKEN_PEPPER),
        userId,
        pending.device_id,
        pending.code_challenge,
        pending.redirect_uri
      ]
    );
    const redirect = new URL(pending.redirect_uri);
    redirect.hash = new URLSearchParams({ ticket }).toString();
    return redirect.toString();
  }

  private async upsertUser(subject: string, profile: AccountProfile): Promise<string> {
    const subjectHash = tokenHash(subject, this.config.TOKEN_PEPPER);
    const emailHash = tokenHash(profile.email.toLocaleLowerCase(), this.config.TOKEN_PEPPER);
    const existing = await this.database.query<{ id: string }>(
      "SELECT id FROM users WHERE google_sub_hash = $1 AND deleted_at IS NULL",
      [subjectHash]
    );
    const userId = existing.rows[0]?.id || randomUUID();
    if (!existing.rowCount) {
      await this.database.query(
        `INSERT INTO users
          (id, google_sub_hash, email_hash, profile_payload, quota_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, subjectHash, emailHash, Buffer.alloc(0), this.config.DEFAULT_QUOTA_BYTES]
      );
      await this.database.query(
        "INSERT INTO account_usage (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [userId]
      );
    }
    const encrypted = await this.encryption.encryptJson(userId, "profile", profile);
    await this.database.query(
      `UPDATE users
       SET email_hash = $2, profile_payload = $3, updated_at = now(), deletion_requested_at = NULL
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId, emailHash, encrypted]
    );
    return userId;
  }

  async exchangeTicket(input: {
    ticket: string;
    codeVerifier: string;
    deviceId: string;
    deviceName?: string;
  }): Promise<IssuedTokens & { profile: AccountProfile; userId: string }> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const ticket = await client.query<{
        user_id: string;
        device_id: string;
        code_challenge: string;
      }>(
        `SELECT user_id, device_id, code_challenge
         FROM auth_tickets
         WHERE ticket_hash = $1 AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash(input.ticket, this.config.TOKEN_PEPPER)]
      );
      const pending = ticket.rows[0];
      if (
        !pending ||
        pending.device_id !== input.deviceId ||
        sha256Base64Url(input.codeVerifier) !== pending.code_challenge
      ) {
        throw authError("The login ticket is invalid, expired, or does not match this device.", 401);
      }
      await client.query(
        "UPDATE auth_tickets SET consumed_at = now() WHERE ticket_hash = $1",
        [tokenHash(input.ticket, this.config.TOKEN_PEPPER)]
      );
      const devicePayload = input.deviceName
        ? await this.encryption.encryptJson(
            pending.user_id,
            `device:${input.deviceId}`,
            { name: input.deviceName.slice(0, 160) }
          )
        : null;
      await client.query(
        `INSERT INTO devices (user_id, device_id, name_payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, device_id) DO UPDATE
           SET name_payload = COALESCE(EXCLUDED.name_payload, devices.name_payload),
               last_seen_at = now(), revoked_at = NULL`,
        [pending.user_id, input.deviceId, devicePayload]
      );
      const familyId = randomUUID();
      await client.query(
        "INSERT INTO token_families (id, user_id, device_id) VALUES ($1, $2, $3)",
        [familyId, pending.user_id, input.deviceId]
      );
      const issued = await this.issueTokens(client, {
        userId: pending.user_id,
        deviceId: input.deviceId,
        familyId
      });
      await client.query("COMMIT");
      const profileRow = await this.database.query<{ profile_payload: Buffer }>(
        "SELECT profile_payload FROM users WHERE id = $1",
        [pending.user_id]
      );
      const profile = await this.encryption.decryptJson<AccountProfile>(
        pending.user_id,
        "profile",
        profileRow.rows[0].profile_payload
      );
      return { ...issued, profile, userId: pending.user_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async issueTokens(
    client: Pick<Database, "query">,
    account: AuthenticatedAccount
  ): Promise<IssuedTokens> {
    const accessToken = generateOpaqueToken();
    const refreshToken = generateOpaqueToken();
    const accessExpiresAt = new Date(Date.now() + 10 * 60_000);
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    await client.query(
      `INSERT INTO access_tokens
        (token_hash, family_id, user_id, device_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tokenHash(accessToken, this.config.TOKEN_PEPPER),
        account.familyId,
        account.userId,
        account.deviceId,
        accessExpiresAt
      ]
    );
    await client.query(
      `INSERT INTO refresh_tokens
        (token_hash, family_id, user_id, device_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tokenHash(refreshToken, this.config.TOKEN_PEPPER),
        account.familyId,
        account.userId,
        account.deviceId,
        refreshExpiresAt
      ]
    );
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString()
    };
  }

  async authenticateAccessToken(token: string): Promise<AuthenticatedAccount | null> {
    if (!token) return null;
    const result = await this.database.query<{
      user_id: string;
      device_id: string;
      family_id: string;
    }>(
      `SELECT a.user_id, a.device_id, a.family_id
       FROM access_tokens a
       JOIN token_families f ON f.id = a.family_id
       JOIN devices d ON d.user_id = a.user_id AND d.device_id = a.device_id
       JOIN users u ON u.id = a.user_id
       WHERE a.token_hash = $1
         AND a.expires_at > now()
         AND a.revoked_at IS NULL
         AND f.revoked_at IS NULL
         AND d.revoked_at IS NULL
         AND u.deleted_at IS NULL`,
      [tokenHash(token, this.config.TOKEN_PEPPER)]
    );
    const row = result.rows[0];
    if (!row) return null;
    void this.database.query(
      "UPDATE devices SET last_seen_at = now() WHERE user_id = $1 AND device_id = $2",
      [row.user_id, row.device_id]
    );
    return { userId: row.user_id, deviceId: row.device_id, familyId: row.family_id };
  }

  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const hash = tokenHash(refreshToken, this.config.TOKEN_PEPPER);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        user_id: string;
        device_id: string;
        family_id: string;
        consumed_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
        family_revoked_at: Date | null;
      }>(
        `SELECT r.user_id, r.device_id, r.family_id, r.consumed_at,
                r.revoked_at, r.expires_at, f.revoked_at AS family_revoked_at
         FROM refresh_tokens r
         JOIN token_families f ON f.id = r.family_id
         WHERE r.token_hash = $1
         FOR UPDATE`,
        [hash]
      );
      const row = result.rows[0];
      if (!row) throw authError("Refresh token is invalid.", 401);
      if (row.consumed_at) {
        await client.query(
          `UPDATE token_families
           SET revoked_at = now(), replay_detected_at = now()
           WHERE id = $1`,
          [row.family_id]
        );
        await client.query("COMMIT");
        throw authError("Refresh token replay was detected; this device must sign in again.", 401);
      }
      if (row.revoked_at || row.family_revoked_at || row.expires_at.getTime() <= Date.now()) {
        throw authError("Refresh token has expired or was revoked.", 401);
      }
      await client.query("UPDATE refresh_tokens SET consumed_at = now() WHERE token_hash = $1", [hash]);
      const issued = await this.issueTokens(client, {
        userId: row.user_id,
        deviceId: row.device_id,
        familyId: row.family_id
      });
      await client.query(
        "UPDATE refresh_tokens SET replaced_by_hash = $2 WHERE token_hash = $1",
        [hash, tokenHash(issued.refreshToken, this.config.TOKEN_PEPPER)]
      );
      await client.query("COMMIT");
      return issued;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async signOut(account: AuthenticatedAccount): Promise<void> {
    await this.database.query(
      `UPDATE token_families SET revoked_at = now()
       WHERE id = $1 AND user_id = $2`,
      [account.familyId, account.userId]
    );
  }

  async profile(account: AuthenticatedAccount): Promise<AccountProfile & { userId: string }> {
    const row = await this.database.query<{ profile_payload: Buffer }>(
      "SELECT profile_payload FROM users WHERE id = $1 AND deleted_at IS NULL",
      [account.userId]
    );
    if (!row.rows[0]) throw authError("Account is unavailable.", 404);
    return {
      ...(await this.encryption.decryptJson<AccountProfile>(
        account.userId,
        "profile",
        row.rows[0].profile_payload
      )),
      userId: account.userId
    };
  }
}

export type { AccountProfile, AuthenticatedAccount, IssuedTokens };
