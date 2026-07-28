/**
 * Service-role access to `workspace_integration_keys` — the ONLY module that
 * touches the table. The table has no authenticated grants at all (migration
 * 20260728000001), so every read and write flows through here, inside server
 * routes that have already enforced owner/admin.
 *
 * What leaves the server is metadata only: provider, key_last4, timestamps.
 * Plaintext exists transiently in server memory for encryption, probes, and
 * the per-request integration context — never in a response body.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  encryptIntegrationKey,
  integrationKeyEncryptionAvailable,
  integrationKeyLast4,
} from "./key-crypto";
import { loadWorkspaceIntegrationKeys, runWithWorkspaceIntegrationKeys } from "./context";
import { integrationProvider, type IntegrationProviderId } from "./providers";

export type WorkspaceIntegrationKeyMetadata = {
  provider: IntegrationProviderId;
  keyLast4: string;
  configuredBy: string | null;
  updatedAt: string | null;
};

type ServiceClientLike = ReturnType<typeof createServiceRoleClient>;

/** Stored-key metadata for one workspace (never plaintext, never ciphertext). */
export async function listWorkspaceIntegrationKeyMetadata(
  workspaceId: string,
  client: ServiceClientLike = createServiceRoleClient()
): Promise<WorkspaceIntegrationKeyMetadata[]> {
  const { data, error } = await client
    .from("workspace_integration_keys")
    .select("provider, key_last4, configured_by, updated_at")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`Failed to list integration keys: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const provider = typeof row.provider === "string" ? integrationProvider(row.provider) : null;
    if (!provider) return [];
    return [
      {
        provider: provider.id,
        keyLast4: typeof row.key_last4 === "string" ? row.key_last4 : "",
        configuredBy: typeof row.configured_by === "string" ? row.configured_by : null,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      },
    ];
  });
}

/**
 * Store (or replace) one provider key for a workspace. Refuses when the
 * deployment cannot encrypt — the caller turns that into honest UI copy.
 */
export async function storeWorkspaceIntegrationKey(args: {
  workspaceId: string;
  provider: IntegrationProviderId;
  plaintextKey: string;
  configuredBy: string;
  client?: ServiceClientLike;
}): Promise<WorkspaceIntegrationKeyMetadata> {
  if (!integrationKeyEncryptionAvailable()) {
    throw new Error(
      "This deployment has no OPENPLAN_INTEGRATION_KEY_SECRET, so per-workspace keys cannot be stored. The operator can set it (a high-entropy value, e.g. `openssl rand -hex 32`) and restart."
    );
  }
  const descriptor = integrationProvider(args.provider);
  if (!descriptor) throw new Error(`Unknown integration provider: ${args.provider}`);
  if (!descriptor.workspaceConfigurable) {
    throw new Error(`${descriptor.label} keys are deployment-environment-only in this release.`);
  }
  const trimmed = args.plaintextKey.trim();
  if (trimmed.length < 8) throw new Error("That does not look like a provider API key (too short).");

  const client = args.client ?? createServiceRoleClient();
  const { data, error } = await client
    .from("workspace_integration_keys")
    .upsert(
      {
        workspace_id: args.workspaceId,
        provider: args.provider,
        key_ciphertext: encryptIntegrationKey(trimmed),
        key_last4: integrationKeyLast4(trimmed),
        configured_by: args.configuredBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,provider" }
    )
    .select("provider, key_last4, configured_by, updated_at")
    .single();
  if (error) throw new Error(`Failed to store the integration key: ${error.message}`);
  const row = data as Record<string, unknown>;
  return {
    provider: args.provider,
    keyLast4: typeof row.key_last4 === "string" ? row.key_last4 : "",
    configuredBy: typeof row.configured_by === "string" ? row.configured_by : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** Remove one provider key; the workspace falls back to the deployment env. */
export async function deleteWorkspaceIntegrationKey(
  workspaceId: string,
  provider: IntegrationProviderId,
  client: ServiceClientLike = createServiceRoleClient()
): Promise<void> {
  const { error } = await client
    .from("workspace_integration_keys")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
  if (error) throw new Error(`Failed to remove the integration key: ${error.message}`);
}

/**
 * Route-entry convenience: load the workspace's keys with a service-role
 * client and run `fn` inside the integration context. Any load failure —
 * including a deployment with no service-role key at all — degrades to
 * running `fn` with no overrides (deployment env behavior).
 */
export async function withWorkspaceIntegrationContext<T>(
  workspaceId: string,
  fn: () => Promise<T>
): Promise<T> {
  let keys: ReadonlyMap<IntegrationProviderId, string> = new Map();
  try {
    keys = await loadWorkspaceIntegrationKeys(createServiceRoleClient(), workspaceId);
  } catch {
    // Fall through with no overrides.
  }
  return await runWithWorkspaceIntegrationKeys(workspaceId, keys, fn);
}
