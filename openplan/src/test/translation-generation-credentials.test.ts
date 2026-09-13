// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareTranslationCredential, openTranslationCredential } from "@/lib/integrations/translation-credentials";
import { encryptIntegrationKey } from "@/lib/integrations/key-crypto";
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Synthetic unavailable service"); } }));
import { prepareWorkspaceTranslationCredential, prepareWorkspaceTranslationSelection, verifyWorkspaceTranslationSelection } from "@/lib/integrations/workspace-keys";

beforeEach(() => {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-TRANSLATION-SECRET-0123456789");
  vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-ENV-KEY");
});
afterEach(() => vi.unstubAllEnvs());
function identity() {
  return { workspaceId: randomUUID(), requestId: randomUUID(), credentialId: randomUUID(), modelId: "synthetic-model" };
}
function fixture(data: unknown, error: unknown = null) {
  const eq = vi.fn();
  eq.mockReturnValueOnce({ eq }).mockResolvedValueOnce({ data, error });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as NonNullable<Parameters<typeof prepareWorkspaceTranslationCredential>[0]["client"]>, from, select, eq };
}

describe("translation credential custody", () => {
  it("seals the request, workspace, credential identity, source and model without returning plaintext", () => {
    const scope = identity();
    const stored = prepareTranslationCredential({ ...scope, source: "workspace", apiKey: "SYNTHETIC-WORKSPACE-KEY" });
    expect(JSON.stringify(stored)).not.toContain("SYNTHETIC-WORKSPACE-KEY");
    expect(openTranslationCredential(stored)).toBe("SYNTHETIC-WORKSPACE-KEY");
    expect(stored.configuration).toEqual({ provider: "anthropic", modelId: scope.modelId, recipeVersion: 1 });
    vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-REPLACEMENT-ENV");
    expect(openTranslationCredential(stored)).toBe("SYNTHETIC-WORKSPACE-KEY");
  });
  it.each(["workspaceId", "requestId", "credentialId", "source", "configuration", "configurationHash", "credentialCiphertext"] as const)("refuses replaced %s without fallback", field => {
    const stored = prepareTranslationCredential({ ...identity(), source: "workspace", apiKey: "SYNTHETIC-ORIGINAL-KEY" });
    const replacement = prepareTranslationCredential({ ...identity(), source: "env", modelId: "different-model", apiKey: "SYNTHETIC-OTHER-KEY" });
    expect(() => openTranslationCredential({ ...stored, [field]: replacement[field] })).toThrow("translation_credential_unavailable");
  });
  it("refuses a replaced recipe even when the attacker also replaces the outer configuration hash", () => {
    const scope = identity();
    const stored = prepareTranslationCredential({ ...scope, source: "workspace", apiKey: "SYNTHETIC-ORIGINAL-KEY" });
    const other = prepareTranslationCredential({ ...scope, modelId: "other-model", source: "workspace", apiKey: "SYNTHETIC-ORIGINAL-KEY" });
    expect(() => openTranslationCredential({ ...stored, configuration: other.configuration, configurationHash: other.configurationHash })).toThrow("translation_credential_unavailable");
  });
  it("refuses a rotated encryption secret and never uses the available environment key", () => {
    const stored = prepareTranslationCredential({ ...identity(), source: "workspace", apiKey: "SYNTHETIC-ORIGINAL-KEY" });
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-ROTATED-SECRET-0123456789");
    expect(() => openTranslationCredential(stored)).toThrow("translation_credential_unavailable");
  });
  it("requires encryption even for an environment credential", () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "");
    expect(() => prepareTranslationCredential({ ...identity(), source: "env", apiKey: "SYNTHETIC-KEY" })).toThrow("translation_credential_not_stored");
  });
});

describe("strict workspace translation credential selection", () => {
  it("selects the scoped workspace override and asserts the complete query projection", async () => {
    const scope = identity();
    const f = fixture([{ workspace_id: scope.workspaceId, provider: "anthropic", key_ciphertext: encryptIntegrationKey("SYNTHETIC-WORKSPACE-KEY") }]);
    const stored = await prepareWorkspaceTranslationCredential({ ...scope, client: f.client });
    expect(openTranslationCredential(stored)).toBe("SYNTHETIC-WORKSPACE-KEY");
    expect(stored.source).toBe("workspace");
    expect(f.from).toHaveBeenCalledExactlyOnceWith("workspace_integration_keys");
    expect(f.select).toHaveBeenCalledExactlyOnceWith("workspace_id, provider, key_ciphertext");
    expect(f.eq.mock.calls).toEqual([["workspace_id", scope.workspaceId], ["provider", "anthropic"]]);
  });
  it("selects the environment only after a successful empty workspace read", async () => {
    const f = fixture([]);
    const stored = await prepareWorkspaceTranslationCredential({ ...identity(), client: f.client });
    expect(stored.source).toBe("env");
    expect(openTranslationCredential(stored)).toBe("SYNTHETIC-ENV-KEY");
  });
  it.each(["error", "null", "malformed", "duplicate", "wrong_workspace", "wrong_provider", "undecryptable", "empty_key"])("refuses %s rather than changing the payer", async kind => {
    const scope = identity();
    const row = { workspace_id: scope.workspaceId, provider: "anthropic", key_ciphertext: encryptIntegrationKey("SYNTHETIC-WORKSPACE-KEY") };
    let data: unknown = [row];
    if (kind === "null") data = null;
    if (kind === "malformed") data = {};
    if (kind === "duplicate") data = [row, row];
    if (kind === "wrong_workspace") row.workspace_id = randomUUID();
    if (kind === "wrong_provider") row.provider = "census";
    if (kind === "undecryptable") row.key_ciphertext = "SYNTHETIC-corrupt-ciphertext";
    if (kind === "empty_key") row.key_ciphertext = encryptIntegrationKey("");
    const f = fixture(data, kind === "error" ? { message: "SYNTHETIC query failure" } : null);
    await expect(prepareWorkspaceTranslationCredential({ ...scope, client: f.client })).rejects.toThrow("translation_credential_unavailable");
  });
  it("refuses missing credentials and a failed service client", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(prepareWorkspaceTranslationCredential({ ...identity(), client: fixture([]).client })).rejects.toThrow("translation_credential_unavailable");
    await expect(prepareWorkspaceTranslationCredential(identity())).rejects.toThrow("translation_credential_unavailable");
  });
  it("captures request identity before waiting for the key read", async () => {
    const ready = Promise.withResolvers<{ data: unknown[]; error: null }>();
    const scope = identity();
    const expected = { ...scope };
    const f = fixture([]);
    f.eq.mockReset().mockReturnValueOnce({ eq: f.eq }).mockReturnValueOnce(ready.promise);
    const args = { ...scope, client: f.client };
    const pending = prepareWorkspaceTranslationCredential(args);
    args.requestId = randomUUID(); args.modelId = "changed-model";
    ready.resolve({ data: [], error: null });
    const stored = await pending;
    expect(stored.requestId).toBe(expected.requestId);
    expect(stored.configuration.modelId).toBe(expected.modelId);
  });
});


describe("queued translation selection verification", () => {
  it("captures the digest and envelope from one read and verifies the same selection", async () => {
    const scope = identity(); const ciphertext = encryptIntegrationKey("SYNTHETIC-WORKSPACE-KEY");
    const row = { workspace_id: scope.workspaceId, provider: "anthropic", key_ciphertext: ciphertext };
    const f = fixture([row]);
    const selection = await prepareWorkspaceTranslationSelection({ ...scope, client: f.client });
    expect(selection.selectedKeyCiphertextHash).toBe(createHash("sha256").update(ciphertext).digest("hex"));
    expect(f.from).toHaveBeenCalledOnce();
    expect(openTranslationCredential(selection.credential)).toBe("SYNTHETIC-WORKSPACE-KEY");
    await expect(verifyWorkspaceTranslationSelection({ ...selection, client: fixture([row]).client })).resolves.toBeUndefined();
  });
  it.each(["ciphertext", "plaintext", "source", "environment", "read_failure"])("refuses changed %s before a queued dispatch", async change => {
    const scope = identity(); const ciphertext = encryptIntegrationKey("SYNTHETIC-WORKSPACE-KEY");
    const row = { workspace_id: scope.workspaceId, provider: "anthropic", key_ciphertext: ciphertext };
    const env = change === "environment" || change === "source";
    const selection = await prepareWorkspaceTranslationSelection({ ...scope, client: fixture(env ? [] : [row]).client });
    if (change === "ciphertext") row.key_ciphertext = encryptIntegrationKey("SYNTHETIC-WORKSPACE-KEY");
    if (change === "plaintext") {
      selection.credential = prepareTranslationCredential({ ...scope, source: "workspace", apiKey: "SYNTHETIC-OTHER-KEY" });
    }
    if (change === "environment") vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-NEW-ENV-KEY");
    await expect(verifyWorkspaceTranslationSelection({ ...selection,
      client: fixture(change === "environment" ? [] : [row], change === "read_failure" ? { message: "Synthetic failure" } : null).client })).rejects.toThrow("translation_credential_unavailable");
  });
});
