/**
 * Encryption for per-workspace integration keys (AES-256-GCM, application
 * layer). The database stores only ciphertext; decryption happens strictly
 * server-side with a secret held in the deployment environment.
 *
 * WHY APPLICATION-LAYER AND NOT pgsodium: Supabase has deprecated direct
 * pgsodium use, and keeping the secret out of the database entirely means a
 * database dump alone never yields plaintext keys — provided the operator
 * secret is not itself guessable. That caveat is why the KDF matters: the AES
 * key is derived with scrypt (N=2^14, r=8, p=1) over a per-ciphertext random
 * salt, so an attacker with a dumped table cannot amortize a dictionary attack
 * across rows and pays the full scrypt cost per guess per row. A high-entropy
 * secret (e.g. `openssl rand -hex 32`) makes that attack unpayable; SELF_HOSTING
 * instructs exactly that. The other cost is honest and documented: rotating
 * OPENPLAN_INTEGRATION_KEY_SECRET invalidates stored workspace keys (they fail
 * decryption and fall back to the deployment env key), so rotation means teams
 * re-enter their keys.
 *
 * Ciphertext formats:
 *   * `v2:<salt b64>:<iv b64>:<auth tag b64>:<ciphertext b64>` — current.
 *     Key = scrypt(secret, salt, 32) with a fresh 16-byte salt per encryption.
 *   * `v1:<iv b64>:<auth tag b64>:<ciphertext b64>` — legacy rows written
 *     before the salted KDF. Key = sha256(secret), unsalted. Still decryptable
 *     so existing stored keys survive the upgrade; every new write is v2.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";

const V2_PREFIX = "v2";
const LEGACY_V1_PREFIX = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const SALT_BYTES = 16;
const AES_KEY_BYTES = 32;

/** scrypt cost parameters for the v2 KDF (~16 MiB, interactive-latency). */
const SCRYPT_OPTIONS = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** Minimum operator-secret length; shorter secrets are refused, not padded. */
export const INTEGRATION_KEY_SECRET_MIN_LENGTH = 16;

function configuredSecret(): string | null {
  const secret = process.env.OPENPLAN_INTEGRATION_KEY_SECRET?.trim();
  if (!secret || secret.length < INTEGRATION_KEY_SECRET_MIN_LENGTH) return null;
  return secret;
}

/**
 * Whether per-workspace key storage is available on this deployment. When
 * false, the wizard says so plainly and the deployment env keys remain the
 * only source — a disabled feature, never a fake save.
 */
export function integrationKeyEncryptionAvailable(): boolean {
  return configuredSecret() !== null;
}

/** v2 key derivation: salted, memory-hard scrypt. */
function derivedKeyV2(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, AES_KEY_BYTES, SCRYPT_OPTIONS);
}

/** Legacy v1 key derivation: unsalted sha256. Read path only — never written. */
function derivedKeyV1(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt one provider key (always the v2 format). Throws when the deployment
 * has no usable secret — callers must check
 * {@link integrationKeyEncryptionAvailable} first and refuse the save with
 * honest copy instead of reaching this throw.
 */
export function encryptIntegrationKey(plaintext: string): string {
  const secret = configuredSecret();
  if (!secret) {
    throw new Error(
      "OPENPLAN_INTEGRATION_KEY_SECRET is not configured (min 16 chars); per-workspace keys cannot be stored on this deployment"
    );
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKeyV2(secret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    V2_PREFIX,
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored ciphertext — v2 (salted scrypt) or legacy v1 (unsalted
 * sha256). Returns null (never throws) on any failure — missing secret,
 * rotated secret, tampered or malformed ciphertext. A null simply means "no
 * workspace key"; callers fall back to the deployment env.
 */
export function decryptIntegrationKey(stored: string): string | null {
  const secret = configuredSecret();
  if (!secret) return null;
  const parts = stored.split(":");
  try {
    let key: Buffer;
    let iv: Buffer;
    let tag: Buffer;
    let ciphertext: Buffer;
    if (parts.length === 5 && parts[0] === V2_PREFIX) {
      const salt = Buffer.from(parts[1], "base64");
      if (salt.length !== SALT_BYTES) return null;
      iv = Buffer.from(parts[2], "base64");
      tag = Buffer.from(parts[3], "base64");
      ciphertext = Buffer.from(parts[4], "base64");
      key = derivedKeyV2(secret, salt);
    } else if (parts.length === 4 && parts[0] === LEGACY_V1_PREFIX) {
      iv = Buffer.from(parts[1], "base64");
      tag = Buffer.from(parts[2], "base64");
      ciphertext = Buffer.from(parts[3], "base64");
      key = derivedKeyV1(secret);
    } else {
      return null;
    }
    // GCM tags are always 16 bytes; anything else is malformed input, and
    // newer Node versions reject short tags in setAuthTag rather than failing
    // authentication.
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The last four characters shown in the UI; never more. */
export function integrationKeyLast4(plaintext: string): string {
  return plaintext.slice(-4);
}
