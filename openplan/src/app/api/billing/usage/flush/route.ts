import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createStripeMeterEventClient,
  flushUsageEventsToStripe,
} from "@/lib/billing/usage-flush";
import {
  createServiceRoleClient,
  isMissingEnvironmentVariableError,
} from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

export const runtime = "nodejs";

const usageFlushSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  closedBefore: z.string().datetime().optional(),
  workspaceId: z.string().uuid().optional(),
  bucketKey: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/).optional(),
  limit: z.number().int().min(1).max(5000).optional().default(1000),
});

function configuredFlushSecret(): string | null {
  return process.env.OPENPLAN_BILLING_USAGE_FLUSH_SECRET?.trim() || null;
}

function requestSecret(request: NextRequest): string | null {
  const explicit = request.headers.get("x-openplan-billing-usage-flush-secret")?.trim();
  if (explicit) {
    return explicit;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return null;
}

function isAuthorized(request: NextRequest): boolean | "missing_config" {
  const expected = configuredFlushSecret();
  if (!expected) {
    return "missing_config";
  }

  return requestSecret(request) === expected;
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("billing.usage.flush", request);
  const startedAt = Date.now();
  const authorized = isAuthorized(request);

  if (authorized === "missing_config") {
    audit.warn("usage_flush_secret_missing");
    return NextResponse.json({ error: "Billing usage flush is not configured" }, { status: 503 });
  }

  if (!authorized) {
    audit.warn("usage_flush_unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = usageFlushSchema.safeParse(body);
  if (!parsed.success) {
    audit.warn("usage_flush_validation_failed", { issues: parsed.error.issues.length });
    return NextResponse.json({ error: "Invalid usage flush payload" }, { status: 400 });
  }

  const input = parsed.data;
  if (input.closedBefore && Date.parse(input.closedBefore) > Date.now() + 5 * 60 * 1000) {
    audit.warn("usage_flush_future_cutoff_rejected", { closedBefore: input.closedBefore });
    return NextResponse.json({ error: "Usage flush cutoff cannot be in the future" }, { status: 400 });
  }

  let stripeClient = null;
  if (!input.dryRun) {
    try {
      stripeClient = createStripeMeterEventClient();
    } catch (error) {
      audit.error("usage_flush_stripe_configuration_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "Stripe usage reporting is not configured" }, { status: 503 });
    }
  }

  try {
    const summary = await flushUsageEventsToStripe({
      supabase: createServiceRoleClient(),
      stripeClient,
      dryRun: input.dryRun,
      closedBefore: input.closedBefore ?? null,
      workspaceId: input.workspaceId ?? null,
      bucketKey: input.bucketKey ?? null,
      limit: input.limit,
    });

    const partialFailure = summary.failedGroups > 0 || summary.markFailedGroups > 0;
    const event = partialFailure ? "usage_flush_partial_failure" : "usage_flush_completed";
    audit[partialFailure ? "warn" : "info"](event, {
      dryRun: summary.dryRun,
      closedBefore: summary.closedBefore,
      workspaceId: summary.workspaceId,
      bucketKey: summary.bucketKey,
      scannedSubscriptions: summary.scannedSubscriptions,
      scannedEvents: summary.scannedEvents,
      reportedGroups: summary.reportedGroups,
      dryRunGroups: summary.dryRunGroups,
      skippedGroups: summary.skippedGroups,
      failedGroups: summary.failedGroups,
      markFailedGroups: summary.markFailedGroups,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        ok: !partialFailure,
        ...summary,
      },
      { status: partialFailure ? 207 : 200 }
    );
  } catch (error) {
    audit.error("usage_flush_unhandled_error", {
      message: error instanceof Error ? error.message : "unknown",
      missingEnv:
        isMissingEnvironmentVariableError(error) ? error.variableName : undefined,
      durationMs: Date.now() - startedAt,
    });

    if (isMissingEnvironmentVariableError(error)) {
      return NextResponse.json({ error: "Billing usage flush configuration unavailable" }, { status: 503 });
    }

    return NextResponse.json({ error: "Failed to flush billing usage" }, { status: 500 });
  }
}
