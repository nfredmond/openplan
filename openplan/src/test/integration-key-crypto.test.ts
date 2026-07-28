import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptIntegrationKey,
  encryptIntegrationKey,
  INTEGRATION_KEY_SECRET_MIN_LENGTH,
  integrationKeyEncryptionAvailable,
  integrationKeyLast4,
} from "@/lib/integrations/key-crypto";

const SECRET = "unit-test-operator-secret-0123456789";
const PLAINTEXT = "sk-ant-api03-example-key-value-1234";

/**
 * Construct a LEGACY v1 ciphertext exactly as the pre-scrypt scheme wrote it:
 * unsalted sha256(secret) key, 12-byte IV, aes-256-gcm, `v1:<iv>:<tag>:<ct>`.
 * Rows like this exist in real deployments; the read path must keep accepting
 * them even though every new write is v2.
 */
function legacyV1Encrypt(secret: string, plaintext: string): string {
  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("integration key crypto", () => {
  it("round-trips a key in the v2 salted format and exposes only the last four characters", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", SECRET);
    const stored = encryptIntegrationKey(PLAINTEXT);

    expect(stored.startsWith("v2:")).toBe(true);
    expect(stored.split(":")).toHaveLength(5);
    expect(stored).not.toContain(PLAINTEXT);
    expect(decryptIntegrationKey(stored)).toBe(PLAINTEXT);
    expect(integrationKeyLast4(PLAINTEXT)).toBe("1234");
  });

  it("uses a fresh salt and IV per encryption — identical plaintexts differ on disk", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", SECRET);
    const first = encryptIntegrationKey(PLAINTEXT);
    const second = encryptIntegrationKey(PLAINTEXT);
    expect(first).not.toBe(second);
    // The salt segment itself differs, not just the IV/ciphertext.
    expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
  });

  it("returns null (never throws, never partial plaintext) on v2 tampering", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", SECRET);
    const stored = encryptIntegrationKey(PLAINTEXT);
    const parts = stored.split(":");

    // Flip one character of the ciphertext segment; GCM authentication fails.
    const flipped = parts[4][0] === "A" ? "B" : "A";
    const tamperedBody = [parts[0], parts[1], parts[2], parts[3], flipped + parts[4].slice(1)].join(
      ":"
    );
    expect(decryptIntegrationKey(tamperedBody)).toBeNull();

    // Flip the auth tag instead.
    const flippedTag = parts[3][0] === "A" ? "B" : "A";
    const tamperedTag = [parts[0], parts[1], parts[2], flippedTag + parts[3].slice(1), parts[4]].join(
      ":"
    );
    expect(decryptIntegrationKey(tamperedTag)).toBeNull();

    // Flip the salt: the derived key changes, so authentication fails.
    const flippedSalt = parts[1][0] === "A" ? "B" : "A";
    const tamperedSalt = [parts[0], flippedSalt + parts[1].slice(1), parts[2], parts[3], parts[4]].join(
      ":"
    );
    expect(decryptIntegrationKey(tamperedSalt)).toBeNull();

    // Malformed inputs.
    expect(decryptIntegrationKey("garbage")).toBeNull();
    expect(decryptIntegrationKey("v2:a:b:c")).toBeNull();
    expect(decryptIntegrationKey("v2:a:b:c:d")).toBeNull();
    expect(decryptIntegrationKey("v3:a:b:c:d:e")).toBeNull();
    expect(decryptIntegrationKey("")).toBeNull();
  });

  it("still decrypts a legacy v1 ciphertext (unsalted sha256 rows pre-date the salted KDF)", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", SECRET);
    const legacy = legacyV1Encrypt(SECRET, PLAINTEXT);

    expect(legacy.startsWith("v1:")).toBe(true);
    expect(decryptIntegrationKey(legacy)).toBe(PLAINTEXT);

    // Tampered v1 fails closed like v2.
    const parts = legacy.split(":");
    const flipped = parts[3][0] === "A" ? "B" : "A";
    expect(
      decryptIntegrationKey([parts[0], parts[1], parts[2], flipped + parts[3].slice(1)].join(":"))
    ).toBeNull();

    // A rotated secret kills a v1 row exactly like a v2 row.
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "a-different-rotated-secret-9876543210");
    expect(decryptIntegrationKey(legacy)).toBeNull();
  });

  it("is unavailable without a secret: encrypt refuses, decrypt yields null", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", SECRET);
    const stored = encryptIntegrationKey(PLAINTEXT);

    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "");
    expect(integrationKeyEncryptionAvailable()).toBe(false);
    expect(() => encryptIntegrationKey(PLAINTEXT)).toThrow(/OPENPLAN_INTEGRATION_KEY_SECRET/);
    expect(decryptIntegrationKey(stored)).toBeNull();
  });

  it("refuses a secret shorter than the minimum instead of padding it", () => {
    const short = "x".repeat(INTEGRATION_KEY_SECRET_MIN_LENGTH - 1);
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", short);
    expect(integrationKeyEncryptionAvailable()).toBe(false);
    expect(() => encryptIntegrationKey(PLAINTEXT)).toThrow();
  });

  it("fails decryption after a secret rotation — the documented re-enter path", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", SECRET);
    const stored = encryptIntegrationKey(PLAINTEXT);

    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "a-different-rotated-secret-9876543210");
    expect(integrationKeyEncryptionAvailable()).toBe(true);
    expect(decryptIntegrationKey(stored)).toBeNull();
  });
});
