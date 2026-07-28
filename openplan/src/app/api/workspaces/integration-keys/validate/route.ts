import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadWorkspaceIntegrationKeys } from "@/lib/integrations/context";
import { deploymentEnvKey } from "@/lib/integrations/deployment-env";
import { probeIntegrationKey } from "@/lib/integrations/probes";
import { integrationProvider } from "@/lib/integrations/providers";
import { requireIntegrationKeyManager } from "@/lib/integrations/route-authz";
import {
  listWorkspaceIntegrationKeyMetadata,
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
 * On-demand live validation of an integration key.
 *
 * POST { workspaceId, provider, key? }
 *   * `key` present → probe that plaintext (a pre-save check; nothing stored).
 *   * `key` absent  → probe the EFFECTIVE key for the workspace: the stored
 *     workspace key when one decrypts, otherwise the deployment env var
 *     (for Mapbox, the resolved NEXT_PUBLIC browser token).
 *
 * Response: { ok, detail, source } where source is
 *   "workspace" — the workspace's stored key was probed (or exists but no
 *                 longer decrypts, reported honestly as its own failure);
 *   "env"       — the deployment environment key was probed;
 *   "none"      — nothing is configured anywhere, said plainly;
 *   "candidate" — the request supplied the key being probed.
 *
 * `detail` never contains key material; owner/admin required, as everywhere
 * in this subsystem.
 */

const validateSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.string().min(1),
  key: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.integration_keys.validate", request);

  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = validateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid validation payload" }, { status: 400 });
  }

  const descriptor = integrationProvider(parsed.data.provider);
  if (!descriptor) {
    return NextResponse.json({ error: "Unknown integration provider" }, { status: 400 });
  }

  const access = await requireIntegrationKeyManager(parsed.data.workspaceId);
  if (!access.ok) return access.response;

  // Every path below may relay a key to the provider, so the whole endpoint is
  // throttled against the DEDICATED probe bucket (never the staff AI buckets)
  // before any probe runs — an authenticated admin must not be a key-spraying
  // oracle. Metering happens after each probe that actually runs.
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

  const recordProbeUsage = () => {
    // Fire-and-forget metering into the probe bucket the check above counts.
    void recordAiUsageEvent({
      workspaceId: parsed.data.workspaceId,
      bucketKey: "integration_key_probe",
      eventKey: "integration_key_probe",
      sourceRoute: "/api/workspaces/integration-keys/validate",
      metadataJson: { provider: descriptor.id },
    });
  };

  // Pre-save check of a submitted key.
  const candidate = parsed.data.key?.trim();
  if (candidate) {
    const probe = await probeIntegrationKey(descriptor.id, candidate);
    recordProbeUsage();
    return NextResponse.json({ ok: probe.ok, detail: probe.detail, source: "candidate" });
  }

  // Effective-key check: stored workspace key first (only meaningful for
  // providers whose workspace keys take effect), then the deployment env.
  if (descriptor.workspaceConfigurable) {
    let workspaceKeys: ReadonlyMap<string, string> = new Map();
    let storedMetadata: WorkspaceIntegrationKeyMetadata[] = [];
    try {
      const service = createServiceRoleClient();
      workspaceKeys = await loadWorkspaceIntegrationKeys(service, parsed.data.workspaceId);
      storedMetadata = await listWorkspaceIntegrationKeyMetadata(parsed.data.workspaceId, service);
    } catch (error) {
      // Degrade to the env check rather than failing the request — mirrors
      // withWorkspaceIntegrationContext. The audit trail keeps the truth.
      audit.warn("integration_key_validate_load_failed", {
        workspaceId: parsed.data.workspaceId,
        provider: descriptor.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }

    const storedKey = workspaceKeys.get(descriptor.id);
    if (storedKey) {
      const probe = await probeIntegrationKey(descriptor.id, storedKey);
      recordProbeUsage();
      return NextResponse.json({ ok: probe.ok, detail: probe.detail, source: "workspace" });
    }

    // A row exists but did not decrypt: the operator secret changed since it
    // was saved. This endpoint is where that is reported honestly instead of
    // being silently papered over by the env fallback.
    if (storedMetadata.some((meta) => meta.provider === descriptor.id)) {
      return NextResponse.json({
        ok: false,
        source: "workspace",
        detail:
          "A stored workspace key exists but can no longer be decrypted — the deployment's OPENPLAN_INTEGRATION_KEY_SECRET has changed since it was saved. Re-enter the key; until then, requests fall back to the deployment environment key.",
      });
    }
  }

  const envKey = deploymentEnvKey(descriptor);
  if (envKey) {
    const probe = await probeIntegrationKey(descriptor.id, envKey);
    recordProbeUsage();
    return NextResponse.json({ ok: probe.ok, detail: probe.detail, source: "env" });
  }

  return NextResponse.json({
    ok: false,
    source: "none",
    detail: `No ${descriptor.label} key is configured — this workspace has no stored key and the deployment does not set ${descriptor.envVar}.`,
  });
}
