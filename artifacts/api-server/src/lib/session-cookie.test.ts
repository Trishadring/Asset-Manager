import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COOKIE_VERSION,
  MAX_COOKIE_VALUE_LENGTH,
  activeConnection,
  decryptSession,
  deriveEncryptionKey,
  encryptSession,
  encryptSessionFitting,
  parseSession,
  type CookieSession,
} from "./session-cookie";

const SECRET = "a".repeat(32);
const key = deriveEncryptionKey(SECRET)!;
const otherKey = deriveEncryptionKey("b".repeat(32))!;

const session: CookieSession = {
  pending: {
    state: "state",
    codeVerifier: "verifier",
    redirectUri: "https://example.com/api/manapick/oauth/callback",
    expiresAt: 2_000,
  },
  connection: {
    accessToken: "token",
    expiresAt: 3_000,
    scopes: "orders:read orders:write",
  },
};

function flipChar(value: string, index: number): string {
  const chars = value.split("");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

describe("deriveEncryptionKey", () => {
  it("returns a 32-byte key for a long enough secret", () => {
    assert.equal(key.length, 32);
  });

  it("is deterministic and trims whitespace", () => {
    assert.deepEqual(deriveEncryptionKey(`  ${SECRET}\n`), key);
  });

  it("derives different keys for different secrets", () => {
    assert.notDeepEqual(key, otherKey);
  });

  it("rejects missing, empty and short secrets", () => {
    assert.equal(deriveEncryptionKey(undefined), null);
    assert.equal(deriveEncryptionKey(""), null);
    assert.equal(deriveEncryptionKey("short"), null);
    assert.equal(deriveEncryptionKey("a".repeat(31)), null);
  });
});

describe("encryptSession / decryptSession", () => {
  it("round-trips a session", () => {
    const value = encryptSession(session, key);
    assert.deepEqual(decryptSession(value, key), session);
  });

  it("prefixes the version and does not expose the token", () => {
    const value = encryptSession(session, key);
    assert.ok(value.startsWith(`${COOKIE_VERSION}.`));
    assert.ok(!value.includes("token"));
    assert.ok(!Buffer.from(value.split(".")[1]!, "base64url").includes("token"));
  });

  it("uses a random IV so identical sessions encrypt differently", () => {
    assert.notEqual(encryptSession(session, key), encryptSession(session, key));
  });

  it("rejects a cookie encrypted with a different key", () => {
    assert.equal(decryptSession(encryptSession(session, otherKey), key), null);
  });

  it("rejects tampering with the IV, ciphertext or auth tag", () => {
    const value = encryptSession(session, key);
    const [version, encoded] = value.split(".") as [string, string];
    const length = encoded.length;
    for (const index of [0, 5, Math.floor(length / 2), length - 5]) {
      const tampered = `${version}.${flipChar(encoded, index)}`;
      assert.equal(decryptSession(tampered, key), null, `index ${index}`);
    }
  });

  it("rejects truncated and extended payloads", () => {
    const value = encryptSession(session, key);
    assert.equal(decryptSession(value.slice(0, -4), key), null);
    assert.equal(decryptSession(`${value}AAAA`, key), null);
  });

  it("rejects an unknown or missing version prefix", () => {
    const [, encoded] = encryptSession(session, key).split(".") as [string, string];
    assert.equal(decryptSession(`v2.${encoded}`, key), null);
    assert.equal(decryptSession(encoded, key), null);
    assert.equal(decryptSession(`${COOKIE_VERSION}.`, key), null);
  });

  it("rejects empty, garbage and too-short values", () => {
    assert.equal(decryptSession("", key), null);
    assert.equal(decryptSession("not a cookie", key), null);
    assert.equal(decryptSession(`${COOKIE_VERSION}.AAAA`, key), null);
    assert.equal(decryptSession(`${COOKIE_VERSION}.!!!!`, key), null);
  });

  it("ignores unknown or malformed fields after decrypting", () => {
    const value = encryptSession(
      { connection: { accessToken: 1 } } as unknown as CookieSession,
      key,
    );
    assert.deepEqual(decryptSession(value, key), {});
  });

  it("throws when the encrypted session is too large for a cookie", () => {
    const oversized: CookieSession = {
      connection: {
        accessToken: "x".repeat(MAX_COOKIE_VALUE_LENGTH),
        expiresAt: 3_000,
        scopes: "orders:read orders:write",
      },
    };
    assert.throws(() => encryptSession(oversized, key), /too large/);
  });

  it("accepts a session just under the size cap", () => {
    const overhead = encryptSession(
      { connection: { accessToken: "", expiresAt: 3_000, scopes: "" } },
      key,
    ).length;
    // base64url inflates by 4/3, so leave room for it.
    const accessToken = "x".repeat(
      Math.floor(((MAX_COOKIE_VALUE_LENGTH - overhead) * 3) / 4) - 4,
    );
    const value = encryptSession(
      { connection: { accessToken, expiresAt: 3_000, scopes: "" } },
      key,
    );
    assert.ok(value.length <= MAX_COOKIE_VALUE_LENGTH);
    assert.equal(decryptSession(value, key)?.connection?.accessToken, accessToken);
  });
});

describe("encryptSessionFitting", () => {
  const pending = session.pending!;
  const bigConnection = {
    accessToken: "x".repeat(2_700),
    expiresAt: 3_000,
    scopes: "orders:read orders:write",
  };

  it("keeps both parts when they fit", () => {
    const value = encryptSessionFitting(session, key);
    assert.deepEqual(decryptSession(value, key), session);
  });

  it("drops the existing connection when pending plus connection is too large", () => {
    const both: CookieSession = { pending, connection: bigConnection };
    assert.throws(() => encryptSession(both, key), /too large/);
    const value = encryptSessionFitting(both, key);
    assert.ok(value.length <= MAX_COOKIE_VALUE_LENGTH);
    assert.deepEqual(decryptSession(value, key), { pending });
  });

  it("still throws when a connection alone is too large", () => {
    const oversized: CookieSession = {
      connection: { ...bigConnection, accessToken: "x".repeat(MAX_COOKIE_VALUE_LENGTH) },
    };
    assert.throws(() => encryptSessionFitting(oversized, key), /too large/);
  });
});

describe("parseSession", () => {
  it("rejects non-objects", () => {
    assert.equal(parseSession(null), null);
    assert.equal(parseSession("x"), null);
    assert.equal(parseSession(5), null);
  });

  it("drops incomplete pending and connection entries", () => {
    assert.deepEqual(
      parseSession({
        pending: { state: "s" },
        connection: { accessToken: "t", expiresAt: "soon", scopes: "x" },
      }),
      {},
    );
  });
});

describe("activeConnection", () => {
  const connection = { accessToken: "t", expiresAt: 1_000, scopes: "s" };

  it("returns the connection before it expires", () => {
    assert.deepEqual(activeConnection({ connection }, 999), connection);
  });

  it("returns null at and after expiry", () => {
    assert.equal(activeConnection({ connection }, 1_000), null);
    assert.equal(activeConnection({ connection }, 5_000), null);
  });

  it("returns null without a session or connection", () => {
    assert.equal(activeConnection(null), null);
    assert.equal(activeConnection({}), null);
  });
});
