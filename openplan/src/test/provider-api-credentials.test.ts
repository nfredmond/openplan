// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptIntegrationKey } from "@/lib/integrations/key-crypto";
import { openProviderApiRevisionCredential, prepareProviderApiRevision, providerApiConfigurationSchema } from "@/lib/integrations/provider-api-credentials";

const workspaceId = "c753bd73-c150-4a98-85c8-87c27e898d54";
const revisionId = "af670fb4-cdbf-46b4-954c-032c1eec7bd6";
const otherId = "cfc6bdb0-cf6d-46e1-a3d7-6d5882579191";
const configuration = { label: "Synthetic model", endpoint: "https://model.fixture.invalid/v1",
  protocol: "openai_chat_completions", modelIds: ["synthetic/model-1"], structuredOutput: true,
  authMode: "api_key", timeoutSeconds: 120 };
const make = () => prepareProviderApiRevision({ workspaceId, revisionId, configuration, apiKey: "SYNTHETIC-KEY" });
const configureSecret = () => vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-OPERATOR-SECRET-NOT-A-REAL-CREDENTIAL");
afterEach(() => vi.unstubAllEnvs());

describe("API revision credentials", () => {
  it("round trips a key with its exact revision and canonical configuration", () => {
    configureSecret();
    const saved = make();
    expect(saved.configuration.endpoint).toBe("https://model.fixture.invalid/v1/");
    expect(saved.credentialCiphertext).not.toContain("SYNTHETIC-KEY");
    expect(saved.credentialCiphertext).not.toBe(make().credentialCiphertext);
    expect(openProviderApiRevisionCredential(saved)).toBe("SYNTHETIC-KEY");
    expect(openProviderApiRevisionCredential({ ...saved, configuration: { ...saved.configuration, label: "  Synthetic model  " } })).toBe("SYNTHETIC-KEY");
  });

  it("supports keyless local configuration without an encryption secret or environment fallback", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "");
    vi.stubEnv("OPENAI_API_KEY", "DO-NOT-USE");
    const saved = prepareProviderApiRevision({ workspaceId, revisionId, configuration: {
      ...configuration, endpoint: "http://127.0.0.1:11434/v1", authMode: "none",
    }, apiKey: null });
    expect(saved.credentialCiphertext).toBeNull();
    expect(openProviderApiRevisionCredential(saved)).toBeNull();
    expect(() => openProviderApiRevisionCredential({ ...saved, credentialCiphertext: "unexpected" }))
      .toThrow("api_connection_credential_unavailable");
  });

  for (const field of ["workspaceId", "revisionId"]) {
    it(`refuses ciphertext transplanted to another ${field}`, () => {
      configureSecret();
      expect(() => openProviderApiRevisionCredential({ ...make(), [field]: otherId }))
        .toThrow("api_connection_credential_unavailable");
    });
  }

  for (const [field, replacement] of Object.entries({ endpoint: "https://changed.fixture.invalid/v1/", label: "Changed label",
    modelIds: ["changed-model"], timeoutSeconds: 300 })) {
    it(`refuses changed ${field} even with a recomputed configuration hash`, () => {
      configureSecret();
      const saved = make();
      const changed = { ...saved.configuration, [field]: replacement };
      const hash = createHash("sha256").update(JSON.stringify(changed)).digest("hex");
      expect(() => openProviderApiRevisionCredential({ ...saved, configuration: changed }))
        .toThrow("api_connection_credential_unavailable");
      expect(() => openProviderApiRevisionCredential({ ...saved, configuration: changed, configurationHash: hash }))
        .toThrow("api_connection_credential_unavailable");
    });
  }

  for (const mode of ["missing-secret", "rotated-secret", "tampered", "missing-ciphertext", "legacy-bare-key", "invalid-envelope", "wrong-envelope-version"]) {
    it(`refuses ${mode} without using another credential`, () => {
      configureSecret();
      const saved = make();
      vi.stubEnv("OPENAI_API_KEY", "DO-NOT-USE");
      if (mode === "missing-secret") vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "");
      if (mode === "rotated-secret") vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "DIFFERENT-SYNTHETIC-OPERATOR-SECRET");
      if (mode === "tampered") saved.credentialCiphertext = saved.credentialCiphertext!.slice(0, -8) + "AAAAAAAA";
      if (mode === "missing-ciphertext") saved.credentialCiphertext = null;
      if (mode === "legacy-bare-key") saved.credentialCiphertext = encryptIntegrationKey("SYNTHETIC-KEY");
      if (mode === "invalid-envelope") saved.credentialCiphertext = encryptIntegrationKey('{}');
      if (mode === "wrong-envelope-version") saved.credentialCiphertext = encryptIntegrationKey(JSON.stringify({
        version: 2, workspaceId, revisionId, configurationHash: saved.configurationHash, apiKey: "SYNTHETIC-KEY",
      }));
      expect(() => openProviderApiRevisionCredential(saved)).toThrow("api_connection_credential_unavailable");
    });
  }

  it("refuses storing keyed configuration without an operator secret", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "");
    expect(make).toThrow("api_connection_not_stored");
  });

  for (const [name, change] of Object.entries({ label: { label: " " }, protocol: { protocol: "unsupported" },
    endpoint: { endpoint: "https://user:secret@model.fixture.invalid" }, modelIds: { modelIds: [] },
    duplicateModels: { modelIds: ["same", "same"] }, whitespaceModel: { modelIds: ["with space"] },
    structuredOutput: { structuredOutput: false }, authMode: { authMode: "environment" },
    timeoutSeconds: { timeoutSeconds: 901 }, headers: { headers: { cookie: "private" } } })) {
    it(`refuses invalid configuration ${name}`, () => {
      expect(providerApiConfigurationSchema.safeParse({ ...configuration, ...change }).success).toBe(false);
    });
  }

  for (const key of ["", "with space", "key\nheader", "é", "x".repeat(8193), undefined, 123]) {
    it(`refuses invalid key ${typeof key === "string" ? key.length : typeof key}`, () => {
      configureSecret();
      expect(() => prepareProviderApiRevision({ workspaceId, revisionId, configuration, apiKey: key }))
        .toThrow("api_connection_not_stored");
    });
  }
  it("requires an explicit null key in keyless mode", () => {
    configureSecret();
    expect(() => prepareProviderApiRevision({ workspaceId, revisionId, configuration: { ...configuration, authMode: "none" }, apiKey: "SYNTHETIC-KEY" }))
      .toThrow("api_connection_not_stored");
  });
});
