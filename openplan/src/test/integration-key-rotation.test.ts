import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptIntegrationKey, encryptIntegrationKey, integrationKeyEncryptionAvailable,
} from "@/lib/integrations/key-crypto";
import { openTranslationCredential, prepareTranslationCredential } from "@/lib/integrations/translation-credentials";
import { openProviderApiRevisionCredential, prepareProviderApiRevision } from "@/lib/integrations/provider-api-credentials";

const PRIMARY = "SYNTHETIC-NEW-SECRET-ONLY-FOR-TESTS";
const PREVIOUS = "SYNTHETIC-OLD-SECRET-ONLY-FOR-TESTS";
const PLAINTEXT = "SYNTHETIC-WORKSPACE-PROVIDER-KEY";
const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const binding = { workspaceId: WORKSPACE };

// Independent historical writer keeps the compatibility expectation separate
// from the application encryptor that the primary-only tests exercise.
function historical(secret: string, version: "v1" | "v2" | "v3", plaintext = PLAINTEXT): string {
  const salt = randomBytes(16);
  const key = version === "v1" ? createHash("sha256").update(secret).digest()
    : scryptSync(secret, salt, 32, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (version === "v3") cipher.setAAD(Buffer.from(`openplan:workspace-integration-key:${WORKSPACE}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [version, ...(version === "v1" ? [] : [salt.toString("base64")]), iv.toString("base64"),
    cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

function configure(primary = PRIMARY, previous = PREVIOUS) {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", primary);
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET", previous);
}

afterEach(() => vi.unstubAllEnvs());

describe("integration secret rotation", () => {
  it.each(["v1", "v2", "v3"] as const)("reads retained %s bytes under the previous secret", (version) => {
    const stored = historical(PREVIOUS, version);
    configure();
    expect(decryptIntegrationKey(stored, binding), "Retained ciphertext needs the configured second secret").toBe(PLAINTEXT);
    configure(PRIMARY, "");
    expect(decryptIntegrationKey(stored, binding)).toBeNull();
  });

  it("writes only with the primary secret while both secrets are configured", () => {
    configure();
    const stored = encryptIntegrationKey(PLAINTEXT, binding);
    configure(PRIMARY, "");
    expect(decryptIntegrationKey(stored, binding), "New ciphertext needs the primary secret").toBe(PLAINTEXT);
    configure(PREVIOUS, "");
    expect(decryptIntegrationKey(stored, binding)).toBeNull();
  });

  it("lets prepared old-primary and new-primary processes read each other's writes", () => {
    configure(PREVIOUS, PRIMARY);
    const oldWriter = encryptIntegrationKey(PLAINTEXT, binding);
    configure(PRIMARY, PREVIOUS);
    expect(decryptIntegrationKey(oldWriter, binding)).toBe(PLAINTEXT);
    const newWriter = encryptIntegrationKey(PLAINTEXT, binding);
    configure(PREVIOUS, PRIMARY);
    expect(decryptIntegrationKey(newWriter, binding), "Prepared old-primary readers must accept new-primary writes").toBe(PLAINTEXT);
  });

  it("reads the primary without depending on a valid previous secret", () => {
    const stored = historical(PRIMARY, "v3");
    for (const previous of ["", "short", PRIMARY, "  " + PREVIOUS + "  "]) {
      configure(PRIMARY, previous);
      expect(decryptIntegrationKey(stored, binding), "Primary ciphertext must remain readable").toBe(PLAINTEXT);
    }
  });

  it("requires a usable primary even when the previous secret matches", () => {
    const stored = historical(PREVIOUS, "v3");
    for (const primary of ["", "short"]) {
      configure(primary);
      expect(integrationKeyEncryptionAvailable()).toBe(false);
      expect(decryptIntegrationKey(stored, binding), "A missing or short primary must refuse decryption").toBeNull();
      expect(() => encryptIntegrationKey(PLAINTEXT, binding)).toThrow(/OPENPLAN_INTEGRATION_KEY_SECRET/);
    }
  });

  it("ignores an absent or invalid previous secret and trims a usable one", () => {
    const stored = historical(PREVIOUS, "v3");
    for (const previous of ["", "short"]) {
      configure(PRIMARY, previous);
      expect(decryptIntegrationKey(stored, binding)).toBeNull();
    }
    configure(PRIMARY, "short");
    expect(decryptIntegrationKey(historical("short", "v3"), binding), "Short second secrets cannot authenticate").toBeNull();
    configure(PRIMARY, "  " + PREVIOUS + "  ");
    expect(decryptIntegrationKey(stored, binding), "A usable second secret follows existing trim semantics").toBe(PLAINTEXT);
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET", undefined);
    expect(decryptIntegrationKey(stored, binding)).toBeNull();
  });

  it("authenticates workspace under the previous secret", () => {
    const stored = historical(PREVIOUS, "v3");
    configure();
    expect(decryptIntegrationKey(stored, { workspaceId: OTHER }), "A second secret cannot change workspace binding").toBeNull();
    expect(decryptIntegrationKey(stored)).toBeNull();
    expect(decryptIntegrationKey(["v2", ...stored.split(":").slice(1)].join(":"), binding)).toBeNull();
    expect(decryptIntegrationKey("v3:broken", binding)).toBeNull();
  });

  it("rejects a changed tag under the previous secret", () => {
    const stored = historical(PREVIOUS, "v3");
    configure();
    const parts = stored.split(":");
    const tag = Buffer.from(parts[3], "base64");
    tag[0] ^= 1;
    parts[3] = tag.toString("base64");
    expect(decryptIntegrationKey(parts.join(":"), binding), "Second-secret authentication must reject a changed tag").toBeNull();
  });

  it("does not return partial plaintext when neither secret authenticates", () => {
    configure();
    expect(decryptIntegrationKey(historical("SYNTHETIC-UNRELATED-SECRET", "v3"), binding)).toBeNull();
    expect(decryptIntegrationKey(historical(PREVIOUS, "v2", ""))).toBe("");
    expect(decryptIntegrationKey(historical(PRIMARY, "v2", "")), "Authenticated empty plaintext remains a value").toBe("");
  });

  it("opens the exact queued translation envelope after rotation and retains its identity checks", () => {
    configure(PREVIOUS, "");
    const stored = prepareTranslationCredential({ workspaceId: WORKSPACE,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", credentialId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      modelId: "synthetic-model", source: "workspace", apiKey: PLAINTEXT });
    const original = JSON.stringify(stored);
    configure();
    expect(openTranslationCredential(stored)).toBe(PLAINTEXT);
    expect(JSON.stringify(stored)).toBe(original);
    expect(() => openTranslationCredential({ ...stored, workspaceId: OTHER }), "Queued credentials retain their original workspace").toThrow("translation_credential_unavailable");
    configure(PRIMARY, "");
    expect(() => openTranslationCredential(stored)).toThrow("translation_credential_unavailable");
  });

  it("opens an existing API connection revision without changing its destination or identity", () => {
    configure(PREVIOUS, "");
    const stored = prepareProviderApiRevision({ workspaceId: WORKSPACE,
      revisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", apiKey: PLAINTEXT,
      configuration: { label: "Synthetic provider", protocol: "openai_chat_completions",
        endpoint: "https://provider.example/v1/chat/completions", modelIds: ["synthetic-model"],
        structuredOutput: true, authMode: "api_key", timeoutSeconds: 30 } });
    const original = JSON.stringify(stored);
    configure();
    expect(openProviderApiRevisionCredential(stored), "Retained API revision needs its exact configured credential").toBe(PLAINTEXT);
    expect(JSON.stringify(stored)).toBe(original);
    expect(() => openProviderApiRevisionCredential({ ...stored, workspaceId: OTHER }),
      "An API revision cannot change its original workspace").toThrow("api_connection_credential_unavailable");
    expect(() => openProviderApiRevisionCredential({ ...stored, configuration: { ...stored.configuration,
      endpoint: "https://other-provider.example/v1/chat/completions" } })).toThrow("api_connection_credential_unavailable");
    configure(PRIMARY, "");
    expect(() => openProviderApiRevisionCredential(stored)).toThrow("api_connection_credential_unavailable");
  });
});
