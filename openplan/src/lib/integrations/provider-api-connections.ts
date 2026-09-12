import { z } from "zod";
import { providerRpcError, ProviderRequestError, type ProviderService } from "@/lib/assistant/provider-server";
import { openProviderApiRevisionCredential, prepareProviderApiRevision, providerApiConfigurationSchema, type StoredProviderApiRevision } from "./provider-api-credentials";

export const API_CONNECTION_COLUMNS = "id,workspace_id,current_revision_id,created_by,created_at,revoked_at";
export const API_REVISION_COLUMNS = "id,connection_id,workspace_id,previous_revision_id,configuration,configuration_canonical,configuration_hash,configured_by,created_at";
const revisionSchema = z.object({
  id: z.string().uuid(), connection_id: z.string().uuid(), workspace_id: z.string().uuid(), previous_revision_id: z.string().uuid().nullable(),
  configuration: providerApiConfigurationSchema, configuration_canonical: z.string(), configuration_hash: z.string(),
  configured_by: z.string().uuid(), created_at: z.string(),
});
export const apiConnectionMetadataSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), current_revision_id: z.string().uuid().nullable(),
  created_by: z.string().uuid(), created_at: z.string(), revoked_at: z.string().nullable(),
});
const savedSchema = z.object({ created: z.boolean(), connection: apiConnectionMetadataSchema, revision: revisionSchema });

// Retry recovery compares the decrypted key; randomized ciphertexts for the
// same plaintext are not equal. The RPC then locks and rechecks the exact stored
// ciphertext plus configuration/author/previous revision before returning it.
async function ciphertextForSave(service: ProviderService, draft: StoredProviderApiRevision, connectionId: string, userId: string, previousRevisionId: string | null) {
  const found = await service.from("workspace_provider_api_revisions").select(API_REVISION_COLUMNS)
    .eq("id", draft.revisionId).eq("workspace_id", draft.workspaceId).eq("connection_id", connectionId).maybeSingle();
  providerRpcError(found.error);
  if (!found.data) return draft.credentialCiphertext;
  const revision = revisionSchema.parse(found.data);
  if (revision.id !== draft.revisionId || revision.connection_id !== connectionId || revision.workspace_id !== draft.workspaceId ||
    revision.previous_revision_id !== previousRevisionId || revision.configured_by !== userId ||
    revision.configuration_canonical !== JSON.stringify(draft.configuration) || revision.configuration_hash !== draft.configurationHash) {
    throw new ProviderRequestError("provider_retry_conflict", 409);
  }
  const stored = await service.from("workspace_provider_api_credentials").select("revision_id,connection_id,workspace_id,credential_ciphertext")
    .eq("revision_id", draft.revisionId).eq("workspace_id", draft.workspaceId).eq("connection_id", connectionId).maybeSingle();
  providerRpcError(stored.error);
  const credential = z.object({ revision_id: z.string().uuid(), connection_id: z.string().uuid(), workspace_id: z.string().uuid(), credential_ciphertext: z.string().nullable() }).parse(stored.data);
  if (credential.revision_id !== draft.revisionId || credential.connection_id !== connectionId || credential.workspace_id !== draft.workspaceId ||
    openProviderApiRevisionCredential({ ...draft, credentialCiphertext: credential.credential_ciphertext }) !== openProviderApiRevisionCredential(draft)) {
    throw new ProviderRequestError("provider_retry_conflict", 409);
  }
  return credential.credential_ciphertext;
}

// The calling route authenticates owner/admin before any service-role read.
// The write RPC repeats and locks that membership, including save recovery.
export async function saveProviderApiConnection(args: {
  service: ProviderService; userId: string; workspaceId: string; connectionId: string; revisionId: string;
  expectedRevisionId: string | null; configuration: unknown; apiKey: unknown;
}) {
  const draft = prepareProviderApiRevision(args);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ciphertext = await ciphertextForSave(args.service, draft, args.connectionId, args.userId, args.expectedRevisionId);
    const saved = await args.service.rpc("save_workspace_provider_api_revision", {
      p_user_id: args.userId, p_workspace_id: args.workspaceId, p_connection_id: args.connectionId,
      p_revision_id: args.revisionId, p_expected_revision_id: args.expectedRevisionId,
      p_configuration_canonical: JSON.stringify(draft.configuration), p_credential_ciphertext: ciphertext,
    });
    // Two simultaneous identical saves encrypt separately. Re-read the winner
    // once; a different key/configuration still fails the same identity check.
    if (attempt === 0 && ["PT409", "23505"].includes(saved.error?.code ?? "")) continue;
    providerRpcError(saved.error);
    const result = savedSchema.parse(saved.data);
    if (result.connection.id !== args.connectionId || result.connection.workspace_id !== args.workspaceId ||
      result.revision.id !== args.revisionId || result.revision.connection_id !== args.connectionId ||
      result.revision.workspace_id !== args.workspaceId || result.revision.previous_revision_id !== args.expectedRevisionId ||
      result.revision.configured_by !== args.userId || result.revision.configuration_canonical !== JSON.stringify(draft.configuration) ||
      result.revision.configuration_hash !== draft.configurationHash || JSON.stringify(result.revision.configuration) !== JSON.stringify(draft.configuration)) {
      throw new ProviderRequestError("provider_retry_conflict", 409);
    }
    return result;
  }
  throw new ProviderRequestError("provider_retry_conflict", 409);
}
