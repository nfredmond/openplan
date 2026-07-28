import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadWorkspaceIntegrationKeys } from "@/lib/integrations/context";
import { deploymentEnvKey } from "@/lib/integrations/deployment-env";
import { integrationKeyEncryptionAvailable } from "@/lib/integrations/key-crypto";
import { probeIntegrationKey } from "@/lib/integrations/probes";
import { INTEGRATION_PROVIDERS, integrationProvider } from "@/lib/integrations/providers";
import { requireIntegrationKeyManager } from "@/lib/integrations/route-authz";
import {
  deleteWorkspaceIntegrationKey,
  listWorkspaceIntegrationKeyMetadata,
  storeWorkspaceIntegrationKey,
  type WorkspaceIntegrationKeyMetadata,
} from "@/lib/integrations/workspace-keys";
import {
  checkAiUsageRateLimit,
  INTEGRATION_KEY_PROBE_BUCKET_KEYS,
  INTEGRATION_KEY_PROBE_MAX_PER_WINDOW,
  recordAiUsageEvent,
} from "@/lib/runtime/ai-rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Per-workspace integration keys — the guided-setup API.
 *
 * GET    ?workspaceId=…            → registry + env presence + stored-key metadata
 *                                     (incl. whether each stored key still decrypts)
 * PUT    { workspaceId, provider, key }   → live-probe the key, store ONLY if it validates
 * DELETE { workspaceId, provider }        → remove the stored key (env fallback resumes)
 *
 * Owner/admin is required for every verb, GET included: which providers are
 * configured, and with what last-4, is operator information.
 *
 * Nothing in any response is ever the plaintext or the ciphertext — the only
 * key material that leaves the server is `keyLast4`.
 */

const workspaceQuerySchema = z.object({ workspaceId: z.string().uuid() });

const putSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.string().min(1),
  key: z.string().min(1),
});

const deleteSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.string().min(1),
});

/** The operator-facing refusal when the deployment cannot encrypt (mirrors workspace-keys.ts). */
const STORAGE_UNAVAILABLE_MESSAGE =
  "This deployment has no OPENPLAN_INTEGRATION_KEY_SECRET, so per-workspace keys cannot be stored. The operator can set it (a high-entropy value, e.g. `openssl rand -hex 32`) and restart.";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.integration_keys.list", request);

  const parsed = workspaceQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workspace id" }, { status: 400 });
  }

  const access = await requireIntegrationKeyManager(parsed.data.workspaceId);
  if (!access.ok) return access.response;

  let stored: WorkspaceIntegrationKeyMetadata[];
  // Providers whose stored ciphertext still decrypts under the CURRENT
  // deployment secret. After a secret rotation the row survives but requests
  // silently fall back to the deployment env key — reporting the row as an
  // active workspace key would be affirmatively false, so the metadata carries
  // a `decryptable` verdict and the panel renders the truth. Plaintext is
  // decrypted transiently server-side and never leaves this handler.
  let decryptableProviders: ReadonlySet<string>;
  try {
    const service = createServiceRoleClient();
    stored = await listWorkspaceIntegrationKeyMetadata(parsed.data.workspaceId, service);
    decryptableProviders = new Set(
      (await loadWorkspaceIntegrationKeys(service, parsed.data.workspaceId)).keys()
    );
  } catch (error) {
    audit.error("integration_key_list_failed", {
      workspaceId: parsed.data.workspaceId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to load integration key settings" }, { status: 500 });
  }

  const storedByProvider = new Map(stored.map((meta) => [meta.provider, meta]));

  return NextResponse.json({
    storageAvailable: integrationKeyEncryptionAvailable(),
    providers: INTEGRATION_PROVIDERS.map((provider) => {
      const meta = storedByProvider.get(provider.id) ?? null;
      return {
        id: provider.id,
        label: provider.label,
        purpose: provider.purpose,
        keySignupUrl: provider.keySignupUrl,
        envVar: provider.envVar,
        workspaceConfigurable: provider.workspaceConfigurable,
        ...(provider.workspaceConfigurableNote
          ? { workspaceConfigurableNote: provider.workspaceConfigurableNote }
          : {}),
        envKeyPresent: deploymentEnvKey(provider) !== null,
        storedKey: meta
          ? {
              keyLast4: meta.keyLast4,
              updatedAt: meta.updatedAt,
              decryptable: decryptableProviders.has(meta.provider),
            }
          : null,
      };
    }),
  });
}

export async function PUT(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.integration_keys.store", request);

  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = putSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid integration key payload" }, { status: 400 });
  }

  const descriptor = integrationProvider(parsed.data.provider);
  if (!descriptor) {
    return NextResponse.json({ error: "Unknown integration provider" }, { status: 400 });
  }

  const access = await requireIntegrationKeyManager(parsed.data.workspaceId);
  if (!access.ok) return access.response;

  if (!descriptor.workspaceConfigurable) {
    return NextResponse.json(
      {
        error:
          descriptor.workspaceConfigurableNote ??
          `${descriptor.label} keys are deployment-environment-only in this release.`,
      },
      { status: 400 }
    );
  }

  // Refuse before probing: a validated key we cannot store helps no one.
  // 503 follows the repo's "this deployment cannot do this yet" precedent
  // (Knowledge Base / Data Hub schema-pending responses, ai_offline).
  if (!integrationKeyEncryptionAvailable()) {
    return NextResponse.json({ error: STORAGE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  const key = parsed.data.key.trim();
  if (key.length < 8) {
    return NextResponse.json(
      { error: "That does not look like a provider API key (too short)." },
      { status: 400 }
    );
  }

  // A probe relays the caller-supplied key to the provider, so it is metered
  // into the DEDICATED probe bucket (never the staff AI buckets) and refused
  // past the cap — an authenticated admin must not be a key-spraying oracle.
  const rateLimit = await checkAiUsageRateLimit(parsed.data.workspaceId, {
    bucketKeys: INTEGRATION_KEY_PROBE_BUCKET_KEYS,
    max: INTEGRATION_KEY_PROBE_MAX_PER_WINDOW,
  });
  if (!rateLimit.allowed) {
    audit.warn("integration_key_probe_rate_limited", {
      workspaceId: parsed.data.workspaceId,
      provider: descriptor.id,
      userId: access.userId,
    });
    return NextResponse.json(
      { error: "Too many key checks right now. Please try again shortly." },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  // Save-only-what-validates: probe the SUBMITTED key live, store on success.
  const probe = await probeIntegrationKey(descriptor.id, key);
  // Fire-and-forget metering into the probe bucket the check above counts —
  // charged whenever a probe actually ran, whatever its verdict.
  void recordAiUsageEvent({
    workspaceId: parsed.data.workspaceId,
    bucketKey: "integration_key_probe",
    eventKey: "integration_key_probe",
    sourceRoute: "/api/workspaces/integration-keys",
    metadataJson: { provider: descriptor.id },
  });
  if (!probe.ok) {
    audit.warn("integration_key_probe_refused", {
      workspaceId: parsed.data.workspaceId,
      provider: descriptor.id,
      userId: access.userId,
    });
    return NextResponse.json({ error: probe.detail, validated: false }, { status: 422 });
  }

  try {
    const storedMeta = await storeWorkspaceIntegrationKey({
      workspaceId: parsed.data.workspaceId,
      provider: descriptor.id,
      plaintextKey: key,
      configuredBy: access.userId,
    });
    audit.info("integration_key_stored", {
      workspaceId: parsed.data.workspaceId,
      provider: descriptor.id,
      userId: access.userId,
    });
    return NextResponse.json({
      validated: true,
      detail: probe.detail,
      // Just encrypted under the current secret, so trivially decryptable —
      // included so the stored-key shape matches GET's.
      storedKey: { keyLast4: storedMeta.keyLast4, updatedAt: storedMeta.updatedAt, decryptable: true },
    });
  } catch (error) {
    audit.error("integration_key_store_failed", {
      workspaceId: parsed.data.workspaceId,
      provider: descriptor.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to store the integration key" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.integration_keys.remove", request);

  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = deleteSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid integration key payload" }, { status: 400 });
  }

  const descriptor = integrationProvider(parsed.data.provider);
  if (!descriptor) {
    return NextResponse.json({ error: "Unknown integration provider" }, { status: 400 });
  }

  const access = await requireIntegrationKeyManager(parsed.data.workspaceId);
  if (!access.ok) return access.response;

  try {
    await deleteWorkspaceIntegrationKey(parsed.data.workspaceId, descriptor.id);
  } catch (error) {
    audit.error("integration_key_remove_failed", {
      workspaceId: parsed.data.workspaceId,
      provider: descriptor.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to remove the integration key" }, { status: 500 });
  }

  audit.info("integration_key_removed", {
    workspaceId: parsed.data.workspaceId,
    provider: descriptor.id,
    userId: access.userId,
  });
  return NextResponse.json({ removed: true, provider: descriptor.id });
}
