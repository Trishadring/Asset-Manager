import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import {
  DisconnectManapickResponse,
  GetManapickConnectionStatusResponse,
} from "@workspace/api-zod";

const AUTHORIZATION_ENDPOINT = "https://auth.manapool.com/oauth2/auth";
const TOKEN_ENDPOINT = "https://auth.manapool.com/oauth2/token";
const SESSION_COOKIE = "manapick_sid";
const COOKIE_VERSION = "v1";
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LIFETIME_S = 60 * 60;
// Browsers reject cookies larger than about 4 KB (name, value and attributes).
const MAX_COOKIE_VALUE_LENGTH = 3800;
const MIN_SECRET_LENGTH = 32;
const REQUESTED_SCOPES = ["orders:read", "orders:write"] as const;

type OAuthTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
};

type PendingAuthorization = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
};

type ManapoolConnection = {
  accessToken: string;
  expiresAt: number;
  scopes: string;
};

type CookieSession = {
  pending?: PendingAuthorization;
  connection?: ManapoolConnection;
};

let cachedKey: { secret: string; key: Buffer } | null = null;

function getEncryptionKey(): Buffer | null {
  const secret = process.env["COOKIE_ENCRYPTION_KEY"]?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  if (cachedKey?.secret !== secret) {
    const key = Buffer.from(
      hkdfSync("sha256", secret, "", "manapick-session-cookie", 32),
    );
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

function getClientCredentials() {
  const clientId = process.env["MANAPOOL_CLIENT_ID"]?.trim();
  const clientSecret = process.env["MANAPOOL_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret || !getEncryptionKey()) return null;
  return { clientId, clientSecret };
}

function encryptSession(session: CookieSession, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${SESSION_COOKIE}.${COOKIE_VERSION}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const payload = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  return `${COOKIE_VERSION}.${payload.toString("base64url")}`;
}

function decryptSession(value: string, key: Buffer): CookieSession | null {
  const [version, encoded] = value.split(".", 2);
  if (version !== COOKIE_VERSION || !encoded) return null;
  try {
    const payload = Buffer.from(encoded, "base64url");
    if (payload.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      payload.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(`${SESSION_COOKIE}.${COOKIE_VERSION}`));
    decipher.setAuthTag(payload.subarray(payload.length - 16));
    const plaintext = Buffer.concat([
      decipher.update(payload.subarray(12, payload.length - 16)),
      decipher.final(),
    ]).toString("utf8");
    return parseSession(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

function parseSession(raw: unknown): CookieSession | null {
  if (!raw || typeof raw !== "object") return null;
  const { pending, connection } = raw as Record<string, unknown>;
  const session: CookieSession = {};

  if (pending && typeof pending === "object") {
    const p = pending as Record<string, unknown>;
    if (
      typeof p["state"] === "string" &&
      typeof p["codeVerifier"] === "string" &&
      typeof p["redirectUri"] === "string" &&
      typeof p["expiresAt"] === "number"
    ) {
      session.pending = {
        state: p["state"],
        codeVerifier: p["codeVerifier"],
        redirectUri: p["redirectUri"],
        expiresAt: p["expiresAt"],
      };
    }
  }

  if (connection && typeof connection === "object") {
    const c = connection as Record<string, unknown>;
    if (
      typeof c["accessToken"] === "string" &&
      typeof c["expiresAt"] === "number" &&
      typeof c["scopes"] === "string"
    ) {
      session.connection = {
        accessToken: c["accessToken"],
        expiresAt: c["expiresAt"],
        scopes: c["scopes"],
      };
    }
  }

  return session;
}

function readSession(req: Request): CookieSession | null {
  const value = req.cookies?.[SESSION_COOKIE];
  const key = getEncryptionKey();
  if (typeof value !== "string" || !key) return null;
  return decryptSession(value, key);
}

function hasSessionCookie(req: Request): boolean {
  return typeof req.cookies?.[SESSION_COOKIE] === "string";
}

function secureCookieRequest(req: Request): boolean {
  return req.secure || process.env["NODE_ENV"] === "production";
}

function getRedirectUri(req: Request): string {
  const configured = process.env["MANAPOOL_REDIRECT_URI"]?.trim();
  if (configured) {
    const url = new URL(configured);
    const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost)) {
      return url.toString();
    }
    throw new Error("MANAPOOL_REDIRECT_URI must use HTTPS.");
  }

  const protocol = req.secure ? "https" : "http";
  const allowedHostnames = new Set(
    [
      ...(process.env["REPLIT_DOMAINS"] ?? "").split(","),
      process.env["REPLIT_DEV_DOMAIN"] ?? "",
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(
            value.includes("://") ? value : `https://${value}`,
          ).hostname.toLowerCase();
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  const candidates = [
    req.get("x-forwarded-host")?.split(",")[0]?.trim(),
    req.get("host")?.split(",")[0]?.trim(),
  ].filter((value): value is string => Boolean(value));
  let url: URL | null = null;

  for (const candidate of candidates) {
    try {
      const candidateUrl = new URL(`${protocol}://${candidate.toLowerCase()}`);
      const isLocalhost = ["localhost", "127.0.0.1"].includes(
        candidateUrl.hostname,
      );
      if (isLocalhost || allowedHostnames.has(candidateUrl.hostname)) {
        url = candidateUrl;
        break;
      }
    } catch {
      // Ignore malformed forwarded hosts and try the next trusted candidate.
    }
  }

  if (!url) {
    throw new Error("ManaPool OAuth is only enabled for this app's Replit host.");
  }
  const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalhost) {
    throw new Error("ManaPool OAuth callbacks must use HTTPS.");
  }
  return new URL("/api/manapick/oauth/callback", url).toString();
}

function clearSessionCookie(res: Response, req: Request): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: secureCookieRequest(req),
    sameSite: "lax",
    path: "/",
  });
}

function writeSessionCookie(
  res: Response,
  req: Request,
  session: CookieSession,
): void {
  const key = getEncryptionKey();
  const now = Date.now();
  const expiresAt = Math.max(
    session.pending && session.pending.expiresAt > now
      ? session.pending.expiresAt
      : 0,
    session.connection && session.connection.expiresAt > now
      ? session.connection.expiresAt
      : 0,
  );
  if (!key || expiresAt === 0) {
    clearSessionCookie(res, req);
    return;
  }

  const value = encryptSession(session, key);
  if (value.length > MAX_COOKIE_VALUE_LENGTH) {
    throw new Error("Manapool session is too large to store in a cookie.");
  }
  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: secureCookieRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: expiresAt - now,
  });
}

function activeConnection(
  session: CookieSession | null,
): ManapoolConnection | null {
  const connection = session?.connection;
  return connection && connection.expiresAt > Date.now() ? connection : null;
}

function queryString(req: Request, key: string): string | null {
  const value = req.query[key];
  return typeof value === "string" ? value : null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function redirectWithError(res: Response, error: string): void {
  res.redirect(302, `/?manapool_error=${encodeURIComponent(error)}`);
}

function clearPendingState(
  res: Response,
  req: Request,
  session: CookieSession | null,
): void {
  writeSessionCookie(res, req, {
    connection: activeConnection(session) ?? undefined,
  });
}

export async function beginManapoolOAuth(
  req: Request,
  res: Response,
): Promise<void> {
  const credentials = getClientCredentials();
  if (!credentials) {
    redirectWithError(res, "not_configured");
    return;
  }

  try {
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const redirectUri = getRedirectUri(req);

    writeSessionCookie(res, req, {
      pending: {
        state,
        codeVerifier,
        redirectUri,
        expiresAt: Date.now() + STATE_TTL_MS,
      },
      connection: activeConnection(readSession(req)) ?? undefined,
    });

    const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", credentials.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", REQUESTED_SCOPES.join(" "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    res.redirect(302, authorizationUrl.toString());
  } catch (error) {
    req.log.error(
      { message: error instanceof Error ? error.message : "Unknown error" },
      "Could not start Manapool OAuth",
    );
    redirectWithError(res, "connect_failed");
  }
}

export async function completeManapoolOAuth(
  req: Request,
  res: Response,
): Promise<void> {
  const session = readSession(req);
  const state = queryString(req, "state");
  const code = queryString(req, "code");

  if (!session || !state) {
    if (hasSessionCookie(req) && !session) clearSessionCookie(res, req);
    redirectWithError(res, "invalid_state");
    return;
  }

  try {
    const pending = session.pending;
    if (
      !pending ||
      pending.expiresAt < Date.now() ||
      !constantTimeEqual(pending.state, state)
    ) {
      clearPendingState(res, req, session);
      redirectWithError(res, "invalid_state");
      return;
    }

    const providerError = queryString(req, "error");
    if (providerError) {
      clearPendingState(res, req, session);
      redirectWithError(
        res,
        providerError === "access_denied"
          ? "access_denied"
          : providerError === "invalid_scope"
            ? "invalid_scope"
            : "connect_failed",
      );
      return;
    }

    if (!code) {
      clearPendingState(res, req, session);
      redirectWithError(res, "connect_failed");
      return;
    }

    const credentials = getClientCredentials();
    if (!credentials) {
      clearPendingState(res, req, session);
      redirectWithError(res, "not_configured");
      return;
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(
          `${credentials.clientId}:${credentials.clientSecret}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.codeVerifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const tokenBody = (await response
      .json()
      .catch(() => ({}))) as OAuthTokenResponse;
    if (!response.ok) {
      clearPendingState(res, req, session);
      req.log.warn(
        { status: response.status },
        "Manapool OAuth token exchange failed",
      );
      redirectWithError(
        res,
        tokenBody.error === "invalid_scope" ? "invalid_scope" : "connect_failed",
      );
      return;
    }

    const accessToken =
      typeof tokenBody.access_token === "string"
        ? tokenBody.access_token
        : null;
    const expiresIn = Number(tokenBody.expires_in);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      clearPendingState(res, req, session);
      req.log.warn("Manapool OAuth returned an invalid token response");
      redirectWithError(res, "connect_failed");
      return;
    }

    const scopes =
      typeof tokenBody.scope === "string"
        ? tokenBody.scope
        : REQUESTED_SCOPES.join(" ");
    const grantedScopes = scopes.split(/\s+/).filter(Boolean);
    if (REQUESTED_SCOPES.some((scope) => !grantedScopes.includes(scope))) {
      clearPendingState(res, req, session);
      redirectWithError(res, "invalid_scope");
      return;
    }

    writeSessionCookie(res, req, {
      connection: {
        accessToken,
        expiresAt:
          Date.now() + Math.min(expiresIn, MAX_TOKEN_LIFETIME_S) * 1000,
        scopes,
      },
    });

    res.redirect(302, "/?manapool_connected=1");
  } catch (error) {
    req.log.error(
      { message: error instanceof Error ? error.message : "Unknown error" },
      "Could not complete Manapool OAuth",
    );
    redirectWithError(res, "connect_failed");
  }
}

export async function getManapoolConnectionStatus(
  req: Request,
  res: Response,
): Promise<void> {
  res.set("Cache-Control", "no-store");
  const session = readSession(req);
  const connection = activeConnection(session);

  const pendingActive = Boolean(
    session?.pending && session.pending.expiresAt > Date.now(),
  );
  if (!connection && !pendingActive && hasSessionCookie(req)) {
    clearSessionCookie(res, req);
  } else if (connection && session?.pending && !pendingActive) {
    clearPendingState(res, req, session);
  }

  res.json(GetManapickConnectionStatusResponse.parse({
    connected: Boolean(connection),
    scopes: connection
      ? connection.scopes.split(/\s+/).filter(Boolean)
      : [],
    expiresAt: connection ? new Date(connection.expiresAt) : null,
  }));
}

export async function getManapoolAccessToken(
  req: Request,
): Promise<string | null> {
  return activeConnection(readSession(req))?.accessToken ?? null;
}

export async function disconnectManapool(
  req: Request,
  res: Response,
): Promise<void> {
  clearSessionCookie(res, req);
  res.json(
    DisconnectManapickResponse.parse({
      connected: false,
      scopes: [],
      expiresAt: null,
    }),
  );
}
