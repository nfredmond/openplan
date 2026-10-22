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
 * instructs exactly that. During rotation, an optional previous secret keeps
 * retained ciphertext readable. New writes use the primary secret. Reads do
 * not rewrite ciphertext or change the fingerprints of queued credentials.
 *
 * Ciphertext formats:
 *   * `v3:<salt b64>:<iv b64>:<auth tag b64>:<ciphertext b64>`: current for
 *     workspace keys. The v2 key derivation, plus the workspace ID as GCM
 *     additional authenticated data, so a row copied to another workspace
 *     fails decryption. Written when the caller names the workspace.
 *   * `v2:<salt b64>:<iv b64>:<auth tag b64>:<ciphertext b64>`: workspace
 *     keys stored before v3, and sealed credential envelopes, which carry
 *     their own workspace identity inside the encrypted payload.
 *     Key = scrypt(secret, salt, 32) with a fresh 16-byte salt per encryption.
 *   * `v1:<iv b64>:<auth tag b64>:<ciphertext b64>`: legacy rows written
 *     before the salted KDF. Key = sha256(secret), unsalted. Still decryptable
 *     so existing stored keys survive the upgrade.
 *
 * v1 and v2 rows stay readable and are not rewritten on read: the
 * translation queue fingerprints the stored ciphertext, so rewriting it would
 * strand queued requests. A v2 row becomes v3 when its key is next saved.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";

const V3_PREFIX = "v3";
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

function configuredSecret(value = process.env.OPENPLAN_INTEGRATION_KEY_SECRET): string | null {
  const secret = value?.trim();
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

/** The workspace a ciphertext belongs to, for the v3 format. */
export type IntegrationKeyBinding = { workspaceId: string };

/** v3 additional authenticated data: the workspace the key belongs to. */
function workspaceAad(binding: IntegrationKeyBinding): Buffer {
  return Buffer.from(`openplan:workspace-integration-key:${binding.workspaceId}`, "utf8");
}

/** Legacy v1 key derivation: unsalted sha256. Read path only — never written. */
function derivedKeyV1(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt one provider key: v3, bound to the workspace, when the caller names
 * it; v2 otherwise. Throws when the deployment has no usable secret. Callers
 * must check {@link integrationKeyEncryptionAvailable} first and refuse the
 * save with honest copy instead of reaching this throw.
 */
export function encryptIntegrationKey(plaintext: string, binding?: IntegrationKeyBinding): string {
  const secret = configuredSecret();
  if (!secret) {
    throw new Error(
      "OPENPLAN_INTEGRATION_KEY_SECRET is not configured (min 16 chars); per-workspace keys cannot be stored on this deployment"
    );
  }
  if (binding && !binding.workspaceId) throw new Error("A workspace-bound key needs a workspace ID");
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKeyV2(secret, salt), iv);
  if (binding) cipher.setAAD(workspaceAad(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    binding ? V3_PREFIX : V2_PREFIX,
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored ciphertext: v3 (workspace-bound), v2 (salted scrypt) or
 * legacy v1 (unsalted sha256). A v3 ciphertext decrypts only under the
 * workspace it was written for. Returns null (never throws) on any failure:
 * missing primary secret, unknown secret, wrong or missing workspace, tampered
 * or malformed ciphertext. Existing callers decide whether a null refuses the
 * task or permits an environment key. This function never selects a payer.
 */
export function decryptIntegrationKey(stored: string, binding?: IntegrationKeyBinding): string | null {
  const secret = configuredSecret();
  if (!secret) return null;
  const current = decryptWithSecret(stored, secret, binding);
  if (current !== null) return current;
  const previous = configuredSecret(process.env.OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET ?? "");
  if (!previous || previous === secret) return null;
  return decryptWithSecret(stored, previous, binding);
}

/** Authenticate each candidate independently; failed authentication releases no plaintext. */
function decryptWithSecret(stored: string, secret: string, binding?: IntegrationKeyBinding): string | null {
  const parts = stored.split(":");
  try {
    let key: Buffer;
    let iv: Buffer;
    let tag: Buffer;
    let ciphertext: Buffer;
    let aad: Buffer | null = null;
    if (parts.length === 5 && (parts[0] === V3_PREFIX || parts[0] === V2_PREFIX)) {
      if (parts[0] === V3_PREFIX) {
        if (!binding?.workspaceId) return null;
        aad = workspaceAad(binding);
      }
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
    if (aad) decipher.setAAD(aad);
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
