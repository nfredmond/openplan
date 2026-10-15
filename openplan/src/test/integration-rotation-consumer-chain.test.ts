// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as crypto from "@/lib/integrations/key-crypto";
import { openTranslationCredential } from "@/lib/integrations/translation-credentials";
import { openProviderApiRevisionCredential, prepareProviderApiRevision, providerApiConfigurationSchema } from "@/lib/integrations/provider-api-credentials";

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => {
  throw new Error("Synthetic test must supply its scoped query client");
} }));
import { prepareWorkspaceTranslationSelection, verifyWorkspaceTranslationSelection } from "@/lib/integrations/workspace-keys";

const OLD = "SYNTHETIC-ROTATION-OLD-OPERATOR-SECRET";
const NEW = "SYNTHETIC-ROTATION-NEW-OPERATOR-SECRET";
const KEY = "SYNTHETIC-WORKSPACE-PROVIDER-KEY";
const scope = { workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", modelId: "synthetic-model" };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function configure(primary: string, previous = "") {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", primary);
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET", previous);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// Return only requested columns. The assertions also check every read's exact
// projection and scope; this fixture cannot grant an omitted field silently.
function scopedRows(row: Record<string, string>) {
  const reads: { projection: string; filters: [string, string][] }[] = [];
  const from = vi.fn((table: string) => ({ select: (projection: string) => {
    const read = { projection, filters: [] as [string, string][] };
    reads.push(read);
    const eq = (column: string, value: string): unknown => {
      read.filters.push([column, value]);
      if (read.filters.length < 2) return { eq };
      const matches = table === "workspace_integration_keys" && read.filters.every(([field, expected]) => row[field] === expected);
      const projected = Object.fromEntries(projection.split(",").map(field => field.trim()).map(field => [field, row[field]]));
      return Promise.resolve({ data: matches ? [projected] : [], error: null });
    };
    return { eq };
  } }));
  return {
    client: { from } as unknown as NonNullable<Parameters<typeof prepareWorkspaceTranslationSelection>[0]["client"]>,
    assertReads(count: number) {
      expect(from.mock.calls, "Every selection read keeps the exact table").toEqual(Array.from({ length: count }, () => ["workspace_integration_keys"]));
      expect(reads, "Every selection read keeps the exact projection and workspace/provider filters").toEqual(Array.from({ length: count }, () => ({
        projection: "workspace_id, provider, key_ciphertext", filters: [["workspace_id", scope.workspaceId], ["provider", "anthropic"]],
      })));
    },
  };
}

describe("rotation consumer chains", () => {
  it("prepares then verifies the original workspace selection across rotation", async () => {
    configure(OLD);
    vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-ENVIRONMENT-KEY-MUST-NOT-REPLACE-PAYER");
    const ciphertext = crypto.encryptIntegrationKey(KEY, { workspaceId: scope.workspaceId });
    const row = { workspace_id: scope.workspaceId, provider: "anthropic", key_ciphertext: ciphertext };
    const originalRow = JSON.stringify(row);
    const query = scopedRows(row);
    const prepared = await prepareWorkspaceTranslationSelection({ ...scope, client: query.client })
      .then(value => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    query.assertReads(1);
    expect(prepared.error, "Preparation must resolve the actual scoped ciphertext").toBeNull();
    const selection = prepared.value!;
    expect(selection.selectedKeyCiphertextHash, "Selection fingerprints the exact original stored ciphertext").toBe(digest(ciphertext));
    expect(selection.credential).toMatchObject({ workspaceId: scope.workspaceId, requestId: scope.requestId,
      credentialId: scope.credentialId, source: "workspace", configuration: { provider: "anthropic", modelId: scope.modelId, recipeVersion: 1 } });
    const retained = JSON.stringify(selection);

    configure(NEW, OLD);
    const verificationError: unknown = await verifyWorkspaceTranslationSelection({ ...selection, client: query.client })
      .then(() => null, (error: unknown) => error);
    expect(verificationError, "Prepared selection must verify through the previous secret after rotation").toBeNull();
    query.assertReads(2);
    expect(openTranslationCredential(selection.credential)).toBe(KEY);
    expect(JSON.stringify(row), "Verification keeps the original stored ciphertext bytes").toBe(originalRow);
    expect(JSON.stringify(selection), "Verification keeps the exact retained request and payload").toBe(retained);

    row.key_ciphertext = crypto.encryptIntegrationKey(KEY, { workspaceId: scope.workspaceId });
    expect(row.key_ciphertext).not.toBe(ciphertext);
    const replacementError: unknown = await verifyWorkspaceTranslationSelection({ ...selection, client: query.client })
      .then(() => null, (error: unknown) => error);
    expect(replacementError, "Same plaintext with replacement ciphertext must refuse the retained digest")
      .toMatchObject({ code: "translation_credential_unavailable" });
    query.assertReads(3);
    row.key_ciphertext = ciphertext;

    configure(NEW);
    const missingEnvelopeError: unknown = await verifyWorkspaceTranslationSelection({ ...selection, client: query.client })
      .then(() => null, (error: unknown) => error);
    expect(missingEnvelopeError, "Removing the needed secret must refuse the queued envelope")
      .toMatchObject({ code: "translation_credential_unavailable" });
    query.assertReads(3); // The retained envelope refuses before a fresh key read.
    const missing = await prepareWorkspaceTranslationSelection({ ...scope, client: query.client })
      .then(value => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    query.assertReads(4);
    expect(missing.error, "Removing the needed secret must refuse the stored row despite an available environment payer")
      .toMatchObject({ code: "translation_credential_unavailable" });
    expect(missing.value).toBeNull();
    expect(JSON.stringify(row)).toBe(originalRow);
    expect(JSON.stringify(selection)).toBe(retained);
  });

  it("rejects a substituted API destination with a recomputed outer hash after previous-secret decrypt", () => {
    configure(OLD);
    const stored = prepareProviderApiRevision({ workspaceId: scope.workspaceId, revisionId: scope.credentialId,
      apiKey: KEY, configuration: { label: "Synthetic provider", protocol: "openai_chat_completions",
        endpoint: "https://original.fixture.invalid/v1/chat/completions", modelIds: [scope.modelId],
        structuredOutput: true, authMode: "api_key", timeoutSeconds: 30 } });
    const retained = JSON.stringify(stored);
    configure(NEW, OLD);
    expect(openProviderApiRevisionCredential(stored), "Unchanged API revision opens through the previous secret").toBe(KEY);

    const configuration = providerApiConfigurationSchema.parse({ ...stored.configuration,
      endpoint: "https://substituted.fixture.invalid/v1/chat/completions" });
    const substituted = { ...stored, configuration, configurationHash: digest(JSON.stringify(configuration)) };
    expect(substituted.configurationHash).not.toBe(stored.configurationHash);
    expect(substituted.credentialCiphertext).toBe(stored.credentialCiphertext);
    expect(substituted.workspaceId).toBe(stored.workspaceId);
    expect(substituted.revisionId).toBe(stored.revisionId);
    // Observe the real decrypt result without replacing crypto. Both public
    // failures use one code, so call/result evidence distinguishes their stage.
    const decrypt = vi.spyOn(crypto, "decryptIntegrationKey");
    expect(() => openProviderApiRevisionCredential({ ...stored, configuration }),
      "Stale outer hash refuses before envelope decryption").toThrow("api_connection_credential_unavailable");
    expect(decrypt, "Stale outer hash must not reach envelope decryption").not.toHaveBeenCalled();

    expect(() => openProviderApiRevisionCredential(substituted),
      "Encrypted configuration hash must refuse the recomputed destination substitution").toThrow("api_connection_credential_unavailable");
    expect(decrypt, "Recomputed outer hash must reach the actual envelope decrypt").toHaveBeenCalledExactlyOnceWith(stored.credentialCiphertext);
    const plaintext: unknown = decrypt.mock.results[0]?.value;
    expect(typeof plaintext).toBe("string");
    expect(JSON.parse(plaintext as string), "Decrypted original identity and hash reach the encrypted comparison").toEqual({
      version: 1, workspaceId: stored.workspaceId, revisionId: stored.revisionId, configurationHash: stored.configurationHash, apiKey: KEY,
    });
    expect(JSON.stringify(stored), "Destination refusal keeps the exact original API payload and ciphertext").toBe(retained);
    configure(NEW);
    expect(() => openProviderApiRevisionCredential(stored), "Without the previous secret the original API envelope refuses")
      .toThrow("api_connection_credential_unavailable");
    expect(decrypt.mock.results.at(-1)?.value, "Missing secret refuses at decrypt before encrypted comparison").toBeNull();
  });
});
