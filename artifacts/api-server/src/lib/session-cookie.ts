import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const SESSION_COOKIE = "manapick_sid";
export const COOKIE_VERSION = "v1";
// Browsers reject cookies larger than about 4 KB (name, value and attributes).
export const MAX_COOKIE_VALUE_LENGTH = 3800;
export const MIN_SECRET_LENGTH = 32;

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type PendingAuthorization = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
};

export type ManapoolConnection = {
  accessToken: string;
  expiresAt: number;
  scopes: string;
};

export type CookieSession = {
  pending?: PendingAuthorization;
  connection?: ManapoolConnection;
};

let cachedKey: { secret: string; key: Buffer } | null = null;

/** Derives the AES-256 key from the configured secret, or null if unusable. */
export function deriveEncryptionKey(rawSecret: string | undefined): Buffer | null {
  const secret = rawSecret?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  if (cachedKey?.secret !== secret) {
    const key = Buffer.from(
      hkdfSync("sha256", secret, "", "manapick-session-cookie", 32),
    );
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

function additionalData(): Buffer {
  return Buffer.from(`${SESSION_COOKIE}.${COOKIE_VERSION}`);
}

/**
 * Encrypts a session into a cookie value. Throws if the result would be too
 * large to store in a cookie.
 */
export function encryptSession(session: CookieSession, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additionalData());
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const payload = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  const value = `${COOKIE_VERSION}.${payload.toString("base64url")}`;
  if (value.length > MAX_COOKIE_VALUE_LENGTH) {
    throw new Error("Manapool session is too large to store in a cookie.");
  }
  return value;
}

/** Returns the session, or null if the value is malformed, tampered or forged. */
export function decryptSession(value: string, key: Buffer): CookieSession | null {
  const [version, encoded] = value.split(".", 2);
  if (version !== COOKIE_VERSION || !encoded) return null;
  try {
    const payload = Buffer.from(encoded, "base64url");
    if (payload.length < IV_LENGTH + TAG_LENGTH + 1) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      payload.subarray(0, IV_LENGTH),
    );
    decipher.setAAD(additionalData());
    decipher.setAuthTag(payload.subarray(payload.length - TAG_LENGTH));
    const plaintext = Buffer.concat([
      decipher.update(payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH)),
      decipher.final(),
    ]).toString("utf8");
    return parseSession(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

export function parseSession(raw: unknown): CookieSession | null {
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

export function activeConnection(
  session: CookieSession | null,
  now: number = Date.now(),
): ManapoolConnection | null {
  const connection = session?.connection;
  return connection && connection.expiresAt > now ? connection : null;
}
