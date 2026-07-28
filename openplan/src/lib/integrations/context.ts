/**
 * The per-request workspace-integration context: an AsyncLocalStorage scope
 * that carries a workspace's decrypted provider keys through a request, so
 * deep synchronous read points (`censusApiKey()`, the Anthropic access
 * helpers) can honor a workspace override WITHOUT threading a workspaceId
 * through every intermediate signature.
 *
 * DESIGN
 *   * A route that knows its workspace wraps the rest of its handler in
 *     {@link runWithWorkspaceIntegrationKeys}. Everything that executes inside
 *     — library engines, data-source fetches, model constructions — sees the
 *     workspace's keys via {@link workspaceIntegrationKey}.
 *   * Outside any scope (workers, cron, unwrapped routes) the sync read
 *     returns null and callers fall back to the deployment env, which is
 *     exactly the pre-existing behavior. Absence of the wrapper is safe.
 *   * Key loading is ONE service-role query per wrapped request; a load
 *     failure degrades to the env fallback rather than failing the request —
 *     a missing override must never take a feature down.
 *
 * Server-only: AsyncLocalStorage and the service-role client have no place in
 * a browser bundle.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { decryptIntegrationKey } from "./key-crypto";
import type { IntegrationProviderId } from "./providers";

type IntegrationKeyScope = {
  workspaceId: string;
  keys: ReadonlyMap<IntegrationProviderId, string>;
};

const integrationKeyStorage = new AsyncLocalStorage<IntegrationKeyScope>();

/**
 * Minimal structural view of a Supabase client for the one query we run.
 * The public parameter below is `unknown` rather than this type on purpose:
 * checking the real SupabaseClient's deeply generic query builder against a
 * structural type trips TS2589 ("type instantiation is excessively deep").
 * Supabase clients are intentionally untyped in this repo and results are
 * cast deliberately (see CLAUDE.md), so the cast happens once, here.
 */
type KeyRowsClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

/**
 * Load and decrypt a workspace's stored keys. Rows that fail decryption
 * (rotated secret, tampering) are skipped silently — the env fallback covers
 * them, and the wizard's validate button is the surface that reports a dead
 * stored key to the operator.
 */
export async function loadWorkspaceIntegrationKeys(
  supabaseClient: unknown,
  workspaceId: string
): Promise<Map<IntegrationProviderId, string>> {
  const client = supabaseClient as KeyRowsClient;
  const keys = new Map<IntegrationProviderId, string>();
  if (!workspaceId) return keys;
  try {
    const { data, error } = await client
      .from("workspace_integration_keys")
      .select("provider, key_ciphertext")
      .eq("workspace_id", workspaceId);
    if (error) return keys;
    for (const row of (data ?? []) as Array<{ provider?: unknown; key_ciphertext?: unknown }>) {
      if (typeof row.provider !== "string" || typeof row.key_ciphertext !== "string") continue;
      const plaintext = decryptIntegrationKey(row.key_ciphertext);
      if (plaintext) keys.set(row.provider as IntegrationProviderId, plaintext);
    }
    return keys;
  } catch {
    return keys;
  }
}

/**
 * Run `fn` with the given workspace's integration keys visible to
 * {@link workspaceIntegrationKey}. The keys map is loaded by the caller
 * (usually via {@link loadWorkspaceIntegrationKeys} on a service-role client)
 * so this function itself stays synchronous-in, promise-out and testable.
 */
export function runWithWorkspaceIntegrationKeys<T>(
  workspaceId: string,
  keys: ReadonlyMap<IntegrationProviderId, string>,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return integrationKeyStorage.run({ workspaceId, keys }, fn);
}

/**
 * The current request's workspace override for one provider, or null when
 * there is no scope or no stored key. Synchronous on purpose — this is what
 * lets `censusApiKey()` and the Anthropic helpers stay drop-in.
 */
export function workspaceIntegrationKey(provider: IntegrationProviderId): string | null {
  return integrationKeyStorage.getStore()?.keys.get(provider) ?? null;
}

/** The workspace the current scope belongs to, if any (diagnostics/tests). */
export function currentIntegrationKeyWorkspaceId(): string | null {
  return integrationKeyStorage.getStore()?.workspaceId ?? null;
}
