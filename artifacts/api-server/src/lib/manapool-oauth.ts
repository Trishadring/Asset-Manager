import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { db, manapoolOAuthConnectionsTable } from "@workspace/db";
import {
  DisconnectManapickResponse,
  GetManapickConnectionStatusResponse,
} from "@workspace/api-zod";

const AUTHORIZATION_ENDPOINT = "https://auth.manapool.com/oauth2/auth";
const TOKEN_ENDPOINT = "https://auth.manapool.com/oauth2/token";
const SESSION_COOKIE = "manapick_sid";
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUESTED_SCOPES = ["orders:read", "orders:write"] as const;

type OAuthTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
};

function getClientCredentials() {
  const clientId = process.env["MANAPOOL_CLIENT_ID"]?.trim();
  const clientSecret = process.env["MANAPOOL_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function sessionIdFromRequest(req: Request): string | null {
  const value = req.cookies?.[SESSION_COOKIE];
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
    ? value
    : null;
}

function secureCookieRequest(req: Request): boolean {
  return req.secure;
}

function getRedirectUri(req: Request): string {
  const configured = process.env["MANAPOOL_REDIRECT_URI"]?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:") {
      throw new Error("MANAPOOL_REDIRECT_URI must use HTTPS.");
    }
    return url.toString();
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

function setSessionCookie(res: Response, req: Request, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: secureCookieRequest(req),
    sameSite: "lax",
    path: "/",
  });
}

function clearSessionCookie(res: Response, req: Request): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: secureCookieRequest(req),
    sameSite: "lax",
    path: "/",
  });
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

async function clearPendingState(sessionId: string): Promise<void> {
  await db
    .update(manapoolOAuthConnectionsTable)
    .set({
      oauthState: null,
      codeVerifier: null,
      redirectUri: null,
      stateExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(manapoolOAuthConnectionsTable.sessionId, sessionId));
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
    const sessionId =
      sessionIdFromRequest(req) ?? randomBytes(32).toString("hex");
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const redirectUri = getRedirectUri(req);
    const stateExpiresAt = new Date(Date.now() + STATE_TTL_MS);

    setSessionCookie(res, req, sessionId);

    await db
      .insert(manapoolOAuthConnectionsTable)
      .values({
        sessionId,
        oauthState: state,
        codeVerifier,
        redirectUri,
        stateExpiresAt,
      })
      .onConflictDoUpdate({
        target: manapoolOAuthConnectionsTable.sessionId,
        set: {
          oauthState: state,
          codeVerifier,
          redirectUri,
          stateExpiresAt,
          updatedAt: new Date(),
        },
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
  const sessionId = sessionIdFromRequest(req);
  const state = queryString(req, "state");
  const code = queryString(req, "code");

  if (!sessionId || !state) {
    redirectWithError(res, "invalid_state");
    return;
  }

  try {
    const [connection] = await db
      .select()
      .from(manapoolOAuthConnectionsTable)
      .where(eq(manapoolOAuthConnectionsTable.sessionId, sessionId));

    if (
      !connection?.oauthState ||
      !connection.codeVerifier ||
      !connection.redirectUri ||
      !connection.stateExpiresAt ||
      connection.stateExpiresAt.getTime() < Date.now() ||
      !constantTimeEqual(connection.oauthState, state)
    ) {
      await clearPendingState(sessionId);
      redirectWithError(res, "invalid_state");
      return;
    }

    const providerError = queryString(req, "error");
    if (providerError) {
      await clearPendingState(sessionId);
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
      await clearPendingState(sessionId);
      redirectWithError(res, "connect_failed");
      return;
    }

    const credentials = getClientCredentials();
    if (!credentials) {
      await clearPendingState(sessionId);
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
        redirect_uri: connection.redirectUri,
        code_verifier: connection.codeVerifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const tokenBody = (await response
      .json()
      .catch(() => ({}))) as OAuthTokenResponse;
    if (!response.ok) {
      await clearPendingState(sessionId);
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
      await clearPendingState(sessionId);
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
      await clearPendingState(sessionId);
      redirectWithError(res, "invalid_scope");
      return;
    }

    await db
      .update(manapoolOAuthConnectionsTable)
      .set({
        accessToken,
        tokenExpiresAt: new Date(
          Date.now() + Math.min(expiresIn, 60 * 60) * 1000,
        ),
        scopes,
        oauthState: null,
        codeVerifier: null,
        redirectUri: null,
        stateExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(manapoolOAuthConnectionsTable.sessionId, sessionId));

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
  const sessionId = sessionIdFromRequest(req);
  if (!sessionId) {
    res.json({ connected: false, scopes: [], expiresAt: null });
    return;
  }

  const [connection] = await db
    .select()
    .from(manapoolOAuthConnectionsTable)
    .where(eq(manapoolOAuthConnectionsTable.sessionId, sessionId));

  const connected = Boolean(
    connection?.accessToken &&
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() > Date.now(),
  );

  if (!connected && connection?.tokenExpiresAt) {
    await db
      .delete(manapoolOAuthConnectionsTable)
      .where(eq(manapoolOAuthConnectionsTable.sessionId, sessionId));
    clearSessionCookie(res, req);
  } else if (
    connection?.stateExpiresAt &&
    connection.stateExpiresAt.getTime() <= Date.now()
  ) {
    await clearPendingState(sessionId);
  }

  res.json(GetManapickConnectionStatusResponse.parse({
    connected,
    scopes: connected
      ? connection.scopes.split(/\s+/).filter(Boolean)
      : [],
    expiresAt: connected ? connection.tokenExpiresAt : null,
  }));
}

export async function getManapoolAccessToken(
  req: Request,
): Promise<string | null> {
  const sessionId = sessionIdFromRequest(req);
  if (!sessionId) return null;

  const [connection] = await db
    .select()
    .from(manapoolOAuthConnectionsTable)
    .where(eq(manapoolOAuthConnectionsTable.sessionId, sessionId));

  if (
    !connection?.accessToken ||
    !connection.tokenExpiresAt ||
    connection.tokenExpiresAt.getTime() <= Date.now()
  ) {
    return null;
  }

  return connection.accessToken;
}

export async function disconnectManapool(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = sessionIdFromRequest(req);
  if (sessionId) {
    await db
      .delete(manapoolOAuthConnectionsTable)
      .where(eq(manapoolOAuthConnectionsTable.sessionId, sessionId));
  }
  clearSessionCookie(res, req);
  res.json(
    DisconnectManapickResponse.parse({
      connected: false,
      scopes: [],
      expiresAt: null,
    }),
  );
}
